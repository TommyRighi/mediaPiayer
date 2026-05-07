const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const { needsTranscoding, enqueue } = require('../transcode');
const { MEDIA_DIR, pickBestMediaDir } = require('../utils');
const { generateAllVariants } = require('../imageProcessor');
const { extractAndStoreAll } = require('../track-extractor');

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function estimateFileSize(request) {
  const contentLength = request.headers['content-length'];
  if (contentLength) {
    const parsed = parseInt(contentLength, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function uploadRoutes(fastify) {
  fastify.post('/api/upload', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 5 * 1024 * 1024 * 1024 }, async (request, reply) => {
    const fields = {};
    let fileData = null;

    for await (const part of request.parts()) {
      if (part.file) {
        fileData = part;
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileData) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const type = fields.type;
    const title = fields.title;
    const year = fields.year ? parseInt(fields.year) : null;
    const description = fields.description || '';
    const genre = fields.genre || '';
    const seasonNumber = fields.seasonNumber ? parseInt(fields.seasonNumber) : null;
    const episodeNumber = fields.episodeNumber ? parseInt(fields.episodeNumber) : null;

    if (!type || !title) {
      return reply.status(400).send({ error: 'type and title are required fields' });
    }

    if (title.trim().length > 200) {
      return reply.status(400).send({ error: 'Title must be 200 characters or fewer' });
    }

    if (!['movie', 'series'].includes(type)) {
      return reply.status(400).send({ error: 'type must be either movie or series' });
    }

    const db = getDb();
    const id = nanoid();
    const ext = path.extname(fileData.filename) || '.mp4';
    if (!ALLOWED_EXTENSIONS.includes(ext.toLowerCase())) {
      return reply.status(400).send({ error: `File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` });
    }
    const safeName = `${id}${ext}`;

    const estimated = estimateFileSize(request);
    let fileDir;
    let filePath;

    if (type === 'movie') {
      const baseDir = estimated !== null
        ? pickBestMediaDir(estimated, 'movies')
        : MEDIA_DIR;
      fileDir = path.join(baseDir, 'movies');
      filePath = path.join(fileDir, safeName);
    } else {
      const safeTitle = title.trim().replace(/[^a-zA-Z0-9]/g, '_');
      const baseDir = estimated !== null
        ? pickBestMediaDir(estimated, path.join('series', safeTitle))
        : MEDIA_DIR;
      fileDir = path.join(baseDir, 'series', safeTitle);
      filePath = path.join(fileDir, safeName);
    }

    fs.mkdirSync(fileDir, { recursive: true });
    const writeStream = fs.createWriteStream(filePath);
    const fileSize = await new Promise((resolve, reject) => {
      let size = 0;
      fileData.file.on('data', (chunk) => {
        size += chunk.length;
      });
      fileData.file.on('end', () => resolve(size));
      fileData.file.on('error', reject);
      writeStream.on('error', reject);
      fileData.file.pipe(writeStream);
    });

    function cleanup() {
      try { fs.unlinkSync(filePath); } catch {}
    }

    try {
      if (type === 'movie') {
        db.prepare(
          `INSERT INTO media (id, title, type, description, year, genre, file_path, file_size, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, title.trim(), type, description, year, genre, filePath, fileSize, request.user.id);

        extractAndStoreAll(filePath, id, null).catch(() => {});

        if (needsTranscoding(filePath)) {
          db.prepare('UPDATE media SET transcode_status = ? WHERE id = ?').run('pending', id);
          enqueue('movie', id);
        }

        return { media: db.prepare('SELECT * FROM media WHERE id = ?').get(id) };
      }

      if (type === 'series') {
        if (!seasonNumber || !episodeNumber) {
          cleanup();
          return reply.status(400).send({ error: 'seasonNumber and episodeNumber are required for series' });
        }

        let series = db.prepare('SELECT id FROM media WHERE title = ? AND type = ?').get(title.trim(), 'series');
        if (!series) {
          const seriesId = nanoid();
          db.prepare(
            'INSERT INTO media (id, title, type, description, year, genre, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(seriesId, title.trim(), 'series', description, year, genre, request.user.id);
          series = { id: seriesId };
        }

        const episodeId = nanoid();
        db.prepare(
          `INSERT INTO episodes (id, series_id, season_number, episode_number, title, file_path, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(episodeId, series.id, seasonNumber, episodeNumber, `Episode ${episodeNumber}`, filePath, fileSize);

        extractAndStoreAll(filePath, null, episodeId).catch(() => {});

        if (needsTranscoding(filePath)) {
          db.prepare('UPDATE episodes SET transcode_status = ? WHERE id = ?').run('pending', episodeId);
          enqueue('episode', episodeId);
        }

        const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
        return { series: db.prepare('SELECT * FROM media WHERE id = ?').get(series.id), episode };
      }
    } catch (err) {
      cleanup();
      throw err;
    }
  });

  fastify.post('/api/media/:id/image', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT id, poster_path, backdrop_path FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    let imageType = null;
    let fileData = null;

    for await (const part of request.parts()) {
      if (part.file) {
        fileData = part;
      } else if (part.fieldname === 'type') {
        imageType = part.value;
      }
    }

    if (!fileData) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (!['poster', 'backdrop'].includes(imageType)) {
      return reply.status(400).send({ error: 'type must be poster or backdrop' });
    }

    const ext = path.extname(fileData.filename) || '.jpg';
    if (!IMAGE_EXTENSIONS.includes(ext.toLowerCase())) {
      return reply.status(400).send({ error: `File type ${ext} not allowed for images. Allowed: ${IMAGE_EXTENSIONS.join(', ')}` });
    }

    const estimated = estimateFileSize(request);
    const baseDir = estimated !== null
      ? pickBestMediaDir(estimated, 'posters')
      : MEDIA_DIR;
    const fileDir = path.join(baseDir, 'posters');
    const fileName = `${media.id}-${imageType}${ext}`;
    const filePath = path.join(fileDir, fileName);

    const writeStream = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      writeStream.on('error', reject);
      fileData.file.on('end', resolve);
      fileData.file.on('error', reject);
      fileData.file.pipe(writeStream);
    });

    const column = imageType === 'poster' ? 'poster_path' : 'backdrop_path';
    db.prepare(`UPDATE media SET ${column} = ? WHERE id = ?`).run(filePath, media.id);

    generateAllVariants(filePath, imageType);

    return { media: db.prepare('SELECT * FROM media WHERE id = ?').get(media.id) };
  });

  fastify.post('/api/media/:id/subtitles/upload', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 5 * 1024 * 1024 }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT id, type FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    const fields = {};
    let fileData = null;

    for await (const part of request.parts()) {
      if (part.file) {
        fileData = part;
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileData) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const language = fields.language || 'en';
    const label = fields.label || language;
    const episodeId = fields.episodeId || null;

    const ext = path.extname(fileData.filename) || '.srt';
    if (!['.srt', '.vtt'].includes(ext.toLowerCase())) {
      return reply.status(400).send({ error: 'File type not allowed for subtitles. Allowed: .srt, .vtt' });
    }

    const estimated = estimateFileSize(request);
    const baseDir = estimated !== null
      ? pickBestMediaDir(estimated, 'subtitles')
      : MEDIA_DIR;
    const fileDir = path.join(baseDir, 'subtitles');
    const subId = nanoid();
    const fileName = `${subId}${ext}`;
    const filePath = path.join(fileDir, fileName);

    const writeStream = fs.createWriteStream(filePath);
    await new Promise((resolve, reject) => {
      writeStream.on('error', reject);
      fileData.file.on('end', resolve);
      fileData.file.on('error', reject);
      fileData.file.pipe(writeStream);
    });

    db.prepare(
      'INSERT INTO subtitles (id, media_id, episode_id, label, language, file_path) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(subId, media.id, episodeId, label, language, filePath);

    return { subtitle: { id: subId, label, language } };
  });
}

module.exports = uploadRoutes;
