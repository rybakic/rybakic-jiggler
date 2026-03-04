const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jigglerApi', {
  getState: () => ipcRenderer.invoke('jiggler:get-state'),
  updateSettings: (settings) => ipcRenderer.invoke('jiggler:update-settings', settings),
  onStateChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jiggler:state', listener);

    return () => ipcRenderer.removeListener('jiggler:state', listener);
  },
});
