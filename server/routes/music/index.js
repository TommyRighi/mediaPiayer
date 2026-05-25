const { getDb } = require('../../db');
const { authMiddleware, adminMiddleware } = require('../../auth');
const { nanoid } = require('nanoid');
const { scanMusicFolder } = require('./_common');
const albumsRoutes = require('./albums');
const tracksRoutes = require('./tracks');
const playlistsRoutes = require('./playlists');
const youtubeRoutes = require('./youtube');

async function musicRoutes(fastify) {
  const prefix = '/api/music';

  await fastify.register(albumsRoutes, { prefix });
  await fastify.register(tracksRoutes, { prefix });
  await fastify.register(playlistsRoutes, { prefix });
  await fastify.register(youtubeRoutes, { prefix });

  fastify.get(prefix + '/favorites', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    return db.prepare(`
      SELECT t.*, f.created_at as favorited_at
      FROM favorite_tracks f
      JOIN music_tracks t ON t.id = f.track_id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC
    `).all(request.user.id);
  });

  fastify.post(prefix + '/favorites/:trackId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const db = getDb();
    const track = db.prepare('SELECT id FROM music_tracks WHERE id = ?').get(request.params.trackId);
    if (!track) return reply.status(404).send({ error: 'Track not found' });
    try {
      const id = nanoid();
      db.prepare('INSERT INTO favorite_tracks (id, user_id, track_id) VALUES (?, ?, ?)').run(id, request.user.id, request.params.trackId);
      return { success: true };
    } catch (e) {
      if (e.message.includes('UNIQUE')) return { success: true };
      throw e;
    }
  });

  fastify.delete(prefix + '/favorites/:trackId', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    db.prepare('DELETE FROM favorite_tracks WHERE user_id = ? AND track_id = ?').run(request.user.id, request.params.trackId);
    return { success: true };
  });

  fastify.post(prefix + '/progress', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { track_id, progress_seconds, duration, completed } = request.body;
    if (!track_id) throw { statusCode: 400, message: 'track_id is required' };
    const existing = db.prepare('SELECT id FROM track_progress WHERE user_id = ? AND track_id = ?').get(request.user.id, track_id);
    if (existing) {
      db.prepare(
        'UPDATE track_progress SET progress_seconds=?, duration=?, completed=?, updated_at=datetime(\'now\') WHERE id=?'
      ).run(progress_seconds, duration || 0, completed ? 1 : 0, existing.id);
    } else {
      const id = nanoid();
      db.prepare(
        'INSERT INTO track_progress (id, user_id, track_id, progress_seconds, duration, completed) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, request.user.id, track_id, progress_seconds, duration || 0, completed ? 1 : 0);
    }
    return { success: true };
  });

  fastify.get(prefix + '/progress', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    return db.prepare('SELECT * FROM track_progress WHERE user_id = ?').all(request.user.id);
  });

  fastify.get(prefix + '/random', { preHandler: [authMiddleware] }, async (request) => {
    const db = getDb();
    const { limit } = request.query;
    const n = Math.min(parseInt(limit) || 20, 100);
    return db.prepare('SELECT * FROM music_tracks ORDER BY RANDOM() LIMIT ?').all(n);
  });

  fastify.post(prefix + '/scan', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const results = scanMusicFolder();
    return { success: true, ...results };
  });
}

module.exports = musicRoutes;
module.exports.scanMusicFolder = scanMusicFolder;
