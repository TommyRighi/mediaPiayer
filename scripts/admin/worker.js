'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const core = require('./core');

async function execute(action, input = {}) {
  const { getDb } = require('../../server/db');
  const db = getDb();
  const auth = () => { if (!process.env.JWT_SECRET) throw new Error('Configura prima il segreto dal menu Setup.'); return require('../../server/auth'); };
  const user = email => {
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!row) throw new Error('Utente non trovato.');
    return row;
  };
  const revoke = row => db.transaction(() => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(row.id);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.id);
  })();
  switch (action) {
    case 'summary': return {
      users: db.prepare('SELECT COUNT(*) count FROM users').get().count,
      admins: db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get().count,
      movies: db.prepare("SELECT COUNT(*) count FROM media WHERE type='movie'").get().count,
      episodes: db.prepare('SELECT COUNT(*) count FROM episodes').get().count,
      tracks: db.prepare('SELECT COUNT(*) count FROM music_tracks').get().count,
      conversions: db.prepare("SELECT COUNT(*) count FROM media WHERE transcode_status IN ('pending','converting')").get().count + db.prepare("SELECT COUNT(*) count FROM episodes WHERE transcode_status IN ('pending','converting')").get().count,
      features: require('../../server/features').getFeatures(),
    };
    case 'users': return db.prepare('SELECT email,display_name,role,created_at FROM users ORDER BY role,email').all();
    case 'create-user': {
      const email = String(input.email || '').trim().toLowerCase();
      const name = String(input.name || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 50 || !['admin','viewer'].includes(input.role)) throw new Error('Email, nome o ruolo non valido.');
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw new Error('Email già registrata.');
      const password = randomBytes(18).toString('base64url');
      db.prepare('INSERT INTO users(id,email,password_hash,display_name,role) VALUES(?,?,?,?,?)').run(randomUUID(), email, await auth().hashPassword(password), name, input.role);
      return { email, password };
    }
    case 'reset-password': {
      const row = user(input.email); const password = randomBytes(18).toString('base64url');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await auth().hashPassword(password),row.id);
      revoke(row);
      return { email: row.email, password };
    }
    case 'revoke': revoke(user(input.email)); return { message: 'Sessioni revocate.' };
    case 'role': {
      if (!['admin','viewer'].includes(input.role)) throw new Error('Ruolo non valido.');
      db.transaction(() => {
        const row = user(input.email);
        if (row.role === 'admin' && input.role !== 'admin' && db.prepare("SELECT COUNT(*) count FROM users WHERE role='admin'").get().count <= 1) throw new Error('Non puoi rimuovere l’ultimo amministratore.');
        db.prepare('UPDATE users SET role=? WHERE id=?').run(input.role,row.id); revoke(row);
      })();
      return { message: 'Ruolo aggiornato e sessioni revocate.' };
    }
    case 'invite': {
      const code = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO auth_invites(code_hash,expires_at) VALUES(?,?)').run(createHash('sha256').update(code).digest('hex'),Math.floor(Date.now()/1000)+48*3600);
      return { code, message: 'Invito viewer monouso, valido 48 ore.' };
    }
    case 'features': {
      if (!Object.keys(input).length || Object.entries(input).some(([key,value]) => !['socialEnabled','downloadsEnabled'].includes(key) || typeof value !== 'boolean')) throw new Error('Impostazioni non valide.');
      return require('../../server/features').setFeatures(input);
    }
    case 'clean': {
      if (db.prepare("SELECT id FROM downloads WHERE status IN ('downloading','importing','cancelling') LIMIT 1").get() || db.prepare("SELECT id FROM media WHERE transcode_status IN ('pending','converting') LIMIT 1").get() || db.prepare("SELECT id FROM episodes WHERE transcode_status IN ('pending','converting') LIMIT 1").get()) throw new Error('Attendi la fine dei download e delle conversioni prima della pulizia.');
      return require('../../server/routes/admin').cleanMissingMedia();
    }
    case 'downloads': return {
      available: await require('../../server/transmission').checkAvailable(),
      downloads: db.prepare('SELECT m.title,d.media_id,d.status,d.progress,d.error FROM downloads d JOIN media m ON m.id=d.media_id ORDER BY d.created_at DESC').all(),
    };
    case 'scan-video':
    case 'scan-music':
    case 'download-start':
    case 'download-cancel': {
      const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
      if (!admin) throw new Error('Crea prima un amministratore.');
      const routes = { 'scan-video':'admin/scan', 'scan-music':'music/scan', 'download-start':'downloads', 'download-cancel':`media/${encodeURIComponent(input.mediaId)}/download` };
      const token = auth().createToken(admin);
      try {
        const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/${routes[action]}`, {
          method: action === 'download-cancel' ? 'DELETE' : 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: action === 'download-start' ? JSON.stringify({ title:input.title,magnetUri:input.magnetUri }) : undefined,
          signal: AbortSignal.timeout(300000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Operazione non riuscita.');
        return result;
      } catch (error) {
        if (error.message === 'fetch failed') throw new Error('Server non raggiungibile. Avvia MediaPiayer dal menu Servizio.');
        throw error;
      } finally { db.prepare('DELETE FROM auth_sessions WHERE id=?').run(auth().verifyToken(token).sid); }
    }
    case 'backup': {
      const directory = path.join(process.env.ADMIN_BACKUP_DIR || path.join(core.ROOT,'data','admin-backups'),new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(3).toString('hex'));
      fs.mkdirSync(directory,{recursive:true,mode:0o700});
      await db.backup(path.join(directory,'mediapiayer.db'));
      fs.chmodSync(path.join(directory,'mediapiayer.db'),0o600);
      const env = input.envFile;
      if (typeof input.envContents === 'string') fs.writeFileSync(path.join(directory,'config.env'),input.envContents,{mode:0o600});
      else if (env && fs.existsSync(env)) { fs.copyFileSync(env,path.join(directory,'config.env')); fs.chmodSync(path.join(directory,'config.env'),0o600); }
      fs.writeFileSync(path.join(directory,'manifest.json'), JSON.stringify({ createdAt:new Date().toISOString(),database:process.env.DATABASE_PATH || path.join(core.ROOT,'data/mediapiayer.db'),mediaIncluded:false },null,2), {mode:0o600});
      return { directory, message: 'Database e configurazione salvati. I file video e audio non sono inclusi.' };
    }
    case 'restore': {
      if (await core.probe(process.env)) throw new Error('Il server deve essere fermo prima del ripristino.');
      const destination = path.resolve(process.env.DATABASE_PATH || path.join(core.ROOT,'data/mediapiayer.db'));
      const source = path.resolve(input.file || '');
      if (!fs.existsSync(source) || fs.realpathSync(source) === fs.realpathSync(destination)) throw new Error('Seleziona un backup diverso dal database attivo.');
      const Database = require('better-sqlite3');
      const saved = new Database(source,{readonly:true,fileMustExist:true});
      try {
        if (saved.pragma('quick_check',{simple:true}) !== 'ok' || !saved.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) throw new Error('Il backup non è un database MediaPiayer valido.');
      } finally { saved.close(); }
      const previous = destination+'.before-restore-'+Date.now();
      await db.backup(previous); fs.chmodSync(previous,0o600); db.close();
      const temporary = destination+'.restore-'+randomBytes(4).toString('hex');
      fs.copyFileSync(source,temporary); fs.chmodSync(temporary,0o600);
      for (const suffix of ['-wal','-shm']) fs.rmSync(destination+suffix,{force:true});
      fs.renameSync(temporary,destination);
      const restored = new Database(destination);
      try { restored.exec('DELETE FROM auth_sessions; UPDATE users SET token_version=token_version+1;'); } finally { restored.close(); }
      return { previous, message: 'Database ripristinato; sessioni revocate. La configurazione e i media restano quelli attuali.' };
    }
    default: throw new Error('Operazione non riconosciuta.');
  }
}
if (require.main === module) {
  let config = {};
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    try {
      const request = JSON.parse(input);
      config = request.config || core.readConfig(process.argv[2]);
      Object.assign(process.env, config, { TRANSCODE_WORKER:'external' });
      const result = await execute(request.action,request.input);
      console.log(JSON.stringify(result));
    } catch (error) { console.error(core.redact(error.message,config)); process.exitCode=1; }
    finally {
      const cached = require.cache[require.resolve('../../server/db')];
      if (cached) { try { const db = cached.exports.getDb(); if (db.open) db.close(); } catch { /* Preserve the original failure. */ } }
    }
  });
}
module.exports = { execute };
