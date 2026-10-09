#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const core = require('./admin/core');
const args = process.argv.slice(2);
const envAt = args.indexOf('--env');
if (envAt >= 0 && (!args[envAt+1] || args[envAt+1].startsWith('--'))) { console.error('Uso: npm run admin -- --env /percorso/config.env'); process.exit(1); }
const envFile = path.resolve(envAt >= 0 ? args[envAt+1] : fs.existsSync('/etc/mediapiayer.env') && fs.existsSync('/etc/systemd/system/mediapiayer.service') ? '/etc/mediapiayer.env' : path.join(core.ROOT,'.env'));
let rl; let muted = false;
const config = () => core.readConfig(envFile);
const errorConfig = () => { try { return config(); } catch { return {}; } };
const color = (text, code = 36) => process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
const title = text => { console.log(`\n${color('MediaPiayer · '+text)}\n${'─'.repeat(Math.min(process.stdout.columns || 60,70))}`); };
const run = (file,argv,options) => core.command(file,argv,options);
async function ask(label, fallback = '', secret = false) {
  const prompt = `${label}${fallback && !secret ? ` [${fallback}]` : ''}: `;
  if (secret) { process.stdout.write(prompt); muted=true; }
  try { const value = (await rl.question(secret ? '' : prompt)).trim(); return value || fallback; }
  finally { if (secret) { muted=false; console.log(''); } }
}
async function confirm(text, word = 'SI') { return await ask(`${text}\nScrivi ${word} per confermare, Invio per annullare`) === word; }
async function worker(action,input = {}) {
  if (!fs.existsSync(path.join(core.ROOT,'node_modules/better-sqlite3'))) throw new Error('Installa prima le dipendenze dal menu Setup.');
  let executable=process.execPath;
  let argv=[path.join(core.ROOT,'scripts/admin/worker.js'),envFile];
  // An existing system service may use a dedicated runtime account. Keep DB and
  // media ownership consistent, sending its configuration through stdin.
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    const target=await serviceTarget();
    if (target && !target.args.length) {
      const owner=await run('systemctl',['show','-p','User','--value','mediapiayer.service'],{capture:true});
      if (owner.stdout && owner.stdout !== 'root') { argv=['-u',owner.stdout,executable,...argv];executable='sudo'; }
    }
  }
  const result = await run(executable,argv, { capture:true, input:JSON.stringify({action,input,config:config()}) });
  try { return JSON.parse(result.stdout.split('\n').at(-1)); } catch { throw new Error('Risposta della console non valida.'); }
}
function show(result) {
  if (Array.isArray(result)) console.table(result);
  else if (result?.password) { console.log(`Utente: ${result.email}\n${color('Password iniziale: '+result.password,33)}\nCopiala ora e cambiala dal profilo dopo il login.`); }
  else if (result?.code) console.log(`${result.message}\n${color(result.code,33)}`);
  else console.log(JSON.stringify(result,null,2));
}
async function menu(name,items) {
  while (true) {
    title(name);
    items.forEach(([label],index) => console.log(`  ${String(index+1).padStart(2)}  ${label}`));
    console.log('   0  '+(name === 'Console SSH' ? 'Esci alla shell' : 'Indietro'));
    const choice = await ask('Scelta','0');
    if (choice === '0' || choice === 'q') return;
    const entry = items[Number(choice)-1];
    if (!/^\d+$/.test(choice) || !entry) { console.log('Scegli uno dei numeri del menu.'); continue; }
    try { await entry[1](); }
    catch (error) { console.error(color(core.redact(error.message,errorConfig()),31)); }
    await ask('Invio per continuare');
  }
}
async function status() {
  const env = config(); title('Stato e diagnostica');
  console.log(`Host: ${os.hostname()} · ${os.platform()} ${os.arch()} · Node ${process.version}`);
  console.log(`RAM libera: ${Math.round(os.freemem()/1024/1024)} MiB / ${Math.round(os.totalmem()/1024/1024)} MiB`);
  console.log(`Configurazione: ${envFile} ${fs.existsSync(envFile) ? '' : '(da creare)'}`);
  console.log(`App locale: ${await core.probe(env) ? 'raggiungibile' : 'non raggiungibile'} · Porta ${env.PORT || 3000}`);
  console.log(`Origine browser: ${env.PUBLIC_ORIGIN || 'da configurare'}`);
  console.log(`Frontend: ${fs.existsSync(path.join(core.ROOT,'server/dist/index.html')) ? 'compilato' : 'da compilare'}`);
  for (const tool of ['npm','git','ffmpeg','ffprobe','tailscale','transmission-daemon','docker']) console.log(`${tool}: ${await core.available(tool, ['ffmpeg','ffprobe'].includes(tool) ? ['-version'] : tool === 'tailscale' ? ['version'] : ['--version']) ? 'disponibile' : 'non disponibile'}`);
  try {
    const temperature = Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp','utf8'));
    if (Number.isFinite(temperature)) console.log(`Temperatura: ${(temperature/1000).toFixed(1)} °C`);
  } catch { /* Virtual hosts and unavailable sensors must not break diagnostics. */ }
  const dbPath = env.DATABASE_PATH || path.join(core.ROOT,'data/mediapiayer.db');
  if (fs.existsSync(dbPath) && fs.existsSync(path.join(core.ROOT,'node_modules/better-sqlite3'))) show(await worker('summary'));
  for (const base of (env.MEDIA_DIRS || path.join(core.ROOT,'media')).split(',')) {
    try { const disk=fs.statfsSync(base.trim()); console.log(`Media: ${base.trim()} · liberi ${(disk.bavail*disk.bsize/1024**3).toFixed(1)} GiB`); }
    catch { console.log(`Media: ${base.trim()} · percorso assente o non accessibile`); }
  }
  for (const issue of core.validateConfig(env)) console.log(color('Da sistemare: '+issue,33));
  const service = await serviceTarget();
  if (service) { const result=await run('systemctl',[...service.args,'is-active','mediapiayer.service'],{capture:true,allowFailure:true});console.log(`Servizio ${service.name}: ${result.stdout || 'non attivo'}`); }
}
async function setupConfig() {
  const previous = config(); const next=core.defaults(previous);
  if (Buffer.byteLength(next.JWT_SECRET || '') < 32 || /CHANGE_ME|replace-with/.test(next.JWT_SECRET)) { next.JWT_SECRET=randomBytes(32).toString('hex'); console.log('Il segreto assente o non valido verrà sostituito con un valore casuale.'); }
  console.log('Le impostazioni esistenti vengono mantenute. Le modifiche richiedono il riavvio del server.');
  next.PORT = await ask('Porta',next.PORT);
  next.HOST = await ask('Indirizzo di ascolto',next.HOST);
  next.PUBLIC_ORIGIN = await ask('Origine HTTPS esatta, ad esempio https://pi.rete.ts.net',next.PUBLIC_ORIGIN || '');
  next.MEDIA_DIRS = await ask('Cartelle media assolute, separate da virgola',next.MEDIA_DIRS);
  next.DATABASE_PATH = await ask('Percorso assoluto del database',next.DATABASE_PATH);
  if (previous.DATABASE_PATH && next.DATABASE_PATH !== previous.DATABASE_PATH && !await confirm('Questo cambia il database usato; non sposta quello esistente. Procedere?')) return;
  const issues=core.validateConfig(next); if (issues.length) throw new Error(issues.join('\n'));
  if (!await confirm(`Salvare la configurazione in ${envFile}?`)) return;
  core.prepareDirectories(next); core.writeConfig(envFile,next);
  console.log('Configurazione salvata con permessi 600. Ora puoi creare l’admin e compilare l’app.');
}
async function dependencies() {
  if (!await confirm('Installare le dipendenze backend/frontend e compilare l’app?')) return;
  await run('npm',['ci']); await run('npm',['ci','--prefix','frontend']); await run('npm',['run','build']);
}
async function systemPackages() {
  if (process.platform !== 'linux') throw new Error('Questa installazione è riservata al Raspberry/Linux.');
  if (!await confirm('Installare tramite apt gli strumenti nativi e ffmpeg? Verrà richiesto sudo.')) return;
  await run('sudo',['apt-get','update']);
  await run('sudo',['apt-get','install','-y','git','build-essential','python3','pkg-config','libsqlite3-dev','libvips-dev','ffmpeg']);
}
async function createUser(role) { const email=await ask('Email'); const name=await ask('Nome'); if (await confirm(`Creare ${email} con ruolo ${role}?`)) show(await worker('create-user',{email,name,role})); }
async function changeUser(action) {
  const email=await ask('Email dell’utente'); const input={email};
  if (action === 'role') input.role=await ask('Nuovo ruolo, admin o viewer','viewer');
  if (await confirm(`${action === 'reset-password' ? 'Generare una nuova password e revocare le sessioni' : action === 'role' ? 'Cambiare il ruolo e revocare le sessioni' : 'Revocare tutte le sessioni'} di ${email}?`)) show(await worker(action,input));
}
async function features() {
  const summary=await worker('summary'); show(summary.features);
  const key=await ask('Funzione: 1 = calendario/party, 2 = download','1');
  if (!['1','2'].includes(key)) throw new Error('Scelta non valida.');
  const name=key === '1' ? 'socialEnabled' : 'downloadsEnabled';
  if (await confirm(`${summary.features[name] ? 'Disattivare' : 'Attivare'} ${name}?`)) show(await worker('features',{[name]:!summary.features[name]}));
}
async function serviceTarget() {
  if (process.platform !== 'linux' || !await core.available('systemctl')) return null;
  const system=await run('systemctl',['cat','mediapiayer.service'],{capture:true,allowFailure:true});
  if (system.code !== 0 && !await core.available('systemctl', ['--user', 'show-environment'])) return null;
  return system.code === 0 ? {args:[],name:'di sistema'} : {args:['--user'],name:'utente'};
}
async function serviceAction(action) {
  const target=await serviceTarget(); if (!target) throw new Error('systemd non disponibile su questo computer.');
  if (['start','stop','restart','enable','disable'].includes(action) && !await confirm(`${action} del servizio ${target.name} MediaPiayer?`)) return;
  if (action === 'status') await run('systemctl',[...target.args,'status','mediapiayer.service','--no-pager'],{allowFailure:true});
  else if (target.args.length) await run('systemctl',[...target.args,action,'mediapiayer.service']);
  else await run('sudo',['systemctl',action,'mediapiayer.service']);
}
async function installService() {
  if (process.platform !== 'linux') throw new Error('Il servizio automatico è disponibile su Linux con systemd.');
  const target=await serviceTarget(); if (!target) throw new Error('systemd non disponibile.');
  if (!target.args.length) throw new Error('Esiste già un servizio di sistema: gestiscilo dal menu Servizio. La sua configurazione non viene sovrascritta.');
  if (process.getuid?.() === 0) throw new Error('Installa il servizio utente con il tuo account SSH normale, non con sudo.');
  const env=config(); const issues=core.validateConfig(env); if (issues.length) throw new Error(issues.join('\n'));
  if (!fs.existsSync(path.join(core.ROOT,'server/dist/index.html'))) throw new Error('Compila prima l’app dal menu Setup.');
  if (!await confirm(`Installare il servizio systemd per l’utente ${os.userInfo().username}, usando ${envFile}?`)) return;
  core.prepareDirectories(env);
  const directory=path.join(os.homedir(),'.config/systemd/user'); fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'mediapiayer.service');
  if (fs.existsSync(file)) fs.copyFileSync(file,file+'.backup-'+Date.now());
  fs.writeFileSync(file,core.serviceUnit(core.ROOT,envFile,env),{mode:0o600});
  await run('systemctl',['--user','daemon-reload']);
  await run('systemctl',['--user','enable','mediapiayer.service']);
  console.log('Servizio installato. Per avviarlo al boot anche senza una sessione SSH serve il linger.');
  if (await confirm('Abilitare il linger per questo utente? Verrà richiesto sudo.')) await run('sudo',['loginctl','enable-linger',os.userInfo().username]);
  if (await confirm('Avviare ora MediaPiayer?')) await run('systemctl',['--user','start','mediapiayer.service']);
}
async function logs() {
  const target=await serviceTarget(); if (!target) throw new Error('journalctl non disponibile su questo computer.');
  const result=await run('journalctl',[...target.args,'-u','mediapiayer.service','-n','80','--no-pager'],{capture:true,allowFailure:true});
  console.log(core.redact(result.stdout || result.stderr,config()));
}
async function tailscale() {
  if (!await core.available('tailscale')) throw new Error('Installa Tailscale sul Raspberry: https://tailscale.com/download/linux');
  await run('tailscale',['status'],{allowFailure:true}); await run('tailscale',['serve','status'],{allowFailure:true});
  if (await confirm('Collegare o verificare il nodo nella tua rete Tailscale? Il comando può mostrare un link di login.')) await run('sudo',['tailscale','up','--hostname','mediapiayer']);
  if (await confirm(`Attivare HTTPS privato con Tailscale Serve verso la porta ${config().PORT || 3000}?`)) {
    await run('sudo',['tailscale','serve','--bg',`http://127.0.0.1:${config().PORT || 3000}`]);
    await run('tailscale',['serve','status']); console.log('Copia l’origine HTTPS mostrata nel menu Configurazione, poi riavvia l’app.');
  }
}
async function transmissionConfig() {
  const env=config(); const next={};
  const url=await ask('Indirizzo RPC senza credenziali','http://127.0.0.1:9091/transmission/rpc');
  const parsed=new URL(url); if (!['http:','https:'].includes(parsed.protocol)) throw new Error('URL RPC non valido.');
  parsed.username=await ask('Utente RPC, vuoto se non richiesto');
  parsed.password=await ask('Password RPC, input nascosto','',true);
  next.TRANSMISSION_URL=parsed.href;
  next.TRANSMISSION_DOWNLOAD_DIR=await ask('Directory assoluta dei download',env.TRANSMISSION_DOWNLOAD_DIR || path.join(core.ROOT,'media/.downloads'));
  if (!path.isAbsolute(next.TRANSMISSION_DOWNLOAD_DIR)) throw new Error('Serve una directory assoluta.');
  if (await confirm('Salvare Transmission? Riavvia poi l’app e abilita i download nel menu Funzioni.')) {
    core.prepareDirectories({...env,...next});core.writeConfig(envFile,next); console.log('Configurazione RPC salvata.');
  }
}
async function installTransmission() {
  if (process.platform !== 'linux') throw new Error('Questa installazione usa apt e systemd sul Raspberry/Linux.');
  if (process.getuid?.() === 0) throw new Error('Per il demone utente esegui la console con il tuo account SSH, non con sudo.');
  if (!await confirm('Installare e configurare Transmission per il tuo utente? Verrà richiesto sudo per apt.')) return;
  await run('sudo',['apt-get','install','-y','transmission-daemon']);
  const active=await run('systemctl',['is-active','--quiet','transmission-daemon'],{capture:true,allowFailure:true});
  const enabled=await run('systemctl',['is-enabled','--quiet','transmission-daemon'],{capture:true,allowFailure:true});
  if (active.code === 0 || enabled.code === 0) {
    if (!await confirm('Il demone di sistema usa la stessa porta: fermarlo e disabilitarlo per usare quello dedicato a MediaPiayer?')) return;
    await run('sudo',['systemctl','disable','--now','transmission-daemon']);
  }
  const env=config(); const directory=path.join(core.ROOT,'data/transmission-user');
  const downloadDir=await ask('Directory assoluta dei download',env.TRANSMISSION_DOWNLOAD_DIR || path.join(core.ROOT,'media/.downloads'));
  if (!path.isAbsolute(downloadDir)) throw new Error('Serve un percorso assoluto.');
  const username='mediapiayer'; const password=randomBytes(24).toString('hex');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.mkdirSync(downloadDir,{recursive:true});
  // Stop our own daemon before reading settings; shutdown persists its state.
  await run('systemctl',['--user','stop','mediapiayer-transmission.service'],{capture:true,allowFailure:true});
  const configFile=path.join(directory,'settings.json');
  let settings={}; if(fs.existsSync(configFile)) { settings=JSON.parse(fs.readFileSync(configFile,'utf8'));fs.copyFileSync(configFile,configFile+'.backup-'+Date.now()); }
  Object.assign(settings,{'download-dir':downloadDir,'incomplete-dir-enabled':false,'rpc-bind-address':'127.0.0.1','rpc-port':9091,'rpc-authentication-required':true,'rpc-username':username,'rpc-password':password,'rpc-whitelist-enabled':true,'rpc-whitelist':'127.0.0.1','rpc-host-whitelist-enabled':true,'rpc-host-whitelist':'localhost,127.0.0.1','rpc-enabled':true,'port-forwarding-enabled':false});
  const version=await run('/usr/bin/transmission-daemon',['--version'],{capture:true,allowFailure:true});
  const match=(version.stdout+' '+version.stderr).match(/(\d+)\.(\d+)/);
  if (match && (Number(match[1]) > 4 || Number(match[1]) === 4 && Number(match[2]) >= 1)) {
    for (const key of Object.keys(settings)) if(key.includes('-')) { const modern=key.replace(/-/g,'_');settings[modern]=settings[key];delete settings[key]; }
  }
  fs.writeFileSync(configFile,JSON.stringify(settings,null,2)+'\n',{mode:0o600});fs.chmodSync(configFile,0o600);
  const unitDir=path.join(os.homedir(),'.config/systemd/user');fs.mkdirSync(unitDir,{recursive:true});
  const unit=core.serviceUnit(core.ROOT,envFile,{...env,TRANSMISSION_DOWNLOAD_DIR:downloadDir},'/usr/bin/transmission-daemon',['--foreground','--config-dir',directory]);
  fs.writeFileSync(path.join(unitDir,'mediapiayer-transmission.service'),unit.replace('Description=MediaPiayer media server','Description=MediaPiayer torrent daemon'),{mode:0o600});
  core.writeConfig(envFile,{TRANSMISSION_URL:`http://${username}:${password}@127.0.0.1:9091/transmission/rpc`,TRANSMISSION_DOWNLOAD_DIR:downloadDir});
  await run('systemctl',['--user','daemon-reload']);await run('systemctl',['--user','enable','--now','mediapiayer-transmission.service']);
  console.log('Transmission configurato con credenziali casuali e RPC su localhost. Riavvia MediaPiayer e abilita i download dal menu Funzioni.');
  if (await confirm('Abilitare l’avvio al boot anche senza SSH?')) await run('sudo',['loginctl','enable-linger',os.userInfo().username]);
}
async function torrentStart() {
  if (!await core.probe(config())) throw new Error('Avvia prima il server MediaPiayer.');
  const title=await ask('Titolo del film'); const magnetUri=await ask('Link magnet');
  if (await confirm(`Scaricare ${title}? Il film sarà guardabile solo quando è pronto.`)) show(await worker('download-start',{title,magnetUri}));
}
async function torrentCancel() { const mediaId=await ask('ID media del download, mostrato nell’elenco'); if (await confirm('Annullare e rimuovere i dati incompleti di questo download?')) show(await worker('download-cancel',{mediaId})); }
async function backup() { show(await worker('backup',{envFile,envContents:fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8'):undefined})); }
async function restore() {
  const file=await ask('Percorso assoluto del backup mediapiayer.db');
  if (!path.isAbsolute(file) || !fs.existsSync(file)) throw new Error('Backup non trovato.');
  console.log('Il ripristino sostituisce il database e revoca le sessioni. I media e la configurazione non vengono sostituiti.');
  if (!await confirm('Ripristinare questo backup?','RIPRISTINA')) return;
  const target=await serviceTarget();
  if (target) {
    const active=await run('systemctl',[...target.args,'is-active','--quiet','mediapiayer.service'],{capture:true,allowFailure:true});
    if (active.code === 0) {
      if (!await confirm('Fermare il servizio prima del ripristino?')) return;
      await run(target.args.length ? 'systemctl' : 'sudo',target.args.length ? [...target.args,'stop','mediapiayer.service'] : ['systemctl','stop','mediapiayer.service']);
    }
  }
  if (await core.probe(config())) throw new Error('Il server è ancora attivo. Fermalo prima di ripristinare il database.');
  show(await worker('restore',{file})); console.log('Puoi riavviare il servizio dal menu Servizio.');
}
async function update() {
  if (fs.existsSync(path.join(core.ROOT,'.deploy/config.json'))) throw new Error('Gli aggiornamenti automatici sono configurati. Usa GitHub Actions → Raspberry deploy; non aggiornare il checkout o le dipendenze della versione iniziale.');
  const dirty=await run('git',['status','--porcelain'],{capture:true});
  if (dirty.stdout) throw new Error('Ci sono modifiche locali: salvale prima. L’aggiornamento non le cancella.');
  if (!await confirm('Aggiornare il branch corrente con git pull --ff-only, installare dipendenze e ricompilare?')) return;
  await backup(); await run('git',['pull','--ff-only']);
  await run('npm',['ci']);await run('npm',['ci','--prefix','frontend']);await run('npm',['run','build']);
  console.log('Aggiornamento e build completati.'); const target=await serviceTarget(); if (target) await serviceAction('restart');
}
async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('MediaPiayer Admin CLI\n\n  npm run admin\n  npm run admin -- --status\n  npm run admin -- --env /etc/mediapiayer.env\n\nRichiede Node 20.19 o successivo. Il menu usa gli stessi permessi dell’utente SSH.\n--status non richiede un terminale interattivo; nessun segreto viene mostrato.');return;
  }
  try { if (fs.existsSync(envFile)) fs.accessSync(envFile,fs.constants.R_OK); } catch { throw new Error('File env non leggibile. Usa --env per selezionare la configurazione, oppure sudo per una installazione di sistema.'); }
  if (!require('../server/runtime').supportsNode(process.versions.node)) throw new Error('La console richiede Node.js 20.19 o successivo, come il backend.');
  if (args.includes('--status')) { await status();return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Serve un terminale interattivo. Usa ssh -t oppure --status.');
  let output=new Writable({write(chunk,encoding,done){if(!muted)process.stdout.write(chunk,encoding);done();}});
  output.isTTY=true;output.columns=process.stdout.columns;
  rl=readline.createInterface({input:process.stdin,output,terminal:true});
  rl.on('SIGINT',()=>{muted=false;rl.close();process.stdout.write('\n');});
  console.log('Amministrazione locale via SSH. Gli account viewer dell’app non hanno accesso a questa console.');
  console.log(`Configurazione: ${envFile}`);
  try {
    await menu('Console SSH',[
      ['Stato e diagnostica',status],
      ['Setup e configurazione',()=>menu('Setup',[
        ['Configurazione guidata / modifica .env',setupConfig],['Installa strumenti Linux e ffmpeg',systemPackages],['Installa dipendenze e compila',dependencies],['Crea il primo amministratore',()=>createUser('admin')],['Installa servizio automatico',installService],['Tailscale: stato e HTTPS privato',tailscale],['Cartelle media: crea struttura',async()=>show(core.prepareDirectories(core.defaults(config())))],
      ])],
      ['Servizio e log',()=>menu('Servizio', [['Stato servizio',()=>serviceAction('status')],['Avvia',()=>serviceAction('start')],['Riavvia',()=>serviceAction('restart')],['Ferma',()=>serviceAction('stop')],['Log recenti',logs],['Abilita al boot',()=>serviceAction('enable')],['Disabilita al boot',()=>serviceAction('disable')]])],
      ['Utenti e inviti',()=>menu('Utenti', [['Elenco utenti',async()=>show(await worker('users'))],['Crea viewer',()=>createUser('viewer')],['Crea amministratore',()=>createUser('admin')],['Invito viewer monouso',async()=>show(await worker('invite'))],['Reset password',()=>changeUser('reset-password')],['Cambia ruolo',()=>changeUser('role')],['Revoca sessioni',()=>changeUser('revoke')]])],
      ['Libreria e conversioni',()=>menu('Libreria', [['Scansiona film e serie',async()=>show(await worker('scan-video'))],['Scansiona musica',async()=>show(await worker('scan-music'))],['Stato conversioni',()=>run(process.execPath,[path.join(core.ROOT,'scripts/transcode.js'),'status'],{env:{...process.env,...config()}})],['Riprova conversioni fallite',async()=>{if(await confirm('Rimettere in coda le conversioni fallite?'))await run(process.execPath,[path.join(core.ROOT,'scripts/transcode.js'),'retry'],{env:{...process.env,...config()}});}],['Rimuovi voci con file mancanti',async()=>{if(await confirm('Rimuovere dal catalogo le voci senza file, inclusi i relativi dati?'))show(await worker('clean'));}]])],
      ['Download torrent',()=>menu('Torrent', [['Stato Transmission e download',async()=>show(await worker('downloads'))],['Configura Transmission',transmissionConfig],['Installa e configura demone Linux',installTransmission],['Scarica un film da magnet',torrentStart],['Annulla download',torrentCancel]])],
      ['Funzioni: calendario, party e download',features],
      ['Backup e ripristino',()=>menu('Backup', [['Backup database e configurazione',backup],['Elenco backup',async()=>{const directory=config().ADMIN_BACKUP_DIR || path.join(core.ROOT,'data/admin-backups');console.log(fs.existsSync(directory)?fs.readdirSync(directory).map(name=>path.join(directory,name,'mediapiayer.db')).join('\n'):'Nessun backup.');}],['Ripristina database',restore]])],
      ['Aggiorna da GitHub e ricompila',update],
    ]);
  } finally { muted=false;rl.close(); }
}
if (require.main === module) main().catch(error=>{console.error(core.redact(error.message,errorConfig()));process.exitCode=1;});
