const { getDb } = require('../db');
const { createToken, createMediaToken, hashPassword, comparePassword, authMiddleware } = require('../auth');
const { nanoid } = require('nanoid');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authRoutes(fastify) {
  fastify.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password, displayName, inviteCode } = request.body || {};
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
    if (!EMAIL_REGEX.test(email)) {
      return reply.status(400).send({ error: 'Invalid email format' });
    }
    if (trimmedName.length > 50) {
      return reply.status(400).send({ error: 'Display name must be 50 characters or fewer' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const adminInviteCode = process.env.ADMIN_INVITE_CODE;
    const hasAdmins = db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?').get('admin').count > 0;
    let role;
    if (!hasAdmins && !adminInviteCode) {
      role = 'admin';
    } else if (inviteCode && inviteCode === adminInviteCode) {
      role = 'admin';
    } else {
      role = 'viewer';
    }

    const id = nanoid();
    const passwordHash = await hashPassword(password);

    db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
      id, email.toLowerCase().trim(), passwordHash, trimmedName, role
    );

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(id);
    const token = createToken(user);
    return { token, user };
  });

  fastify.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }

    const db = getDb();
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!row) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await comparePassword(password, row.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(row.id);
    const token = createToken(user);
    return { token, user };
  });

  fastify.get('/api/auth/me', { preHandler: authMiddleware }, async (request) => {
    return { user: request.user };
  });

  fastify.get('/api/auth/online', { preHandler: authMiddleware }, async (request) => {
    const db = getDb();
    const users = db.prepare(
      "SELECT id, display_name, avatar_url FROM users WHERE last_active_at IS NOT NULL AND last_active_at > datetime('now', '-2 minutes') AND id != ? ORDER BY display_name"
    ).all(request.user.id);
    return { users };
  });

  fastify.get('/api/auth/media-token', { preHandler: authMiddleware }, async (request) => {
    const mediaToken = createMediaToken(request.user);
    return { mediaToken };
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

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(request.user.id);
    return { user };
  });

  fastify.post('/api/auth/change-password', { preHandler: authMiddleware }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'New password must be at least 6 characters' });
    }
    if (newPassword.length > 128) {
      return reply.status(400).send({ error: 'New password must be 128 characters or fewer' });
    }

    const db = getDb();
    const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(request.user.id);
    if (!row) {
      return reply.status(401).send({ error: 'User not found' });
    }

    const valid = await comparePassword(currentPassword, row.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    const newPasswordHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(newPasswordHash, request.user.id);

    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(request.user.id);
    const token = createToken(user);
    return { token, user };
  });
}

module.exports = authRoutes;
