const { getDb } = require('../db');
const { optionalAuth } = require('../auth');
const fs = require('fs');

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
      if (request.user) {
        const progress = db.prepare(
          'SELECT progress_seconds, completed FROM watch_progress WHERE user_id = ? AND episode_id = ?'
        ).get(request.user.id, ep.id);
        ep.watchProgress = progress || null;
      }
      seasons[ep.season_number].push(ep);
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
}

module.exports = seriesRoutes;
