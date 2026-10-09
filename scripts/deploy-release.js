#!/usr/bin/env node
// Raspberry-side release installation. Native dependencies are installed here,
// never copied from the GitHub runner's x86 build.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: options.capture ? ['ignore','pipe','inherit'] : 'inherit', ...options });
    let output = '';
    if (options.capture) child.stdout.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed (${code})`)));
  });
}
function atomicJson(file, data) {
  const temporary = `${file}.${randomUUID()}`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode:0o600 });
  fs.renameSync(temporary, file);
}
function switchRelease(directory, release) {
  const temporary = path.join(directory, `.current-${randomUUID()}`);
  fs.symlinkSync(release, temporary);
  fs.renameSync(temporary, path.join(directory,'current'));
}
function linkShared(release, config) {
  for (const [name,target] of [['data',path.join(config.root,'data')],['media',path.join(config.root,'media')],['.env',config.envFile]]) {
    if (fs.existsSync(path.join(release,name))) throw new Error(`Release contains persistent path: ${name}`);
    fs.symlinkSync(target,path.join(release,name));
  }
}
function unitQuote(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid systemd path');
  return '"' + value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%').replace(/\$/g,()=>'$$') + '"';
}
function override(config) {
  return `[Service]\nWorkingDirectory=${unitQuote(config.root)}\nExecStart=\nExecStart=${unitQuote(config.node)} ${unitQuote('--env-file='+config.envFile)} ${unitQuote(path.join(config.root,'.deploy/current/server/server.js'))}\n`;
}
function service(config, action) {
  return config.mode === 'user' ? run('systemctl',['--user',action,config.service]) : run('sudo',['-n','systemctl',action,config.service]);
}
async function healthy(config) {
  try {
    const response = await fetch(config.healthUrl,{ signal:AbortSignal.timeout(2000) });
    return response.ok && (await response.json()).sessionProtocol === 1;
  } catch { return false; }
}
async function waitHealthy(config, check = healthy) {
  const deadline = Date.now() + config.healthTimeoutMs;
  do {
    if (await check(config)) return;
    await new Promise(resolve => setTimeout(resolve,500));
  } while (Date.now() < deadline);
  throw new Error('The new service did not pass its health check');
}
async function backupDatabase(config, previous, target) {
  if (!fs.existsSync(config.databasePath)) return false;
  const Database = require(require.resolve('better-sqlite3',{ paths:[previous] }));
  const db = new Database(config.databasePath,{ readonly:true });
  try { await db.backup(target); } finally { db.close(); }
  fs.chmodSync(target,0o600);
  return true;
}
function restoreDatabase(config, backup, existed) {
  for (const suffix of ['-wal','-shm']) fs.rmSync(config.databasePath+suffix,{ force:true });
  if (existed) {
    const temporary = config.databasePath + '.restore-' + randomUUID();
    fs.copyFileSync(backup,temporary); fs.chmodSync(temporary,0o600);
    fs.renameSync(temporary,config.databasePath);
  } else fs.rmSync(config.databasePath,{ force:true });
}
function verifyArchive(archive, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest) || createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== digest) throw new Error('Release checksum does not match');
}
async function unpack(archive, release) {
  const entries = (await run('tar',['-tzf',archive],{ capture:true })).split('\n');
  for (const entry of entries) {
    if (entry.includes('..') || entry.startsWith('/') || !/^(server\/|scripts\/verify-build\.js$|scripts\/$|package(?:-lock)?\.json$|release\.json$)/.test(entry)) throw new Error('Unexpected archive path');
  }
  const details = (await run('tar',['-tvzf',archive],{ capture:true })).split('\n');
  if (details.some(line => !['-','d'].includes(line[0]))) throw new Error('Release archives must not contain links or special files');
  await run('tar',['-xzf',archive,'-C',release]);
}
async function deploy(config, input, adapters = {}) {
  const directory = path.join(config.root,'.deploy');
  const execute = adapters.run || run, control = adapters.service || service;
  const check = adapters.healthy || healthy, save = adapters.backup || backupDatabase;
  const restore = adapters.restore || restoreDatabase;
  if (!/^[a-f0-9]{40}$/.test(input.commit) || !/^\d+$/.test(input.runId)) throw new Error('Invalid release identity');
  const statusFile = path.join(directory,'status.json');
  const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile,'utf8')) : {};
  if (status.runId && BigInt(input.runId) < BigInt(status.runId)) throw new Error('Refusing an older deployment run');
  verifyArchive(input.archive,input.digest);
  const previous = fs.realpathSync(path.join(directory,'current'));
  const release = path.join(directory,'releases',`${input.commit.slice(0,12)}-${input.runId}-${randomUUID()}`);
  fs.mkdirSync(release,{ mode:0o700 });
  let stopped = false, switched = false, backupDone = false, existed = false;
  const backup = path.join(directory,'backups',path.basename(release)+'.db');
  try {
    await unpack(input.archive,release);
    const metadata = JSON.parse(fs.readFileSync(path.join(release,'release.json'),'utf8'));
    if (metadata.commit !== input.commit) throw new Error('Release commit does not match');
    await execute(config.npm,['ci','--omit=dev','--no-audit','--no-fund'],{ cwd:release,env:{ ...process.env,PATH:path.dirname(config.node)+path.delimiter+(process.env.PATH || '') } });
    await execute(config.node,['scripts/verify-build.js'],{ cwd:release });
    await execute(config.node,['-e',"require('sharp');require('bcrypt');const D=require('better-sqlite3');new D(':memory:').close()"],{ cwd:release });
    linkShared(release,config);
    // Everything expensive happens before interrupting existing playback.
    await control(config,'stop'); stopped = true;
    if (await check(config)) throw new Error('The old server is still listening after service stop');
    existed = await save(config,previous,backup); backupDone = true;
    switchRelease(directory,release); switched = true;
    await control(config,'start');
    await waitHealthy(config,check);
    atomicJson(statusFile,{ commit:input.commit,runId:input.runId,release,previous,backup:existed ? backup : null,deployedAt:new Date().toISOString() });
    console.log(`Deployment ready: ${input.commit}`);
  } catch (error) {
    if (stopped) {
      try {
        if (switched) { await control(config,'stop'); switchRelease(directory,previous); }
        if (switched && backupDone) restore(config,backup,existed);
        await control(config,'start'); await waitHealthy(config,check);
        console.error('Previous release restored.');
      } catch (rollbackError) { throw new Error(`${error.message}; ROLLBACK FAILED: ${rollbackError.message}. Inspect systemd logs and .deploy/backups.`); }
    }
    if (!switched) fs.rmSync(release,{ recursive:true,force:true });
    throw error;
  }
}
async function setup(options) {
  if (process.platform !== 'linux') throw new Error('Setup requires Linux with systemd');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24 for setup and deployment');
  const root = fs.realpathSync(options.root || process.cwd());
  const envFile = fs.realpathSync(options['env-file'] || path.join(root,'.env'));
  const env = parseEnv(fs.readFileSync(envFile,'utf8'));
  if (env.NODE_ENV !== 'production' || !env.PUBLIC_ORIGIN) throw new Error('Set NODE_ENV=production and PUBLIC_ORIGIN in the environment file first');
  const mode = options.mode || 'user', name = options.service || 'mediapiayer.service';
  if (!['user','system'].includes(mode) || !/^[A-Za-z0-9_.@-]+\.service$/.test(name)) throw new Error('Invalid systemd service');
  const args = mode === 'user' ? ['--user'] : [];
  await run('systemctl',[...args,'cat',name],{ capture:true });
  const owner = await run('systemctl',[...args,'show','-p','User','--value',name],{ capture:true });
  if (mode === 'system' && owner !== os.userInfo().username) throw new Error('Run setup as the service runtime user, using sudo only for systemctl');
  const directory = path.join(root,'.deploy');
  if (fs.existsSync(path.join(directory,'config.json'))) throw new Error('Auto deploy is already configured');
  if (fs.existsSync(path.join(directory,'current')) || fs.existsSync(path.join(directory,'releases/bootstrap'))) throw new Error('Incomplete setup exists in .deploy. Inspect it before retrying');
  for (const folder of ['releases','backups']) fs.mkdirSync(path.join(directory,folder),{ recursive:true,mode:0o700 });
  for (const folder of ['data','media']) fs.mkdirSync(path.join(root,folder),{ recursive:true });
  const config = { root,envFile,mode,service:name,node:process.execPath,npm:options.npm || path.join(path.dirname(process.execPath),'npm'),
    databasePath:path.resolve(root,env.DATABASE_PATH || 'data/mediapiayer.db'),healthUrl:`http://127.0.0.1:${env.PORT || 3000}/api/auth/config`,healthTimeoutMs:30000 };
  if (!fs.existsSync(config.npm) || !fs.existsSync(path.join(root,'node_modules/better-sqlite3'))) throw new Error('Install Node 24 and the existing backend dependencies first');
  if (!await healthy(config)) throw new Error('The existing server must pass its health check before setup');
  const bootstrap = path.join(directory,'releases','bootstrap');
  if (!fs.existsSync(path.join(root,'server/dist/index.html'))) throw new Error('Build and start the existing application before setup');
  const targetDirectory = mode === 'user' ? path.join(os.homedir(),'.config/systemd/user',name+'.d') : path.join('/etc/systemd/system',name+'.d');
  const overrideFile = path.join(targetDirectory,'auto-deploy.conf');
  if (fs.existsSync(overrideFile)) throw new Error('A deployment systemd override already exists');
  let installed = false;
  try {
  fs.mkdirSync(bootstrap,{ recursive:true });
  fs.cpSync(path.join(root,'server'),path.join(bootstrap,'server'),{ recursive:true });
  fs.copyFileSync(path.join(root,'package.json'),path.join(bootstrap,'package.json'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(bootstrap,'node_modules'));
  linkShared(bootstrap,config); switchRelease(directory,bootstrap);
  const file = path.join(directory,'auto-deploy.conf'); fs.writeFileSync(file,override(config),{ mode:0o600 });
  if (mode === 'user') { fs.mkdirSync(targetDirectory,{ recursive:true }); fs.copyFileSync(file,overrideFile); }
  else { await run('sudo',['-n','mkdir','-p',targetDirectory]); await run('sudo',['-n','install','-m','644',file,overrideFile]); }
  installed = true;
  await run(mode === 'user' ? 'systemctl' : 'sudo', mode === 'user' ? ['--user','daemon-reload'] : ['-n','systemctl','daemon-reload']);
  await service(config,'restart'); await waitHealthy(config);
  atomicJson(path.join(directory,'config.json'),config);
  console.log('Auto deploy configured. Set these GitHub repository variables:');
  console.log(`RPI_DEPLOY_ROOT=${root}\nRPI_NODE_PATH=${config.node}\nRPI_SSH_USER=${os.userInfo().username}`);
  } catch (error) {
    if (installed) {
      if (mode === 'user') fs.rmSync(overrideFile,{ force:true });
      else await run('sudo',['-n','rm','--',overrideFile]);
      await run(mode === 'user' ? 'systemctl' : 'sudo',mode === 'user' ? ['--user','daemon-reload'] : ['-n','systemctl','daemon-reload']);
      await service(config,'restart');
    }
    fs.rmSync(path.join(directory,'current'),{force:true});
    fs.rmSync(bootstrap,{recursive:true,force:true});
    throw error;
  }
}
function parseArguments(argv) {
  const result = { command:argv[0] };
  for (let i=1;i<argv.length;i++) {
    if (argv[i] === '--locked') result.locked = true;
    else if (argv[i].startsWith('--') && argv[i+1] && !argv[i+1].startsWith('--')) result[argv[i].slice(2)] = argv[++i];
    else throw new Error('Invalid deployment argument');
  }
  return result;
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'setup') return setup(options);
  if (options.command !== 'apply' || !options.root) throw new Error('Usage: deploy-release.js setup --root PATH --env-file PATH --mode user|system; or apply --root PATH --archive FILE --digest SHA256 --commit SHA --run-id ID');
  const root = fs.realpathSync(options.root), directory = path.join(root,'.deploy');
  const config = JSON.parse(fs.readFileSync(path.join(directory,'config.json'),'utf8'));
  if (root !== config.root) throw new Error('Deployment root does not match configuration');
  if (!options.locked) return run('flock',['-n',path.join(directory,'deploy.lock'),process.execPath,__filename,...process.argv.slice(2),'--locked']);
  await deploy(config,{ archive:options.archive,digest:options.digest,commit:options.commit,runId:options['run-id'] });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { deploy,verifyArchive,unpack,override,parseArguments,switchRelease,linkShared };
