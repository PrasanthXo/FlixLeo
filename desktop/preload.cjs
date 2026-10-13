const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playNative: (url, position) => ipcRenderer.invoke('flixleo:play-native', url, position),
  positionNative: (bounds) => ipcRenderer.invoke('flixleo:position-native', bounds),
  tracksNative: () => ipcRenderer.invoke('flixleo:tracks-native'),
  playbackStatus: () => ipcRenderer.invoke('flixleo:playback-status'),
  commandNative: (action, value) => ipcRenderer.invoke('flixleo:command-native', action, value),
  stopNative: () => ipcRenderer.invoke('flixleo:stop-native')
}));
