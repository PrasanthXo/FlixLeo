const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WEBSITE = 'https://flixleo.cyou';
let mainWindow = null;
let playing = false;
let previousUrl = WEBSITE;
let nativeProcess = null;
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
  mainWindow.loadURL(previousUrl.startsWith(WEBSITE) ? previousUrl : WEBSITE);
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
  previousUrl = win.webContents.getURL() || WEBSITE;
  playing = true;
  win.setTitle('FlixLeo · Native Player — Alt+Left to return');
  await win.loadURL('data:text/html,<html><body style="background:#000;margin:0"></body></html>');
  if (win.isDestroyed() || !playing) return { ok:false, error:'Playback cancelled' };
  const handle = win.getNativeWindowHandle();
  const id = process.arch === 'x64'
    ? handle.readBigUInt64LE(0).toString()
    : String(handle.readUInt32LE(0));
  const args = [
    '--no-config', '--no-terminal', '--force-window=yes', '--idle=no',
    '--keep-open=no', '--osc=yes', '--input-default-bindings=yes',
    '--hwdec=auto-safe', '--border=no', '--wid=' + id,
    '--title=FlixLeo Native Player', '--user-agent=FlixLeoDesktop/1.0',
    '--', url
  ];
  try {
    const proc = spawn(executable, args, { windowsHide:true, stdio:'ignore', cwd:path.dirname(executable) });
    nativeProcess = proc;
    proc.on('error', () => { backToFlixLeo(); });
    proc.on('exit', () => { if (nativeProcess === proc) backToFlixLeo(); });
    win.focus();
    return { ok:true };
  } catch {
    backToFlixLeo();
    return { ok:false, error:'Unable to start native playback.' };
  }
});
ipcMain.handle('flixleo:stop-native', (event) => {
  if (event.sender !== mainWindow?.webContents) return false;
  backToFlixLeo();
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
