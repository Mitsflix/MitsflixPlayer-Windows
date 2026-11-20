// Chromecast / Google TV casting for Mitsflix Player (Windows, Mac and Linux).
// Finds devices on the local network (mDNS, _googlecast._tcp) and plays a stream on them with
// Google's Default Media Receiver, over the Cast protocol (TLS on port 8009, length-prefixed
// protobuf CastMessages with JSON payloads). No extra packages: the protocol is small.
'use strict';
const dgram = require('dgram');
const os = require('os');
const tls = require('tls');
const { EventEmitter } = require('events');

// ---- mDNS discovery -----------------------------------------------------------------------------
const SERVICE = '_googlecast._tcp.local';

function encodeName(name) {
  const parts = name.split('.').filter(Boolean).map((p) => { const b = Buffer.from(p); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...parts, Buffer.from([0])]);
}
function query() {
  const head = Buffer.alloc(12); head.writeUInt16BE(1, 4);                 // one question
  const tail = Buffer.alloc(4); tail.writeUInt16BE(12, 0); tail.writeUInt16BE(0x8001, 2); // PTR, IN, unicast reply wanted
  return Buffer.concat([head, encodeName(SERVICE), tail]);
}
function readName(buf, off) {
  const labels = []; let jumped = false, end = off, guard = 0;
  while (off < buf.length && guard++ < 64) {
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; jumped = true; off = ((len & 0x3f) << 8) | buf[off + 1]; continue; }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len)); off += len + 1;
  }
  return { name: labels.join('.'), next: jumped ? end : off };
}
function parsePacket(buf) {
  const recs = [];
  const qd = buf.readUInt16BE(4), count = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) off = readName(buf, off).next + 4;
  for (let i = 0; i < count && off < buf.length; i++) {
    const n = readName(buf, off); off = n.next;
    const type = buf.readUInt16BE(off), len = buf.readUInt16BE(off + 8); off += 10;
    const data = off; off += len;
    const r = { name: n.name, type };
    if (type === 12) r.ptr = readName(buf, data).name;
    else if (type === 33) { r.port = buf.readUInt16BE(data + 4); r.target = readName(buf, data + 6).name; }
    else if (type === 1 && len === 4) r.ip = [...buf.slice(data, data + 4)].join('.');
    else if (type === 16) { r.txt = {}; let p = data; while (p < data + len) { const l = buf[p]; const s = buf.toString('utf8', p + 1, p + 1 + l); const i2 = s.indexOf('='); if (i2 > 0) r.txt[s.slice(0, i2)] = s.slice(i2 + 1); p += l + 1; } }
    recs.push(r);
  }
  return recs;
}

// Looks for devices for `ms` milliseconds. Returns [{ id, name, host, port, model }].
function findDevices(ms = 3000) {
  return new Promise((resolve) => {
    const recs = [], sockets = [];
    const add = (msg) => { try { recs.push(...parsePacket(msg)); } catch { /* not a DNS packet */ } };
    const ifaces = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
    // Replies sent to the multicast group.
    try {
      const m = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      m.on('message', add); m.on('error', () => {});
      m.bind(5353, () => { for (const i of ifaces) { try { m.addMembership('224.0.0.251', i.address); } catch { /* interface can't */ } } });
      sockets.push(m);
    } catch { /* port busy: unicast replies still arrive */ }
    // The question, from each network the computer is on (replies come straight back).
    for (const i of ifaces) {
      try {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('message', add); s.on('error', () => {});
        s.bind(0, i.address, () => {
          try { s.setMulticastInterface(i.address); } catch { /* older OS */ }
          const q = query();
          s.send(q, 5353, '224.0.0.251'); setTimeout(() => { try { s.send(q, 5353, '224.0.0.251'); } catch { /* closed */ } }, 1000);
        });
        sockets.push(s);
      } catch { /* skip this interface */ }
    }
    setTimeout(() => {
      sockets.forEach((s) => { try { s.close(); } catch { /* already */ } });
      const byName = (type, name) => recs.find((r) => r.type === type && r.name === name);
      const devices = new Map();
      for (const p of recs.filter((r) => r.type === 12 && r.name === SERVICE)) {
        const srv = byName(33, p.ptr), txt = byName(16, p.ptr);
        const a = srv && byName(1, srv.target);
        if (!srv || !a) continue;
        const id = (txt && txt.txt && txt.txt.id) || p.ptr;
        devices.set(id, { id, name: (txt && txt.txt && txt.txt.fn) || p.ptr.split('._')[0], host: a.ip, port: srv.port, model: (txt && txt.txt && txt.txt.md) || '' });
      }
      resolve([...devices.values()].sort((x, y) => x.name.localeCompare(y.name)));
    }, ms);
  });
}

