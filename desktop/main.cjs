const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WEBSITE = 'https://flixleo.cyou';
let nativeWindow = null;
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
ipcMain.handle('flixleo:play-native', async (event, streamUrl) => {
  if (!trusted(event)) return { ok:false, error:'Untrusted page' };
  const url = validUrl(streamUrl);
  if (!url) return { ok:false, error:'Unsupported stream URL' };
  const executable = nativeExecutable();
  if (!fs.existsSync(executable)) return { ok:false, error:'Built-in native player is missing. Install the updated FlixLeo Windows version.' };
  if (nativeWindow && !nativeWindow.isDestroyed()) nativeWindow.close();
  stopPlayer();
  const win = new BrowserWindow({
    width: 1200, height: 740, minWidth: 640, minHeight: 380,
    title: 'FlixLeo · Native Player', backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration:false, contextIsolation:true, sandbox:true }
  });
  nativeWindow = win;
  win.setMenuBarVisibility(false);
  const handle = win.getNativeWindowHandle();
  const id = process.platform === 'win32'
    ? (process.arch === 'x64' ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString()
    : '';
  if (!id) { win.close(); return { ok:false, error:'Embedded video is available on Windows only.' }; }
  win.on('closed', () => { if (nativeWindow === win) nativeWindow = null; stopPlayer(); });
  win.loadURL('data:text/html,<html><body style="margin:0;background:black"></body></html>');
  const args = [
    '--no-config', '--no-terminal', '--force-window=yes', '--idle=no',
    '--keep-open=no', '--osc=yes', '--input-default-bindings=yes',
    '--hwdec=auto-safe', '--audio-display=no', '--border=no',
    '--wid=' + id, '--title=FlixLeo Native Player',
    '--user-agent=FlixLeoDesktop/1.0', '--', url
  ];
  try {
    const proc = spawn(executable, args, {
      windowsHide: true, stdio: 'ignore', cwd: path.dirname(executable)
    });
    nativeProcess = proc;
    proc.on('error', () => {
      if (!win.isDestroyed()) dialog.showMessageBox(win, {
        type:'error', title:'FlixLeo Native Player',
        message:'Could not start the bundled native player.' });
    });
    proc.on('exit', () => { if (!win.isDestroyed()) win.close(); });
    win.show();
    win.focus();
    return { ok:true };
  } catch {
    if (!win.isDestroyed()) win.close();
    return { ok:false, error:'Unable to start native playback.' };
  }
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
