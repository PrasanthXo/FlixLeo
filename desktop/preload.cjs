const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playNative: (url) => ipcRenderer.invoke('flixleo:play-native', url),
  positionNative: (bounds) => ipcRenderer.invoke('flixleo:position-native', bounds),
  stopNative: () => ipcRenderer.invoke('flixleo:stop-native')
}));
