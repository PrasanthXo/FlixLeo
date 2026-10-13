const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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
ipcMain.handle('flixleo:play-native', async (event, streamUrl) => {
  if (!trusted(event)) return { ok:false, error:'Untrusted page' };
  const url = validUrl(streamUrl);
  if (!url) return { ok:false, error:'Unsupported stream URL' };
  const executable = nativeExecutable();
  if (!fs.existsSync(executable)) return { ok:false, error:'Built-in native player is missing. Install the updated FlixLeo Windows version.' };
  const win = mainWindow;
  if (!win || win.isDestroyed()) return { ok:false, error:'FlixLeo window is unavailable' };
  if (process.platform !== 'win32') return { ok:false, error:'Native playback is supported only on Windows.' };
  // mpv --wid paints in the EXISTING native window. Chromium must release its
  // compositor surface first or users can hear audio while seeing black video.
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
  const args = [
    '--no-config', '--no-terminal', '--force-window=yes', '--idle=no',
    '--keep-open=no', '--osc=yes', '--input-default-bindings=yes',
    '--input-cursor=yes', '--script-opts=osc-visibility=always',
    `--input-ipc-server=${mpvPipe}`,
    '--hwdec=auto-safe', '--border=no', '--geometry=1280x720',
    '--title=FlixLeo Native Player', '--user-agent=FlixLeoDesktop/1.0',
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
    helperProc.stdout.on('data', chunk => {
      if (String(chunk).includes('EMBEDDED')) embedded = true;
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
  };
  let command = commands[action];
  if (action === 'setVolume' && Number.isFinite(value)) command = ['set_property', 'volume', Math.max(0, Math.min(100, Number(value)))];
  if (!command) return false;
  return await new Promise(resolve => {
    const socket = net.connect(mpvPipe);
    const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 1800);
    socket.once('connect', () => socket.write(JSON.stringify({ command }) + '\\n'));
    socket.once('data', data => {
      clearTimeout(timeout);
      socket.end();
      try { resolve(JSON.parse(String(data).trim()).error === 'success'); } catch { resolve(false); }
    });
    socket.once('error', () => { clearTimeout(timeout); resolve(false); });
    socket.once('close', () => { clearTimeout(timeout); resolve(false); });
  });
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
  win.webContents.on('before-input-event', (event, input) => {
    if (playing && (input.key === 'Escape' || (input.alt && input.key === 'Left'))) {
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
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
app.on('window-all-closed',()=>{stopPlayer();if(process.platform!=='darwin')app.quit()});
