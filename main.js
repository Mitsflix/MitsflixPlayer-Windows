// Mitsflix Player for Windows — main process.
// Owns the window, network requests for playlist data (no CORS limits here), a small disk cache,
// and automatic updates from GitHub releases.
const { app, BrowserWindow, ipcMain, shell, session, net, protocol, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Downloads } = require('./downloads');

// Downloaded films and recordings play from disk through this address (mxfile://play/<id>.<ext>).
protocol.registerSchemesAsPrivileged([
  { scheme: 'mxfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

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
  // A reloaded page isn't watching anything, so nothing should be holding downloads back.
  win.webContents.on('did-start-loading', () => { if (downloads) downloads.resetHold(); });
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

// ---- Downloads and recordings ---------------------------------------------------------------

let downloads = null;
let awake = null; // keeps Windows from sleeping mid-download or mid-recording

function setupDownloads() {
  downloads = new Downloads({
    dataFile: path.join(app.getPath('userData'), 'downloads.json'),
    defaultDir: path.join(app.getPath('videos'), 'Mitsflix Player'),
    userAgent: 'MitsflixPlayer/' + app.getVersion(),
    notify: (snap) => { if (win && !win.isDestroyed()) win.webContents.send('dl:update', snap); },
    onBusy: (busy) => {
      if (busy && awake == null) awake = powerSaveBlocker.start('prevent-app-suspension');
      else if (!busy && awake != null) { powerSaveBlocker.stop(awake); awake = null; }
    },
  });

  const TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', ts: 'video/mp2t', flv: 'video/x-flv' };
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', 'Cache-Control': 'no-store' };
  protocol.handle('mxfile', async (request) => {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const u = new URL(request.url);
      const m = /^\/([a-f0-9]{16})\.([a-z0-9]+)$/i.exec(u.pathname);
      const item = m && u.hostname === 'play' ? downloads.get(m[1]) : null;
      if (!item) return new Response('Not found', { status: 404, headers: cors });
      if (m[2].toLowerCase() === 'm3u8') {
        const text = await downloads.playlist(item.id, 3);
        if (!text) return new Response('Not found', { status: 404, headers: cors });
        return new Response(text, { status: 200, headers: { ...cors, 'Content-Type': 'application/vnd.apple.mpegurl' } });
      }
      if (item.status !== 'done' && item.status !== 'recording') return new Response('Not ready', { status: 404, headers: cors });
      const size = (await fs.promises.stat(item.file)).size;
      const type = TYPES[item.ext] || 'application/octet-stream';
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
      if (!range || (range[1] === '' && range[2] === '')) {
        return new Response(Readable.toWeb(fs.createReadStream(item.file)), { status: 200, headers: { ...cors, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
      }
      let start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
      let end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': 'bytes */' + size } });
      return new Response(Readable.toWeb(fs.createReadStream(item.file, { start, end })), {
        status: 206,
        headers: { ...cors, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' },
      });
    } catch (err) {
      return new Response(String((err && err.message) || err), { status: 500, headers: cors });
    }
  });
}

const guard = (fn) => async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
};
ipcMain.handle('dl:list', () => downloads.snapshot());
ipcMain.handle('dl:add', guard((spec) => downloads.add(spec)));
ipcMain.handle('dl:record', guard((spec) => downloads.record(spec)));
ipcMain.handle('dl:pause', guard((id) => downloads.pause(id)));
ipcMain.handle('dl:resume', guard((id) => downloads.resume(id)));
ipcMain.handle('dl:remove', guard((id) => downloads.remove(id)));
ipcMain.handle('dl:stopRecording', guard((id) => downloads.stopRecording(id)));
ipcMain.handle('dl:hold', (_e, delta) => { downloads.setHold(delta > 0 ? 1 : -1); });
ipcMain.handle('dl:show', (_e, id) => {
  const item = downloads.get(id);
  if (item && fs.existsSync(item.file)) shell.showItemInFolder(item.file);
  else shell.openPath(downloads.dir);
});
ipcMain.handle('dl:openFolder', async () => { await fs.promises.mkdir(downloads.dir, { recursive: true }).catch(() => {}); shell.openPath(downloads.dir); });
ipcMain.handle('dl:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Where should downloads and recordings be saved?', defaultPath: downloads.dir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return downloads.dir;
  return downloads.setDir(r.filePaths[0]);
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
  setupDownloads();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Closing the app stops cleanly: a recording keeps what it captured, a download resumes next time.
let closing = false;
app.on('before-quit', (e) => {
  if (closing || !downloads) return;
  closing = true;
  e.preventDefault();
  Promise.race([downloads.shutdown(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
});
