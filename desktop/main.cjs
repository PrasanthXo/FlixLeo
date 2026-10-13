const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const https = require('node:https');

const WEBSITE = 'https://flixleo.cyou';
let mainWindow = null;
let playing = false;
let previousUrl = WEBSITE;
let lastBounds = null;
let nativeProcess = null;
let embedProcess = null;
let mpvPipe = null;
let mpvSerial = 0;
let updateCheckBusy = false;
let lastUpdateNotice = '';
// Match the gateway's version codes for the packaged app. 1.0.0 => 1,
// 1.0.1 => 2, 1.1.0 => 1001. Increment package.json version for each release.
function installedVersionCode(version = app.getVersion()) {
  const match = /^(\\d+)\\.(\\d+)\\.(\\d+)/.exec(String(version));
  if (!match) return 1;
  return Math.max(1, (Number(match[1]) - 1) * 1000000 + Number(match[2]) * 1000 + Number(match[3]) + 1);
}
function fetchGatewayPolicy(versionCode) {
  const endpoint = WEBSITE + '/api/gateway/v1/check/flixleo-windows?versionCode=' + versionCode;
  return new Promise((resolve, reject) => {
    const req = https.get(endpoint, { timeout: 7500, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } }, res => {
      let body = '';
      if (res.statusCode !== 200) { res.resume(); reject(new Error('Update check returned ' + res.statusCode)); return; }
      res.on('data', chunk => { body += chunk; if (body.length > 64000) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    req.on('timeout', () => req.destroy(new Error('Update check timed out')));
    req.on('error', reject);
  });
}
async function checkDesktopUpdate() {
  if (!app.isPackaged || updateCheckBusy || !mainWindow || mainWindow.isDestroyed()) return;
  updateCheckBusy = true;
  try {
    const versionCode = installedVersionCode();
    const result = await fetchGatewayPolicy(versionCode);
    if (result?.ready !== true) return; // Database outages never lock out users.
    const policy = result?.policy;
    const latest = Number(policy?.latestVersionCode);
    if (!Number.isSafeInteger(latest) || latest <= versionCode || !policy?.updateAvailable) return;
    const link = validUrl(policy.updateUrl);
    if (!link || !/\\.exe(?:\\?|$)/i.test(link)) return;
    const required = policy.forceUpdate === true && versionCode < Number(policy.minVersionCode);
    const noticeKey = latest + ':' + String(required);
    if (!required && lastUpdateNotice === noticeKey) return;
    lastUpdateNotice = noticeKey;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const answer = await dialog.showMessageBox(mainWindow, {
      type: required ? 'warning' : 'info',
      title: required ? 'FlixLeo update required' : 'FlixLeo update available',
      message: required ? 'Update FlixLeo to continue using the desktop app.' : 'A newer FlixLeo Windows app is available.',
      detail: String(policy.notes || policy.latestVersionName || ''),
      buttons: required ? ['Download update', 'Exit'] : ['Download update', 'Later'],
      defaultId: 0, cancelId: 1, noLink: true
    });
    if (answer.response === 0) {
      await shell.openExternal(link);
      if (required) app.quit();
    } else if (required) app.quit();
  } catch (error) {
    // The current installation remains usable if the update service is offline.
    console.warn('FlixLeo update gateway check skipped:', String(error?.message || error));
  } finally { updateCheckBusy = false; }
}
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
    fs.writeFileSync(mpvInputConf, 'MBTN_LEFT_DBL ignore\nESC ignore\nSPACE ignore\nF11 ignore\n', 'utf8');
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
        if (playing && nativeProcess === proc && embedProcess === helperProc && !win.isDestroyed()) {
          if (line === 'VIDEO_DOUBLE_CLICK') toggleVideoFullscreen(win);
          if (line === 'VIDEO_ESCAPE' && win.isFullScreen()) win.setFullScreen(false);
          if (line === 'VIDEO_SPACE') void sendNativeCommand(['cycle', 'pause']);
        }
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
function sendNativeCommand(command) {
  if (!playing || !mpvPipe) return Promise.resolve(false);
  const pipe = mpvPipe;
  return new Promise(resolve => {
    const socket = net.connect(pipe);
    let finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 1800);
    socket.once('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.once('data', data => {
      try { finish(JSON.parse(String(data).split('\n')[0]).error === 'success'); }
      catch { finish(false); }
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}
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
  return sendNativeCommand(command);
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
    icon:path.join(__dirname, 'brand-icon.ico'),
    webPreferences: {
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true
    }
  });
  mainWindow = win;
  // Fullscreen is controlled by Electron's window, not by the mpv child window.
  // Escape exits fullscreen; F11 must not toggle fullscreen in the desktop app.
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
      return;
    }
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen() && !playing) {
      event.preventDefault();
      win.setFullScreen(false);
      return;
    }
    if (playing && input.alt && input.key === 'Left') {
      event.preventDefault();
      backToFlixLeo();
    }
  });
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
  if (process.platform === 'win32') app.setAppUserModelId('cyou.flixleo.desktop');
  createWindow();
  // The first check runs after the browser has opened; repeat every six hours.
  setTimeout(() => { void checkDesktopUpdate(); }, 5000);
  const updateTimer = setInterval(() => { void checkDesktopUpdate(); }, 6 * 60 * 60 * 1000);
  updateTimer.unref?.();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0){createWindow();void checkDesktopUpdate();}});
});
app.on('window-all-closed',()=>{stopPlayer();if(process.platform!=='darwin')app.quit()});
