const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { getDb } = require('./db');

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
if (process.env.NODE_ENV === 'production' && Buffer.byteLength(process.env.JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
const JWT_SECRET = process.env.JWT_SECRET;
const USER_FIELDS = 'id, email, display_name, avatar_url, role, created_at, token_version, history_enabled';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function createToken(user) {
  const db = getDb();
  const sid = randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sid, user.id, expires);
  return jwt.sign({ sub: user.id, sid, tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: SESSION_SECONDS, algorithm: 'HS256' });
}
function createMediaToken(user) {
  return jwt.sign({ sub: user.id, sid: user.sessionId, purpose: 'media', tv: user.token_version || 0 }, JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
}
function verifyToken(token) { return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); }
function readCookie(request, name) {
  const part = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}
function readAuthToken(request) {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : readCookie(request, 'mp_session');
}
function authenticate(token, allowMedia = false) {
  const payload = verifyToken(token);
  if (payload.purpose && (!allowMedia || payload.purpose !== 'media')) throw new Error('Invalid token purpose');
  if (!payload.sid) throw new Error('Session required');
  const db = getDb();
  const session = db.prepare('SELECT user_id FROM auth_sessions WHERE id = ? AND expires_at > ?').get(payload.sid, Math.floor(Date.now() / 1000));
  if (!session || session.user_id !== payload.sub) throw new Error('Session revoked');
  const user = db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(payload.sub);
  if (!user || payload.tv !== (user.token_version || 0)) throw new Error('Token revoked');
  Object.defineProperty(user, 'sessionId', { value: payload.sid });
  return user;
}
async function authMiddleware(request, reply) {
  try { request.user = authenticate(readAuthToken(request)); }
  catch { return reply.status(401).send({ error: 'Sessione assente, scaduta o revocata.' }); }
}
async function optionalAuth(request) {
  try { request.user = authenticate(readAuthToken(request)); } catch { /* anonymous request */ }
}
async function mediaAuth(request, reply) {
  try {
    // Never accept credentials from URL query parameters.
    const token = readAuthToken(request) || readCookie(request, 'media_access');
    request.user = authenticate(token, true);
  } catch { return reply.status(401).send({ error: 'Sessione media assente, scaduta o revocata.' }); }
}
async function adminMiddleware(request, reply) {
  if (request.user?.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
}
function sessionCookie(name, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function issueSession(reply, user) {
  const token = createToken(user);
  reply.header('Set-Cookie', [sessionCookie('mp_session', token, SESSION_SECONDS), sessionCookie('media_access', '', 0)]);
  reply.header('Cache-Control', 'private, no-store');
  return { user };
}
function revokeSessions(userId, sessionId) {
  const db = getDb();
  if (sessionId) db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND id = ?').run(userId, sessionId);
  else db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
  // Existing party sockets must be closed immediately, not only on reconnect.
  const { partySockets } = require('./routes/parties');
  for (const sockets of partySockets.values()) for (const socket of sockets) {
    if (socket.authUserId === userId && (!sessionId || socket.authSessionId === sessionId)) {
      socket.close(4001, 'Session revoked');
      const forceClose = setTimeout(() => socket.terminate(), 1000); forceClose.unref();
      socket.once('close', () => clearTimeout(forceClose));
    }
  }
}
function validPassword(password) { return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 72; }
async function hashPassword(password) { return bcrypt.hash(password, 12); }
async function comparePassword(password, hash) { return typeof password === 'string' && bcrypt.compare(password, hash); }
module.exports = { createToken, createMediaToken, verifyToken, hashPassword, comparePassword, authMiddleware, optionalAuth, mediaAuth, adminMiddleware, authenticate, readAuthToken, readCookie, sessionCookie, issueSession, revokeSessions, validPassword, USER_FIELDS, randomBytes };
