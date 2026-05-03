const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { getDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'nextflix-dev-secret-change-in-production';
const JWT_EXPIRES = '7d';

function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
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

async function authMiddleware(request, reply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid token' });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    const db = getDb();
    const user = db.prepare('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      reply.status(401).send({ error: 'User not found' });
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
    const db = getDb();
    const user = db.prepare('SELECT id, email, display_name, avatar_url, created_at FROM users WHERE id = ?').get(payload.sub);
    if (user) request.user = user;
  } catch { /* ignore */ }
}

module.exports = { createToken, verifyToken, hashPassword, comparePassword, authMiddleware, optionalAuth, JWT_SECRET };
