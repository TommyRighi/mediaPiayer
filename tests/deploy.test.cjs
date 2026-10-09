const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { deploy,verifyArchive,unpack,override,switchRelease } = require('../scripts/deploy-release');
const { quote } = require('../scripts/deploy-upload');

function fixture(t, files = {}) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-deploy-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'.deploy'),previous=path.join(directory,'releases/bootstrap');
  for(const folder of [previous,path.join(directory,'backups'),path.join(root,'data'),path.join(root,'media')])fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(root,'.env'),'private-configuration');
  fs.writeFileSync(path.join(root,'data/app.db'),'original-database');
  fs.writeFileSync(path.join(root,'media/song.mp3'),'original-media');
  switchRelease(directory,previous);
  const source=path.join(root,'artifact');fs.mkdirSync(source);
  const commit='a'.repeat(40);
  for(const [file,data] of Object.entries({ 'package.json':'{}','package-lock.json':'{}','release.json':JSON.stringify({commit}), 'server/server.js':'// fixture','server/dist/index.html':'built frontend','scripts/verify-build.js':'// check',...files })){
    fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),data);
  }
  const archive=path.join(root,'release.tgz');
  const tar=spawnSync('tar',['-czf',archive,'-C',source,...fs.readdirSync(source)],{env:{...process.env,COPYFILE_DISABLE:'1'},encoding:'utf8'});
  assert.equal(tar.status,0,tar.stderr);
  const input={archive,commit,runId:'10',digest:createHash('sha256').update(fs.readFileSync(archive)).digest('hex')};
  const config={root,envFile:path.join(root,'.env'),node:process.execPath,npm:'npm',databasePath:path.join(root,'data/app.db'),healthTimeoutMs:1};
  let active=true;
  const calls=[];
  const adapters={
    run:async(command,args,options)=>{calls.push({command,args,options});},
    service:async(config,action)=>{calls.push(action);active=action!=='stop';},
    healthy:async()=>active,
    backup:async(config,previous,target)=>{calls.push('backup');fs.copyFileSync(config.databasePath,target);return true;},
    restore:(config,backup)=>{calls.push('restore');fs.copyFileSync(backup,config.databasePath);},
  };
  return {root,directory,previous,config,input,adapters,calls};
}

test('deployment prepares before stopping, switches atomically and preserves persistent files',async t=>{
  const f=fixture(t);
  await deploy(f.config,f.input,f.adapters);
  const current=fs.realpathSync(path.join(f.directory,'current'));
  assert.notEqual(current,f.previous);
  assert.equal(f.calls[0].args[0],'ci');assert.ok(f.calls[0].args.includes('--omit=dev'));
  assert.ok(f.calls[0].options.env.PATH.startsWith(path.dirname(process.execPath)));
  assert.deepEqual(f.calls.filter(x=>typeof x==='string'),['stop','backup','start']);
  assert.equal(fs.readFileSync(path.join(current,'.env'),'utf8'),'private-configuration');
  assert.equal(fs.readFileSync(path.join(current,'media/song.mp3'),'utf8'),'original-media');
  assert.equal(fs.readFileSync(f.config.databasePath,'utf8'),'original-database');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'status.json'))).commit,f.input.commit);
});

test('dependency failures keep the running release and never stop its service',async t=>{
  const f=fixture(t);f.adapters.run=async()=>{throw Error('npm unavailable');};
  await assert.rejects(deploy(f.config,f.input,f.adapters),/npm unavailable/);
  assert.equal(fs.realpathSync(path.join(f.directory,'current')),f.previous);
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(fs.readdirSync(path.join(f.directory,'releases')),['bootstrap']);
});

test('startup failure restores the previous code and database after migration',async t=>{
  const f=fixture(t), original=f.adapters.service;
  f.adapters.service=async(config,action)=>{
    await original(config,action);
    if(action==='start'&&fs.realpathSync(path.join(f.directory,'current'))!==f.previous)fs.writeFileSync(config.databasePath,'migrated-database');
  };
  f.adapters.healthy=async()=>f.calls.at(-1)==='start'&&fs.realpathSync(path.join(f.directory,'current'))===f.previous;
  await assert.rejects(deploy(f.config,f.input,f.adapters),/health check/);
  assert.equal(fs.realpathSync(path.join(f.directory,'current')),f.previous);
  assert.equal(fs.readFileSync(f.config.databasePath,'utf8'),'original-database');
  assert.deepEqual(f.calls.filter(x=>typeof x==='string'),['stop','backup','start','stop','restore','start']);
  assert.equal(fs.existsSync(path.join(f.directory,'status.json')),false);
});

