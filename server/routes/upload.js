const { getDb } = require('../db');
const { authMiddleware, adminMiddleware } = require('../auth');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = path.join(__dirname, '..', '..', 'media');

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

async function uploadRoutes(fastify) {
  fastify.post('/api/upload', { preHandler: [authMiddleware, adminMiddleware], bodyLimit: 100 * 1024 * 1024 }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const type = data.fields.type?.value;
    const title = data.fields.title?.value;
    const year = data.fields.year?.value ? parseInt(data.fields.year.value) : null;
    const description = data.fields.description?.value || '';
    const genre = data.fields.genre?.value || '';
    const seasonNumber = data.fields.seasonNumber?.value ? parseInt(data.fields.seasonNumber.value) : null;
    const episodeNumber = data.fields.episodeNumber?.value ? parseInt(data.fields.episodeNumber.value) : null;

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
    const ext = path.extname(data.filename) || '.mp4';
    if (!ALLOWED_EXTENSIONS.includes(ext.toLowerCase())) {
      return reply.status(400).send({ error: `File type ${ext} not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` });
    }
    const safeName = `${id}${ext}`;

    let fileDir;
    let filePath;

    if (type === 'movie') {
      fileDir = path.join(MEDIA_DIR, 'movies');
      filePath = path.join(fileDir, safeName);
    } else {
      fileDir = MEDIA_DIR;
      filePath = path.join(fileDir, safeName);
    }

    fs.mkdirSync(fileDir, { recursive: true });

    const writeStream = fs.createWriteStream(filePath);
    const fileSize = await new Promise((resolve, reject) => {
      let size = 0;
      data.file.on('data', (chunk) => {
        size += chunk.length;
      });
      data.file.on('end', () => resolve(size));
      data.file.on('error', reject);
      data.file.pipe(writeStream);
    });

    if (type === 'movie') {
      db.prepare(
        `INSERT INTO media (id, title, type, description, year, genre, file_path, file_size, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, title.trim(), type, description, year, genre, filePath, fileSize, request.user.id);

      return { media: db.prepare('SELECT * FROM media WHERE id = ?').get(id) };
    }

    if (type === 'series') {
      if (!seasonNumber || !episodeNumber) {
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

      const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
      return { series: db.prepare('SELECT * FROM media WHERE id = ?').get(series.id), episode };
    }
  });
}

module.exports = uploadRoutes;
