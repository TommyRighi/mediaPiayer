const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const statik = require('@fastify/static');
const websocket = require('@fastify/websocket');
const rateLimit = require('@fastify/rate-limit');

const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const seriesRoutes = require('./routes/series');
const uploadRoutes = require('./routes/upload');
const watchRoutes = require('./routes/watch');
const partyRoutes = require('./routes/parties');
const adminRoutes = require('./routes/admin');
const transcodeRoutes = require('./routes/transcode');
const { MEDIA_DIRS } = require('./utils');
const { getDb } = require('./db');
const { resumePendingJobs } = require('./transcode');

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
  bodyLimit: 5 * 1024 * 1024 * 1024,
});

async function start() {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (request) => {
      const url = request.url;
      return url.includes('/video') || url.includes('/poster') ||
             url.includes('/backdrop') || url.includes('/subtitles') ||
             url.startsWith('/assets/');
    },
  });
  const corsOrigin = process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || false)
    : true;
  await fastify.register(cors, { origin: corsOrigin });
  await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
  await fastify.register(websocket);

  await fastify.register(statik, {
    root: path.join(__dirname, 'dist'),
    prefix: '/',
    decorateReply: true,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (path.extname(request.url)) {
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
  await fastify.register(transcodeRoutes);

  resumePendingJobs();

  fastify.addHook('onResponse', (request, reply, done) => {
    if (request.user && request.user.id) {
      try {
        const db = getDb();
        db.prepare('UPDATE users SET last_active_at = datetime(\'now\') WHERE id = ?').run(request.user.id);
      } catch (_) {}
    }
    done();
  });

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Server running at http://${HOST}:${PORT}`);
  fastify.log.info(`Media directories: ${MEDIA_DIRS.join(', ')}`);
}

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
