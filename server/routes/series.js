const { getDb } = require('../db');
const { authMiddleware, mediaAuth } = require('../auth');
const { streamVideo, streamHlsFile, isWithinAnyDir, MEDIA_DIRS } = require('../utils');
const path = require('path');
const fs = require('fs');

async function seriesRoutes(fastify) {
  fastify.get('/api/series/:id/episodes', { preHandler: authMiddleware }, async (request, reply) => {
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
      ep.hls_available = !!(ep.file_path && ep.file_path.endsWith('.m3u8'));
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

  fastify.get('/api/episodes/:id/video', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(request.params.id);
    if (!episode || !episode.file_path) {
      return reply.status(404).send({ error: 'Episode not found' });
    }

    if (episode.transcode_status === 'pending' || episode.transcode_status === 'converting') {
      return reply.status(503).send({ error: 'Video is being converted to a compatible format. Please try again shortly.' });
    }

    return streamVideo(request, reply, episode.file_path);
  });

  fastify.get('/api/episodes/:id/hls/*', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const episode = db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(request.params.id);
    if (!episode || !episode.file_path) {
      return reply.status(404).send({ error: 'HLS not found' });
    }

    const subPath = request.params['*'];
    const hlsDir = path.dirname(episode.file_path);
    const filePath = path.join(hlsDir, subPath);

    if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }

    return streamHlsFile(request, reply, filePath);
  });

  fastify.get('/api/episodes/:id/subtitles', { preHandler: authMiddleware }, async (request) => {
    const db = getDb();
    const episode = db.prepare('SELECT id FROM episodes WHERE id = ?').get(request.params.id);
    if (!episode) {
      return reply.status(404).send({ error: 'Episode not found' });
    }
    const subtitles = db.prepare(
      'SELECT id, label, language FROM subtitles WHERE episode_id = ?'
    ).all(request.params.id);
    return { subtitles };
  });
}

module.exports = seriesRoutes;
