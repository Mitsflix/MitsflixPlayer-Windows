/* Mitsflix Player for Windows — the whole interface.
 * Plain JavaScript, no framework. Playlist data comes through window.mitsflix (preload.js), which
 * fetches from the main process so IPTV servers don't need CORS.
 */
'use strict';

const bridge = window.mitsflix || {
  // Lets the page open in a normal browser for testing; nothing works without the app though.
  fetch: async (url) => { const r = await fetch(url); return { ok: r.ok, status: r.status, text: await r.text() }; },
  cacheGet: async () => null, cacheSet: async () => true, cacheClear: async () => true,
  open: async (u) => window.open(u, '_blank'), info: async () => ({ version: 'dev', site: 'https://mitsflix.com' }),
  fullscreen: async () => false, checkUpdate: async () => ({ state: 'dev' }), installUpdate: async () => {}, onUpdate: () => {},
};

const SITE = 'https://mitsflix.com';
const CATALOG_MAX_AGE = 12 * 60 * 60 * 1000;

// ============================================================================ helpers

const $ = (sel, el = document) => el.querySelector(sel);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const svg = (path, vb = '0 0 24 24') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', vb); s.innerHTML = path; return s; };
const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  back10: '<path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" font-family="Segoe UI" font-weight="700">10</text>',
  fwd10: '<path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16" font-size="6.5" text-anchor="middle" font-family="Segoe UI" font-weight="700">10</text>',
  next: '<path d="M6 5l9 7-9 7zM16 5h2v14h-2z"/>',
  full: '<path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 4v-4h2v6h-6v-2z"/>',
  exitFull: '<path d="M8 4h2v6H4V8h4zm6 0h2v4h4v2h-6zM4 14h6v6H8v-4H4zm10 0h6v2h-4v4h-2z"/>',
  vol: '<path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zm12 .4L17.4 8 19 9.6 20.6 8 22 9.4 20.4 11l1.6 1.6-1.4 1.4-1.6-1.6-1.6 1.6-1.4-1.4 1.6-1.6z"/>',
  cc: '<path d="M3 5h18v14H3zm2 2v10h14V7zm2 3h4v1.5H8.5v1H11V14H7zm6 0h4v1.5h-2.5v1H17V14h-4z"/>',
  up: '<path d="M12 6l7 8H5z"/>', down: '<path d="M12 18l-7-8h14z"/>',
  backArrow: '<path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.4A5.3 5.3 0 0 1 12 5.6a5.3 5.3 0 0 1 9.6 6C19.5 16.4 12 21 12 21z"/>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, hr = Math.floor(sec / 3600);
  return (hr ? hr + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function b64(s) {
  if (!s) return '';
  try { return decodeURIComponent(escape(atob(s))); } catch { try { return atob(s); } catch { return s; } }
}
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const yearOf = (s) => { const m = String(s || '').match(/(19|20)\d{2}/); return m ? m[0] : ''; };
const cleanName = (s) => String(s || '').trim();

let toastTimer = null;
function toast(msg, action) {
  const el = $('#toast');
  el.replaceChildren(h('span', null, msg));
  if (action) el.append(h('button', { class: 'btn small gold', onclick: () => { el.hidden = true; action.run(); } }, action.label));
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// Small persistent store (per-viewer conveniences only; the playlist data itself lives in the disk cache).
const store = {
  get(key, fallback) { try { const v = localStorage.getItem('mx.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem('mx.' + key, JSON.stringify(val)); } catch { /* storage full or blocked */ } },
  del(key) { try { localStorage.removeItem('mx.' + key); } catch { /* ignore */ } },
};

// ============================================================================ playlists

const state = {
  playlists: store.get('playlists', []),
  activeId: store.get('activeId', null),
  catalog: null,          // { live, movies, series, cats: {live, movies, series} }
  loading: false,
  view: 'home',
  live: { cat: 'all', q: '', sel: null },
  movies: { cat: 'all', q: '', sort: 'default', scroll: 0 },
  series: { cat: 'all', q: '', sort: 'default', scroll: 0, open: null, season: null },
};
const active = () => state.playlists.find((p) => p.id === state.activeId) || state.playlists[0] || null;
function savePlaylists() { store.set('playlists', state.playlists); store.set('activeId', state.activeId); }

function normaliseServer(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  try {
    const u = new URL(s);
    return (u.protocol + '//' + u.host + u.pathname.replace(/\/(player_api\.php|get\.php|xmltv\.php).*$/i, '')).replace(/\/+$/, '');
  } catch { return s.replace(/\/+$/, ''); }
}

// An M3U link of the form .../get.php?username=..&password=.. is really an Xtream login.
function xtreamFromM3u(url) {
  try {
    const u = new URL(url);
    const user = u.searchParams.get('username'), pass = u.searchParams.get('password');
    if (/get\.php$/i.test(u.pathname) && user && pass) return { server: u.protocol + '//' + u.host, username: user, password: pass };
  } catch { /* not a URL */ }
  return null;
}

// ---- Xtream Codes API
async function xt(pl, action, params = {}) {
  const u = new URL(pl.server + '/player_api.php');
  u.searchParams.set('username', pl.username);
  u.searchParams.set('password', pl.password);
  if (action) u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await bridge.fetch(u.toString(), { timeoutMs: action ? 120000 : 25000 });
  if (!r.ok) throw new Error(r.error ? 'Couldn\'t reach the server (' + r.error + ')' : 'The server replied with an error (' + r.status + ')');
  try { return JSON.parse(r.text); } catch { throw new Error('The server sent something unexpected. Check the server address.'); }
}
const xtUrl = (pl, kind, id, ext) => pl.server + '/' + kind + '/' + encodeURIComponent(pl.username) + '/' + encodeURIComponent(pl.password) + '/' + id + '.' + ext;

async function verifyXtream(pl) {
  const r = await xt(pl);
  const ui = r && r.user_info;
  if (!ui || String(ui.auth) === '0') throw new Error('Username or password not accepted.');
  if (ui.status && !/active/i.test(ui.status)) throw new Error('This account is ' + String(ui.status).toLowerCase() + '.');
  return { expires: ui.exp_date ? Number(ui.exp_date) * 1000 : null, connections: ui.max_connections || null };
}

async function loadXtream(pl) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const [lc, vc, sc, ls, vs, ss] = await Promise.all([
    xt(pl, 'get_live_categories'), xt(pl, 'get_vod_categories'), xt(pl, 'get_series_categories'),
    xt(pl, 'get_live_streams'), xt(pl, 'get_vod_streams'), xt(pl, 'get_series'),
  ]);
  const cats = (list) => arr(list).map((c) => ({ id: String(c.category_id), name: cleanName(c.category_name) }));
  return {
    cats: { live: cats(lc), movies: cats(vc), series: cats(sc) },
    live: arr(ls).map((s) => ({ id: String(s.stream_id), name: cleanName(s.name), num: s.num, logo: s.stream_icon || '', cat: String(s.category_id), epg: s.epg_channel_id || '', archive: Number(s.tv_archive) > 0 })),
    movies: arr(vs).map((s) => ({ id: String(s.stream_id), name: cleanName(s.name), poster: s.stream_icon || '', rating: num(s.rating_5based) * 2 || num(s.rating), cat: String(s.category_id), added: Number(s.added) || 0, ext: s.container_extension || 'mp4', year: yearOf(s.year || s.name) })),
    series: arr(ss).map((s) => ({ id: String(s.series_id), name: cleanName(s.name), poster: s.cover || '', rating: num(s.rating_5based) * 2 || num(s.rating), cat: String(s.category_id), added: Number(s.last_modified) || 0, year: yearOf(s.releaseDate || s.release_date || s.name), plot: s.plot || '' })),
  };
}

// ---- M3U playlists
function parseM3u(text) {
  const lines = text.split(/\r?\n/);
  const live = [], movies = [];
  const catIds = { live: new Map(), movies: new Map() };
  const catOf = (kind, name) => { const m = catIds[kind]; if (!m.has(name)) m.set(name, String(m.size + 1)); return m.get(name); };
  let cur = null, n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const attr = (k) => { const m = line.match(new RegExp(k + '="([^"]*)"', 'i')); return m ? m[1] : ''; };
      cur = { name: cleanName(line.slice(line.lastIndexOf(',') + 1)) || attr('tvg-name'), logo: attr('tvg-logo'), group: attr('group-title') || 'Other', epg: attr('tvg-id') };
    } else if (cur && line && !line.startsWith('#')) {
      n++;
      const isVod = /\/(movie|series)\//i.test(line) || /\.(mp4|mkv|avi|mov)(\?|$)/i.test(line);
      if (isVod) movies.push({ id: 'm' + n, name: cur.name, poster: cur.logo, rating: 0, cat: catOf('movies', cur.group), added: n, url: line, year: yearOf(cur.name) });
      else live.push({ id: 'l' + n, name: cur.name, num: live.length + 1, logo: cur.logo, cat: catOf('live', cur.group), epg: cur.epg, url: line });
      cur = null;
    }
  }
  const toCats = (m) => [...m.entries()].map(([name, id]) => ({ id, name }));
  return { cats: { live: toCats(catIds.live), movies: toCats(catIds.movies), series: [] }, live, movies, series: [] };
}
async function loadM3u(pl) {
  const r = await bridge.fetch(pl.url, { timeoutMs: 120000 });
  if (!r.ok) throw new Error(r.error ? 'Couldn\'t download the playlist (' + r.error + ')' : 'The playlist link replied with an error (' + r.status + ')');
  if (!/#EXTM3U|#EXTINF/i.test(r.text)) throw new Error('That link isn\'t an M3U playlist.');
  return parseM3u(r.text);
}

// ---- Catalogue: from the disk cache when fresh, otherwise downloaded.
async function loadCatalog(force = false) {
  const pl = active();
  if (!pl) { state.catalog = null; return; }
  const key = 'cat_' + pl.id;
  if (!force) {
    const cached = await bridge.cacheGet(key);
    if (cached && cached.data) {
      state.catalog = cached.data;
      if (Date.now() - cached.savedAt > CATALOG_MAX_AGE) refreshCatalogInBackground(pl);
      return;
    }
  }
  state.loading = true; render();
  try {
    state.catalog = pl.type === 'm3u' ? await loadM3u(pl) : await loadXtream(pl);
    bridge.cacheSet(key, state.catalog);
  } catch (e) {
    state.catalog = null;
    state.loadError = e.message || String(e);
  } finally {
    state.loading = false;
  }
}
async function refreshCatalogInBackground(pl) {
  try {
    const fresh = pl.type === 'm3u' ? await loadM3u(pl) : await loadXtream(pl);
    if (active() && active().id === pl.id) { state.catalog = fresh; if (!$('#player').hidden) return; render(); }
    bridge.cacheSet('cat_' + pl.id, fresh);
  } catch { /* keep the cached copy */ }
}

// ---- Per-playlist favourites, progress and recent channels
const plKey = (k) => k + '_' + (active() ? active().id : 'none');
const favs = () => store.get(plKey('fav'), { live: [], movie: [], series: [] });
const isFav = (kind, id) => (favs()[kind] || []).includes(id);
function toggleFav(kind, id) {
  const f = favs();
  f[kind] = f[kind].includes(id) ? f[kind].filter((x) => x !== id) : [id, ...f[kind]];
  store.set(plKey('fav'), f);
  toast(f[kind].includes(id) ? 'Added to Favourites' : 'Removed from Favourites');
  return f[kind].includes(id);
}
const progress = () => store.get(plKey('prog'), {});
function saveProgress(key, data) {
  const p = progress();
  if (data == null) delete p[key]; else p[key] = { ...p[key], ...data, ts: Date.now() };
  const keys = Object.keys(p).sort((a, b) => p[b].ts - p[a].ts);
  for (const k of keys.slice(200)) delete p[k];
  store.set(plKey('prog'), p);
}
function pushRecent(id) {
  const r = store.get(plKey('recent'), []).filter((x) => x !== id);
  r.unshift(id); store.set(plKey('recent'), r.slice(0, 20));
}

// ============================================================================ routing

function go(view) {
  if (view !== state.view) stopPreview();
  state.view = view;
  if (view !== 'series') state.series.open = null;
  render();
}
document.querySelectorAll('.rail-btn').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.view === 'series' && state.view === 'series') state.series.open = null;
  go(b.dataset.view);
}));

