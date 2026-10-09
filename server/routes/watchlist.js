const { getDb } = require('../db');
const { authMiddleware } = require('../auth');
const { publicMedia } = require('../catalog-response');

module.exports = async function watchlistRoutes(app) {
  app.get('/api/watchlist', { preHandler: authMiddleware }, async request => ({
    media: getDb().prepare(`SELECT m.* FROM user_watchlist w JOIN media m ON m.id=w.media_id WHERE w.user_id=? ORDER BY w.created_at DESC, m.id`).all(request.user.id).map(publicMedia),
  }));
  app.put('/api/watchlist/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const db = getDb();
    if (!db.prepare('SELECT id FROM media WHERE id=?').get(request.params.id)) return reply.code(404).send({ error: 'Media not found' });
    db.prepare('INSERT OR IGNORE INTO user_watchlist(user_id,media_id) VALUES (?,?)').run(request.user.id, request.params.id);
    return { saved: true };
  });
  app.delete('/api/watchlist/:id', { preHandler: authMiddleware }, async request => {
    getDb().prepare('DELETE FROM user_watchlist WHERE user_id=? AND media_id=?').run(request.user.id, request.params.id);
    return { saved: false };
  });
};
