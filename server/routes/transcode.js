const { authMiddleware, optionalAuth } = require('../auth');
const { getStatus } = require('../transcode');

async function transcodeRoutes(fastify) {
  fastify.get('/api/transcode/status/:mediaId', { preHandler: optionalAuth }, async (request, reply) => {
    const { episodeId } = request.query;
    const status = getStatus(request.params.mediaId, episodeId || null);
    if (!status) {
      return { status: 'none' };
    }
    return status;
  });
}

module.exports = transcodeRoutes;