function render() {
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  renderPill();
  const view = $('#view');
  const pl = active();
  if (!pl) { $('#rail').style.visibility = 'hidden'; view.replaceChildren(welcome()); return; }
  $('#rail').style.visibility = '';
  if (state.loading) { view.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('div', null, 'Loading ' + pl.name + '…'), h('div', { style: { fontSize: '13px', color: 'var(--dim)' } }, 'Big playlists can take up to a minute the first time.'))); return; }
  if (!state.catalog && state.view !== 'settings') {
    view.replaceChildren(h('div', { class: 'loading' },
      h('div', { style: { fontSize: '18px', color: 'var(--text)', fontWeight: 600 } }, 'Couldn\'t load ' + pl.name),
      h('div', null, state.loadError || 'Something went wrong.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn gold', onclick: async () => { await loadCatalog(true); render(); } }, 'Try again'),
        h('button', { class: 'btn', onclick: () => go('settings') }, 'Playlist settings'))));
    return;
  }
  const views = { home: viewHome, search: viewSearch, live: viewLive, movies: viewMovies, series: viewSeries, favourites: viewFavourites, settings: viewSettings };
  view.replaceChildren((views[state.view] || viewHome)());
}

function renderPill() {
  const pill = $('#playlist-pill');
  const pl = active();
  pill.hidden = !pl;
  if (!pl) return;
  pill.replaceChildren(h('span', null, 'Playlist'), h('b', null, pl.name), h('span', null, state.playlists.length > 1 ? '▾' : ''));
  pill.onclick = () => (state.playlists.length > 1 ? switchPlaylistModal() : go('settings'));
}

// ============================================================================ welcome & playlist form

function getPlaylistBox() {
  return h('div', { class: 'getlist' },
    h('div', { class: 'grow' }, h('b', null, 'No playlist yet?'), h('p', null, 'Get one from Mitsflix at mitsflix.com — then come back and add it here.')),
    h('button', { class: 'btn gold', onclick: () => bridge.open(SITE) }, 'Get a playlist'));
}

function playlistForm(existing, onDone, onCancel) {
  let mode = existing ? existing.type : 'xtream';
  const err = h('div', { class: 'err' });
  const f = {
    name: h('input', { class: 'input', placeholder: 'e.g. Mitsflix', value: existing ? existing.name : 'Mitsflix' }),
    server: h('input', { class: 'input', placeholder: 'http://server.example.com:8080', value: existing && existing.server || '' }),
    username: h('input', { class: 'input', autocomplete: 'off', value: existing && existing.username || '' }),
    password: h('input', { class: 'input', type: 'password', autocomplete: 'off', value: existing && existing.password || '' }),
    url: h('input', { class: 'input', placeholder: 'https://… .m3u', value: existing && existing.url || '' }),
  };
  const xtFields = h('div', { class: 'form' },
    h('label', null, 'Server address', f.server), h('label', null, 'Username', f.username), h('label', null, 'Password', f.password));
  const m3uFields = h('div', { class: 'form' }, h('label', null, 'Playlist link (M3U)', f.url));
  const tabX = h('button', { class: 'tab', type: 'button' }, 'Xtream Codes login');
  const tabM = h('button', { class: 'tab', type: 'button' }, 'M3U link');
  const setMode = (m) => { mode = m; tabX.classList.toggle('active', m === 'xtream'); tabM.classList.toggle('active', m === 'm3u'); xtFields.hidden = m !== 'xtream'; m3uFields.hidden = m !== 'm3u'; };
  tabX.onclick = () => setMode('xtream'); tabM.onclick = () => setMode('m3u');
  setMode(mode);
  const submit = h('button', { class: 'btn gold', type: 'submit' }, existing ? 'Save' : 'Add playlist');
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    let pl = { id: existing ? existing.id : 'p' + Date.now().toString(36), name: f.name.value.trim() || 'My playlist', type: mode };
    if (mode === 'm3u') {
      const xt = xtreamFromM3u(f.url.value.trim());
      if (xt) Object.assign(pl, { type: 'xtream', ...xt, server: normaliseServer(xt.server) });
      else if (!/^https?:\/\//i.test(f.url.value.trim())) { err.textContent = 'Enter the full playlist link, starting with http:// or https://'; return; }
      else pl.url = f.url.value.trim();
    } else {
      Object.assign(pl, { server: normaliseServer(f.server.value), username: f.username.value.trim(), password: f.password.value });
      if (!pl.server || !pl.username || !pl.password) { err.textContent = 'Fill in the server address, username and password.'; return; }
    }
    submit.disabled = true; submit.textContent = 'Checking…';
    try {
      if (pl.type === 'xtream') Object.assign(pl, await verifyXtream(pl));
      else { const r = await bridge.fetch(pl.url, { timeoutMs: 60000 }); if (!r.ok || !/#EXTM3U|#EXTINF/i.test(r.text)) throw new Error('That link didn\'t return an M3U playlist.'); }
      onDone(pl);
    } catch (ex) {
      err.textContent = ex.message || String(ex);
    } finally { submit.disabled = false; submit.textContent = existing ? 'Save' : 'Add playlist'; }
  } },
  h('div', { class: 'tabs' }, tabX, tabM),
  h('label', null, 'Name', f.name), xtFields, m3uFields, err,
  h('div', { class: 'row-btns' }, onCancel ? h('button', { class: 'btn ghost', type: 'button', onclick: onCancel }, 'Cancel') : null, submit));
  return form;
}

