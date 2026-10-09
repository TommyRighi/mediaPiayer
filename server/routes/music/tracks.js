const { getDb } = require('../../db');
const { authMiddleware, mediaAuth, adminMiddleware } = require('../../auth');
const { MEDIA_DIRS, isWithinAnyDir } = require('../../utils');
const { pipeline } = require('stream/promises');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const { AUDIO_EXTENSIONS, streamAudio } = require('./_common');

async function tracksRoutes(fastify) {

  fastify.post('/tracks/:id/prepare', { preHandler: authMiddleware }, async request => require('../../music-prepare').queuePreparation(request.params.id, request.body?.retry === true));
  fastify.get('/tracks/:id/cover', { preHandler: mediaAuth }, async (request, reply) => {
    const track = getDb().prepare('SELECT COALESCE(t.cover_path,a.cover_path) AS cover FROM music_tracks t LEFT JOIN music_albums a ON a.id=t.album_id WHERE t.id=?').get(request.params.id);
    if (!track?.cover || !isWithinAnyDir(track.cover, MEDIA_DIRS) || !fs.existsSync(track.cover)) return reply.code(404).send({ error: 'No cover' });
    reply.type(require('../../utils').getImageMimeType(track.cover));
    return fs.createReadStream(track.cover);
  });

  fastify.get('/tracks', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { album_id, search } = request.query;
    let query = 'SELECT * FROM music_tracks WHERE 1=1';
    const params = [];
    if (album_id) { query += ' AND album_id = ?'; params.push(album_id); }
    if (search) { query += ' AND (title LIKE ? OR artist LIKE ? OR album_id IN (SELECT id FROM music_albums WHERE title LIKE ? OR artist LIKE ?))'; params.push(...Array(4).fill(`%${search}%`)); }
    query += ' ORDER BY album_id, track_number, title';
    return db.prepare(query).all(...params);
  });

  fastify.get('/tracks/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    return track;
  });

  fastify.get('/tracks/:id/stream', { preHandler: [mediaAuth] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT file_path, playback_path, playback_status FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    return streamAudio(request, reply, track.playback_status === 'ready' ? track.playback_path : track.file_path);
  });

  fastify.patch('/tracks/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    const { title, artist, track_number, album_id } = request.body;
    if (title !== undefined) track.title = title;
    if (artist !== undefined) track.artist = artist;
    if (track_number !== undefined) track.track_number = track_number;
    if (album_id !== undefined) track.album_id = album_id || null;
    db.prepare('UPDATE music_tracks SET title=?, artist=?, track_number=?, album_id=? WHERE id=?')
      .run(track.title, track.artist, track.track_number, track.album_id, track.id);
    return db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(track.id);
  });

  fastify.delete('/tracks/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(request.params.id);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    db.prepare('DELETE FROM music_tracks WHERE id = ?').run(track.id);
    return { success: true };
  });

  fastify.post('/tracks/upload', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const ext = path.extname(data.filename).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      return reply.status(400).send({ error: 'Invalid audio file type' });
    }

    const { album_id, title, artist, track_number } = data.fields || {};
    const trackTitle = (title && title.value) || path.basename(data.filename, ext).replace(/[._-]/g, ' ').trim();
    const trackArtist = (artist && artist.value) || '';
    const trackNum = (track_number && parseInt(track_number.value)) || 0;
    const albumId = (album_id && album_id.value) || null;

    const musicDir = path.join(MEDIA_DIRS[0], 'music');
    fs.mkdirSync(musicDir, { recursive: true });

    let targetDir;
    if (albumId) {
      const album = getDb().prepare('SELECT * FROM music_albums WHERE id = ?').get(albumId);
      if (!album) return reply.status(404).send({ error: 'Album not found' });
      targetDir = path.join(musicDir, 'albums', albumId);
      fs.mkdirSync(targetDir, { recursive: true });
    } else {
      targetDir = path.join(musicDir, 'singles');
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeName = nanoid() + ext;
    const filePath = path.join(targetDir, safeName);
    await pipeline(data.file, fs.createWriteStream(filePath));
    if (data.file.truncated) {
      await fs.promises.rm(filePath, { force: true });
      return reply.code(413).send({ error: 'The audio file is too large.' });
    }
    const { importAudio } = require('../../music-library');
    const result = await importAudio(filePath, { albumId, title: title?.value || undefined, fallbackTitle: trackTitle, artist: trackArtist, trackNumber: trackNum });
    return result.track;
  });
}

module.exports = tracksRoutes;
