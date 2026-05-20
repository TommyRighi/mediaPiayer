const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { getDb } = require('./db');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';
const MEDIA_JWT_EXPIRES = '1h';

function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function createMediaToken(user) {
  return jwt.sign({ sub: user.id, purpose: 'media', tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: MEDIA_JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function checkTokenVersion(payload, user) {
  if (payload.tv !== undefined && payload.tv !== (user.token_version || 0)) {
    return false;
  }
  return true;
}

async function authMiddleware(request, reply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid token' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.purpose === 'media') {
      reply.status(401).send({ error: 'Media tokens cannot be used for this endpoint' });
      return;
    }
    const db = getDb();
    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      reply.status(401).send({ error: 'User not found' });
      return;
    }
    if (!checkTokenVersion(payload, user)) {
      reply.status(401).send({ error: 'Token revoked' });
      return;
    }
    request.user = user;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

async function optionalAuth(request) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return;
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.purpose === 'media') return;
    const db = getDb();
    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(payload.sub);
    if (user && checkTokenVersion(payload, user)) request.user = user;
  } catch { /* ignore */ }
}

async function mediaAuth(request, reply) {
  let token = null;

  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  }

  if (!token && request.query.token) {
    token = request.query.token;
  }

  if (!token) {
    reply.status(401).send({ error: 'Missing or invalid token' });
    return;
  }

  try {
    const payload = verifyToken(token);
    const db = getDb();
    const user = db.prepare('SELECT id, email, display_name, avatar_url, role, created_at, token_version FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      reply.status(401).send({ error: 'User not found' });
      return;
    }
    if (!checkTokenVersion(payload, user)) {
      reply.status(401).send({ error: 'Token revoked' });
      return;
    }
    request.user = user;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

async function adminMiddleware(request, reply) {
  if (!request.user || request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

module.exports = { createToken, createMediaToken, verifyToken, hashPassword, comparePassword, authMiddleware, optionalAuth, mediaAuth, adminMiddleware };
