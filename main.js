// Mitsflix Player for Windows — main process.
// Owns the window, network requests for playlist data (no CORS limits here), a small disk cache,
// and automatic updates from GitHub releases.
const { app, BrowserWindow, ipcMain, shell, session, net } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE = 'https://mitsflix.com';
let win = null;

// One copy of the app at a time; a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#070604',
    title: 'Mitsflix Player',
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0906', symbolColor: '#f2b53e', height: 40 },
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Playlists are often plain http; the page itself is local.
      allowRunningInsecureContent: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Links never open inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

// IPTV servers rarely send CORS headers; the stream loaders (hls.js / mpegts.js) need them.
function allowStreamCors() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase().startsWith('access-control-allow-')) delete headers[k];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['*'];
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
    callback({ responseHeaders: headers });
  });
}

// ---- Bridge for the page -------------------------------------------------------------------

ipcMain.handle('net:fetch', async (_e, url, opts = {}) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Invalid address');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 45000);
  try {
    const res = await net.fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'MitsflixPlayer/' + app.getVersion() } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
});

const cacheDir = () => path.join(app.getPath('userData'), 'catalog-cache');
const cacheFile = (key) => path.join(cacheDir(), String(key).replace(/[^a-z0-9_.-]/gi, '_') + '.json');

ipcMain.handle('cache:get', async (_e, key) => {
  try {
    const f = cacheFile(key);
    const stat = await fs.promises.stat(f);
    return { savedAt: stat.mtimeMs, data: JSON.parse(await fs.promises.readFile(f, 'utf8')) };
  } catch { return null; }
});
ipcMain.handle('cache:set', async (_e, key, data) => {
  try {
    await fs.promises.mkdir(cacheDir(), { recursive: true });
    await fs.promises.writeFile(cacheFile(key), JSON.stringify(data));
    return true;
  } catch { return false; }
});
ipcMain.handle('cache:clear', async (_e, prefix) => {
  try {
    for (const f of await fs.promises.readdir(cacheDir())) {
      if (!prefix || f.startsWith(String(prefix).replace(/[^a-z0-9_.-]/gi, '_'))) await fs.promises.unlink(path.join(cacheDir(), f));
    }
  } catch { /* nothing cached */ }
  return true;
});

ipcMain.handle('app:open', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.handle('app:info', () => ({ version: app.getVersion(), site: SITE }));
ipcMain.handle('win:fullscreen', (_e, on) => {
  if (!win) return false;
  win.setFullScreen(on === undefined ? !win.isFullScreen() : !!on);
  return win.isFullScreen();
});

// ---- Updates ---------------------------------------------------------------------------------

let updater = null;
function setupUpdates() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  const send = (state, extra = {}) => win && win.webContents.send('update:state', { state, ...extra });
  updater.on('checking-for-update', () => send('checking'));
  updater.on('update-available', (i) => send('downloading', { version: i.version }));
  updater.on('update-not-available', () => send('latest'));
  updater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => send('ready', { version: i.version }));
  updater.on('error', (err) => send('error', { message: String(err && err.message || err) }));
  setTimeout(() => updater.checkForUpdates().catch(() => {}), 5000);
  setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}
ipcMain.handle('update:check', async () => {
  if (!updater) return { state: 'dev' };
  try { await updater.checkForUpdates(); return { state: 'checking' }; } catch (e) { return { state: 'error', message: String(e.message || e) }; }
});
ipcMain.handle('update:install', () => { if (updater) updater.quitAndInstall(false, true); });

app.whenReady().then(() => {
  allowStreamCors();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
