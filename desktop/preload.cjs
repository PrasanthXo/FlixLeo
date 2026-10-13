const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('flixleoDesktop', Object.freeze({
  playNative: (url, position) => ipcRenderer.invoke('flixleo:play-native', url, position),
  positionNative: (bounds) => ipcRenderer.invoke('flixleo:position-native', bounds),
  tracksNative: () => ipcRenderer.invoke('flixleo:tracks-native'),
  playbackStatus: () => ipcRenderer.invoke('flixleo:playback-status'),
  durationNative: () => ipcRenderer.invoke('flixleo:duration-native'),
  commandNative: (action, value) => ipcRenderer.invoke('flixleo:command-native', action, value),
  stopNative: () => ipcRenderer.invoke('flixleo:stop-native'),
  isFullscreen: () => ipcRenderer.invoke('flixleo:fullscreen-state'),
  setControlsHeight: (physicalPixels) => ipcRenderer.invoke('flixleo:controls-height', physicalPixels),
  onNativeControlsVisible: (callback) => {
    const handler = (_event, value) => { if (typeof value === 'boolean') callback(value); };
    ipcRenderer.on('flixleo:native-controls-visible', handler);
    return () => ipcRenderer.removeListener('flixleo:native-controls-visible', handler);
  },
  onFullscreenChanged: (callback) => {
    const handler = (_event, value) => { if (typeof value === 'boolean') callback(value); };
    ipcRenderer.on('flixleo:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('flixleo:fullscreen-changed', handler);
  }
}));
