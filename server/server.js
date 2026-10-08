const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
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
const downloadRoutes = require('./routes/downloads');
const requestRoutes = require('./routes/requests');
const musicRoutes = require('./routes/music/index');
const { getDb } = require('./db');
const { resumePendingJobs } = require('./transcode');
const { startPolling } = require('./transmission');
const background = require('./background');

const { securityHooks, logSerializers } = require('./security');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const fastify = Fastify({
  disableRequestLogging: true,
  logger: {
    serializers: logSerializers,
    level: 'info',
    ...(process.env.NODE_ENV !== 'production' ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
    redact: ['req.headers.authorization', 'req.headers.cookie', 'token', 'password'],
  },
  bodyLimit: 1024 * 1024,
});

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_ORIGIN) throw new Error('PUBLIC_ORIGIN is required in production');
  securityHooks(fastify);
  fastify.setErrorHandler((err, request, reply) => {
    const code = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) request.log.error({ err }, 'Request failed');
    reply.code(code).send({ error: code === 500 ? 'Errore del server. Riprova più tardi.' : err.message });
  });
await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (request) => {
      const urlPath = request.url.split('?')[0];
      return /^\/api\/media\/[^/]+\/(video|poster|backdrop)$/.test(urlPath) ||
             /^\/api\/media\/[^/]+\/hls\//.test(urlPath) ||
             /^\/api\/episodes\/[^/]+\/video$/.test(urlPath) ||
             /^\/api\/episodes\/[^/]+\/hls\//.test(urlPath) ||
             /^\/api\/subtitles\//.test(urlPath) ||
             urlPath.startsWith('/assets/') ||
             /^\/api\/music\/(albums\/[^/]+\/cover|tracks\/[^/]+\/stream)$/.test(urlPath);
    },
  });
  const corsOrigin = process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || false)
    : true;
  await fastify.register(cors, { origin: corsOrigin });
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "blob:", "data:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'", ...(process.env.PUBLIC_ORIGIN || '').split(',').filter(Boolean).map(origin => origin.replace(/^http/, 'ws'))],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
  await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 * 1024 } });
  await fastify.register(websocket);

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!request.user || request.headers['x-background-request'] === '1') return payload;
    const pathname = request.url.split('?')[0];
    if (/\/(video|stream)$|\/hls\//.test(pathname)) {
      background.touchActivity(30000);
    } else if (!/\/transcode\/|\/watch\/(activity|progress)|\/music\/(progress|youtube\/status)|\/download|\/auth\/(online|media-token)/.test(pathname)) {
      background.touchActivity();
    }
    return payload;
  });

  await fastify.register(statik, {
    root: path.join(__dirname, 'dist'),
    prefix: '/',
    decorateReply: true,
    preCompressed: true,
    setHeaders: (response, filePath) => {
      response.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || path.extname(request.url.split('?')[0])) {
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
  await fastify.register(downloadRoutes);
  await fastify.register(requestRoutes);
  await fastify.register(musicRoutes);

  resumePendingJobs();
  const queueTimer = setInterval(resumePendingJobs, 30000);
  queueTimer.unref();
  startPolling();

  // Presence is intentionally not recorded, including when social features are enabled.

  await fastify.listen({ port: PORT, host: HOST });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      background.shutdown();
      fastify.close().finally(() => process.exit(0));
    });
  }
  fastify.log.info(`Server running at http://${HOST}:${PORT}`);
}

start().catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
