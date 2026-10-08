const { app, BrowserWindow, ipcMain, session, safeStorage, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createInterface } = require('node:readline');
const { validateTarget, validateAuthKey, validAuthURL } = require('./validation.cjs');

app.setName('MediaPiayer');
if (!app.requestSingleInstanceLock()) app.quit();
let closingPlayer = false;
let setupWindow, playerWindow, helper, playerSession, authURL = '', connecting = false, shuttingDown = false;
const uiURL = pathToFileURL(path.join(__dirname, 'ui/index.html')).href;
const configFile = () => path.join(app.getPath('userData'), 'connection.json');
const stateDir = () => path.join(app.getPath('userData'), 'tailscale');
let playerConnection = null;
let currentStatus = { type: 'status', value: 'idle' };
function status(value) { currentStatus = value; if (setupWindow && !setupWindow.isDestroyed()) setupWindow.webContents.send('connection:status', value); }
function authorized(event) {
  if (!setupWindow || event.sender !== setupWindow.webContents || event.senderFrame?.url !== uiURL) throw new Error('Operazione non autorizzata.');
}
async function loadSettings() {
  try { return JSON.parse(await fs.readFile(configFile(), 'utf8')); } catch (err) { if (err.code === 'ENOENT') return {}; throw new Error('Configurazione non leggibile. Ripristina il collegamento.'); }
}
function secureStorage() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('Portachiavi sicuro non disponibile. Abilitalo per proteggere il collegamento.');
}
async function closePlayer() {
  closingPlayer = true;
  if (playerWindow && !playerWindow.isDestroyed()) playerWindow.destroy();
  playerWindow = null;
  closingPlayer = false;
  if (playerSession) { await playerSession.clearStorageData(); await playerSession.clearCache(); playerSession = null; }
}
async function revokeDesktopSession() {
  if (!playerSession || !playerConnection) return;
  const { origin, capability } = playerConnection;
  try {
    const cookies = await playerSession.cookies.get({url:`${origin}/api/auth/logout`});
    if (!cookies.some(c => c.name === 'mp_session')) return;
    await new Promise(resolve => {
      const req = require('node:http').request(`${origin}/api/auth/logout`, {method:'POST',headers:{Origin:origin,Cookie:cookies.map(c => `${c.name}=${c.value}`).join('; '),'X-Desktop-Capability':capability},timeout:2000}, response => { response.resume(); response.on('end',resolve); });
      req.on('timeout',() => req.destroy()); req.on('error',resolve); req.end();
    });
  } catch { /* Offline sessions can still be revoked in Profile or from the Pi. */ }
}
async function stopHelper() {
  await revokeDesktopSession();
  playerConnection = null;
  const child = helper; helper = null; connecting = false; authURL = '';
  if (child) {
    const exited = new Promise(resolve => { child.once('exit',resolve); if (child.exitCode !== null) resolve(); });
    child.stdin.end();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve,2000))]);
    if (child.exitCode === null) child.kill();
  }
  await closePlayer();
}
function openSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.show(); setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({ width: 980, height: 730, minWidth: 760, minHeight: 640, backgroundColor: '#101714', title: 'Collega MediaPiayer', webPreferences: { preload: path.join(__dirname,'preload.cjs'), nodeIntegration:false, contextIsolation:true, sandbox:true } });
  setupWindow.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  setupWindow.webContents.on('will-navigate', e => e.preventDefault());
  setupWindow.webContents.session.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  setupWindow.on('closed',() => { setupWindow = null; });
  setupWindow.loadURL(uiURL);
}
async function openPlayer(origin, capability) {
  await closePlayer();
  playerConnection = { origin, capability };
  playerSession = session.fromPartition(`media-${randomBytes(16).toString('hex')}`, { cache:false });
  playerSession.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  playerSession.setPermissionCheckHandler(() => false);
  playerSession.on('will-download', e => e.preventDefault());
  playerSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const u = new URL(details.url);
      const allowed = u.origin === origin || (u.protocol === 'ws:' && u.host === new URL(origin).host) || ['blob:','data:'].includes(u.protocol);
      callback({ cancel:!allowed });
    } catch { callback({ cancel:true }); }
  });
  playerSession.webRequest.onBeforeSendHeaders((details,callback) => {
    const u = new URL(details.url);
    if (u.origin === origin || (u.protocol === 'ws:' && u.host === new URL(origin).host)) details.requestHeaders['X-Desktop-Capability'] = capability;
    callback({requestHeaders:details.requestHeaders});
  });
  playerWindow = new BrowserWindow({width:1280,height:850,minWidth:800,minHeight:600,backgroundColor:'#111',title:'MediaPiayer',webPreferences:{session:playerSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  playerWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  playerWindow.webContents.on('will-navigate',(e,url) => { if (new URL(url).origin !== origin) e.preventDefault(); });
  playerWindow.webContents.on('will-attach-webview',e => e.preventDefault());
  playerWindow.on('closed',() => { playerWindow = null; if (!shuttingDown && !closingPlayer) void stopHelper().then(() => { status({type:'status',value:'idle'}); openSetup(); }); });
  await new Promise((resolve,reject) => {
    const req = require('node:http').get(`${origin}/api/auth/config`, {headers:{'X-Desktop-Capability':capability},timeout:30000}, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data',chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
      response.on('end',() => { try { if (response.statusCode !== 200 || JSON.parse(body).sessionProtocol !== 1) throw new Error(); resolve(); } catch { reject(new Error('Aggiorna il server mediaPiayer prima di collegare questa app.')); } });
    });
    req.on('timeout',() => req.destroy()); req.on('error',reject);
  });
  await playerWindow.loadURL(origin);
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.hide();
}
async function connect(input) {
  if (connecting || helper) throw new Error('Un collegamento è già attivo.');
  const target = validateTarget(input?.target);
  const authKey = validateAuthKey(input?.authKey || '');
  secureStorage();
  const saved = await loadSettings();
  if (saved.target && saved.target !== target) throw new Error('Ripristina il collegamento prima di cambiare Raspberry.');
  let stateKey;
  if (saved.encryptedKey) stateKey = safeStorage.decryptString(Buffer.from(saved.encryptedKey,'base64'));
  else stateKey = randomBytes(32).toString('base64');
  const hostname = saved.hostname || `mediapiayer-${randomBytes(5).toString('hex')}`;
  await fs.mkdir(app.getPath('userData'),{recursive:true,mode:0o700});
  await fs.writeFile(configFile(),JSON.stringify({ target,hostname,encryptedKey:safeStorage.encryptString(stateKey).toString('base64') }),{mode:0o600});
  const capability = randomBytes(32).toString('hex');
  const binary = process.platform === 'win32' ? 'mediapiayer-link.exe' : 'mediapiayer-link';
  const helperPath = app.isPackaged ? path.join(process.resourcesPath,'helper',binary) : path.join(__dirname,'bin',`${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`,binary);
  const child = spawn(helperPath,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:process.env.PATH,HOME:app.getPath('home'),USERPROFILE:app.getPath('home'),SystemRoot:process.env.SystemRoot,TEMP:app.getPath('temp'),TMP:app.getPath('temp')}});
  helper = child; connecting = true;
  status({type:'status',value:'connecting'});
  // stderr may contain library diagnostics; never put them in user logs.
  child.stderr.resume();
  child.on('error',() => { status({type:'error',value:'Componente di collegamento non disponibile. Ricompila o reinstalla l’app.'}); void stopHelper(); });
  child.on('exit',() => {
    if (helper !== child) return;
    helper = null; connecting = false;
    if (currentStatus.type !== 'error') status({type:'error',value:'Collegamento interrotto. Riprova o verifica le autorizzazioni.'});
    void closePlayer().then(() => { if (!shuttingDown) openSetup(); });
  });
  createInterface({input:child.stdout}).on('line',line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (helper !== child) return;
    if (message.type === 'auth-url' && validAuthURL(message.value)) { authURL = message.value; status({type:'login',value:'Accedi a Tailscale nel browser per autorizzare questa app.'}); }
    else if (message.type === 'ready' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.value)) {
      connecting = false; status({type:'status',value:'connected'});
      void openPlayer(message.value,capability).catch(() => { status({type:'error',value:'Impossibile aprire mediaPiayer. Verifica il Raspberry e Tailscale Serve.'}); void stopHelper(); });
    } else if (message.type === 'error') { status({type:'error',value:'Collegamento non riuscito. Verifica chiave, approvazione del dispositivo e connessione.'}); }
  });
  child.stdin.on('error',() => {});
  child.stdin.write(JSON.stringify({target,authKey,stateDir:stateDir(),stateKey,capability,hostname})+'\n');
  stateKey = null;
  return {ok:true};
}
ipcMain.handle('connection:settings',async event => { authorized(event); const saved = await loadSettings(); return { target:saved.target || '',hasIdentity:!!saved.encryptedKey,status:currentStatus }; });
ipcMain.handle('connection:connect',async (event,input) => { authorized(event); return connect(input); });
ipcMain.handle('connection:reset',async event => { authorized(event); await stopHelper(); await fs.rm(stateDir(),{recursive:true,force:true}); await fs.rm(configFile(),{force:true}); status({type:'status',value:'idle'}); return {ok:true}; });
ipcMain.handle('connection:login',async event => { authorized(event); if (!validAuthURL(authURL)) throw new Error('Accesso non disponibile.'); await shell.openExternal(authURL); });
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{role:'appMenu'}] : []),
    {label:'Collegamento',submenu:[{label:'Gestisci collegamento',click:openSetup},{label:'Disconnetti',click:() => { void stopHelper().then(() => { status({type:'status',value:'idle'}); openSetup(); }); }},{role:'quit'}]},
    {role:'editMenu'}, {label:'Visualizza',submenu:[{role:'togglefullscreen'},{role:'zoomIn'},{role:'zoomOut'},{role:'resetZoom'}]},
  ]));
  openSetup();
});
app.on('second-instance',openSetup);
app.on('activate',openSetup);
app.on('window-all-closed',() => { if (!shuttingDown) app.quit(); });
app.on('before-quit',e => { if (shuttingDown) return; e.preventDefault(); shuttingDown = true; void stopHelper().finally(() => app.quit()); });
