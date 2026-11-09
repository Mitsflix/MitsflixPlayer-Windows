// The only bridge between the page and the app. Keeps Node and Electron out of the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mitsflix', {
  fetch: (url, opts) => ipcRenderer.invoke('net:fetch', url, opts),
  cacheGet: (key) => ipcRenderer.invoke('cache:get', key),
  cacheSet: (key, data) => ipcRenderer.invoke('cache:set', key, data),
  cacheClear: (prefix) => ipcRenderer.invoke('cache:clear', prefix),
  open: (url) => ipcRenderer.invoke('app:open', url),
  info: () => ipcRenderer.invoke('app:info'),
  fullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
});
