const { authMiddleware } = require('../auth');
const { getStatus } = require('../transcode');

async function transcodeRoutes(fastify) {
  fastify.get('/api/transcode/status/:mediaId', { preHandler: authMiddleware }, async (request, reply) => {
    const { episodeId } = request.query;
    const status = getStatus(request.params.mediaId, episodeId || null);
    if (!status) {
      const db = require('../db').getDb();
      const row = episodeId ? db.prepare('SELECT transcode_status FROM episodes WHERE id = ? AND series_id = ?').get(episodeId, request.params.mediaId) : db.prepare('SELECT transcode_status FROM media WHERE id = ?').get(request.params.mediaId);
      const reason = require('../background').pauseReason();
      return { status: reason && ['pending', 'converting'].includes(row?.transcode_status) ? 'paused' : row?.transcode_status || 'none', progress: 0, reason };
    }
    return status;
  });
}

module.exports = transcodeRoutes;
