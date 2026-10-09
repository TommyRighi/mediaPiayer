const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../scripts/admin/core');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-admin-'));
const envFile = path.join(temp,'config.env');
const config = core.defaults({ PORT:'1', PUBLIC_ORIGIN:'https://pi.example.ts.net', MEDIA_DIRS:path.join(temp,'media'), DATABASE_PATH:path.join(temp,'db/app.db'), ADMIN_BACKUP_DIR:path.join(temp,'backups') },temp);
core.writeConfig(envFile,config);
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
function worker(action,input = {}) {
  const result=spawnSync(process.execPath,[path.join(core.ROOT,'scripts/admin/worker.js'),envFile],{ input:JSON.stringify({action,input}),encoding:'utf8',cwd:core.ROOT });
  if(result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('configuration preserves comments and unknown keys, secrets stay private', () => {
  const file=path.join(temp,'settings.env');
  fs.writeFileSync(file,'# keep this comment\nUNKNOWN=value\nPORT=1234\nexport PORT=4567\n');
  core.writeConfig(file,{PORT:'3000',JWT_SECRET:'hash# space=colon:',PUBLIC_ORIGIN:'https://pi.example.ts.net'});
  assert.equal(core.readConfig(file).PORT,'3000');
  assert.equal(core.readConfig(file).JWT_SECRET,'hash# space=colon:');
  assert.equal(core.readConfig(file).UNKNOWN,'value');
  assert.match(fs.readFileSync(file,'utf8'),/# keep this comment/);
  assert.equal(fs.statSync(file).mode & 0o777,0o600);
  assert.throws(()=>core.writeConfig(file,{HOST:'localhost\nPORT=80'}));
  assert.equal(core.readConfig(file).PORT,'3000');
  assert.deepEqual(core.validateConfig(config),[]);
  assert.ok(core.validateConfig({...config,PORT:'0'}).length);
  assert.ok(core.validateConfig({...config,PUBLIC_ORIGIN:'https://pi.example.ts.net/path'}).length);
  assert.ok(core.validateConfig({...config,MEDIA_DIRS:'relative'}).length);
  assert.ok(!core.redact(`JWT ${config.JWT_SECRET} http://user:pass@localhost`,config).includes(config.JWT_SECRET));
  assert.ok(!core.redact('http://user:pass@localhost',config).includes('user:pass'));
});

test('first-run defaults create directories and retain an existing JWT secret', () => {
  assert.equal(core.defaults(config).JWT_SECRET,config.JWT_SECRET);
  assert.equal(core.defaults({},temp).JWT_SECRET.length,64);
  core.prepareDirectories(config,temp);
  assert.ok(fs.existsSync(path.join(temp,'media/movies')));
  assert.ok(fs.existsSync(path.join(temp,'media/music')));
  assert.ok(fs.existsSync(path.dirname(config.DATABASE_PATH)));
});

test('offline administration creates users, protects the last admin and revokes sessions', () => {
  const admin=worker('create-user',{email:'Chief@example.com',name:'Capo',role:'admin'});
  assert.equal(admin.email,'chief@example.com');assert.ok(admin.password.length>=12);
  const viewer=worker('create-user',{email:'viewer@example.com',name:'Viewer',role:'viewer'});
  assert.ok(viewer.password);
  assert.equal(worker('summary').admins,1);
  assert.throws(()=>worker('role',{email:admin.email,role:'viewer'}),/ultimo amministratore/);
  worker('role',{email:viewer.email,role:'admin'});
  worker('role',{email:admin.email,role:'viewer'});
  assert.equal(worker('summary').admins,1);
  const reset=worker('reset-password',{email:viewer.email}); assert.notEqual(reset.password,viewer.password);
  const Database=require('better-sqlite3');const db=new Database(config.DATABASE_PATH);
  try {
    assert.equal(db.prepare('SELECT token_version FROM users WHERE email=?').get(viewer.email).token_version,2);
    const invited=worker('invite');assert.ok(invited.code);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM auth_invites').get().count,1);
    assert.equal(db.prepare('SELECT code_hash FROM auth_invites').get().code_hash.length,64);
    assert.equal(db.prepare('SELECT code_hash FROM auth_invites').get().code_hash.includes(invited.code),false);
  } finally {db.close();}
  assert.deepEqual(worker('features',{downloadsEnabled:true}).downloadsEnabled,true);
});

test('SQLite backup includes WAL writes, restore restores users and invalidates sessions', () => {
  const Database=require('better-sqlite3');let db=new Database(config.DATABASE_PATH);
  const admin=db.prepare("SELECT * FROM users WHERE role='admin'").get();
  db.prepare('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES(?,?,?)').run('fixture-session',admin.id,Math.floor(Date.now()/1000)+3600);
  const backup=worker('backup',{envFile});
  assert.ok(fs.existsSync(path.join(backup.directory,'config.env')));
  assert.equal(fs.statSync(path.join(backup.directory,'config.env')).mode & 0o777,0o600);
  const saved=new Database(path.join(backup.directory,'mediapiayer.db'),{readonly:true});
  assert.equal(saved.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count,1);saved.close();
  db.prepare('DELETE FROM auth_invites').run();db.close();
  const restored=worker('restore',{file:path.join(backup.directory,'mediapiayer.db')});
  assert.ok(fs.existsSync(restored.previous));
  db=new Database(config.DATABASE_PATH);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM auth_invites').get().count,1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM auth_sessions').get().count,0);
  db.close();
  fs.writeFileSync(path.join(temp,'bad.db'),'bad fixture');
  assert.throws(()=>worker('restore',{file:path.join(temp,'bad.db')}));
});

test('systemd unit quotes paths, contains no credentials and hook install is reversible', () => {
  const unit=core.serviceUnit('/opt/media player',envFile,config,'/usr/bin/node');
  assert.match(unit,/WorkingDirectory=\/opt\/media player\n/);
  assert.match(unit,/--env-file=/);
  assert.match(unit,/NoNewPrivileges=true/);
  assert.ok(!unit.includes(config.JWT_SECRET));
  const shellFile=path.join(temp,'bashrc');fs.writeFileSync(shellFile,'# original\n');
  const run=args=>spawnSync('bash',[path.join(core.ROOT,'setup-ssh-menu.sh'),...args,'--shell-file',shellFile],{encoding:'utf8'});
  assert.equal(run(['--install-shell-hook']).status,0);
  assert.equal(run(['--install-shell-hook']).status,0);
  const installed=fs.readFileSync(shellFile,'utf8');
  assert.equal(installed.match(/# >>> MEDIAPIAYER_SSH_MENU >>>/g).length,1);
  assert.match(installed,/SSH_CONNECTION/);assert.match(installed,/-t 0/);
  assert.equal(run(['--uninstall-shell-hook']).status,0);
  assert.ok(!fs.readFileSync(shellFile,'utf8').includes('MEDIAPIAYER_SSH_MENU'));
  assert.match(fs.readFileSync(shellFile,'utf8'),/# original/);
});

test('help and diagnostics run without a TTY, and diagnostics never print secrets', () => {
  const cli=path.join(core.ROOT,'scripts/admin.js');
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/npm run admin/);
  const status=spawnSync(process.execPath,[cli,'--env',envFile,'--status'],{encoding:'utf8'});
  assert.equal(status.status,0);assert.ok(!status.stdout.includes(config.JWT_SECRET));assert.match(status.stdout,/Stato e diagnostica/);
  const nonTTY=spawnSync(process.execPath,[cli,'--env',envFile],{encoding:'utf8'});
  assert.equal(nonTTY.status,1);assert.match(nonTTY.stderr,/terminale interattivo/);
});
