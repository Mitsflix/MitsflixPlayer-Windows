// Puts the ffmpeg the app bundles (for titles the built-in player can't decode; see tx.js) in
// vendor/ffmpeg before electron-builder packs it. Builds from the ffmpeg-static project (GPL; see
// vendor/ffmpeg/LICENSE). On a Mac it joins the Intel and Apple-silicon builds into one file.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const TAG = 'b6.0';
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${TAG}/`;
const out = path.join(__dirname, '..', 'vendor', 'ffmpeg');

async function get(name) {
  const r = await fetch(BASE + name, { redirect: 'follow' });
  if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dest = path.join(out, exe);
  const archs = process.platform === 'darwin' ? ['arm64', 'x64'] : [process.arch];
  const parts = [];
  for (const a of archs) {
    const file = path.join(out, `ffmpeg-${a}`);
    fs.writeFileSync(file, zlib.gunzipSync(await get(`ffmpeg-${process.platform}-${a}.gz`)));
    fs.chmodSync(file, 0o755);
    parts.push(file);
  }
  if (parts.length > 1) {
    execFileSync('lipo', ['-create', ...parts, '-output', dest]);
    parts.forEach((p) => fs.unlinkSync(p));
    execFileSync('codesign', ['-s', '-', '-f', dest]);   // Apple silicon only runs signed programs
  } else fs.renameSync(parts[0], dest);
  fs.chmodSync(dest, 0o755);
  try { fs.writeFileSync(path.join(out, 'LICENSE'), await get(`ffmpeg-${process.platform}-${archs[0]}.LICENSE`)); } catch { /* licence text is optional */ }
  console.log('ffmpeg ready:', dest, fs.statSync(dest).size, 'bytes');
  console.log(execFileSync(dest, ['-hide_banner', '-version']).toString().split('\n')[0]);
})().catch((e) => { console.error(e); process.exit(1); });
