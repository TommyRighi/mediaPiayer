const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
const requested = process.env.HELPER_TARGETS;
const targets = requested ? requested.split(',') : ['darwin-arm64', 'darwin-amd64', 'windows-amd64'];
for (const target of targets) {
  if (!['darwin-arm64','darwin-amd64','windows-amd64','windows-arm64','linux-amd64','linux-arm64'].includes(target)) throw new Error('Unsupported target');
  const [os, arch] = target.split('-');
  const folder = path.join(root,'bin',`${os === 'darwin' ? 'mac' : os === 'windows' ? 'win' : 'linux'}-${arch === 'amd64' ? 'x64' : arch}`);
  fs.mkdirSync(folder,{recursive:true});
  const result = spawnSync(process.env.GO_BINARY || 'go',['build','-trimpath','-ldflags=-s -w','-o',path.join(folder,os === 'windows' ? 'mediapiayer-link.exe' : 'mediapiayer-link'),'.'],{
    cwd:path.join(root,'helper'), env:{...process.env,GOOS:os,GOARCH:arch,CGO_ENABLED:'0'},stdio:'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
