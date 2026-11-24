// Aperçu de la coupe dans Node (sans GPU) : couleur des couches, grain,
// relief des galeries ombré par une lumière rasante de gauche.
//   node burrow/tools/slab-preview.mjs <dossier> [graines…]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildSlab } from '../src/gen/slab.js';

const out = process.argv[2] || '/tmp';
const seeds = process.argv.slice(3);
if (!seeds.length) seeds.push('a1');

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0, 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const PAL = ['#2e2b29', '#b9773f', '#e6dfcf', '#8f3b26', '#cfa75c', '#6f6b64', '#e9d9b0', '#a8552f'].map(hex);
const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

for (const seed of seeds) {
  const t0 = Date.now();
  const [sd, style, digger] = seed.split(':');
  const S = buildSlab(sd, { style, digger });
  const { nx, ny, C } = S;
  // profondeur des galeries : distance au sable intact (chanfrein), en cellules
  const D = new Float32Array(nx * ny).fill(0);
  const isHole = (id) => S.dug[id] >= 0 && S.mound[id] < 0;
  for (let id = 0; id < nx * ny; id++) D[id] = isHole(id) ? 1e9 : 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const id = i + nx * j; if (!D[id]) continue;
      if (pass === 0) { if (i > 0) D[id] = Math.min(D[id], D[id - 1] + 1); if (j > 0) D[id] = Math.min(D[id], D[id - nx] + 1); }
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const id = i + nx * j; if (!D[id]) continue;
      if (i < nx - 1) D[id] = Math.min(D[id], D[id + 1] + 1); if (j < ny - 1) D[id] = Math.min(D[id], D[id + nx] + 1);
    }
  }
  const Rc = 0.022 / C;
  const depth = (id) => (D[id] ? Math.sqrt(Math.min(1, D[id] / Rc)) * 6 : 0); // (en cellules : la voûte)
  const img = Buffer.alloc(nx * ny * 3);
  const L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + nx * j, k = S.layer[id];
    let col;
    if (k === 255) col = [0.42, 0.42, 0.41];
    else {
      const g = 0.82 + 0.36 * hash(i, j);
      const lamv = 1 + 0.07 * Math.sin(S.lam[id] * 37 + k);
      col = PAL[S.colorOrder[k] % PAL.length].map((c) => c * g * lamv);
      if (isHole(id)) {
        const dx = depth(Math.min(nx * ny - 1, id + 1)) - depth(Math.max(0, id - 1));
        const dy = depth(Math.min(nx * ny - 1, id + nx)) - depth(Math.max(0, id - nx));
        const n = [dx, dy, 2]; const l = Math.hypot(...n);
        const lam2 = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / l);
        const ao = 1 - 0.55 * Math.min(1, D[id] / Rc);
        col = col.map((c) => c * (0.35 + 0.65 * lam2) * ao);
      }
    }
    const o = ((ny - 1 - j) * nx + i) * 3;
    for (let c = 0; c < 3; c++) img[o + c] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(col[c], 1 / 2.2) * 0.95)));
  }
  fs.writeFileSync(path.join(out, `slab-${seed.replaceAll(':', '_')}.png`), png(nx, ny, img));
  let dugN = 0, moundN = 0;
  for (let id = 0; id < nx * ny; id++) { if (S.dug[id] >= 0) dugN++; if (S.mound[id] >= 0) moundN++; }
  console.log(seed, `${Date.now() - t0} ms`, 'couches', S.nL, 'creusé', dugN, 'tas', moundN / 1, 'entrées', S.entrances.map((x) => x.toFixed(2)).join(' '));
}
