const { authMiddleware, adminMiddleware } = require('../auth');
const { isAvailable, checkAvailable, validateMagnetUri, addMagnet, getDownloadStatus, cancelDownload, listDownloads } = require('../transmission');

async function downloadRoutes(fastify) {
  fastify.post('/api/downloads', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const { title, magnetUri } = request.body || {};
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || !validateMagnetUri(magnetUri)) {
      return reply.code(400).send({ error: 'Enter a title and a valid magnet link with a 40-character torrent hash.' });
    }
    if (!await checkAvailable()) return reply.code(503).send({ error: 'Transmission is not available on this server.' });
    const { nanoid } = await import('nanoid');
    const mediaId = nanoid();
    const db = require('../db').getDb();
    db.prepare('INSERT INTO media (id,title,type) VALUES (?,?,?)').run(mediaId, title.trim(), 'movie');
    try {
      const result = await addMagnet(magnetUri, mediaId, request.user.id);
      return reply.code(201).send({ ...result, mediaId });
    } catch (err) {
      db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
      return reply.code(409).send({ error: err.message });
    }
  });
  fastify.post('/api/media/:id/download', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    const { magnetUri } = request.body || {};

    if (!magnetUri || typeof magnetUri !== 'string') {
      return reply.status(400).send({ error: 'magnetUri is required' });
    }

    if (!validateMagnetUri(magnetUri)) {
      return reply.status(400).send({ error: 'Invalid magnet URI format. Only magnet:?xt=urn:btih:<40-char-hex-hash> is supported.' });
    }

    const available = await checkAvailable();
    if (!available) {
      return reply.status(503).send({ error: 'Transmission daemon is not available' });
    }

    try {
      const result = await addMagnet(magnetUri, request.params.id, request.user.id);
      return result;
    } catch (err) {
      if (err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      if (err.message.includes('already in progress')) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/api/media/:id/download', { preHandler: [authMiddleware, adminMiddleware] }, async (request) => {
    const available = await checkAvailable();
    const download = await getDownloadStatus(request.params.id);

    return {
      available,
      download: download ? {
        id: download.id,
        magnetUri: download.magnet_uri,
        status: download.status,
        progress: download.progress,
        error: download.error,
        createdAt: download.created_at,
      } : null,
    };
  });

  fastify.delete('/api/media/:id/download', { preHandler: [authMiddleware, adminMiddleware] }, async (request, reply) => {
    try {
      const result = await cancelDownload(request.params.id);
      return result;
    } catch (err) {
      if (err.message.includes('No active download')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(409).send({ error: err.message });
    }
  });

  fastify.get('/api/downloads', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const downloads = await listDownloads();
    return {
      configured: isAvailable(),
      available: await checkAvailable(),
      downloads: downloads.map(d => ({
        id: d.id,
        mediaId: d.media_id,
        title: d.title,
        type: d.type,
        magnetUri: d.magnet_uri,
        status: d.status,
        progress: d.progress,
        error: d.error,
        createdAt: d.created_at,
      })),
    };
  });
}

module.exports = downloadRoutes;
