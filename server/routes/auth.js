const { createHash, randomBytes } = require('node:crypto');
const { getDb } = require('../db');
const { createMediaToken, hashPassword, comparePassword, authMiddleware, adminMiddleware, sessionCookie, issueSession, revokeSessions, validPassword, USER_FIELDS } = require('../auth');
const { nanoid } = require('nanoid');
const hashInvite = code => createHash('sha256').update(code).digest('hex');
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(32).toString('hex'));
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authRoutes(fastify) {
  fastify.get('/api/auth/config', async () => ({ sessionProtocol: 1, registration: 'invite', ...require('../features').getFeatures(), privateByDefault: true }));
  fastify.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password, displayName, inviteCode } = request.body || {};
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_REGEX.test(email) || typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 50 || !validPassword(password)) {
      return reply.status(400).send({ error: 'Inserisci email, nome e una password di almeno 12 caratteri e massimo 72 byte.' });
    }
    if (typeof inviteCode !== 'string' || inviteCode.length > 200) return reply.status(403).send({ error: 'È necessario un invito valido.' });
    const db = getDb();
    const codeHash = hashInvite(inviteCode);
    const now = Math.floor(Date.now() / 1000);
    const invite = db.prepare('SELECT code_hash FROM auth_invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').get(codeHash, now);
    if (!invite) return reply.status(403).send({ error: 'Invito assente, scaduto o già utilizzato.' });
    const cleanEmail = email.toLowerCase().trim();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) return reply.status(409).send({ error: 'Email already registered' });
    const passwordHash = await hashPassword(password);
    const id = nanoid();
    const created = db.transaction(() => {
      const claim = db.prepare('UPDATE auth_invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').run(Math.floor(Date.now()/1000), codeHash, Math.floor(Date.now()/1000));
      if (!claim.changes) return false;
      db.prepare("INSERT INTO users (id,email,password_hash,display_name,role) VALUES (?,?,?,?, 'viewer')").run(id, cleanEmail, passwordHash, displayName.trim());
      return true;
    })();
    if (!created) return reply.status(403).send({ error: 'Invito già utilizzato.' });
    return issueSession(reply, db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(id));
  });
  fastify.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email, password } = request.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || Buffer.byteLength(password) > 128) return reply.status(400).send({ error: 'Email e password non valide.' });
    const db = getDb();
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email.toLowerCase().trim());
    // Avoid the cheap missing-user path during credential guessing.
    const hash = row?.password_hash || await DUMMY_PASSWORD_HASH;
    if (!await comparePassword(password, hash) || !row) return reply.status(401).send({ error: 'Invalid email or password' });
    return issueSession(reply, db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(row.id));
  });
  fastify.get('/api/auth/me', { preHandler: authMiddleware }, async request => ({ user: request.user }));
  fastify.get('/api/auth/online', { preHandler: authMiddleware }, async () => ({ users: [] }));
  fastify.get('/api/auth/media-token', { preHandler: authMiddleware }, async (request, reply) => {
    reply.header('Set-Cookie', sessionCookie('media_access', createMediaToken(request.user), 3600));
    return { ready: true };
  });
  fastify.post('/api/auth/logout', { preHandler: authMiddleware }, async (request, reply) => {
    revokeSessions(request.user.id, request.user.sessionId);
    reply.header('Set-Cookie', [sessionCookie('mp_session', '', 0), sessionCookie('media_access', '', 0)]);
    return { success: true };
  });
  fastify.post('/api/auth/revoke-all', { preHandler: authMiddleware }, async (request, reply) => {
    revokeSessions(request.user.id);
    reply.header('Set-Cookie', [sessionCookie('mp_session', '', 0), sessionCookie('media_access', '', 0)]);
    return { success: true };
  });
  fastify.get('/api/auth/sessions', { preHandler: authMiddleware }, async request => ({ sessions: getDb().prepare('SELECT id, expires_at FROM auth_sessions WHERE user_id = ? AND expires_at > ?').all(request.user.id, Math.floor(Date.now()/1000)).map(s => ({ ...s, current: s.id === request.user.sessionId })) }));
  fastify.delete('/api/auth/sessions/:id', { preHandler: authMiddleware }, async request => { revokeSessions(request.user.id, request.params.id); return { success: true }; });
  fastify.post('/api/auth/invites', { preHandler: [authMiddleware, adminMiddleware] }, async () => {
    const code = randomBytes(24).toString('base64url');
    const expiresAt = Math.floor(Date.now()/1000) + 48 * 3600;
    getDb().prepare('INSERT INTO auth_invites (code_hash, expires_at) VALUES (?, ?)').run(hashInvite(code), expiresAt);
    return { code, expiresAt };
  });
  fastify.patch('/api/auth/privacy', { preHandler: authMiddleware }, async (request, reply) => {
    if (typeof request.body?.historyEnabled !== 'boolean') return reply.status(400).send({ error: 'historyEnabled deve essere booleano.' });
    const db = getDb();
    db.transaction(() => {
      db.prepare('UPDATE users SET history_enabled = ? WHERE id = ?').run(request.body.historyEnabled ? 1 : 0, request.user.id);
      if (!request.body.historyEnabled) {
        db.prepare('DELETE FROM watch_progress WHERE user_id = ?').run(request.user.id);
        db.prepare('DELETE FROM track_progress WHERE user_id = ?').run(request.user.id);
      }
    })();
    return { user: db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(request.user.id) };
  });
  fastify.delete('/api/auth/history', { preHandler: authMiddleware }, async request => {
    const db = getDb(); db.transaction(() => { db.prepare('DELETE FROM watch_progress WHERE user_id = ?').run(request.user.id); db.prepare('DELETE FROM track_progress WHERE user_id = ?').run(request.user.id); })();
    return { success: true };
  });
  fastify.patch('/api/auth/profile', { preHandler: authMiddleware }, async (request, reply) => {
    const { displayName, avatarUrl } = request.body || {};
    if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 50)) return reply.status(400).send({ error: 'Nome non valido.' });
    // Remote avatars can disclose IPs and activity. Only local avatar paths are allowed.
    if (avatarUrl !== undefined && avatarUrl !== '' && (typeof avatarUrl !== 'string' || !/^\/assets\/[a-zA-Z0-9_.\/-]+$/.test(avatarUrl) || avatarUrl.includes('..'))) return reply.status(400).send({ error: 'Usa un’immagine locale.' });
    const db = getDb();
    if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName.trim(), request.user.id);
    if (avatarUrl !== undefined) db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, request.user.id);
    return { user: db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(request.user.id) };
  });
  fastify.post('/api/auth/change-password', { preHandler: authMiddleware }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 128 || !validPassword(newPassword)) return reply.status(400).send({ error: 'La nuova password deve avere almeno 12 caratteri e massimo 72 byte.' });
    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
    if (!await comparePassword(currentPassword, row.password_hash)) return reply.status(401).send({ error: 'Current password is incorrect' });
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await hashPassword(newPassword), request.user.id);
    revokeSessions(request.user.id);
    return issueSession(reply, db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(request.user.id));
  });
}
module.exports = authRoutes;
