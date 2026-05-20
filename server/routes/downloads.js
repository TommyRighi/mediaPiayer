const { authMiddleware, adminMiddleware } = require('../auth');
const { isAvailable, checkAvailable, validateMagnetUri, addMagnet, getDownloadStatus, cancelDownload, listDownloads } = require('../transmission');

async function downloadRoutes(fastify) {
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

  fastify.get('/api/media/:id/download', { preHandler: [authMiddleware] }, async (request) => {
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
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/api/downloads', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const downloads = await listDownloads();
    return {
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