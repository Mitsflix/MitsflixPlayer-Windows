// Mitsflix Player for Windows and Linux — downloads and live TV recordings.
// Plain Node (no Electron imports) so it can be tested on its own. main.js wires it to the window.
//
// Downloads: one at a time (most playlists allow a single connection), saved as <file>.part and
// resumed with HTTP Range, so pausing or closing the app never throws work away.
// Recordings: the channel's MPEG-TS stream written straight to disk, with a small index of byte
// ranges so the file can be played back (and scrubbed) as an HLS playlist, even while it's still
// recording.
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PACKET = 188;                       // MPEG-TS packet size
const MAX_OPEN_ENDED = 6 * 60 * 60 * 1000; // a recording with no end time stops itself after 6 hours
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeName(s, max = 110) {
  let n = String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = '_' + n;
  return n.slice(0, max).trim() || 'Untitled';
}
const safeExt = (e, fallback) => { const x = String(e || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return x && x.length <= 5 ? x : fallback; };

function statusText(code) {
  if (code === 401 || code === 403) return 'The server refused the connection. Your playlist may have expired, or another device is using it.';
  if (code === 404) return 'This title is no longer on the server.';
  if (code === 429 || code === 509) return 'The server says the connection limit is reached. Stop other devices and try again.';
  return 'The server replied with an error (' + code + ').';
}
function friendly(err) {
  const code = err && err.code;
  if (code === 'ENOSPC') return 'The disk is full. Free up some space and try again.';
  if (code === 'EACCES' || code === 'EPERM') return 'The app isn\'t allowed to write to the downloads folder. Choose another folder in Downloads.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'No internet connection, or the server address can\'t be found.';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return 'The connection to the server dropped.';
  return String((err && err.message) || err || 'Something went wrong.');
}

// GET that follows redirects (IPTV servers often bounce to another host). ctl.req is the live
// request, so a caller can cancel while still connecting.
function open(url, headers, ctl, left = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Invalid address')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('Invalid address'));
    const req = (u.protocol === 'https:' ? https : http).get(u, { headers, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (left <= 0) return reject(new Error('The server keeps redirecting.'));
        return resolve(open(new URL(res.headers.location, u).toString(), headers, ctl, left - 1));
      }
      resolve(res);
    });
    if (ctl) ctl.req = req;
    req.on('timeout', () => req.destroy(Object.assign(new Error('The server stopped responding.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

class Downloads {
  // env: { dataFile, defaultDir, userAgent, notify(snapshot), onBusy(bool) }
  constructor(env) {
    this.env = env;
    this.items = [];
    this.dir = env.defaultDir;
    this.hold = 0;        // >0 while the viewer is watching something over the playlist connection
    this.job = null;      // the download in flight
    this.rec = null;      // the recording in flight
    this.settle = null;   // resolves when a stopped job has let go of its file
    this.lastNotify = 0;
    this.saveTimer = null;
    this.load();
    this.timer = setInterval(() => this.checkSchedule(), 10000);
    if (this.timer.unref) this.timer.unref();
  }

  // ---- state on disk

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.env.dataFile, 'utf8'));
      if (j.dir) this.dir = j.dir;
      this.items = Array.isArray(j.items) ? j.items : [];
    } catch { /* first run */ }
    for (const it of this.items) {
      if (it.status === 'downloading') it.status = 'queued';
      if (it.status === 'recording') {
        // The app closed mid-recording: keep what was captured.
        let size = 0;
        try { size = fs.statSync(it.file).size; } catch { /* nothing written */ }
        it.bytes = size;
        it.status = size ? 'done' : 'error';
        it.error = size ? null : 'The app closed before anything was recorded.';
        it.note = size ? 'Stopped early (the app was closed).' : null;
        it.endedAt = it.endedAt || Date.now();
      }
    }
    setTimeout(() => { this.checkSchedule(); this.pump(); }, 1500);
  }
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const tmp = this.env.dataFile + '.tmp';
      fs.promises.mkdir(path.dirname(this.env.dataFile), { recursive: true })
        .then(() => fs.promises.writeFile(tmp, JSON.stringify({ dir: this.dir, items: this.items })))
        .then(() => fs.promises.rename(tmp, this.env.dataFile))
        .catch(() => { /* best effort */ });
    }, 300);
  }
  snapshot() {
    return {
      dir: this.dir,
      holding: this.hold > 0,
      items: this.items.map(({ url, ...rest }) => rest), // the page never needs the address back
    };
  }
  changed() {
    this.lastNotify = Date.now();
    this.save();
    if (this.env.onBusy) this.env.onBusy(!!(this.job || this.rec));
    if (this.env.notify) this.env.notify(this.snapshot());
  }
  tick() {
    if (Date.now() - this.lastNotify < 700) return;
    this.lastNotify = Date.now();
    if (this.env.notify) this.env.notify(this.snapshot());
  }
  get(id) { return this.items.find((x) => x.id === id) || null; }

  setDir(dir) { if (dir) { this.dir = dir; this.changed(); } return this.dir; }

  // ---- downloads

  add(spec) {
    if (!spec || !/^https?:\/\//i.test(spec.url || '')) throw new Error('Invalid address');
    const old = this.items.find((x) => x.key === spec.key && x.kind !== 'recording');
    if (old) {
      if (old.status === 'error' || old.status === 'paused') this.resume(old.id);
      return old.id;
    }
    const ext = safeExt(spec.ext, 'mp4');
    const folder = spec.kind === 'episode' ? path.join(this.dir, 'Series', safeName(spec.group || spec.title, 80)) : path.join(this.dir, 'Movies');
    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      key: String(spec.key), kind: spec.kind === 'episode' ? 'episode' : 'movie',
      title: String(spec.title || 'Untitled'), sub: String(spec.sub || ''), group: String(spec.group || ''),
      poster: String(spec.poster || ''), progressKey: String(spec.progressKey || ''), meta: spec.meta || null,
      url: spec.url, ext, file: this.freePath(folder, safeName(spec.fileName || spec.title), ext),
      status: 'queued', bytes: 0, total: 0, error: null, createdAt: Date.now(),
    };
    this.items.unshift(item);
    this.changed();
    this.pump();
    return item.id;
  }
  // A path nothing else in the list is using.
  freePath(folder, base, ext) {
    let p = path.join(folder, base + '.' + ext), n = 2;
    const taken = (f) => this.items.some((x) => x.file === f) || fs.existsSync(f);
    while (taken(p)) p = path.join(folder, base + ' (' + n++ + ').' + ext);
    return p;
  }

  pause(id) {
    const it = this.get(id);
    if (!it) return;
    if (this.job && this.job.id === id) this.stopJob('paused');
    else if (it.status === 'queued') { it.status = 'paused'; this.changed(); }
  }
  resume(id) {
    const it = this.get(id);
    if (!it || !['paused', 'error'].includes(it.status) || it.kind === 'recording') return;
    it.status = 'queued'; it.error = null;
    this.changed();
    this.pump();
  }
  async remove(id) {
    const it = this.get(id);
    if (!it) return;
    if (this.job && this.job.id === id) this.stopJob('paused');
    if (this.rec && this.rec.id === id) await this.stopRecording(id);
    if (this.settle) await this.settle;
    this.items = this.items.filter((x) => x.id !== id);
    for (const f of [it.file, it.file + '.part', it.file + '.idx']) await fs.promises.unlink(f).catch(() => {});
    this.changed();
    this.pump();
  }

  // Watching over the playlist connection pauses the download; it carries on afterwards.
  setHold(delta) {
    this.hold = Math.max(0, this.hold + delta);
    if (this.hold > 0 && this.job) this.stopJob('queued');
    else { this.changed(); this.pump(); }
  }
  resetHold() { this.hold = 0; this.changed(); this.pump(); }

  stopJob(status) {
    const job = this.job;
    if (!job) return;
    job.stopped = true;
    this.job = null;
    const it = this.get(job.id);
    if (it) it.status = status;
    if (job.ctl.abort) job.ctl.abort(); else if (job.ctl.req) job.ctl.req.destroy();
    this.changed();
  }

  pump() {
    if (this.job || this.rec || this.hold > 0) return;
    if (this.settle) { this.settle.then(() => this.pump()); return; }
    const next = [...this.items].reverse().find((x) => x.status === 'queued'); // oldest first
    if (next) this.run(next);
  }

  async run(item) {
    const job = { id: item.id, ctl: {}, stopped: false };
    this.job = job;
    let release;
    this.settle = new Promise((r) => { release = r; });
    item.status = 'downloading'; item.error = null;
    this.changed();
    const part = item.file + '.part';
    let tries = 0;
    try {
      await fs.promises.mkdir(path.dirname(item.file), { recursive: true });
      for (;;) {
        let have = 0;
        try { have = (await fs.promises.stat(part)).size; } catch { /* starting fresh */ }
        let done = false;
        try {
          done = await this.pull(item, job, part, have);
        } catch (err) {
          if (job.stopped) return;
          if (err.fatal) throw err;
          item.lastError = friendly(err);
        }
        if (job.stopped) return;
        if (done) break;
        if (item.bytes > have) tries = 0;
        if (++tries > 6) throw new Error(item.lastError || 'The download kept dropping. Try again later.');
        await sleep(Math.min(15000, 1500 * tries));
        if (job.stopped) return;
      }
      await fs.promises.rename(part, item.file);
      item.status = 'done'; item.total = item.bytes; item.doneAt = Date.now(); delete item.lastError;
    } catch (err) {
      if (!job.stopped) { item.status = 'error'; item.error = friendly(err); }
    } finally {
      if (this.job === job) this.job = null;
      this.settle = null;
      release();
      this.changed();
      if (!job.stopped) this.pump();
    }
  }

  // One connection's worth of a download. Resolves true when the file is complete.
  async pull(item, job, part, have) {
    const headers = { 'User-Agent': this.env.userAgent };
    if (have) headers.Range = 'bytes=' + have + '-';
    const res = await open(item.url, headers, job.ctl);
    if (job.stopped) { res.destroy(); return false; }
    const code = res.statusCode;
    let flags = 'a';
    if (code === 200) {
      have = 0; flags = 'w';
      item.total = Number(res.headers['content-length']) || 0;
    } else if (code === 206) {
      const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
      item.total = m ? Number(m[1]) : have + (Number(res.headers['content-length']) || 0);
    } else if (code === 416 && have) {
      // The server can't resume from here. If we already hold the whole file, we're finished.
      res.resume();
      const m = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
      if (m && Number(m[1]) === have) { item.bytes = have; return true; }
      await fs.promises.unlink(part).catch(() => {});
      item.bytes = 0;
      return false;
    } else {
      res.resume();
      throw Object.assign(new Error(statusText(code)), { fatal: [401, 403, 404].includes(code) });
    }
    if (/^(text\/|application\/json)/i.test(res.headers['content-type'] || '')) {
      res.destroy();
      throw Object.assign(new Error('The server didn\'t send a video. Your playlist may have expired, or another device is using it.'), { fatal: true });
    }
    item.bytes = have;
    const out = fs.createWriteStream(part, { flags });
    await new Promise((resolve, reject) => {
      let over = false;
      const finish = (err) => { if (over) return; over = true; out.end(() => (err ? reject(err) : resolve())); };
      job.ctl.abort = () => { res.destroy(); finish(); };
      res.on('data', (chunk) => {
        item.bytes += chunk.length;
        if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); }
        this.tick();
      });
      res.on('end', () => finish());
      res.on('error', (e) => finish(e));
      res.on('close', () => finish(res.complete ? null : Object.assign(new Error('The connection dropped.'), { code: 'ECONNRESET' })));
      out.on('error', (e) => { over = true; res.destroy(); reject(Object.assign(e, { fatal: true })); });
    });
    job.ctl.abort = null;
    if (job.stopped) return false;
    return item.total ? item.bytes >= item.total : true;
  }

  // ---- recordings

  // spec: { channelId, plId, title, programme, poster, url, startAt, endAt } (times in ms; endAt 0 = until stopped)
  record(spec) {
    if (!spec || !/^https?:\/\//i.test(spec.url || '')) throw new Error('Invalid address');
    const now = Date.now();
    const startAt = Math.max(Number(spec.startAt) || 0, 0) || now;
    const endAt = Number(spec.endAt) || 0;
    if (endAt && endAt <= Math.max(now, startAt)) throw new Error('That finish time has already passed.');
    const d = new Date(startAt), two = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + '-' + two(d.getMinutes());
    const base = safeName([spec.title, spec.programme].filter(Boolean).join(' - '), 90) + ' ' + stamp;
    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      key: 'rec:' + now, kind: 'recording',
      title: String(spec.title || 'Recording'), sub: String(spec.programme || ''), group: '', poster: String(spec.poster || ''),
      channelId: String(spec.channelId ?? ''), plId: String(spec.plId ?? ''),
      url: spec.url, ext: 'ts', file: this.freePath(path.join(this.dir, 'Recordings'), base, 'ts'),
      status: 'scheduled', bytes: 0, total: 0, error: null, createdAt: now, startAt, endAt, seconds: 0,
    };
    this.items.unshift(item);
    this.changed();
    this.checkSchedule();
    return item.id;
  }

  checkSchedule() {
    const now = Date.now();
    let touched = false;
    for (const it of [...this.items].reverse()) {
      if (it.status !== 'scheduled') continue;
      if (it.endAt && now >= it.endAt) { it.status = 'error'; it.error = 'Missed: the app wasn\'t open, or another recording was running.'; touched = true; continue; }
      if (now >= it.startAt && !this.rec) this.startRecording(it);
    }
    if (touched) this.changed();
  }

  async stopRecording(id) {
    const it = this.get(id);
    if (!it) return;
    if (this.rec && this.rec.id === id) {
      const rec = this.rec;
      rec.stopped = true;
      if (rec.ctl.abort) rec.ctl.abort(); else if (rec.ctl.req) rec.ctl.req.destroy();
      await rec.done;
    } else if (it.status === 'scheduled') {
      this.items = this.items.filter((x) => x.id !== id);
      this.changed();
    }
  }

  async startRecording(item) {
    if (this.job) this.stopJob('queued');
    let release;
    const rec = { id: item.id, ctl: {}, stopped: false, segs: [], waiters: [], done: new Promise((r) => { release = r; }) };
    this.rec = rec;
    item.status = 'recording'; item.startedAt = Date.now(); item.error = null; item.bytes = 0;
    const stopAt = item.endAt || item.startedAt + MAX_OPEN_ENDED;
    this.changed();

    let out = null, lastErr = null, fails = 0, connections = 0, lastIdx = Date.now();
    let pos = 0; // bytes written so far == file size
    const cut = (seg, end, now) => {
      if (end <= seg.start) return;
      rec.segs.push([seg.start, end - seg.start, Math.max(0.1, (now - seg.t0) / 1000), seg.disc ? 1 : 0]);
      item.seconds = Math.round(rec.segs.reduce((a, s) => a + s[2], 0));
      const w = rec.waiters; rec.waiters = [];
      w.forEach((fn) => fn());
    };
    try {
      await fs.promises.mkdir(path.dirname(item.file), { recursive: true });
      out = fs.createWriteStream(item.file, { flags: 'w' });
      out.on('error', (e) => { lastErr = e; rec.stopped = true; if (rec.ctl.abort) rec.ctl.abort(); });
      while (!rec.stopped && Date.now() < stopAt) {
        let got = 0;
        try {
          const res = await open(item.url, { 'User-Agent': this.env.userAgent }, rec.ctl);
          if (res.statusCode !== 200) { res.resume(); throw new Error(statusText(res.statusCode)); }
          if (/^(text\/|application\/json)/i.test(res.headers['content-type'] || '')) { res.destroy(); throw new Error('The channel didn\'t send a video stream.'); }
          const connStart = pos;
          let base = -1, probe = Buffer.alloc(0), seg = null;
          await new Promise((resolve) => {
            const timer = setTimeout(() => res.destroy(), Math.max(0, stopAt - Date.now()));
            rec.ctl.abort = () => res.destroy();
            res.on('data', (chunk) => {
              const now = Date.now();
              got += chunk.length; pos += chunk.length; item.bytes = pos;
              if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); }
              if (base < 0) {
                // Find where the 188-byte packets line up, so every segment starts on a packet.
                probe = Buffer.concat([probe, chunk]);
                if (probe.length >= PACKET * 4) {
                  let off = 0;
                  for (let i = 0; i < PACKET; i++) if (probe[i] === 0x47 && probe[i + PACKET] === 0x47 && probe[i + 2 * PACKET] === 0x47) { off = i; break; }
                  base = connStart + off;
                  seg = { start: base, t0: now, disc: connections > 0 };
                  connections++;
                  probe = null;
                }
              } else if (now - seg.t0 >= (rec.segs.length < 3 ? 2000 : 4000)) {
                const end = base + Math.floor((pos - base) / PACKET) * PACKET;
                cut(seg, end, now);
                if (end > seg.start) seg = { start: end, t0: now, disc: false };
              }
              if (now - lastIdx > 30000) { lastIdx = now; this.writeIndex(item, rec, false); }
              this.tick();
            });
            res.on('error', () => {});
            res.on('close', () => {
              clearTimeout(timer);
              if (seg) cut(seg, base + Math.floor((pos - base) / PACKET) * PACKET, Date.now());
              resolve();
            });
          });
          rec.ctl.abort = null;
        } catch (err) { lastErr = err; }
        if (rec.stopped || Date.now() >= stopAt) break;
        fails = got > 0 ? 0 : fails + 1;
        if (fails > 8) break;
        await sleep(1500);
      }
    } catch (err) { lastErr = err; }
    if (out) await new Promise((r) => out.end(r));
    const early = !rec.stopped && Date.now() < stopAt - 5000;
    item.endedAt = Date.now();
    if (pos > 0) {
      item.status = 'done';
      item.note = early ? 'The channel dropped before the end.' : null;
      await this.writeIndex(item, rec, true);
    } else {
      item.status = 'error';
      item.error = lastErr ? friendly(lastErr) : 'Nothing was recorded.';
      await fs.promises.unlink(item.file).catch(() => {});
    }
    rec.finished = true;
    rec.waiters.forEach((fn) => fn());
    this.rec = null;
    release();
    this.changed();
    this.checkSchedule();
    this.pump();
  }

  writeIndex(item, rec, final) {
    return fs.promises.writeFile(item.file + '.idx', JSON.stringify({ final, segs: rec.segs })).catch(() => {});
  }

  // The recording as an HLS playlist of byte ranges into the one .ts file. While recording it's a
  // growing playlist, so the channel can be watched (and rewound) as it records.
  async playlist(id, waitFor = 0) {
    const item = this.get(id);
    if (!item || item.kind !== 'recording') return null;
    let segs, live = false;
    if (this.rec && this.rec.id === id) {
      const rec = this.rec;
      const until = Date.now() + 9000;
      while (rec.segs.length < waitFor && !rec.finished && Date.now() < until) {
        await Promise.race([new Promise((r) => rec.waiters.push(r)), sleep(Math.max(50, until - Date.now()))]);
      }
      segs = rec.segs; live = !rec.finished;
    } else {
      try { segs = JSON.parse(await fs.promises.readFile(item.file + '.idx', 'utf8')).segs; } catch { segs = null; }
      if (!segs || !segs.length) {
        const size = (await fs.promises.stat(item.file)).size;
        segs = [[0, size, Math.max(1, item.seconds || 1), 0]];
      }
    }
    const name = id + '.ts';
    const lines = ['#EXTM3U', '#EXT-X-VERSION:4',
      '#EXT-X-TARGETDURATION:' + Math.max(1, Math.ceil(Math.max(1, ...segs.map((s) => s[2])))),
      '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:' + (live ? 'EVENT' : 'VOD')];
    for (const [start, len, dur, disc] of segs) {
      if (disc) lines.push('#EXT-X-DISCONTINUITY');
      lines.push('#EXTINF:' + dur.toFixed(3) + ',', '#EXT-X-BYTERANGE:' + len + '@' + start, name);
    }
    if (!live) lines.push('#EXT-X-ENDLIST');
    return lines.join('\n') + '\n';
  }

  async shutdown() {
    clearInterval(this.timer);
    if (this.job) this.stopJob('queued');
    if (this.rec) await this.stopRecording(this.rec.id);
    clearTimeout(this.saveTimer);
    try { fs.writeFileSync(this.env.dataFile, JSON.stringify({ dir: this.dir, items: this.items })); } catch { /* best effort */ }
  }
}

module.exports = { Downloads, safeName };
