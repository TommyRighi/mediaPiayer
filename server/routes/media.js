const { getDb } = require('../db');
const { authMiddleware, optionalAuth, adminMiddleware } = require('../auth');
const { isWithinDir } = require('../utils');
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

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

    if (request.user && media.length > 0) {
      const movieIds = media.filter(m => m.type === 'movie').map(m => m.id);
      if (movieIds.length > 0) {
        const progressMap = getDb().prepare(
          `SELECT media_id, progress_seconds, completed FROM watch_progress
           WHERE user_id = ? AND media_id IN (${movieIds.map(() => '?').join(',')}) AND episode_id IS NULL`
        ).all(request.user.id, ...movieIds);
        const progressByMedia = {};
        for (const p of progressMap) {
          progressByMedia[p.media_id] = { progress_seconds: p.progress_seconds, completed: p.completed };
        }
        for (const item of media) {
          if (item.type === 'movie') {
            item.watchProgress = progressByMedia[item.id] || null;
          }
        }
      }
    }

    return { media };
  });

  fastify.get('/api/media/:id/poster', { preHandler: optionalAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT poster_path FROM media WHERE id = ?').get(request.params.id);
    if (!media || !media.poster_path) {
      return reply.status(404).send({ error: 'Poster not found' });
    }

    const filePath = media.poster_path;
    if (!isWithinDir(filePath, MEDIA_DIR)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Poster file not found on disk' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    reply.headers({
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    });
    return fs.createReadStream(filePath);
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
        seasons[ep.season_number].push(ep);
      }

      if (request.user && episodes.length > 0) {
        const epIds = episodes.map(ep => ep.id);
        const progressRows = db.prepare(
          `SELECT episode_id, progress_seconds, completed FROM watch_progress
           WHERE user_id = ? AND media_id = ? AND episode_id IN (${epIds.map(() => '?').join(',')})`
        ).all(request.user.id, media.id, ...epIds);
        const progressByEp = {};
        for (const p of progressRows) {
          progressByEp[p.episode_id] = { progress_seconds: p.progress_seconds, completed: p.completed };
        }
        for (const ep of episodes) {
          ep.watchProgress = progressByEp[ep.id] || null;
        }
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
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return reply.status(416).headers({ 'Content-Range': `bytes */${fileSize}` }).send({ error: 'Invalid range' });
      }
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
