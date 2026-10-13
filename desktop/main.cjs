const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const WEBSITE = 'https://flixleo.cyou';
let mainWindow = null;
let playing = false;
let previousUrl = WEBSITE;
let lastBounds = null;
let nativeProcess = null;
let embedProcess = null;
let mpvPipe = null;
let mpvSerial = 0;
function trusted(event) {
  try {
    const url = new URL(event.senderFrame?.url || '');
    return url.origin === WEBSITE && event.senderFrame === event.sender.mainFrame;
  } catch { return false; }
}
function nativeExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mpv', 'mpv.exe')
    : path.join(__dirname, 'vendor', 'mpv', 'mpv.exe');
}
function stopPlayer() {
  mpvPipe = null;
  if (embedProcess) { try { embedProcess.kill(); } catch {} embedProcess = null; }
  if (nativeProcess) {
    try { nativeProcess.kill(); } catch {}
    nativeProcess = null;
  }
}
function toggleVideoFullscreen(win) {
  if (!win || win.isDestroyed()) return false;
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  if (embedProcess?.stdin?.writable) embedProcess.stdin.write(next ? 'FULLSCREEN\n' : 'RESTORE\n');
  return next;
}
function validUrl(input) {
  if (typeof input !== 'string' || input.length > 8192) return null;
  try {
    const target = new URL(input);
    if (target.protocol !== 'https:' || target.username || target.password ||
      !target.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal|test)$/.test(target.hostname)) return null;
    return target.href;
  } catch { return null; }
}
function backToFlixLeo() {
  if (!playing) return;
  playing = false;
  stopPlayer();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitle('FlixLeo');
}
ipcMain.handle('flixleo:play-native', async (event, streamUrl, resumeSeconds = 0) => {
  if (!trusted(event)) return { ok:false, error:'Untrusted page' };
  const url = validUrl(streamUrl);
  if (!url) return { ok:false, error:'Unsupported stream URL' };
  const executable = nativeExecutable();
  if (!fs.existsSync(executable)) return { ok:false, error:'Built-in native player is missing. Install the updated FlixLeo Windows version.' };
  const win = mainWindow;
  if (!win || win.isDestroyed()) return { ok:false, error:'FlixLeo window is unavailable' };
  if (process.platform !== 'win32') return { ok:false, error:'Native playback is supported only on Windows.' };
  // The Win32 helper attaches mpv as a child surface inside the Electron window.
  // Keep Chromium mounted for FlixLeo navigation and native playback controls.
  stopPlayer();
  playing = true;
  win.setTitle('FlixLeo');
  const handle = win.getNativeWindowHandle();
  const id = process.arch === 'x64'
    ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0));
  const helper = app.isPackaged
    ? path.join(process.resourcesPath, 'mpv', 'FlixLeoEmbed.exe')
    : path.join(__dirname, 'vendor', 'mpv', 'FlixLeoEmbed.exe');
  if (!fs.existsSync(helper)) { backToFlixLeo(); return { ok:false, error:'FlixLeo video embedding component is missing.' }; }
  mpvPipe = `\\\\.\\pipe\\flixleo-mpv-${process.pid}-${++mpvSerial}`;
  // The child mpv window receives native mouse input directly.
  // Disable its own double-click fullscreen shortcut, otherwise Electron
  // and mpv would each independently toggle fullscreen on one gesture.
  const mpvInputConf = path.join(app.getPath('userData'), 'flixleo-embedded-input.conf');
  let inputOverrides = [];
  try {
    fs.mkdirSync(path.dirname(mpvInputConf), { recursive:true });
    fs.writeFileSync(mpvInputConf, 'MBTN_LEFT_DBL ignore\n', 'utf8');
    inputOverrides = [`--input-conf=${mpvInputConf}`];
  } catch {
    // Prevent double toggles if the user's application data is read-only.
    inputOverrides = ['--no-input-default-bindings'];
  }
  const args = [
    '--no-config', '--no-terminal', '--force-window=yes', '--idle=no',
    '--keep-open=no', '--osc=yes', '--input-default-bindings=yes',
    '--input-cursor=yes', '--cursor-autohide=3000',
    ...inputOverrides,
    // Modern minimal overlay; disappears shortly after mouse movement.
    '--script-opts=osc-visibility=auto,osc-layout=bottombar,osc-hidetimeout=2000,osc-fadeduration=180,osc-deadzonesize=0,osc-scalewindowed=1.7,osc-scalefullscreen=1.8',
    `--input-ipc-server=${mpvPipe}`,
    '--hwdec=auto-safe', '--border=no', '--geometry=1280x720',
    '--keepaspect=yes', '--keepaspect-window=no', '--video-aspect-override=no',
    '--title=FlixLeo', '--user-agent=FlixLeoDesktop/1.0',
    ...(Number.isFinite(resumeSeconds) && resumeSeconds >= 5 && resumeSeconds < 86400 ? [`--start=${Math.floor(resumeSeconds)}`] : []),
    '--', url
  ];
  try {
    const proc = spawn(executable, args, { windowsHide:true, stdio:'ignore', cwd:path.dirname(executable) });
    nativeProcess = proc;
    const helperProc = spawn(helper, [id, String(proc.pid)], {
      windowsHide:true, stdio:['pipe', 'pipe', 'pipe']
    });
    embedProcess = helperProc;
    if (lastBounds) helperProc.stdin.write(lastBounds.join(',') + '\n');
    let embedded = false;
    let embedStdoutBuffer = '';
    helperProc.stdout.on('data', chunk => {
      embedStdoutBuffer += String(chunk);
      let end;
      while ((end = embedStdoutBuffer.indexOf('\n')) >= 0) {
        const line = embedStdoutBuffer.slice(0, end).trim();
        embedStdoutBuffer = embedStdoutBuffer.slice(end + 1);
        if (line === 'EMBEDDED') {
          embedded = true;
          if (win.isFullScreen() && helperProc.stdin.writable) helperProc.stdin.write('FULLSCREEN\n');
        }
        if ((line === 'CONTROLS_VISIBLE' || line === 'CONTROLS_HIDDEN') && !win.isDestroyed())
          win.webContents.send('flixleo:native-controls-visible', line === 'CONTROLS_VISIBLE');
        if (line === 'VIDEO_DOUBLE_CLICK' && playing && nativeProcess === proc &&
            embedProcess === helperProc && !win.isDestroyed()) toggleVideoFullscreen(win);
      }
    });
    helperProc.on('exit', code => {
      if (!embedded && nativeProcess === proc && playing) {
        backToFlixLeo();
        dialog.showMessageBox(win, { type:'error', title:'FlixLeo video',
          message:'The native video window could not be embedded (code ' + code + ').' });
      }
    });
    proc.on('error', () => { backToFlixLeo(); });
    proc.on('exit', () => { if (nativeProcess === proc) backToFlixLeo(); });
    win.focus();
    return { ok:true };
  } catch {
    backToFlixLeo();
    return { ok:false, error:'Unable to start native playback.' };
  }
});
// Control the embedded decoder instead of attempting to control the unused HTML video.
ipcMain.handle('flixleo:command-native', async (event, action, value) => {
  if (!trusted(event) || !playing || !mpvPipe) return false;
  const commands = {
    togglePause: ['cycle', 'pause'],
    seekBackward: ['seek', -10, 'relative'],
    seekForward: ['seek', 10, 'relative'],
    toggleMute: ['cycle', 'mute'],
    toggleSubtitles: ['cycle', 'sub-visibility'],
    disableSubtitles: ['set_property', 'sid', 'no'],
    nextAudio: ['cycle', 'audio'],
    nextSubtitle: ['cycle', 'sub'],
  };
  let command = commands[action];
  if (action === 'setAudioTrack' && Number.isInteger(value) && value >= 0) command = ['set_property','aid',value];
  if (action === 'setSubtitleTrack' && Number.isInteger(value) && value >= 0) command = ['set_property','sid',value];
  if (action === 'seekTo' && Number.isFinite(value) && value >= 0 && value <= 864000) command = ['seek', Number(value), 'absolute'];
  if (action === 'setAspectRatio' && ['no', '16:9', '4:3', '21:9', '1:1'].includes(value))
    command = ['set_property', 'video-aspect-override', value];
  if (action === 'toggleFullscreen') { toggleVideoFullscreen(mainWindow); return true; }
  if (action === 'setVolume' && Number.isFinite(value)) command = ['set_property', 'volume', Math.max(0, Math.min(100, Number(value)))];
  if (!command) return false;
  return await new Promise(resolve => {
    const socket = net.connect(mpvPipe);
    const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 1800);
    socket.once('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.once('data', data => {
      clearTimeout(timeout);
      socket.end();
      try { resolve(JSON.parse(String(data).trim()).error === 'success'); } catch { resolve(false); }
    });
    socket.once('error', () => { clearTimeout(timeout); resolve(false); });
    socket.once('close', () => { clearTimeout(timeout); resolve(false); });
  });
});
ipcMain.handle('flixleo:tracks-native', async (event) => {
  if (!trusted(event) || !playing || !mpvPipe) return { audio:[], subtitles:[] };
  return await new Promise(resolve => {
    const socket = net.connect(mpvPipe);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ audio:[], subtitles:[] }), 1200);
    socket.once('connect', () => socket.write(JSON.stringify({ command:['get_property','track-list'] }) + '\n'));
    socket.once('data', data => {
      try {
        const response = JSON.parse(String(data).split('\n')[0]);
        const tracks = Array.isArray(response.data) ? response.data : [];
        const mapped = type => tracks.filter(t => t.type === type).map(t => ({
          id:t.id, selected:!!t.selected, language:typeof t.lang === 'string' ? t.lang : '',
          title:typeof t.title === 'string' ? t.title : ''
        }));
        finish({ audio:mapped('audio'), subtitles:mapped('sub') });
      } catch { finish({ audio:[], subtitles:[] }); }
    });
    socket.once('error', () => finish({ audio:[], subtitles:[] }));
    socket.once('close', () => finish({ audio:[], subtitles:[] }));
  });
});
ipcMain.handle('flixleo:playback-status', async (event) => {
  if (!trusted(event) || !playing || !mpvPipe) return { ready:false };
  return await new Promise(resolve => {
    const socket = net.connect(mpvPipe);
    let completed = false;
    const finish = value => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ready:false }), 1100);
    socket.once('connect', () => socket.write(JSON.stringify({ command:['get_property','time-pos'] }) + '\n'));
    socket.once('data', data => {
      try {
        const response = JSON.parse(String(data).trim().split('\n')[0]);
        finish({ ready:response.error === 'success' && typeof response.data === 'number' && response.data >= 0, position: typeof response.data === 'number' ? response.data : 0 });
      } catch { finish({ ready:false }); }
    });
    socket.once('error', () => finish({ ready:false }));
    socket.once('close', () => finish({ ready:false }));
  });
});
ipcMain.handle('flixleo:duration-native', async (event) => {
  if (!trusted(event) || !playing || !mpvPipe) return 0;
  return await new Promise(resolve => {
    const socket = net.connect(mpvPipe);
    let finished = false;
    const finish = duration => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(duration);
    };
    const timeout = setTimeout(() => finish(0), 1300);
    socket.once('connect', () => socket.write(JSON.stringify({ command:['get_property', 'duration'] }) + '\n'));
    socket.once('data', data => {
      try {
        const response = JSON.parse(String(data).split('\n')[0]);
        finish(response.error === 'success' && Number.isFinite(response.data) ? Math.max(0, response.data) : 0);
      } catch { finish(0); }
    });
    socket.once('error', () => finish(0));
    socket.once('close', () => finish(0));
  });
});
ipcMain.handle('flixleo:controls-height', (event, height) => {
  if (!trusted(event) || !Number.isFinite(height) || !embedProcess?.stdin?.writable) return false;
  embedProcess.stdin.write('CONTROL_HEIGHT ' + Math.max(48, Math.min(300, Math.round(height))) + '\n');
  return true;
});
ipcMain.handle('flixleo:fullscreen-state', (event) => {
  return trusted(event) && Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen());
});
ipcMain.handle('flixleo:stop-native', (event) => {
  if (!trusted(event)) return false;
  backToFlixLeo();
  return true;
});
ipcMain.handle('flixleo:position-native', (event, bounds) => {
  if (!trusted(event) || !Array.isArray(bounds) || bounds.length !== 4 ||
      !bounds.every(x => Number.isFinite(x) && x >= 0 && x < 20000)) return false;
  lastBounds = bounds.map(Math.round);
  if (embedProcess?.stdin?.writable) embedProcess.stdin.write(lastBounds.join(',') + '\n');
  return true;
});
function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 850, minWidth: 850, minHeight: 560,
    title:'FlixLeo', backgroundColor:'#080a0f',
    webPreferences: {
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true
    }
  });
  mainWindow = win;
  // Fullscreen is controlled by Electron's window, not by the mpv child window.
  // F11 works even if native-video controls are unavailable.
  win.on('leave-full-screen', () => {
    if (playing && embedProcess?.stdin?.writable) embedProcess.stdin.write('RESTORE\n');
    win.webContents.send('flixleo:fullscreen-changed', false);
  });
  win.on('enter-full-screen', () => {
    if (playing && embedProcess?.stdin?.writable) embedProcess.stdin.write('FULLSCREEN\n');
    win.webContents.send('flixleo:fullscreen-changed', true);
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleVideoFullscreen(win);
      return;
    }
    if (playing && input.alt && input.key === 'Left') {
      event.preventDefault();
      backToFlixLeo();
    }
  });
  win.on('focus', () => {
    if (!globalShortcut.isRegistered('F11')) globalShortcut.register('F11', () => {
      if (!win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
    });
  });
  win.on('blur', () => globalShortcut.unregister('F11'));
  win.on('closed', () => globalShortcut.unregister('F11'));
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({url})=>{
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return {action:'deny'};
  });
  win.webContents.on('will-navigate',(event,url)=>{
    try {
      if (new URL(url).origin!==WEBSITE) { event.preventDefault(); shell.openExternal(url); }
    } catch { event.preventDefault(); }
  });
  win.loadURL(WEBSITE);
}
app.whenReady().then(()=>{
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed',()=>{stopPlayer();if(process.platform!=='darwin')app.quit()});
