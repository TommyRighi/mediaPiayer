const { getDb } = require('../../db');
const { authMiddleware, adminMiddleware } = require('../../auth');
const { MEDIA_DIRS } = require('../../utils');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const { spawnBackground } = require('../../background');

const ytDlpJobs = new Map();

async function youtubeRoutes(fastify) {

  fastify.post('/youtube/download', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const { url, title, artist } = request.body;
    if (!url) return reply.status(400).send({ error: 'URL is required' });

    if (typeof url !== 'string' || url.length > 2000) {
      return reply.status(400).send({ error: 'Invalid URL' });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reply.status(400).send({ error: 'Invalid URL format' });
    }

    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.port || !['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(parsedUrl.hostname)) {
      return reply.status(400).send({ error: 'Only official HTTPS YouTube URLs are allowed' });
    }

    const id = nanoid();
    const db = getDb();
    db.prepare(
      'INSERT INTO youtube_downloads (id, user_id, url, title, artist, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, request.user.id, url, title || '', artist || '', 'downloading');

    const musicDir = path.join(MEDIA_DIRS[0], 'music', 'youtube');
    fs.mkdirSync(musicDir, { recursive: true });

    const outputPath = path.join(musicDir, `${id}.mp3`);

    const job = { id, url, outputPath, status: 'downloading', progress: 0 };
    ytDlpJobs.set(id, job);

    (async () => {
    const ytDlp = await spawnBackground('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--output', outputPath,
      '--newline',
      '--no-playlist',
      url,
    ]);

    ytDlp.stdout.on('data', (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch) {
        job.progress = parseFloat(progressMatch[1]);
        if (Date.now() - (job.lastSaved || 0) >= 10000) {
          db.prepare('UPDATE youtube_downloads SET progress = ? WHERE id = ?').run(job.progress, id);
          job.lastSaved = Date.now();
        }
      }
    });

    ytDlp.stderr.on('data', () => {});

    ytDlp.on('close', (code) => {
      if (code === 0) {
        let finalPath = outputPath;
        if (!fs.existsSync(outputPath)) {
          const altPath = outputPath.replace(/\.mp3$/, '.webm');
          if (fs.existsSync(altPath)) finalPath = altPath;
        }

        if (fs.existsSync(finalPath)) {
          const stat = fs.statSync(finalPath);
          const trackTitle = title || db.prepare('SELECT title FROM youtube_downloads WHERE id = ?').get(id).title || 'Unknown Track';
          const trackArtist = artist || db.prepare('SELECT artist FROM youtube_downloads WHERE id = ?').get(id).artist || '';

          const trackId = nanoid();
          db.prepare(
            'INSERT INTO music_tracks (id, track_number, title, artist, file_path, file_size) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(trackId, 0, trackTitle, trackArtist, finalPath, stat.size);

          db.prepare('UPDATE youtube_downloads SET status=?, progress=100, file_path=?, track_id=? WHERE id=?')
            .run('completed', finalPath, trackId, id);
          job.status = 'completed';
          job.trackId = trackId;
        } else {
          db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', 'Output file not found', id);
          job.status = 'failed';
        }
      } else {
        db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', `yt-dlp exited with code ${code}`, id);
        job.status = 'failed';
      }
      ytDlpJobs.delete(id);
    });

    ytDlp.on('error', err => {
      db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', err.message, id);
      ytDlpJobs.delete(id);
    });
    })().catch(err => {
      db.prepare('UPDATE youtube_downloads SET status=?, error=? WHERE id=?').run('failed', err.message, id);
      ytDlpJobs.delete(id);
    });
    return { id, status: 'downloading' };
  });

  fastify.get('/youtube/status/:id', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const db = getDb();
    const dl = db.prepare('SELECT * FROM youtube_downloads WHERE id = ?').get(request.params.id);
    if (!dl) return reply.status(404).send({ error: 'Download not found' });
    const job = ytDlpJobs.get(request.params.id);
    const reason = require('../../background').pauseReason();
    return { ...dl, status: job && reason ? 'paused' : dl.status, reason, progress: job ? job.progress : dl.progress };
  });

  fastify.get('/youtube/downloads', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM youtube_downloads ORDER BY created_at DESC LIMIT 50').all();
  });
}

module.exports = youtubeRoutes;
