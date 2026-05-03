const { getDb } = require('../db');
const { createToken, hashPassword, comparePassword, authMiddleware } = require('../auth');
const { nanoid } = require('nanoid');

async function authRoutes(fastify) {
  fastify.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password, displayName } = request.body || {};
    if (!email || !password || !displayName) {
      return reply.status(400).send({ error: 'email, password, and displayName are required' });
    }
    const trimmedName = (displayName || '').trim();
    if (!trimmedName) {
      return reply.status(400).send({ error: 'Display name is required' });
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' });
    }
    if (password.length > 128) {
      return reply.status(400).send({ error: 'Password must be 128 characters or fewer' });
    }
    if (email.length > 254) {
      return reply.status(400).send({ error: 'Email is too long' });
    }
    if (trimmedName.length > 50) {
      return reply.status(400).send({ error: 'Display name must be 50 characters or fewer' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const id = nanoid();
    const passwordHash = await hashPassword(password);
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const role = userCount === 0 ? 'admin' : 'viewer';

    db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
      id, email.toLowerCase().trim(), passwordHash, trimmedName, role
    );

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at FROM users WHERE id = ?').get(id);
    const token = createToken(user);
    return { token, user };
  });

  fastify.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, email, password_hash, display_name, avatar_url, role, created_at FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const { password_hash, ...safeUser } = user;
    const token = createToken(safeUser);
    return { token, user: safeUser };
  });

  fastify.get('/api/auth/me', { preHandler: authMiddleware }, async (request) => {
    return { user: request.user };
  });

  fastify.patch('/api/auth/profile', { preHandler: authMiddleware }, async (request, reply) => {
    const { displayName, avatarUrl } = request.body || {};
    const db = getDb();

    if (displayName) {
      if (displayName.trim().length > 50) {
        return reply.status(400).send({ error: 'Display name must be 50 characters or fewer' });
      }
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim(), request.user.id);
    }
    if (avatarUrl !== undefined) {
      if (avatarUrl && !/^https?:\/\/.+/.test(avatarUrl)) {
        return reply.status(400).send({ error: 'avatarUrl must be a valid URL' });
      }
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, request.user.id);
    }

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at FROM users WHERE id = ?').get(request.user.id);
    return { user };
  });
}

module.exports = authRoutes;
