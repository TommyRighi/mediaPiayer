// Native Electron integration check. Run: npx electron tests/smoke.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'mediapiayer-electron-smoke-'));
app.setPath('userData',temp);
let timeout;
app.whenReady().then(() => {
  timeout = setTimeout(() => { console.error('Electron smoke timed out'); app.exit(1); },20000);
  const timer = setInterval(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.webContents.isLoading()) return;
    clearInterval(timer);
    try {
      assert.equal(win.webContents.getLastWebPreferences().sandbox,true);
      assert.equal(win.webContents.getLastWebPreferences().contextIsolation,true);
      assert.equal(win.webContents.getLastWebPreferences().nodeIntegration,false);
      const result = await win.webContents.executeJavaScript(`(async()=>{
        const settings=await window.connection.settings();
        let rejected=false;try{await window.connection.connect({target:'http://evil.example',authKey:''})}catch{rejected=true}
        return {heading:document.querySelector('h2').textContent,hasIdentity:settings.hasIdentity,rejected,nodeAccess:typeof require};
      })()`);
      assert.equal(result.heading,'Entra nella biblioteca.');assert.equal(result.hasIdentity,false);assert.equal(result.rejected,true);assert.equal(result.nodeAccess,'undefined');
      fs.mkdirSync(path.join(__dirname,'../release'),{recursive:true});
      fs.writeFileSync(path.join(__dirname,'../release/setup-preview.png'),(await win.capturePage()).toPNG());
      console.log('Electron smoke passed: sandbox, isolated preload, IPC validation, onboarding.');
      clearTimeout(timeout); app.quit();
    } catch(err) { console.error(err);app.exit(1); }
  },100);
});
require('../main.cjs');
app.on('quit',()=>fs.rmSync(temp,{recursive:true,force:true}));