async function addOrUpdatePlaylist(pl) {
  const i = state.playlists.findIndex((p) => p.id === pl.id);
  if (i >= 0) state.playlists[i] = pl; else state.playlists.push(pl);
  state.activeId = pl.id;
  savePlaylists();
  await bridge.cacheClear('cat_' + pl.id);
  state.catalog = null; state.loadError = null;
  state.view = 'home';
  await loadCatalog(true);
  render();
}

function welcome() {
  return h('div', { class: 'welcome' }, h('div', { class: 'welcome-card' },
    h('img', { class: 'logo', src: 'assets/wordmark.png', alt: 'Mitsflix' }),
    h('h1', null, 'Welcome to Mitsflix Player'),
    h('p', { class: 'lead' }, 'Add your playlist to start watching live TV, movies and series.'),
    playlistForm(null, addOrUpdatePlaylist),
    getPlaylistBox()));
}

function modal(title, content) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } }, h('div', { class: 'modal' }, h('h2', null, title), content));
  const close = () => back.remove();
  $('#modal-root').append(back);
  return close;
}

function switchPlaylistModal() {
  const list = h('div');
  const close = modal('Switch playlist', list);
  state.playlists.forEach((p) => list.append(h('div', { class: 'item', style: { cursor: 'pointer' }, onclick: async () => { close(); await usePlaylist(p.id); } },
    h('div', { class: 'grow' }, h('div', { class: 't' }, p.name, p.id === active().id ? h('span', { class: 'badge' }, 'IN USE') : null), h('div', { class: 's' }, p.type === 'm3u' ? 'M3U link' : p.server)))));
}
async function usePlaylist(id) {
  stopPreview();
  state.activeId = id; savePlaylists();
  state.catalog = null; state.loadError = null;
  state.live = { cat: 'all', q: '', sel: null };
  state.movies = { cat: 'all', q: '', sort: 'default', scroll: 0 };
  state.series = { cat: 'all', q: '', sort: 'default', scroll: 0, open: null, season: null };
  await loadCatalog(); render();
}

// ============================================================================ virtual grid & list

// Renders only what's on screen, so 40,000-title libraries stay smooth.
function virtualGrid(items, renderCard, opts = {}) {
  const minW = opts.minW || 168, gap = 16, pad = 20, metaH = 50;
  const scroller = h('div', { class: 'scroller' });
  const space = h('div', { class: 'vspace' });
  scroller.append(space);
  const shown = new Map();
  let cols = 1, cw = minW, ch = minW * 1.5 + metaH;
  const layout = () => {
    const w = scroller.clientWidth || 800;
    cols = Math.max(1, Math.floor((w - pad * 2 + gap) / (minW + gap)));
    cw = (w - pad * 2 - gap * (cols - 1)) / cols;
    ch = cw * 1.5 + metaH;
    space.style.height = (Math.ceil(items.length / cols) * (ch + gap) + pad * 2) + 'px';
    shown.forEach((el) => el.remove()); shown.clear();
    paint();
  };
  const paint = () => {
    const top = scroller.scrollTop, hgt = scroller.clientHeight || 800;
    const r0 = Math.max(0, Math.floor((top - pad) / (ch + gap)) - 1);
    const r1 = Math.ceil((top + hgt) / (ch + gap)) + 1;
    const want = new Set();
    for (let r = r0; r <= r1; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; if (i >= items.length) break;
      want.add(i);
      if (!shown.has(i)) {
        const el = renderCard(items[i], i);
        Object.assign(el.style, { left: (pad + c * (cw + gap)) + 'px', top: (pad + r * (ch + gap)) + 'px', width: cw + 'px' });
        space.append(el); shown.set(i, el);
      }
    }
    for (const [i, el] of shown) if (!want.has(i)) { el.remove(); shown.delete(i); }
  };
  scroller.addEventListener('scroll', () => { requestAnimationFrame(paint); if (opts.onScroll) opts.onScroll(scroller.scrollTop); });
  new ResizeObserver(debounce(layout, 60)).observe(scroller);
  requestAnimationFrame(() => { layout(); if (opts.scrollTo) scroller.scrollTop = opts.scrollTo; });
  scroller.refresh = () => { shown.forEach((el) => el.remove()); shown.clear(); paint(); };
  return scroller;
}

function virtualList(items, renderRow, rowH = 56) {
  const scroller = h('div', { class: 'scroller' });
  const space = h('div', { class: 'vspace', style: { height: (items.length * rowH + 16) + 'px' } });
  scroller.append(space);
  const shown = new Map();
  const paint = () => {
    const top = scroller.scrollTop, hgt = scroller.clientHeight || 800;
    const i0 = Math.max(0, Math.floor(top / rowH) - 4), i1 = Math.min(items.length - 1, Math.ceil((top + hgt) / rowH) + 4);
    for (const [i, el] of shown) if (i < i0 || i > i1) { el.remove(); shown.delete(i); }
    for (let i = i0; i <= i1; i++) if (!shown.has(i)) {
      const el = renderRow(items[i], i);
      Object.assign(el.style, { top: (8 + i * rowH) + 'px', height: (rowH - 4) + 'px' });
      space.append(el); shown.set(i, el);
    }
  };
  scroller.addEventListener('scroll', () => requestAnimationFrame(paint));
  new ResizeObserver(debounce(paint, 60)).observe(scroller);
  requestAnimationFrame(paint);
  scroller.refresh = () => { shown.forEach((el) => el.remove()); shown.clear(); paint(); };
  scroller.scrollToIndex = (i) => { scroller.scrollTop = Math.max(0, i * rowH - scroller.clientHeight / 2); };
  return scroller;
}

function posterCard(item, kind, onClick) {
  const prog = kind === 'movie' ? progress()['m:' + item.id] : null;
  const img = item.poster ? h('img', { class: 'poster', src: item.poster, loading: 'lazy', alt: '' }) : h('div', { class: 'ph' }, item.name);
  if (item.poster) img.onerror = () => img.replaceWith(h('div', { class: 'ph' }, item.name));
  return h('div', { class: 'card', title: item.name, onclick: onClick },
    img,
    item.rating ? h('div', { class: 'rate' }, '★ ' + item.rating.toFixed(1)) : null,
    isFav(kind, item.id) ? h('div', { class: 'fav' }, '♥') : null,
    h('div', { class: 'meta' }, h('div', { class: 't' }, item.name), h('div', { class: 's' }, item.year || ' ')),
    prog && prog.dur ? h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, (prog.pos / prog.dur) * 100) + '%' } })) : null);
}

function filterSort(items, { cat, q, sort }, kind) {
  let out = items;
  if (cat === 'fav') { const f = new Set(favs()[kind]); out = out.filter((x) => f.has(x.id)); }
  else if (cat !== 'all') out = out.filter((x) => x.cat === cat);
  if (q) { const s = q.toLowerCase(); out = out.filter((x) => x.name.toLowerCase().includes(s)); }
  if (sort === 'az') out = [...out].sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'new') out = [...out].sort((a, b) => b.added - a.added);
  else if (sort === 'rating') out = [...out].sort((a, b) => b.rating - a.rating);
  return out;
}

function categoryColumn(title, cats, items, kind, sel, onPick) {
  const counts = new Map();
  for (const x of items) counts.set(x.cat, (counts.get(x.cat) || 0) + 1);
  const find = h('input', { class: 'input', placeholder: 'Find a category' });
  const list = h('div', { class: 'cats-list' });
  const fill = () => {
    const q = find.value.toLowerCase();
    list.replaceChildren();
    const add = (id, name, n) => list.append(h('button', { class: 'cat' + (sel === id ? ' active' : ''), onclick: () => onPick(id) }, h('span', null, name), h('span', { class: 'n' }, n)));
    if (!q) { add('all', 'All', items.length); add('fav', 'Favourites', favs()[kind].length); }
    for (const c of cats) if (counts.get(c.id) && (!q || c.name.toLowerCase().includes(q))) add(c.id, c.name, counts.get(c.id));
  };
  find.addEventListener('input', fill);
  fill();
  return h('aside', { class: 'cats' }, h('div', { class: 'cats-head' }, h('h2', null, title), h('div', { class: 'search' }, find)), list);
}

// ============================================================================ Home

