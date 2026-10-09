'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');

function readConfig(file) {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
}
function serializeValue(value) {
  value = String(value);
  if (/[\r\n\0]/.test(value)) throw new Error('La configurazione deve contenere valori su una sola riga.');
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error('Il valore non può contenere entrambi i tipi di virgolette.');
}
function writeConfig(file, changes) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const keys = new Set(Object.keys(changes));
  for (const key of keys) if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Chiave di configurazione non valida.');
  const lines = text.split('\n').filter(line => !keys.has(line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)?.[1]));
  for (const [key, value] of Object.entries(changes)) lines.push(`${key}=${serializeValue(value)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, lines.filter((line, index) => line || index < lines.length - 1).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function defaults(config, root = ROOT) {
  return {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000',
    DATABASE_PATH: path.join(root, 'data/mediapiayer.db'),
    MEDIA_DIRS: path.join(root, 'media'), SOCIAL_ENABLED: 'false', ENABLE_DOWNLOADS: 'false',
    ...config,
    JWT_SECRET: config.JWT_SECRET || randomBytes(32).toString('hex'),
  };
}
function validateConfig(config) {
  const issues = [];
  if (Buffer.byteLength(config.JWT_SECRET || '') < 32 || /CHANGE_ME|replace-with/.test(config.JWT_SECRET || '')) issues.push('JWT_SECRET deve essere un segreto casuale di almeno 32 byte.');
  if (!/^\d+$/.test(config.PORT || '') || Number(config.PORT) < 1 || Number(config.PORT) > 65535) issues.push('La porta deve essere compresa tra 1 e 65535.');
  if (!config.HOST || !/^[\w.:-]+$/.test(config.HOST)) issues.push('Indirizzo HOST non valido.');
  if (config.PUBLIC_ORIGIN) {
    for (const origin of config.PUBLIC_ORIGIN.split(',')) {
      try { const url = new URL(origin); if (url.origin !== origin || url.protocol !== 'https:') throw new Error(); }
      catch { issues.push('PUBLIC_ORIGIN deve contenere origini HTTPS esatte, senza slash finale.'); }
    }
  } else if (config.NODE_ENV === 'production') issues.push('Imposta PUBLIC_ORIGIN per il login dal browser in produzione.');
  for (const key of ['DATABASE_PATH', 'MEDIA_DIRS', 'TRANSMISSION_DOWNLOAD_DIR']) {
    if (config[key] && config[key].split(key === 'MEDIA_DIRS' ? ',' : '\0').some(value => !path.isAbsolute(value.trim()))) issues.push(`${key} deve contenere percorsi assoluti.`);
  }
  if (config.TRANSMISSION_URL) {
    try { const url = new URL(config.TRANSMISSION_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { issues.push('Indirizzo RPC Transmission non valido.'); }
  }
  return issues;
}
function prepareDirectories(config, root = ROOT) {
  const directories = new Set([path.join(root, 'data'), path.dirname(config.DATABASE_PATH || path.join(root,'data/mediapiayer.db'))]);
  for (const base of new Set([path.join(root,'media'), ...(config.MEDIA_DIRS || '').split(',').filter(Boolean)])) {
    for (const folder of ['movies', 'series', 'posters', 'music']) directories.add(path.join(base.trim(), folder));
  }
  if (config.TRANSMISSION_DOWNLOAD_DIR) directories.add(config.TRANSMISSION_DOWNLOAD_DIR);
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true });
  return [...directories];
}
function command(file, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: ROOT, stdio: options.capture ? ['pipe','pipe','pipe'] : 'inherit', ...options });
    let stdout = ''; let stderr = '';
    if (options.capture) {
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.stdin.end(options.input || '');
    }
    child.on('error', reject);
    child.on('close', code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && !options.allowFailure) reject(new Error(options.capture ? stderr.trim() || `Comando fallito: ${file}` : `Comando fallito: ${file}, codice ${code}`));
      else resolve(result);
    });
  });
}
async function available(file, args = ['--version']) {
  try { const result = await command(file, args, { capture: true, allowFailure: true, timeout: 5000 }); return result.code === 0; }
  catch { return false; }
}
async function probe(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.PORT || 3000}/api/auth/config`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    return (await response.json()).sessionProtocol === 1;
  } catch { return false; }
}
function unitQuote(value) { return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`; }
function serviceUnit(root, envFile, config, node = process.execPath, argv = [`--env-file=${envFile}`, path.join(root,'server/server.js')]) {
  if ([root,envFile,node].some(value => /[\r\n\0]/.test(value))) throw new Error('Percorso del servizio non valido.');
  return `[Unit]\nDescription=MediaPiayer media server\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${root.replace(/%/g, '%%')}\nExecStart=${[node,...argv].map(value => unitQuote(value).replace(/\$/g, () => '$$')).join(' ')}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nUMask=0077\nNoNewPrivileges=true\n\n[Install]\nWantedBy=default.target\n`;
}
function redact(text, config) {
  let output = String(text).replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'http://[credenziali]@');
  for (const [key,value] of Object.entries(config)) if (/SECRET|PASSWORD|TOKEN|AUTH_KEY/.test(key) && value) output = output.split(value).join('[nascosto]');
  return output.replace(/(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/g, '[autenticazione nascosta]');
}
module.exports = { ROOT, readConfig, writeConfig, defaults, validateConfig, prepareDirectories, command, available, probe, serviceUnit, redact };
