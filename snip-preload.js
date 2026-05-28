const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('screenshotSnipper', {
  onInit: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('screenshot-snipper:init', listener);
    return () => ipcRenderer.removeListener('screenshot-snipper:init', listener);
  },
  done: result => ipcRenderer.send('screenshot-snipper:done', result || null)
});
