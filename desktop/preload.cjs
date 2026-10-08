const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('connection', {
  settings: () => ipcRenderer.invoke('connection:settings'),
  connect: input => ipcRenderer.invoke('connection:connect', input),
  reset: () => ipcRenderer.invoke('connection:reset'),
  openLogin: () => ipcRenderer.invoke('connection:login'),
  onStatus: callback => { const handler = (_event, status) => callback(status); ipcRenderer.on('connection:status', handler); return () => ipcRenderer.removeListener('connection:status', handler); },
});
