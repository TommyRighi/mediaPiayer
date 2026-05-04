const { getDb } = require('../db');
const { optionalAuth } = require('../auth');
const { streamVideo, MEDIA_DIR, isWithinDir, srtToVtt } = require('../utils');
const path = require('path');
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

    return streamVideo(request, reply, episode.file_path);
  });

  fastify.get('/api/episodes/:id/subtitles', { preHandler: optionalAuth }, async (request) => {
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
