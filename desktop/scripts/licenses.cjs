const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const dependencies = new Set();
for (const [GOOS, GOARCH] of [['darwin','arm64'],['darwin','amd64'],['windows','amd64']]) {
  const result = spawnSync(process.env.GO_BINARY || 'go',['list','-deps','-f','{{with .Module}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}','.'],{cwd:path.join(root,'helper'),encoding:'utf8',env:{...process.env,GOOS,GOARCH,CGO_ENABLED:'0'}});
  if (result.status !== 0) throw new Error(result.stderr);
  for (const line of result.stdout.trim().split('\n')) if (line) dependencies.add(line);
}
let output = 'Licenses for pinned Go dependencies used in macOS and Windows binaries.\n\n';
const missing = [];
for (const line of dependencies) {
  const [name,version,dir] = line.split('|');
  if (name === 'mediapiayer/desktop/helper' || !dir) continue;
  const files = fs.readdirSync(dir).filter(file => /^(license|copying|notice)([._-].*)?$/i.test(file) && fs.statSync(path.join(dir,file)).isFile());
  if (!files.length) { missing.push(name); continue; }
  output += `\n${'='.repeat(72)}\n${name} ${version}\n`;
  for (const file of files) output += `\n${file}\n${fs.readFileSync(path.join(dir,file),'utf8')}\n`;
}
if (missing.length) throw new Error('Inspect missing dependency licenses: '+missing.join(', '));
fs.mkdirSync(path.join(root,'licenses'),{recursive:true});
fs.writeFileSync(path.join(root,'licenses/go-dependencies.txt'),output);
console.log('Go dependency license notices collected.');
