const { getDb } = require('../db');
const { authMiddleware } = require('../auth');
const { nanoid } = require('nanoid');

async function watchRoutes(fastify) {
  fastify.post('/api/watch/progress', { preHandler: authMiddleware }, async (request, reply) => {
    const { mediaId, episodeId, seconds, completed, duration } = request.body || {};

    if (!mediaId) {
      return reply.status(400).send({ error: 'mediaId is required' });
    }

    const db = getDb();

    if (duration && duration > 0) {
      if (episodeId) {
        const ep = db.prepare('SELECT duration FROM episodes WHERE id = ?').get(episodeId);
        if (ep && (!ep.duration || ep.duration === 0)) {
          db.prepare('UPDATE episodes SET duration = ? WHERE id = ?').run(Math.floor(duration), episodeId);
        }
      } else {
        const media = db.prepare('SELECT duration FROM media WHERE id = ?').get(mediaId);
        if (media && (!media.duration || media.duration === 0)) {
          db.prepare('UPDATE media SET duration = ? WHERE id = ?').run(Math.floor(duration), mediaId);
        }
      }
    }

    const existing = db.prepare(
      'SELECT id FROM watch_progress WHERE user_id = ? AND media_id = ? AND (episode_id = ? OR (? IS NULL AND episode_id IS NULL))'
    ).get(request.user.id, mediaId, episodeId || null, episodeId || null);

    if (existing) {
      db.prepare(
        'UPDATE watch_progress SET progress_seconds = ?, completed = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).run(seconds || 0, completed ? 1 : 0, existing.id);
    } else {
      db.prepare(
        'INSERT INTO watch_progress (id, user_id, media_id, episode_id, progress_seconds, completed) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(nanoid(), request.user.id, mediaId, episodeId || null, seconds || 0, completed ? 1 : 0);
    }

    return { success: true };
  });

  fastify.get('/api/watch/history', { preHandler: authMiddleware }, async (request) => {
    const db = getDb();

    const progress = db.prepare(
      `SELECT wp.*, m.title, m.type, m.poster_path, m.backdrop_path, e.title AS episode_title, e.season_number, e.episode_number
       FROM watch_progress wp
       JOIN media m ON wp.media_id = m.id
       LEFT JOIN episodes e ON wp.episode_id = e.id
       WHERE wp.user_id = ?
       ORDER BY wp.updated_at DESC
       LIMIT 50`
    ).all(request.user.id);

    return { history: progress };
  });
}

module.exports = watchRoutes;
