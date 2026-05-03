const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const statik = require('@fastify/static');
const websocket = require('@fastify/websocket');
const rateLimit = require('@fastify/rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const seriesRoutes = require('./routes/series');
const uploadRoutes = require('./routes/upload');
const watchRoutes = require('./routes/watch');
const partyRoutes = require('./routes/parties');
const adminRoutes = require('./routes/admin');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
  bodyLimit: 1 * 1024 * 1024,
});

async function start() {
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  const corsOrigin = process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || false)
    : true;
  await fastify.register(cors, { origin: corsOrigin });
  await fastify.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await fastify.register(websocket);

  await fastify.register(statik, {
    root: path.join(__dirname, 'dist'),
    prefix: '/',
    decorateReply: false,
  });

  fastify.setNotFoundHandler((request, reply) => {
    const ext = path.extname(request.url);
    if (!ext || ['.js', '.css', '.png', '.jpg', '.svg', '.ico'].includes(ext)) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  await fastify.register(authRoutes);
  await fastify.register(mediaRoutes);
  await fastify.register(seriesRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(watchRoutes);
  await fastify.register(partyRoutes);
  await fastify.register(adminRoutes);

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Server running at http://${HOST}:${PORT}`);
}

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