function viewHome() {
  const c = state.catalog, page = h('div', { class: 'page' });
  const p = progress();
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const moviesById = byId(c.movies), seriesById = byId(c.series), liveById = byId(c.live);

  page.append(h('div', { class: 'hello' },
    h('img', { src: 'assets/mark.png', alt: '' }),
    h('div', { class: 'grow' }, h('h2', null, 'Welcome back'),
      h('p', null, c.live.length.toLocaleString() + ' channels · ' + c.movies.length.toLocaleString() + ' movies · ' + c.series.length.toLocaleString() + ' series')),
    h('button', { class: 'btn gold', onclick: () => go('live') }, 'Watch Live TV')));

  // Continue watching: films and episodes part-way through.
  const cont = Object.entries(p).filter(([, v]) => v.dur && v.pos > 30 && v.pos / v.dur < 0.95).sort((a, b) => b[1].ts - a[1].ts).slice(0, 20);
  if (cont.length) page.append(shelf('Continue watching', cont.map(([k, v]) => {
    if (k.startsWith('m:')) { const m = moviesById.get(k.slice(2)); return m ? stripCard(posterCard(m, 'movie', () => playMovie(m))) : null; }
    const s = seriesById.get(v.seriesId);
    const card = stripCard(posterCard({ id: k, name: v.label || v.name, poster: v.poster || (s && s.poster), year: s ? s.name : '' }, 'episode', () => resumeEpisode(k.slice(2), v)));
    card.append(h('div', { class: 'bar' }, h('i', { style: { width: (v.pos / v.dur * 100) + '%' } })));
    return card;
  }).filter(Boolean)));

  const f = favs();
  const favChans = f.live.map((id) => liveById.get(id)).filter(Boolean);
  if (favChans.length) page.append(shelf('Favourite channels', favChans.map(chanTile)));
  const recent = store.get(plKey('recent'), []).map((id) => liveById.get(id)).filter(Boolean);
  if (recent.length) page.append(shelf('Recent channels', recent.map(chanTile)));
  const favMovies = f.movie.map((id) => moviesById.get(id)).filter(Boolean);
  if (favMovies.length) page.append(shelf('Favourite movies', favMovies.map((m) => stripCard(posterCard(m, 'movie', () => openMovieFromAnywhere(m))))));
  const favSeries = f.series.map((id) => seriesById.get(id)).filter(Boolean);
  if (favSeries.length) page.append(shelf('Favourite series', favSeries.map((s) => stripCard(posterCard(s, 'series', () => openSeriesFromAnywhere(s))))));
  const newMovies = [...c.movies].sort((a, b) => b.added - a.added).slice(0, 24);
  if (newMovies.length) page.append(shelf('Recently added movies', newMovies.map((m) => stripCard(posterCard(m, 'movie', () => openMovieFromAnywhere(m))))));
  const newSeries = [...c.series].sort((a, b) => b.added - a.added).slice(0, 24);
  if (newSeries.length) page.append(shelf('Recently updated series', newSeries.map((s) => stripCard(posterCard(s, 'series', () => openSeriesFromAnywhere(s))))));
  return page;
}
const shelf = (title, kids) => h('section', { class: 'shelf' }, h('h2', null, title), h('div', { class: 'strip' }, kids));
const stripCard = (el) => el;
function chanTile(ch) {
  const logo = ch.logo ? h('img', { src: ch.logo, loading: 'lazy', alt: '' }) : h('div', { class: 'logo' }, ch.name.slice(0, 3).toUpperCase());
  if (ch.logo) logo.onerror = () => logo.replaceWith(h('div', { class: 'logo' }, ch.name.slice(0, 3).toUpperCase()));
  return h('div', { class: 'chan', title: ch.name, onclick: () => { const list = state.catalog.live; playLive(ch, list); } }, logo, h('div', { class: 'name' }, ch.name));
}
function openMovieFromAnywhere(m) { state.view = 'movies'; render(); openMovieDetail(m); }
function openSeriesFromAnywhere(s) { state.view = 'series'; state.series.open = s.id; state.series.season = null; render(); }

// ============================================================================ Live TV

let preview = null;   // the stream playing in the Live TV preview pane
function stopPreview() { if (preview) { preview.destroy(); preview = null; } }

function viewLive() {
  const c = state.catalog, st = state.live;
  const items = filterSort(c.live, { cat: st.cat, q: st.q, sort: 'default' }, 'live');
  const wrap = h('div', { class: 'browse' });
  const cats = categoryColumn('Live TV', c.cats.live, c.live, 'live', st.cat, (id) => { st.cat = id; render(); });
  const search = h('input', { class: 'input', placeholder: 'Search channels', value: st.q });
  search.addEventListener('input', debounce(() => { st.q = search.value; const caret = search.selectionStart; render(); const s = $('.content-head .input'); if (s) { s.focus(); s.setSelectionRange(caret, caret); } }, 250));
  const pane = h('div', { class: 'preview' });
  let list;
  const row = (ch, i) => {
    const logo = ch.logo ? h('img', { class: 'logo', src: ch.logo, loading: 'lazy', alt: '' }) : h('div', { class: 'logo empty' }, ch.name.slice(0, 3).toUpperCase());
    if (ch.logo) logo.onerror = () => logo.replaceWith(h('div', { class: 'logo empty' }, ch.name.slice(0, 3).toUpperCase()));
    return h('div', { class: 'row' + (st.sel === ch.id ? ' active' : ''), title: ch.name,
      onclick: () => { st.sel = ch.id; list.refresh(); showChannel(pane, ch, items); },
      ondblclick: () => playLive(ch, items) },
    h('div', { class: 'num' }, ch.num || i + 1), logo, h('div', { class: 'name' }, ch.name), isFav('live', ch.id) ? h('div', { class: 'star' }, '♥') : null);
  };
  list = virtualList(items, row, 58);
  wrap.append(cats, h('div', { class: 'content' },
    h('div', { class: 'content-head' }, h('div', { class: 'search' }, search), h('div', { class: 'count' }, items.length.toLocaleString() + ' channels')),
    items.length ? list : h('div', { class: 'empty-note', style: { padding: '30px' } }, st.cat === 'fav' ? 'No favourite channels yet. Select a channel and tap the heart.' : 'No channels here.')),
  pane);
  const sel = items.find((x) => x.id === st.sel);
  if (sel) { requestAnimationFrame(() => list.scrollToIndex(items.indexOf(sel))); showChannel(pane, sel, items, !!preview); }
  else pane.append(h('div', { class: 'screen' }, h('div', { class: 'msg' }, 'Choose a channel to start watching.\nDouble-click for full screen.')));
  return wrap;
}

function showChannel(pane, ch, list, keepPlaying) {
  const pl = active();
  const video = h('video', { autoplay: true, playsinline: true });
  const msg = h('div', { class: 'msg' }, h('div', { class: 'spinner' }));
  const screen = h('div', { class: 'screen', ondblclick: () => playLive(ch, list) }, video, msg);
  const epg = h('div', { class: 'epg' }, h('h3', null, ch.name));
  const favBtn = h('button', { class: 'btn' }, isFav('live', ch.id) ? '♥ Favourite' : '♡ Add to favourites');
  favBtn.onclick = () => { const on = toggleFav('live', ch.id); favBtn.textContent = on ? '♥ Favourite' : '♡ Add to favourites'; };
  pane.replaceChildren(screen,
    h('div', { class: 'actions' }, h('button', { class: 'btn gold', onclick: () => playLive(ch, list) }, 'Full screen'), favBtn), epg);
  stopPreview();
  pushRecent(ch.id);
  video.addEventListener('playing', () => msg.replaceChildren());
  video.addEventListener('waiting', () => msg.replaceChildren(h('div', { class: 'spinner' })));
  preview = attachStream(video, liveSources(pl, ch), { live: true, onFatal: (m) => { msg.className = 'msg err'; msg.textContent = m; } });
  loadEpg(ch).then((progs) => {
    if (!progs.length) { epg.append(h('div', { class: 'prog' }, h('div', { class: 'desc' }, 'No guide information for this channel.'))); return; }
    const now = Date.now() / 1000;
    progs.slice(0, 4).forEach((p, i) => {
      const on = p.start <= now && now < p.stop;
      epg.append(h('div', { class: 'prog' },
        h('div', { class: 'when' }, (on ? 'NOW · ' : i === 1 ? 'NEXT · ' : '') + clock(p.start) + ' – ' + clock(p.stop)),
        h('div', { class: 'what' }, p.title), p.desc ? h('div', { class: 'desc' }, p.desc) : null,
        on ? h('div', { class: 'pb' }, h('i', { style: { width: ((now - p.start) / (p.stop - p.start) * 100) + '%' } })) : null));
    });
  });
}

