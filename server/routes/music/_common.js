const path = require('path');
const fs = require('fs');
const { getDb } = require('../../db');
const { nanoid } = require('nanoid');
const { MEDIA_DIRS, isWithinAnyDir } = require('../../utils');

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.wav', '.m4a', '.aac', '.wma', '.opus'];
const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.opus': 'audio/opus',
};

function getAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return AUDIO_MIME_TYPES[ext] || 'audio/mpeg';
}

function streamAudio(request, reply, filePath) {
  if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
    return reply.status(403).send({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'Audio file not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getAudioMimeType(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  const range = request.headers.range;

  const cacheHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
    'ETag': etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
      return reply.status(416).headers({ 'Content-Range': `bytes */${fileSize}` }).send({ error: 'Invalid range' });
    }
    const chunkSize = end - start + 1;
    reply.status(206).headers({
      ...cacheHeaders,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });
    return fs.createReadStream(filePath, { start, end, highWaterMark: 1024 * 1024 });
  }

  reply.headers({ ...cacheHeaders, 'Content-Length': fileSize });
  return fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
}

function scanMusicFolder() {
  const db = getDb();
  const results = { albums: 0, tracks: 0 };

  for (const baseDir of MEDIA_DIRS) {
    const musicDir = path.join(baseDir, 'music');
    if (!fs.existsSync(musicDir)) continue;

    const entries = fs.readdirSync(musicDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const albumPath = path.join(musicDir, entry.name);
        const albumFiles = fs.readdirSync(albumPath);

        let coverPath = null;
        for (const imgName of ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'front.png']) {
          if (albumFiles.includes(imgName)) {
            coverPath = path.join(albumPath, imgName);
            break;
          }
        }

        let existingAlbum = db.prepare("SELECT id FROM music_albums WHERE title = ? AND artist = ''").get(entry.name);
        if (!existingAlbum) {
          const albumId = nanoid();
          db.prepare(
            'INSERT INTO music_albums (id, title, cover_path) VALUES (?, ?, ?)'
          ).run(albumId, entry.name, coverPath);
          results.albums++;
        } else {
          if (coverPath && !db.prepare('SELECT cover_path FROM music_albums WHERE id = ?').get(existingAlbum.id).cover_path) {
            db.prepare('UPDATE music_albums SET cover_path = ? WHERE id = ?').run(coverPath, existingAlbum.id);
          }
        }

        const album = existingAlbum || db.prepare("SELECT id FROM music_albums WHERE title = ? AND artist = ''").get(entry.name);

        for (const file of albumFiles) {
          const ext = path.extname(file).toLowerCase();
          if (!AUDIO_EXTENSIONS.includes(ext)) continue;

          const filePath = path.join(albumPath, file);
          const stat = fs.statSync(filePath);

          const existingTrack = db.prepare('SELECT id FROM music_tracks WHERE file_path = ?').get(filePath);
          if (existingTrack) continue;

          const trackId = nanoid();
          const title = path.basename(file, ext).replace(/[._-]/g, ' ').trim();
          const trackNum = parseInt((file.match(/^(\d+)/) || [])[1]) || 0;

          db.prepare(
            'INSERT INTO music_tracks (id, album_id, track_number, title, file_path, file_size) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(trackId, album.id, trackNum, title, filePath, stat.size);
          results.tracks++;
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) continue;

        const filePath = path.join(musicDir, entry.name);
        const stat = fs.statSync(filePath);

        const existingTrack = db.prepare('SELECT id FROM music_tracks WHERE file_path = ?').get(filePath);
        if (existingTrack) continue;

        const trackId = nanoid();
        const title = path.basename(entry.name, ext).replace(/[._-]/g, ' ').trim();

        db.prepare(
          'INSERT INTO music_tracks (id, track_number, title, file_path, file_size) VALUES (?, ?, ?, ?, ?)'
        ).run(trackId, 0, title, filePath, stat.size);
        results.tracks++;
      }
    }
  }

  return results;
}

module.exports = {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  getAudioMimeType,
  streamAudio,
  scanMusicFolder,
};