// ---- Cast protocol --------------------------------------------------------------------------------
function varint(n) { const out = []; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); return Buffer.from(out); }
function encodeMessage({ source, destination, namespace, data }) {
  const str = (field, s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([(field << 3) | 2]), varint(b.length), b]); };
  return Buffer.concat([Buffer.from([0x08, 0x00]), str(2, source), str(3, destination), str(4, namespace), Buffer.from([0x28, 0x00]), str(6, JSON.stringify(data))]);
}
function decodeMessage(buf) {
  const m = {}; let off = 0;
  const readVarint = () => { let n = 0, shift = 0, b; do { b = buf[off++]; n += (b & 127) * 2 ** shift; shift += 7; } while (b & 128); return n; };
  while (off < buf.length) {
    const key = readVarint(), field = key >> 3, wire = key & 7;
    if (wire === 0) { readVarint(); continue; }
    if (wire !== 2) break;
    const len = readVarint(); const s = buf.toString('utf8', off, off + len); off += len;
    if (field === 2) m.source = s; else if (field === 3) m.destination = s; else if (field === 4) m.namespace = s; else if (field === 6) m.payload = s;
  }
  return m;
}

const NS = {
  conn: 'urn:x-cast:com.google.cast.tp.connection',
  beat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  recv: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media',
};
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

// One casting session on one device. Emits 'status' ({ state, time, duration, idleReason }) and 'closed'.
class CastSession extends EventEmitter {
  constructor(device) { super(); this.device = device; this.sender = 'sender-mx' + Math.floor(Math.random() * 1e6); this.reqId = 1; this.waits = new Map(); this.buf = Buffer.alloc(0); }

