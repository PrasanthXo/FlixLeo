const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playInVlc: (streamUrl) => ipcRenderer.invoke('flixleo:play-vlc', streamUrl)
}));
