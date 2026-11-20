/* Mitsflix Player in a web browser (mitsflix.com/watch).
 * Stands in for the desktop app's main process: the same interface (app.js) runs on top of it.
 * Video and playlist data go straight from the IPTV server to the viewer's browser; mitsflix.com
 * only serves these files (and the subtitle search). Things only the app can do (downloads,
 * recording, self-updates) are switched off. */
'use strict';
(function () {
  const secure = location.protocol === 'https:';
  // A secure page can only load secure addresses, so http server addresses are used over https.
  const upgrade = (u) => (secure ? String(u).replace(/^http:\/\//i, 'https://') : String(u));

  // ---- Playlist cache in IndexedDB (catalogues are too big for localStorage)
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('mitsflix', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cache');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('cache', mode); const q = fn(t.objectStore('cache')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };

  // ---- Subtitles through mitsflix.com (same site, so no extra set-up)
  const SUBS = '/subs';
  const acct = () => { try { return JSON.parse(localStorage.getItem('mx.subsAccount') || 'null'); } catch { return null; } };
  const saveAcct = (a) => { try { a ? localStorage.setItem('mx.subsAccount', JSON.stringify(a)) : localStorage.removeItem('mx.subsAccount'); } catch { /* private window */ } };
  async function subsFetch(path, { method = 'GET', body, auth } = {}) {
    const a = acct();
    const headers = { Accept: 'application/json', 'X-Mitsflix-Web': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && a && a.token) headers.Authorization = 'Bearer ' + a.token;
    if (a && a.host) headers['X-OS-Host'] = a.host;
    const r = await fetch(SUBS + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data };
  }
  const guard = (fn) => async (...a) => { try { return { ok: true, value: await fn(...a) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } };
  const decode = (buf) => { const b = new Uint8Array(buf); if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b); try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); } };

  const noApp = 'This needs the Mitsflix Player app. Get it free at mitsflix.com/download.';
  window.mitsflix = {
    web: true,
    streamUrl: upgrade,
    fetch: async (url) => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
        const r = await fetch(upgrade(url), { signal: ctl.signal, credentials: 'omit' }); clearTimeout(t);
        return { ok: r.ok, status: r.status, text: await r.text() };
      } catch (e) {
        // A browser hides why a request failed; offline is the one case we can tell apart.
        return { ok: false, status: 0, error: navigator.onLine === false ? 'ERR_INTERNET_DISCONNECTED' : String(e && e.name === 'AbortError' ? 'TIMED_OUT' : 'ERR_FAILED') };
      }
    },
    cacheGet: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
    cacheSet: (k, v) => tx('readwrite', (s) => s.put(v, k)).then(() => true).catch(() => false),
    cacheClear: () => tx('readwrite', (s) => s.clear()).then(() => true).catch(() => false),
    open: async (u) => { window.open(u, '_blank', 'noopener'); },
    info: async () => ({ version: 'web', site: 'https://mitsflix.com', web: true }),
    // The interface itself toggles full screen in a browser; this only leaves it when asked.
    fullscreen: async (on) => { if (on === false && document.fullscreenElement) await document.exitFullscreen().catch(() => {}); return !!document.fullscreenElement; },
    checkUpdate: async () => ({ state: 'web' }), installUpdate: async () => {}, onUpdate: () => {},
    downloads: async () => ({ items: [], dir: '', holding: false }), onDownloads: () => {},
    dlAdd: async () => ({ ok: false, error: noApp }), dlRecord: async () => ({ ok: false, error: noApp }),
    dlPause: async () => ({}), dlResume: async () => ({}), dlRemove: async () => ({}), dlStopRecording: async () => ({}),
    dlHold: async () => {}, dlShow: async () => {}, dlOpenFolder: async () => {}, dlChooseFolder: async () => '',
    subsStatus: async () => {
      let ready = false; try { ready = !!(await subsFetch('/ready')).data.ready; } catch { /* offline */ }
      const a = acct(); return { ready, user: a ? a.user : '', perDay: a ? a.perDay : 0 };
    },
    subsLogin: guard(async (user, password) => {
      const r = await subsFetch('/login', { method: 'POST', body: { username: String(user || '').trim(), password: String(password || '') } });
      if (r.status === 401 || r.status === 400) throw new Error('That username or password isn\'t right. Use your OpenSubtitles username, not your email.');
      if (r.status !== 200 || !r.data.token) throw new Error((r.data && r.data.message) || 'OpenSubtitles couldn\'t sign you in right now. Try again in a minute.');
      const host = /^(vip-)?api\.opensubtitles\.com$/.test(r.data.base_url || '') ? r.data.base_url : '';
      const a = { user: String(user).trim(), token: r.data.token, host, perDay: (r.data.user && r.data.user.allowed_downloads) || 0 };
      saveAcct(a); return { user: a.user, perDay: a.perDay };
    }),
    subsLogout: guard(async () => { await subsFetch('/logout', { method: 'DELETE', auth: true }).catch(() => {}); saveAcct(null); }),
    subsSearch: guard(async (q) => {
      const p = new URLSearchParams();
      const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, String(v).trim().toLowerCase()); };
      add('query', q.query); add('languages', q.language); add('season_number', q.season); add('episode_number', q.episode); add('year', q.year);
      p.set('order_by', 'download_count'); p.sort();
      const r = await subsFetch('/subtitles?' + p.toString());
      if (r.status !== 200) throw new Error((r.data && r.data.message) || 'The subtitle search didn\'t work. Try again in a minute.');
      return (r.data.data || []).map((d) => {
        const a = d.attributes || {}, f = (a.files || [])[0] || {}, fd = a.feature_details || {};
        return { id: f.file_id, name: a.release || f.file_name || fd.title || 'Subtitles', title: fd.movie_name || fd.title || '', lang: a.language || '', downloads: a.download_count || 0, hi: !!a.hearing_impaired, ai: !!(a.ai_translated || a.machine_translated) };
      }).filter((x) => x.id).slice(0, 40);
    }),
    subsDownload: guard(async (fileId) => {
      if (!acct()) return { needLogin: true };
      const r = await subsFetch('/download', { method: 'POST', auth: true, body: { file_id: Number(fileId), sub_format: 'srt' } });
      if (r.status === 401) { saveAcct(null); return { needLogin: true }; }
      if (r.status === 406 || r.status === 429) throw new Error((r.data && r.data.message) || 'You\'ve used today\'s subtitle downloads on your OpenSubtitles account. Try again tomorrow.');
      if (r.status !== 200 || !r.data.link) throw new Error((r.data && r.data.message) || 'That subtitle couldn\'t be fetched. Try another one.');
      const file = await fetch(r.data.link);
      if (!file.ok) throw new Error('That subtitle couldn\'t be fetched. Try another one.');
      return { text: decode(await file.arrayBuffer()), remaining: r.data.remaining };
    }),
    subsPickFile: guard(() => new Promise((res, rej) => {
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.srt,.vtt,.ass,.ssa,.sub,.txt';
      i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); if (f.size > 5 * 1024 * 1024) return rej(new Error('That file is too big to be a subtitle file.')); res({ name: f.name, text: decode(await f.arrayBuffer()) }); };
      i.click();
    })),
  };
  document.documentElement.classList.add('web');
})();