const epgCache = new Map();
async function loadEpg(ch) {
  const pl = active();
  if (!pl || pl.type !== 'xtream') return [];
  const hit = epgCache.get(ch.id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.progs;
  try {
    const r = await xt(pl, 'get_short_epg', { stream_id: ch.id, limit: 4 });
    const progs = (r.epg_listings || []).map((e) => ({ title: b64(e.title), desc: b64(e.description), start: Number(e.start_timestamp), stop: Number(e.stop_timestamp) }))
      .filter((p) => p.stop > Date.now() / 1000).sort((a, b) => a.start - b.start);
    epgCache.set(ch.id, { at: Date.now(), progs });
    return progs;
  } catch { return []; }
}

function liveSources(pl, ch) {
  if (pl.type === 'm3u') return [ch.url];
  return [xtUrl(pl, 'live', ch.id, 'm3u8'), xtUrl(pl, 'live', ch.id, 'ts')];
}

function playLive(ch, list) {
  stopPreview();
  const pl = active();
  pushRecent(ch.id);
  const idx = list.findIndex((x) => x.id === ch.id);
  openPlayer({
    kind: 'live', title: ch.name, sources: liveSources(pl, ch), channelId: ch.id,
    sub: '', onEpg: () => loadEpg(ch),
    prev: idx > 0 ? () => playLive(list[idx - 1], list) : null,
    next: idx >= 0 && idx < list.length - 1 ? () => playLive(list[idx + 1], list) : null,
    onClose: () => { state.live.sel = ch.id; if (state.view === 'live') render(); },
  });
}

// ============================================================================ Movies

function viewMovies() {
  const c = state.catalog, st = state.movies;
  const items = filterSort(c.movies, st, 'movie');
  const wrap = h('div', { class: 'browse' });
  const cats = categoryColumn('Movies', c.cats.movies, c.movies, 'movie', st.cat, (id) => { st.cat = id; st.scroll = 0; render(); });
  const search = h('input', { class: 'input', placeholder: 'Search movies', value: st.q });
  search.addEventListener('input', debounce(() => { st.q = search.value; st.scroll = 0; const caret = search.selectionStart; render(); const s = $('.content-head .input'); if (s) { s.focus(); s.setSelectionRange(caret, caret); } }, 250));
  const grid = virtualGrid(items, (m) => posterCard(m, 'movie', () => openMovieDetail(m)), { scrollTo: st.scroll, onScroll: (y) => { st.scroll = y; } });
  wrap.append(cats, h('div', { class: 'content' },
    h('div', { class: 'content-head' }, h('div', { class: 'search' }, search), sortSelect(st), h('div', { class: 'count' }, items.length.toLocaleString() + ' titles')),
    items.length ? grid : h('div', { class: 'empty-note', style: { padding: '30px' } }, st.cat === 'fav' ? 'No favourite movies yet.' : 'Nothing here.')));
  return wrap;
}
function sortSelect(st) {
  const sel = h('select', { class: 'input', style: { width: '170px' } },
    ...[['default', 'Playlist order'], ['new', 'Recently added'], ['az', 'A–Z'], ['rating', 'Top rated']].map(([v, l]) => h('option', { value: v, selected: st.sort === v }, l)));
  sel.onchange = () => { st.sort = sel.value; st.scroll = 0; render(); };
  return sel;
}

async function openMovieDetail(m) {
  document.querySelectorAll('.detail').forEach((d) => d.remove());
  const pl = active();
  const close = () => panel.remove();
  const body = h('div', { class: 'body' });
  const hero = h('div', { class: 'hero', style: { backgroundImage: m.poster ? 'url("' + m.poster.replace(/"/g, '%22') + '")' : '' } }, h('button', { class: 'close', onclick: close, title: 'Close' }, '×'));
  const panel = h('div', { class: 'detail' }, hero, body);
  const draw = (info) => {
    const prog = progress()['m:' + m.id];
    const resumable = prog && prog.dur && prog.pos > 30 && prog.pos / prog.dur < 0.95;
    const favBtn = h('button', { class: 'btn' }, isFav('movie', m.id) ? '♥ Favourite' : '♡ Add to favourites');
    favBtn.onclick = () => { const on = toggleFav('movie', m.id); favBtn.textContent = on ? '♥ Favourite' : '♡ Add to favourites'; };
    const facts = [info.year || m.year, info.duration, info.genre].filter(Boolean);
    body.replaceChildren(
      h('div', { class: 'top' }, m.poster ? h('img', { src: info.poster || m.poster, alt: '' }) : null,
        h('div', null, h('h2', null, info.name || m.name),
          h('div', { class: 'facts' }, (info.rating || m.rating) ? h('span', { class: 'gold' }, '★ ' + Number(info.rating || m.rating).toFixed(1)) : null, ...facts.map((f) => h('span', null, f))))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn gold', onclick: () => { close(); playMovie(m, resumable ? prog.pos : 0); } }, svg(ICON.play), resumable ? 'Resume ' + fmtTime(prog.pos) : 'Play'),
        resumable ? h('button', { class: 'btn', onclick: () => { close(); playMovie(m, 0); } }, 'Start over') : null,
        favBtn,
        info.trailer ? h('button', { class: 'btn', onclick: () => bridge.open('https://www.youtube.com/watch?v=' + encodeURIComponent(info.trailer)) }, 'Trailer') : null),
      info.plot ? h('p', { class: 'plot' }, info.plot) : h('p', { class: 'plot', style: { color: 'var(--dim)' } }, info.loading ? 'Loading details…' : 'No description available.'),
      info.cast ? h('div', { class: 'kv' }, h('b', null, 'Cast: '), info.cast) : null,
      info.director ? h('div', { class: 'kv' }, h('b', null, 'Director: '), info.director) : null);
    if (info.backdrop) hero.style.backgroundImage = 'url("' + info.backdrop.replace(/"/g, '%22') + '")';
  };
  draw({ loading: true });
  $('#view .browse') ? $('#view .browse').append(panel) : $('#view').append(panel);
  if (pl.type !== 'xtream') { draw({}); return; }
  try {
    const r = await xt(pl, 'get_vod_info', { vod_id: m.id });
    const i = r.info || {};
    const bd = Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path;
    draw({ name: (r.movie_data && r.movie_data.name) || m.name, poster: i.movie_image || i.cover_big, backdrop: bd, plot: i.plot || i.description, cast: i.cast || i.actors,
      director: i.director, genre: i.genre, year: yearOf(i.releasedate || i.release_date), duration: i.duration ? String(i.duration).replace(/^00:/, '') : '',
      rating: num(i.rating) || 0, trailer: i.youtube_trailer });
  } catch { draw({}); }
}

function playMovie(m, startAt) {
  const pl = active();
  const key = 'm:' + m.id;
  const saved = progress()[key];
  if (startAt === undefined) startAt = saved && saved.dur && saved.pos / saved.dur < 0.95 ? saved.pos : 0;
  openPlayer({
    kind: 'vod', title: m.name, sub: m.year || '',
    sources: [pl.type === 'm3u' ? m.url : xtUrl(pl, 'movie', m.id, m.ext || 'mp4')],
    startAt, progressKey: key, progressMeta: { name: m.name, poster: m.poster },
    onClose: () => { if (state.view === 'movies' || state.view === 'home') render(); },
  });
}

// ============================================================================ Series

function viewSeries() {
  const c = state.catalog, st = state.series;
  if (st.open) { const s = c.series.find((x) => x.id === st.open); if (s) return seriesPage(s); st.open = null; }
  const items = filterSort(c.series, st, 'series');
  const wrap = h('div', { class: 'browse' });
  const cats = categoryColumn('Series', c.cats.series, c.series, 'series', st.cat, (id) => { st.cat = id; st.scroll = 0; render(); });
  const search = h('input', { class: 'input', placeholder: 'Search series', value: st.q });
  search.addEventListener('input', debounce(() => { st.q = search.value; st.scroll = 0; const caret = search.selectionStart; render(); const s = $('.content-head .input'); if (s) { s.focus(); s.setSelectionRange(caret, caret); } }, 250));
  const grid = virtualGrid(items, (s) => posterCard(s, 'series', () => { st.open = s.id; st.season = null; render(); }), { scrollTo: st.scroll, onScroll: (y) => { st.scroll = y; } });
  wrap.append(cats, h('div', { class: 'content' },
    h('div', { class: 'content-head' }, h('div', { class: 'search' }, search), sortSelect(st), h('div', { class: 'count' }, items.length.toLocaleString() + ' series')),
    items.length ? grid : h('div', { class: 'empty-note', style: { padding: '30px' } }, st.cat === 'fav' ? 'No favourite series yet.' : (c.series.length ? 'Nothing here.' : 'This playlist has no series.'))));
  return wrap;
}

const seriesInfoCache = new Map();
function seriesPage(s) {
  const pl = active(), st = state.series;
  const page = h('div', { class: 'page', style: { padding: 0 } });
  const hero = h('div', { class: 'series-hero', style: { backgroundImage: s.poster ? 'url("' + s.poster.replace(/"/g, '%22') + '")' : '' } });
  const seasonsBar = h('div', { class: 'seasons' });
  const eps = h('div', { class: 'episodes' }, h('div', { class: 'loading', style: { position: 'static', padding: '40px' } }, h('div', { class: 'spinner' })));
  page.append(hero, seasonsBar, eps);
  const drawHero = (info) => {
    const favBtn = h('button', { class: 'btn' }, isFav('series', s.id) ? '♥ Favourite' : '♡ Add to favourites');
    favBtn.onclick = () => { const on = toggleFav('series', s.id); favBtn.textContent = on ? '♥ Favourite' : '♡ Add to favourites'; };
    hero.replaceChildren(h('div', { class: 'info' },
      h('button', { class: 'back', onclick: () => { st.open = null; render(); } }, '← All series'),
      h('h1', null, info.name || s.name),
      h('div', { class: 'facts' }, (info.rating || s.rating) ? h('span', { class: 'gold' }, '★ ' + Number(info.rating || s.rating).toFixed(1)) : null,
        ...[info.year || s.year, info.genre].filter(Boolean).map((f) => h('span', null, f))),
      h('p', { class: 'plot', style: { color: '#ddd4c4', maxWidth: '680px' } }, info.plot || s.plot || ''),
      info.cast ? h('div', { class: 'kv', style: { color: 'var(--muted)', fontSize: '13px' } }, 'Cast: ' + info.cast) : null,
      h('div', { class: 'actions', style: { marginTop: '16px' } }, info.firstEp ? h('button', { class: 'btn gold', onclick: info.firstEp.run }, svg(ICON.play), info.firstEp.label) : null, favBtn,
        info.trailer ? h('button', { class: 'btn', onclick: () => bridge.open('https://www.youtube.com/watch?v=' + encodeURIComponent(info.trailer)) }, 'Trailer') : null)));
    if (info.backdrop) hero.style.backgroundImage = 'url("' + info.backdrop.replace(/"/g, '%22') + '")';
  };
  drawHero({});
  (async () => {
    let data = seriesInfoCache.get(s.id);
    if (!data) {
      try { data = await xt(pl, 'get_series_info', { series_id: s.id }); seriesInfoCache.set(s.id, data); }
      catch (e) { eps.replaceChildren(h('div', { class: 'empty-note' }, 'Couldn\'t load episodes: ' + e.message)); return; }
    }
    const info = data.info || {};
    const bySeason = data.episodes || {};
    const seasons = Object.keys(bySeason).sort((a, b) => Number(a) - Number(b));
    const all = seasons.flatMap((sn) => (bySeason[sn] || []).map((e) => ({ ...e, season: Number(sn) })));
    const p = progress();
    // Where to pick up: the most recently watched unfinished episode, else the first.
    const lastKey = Object.entries(p).filter(([k, v]) => k.startsWith('e:') && v.seriesId === s.id).sort((a, b) => b[1].ts - a[1].ts)[0];
    let firstEp = null;
    if (lastKey) {
      const ep = all.find((e) => 'e:' + e.id === lastKey[0]);
      if (ep) {
        const done = lastKey[1].dur && lastKey[1].pos / lastKey[1].dur >= 0.95;
        const target = done ? all[all.indexOf(ep) + 1] : ep;
        if (target) firstEp = { label: (done ? 'Play ' : 'Resume ') + 'S' + target.season + ' E' + (target.episode_num || ''), run: () => playEpisode(s, target, all) };
      }
    }
    if (!firstEp && all.length) firstEp = { label: 'Play S' + all[0].season + ' E' + (all[0].episode_num || 1), run: () => playEpisode(s, all[0], all) };
    const bd = Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : info.backdrop_path;
    drawHero({ name: info.name, plot: info.plot, cast: info.cast, genre: info.genre, year: yearOf(info.releaseDate || info.release_date), rating: num(info.rating), backdrop: bd, trailer: info.youtube_trailer, firstEp });
    if (!seasons.length) { eps.replaceChildren(h('div', { class: 'empty-note' }, 'No episodes yet.')); return; }
    if (!st.season || !seasons.includes(st.season)) st.season = lastKey ? String((all.find((e) => 'e:' + e.id === lastKey[0]) || {}).season || seasons[0]) : seasons[0];
    const drawSeason = () => {
      seasonsBar.replaceChildren(h('div', { class: 'tabs' }, ...seasons.map((sn) => h('button', { class: 'tab' + (sn === st.season ? ' active' : ''), onclick: () => { st.season = sn; drawSeason(); } }, 'Season ' + sn))));
      eps.replaceChildren(...(bySeason[st.season] || []).map((e) => {
        const ep = { ...e, season: Number(st.season) };
        const pr = progress()['e:' + e.id];
        const ei = e.info || {};
        return h('div', { class: 'ep', onclick: () => playEpisode(s, ep, all) },
          h('div', { class: 'thumb', style: { backgroundImage: ei.movie_image ? 'url("' + String(ei.movie_image).replace(/"/g, '%22') + '")' : (s.poster ? 'url("' + s.poster.replace(/"/g, '%22') + '")' : '') } },
            pr && pr.dur ? h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, pr.pos / pr.dur * 100) + '%' } })) : null),
          h('div', { style: { minWidth: 0 } },
            h('div', { class: 't' }, (e.episode_num ? e.episode_num + '. ' : '') + (e.title || 'Episode')),
            h('div', { class: 's' }, [ei.duration ? String(ei.duration).replace(/^00:/, '') : '', ei.releasedate || ei.air_date || ''].filter(Boolean).join(' · ')),
            ei.plot ? h('div', { class: 'd' }, ei.plot) : null));
      }));
    };
    drawSeason();
  })();
  return page;
}

function playEpisode(s, ep, all) {
  const pl = active();
  const key = 'e:' + ep.id;
  const saved = progress()[key];
  const startAt = saved && saved.dur && saved.pos / saved.dur < 0.95 ? saved.pos : 0;
  const i = all.findIndex((x) => x.id === ep.id);
  const nextEp = i >= 0 ? all[i + 1] : null;
  const label = 'S' + ep.season + ' E' + (ep.episode_num || '') + (ep.title ? ' · ' + ep.title : '');
  openPlayer({
    kind: 'vod', title: s.name, sub: label,
    sources: [xtUrl(pl, 'series', ep.id, ep.container_extension || 'mp4')],
    startAt, progressKey: key, progressMeta: { seriesId: s.id, name: s.name, label: s.name + ' · S' + ep.season + 'E' + (ep.episode_num || ''), poster: s.poster },
    next: nextEp ? () => playEpisode(s, nextEp, all) : null,
    nextLabel: nextEp ? 'Next: S' + nextEp.season + ' E' + (nextEp.episode_num || '') : '',
    onClose: () => { if (state.view === 'series') render(); },
  });
}
async function resumeEpisode(epId, saved) {
  const s = state.catalog.series.find((x) => x.id === saved.seriesId);
  if (!s) return;
  try {
    let data = seriesInfoCache.get(s.id);
    if (!data) { data = await xt(active(), 'get_series_info', { series_id: s.id }); seriesInfoCache.set(s.id, data); }
    const all = Object.keys(data.episodes || {}).sort((a, b) => Number(a) - Number(b)).flatMap((sn) => (data.episodes[sn] || []).map((e) => ({ ...e, season: Number(sn) })));
    const ep = all.find((e) => String(e.id) === String(epId));
    if (ep) playEpisode(s, ep, all);
  } catch (e) { toast('Couldn\'t open that episode: ' + e.message); }
}

// ============================================================================ Favourites & Search

function viewFavourites() {
  const c = state.catalog, f = favs(), page = h('div', { class: 'page' });
  page.append(h('div', { class: 'page-head' }, h('h1', null, 'Favourites')));
  const live = f.live.map((id) => c.live.find((x) => x.id === id)).filter(Boolean);
  const movies = f.movie.map((id) => c.movies.find((x) => x.id === id)).filter(Boolean);
  const series = f.series.map((id) => c.series.find((x) => x.id === id)).filter(Boolean);
  if (!live.length && !movies.length && !series.length) page.append(h('p', { class: 'empty-note' }, 'Nothing here yet. Tap ♡ on a channel, movie or series to save it here.'));
  if (live.length) page.append(shelf('Channels', live.map(chanTile)));
  if (movies.length) page.append(shelf('Movies', movies.map((m) => posterCard(m, 'movie', () => openMovieFromAnywhere(m)))));
  if (series.length) page.append(shelf('Series', series.map((s) => posterCard(s, 'series', () => openSeriesFromAnywhere(s)))));
  page.querySelectorAll('.strip .card').forEach((el) => { el.style.position = 'relative'; });
  return page;
}

let lastSearch = '';
function viewSearch() {
  const page = h('div', { class: 'page' });
  const input = h('input', { class: 'input', placeholder: 'Search channels, movies and series', value: lastSearch, style: { fontSize: '17px', padding: '14px 16px 14px 40px' } });
  const results = h('div');
  const run = () => {
    lastSearch = input.value.trim();
    const q = lastSearch.toLowerCase();
    results.replaceChildren();
    if (q.length < 2) { results.append(h('p', { class: 'empty-note' }, 'Type at least two letters.')); return; }
    const c = state.catalog;
    const match = (list) => list.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 40);
    const live = match(c.live), movies = match(c.movies), series = match(c.series);
    if (!live.length && !movies.length && !series.length) results.append(h('p', { class: 'empty-note' }, 'No matches for “' + lastSearch + '”.'));
    if (live.length) results.append(shelf('Channels', live.map(chanTile)));
    if (movies.length) results.append(shelf('Movies', movies.map((m) => posterCard(m, 'movie', () => openMovieFromAnywhere(m)))));
    if (series.length) results.append(shelf('Series', series.map((s) => posterCard(s, 'series', () => openSeriesFromAnywhere(s)))));
    results.querySelectorAll('.strip .card').forEach((el) => { el.style.position = 'relative'; });
  };
  input.addEventListener('input', debounce(run, 200));
  page.append(h('div', { class: 'page-head' }, h('h1', null, 'Search')), h('div', { class: 'search', style: { maxWidth: '720px', marginBottom: '24px' } }, input), results);
  run();
  requestAnimationFrame(() => input.focus());
  return page;
}

