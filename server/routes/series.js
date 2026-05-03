const { getDb } = require('../db');
const { optionalAuth } = require('../auth');
const { isWithinDir } = require('../utils');
const fs = require('fs');
const path = require('path');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

async function seriesRoutes(fastify) {
  fastify.get('/api/series/:id/episodes', { preHandler: optionalAuth }, async (request, reply) => {
    const db = getDb();
    const series = db.prepare('SELECT * FROM media WHERE id = ? AND type = ?').get(request.params.id, 'series');
    if (!series) {
      return reply.status(404).send({ error: 'Series not found' });
    }

    const episodes = db.prepare(
      'SELECT * FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number'
    ).all(series.id);

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
         WHERE user_id = ? AND episode_id IN (${epIds.map(() => '?').join(',')})`
      ).all(request.user.id, ...epIds);
      const progressByEp = {};
      for (const p of progressRows) {
        progressByEp[p.episode_id] = { progress_seconds: p.progress_seconds, completed: p.completed };
      }
      for (const ep of episodes) {
        ep.watchProgress = progressByEp[ep.id] || null;
      }
    }

    return { series, seasons };
  });

  fastify.get('/api/episodes/:id/video', { preHandler: optionalAuth }, async (request, reply) => {
    const db = getDb();
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(request.params.id);
    if (!episode || !episode.file_path) {
      return reply.status(404).send({ error: 'Episode not found' });
    }

    const filePath = episode.file_path;
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
}

module.exports = seriesRoutes;
