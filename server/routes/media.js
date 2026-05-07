const { getDb } = require('../db');
const { authMiddleware, mediaAuth, adminMiddleware } = require('../auth');
const { isWithinDir, isWithinAnyDir, streamVideo, streamHlsFile, MEDIA_DIR, MEDIA_DIRS, getImageMimeType, getSubtitleMimeType, srtToVtt, IMAGE_SIZES } = require('../utils');
const { generateVariant } = require('../imageProcessor');
const path = require('path');
const fs = require('fs');

async function mediaRoutes(fastify) {
  fastify.get('/api/media', { preHandler: authMiddleware }, async (request) => {
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

    for (const item of media) {
      item.hls_available = !!(item.file_path && item.file_path.endsWith('.m3u8'));
    }

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

  fastify.get('/api/media/:id/poster', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT poster_path FROM media WHERE id = ?').get(request.params.id);
    if (!media || !media.poster_path) {
      return reply.status(404).send({ error: 'Poster not found' });
    }

    const size = request.query.size || 'original';
    let filePath = media.poster_path;

    if (size !== 'original') {
      const variant = await generateVariant(filePath, size, 'poster');
      if (variant) filePath = variant;
    }

    if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Poster file not found on disk' });
    }

    reply.headers({
      'Content-Type': getImageMimeType(filePath),
      'Cache-Control': 'public, max-age=86400',
    });
    return fs.createReadStream(filePath);
  });

  fastify.get('/api/media/:id/backdrop', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT backdrop_path FROM media WHERE id = ?').get(request.params.id);
    if (!media || !media.backdrop_path) {
      return reply.status(404).send({ error: 'Backdrop not found' });
    }

    const size = request.query.size || 'original';
    let filePath = media.backdrop_path;

    if (size !== 'original') {
      const variant = await generateVariant(filePath, size, 'backdrop');
      if (variant) filePath = variant;
    }

    if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Backdrop file not found on disk' });
    }

    reply.headers({
      'Content-Type': getImageMimeType(filePath),
      'Cache-Control': 'public, max-age=86400',
    });
    return fs.createReadStream(filePath);
  });

  fastify.get('/api/media/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    media.hls_available = !!(media.file_path && media.file_path.endsWith('.m3u8'));

    if (media.type === 'series') {
      const episodes = db.prepare(
        'SELECT * FROM episodes WHERE series_id = ? ORDER BY season_number, episode_number'
      ).all(media.id);

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

    if (media.type === 'movie') {
      media.subtitles = db.prepare(
        'SELECT id, label, language FROM subtitles WHERE media_id = ? AND episode_id IS NULL'
      ).all(media.id);
      media.audio_tracks = db.prepare(
        'SELECT id, track_index, codec, language, label, channels, default_flag FROM audio_tracks WHERE media_id = ? AND episode_id IS NULL ORDER BY track_index'
      ).all(media.id);
    } else {
      const allEpIds = Object.values(media.seasons || {}).flatMap(s => s.map(e => e.id));
      if (allEpIds.length > 0) {
        const epSubs = db.prepare(
          `SELECT id, episode_id, label, language FROM subtitles WHERE episode_id IN (${allEpIds.map(() => '?').join(',')})`
        ).all(...allEpIds);
        const subMap = {};
        for (const s of epSubs) {
          if (!subMap[s.episode_id]) subMap[s.episode_id] = [];
          subMap[s.episode_id].push({ id: s.id, label: s.label, language: s.language });
        }
        const epAudio = db.prepare(
          `SELECT id, episode_id, track_index, codec, language, label, channels, default_flag FROM audio_tracks WHERE episode_id IN (${allEpIds.map(() => '?').join(',')}) ORDER BY track_index`
        ).all(...allEpIds);
        const audioMap = {};
        for (const a of epAudio) {
          if (!audioMap[a.episode_id]) audioMap[a.episode_id] = [];
          audioMap[a.episode_id].push({ id: a.id, track_index: a.track_index, codec: a.codec, language: a.language, label: a.label, channels: a.channels, default_flag: a.default_flag });
        }
        for (const season of Object.values(media.seasons)) {
          for (const ep of season) {
            ep.subtitles = subMap[ep.id] || [];
            ep.audio_tracks = audioMap[ep.id] || [];
          }
        }
      }
      media.subtitles = [];
      media.audio_tracks = [];
    }

    return { media };
  });

  fastify.get('/api/media/:id/video', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(request.params.id);
    if (!media || media.type !== 'movie' || !media.file_path) {
      return reply.status(404).send({ error: 'Video not found' });
    }

    if (media.transcode_status === 'pending' || media.transcode_status === 'converting') {
      return reply.status(503).send({ error: 'Video is being converted to a compatible format. Please try again shortly.' });
    }

    return streamVideo(request, reply, media.file_path);
  });

  fastify.get('/api/media/:id/hls/*', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(request.params.id);
    if (!media || !media.file_path) {
      return reply.status(404).send({ error: 'HLS not found' });
    }

    const subPath = request.params['*'];
    const hlsDir = path.dirname(media.file_path);
    const filePath = path.join(hlsDir, subPath);

    if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }

    return streamHlsFile(request, reply, filePath);
  });

  fastify.get('/api/media/:id/subtitles', { preHandler: authMiddleware }, async (request) => {
    const db = getDb();
    const media = db.prepare('SELECT id FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }
    const subtitles = db.prepare(
      'SELECT id, label, language FROM subtitles WHERE media_id = ? AND episode_id IS NULL'
    ).all(request.params.id);
    return { subtitles };
  });

  fastify.get('/api/subtitles/:id', { preHandler: mediaAuth }, async (request, reply) => {
    const db = getDb();
    const sub = db.prepare('SELECT * FROM subtitles WHERE id = ?').get(request.params.id);
    if (!sub) {
      return reply.status(404).send({ error: 'Subtitle not found' });
    }

    const filePath = sub.file_path;
    if (!isWithinAnyDir(filePath, MEDIA_DIRS)) {
      return reply.status(403).send({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Subtitle file not found on disk' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');

    if (ext === '.srt') {
      reply.headers({
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      });
      return srtToVtt(content);
    }

    reply.headers({
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    return content;
  });

  fastify.get('/api/media/:id/audio-tracks', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT id FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }
    const tracks = db.prepare(
      'SELECT id, track_index, codec, language, label, channels, default_flag FROM audio_tracks WHERE media_id = ? AND episode_id IS NULL ORDER BY track_index'
    ).all(request.params.id);
    return { audio_tracks: tracks };
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
        if (ep.file_path && isWithinAnyDir(ep.file_path, MEDIA_DIRS) && fs.existsSync(ep.file_path)) {
          fs.unlinkSync(ep.file_path);
          if (ep.file_path.endsWith('.m3u8')) {
            try { fs.rmSync(path.dirname(ep.file_path), { recursive: true, force: true }); } catch {}
          }
        }
      }
    } else if (media.file_path && isWithinAnyDir(media.file_path, MEDIA_DIRS) && fs.existsSync(media.file_path)) {
      fs.unlinkSync(media.file_path);
      if (media.file_path.endsWith('.m3u8')) {
        try { fs.rmSync(path.dirname(media.file_path), { recursive: true, force: true }); } catch {}
      }
    }

    if (media.poster_path && isWithinAnyDir(media.poster_path, MEDIA_DIRS) && fs.existsSync(media.poster_path)) {
      fs.unlinkSync(media.poster_path);
    }
    if (media.backdrop_path && isWithinAnyDir(media.backdrop_path, MEDIA_DIRS) && fs.existsSync(media.backdrop_path)) {
      fs.unlinkSync(media.backdrop_path);
    }

    db.prepare('DELETE FROM watch_parties WHERE media_id = ? OR episode_id IN (SELECT id FROM episodes WHERE series_id = ?)').run(request.params.id, request.params.id);
    db.prepare('DELETE FROM media WHERE id = ?').run(request.params.id);
    return { success: true };
  });
}

module.exports = mediaRoutes;
