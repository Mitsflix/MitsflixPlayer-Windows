// Plays what the built-in player can't. Films and episodes with Dolby (AC3/E-AC3), DTS or TrueHD audio,
// or HEVC/other video, are converted on the fly by the bundled ffmpeg into a stream the player knows
// (H.264 + AAC in short HLS pieces). Each piece is made from the original address when it's asked for,
// so skipping, resuming and the seek bar work as usual, and nothing is written to disk.
//
// Everything runs on 127.0.0.1 behind a random secret; the renderer gets the address through IPC.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SEG = 10;                          // seconds per piece
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

function ffmpegPath() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const spots = [path.join(process.resourcesPath || '', 'ffmpeg', exe), path.join(__dirname, 'vendor', 'ffmpeg', exe)];
  return spots.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// What's inside a title: its length, video codec and audio tracks (read from ffmpeg's summary).
const probes = new Map();
function probe(ff, input) {
  if (probes.has(input)) return probes.get(input);
  const job = new Promise((resolve, reject) => {
    const args = ['-hide_banner', ...(/^https?:/i.test(input) ? ['-user_agent', UA] : []), '-i', input];
    const p = spawn(ff, args, { windowsHide: true });
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 25000);
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) p.kill('SIGKILL'); });
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const duration = dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0;
      const vline = (/Stream #\d+:\d+[^:]*: Video: [^\n]*/.exec(err) || [''])[0];
      const video = (/Video: (\w+)/.exec(vline) || [])[1] || '';
      const deep = /p1[02](le|be)?\b/.test(vline);   // 10/12-bit: the player can't show it even as H.264
      const audio = [...err.matchAll(/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\((\w+)\))?: Audio: (\w+)[^\n]*/g)]
        .map((m, i) => ({ i, lang: (m[1] || '').toLowerCase(), codec: m[2], def: /\(default\)/.test(m[0]) }));
      if (!duration) return reject(new Error('Couldn\'t read this title'));
      resolve({ duration, video, deep, audio });
    });
  });
  probes.set(input, job);
  job.catch(() => probes.delete(input));
  if (probes.size > 50) probes.delete(probes.keys().next().value);
  return job;
}

// English first, then the default track, then the first.
const pickAudio = (a) => (a.find((t) => /^(en|eng)$/.test(t.lang)) || a.find((t) => t.def) || a[0] || null);

function start({ resolveLocal } = {}) {
  const ff = ffmpegPath();
  if (!ff) return null;
  const secret = crypto.randomBytes(12).toString('hex');
  let base = null;
  const inputOf = (u) => {
    if (/^https?:\/\//i.test(u)) return u;
    if (/^mxfile:\/\//i.test(u) && resolveLocal) return resolveLocal(u);
    return null;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (url.searchParams.get('k') !== secret) return send(403, 'text/plain', 'no');
      const input = inputOf(url.searchParams.get('u') || '');
      if (!input) return send(400, 'text/plain', 'bad input');
      const info = await probe(ff, input);

      if (url.pathname === '/probe') return send(200, 'application/json', JSON.stringify(info));

      if (url.pathname === '/m.m3u8') {
        const n = Math.ceil(info.duration / SEG);
        const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-TARGETDURATION:' + SEG, '#EXT-X-MEDIA-SEQUENCE:0'];
        const q = 'k=' + secret + '&u=' + encodeURIComponent(url.searchParams.get('u'));
        for (let i = 0; i < n; i++) lines.push('#EXTINF:' + Math.min(SEG, info.duration - i * SEG).toFixed(3) + ',', '/seg.ts?i=' + i + '&' + q);
        lines.push('#EXT-X-ENDLIST');
        return send(200, 'application/vnd.apple.mpegurl', lines.join('\n') + '\n');
      }

      if (url.pathname === '/seg.ts') {
        const i = Math.max(0, parseInt(url.searchParams.get('i'), 10) || 0);
        const at = i * SEG;
        const a = pickAudio(info.audio);
        const copyVideo = info.video === 'h264' && !info.deep;
        const video = copyVideo ? ['-c:v', 'copy']
          : process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-vf', 'scale=min(1920\\,iw):-2,format=yuv420p']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-vf', 'scale=min(1920\\,iw):-2,format=yuv420p'];
        const args = ['-hide_banner', '-loglevel', 'error',
          ...(/^https?:/i.test(input) ? ['-user_agent', UA, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4'] : []),
          '-ss', String(at), '-i', input, '-to', String(at + SEG), '-copyts', '-muxdelay', '0', '-muxpreload', '0',
          '-map', '0:v:0', ...(a ? ['-map', '0:a:' + a.i] : []), ...video,
          ...(a ? (a.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']) : []),
          '-sn', '-dn', '-f', 'mpegts', 'pipe:1'];
        const p = spawn(ff, args, { windowsHide: true });
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        p.stdout.pipe(res);
        p.on('error', () => res.end());
        req.on('close', () => p.kill('SIGKILL'));
        return;
      }
      send(404, 'text/plain', 'not found');
    } catch (e) {
      if (!res.headersSent) send(502, 'text/plain', String(e.message || e));
      else res.end();
    }
  });
  const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + server.address().port; resolve(); }));

  return {
    // The stream address for a title, or null when no conversion is needed or possible.
    async url(original) {
      await ready;
      const input = inputOf(original);
      if (!input) return null;
      const info = await probe(ff, input);
      const a = pickAudio(info.audio);
      const needs = info.video !== 'h264' || info.deep || (a && !PLAYABLE_AUDIO.has(a.codec));
      return { url: base + '/m.m3u8?k=' + secret + '&u=' + encodeURIComponent(original), needs, video: info.video, audio: a ? a.codec : '' };
    },
  };
}

module.exports = { start };
