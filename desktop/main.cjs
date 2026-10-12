const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WEBSITE = 'https://flixleo.cyou';
function findVlc() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VideoLAN', 'VLC', 'vlc.exe')
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}
function trusted(event) {
  try {
    const url = new URL(event.senderFrame?.url || '');
    return url.origin === WEBSITE && event.senderFrame === event.sender.mainFrame;
  } catch { return false; }
}
ipcMain.handle('flixleo:play-vlc', async (event, streamUrl) => {
  if (!trusted(event)) return { ok:false, error:'Untrusted page' };
  if (typeof streamUrl !== 'string' || streamUrl.length > 8192) return { ok:false, error:'Invalid stream' };
  let target;
  try { target = new URL(streamUrl); } catch { return { ok:false, error:'Invalid stream' }; }
  if (target.protocol !== 'https:' || target.username || target.password ||
      ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(target.hostname) ||
      /(?:^|\.)(?:local|internal|localhost)$/.test(target.hostname)) {
    return { ok:false, error:'Unsupported stream URL' };
  }
  const vlc = findVlc();
  if (!vlc) return { ok:false, error:'Install VLC Media Player for Windows first.' };
  try {
    const child = spawn(vlc, ['--one-instance', '--playlist-enqueue', target.href], {
      detached: true, stdio: 'ignore', windowsHide: true
    });
    child.on('error', () => {});
    child.unref();
    return { ok:true };
  } catch { return { ok:false, error:'Could not start VLC.' }; }
});
function createWindow() {
  const win = new BrowserWindow({
    width: 1380, height: 850, minWidth: 850, minHeight: 560,
    title: 'FlixLeo',
    backgroundColor: '#080a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== WEBSITE) { event.preventDefault(); shell.openExternal(url); } }
    catch { event.preventDefault(); }
  });
  win.loadURL(WEBSITE);
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
