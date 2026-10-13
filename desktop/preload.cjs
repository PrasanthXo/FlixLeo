const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playNative: (url) => ipcRenderer.invoke('flixleo:play-native', url),
  positionNative: (bounds) => ipcRenderer.invoke('flixleo:position-native', bounds),
  commandNative: (action, value) => ipcRenderer.invoke('flixleo:command-native', action, value),
  stopNative: () => ipcRenderer.invoke('flixleo:stop-native')
}));
