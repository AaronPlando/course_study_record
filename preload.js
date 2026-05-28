const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('courseStudyDesktop', {
 isElectron: true,

 getDesktopCaptureSources: options => ipcRenderer.invoke('desktop-capture:get-sources', options || {}),
 startSnippingScreenshot: options => ipcRenderer.invoke('screenshot:start-snipping', options || {}),

 loadDataSync: () => ipcRenderer.sendSync('data:load-sync'),

 saveDataSync: state => ipcRenderer.sendSync('data:save-sync', state),

 exportData: exportObject => ipcRenderer.invoke('data:export', exportObject),

 importData: () => ipcRenderer.invoke('data:import'),

 openDataFolder: () => ipcRenderer.invoke('data:open-folder'),

 createBackup: reason => ipcRenderer.invoke('data:create-backup', reason || 'manual'),

 saveImageDataUrl: payload => ipcRenderer.invoke('image:save-data-url', payload || {}),

 readImageFull: payload => ipcRenderer.invoke('image:read-full', payload || {}),

 onMenuAction: callback => {
  if (typeof callback !== 'function') return () => {};

  const listener = (_event, action) => callback(action);

  ipcRenderer.on('menu:action', listener);

  return () => ipcRenderer.removeListener('menu:action', listener);
 }
});
