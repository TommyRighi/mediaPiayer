// Run locally on the Raspberry. Never accept passwords as command-line arguments.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname,'../.env'), quiet:true });
const { randomBytes, createHash } = require('node:crypto');
const { nanoid } = require('nanoid');
const { getDb } = require('../server/db');
const { hashPassword, revokeSessions } = require('../server/auth');
const [command,...args] = process.argv.slice(2);
function option(name) { const at = args.indexOf(`--${name}`); return at < 0 ? undefined : args[at+1]; }
(async () => {
  const db = getDb();
  try {
    if (command === 'create') {
      const email = option('email'); const name = option('name'); const role = option('role') || 'viewer';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 50 || !['admin','viewer'].includes(role)) throw new Error('Uso: users create --email persona@example.com --name Nome --role admin|viewer');
      const password = randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO users (id,email,password_hash,display_name,role) VALUES (?,?,?,?,?)').run(nanoid(),email.trim().toLowerCase(),await hashPassword(password),name,role);
      console.log(`Utente creato: ${email}\nPassword iniziale: ${password}\nComunica la password tramite un canale privato. Non conservarla nei log.`);
    } else if (command === 'invite') {
      const code = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO auth_invites (code_hash,expires_at) VALUES (?,?)').run(createHash('sha256').update(code).digest('hex'),Math.floor(Date.now()/1000)+48*3600);
      console.log(`Invito mediaPiayer monouso, valido 48 ore:\n${code}\nQuesto invito crea un account viewer; non sostituisce la chiave Tailscale.`);
    } else if (command === 'revoke') {
      const row = db.prepare('SELECT id FROM users WHERE email = ?').get((option('email') || '').toLowerCase().trim());
      if (!row) throw new Error('Utente non trovato.');
      db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(row.id);
      revokeSessions(row.id);
      console.log('Sessioni revocate. I socket nel processo server si chiuderanno alla prossima verifica. Revoca separatamente il dispositivo in Tailscale.');
    } else throw new Error('Comandi disponibili: create, invite, revoke.');
  } finally { db.close(); }
})().catch(err => { console.error(err.message); process.exitCode=1; });