test('backup failure restarts the old version without switching or restoring the database',async t=>{
  const f=fixture(t);f.adapters.backup=async()=>{throw Error('disk full');};
  await assert.rejects(deploy(f.config,f.input,f.adapters),/disk full/);
  assert.equal(fs.realpathSync(path.join(f.directory,'current')),f.previous);
  assert.deepEqual(f.calls.filter(x=>typeof x==='string'),['stop','start']);
});

test('SQLite backup restores pre-migration data and removes stale WAL files on rollback',async t=>{
  const f=fixture(t),Database=require('better-sqlite3');
  fs.rmSync(f.config.databasePath);
  fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(f.previous,'node_modules'));
  fs.writeFileSync(path.join(f.previous,'package.json'),'{}');
  let db=new Database(f.config.databasePath);db.pragma('journal_mode=WAL');db.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES (\'retained\')');db.close();
  delete f.adapters.backup;delete f.adapters.restore;
  const original=f.adapters.service;
  f.adapters.service=async(config,action)=>{
    await original(config,action);
    if(action==='start'&&fs.realpathSync(path.join(f.directory,'current'))!==f.previous){
      db=new Database(config.databasePath);db.exec('CREATE TABLE migrated(value TEXT);DELETE FROM original');db.close();
    }
  };
  f.adapters.healthy=async()=>f.calls.at(-1)==='start'&&fs.realpathSync(path.join(f.directory,'current'))===f.previous;
  await assert.rejects(deploy(f.config,f.input,f.adapters),/health check/);
  db=new Database(f.config.databasePath);
  assert.equal(db.prepare('SELECT value FROM original').get().value,'retained');
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='migrated'").get(),undefined);db.close();
});

test('rollback failure is reported and the database backup is kept for recovery',async t=>{
  const f=fixture(t);let starts=0;const original=f.adapters.service;
  f.adapters.service=async(config,action)=>{if(action==='start'&&++starts>1)throw Error('service unavailable');await original(config,action);};
  f.adapters.healthy=async()=>false;
  await assert.rejects(deploy(f.config,f.input,f.adapters),/ROLLBACK FAILED/);
  assert.equal(fs.readdirSync(path.join(f.directory,'backups')).length,1);
});

test('checksum, commit identity and stale runs are rejected before activation',async t=>{
  const f=fixture(t);
  assert.throws(()=>verifyArchive(f.input.archive,'0'.repeat(64)),/checksum/);
  await assert.rejects(deploy(f.config,{...f.input,commit:'b'.repeat(40)},f.adapters),/commit does not match/);
  fs.writeFileSync(path.join(f.directory,'status.json'),JSON.stringify({runId:'11'}));
  await assert.rejects(deploy(f.config,f.input,f.adapters),/older deployment/);
  assert.deepEqual(f.calls,[]);
});

test('archives cannot replace environment, data, or contain links',async t=>{
  const f=fixture(t,{'.env':'overwrite'});
  await assert.rejects(deploy(f.config,f.input,f.adapters),/Unexpected archive path/);
  const source=path.join(f.root,'artifact');fs.rmSync(path.join(source,'.env'));
  fs.symlinkSync(f.root,path.join(source,'server/escape'));
  const archive=path.join(f.root,'linked.tgz');
  assert.equal(spawnSync('tar',['-czf',archive,'-C',source,'server'],{env:{...process.env,COPYFILE_DISABLE:'1'}}).status,0);
  await assert.rejects(unpack(archive,f.previous),/must not contain links/);
  assert.equal(fs.readFileSync(path.join(f.root,'.env'),'utf8'),'private-configuration');
});

test('SSH and systemd quoting preserve paths with spaces, quotes and expansion characters',()=>{
  const value="/tmp/my app/'$HOME`printf ignored`";
  const result=spawnSync('/bin/sh',['-c','printf %s '+quote(value)],{encoding:'utf8'});
  assert.equal(result.status,0);assert.equal(result.stdout,value);
  const unit=override({root:'/tmp/app path',node:'/node',envFile:'/tmp/$env%file'});
  assert.match(unit,/WorkingDirectory="\/tmp\/app path"/);assert.ok(unit.includes('$$env%%file'));
  assert.throws(()=>override({root:'/tmp/a\nb',node:'/node',envFile:'/env'}),/Invalid systemd path/);
});