// ============================================================================ Settings

let updateState = { state: 'idle' };
function viewSettings() {
  const page = h('div', { class: 'page' }), box = h('div', { class: 'settings' });
  page.append(h('div', { class: 'page-head' }, h('h1', null, 'Settings')), box);
  const plSec = h('div', { class: 'section' }, h('h2', null, 'Playlists'));
  state.playlists.forEach((p) => {
    const inUse = active() && p.id === active().id;
    const exp = p.expires ? 'Expires ' + new Date(p.expires).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    plSec.append(h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, p.name, inUse ? h('span', { class: 'badge' }, 'IN USE') : null),
        h('div', { class: 's' }, [p.type === 'm3u' ? 'M3U link' : p.server, exp].filter(Boolean).join(' · '))),
      inUse ? h('button', { class: 'btn small', onclick: async () => { await bridge.cacheClear('cat_' + p.id); seriesInfoCache.clear(); epgCache.clear(); await loadCatalog(true); toast('Playlist refreshed'); render(); } }, 'Refresh')
        : h('button', { class: 'btn small', onclick: () => usePlaylist(p.id) }, 'Use'),
      h('button', { class: 'btn small', onclick: () => { const close = modal('Edit playlist', playlistForm(p, async (np) => { close(); await addOrUpdatePlaylist(np); }, () => close())); } }, 'Edit'),
      h('button', { class: 'btn small danger', onclick: () => {
        const close = modal('Delete ' + p.name + '?', h('div', null, h('p', { style: { color: 'var(--muted)' } }, 'Its favourites and watch progress are removed too.'),
          h('div', { class: 'actions', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
            h('button', { class: 'btn danger', onclick: async () => {
              close(); state.playlists = state.playlists.filter((x) => x.id !== p.id);
              ['fav', 'prog', 'recent'].forEach((k) => store.del(k + '_' + p.id)); await bridge.cacheClear('cat_' + p.id);
              if (state.activeId === p.id) { state.activeId = state.playlists[0] ? state.playlists[0].id : null; savePlaylists(); await usePlaylist(state.activeId); } else { savePlaylists(); render(); }
            } }, 'Delete'))));
      } }, 'Delete')));
  });
  plSec.append(h('div', { class: 'actions', style: { marginTop: '10px' } },
    h('button', { class: 'btn gold', onclick: () => { const close = modal('Add a playlist', playlistForm(null, async (np) => { close(); await addOrUpdatePlaylist(np); }, () => close())); } }, '+ Add playlist'),
    h('button', { class: 'btn', onclick: () => bridge.open(SITE) }, 'Get a playlist at mitsflix.com')));
  box.append(plSec);

  const upd = h('div', { class: 's' });
  const updBtn = h('button', { class: 'btn small' }, 'Check for updates');
  const drawUpd = () => {
    const s = updateState;
    upd.textContent = { idle: 'Updates install automatically.', checking: 'Checking…', latest: 'You have the latest version.', downloading: 'Downloading update' + (s.percent ? ' · ' + s.percent + '%' : '') + '…',
      ready: 'Update ' + (s.version || '') + ' is ready.', error: 'Couldn\'t check for updates.', dev: 'Updates work in the installed app.' }[s.state] || '';
    updBtn.textContent = s.state === 'ready' ? 'Restart to update' : 'Check for updates';
    updBtn.onclick = s.state === 'ready' ? () => bridge.installUpdate() : async () => { updateState = await bridge.checkUpdate(); drawUpd(); };
  };
  drawUpd(); onUpdateDraw = drawUpd;
  const ver = h('span');
  bridge.info().then((i) => { ver.textContent = 'Version ' + i.version; });
  box.append(h('div', { class: 'section' }, h('h2', null, 'App'),
    h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Mitsflix Player for Windows'), h('div', { class: 's' }, ver)), updBtn),
    h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Updates'), upd)),
    h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Keyboard shortcuts'),
      h('div', { class: 's' }, 'Space play/pause · ← → skip 10s · ↑ ↓ volume (channel on Live TV) · F full screen · M mute · N next episode · Esc close')))));
  return page;
}
let onUpdateDraw = null;
bridge.onUpdate((s) => {
  updateState = s;
  if (onUpdateDraw && state.view === 'settings') onUpdateDraw();
  if (s.state === 'ready') toast('A new version of Mitsflix Player is ready.', { label: 'Restart now', run: () => bridge.installUpdate() });
});

