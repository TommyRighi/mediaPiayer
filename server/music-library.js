const fs = require('node:fs');
const path = require('node:path');
const { nanoid } = require('nanoid');
const { getDb } = require('./db');
const { MEDIA_DIRS, isWithinAnyDir } = require('./utils');
const { transformImage } = require('./image-transform');

async function readAudioMetadata(filePath) {
  try {
    const { parseFile, selectCover } = await import('music-metadata');
    const { common, format } = await parseFile(filePath, { duration: true });
    return { title: common.title, artist: common.artist, album: common.album, albumArtist: common.albumartist || common.artist,
      trackNumber: common.track?.no, year: common.year, genre: common.genre?.join(', '),
      duration: Number.isFinite(format.duration) ? format.duration : 0, picture: selectCover(common.picture) };
  } catch { return { duration: 0 }; }
}

async function importAudio(filePath, options = {}) {
  if (!isWithinAnyDir(filePath, MEDIA_DIRS)) throw new Error('Invalid audio path');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM music_tracks WHERE file_path=?').get(filePath);
  if (existing?.metadata_read) return { track: existing, added: false };
  const metadata = await readAudioMetadata(filePath);
  let albumId = options.albumId || existing?.album_id || null;
  const albumTitle = metadata.album || options.albumTitle;
  if (!albumId && albumTitle) {
    let album = db.prepare('SELECT * FROM music_albums WHERE title=? AND artist=?').get(albumTitle, metadata.albumArtist || options.artist || '');
    if (!album) {
      albumId = nanoid();
      db.prepare('INSERT INTO music_albums (id,title,artist,year,genre) VALUES (?,?,?,?,?)')
        .run(albumId, albumTitle, metadata.albumArtist || options.artist || '', metadata.year || null, metadata.genre || '');
    } else albumId = album.id;
  }
  const id = existing?.id || nanoid();
  let coverPath = existing?.cover_path || null;
  const picture = metadata.picture;
  if (!coverPath && picture?.data?.length && picture.data.length <= 5 * 1024 * 1024) {
    const directory = path.join(MEDIA_DIRS[0], 'music', '.covers');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, `${id}.jpg`);
    try { await transformImage(picture.data, target, { width: 800, height: 800, limitInputPixels: 20000000 }); coverPath = target; }
    catch { /* A broken picture must not prevent importing audio. */ }
  }
  if (albumId) {
    db.prepare(`UPDATE music_albums SET cover_path=COALESCE(cover_path,?), artist=CASE WHEN artist='' THEN ? ELSE artist END,
      year=COALESCE(year,?), genre=CASE WHEN genre='' THEN ? ELSE genre END WHERE id=?`)
      .run(coverPath || options.coverPath || null, metadata.albumArtist || '', metadata.year || null, metadata.genre || '', albumId);
  }
  const title = options.title || existing?.title || metadata.title || options.fallbackTitle || path.basename(filePath, path.extname(filePath)).replace(/[._-]/g, ' ').trim();
  const artist = options.artist || existing?.artist || metadata.artist || '';
  const trackNumber = options.trackNumber || existing?.track_number || metadata.trackNumber || Number(path.basename(filePath).match(/^\d+/)?.[0]) || 0;
  if (existing) {
    db.prepare('UPDATE music_tracks SET album_id=?,artist=?,track_number=?,duration=?,cover_path=?,metadata_read=1 WHERE id=?')
      .run(albumId, artist, trackNumber, metadata.duration || existing.duration, coverPath, id);
  } else {
    db.prepare('INSERT INTO music_tracks (id,album_id,title,artist,track_number,duration,file_path,file_size,cover_path,metadata_read) VALUES (?,?,?,?,?,?,?,?,?,1)')
      .run(id, albumId, title, artist, trackNumber, metadata.duration, filePath, fs.statSync(filePath).size, coverPath);
  }
  if (path.extname(filePath).toLowerCase() === '.wma') require('./music-prepare').queuePreparation(id);
  return { track: db.prepare('SELECT * FROM music_tracks WHERE id=?').get(id), added: !existing };
}

module.exports = { readAudioMetadata, importAudio };
