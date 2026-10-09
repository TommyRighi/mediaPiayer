// Apply before registering routes. No raw request URLs, identities or credentials
// belong in operational logs. Restrict changes and sockets to the configured origin.
function securityHooks(app) {
  const { getFeatures } = require('./features');
  const production = process.env.NODE_ENV === 'production';
  const origins = new Set((process.env.PUBLIC_ORIGIN || '').split(',').filter(Boolean));
  if (!production) { origins.add('http://localhost:5173'); origins.add('http://localhost:3000'); origins.add('http://127.0.0.1:3000'); }
  app.addHook('onRequest', async (request, reply) => {
    const path = request.routeOptions?.url || request.url.split('?')[0];
    if ((/^\/api\/(parties|requests)(\/|$)/.test(path) || /^\/api\/music\/jams(\/|$)/.test(path)) && !getFeatures().socialEnabled) return reply.code(403).send({ error: 'Le funzioni social sono disattivate per proteggere la privacy.' });
    if ((/^\/api\/downloads(?:\/|$)/.test(path) || /^\/api\/media\/[^/]+\/download$/.test(path) || /^\/api\/music\/youtube(?:\/|$)/.test(path)) && !getFeatures().downloadsEnabled) return reply.code(403).send({ error: 'I downloader sono disattivati.' });
    const isSocket = request.headers.upgrade?.toLowerCase() === 'websocket';
    if (path.startsWith('/api/') && (isSocket || !['GET','HEAD','OPTIONS'].includes(request.method))) {
      const origin = request.headers.origin;
      const bearer = request.headers.authorization?.startsWith('Bearer ');
      // Browser cookie requests require Origin. CLI bearer requests may omit it.
      if ((origin && !origins.has(origin)) || (!origin && !bearer)) return reply.code(403).send({ error: 'Origine della richiesta non autorizzata.' });
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if ((request.routeOptions?.url || request.url).startsWith('/api/')) reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
}
const logSerializers = {
  req: req => ({ method: req.method }),
  res: res => ({ statusCode: res.statusCode }),
  err: err => ({ type: err.name, code: typeof err.code === 'string' ? err.code : undefined }),
};
module.exports = { securityHooks, logSerializers };