// ============================================================================ Streams

let activeStream = null;  // only one stream at a time (most playlists allow one connection)

function attachStream(video, sources, { live, onFatal, onReady } = {}) {
  let hls = null, mp = null, idx = 0, dead = false, mediaRecovered = false;
  const cleanup = () => {
    if (hls) { try { hls.destroy(); } catch { /* ignore */ } hls = null; }
    if (mp) { try { mp.pause(); mp.unload(); mp.detachMediaElement(); mp.destroy(); } catch { /* ignore */ } mp = null; }
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
  };
  const fail = (why) => {
    if (dead) return;
    if (idx < sources.length - 1) { idx++; cleanup(); start(); return; }
    onFatal && onFatal(why);
  };
  const start = () => {
    const url = sources[idx];
    const isHls = /\.m3u8(\?|$)/i.test(url), isTs = /\.ts(\?|$)/i.test(url) || (live && !isHls && !/\.(mp4|mkv|webm|mov)(\?|$)/i.test(url));
    if (isHls && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ maxBufferLength: live ? 20 : 60, backBufferLength: 30, enableWorker: true, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3 });
      hls.on(window.Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) { mediaRecovered = true; hls.recoverMediaError(); return; }
        fail(d.type === window.Hls.ErrorTypes.NETWORK_ERROR ? 'The stream isn\'t responding. It may be offline, or another device is using this playlist.' : 'This stream couldn\'t be played.');
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { onReady && onReady(hls); });
      hls.loadSource(url); hls.attachMedia(video);
    } else if (isTs && window.mpegts && window.mpegts.isSupported()) {
      mp = window.mpegts.createPlayer({ type: 'mpegts', isLive: !!live, url }, { enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: !!live });
      mp.on(window.mpegts.Events.ERROR, () => fail('The stream isn\'t responding. It may be offline, or another device is using this playlist.'));
      mp.attachMediaElement(video); mp.load();
    } else {
      video.src = url;
    }
    video.play().catch(() => { /* autoplay waits for data */ });
  };
  const onErr = () => {
    const code = video.error && video.error.code;
    if (code === 4) fail('This title\'s video or audio format isn\'t supported by the Windows player yet.');
    else fail('This title couldn\'t be played. Check your connection and try again.');
  };
  video.addEventListener('error', onErr);
  if (activeStream && activeStream !== preview) activeStream.destroy();
  start();
  const handle = { destroy() { dead = true; video.removeEventListener('error', onErr); cleanup(); if (activeStream === handle) activeStream = null; }, get hls() { return hls; } };
  activeStream = handle;
  return handle;
}

// ============================================================================ Player

