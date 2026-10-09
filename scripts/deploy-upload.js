#!/usr/bin/env node
// Runs on GitHub. Credentials are read from environment, never interpolated into
// workflow shell source, and SSH host keys must be supplied independently.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const quote = value => "'" + value.replace(/'/g,"'\\''") + "'";
function run(command,args,capture=false) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{ stdio:capture ? ['ignore','pipe','inherit'] : 'inherit' });
    let output='';if(capture)child.stdout.on('data',data=>{output+=data;});
    child.once('error',reject);child.once('close',code=>code===0?resolve(output.trim()):reject(new Error(`${command} failed (${code})`)));
  });
}
async function main() {
  const env=process.env;
  for(const name of ['RPI_HOST','RPI_SSH_USER','RPI_DEPLOY_ROOT','RPI_NODE_PATH','RPI_SSH_KEY','RPI_KNOWN_HOSTS','GITHUB_SHA','GITHUB_RUN_ID']) if(!env[name])throw new Error(`Missing ${name}`);
  if(!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(env.RPI_HOST)||!/^[a-z_][a-z0-9_-]*$/i.test(env.RPI_SSH_USER))throw new Error('Invalid SSH host or user');
  if(!env.RPI_DEPLOY_ROOT.startsWith('/')||!env.RPI_NODE_PATH.startsWith('/')||/[\r\n\0]/.test(env.RPI_DEPLOY_ROOT+env.RPI_NODE_PATH))throw new Error('Use absolute Raspberry paths');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-ssh-'));fs.chmodSync(temporary,0o700);
  let remote;
  const target=env.RPI_SSH_USER+'@'+env.RPI_HOST;
  const options=['-i',path.join(temporary,'key'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+path.join(temporary,'hosts'),'-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4'];
  try {
    fs.writeFileSync(path.join(temporary,'key'),env.RPI_SSH_KEY+'\n',{mode:0o600});
    fs.writeFileSync(path.join(temporary,'hosts'),env.RPI_KNOWN_HOSTS+'\n',{mode:0o600});
    remote=await run('ssh',[...options,target,'umask 077; mktemp -d /tmp/mediapiayer-upload.XXXXXXXX'],true);
    if(!/^\/tmp\/mediapiayer-upload\.[A-Za-z0-9]+$/.test(remote))throw new Error('Invalid remote upload directory');
    const archive=path.resolve('release.tgz'),digest=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    await run('scp',[...options,archive,path.resolve('scripts/deploy-release.js'),target+':'+remote+'/']);
    const command=[env.RPI_NODE_PATH,remote+'/deploy-release.js','apply','--root',env.RPI_DEPLOY_ROOT,'--archive',remote+'/release.tgz','--digest',digest,'--commit',env.GITHUB_SHA,'--run-id',env.GITHUB_RUN_ID].map(quote).join(' ');
    await run('ssh',[...options,target,command]);
  } finally {
    if(remote&&/^\/tmp\/mediapiayer-upload\.[A-Za-z0-9]+$/.test(remote))await run('ssh',[...options,target,'rm -rf -- '+quote(remote)]).catch(()=>{});
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={quote};
