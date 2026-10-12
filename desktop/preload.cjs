const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playNative: (streamUrl) => ipcRenderer.invoke('flixleo:play-native', streamUrl)
}));
