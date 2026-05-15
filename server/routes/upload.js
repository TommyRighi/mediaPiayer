const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { needsTranscoding, enqueue } = require('../transcode');
const { MEDIA_DIR, MEDIA_DIRS, pickBestMediaDir, isWithinAnyDir } = require('../utils');
const { generateAllVariants } = require('../imageProcessor');
const { extractAndStoreAll } = require('../track-extractor');

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

function estimateFileSize(request) {
  const contentLength = request.headers['content-length'];
  if (contentLength) {
    const parsed = parseInt(contentLength, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function removeImageWithVariants(filePath) {
  if (!filePath || !isWithinAnyDir(filePath, MEDIA_DIRS)) return;
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(`${base}-sm`) || file.startsWith(`${base}-md`)) {
        try { fs.unlinkSync(path.join(dir, file)); } catch {}
      }
    }
  } catch {}
}

function writePartToPath(filePart, filePath) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    let size = 0;

    filePart.file.on('data', (chunk) => {
      size += chunk.length;
    });
    filePart.file.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', () => resolve(size));

    filePart.file.pipe(writeStream);
  });
}

async function uploadRoutes(fastify) {
  fastify.post('/api/upload', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 5 * 1024 * 1024 * 1024 }, async (request, reply) => {
    const fields = {};
    let fileData = null;
    let tempFilePath = null;
    let writtenSize = null;

    const estimated = estimateFileSize(request);

    for await (const part of request.parts()) {
      if (part.file) {
        const ext = path.extname(part.filename) || '.mp4';
        tempFilePath = path.join(MEDIA_DIR, `upload-${Date.now()}-${nanoid()}${ext}`);
        writtenSize = await writePartToPath(part, tempFilePath);
        fileData = { filename: part.filename, mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileData || !tempFilePath) {
      if (tempFilePath) { try { fs.unlinkSync(tempFilePath); } catch {} }
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
      try { fs.unlinkSync(tempFilePath); } catch {}
      return reply.status(400).send({ error: 'type and title are required fields' });
    }

    if (title.trim().length > 200) {
      try { fs.unlinkSync(tempFilePath); } catch {}
      return reply.status(400).send({ error: 'Title must be 200 characters or fewer' });
    }

    if (!['movie', 'series'].includes(type)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
      return reply.status(400).send({ error: 'type must be either movie or series' });
    }

    const db = getDb();
    const id = nanoid();
    const ext = path.extname(fileData.filename) || '.mp4';
    if (!ALLOWED_EXTENSIONS.includes(ext.toLowerCase())) {
      try { fs.unlinkSync(tempFilePath); } catch {}
      return reply.status(400).send({ error: `File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` });
    }
    const safeName = `${id}${ext}`;

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
    fs.renameSync(tempFilePath, filePath);
    const fileSize = writtenSize;

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
          try { fs.unlinkSync(filePath); } catch {}
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
      try { fs.unlinkSync(filePath); } catch {}
      throw err;
    }
  });

  fastify.post('/api/media/:id/image', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const db = getDb();
    const media = db.prepare('SELECT id, poster_path, backdrop_path FROM media WHERE id = ?').get(request.params.id);
    if (!media) {
      return reply.status(404).send({ error: 'Media not found' });
    }

    const estimated = estimateFileSize(request);
    const baseDir = estimated !== null
      ? pickBestMediaDir(estimated, 'posters')
      : MEDIA_DIR;
    const fileDir = path.join(baseDir, 'posters');
    fs.mkdirSync(fileDir, { recursive: true });

    let imageType = null;
    let tempPath = null;
    let fileMimeType = null;

    for await (const part of request.parts()) {
      if (part.file) {
        tempPath = path.join(fileDir, `${media.id}-upload-${Date.now()}`);
        fileMimeType = part.mimetype;
        await writePartToPath(part, tempPath);
      } else if (part.fieldname === 'type') {
        imageType = part.value;
      }
    }

    if (!tempPath) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (!['poster', 'backdrop'].includes(imageType)) {
      try { fs.unlinkSync(tempPath); } catch {}
      return reply.status(400).send({ error: 'type must be poster or backdrop' });
    }

    if (!fileMimeType || !fileMimeType.toLowerCase().startsWith('image/')) {
      try { fs.unlinkSync(tempPath); } catch {}
      return reply.status(400).send({ error: 'Uploaded file must be an image' });
    }

    let filePath = path.join(fileDir, `${media.id}-${imageType}.webp`);
    try {
      if (fileMimeType.toLowerCase() === 'image/gif') {
        filePath = path.join(fileDir, `${media.id}-${imageType}.gif`);
        fs.renameSync(tempPath, filePath);
      } else {
        await sharp(tempPath)
          .rotate()
          .webp({ quality: 85 })
          .toFile(filePath);
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      try { fs.unlinkSync(tempPath); } catch {}
      return reply.status(400).send({ error: 'Invalid or unsupported image format' });
    }

    const column = imageType === 'poster' ? 'poster_path' : 'backdrop_path';
    const previousPath = imageType === 'poster' ? media.poster_path : media.backdrop_path;
    db.prepare(`UPDATE media SET ${column} = ? WHERE id = ?`).run(filePath, media.id);
    if (previousPath && previousPath !== filePath) {
      removeImageWithVariants(previousPath);
    }

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
    let tempFilePath = null;
    let writtenSize = null;

    const estimated = estimateFileSize(request);

    for await (const part of request.parts()) {
      if (part.file) {
        const ext = path.extname(part.filename) || '.srt';
        tempFilePath = path.join(MEDIA_DIR, `sub-upload-${Date.now()}-${nanoid()}${ext}`);
        writtenSize = await writePartToPath(part, tempFilePath);
        fileData = { filename: part.filename, mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileData || !tempFilePath) {
      if (tempFilePath) { try { fs.unlinkSync(tempFilePath); } catch {} }
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const language = fields.language || 'en';
    const label = fields.label || language;
    const episodeId = fields.episodeId || null;

    const ext = path.extname(fileData.filename) || '.srt';
    if (!['.srt', '.vtt'].includes(ext.toLowerCase())) {
      try { fs.unlinkSync(tempFilePath); } catch {}
      return reply.status(400).send({ error: 'File type not allowed for subtitles. Allowed: .srt, .vtt' });
    }

    const baseDir = estimated !== null
      ? pickBestMediaDir(estimated, 'subtitles')
      : MEDIA_DIR;
    const fileDir = path.join(baseDir, 'subtitles');
    fs.mkdirSync(fileDir, { recursive: true });
    const subId = nanoid();
    const fileName = `${subId}${ext}`;
    const filePath = path.join(fileDir, fileName);

    fs.renameSync(tempFilePath, filePath);

    db.prepare(
      'INSERT INTO subtitles (id, media_id, episode_id, label, language, file_path) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(subId, media.id, episodeId, label, language, filePath);

    return { subtitle: { id: subId, label, language } };
  });
}

module.exports = uploadRoutes;