  connect() {
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host: this.device.host, port: this.device.port || 8009, rejectUnauthorized: false, timeout: 8000 }, () => {
        this.send('receiver-0', NS.conn, { type: 'CONNECT' });
        this.beat = setInterval(() => this.send('receiver-0', NS.beat, { type: 'PING' }), 5000);
        resolve();
      });
      this.sock = sock;
      sock.on('data', (d) => this.onData(d));
      sock.on('timeout', () => { sock.destroy(new Error('timeout')); });
      sock.on('error', (e) => { reject(e); this.end(); });
      sock.on('close', () => this.end());
    });
  }
  send(dest, namespace, data) {
    const body = encodeMessage({ source: this.sender, destination: dest, namespace, data });
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    if (this.sock && !this.sock.destroyed) this.sock.write(Buffer.concat([len, body]));
  }
  request(dest, namespace, data, ms = 15000) {
    const requestId = this.reqId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waits.delete(requestId); reject(new Error('The TV didn\'t answer.')); }, ms);
      this.waits.set(requestId, (msg) => { clearTimeout(t); resolve(msg); });
      this.send(dest, namespace, { ...data, requestId });
    });
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + len) break;
      const m = decodeMessage(this.buf.slice(4, 4 + len)); this.buf = this.buf.slice(4 + len);
      let p; try { p = JSON.parse(m.payload || '{}'); } catch { continue; }
      if (m.namespace === NS.beat && p.type === 'PING') { this.send(m.source, NS.beat, { type: 'PONG' }); continue; }
      if (m.namespace === NS.conn && p.type === 'CLOSE') { this.end(); continue; }
      if (p.requestId && this.waits.has(p.requestId)) { const w = this.waits.get(p.requestId); this.waits.delete(p.requestId); w(p); }
      if (m.namespace === NS.media && p.type === 'MEDIA_STATUS' && p.status && p.status[0]) {
        const s = p.status[0];
        if (s.mediaSessionId) this.mediaSessionId = s.mediaSessionId;
        if (s.media && s.media.duration) this.duration = s.media.duration;
        this.emit('status', { state: s.playerState, time: s.currentTime || 0, duration: this.duration || 0, idleReason: s.idleReason || '' });
      }
      if (m.namespace === NS.recv && p.type === 'RECEIVER_STATUS' && this.transport) {
        const apps = (p.status && p.status.applications) || [];
        if (!apps.some((a) => a.transportId === this.transport)) this.end();   // someone else took over the TV
      }
    }
  }

  // Opens the media player on the TV and plays `media`.
  async load({ url, contentType, title, image, live, startAt }) {
    const st = await this.request('receiver-0', NS.recv, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER });
    const app = st.status && (st.status.applications || []).find((a) => a.appId === DEFAULT_MEDIA_RECEIVER);
    if (!app) throw new Error('The TV wouldn\'t open its player.');
    this.transport = app.transportId;
    this.send(this.transport, NS.conn, { type: 'CONNECT' });
    const r = await this.request(this.transport, NS.media, {
      type: 'LOAD', autoplay: true, currentTime: live ? 0 : Math.max(0, startAt || 0),
      media: { contentId: url, contentType, streamType: live ? 'LIVE' : 'BUFFERED',
        metadata: { metadataType: 0, title: title || 'Mitsflix', ...(image ? { images: [{ url: image }] } : {}) } },
    }, 30000);
    if (r.type === 'LOAD_FAILED' || r.type === 'LOAD_CANCELLED' || r.type === 'INVALID_REQUEST') throw new Error('unplayable');
    if (r.status && r.status[0]) this.mediaSessionId = r.status[0].mediaSessionId;
  }
  control(cmd, value) {
    if (!this.transport || !this.mediaSessionId) return;
    const base = { mediaSessionId: this.mediaSessionId };
    if (cmd === 'play') this.request(this.transport, NS.media, { ...base, type: 'PLAY' }).catch(() => {});
    else if (cmd === 'pause') this.request(this.transport, NS.media, { ...base, type: 'PAUSE' }).catch(() => {});
    else if (cmd === 'seek') this.request(this.transport, NS.media, { ...base, type: 'SEEK', currentTime: Math.max(0, Number(value) || 0) }).catch(() => {});
    else if (cmd === 'volume') this.request('receiver-0', NS.recv, { type: 'SET_VOLUME', volume: { level: Math.min(1, Math.max(0, Number(value) || 0)) } }).catch(() => {});
  }
  async stop() {
    try { if (this.transport) await this.request('receiver-0', NS.recv, { type: 'STOP', sessionId: this.transport }, 4000); } catch { /* closing anyway */ }
    this.end();
  }
  end() {
    if (this.ended) return; this.ended = true;
    clearInterval(this.beat);
    try { this.sock && this.sock.destroy(); } catch { /* gone */ }
    this.emit('closed');
  }
}

// What the TV is told the stream is.
function contentTypeFor(url) {
  const u = String(url).split('?')[0].toLowerCase();
  if (u.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (u.endsWith('.mp4') || u.endsWith('.m4v')) return 'video/mp4';
  if (u.endsWith('.mkv')) return 'video/x-matroska';
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.ts')) return 'video/mp2t';
  return 'video/mp4';
}

module.exports = { findDevices, CastSession, contentTypeFor, _test: { parsePacket, query, encodeMessage, decodeMessage, encodeName } };