let playerSession = null;
function openPlayer(opts) {
  if (playerSession) playerSession.close(true);
  stopPreview();
  const root = $('#player');
  root.hidden = false;
  const video = h('video', { autoplay: true, playsinline: true });
  const center = h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }));
  const isLive = opts.kind === 'live';

  const pb = (icon, title, fn, cls = '') => { const b = h('button', { class: 'pbtn ' + cls, title, onclick: (e) => { e.stopPropagation(); fn(); } }, svg(icon)); return b; };
  const playBtn = pb(ICON.pause, 'Play / pause (Space)', () => togglePlay(), 'big');
  const fullBtn = pb(ICON.full, 'Full screen (F)', () => toggleFull());
  const muteBtn = pb(ICON.vol, 'Mute (M)', () => { video.muted = !video.muted; });
  const vol = h('input', { class: 'vol', type: 'range', min: 0, max: 1, step: 0.05, value: store.get('volume', 1), oninput: () => { video.volume = Number(vol.value); video.muted = false; } });
  video.volume = Number(vol.value);
  const time = h('span', { class: 'time' });
  const ccBtn = pb(ICON.cc, 'Subtitles & audio', () => toggleMenu());
  ccBtn.hidden = true;
  const nextBtn = opts.next ? h('button', { class: 'pbtn text', onclick: (e) => { e.stopPropagation(); goNext(); } }, svg(ICON.next), ' ', opts.nextLabel || 'Next') : null;

  // Seek bar (films and episodes)
  const fill = h('div', { class: 'fill' }), buf = h('div', { class: 'buf' }), knob = h('div', { class: 'knob' }), tip = h('div', { class: 'tip', hidden: true });
  const seek = h('div', { class: 'seek' }, h('div', { class: 'track' }), buf, fill, knob, tip);
  const ratioAt = (e) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  let dragging = false;
  seek.addEventListener('pointerdown', (e) => { if (!video.duration) return; dragging = true; seek.setPointerCapture(e.pointerId); drawSeek(ratioAt(e)); e.stopPropagation(); });
  seek.addEventListener('pointermove', (e) => {
    if (!video.duration) return;
    const r = ratioAt(e); tip.hidden = false; tip.style.left = (r * 100) + '%'; tip.textContent = fmtTime(r * video.duration);
    if (dragging) drawSeek(r);
  });
  seek.addEventListener('pointerleave', () => { if (!dragging) tip.hidden = true; });
  seek.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; video.currentTime = ratioAt(e) * video.duration; tip.hidden = true; });
  const drawSeek = (r) => { fill.style.width = (r * 100) + '%'; knob.style.left = (r * 100) + '%'; };

  const epgLine = h('div', { class: 'sub' }, opts.sub || '');
  const top = h('div', { class: 'top' },
    pb(ICON.backArrow, 'Back (Esc)', () => close()),
    h('div', null, h('div', { class: 'title' }, opts.title), epgLine),
    isLive ? h('span', { class: 'live-badge' }, 'LIVE') : null);
  const bar = h('div', { class: 'bar' },
    isLive && opts.prev ? pb(ICON.up, 'Previous channel (↑)', () => opts.prev()) : null,
    isLive && opts.next ? pb(ICON.down, 'Next channel (↓)', () => opts.next()) : null,
    playBtn,
    isLive ? null : pb(ICON.back10, 'Back 10 seconds (←)', () => skip(-10)),
    isLive ? null : pb(ICON.fwd10, 'Forward 10 seconds (→)', () => skip(10)),
    isLive ? null : time,
    h('div', { class: 'grow' }),
    !isLive ? nextBtn : null,
    ccBtn, muteBtn, vol, fullBtn);
  const bottom = h('div', { class: 'bottom', onclick: (e) => e.stopPropagation(), ondblclick: (e) => e.stopPropagation() }, isLive ? null : seek, bar);
  top.addEventListener('click', (e) => e.stopPropagation());
  const menu = h('div', { class: 'menu', hidden: true, onclick: (e) => e.stopPropagation() });
  const ui = h('div', { class: 'ui' }, top, bottom);
  root.replaceChildren(video, center, ui, menu);

  // Controls hide after 3 seconds without the mouse moving.
  let idleTimer = null;
  const wake = () => { root.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!video.paused && menu.hidden && !dragging) root.classList.add('idle'); }, 3000); };
  root.onmousemove = wake;
  root.onclick = () => { if (!menu.hidden) { menu.hidden = true; return; } togglePlay(); };
  root.ondblclick = () => toggleFull();
  wake();

  const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); wake(); };
  const skip = (s) => { if (video.duration) video.currentTime = Math.min(video.duration - 1, Math.max(0, video.currentTime + s)); wake(); };
  const toggleFull = async () => { const on = await bridge.fullscreen(); if (!window.mitsflix) { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen(); } fullBtn.replaceChildren(svg(on ? ICON.exitFull : ICON.full)); };
  const goNext = () => { if (opts.next) { saveNow(); const n = opts.next; close(true); n(); } };

  video.addEventListener('play', () => { playBtn.replaceChildren(svg(ICON.pause)); wake(); });
  video.addEventListener('pause', () => { playBtn.replaceChildren(svg(ICON.play)); root.classList.remove('idle'); saveNow(); });
  video.addEventListener('waiting', () => center.replaceChildren(h('div', { class: 'spinner' })));
  video.addEventListener('playing', () => center.replaceChildren());
  video.addEventListener('volumechange', () => { muteBtn.replaceChildren(svg(video.muted || video.volume === 0 ? ICON.mute : ICON.vol)); store.set('volume', video.volume); });
  let started = false;
  video.addEventListener('loadedmetadata', () => {
    if (!started && opts.startAt && video.duration && opts.startAt < video.duration - 5) video.currentTime = opts.startAt;
    started = true; refreshTracks();
  });
  video.addEventListener('timeupdate', () => {
    if (!isLive && video.duration) {
      if (!dragging) drawSeek(video.currentTime / video.duration);
      time.textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
      if (video.buffered.length) buf.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%';
      if (Math.floor(video.currentTime) % 10 === 0) saveNow();
    }
  });
  video.addEventListener('ended', () => {
    if (opts.progressKey) saveProgress(opts.progressKey, { pos: video.duration, dur: video.duration, ...opts.progressMeta });
    if (opts.next && !isLive) goNext();
  });
  video.textTracks.addEventListener && video.textTracks.addEventListener('addtrack', () => refreshTracks());

  const saveNow = () => { if (opts.progressKey && video.duration && video.currentTime > 5) saveProgress(opts.progressKey, { pos: video.currentTime, dur: video.duration, ...opts.progressMeta }); };

  // Subtitles and audio tracks (when the stream has them).
  let stream = null;
  const refreshTracks = () => {
    const hls = stream && stream.hls;
    const subs = [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    const audios = hls && hls.audioTracks && hls.audioTracks.length > 1 ? hls.audioTracks : [];
    ccBtn.hidden = !subs.length && !audios.length;
  };
  const toggleMenu = () => {
    if (!menu.hidden) { menu.hidden = true; return; }
    const hls = stream && stream.hls;
    menu.replaceChildren();
    const subs = [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    if (subs.length) {
      menu.append(h('h4', null, 'Subtitles'));
      const anyOn = subs.some((t) => t.mode === 'showing');
      menu.append(h('button', { class: anyOn ? '' : 'on', onclick: () => { subs.forEach((t) => { t.mode = 'disabled'; }); menu.hidden = true; } }, 'Off'));
      subs.forEach((t) => menu.append(h('button', { class: t.mode === 'showing' ? 'on' : '', onclick: () => { subs.forEach((x) => { x.mode = x === t ? 'showing' : 'disabled'; }); menu.hidden = true; } }, t.label || t.language || 'Subtitles')));
    }
    if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
      menu.append(h('h4', null, 'Audio'));
      hls.audioTracks.forEach((t, i) => menu.append(h('button', { class: hls.audioTrack === i ? 'on' : '', onclick: () => { hls.audioTrack = i; menu.hidden = true; } }, t.name || t.lang || 'Track ' + (i + 1))));
    }
    menu.hidden = false;
  };

  const onKey = (e) => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft' && !isLive) { e.preventDefault(); skip(-10); }
    else if (k === 'ArrowRight' && !isLive) { e.preventDefault(); skip(10); }
    else if (k === 'ArrowUp') { e.preventDefault(); if (isLive && opts.prev) opts.prev(); else { video.volume = Math.min(1, video.volume + 0.05); vol.value = video.volume; } }
    else if (k === 'ArrowDown') { e.preventDefault(); if (isLive && opts.next) opts.next(); else { video.volume = Math.max(0, video.volume - 0.05); vol.value = video.volume; } }
    else if (k === 'f' || k === 'F') toggleFull();
    else if (k === 'm' || k === 'M') video.muted = !video.muted;
    else if ((k === 'n' || k === 'N') && !isLive) goNext();
    else if (k === 'Escape') { if (!menu.hidden) menu.hidden = true; else close(); }
    wake();
  };
  document.addEventListener('keydown', onKey, true);

  // Live: show what's on now under the channel name.
  if (isLive && opts.onEpg) opts.onEpg().then((progs) => {
    const now = Date.now() / 1000; const p = progs.find((x) => x.start <= now && now < x.stop);
    if (p && playerSession && playerSession.video === video) epgLine.textContent = 'Now: ' + p.title + ' · ' + clock(p.start) + ' – ' + clock(p.stop);
  });

  stream = attachStream(video, opts.sources, { live: isLive, onReady: () => refreshTracks(), onFatal: (m) => { center.replaceChildren(h('span', null, m)); root.classList.remove('idle'); } });

  const close = async (switching) => {
    saveNow();
    document.removeEventListener('keydown', onKey, true);
    clearTimeout(idleTimer);
    if (stream) stream.destroy();
    root.hidden = true; root.replaceChildren(); root.classList.remove('idle');
    playerSession = null;
    if (!switching) { await bridge.fullscreen(false); if (opts.onClose) opts.onClose(); }
  };
  playerSession = { close, video };
}

// ============================================================================ start

(async function start() {
  if (state.playlists.length && !active()) { state.activeId = state.playlists[0].id; savePlaylists(); }
  render();
  if (active()) { await loadCatalog(); render(); }
})();
