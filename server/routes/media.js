const { getDb } = require('../db');
const { authMiddleware, optionalAuth, adminMiddleware } = require('../auth');
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

function isWithinDir(filePath, dir) {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

async function mediaRoutes(fastify) {
  fastify.get('/api/media', { preHandler: optionalAuth }, async (request) => {
    const { type, genre, search } = request.query;
    const db = getDb();

    let sql = 'SELECT * FROM media WHERE 1=1';
    const params = [];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (genre) {
      sql += ' AND genre LIKE ?';
      params.push(`%${genre}%`);
    }
    if (search) {
      sql += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY created_at DESC';
    const media = db.prepare(sql).all(...params);

    if (request.user) {
      for (const item of media) {
        if (item.type === 'movie') {
          const progress = db.prepare(
            'SELECT progress_seconds, completed FROM watch_progress WHERE user_id = ? AND media_id = ?'
          ).get(request.user.id, item.id);
          item.watchProgress = progress || null;
        }
      }
    }

    return { media };
  });

  fastify.get('/api/media/:id', { preHandler: optionalAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    if (media.type === 'series') {
      const episodes = db.prepare(
        'SELECT * FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number'
      ).all(media.id);

      const seasons = {};
      for (const ep of episodes) {
        if (!seasons[ep.season_number]) {
          seasons[ep.season_number] = [];
        }
        if (request.user) {
          const progress = db.prepare(
            'SELECT progress_seconds, completed FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id = ?'
          ).get(request.user.id, media.id, ep.id);
          ep.watchProgress = progress || null;
        }
        seasons[ep.season_number].push(ep);
      }
      media.seasons = seasons;
    }

    if (request.user) {
      const progress = db.prepare(
        'SELECT progress_seconds, completed FROM watch_progress WHERE user_id = ? AND media_id = ? AND episode_id IS NULL'
      ).get(request.user.id, media.id);
      media.watchProgress = progress || null;
    }

    return { media };
  });

  fastify.get('/api/media/:id/video', { preHandler: optionalAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media || media.type !== 'movie' || !media.file_path) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    const filePath = media.file_path;
    if (!isWithinDir(filePath, MEDIA_DIR)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Video file not found on disk' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      reply.status(206).headers({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });

      return fs.createReadStream(filePath, { start, end });
    }

    reply.headers({
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });

    return fs.createReadStream(filePath);
  });

  fastify.patch('/api/media/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    const updates = {};
    const fields = ['title', 'description', 'year', 'genre'];
    const maxLengths = { title: 200, description: 2000, genre: 100 };
    for (const field of fields) {
      if (request.body[field] !== undefined) {
        if (maxLengths[field] && String(request.body[field]).length > maxLengths[field]) {
          return reply.status(400).send({ error: `${field} must be ${maxLengths[field]} characters or fewer` });
        }
        updates[field] = request.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    db.prepare(`UPDATE media SET ${setClauses} WHERE id = ?`).run(...values, request.params.id);

    const updated = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    return { media: updated };
  });

  fastify.delete('/api/media/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    if (media.type === 'series') {
      const episodes = db.prepare('SELECT file_path FROM episodes WHERE series_id = ?').all(media.id);
      for (const ep of episodes) {
        if (ep.file_path && isWithinDir(ep.file_path, MEDIA_DIR) && fs.existsSync(ep.file_path)) {
          fs.unlinkSync(ep.file_path);
        }
      }
    } else if (media.file_path && isWithinDir(media.file_path, MEDIA_DIR) && fs.existsSync(media.file_path)) {
      fs.unlinkSync(media.file_path);
    }

    if (media.poster_path && isWithinDir(media.poster_path, MEDIA_DIR) && fs.existsSync(media.poster_path)) {
      fs.unlinkSync(media.poster_path);
    }
    if (media.backdrop_path && isWithinDir(media.backdrop_path, MEDIA_DIR) && fs.existsSync(media.backdrop_path)) {
      fs.unlinkSync(media.backdrop_path);
    }

    db.prepare('DELETE FROM media WHERE id = ?').run(request.params.id);
    return { success: true };
  });
}

module.exports = mediaRoutes;
