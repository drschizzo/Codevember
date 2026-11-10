// Aperçu du cristal vu de dessus, à plusieurs instants (croissance, fonte) :
// node tools/preview.mjs <sortie> <famille> <forme> [graine]
import { buildCrystal, capBase, MAX_BLOBS } from '../src/gen/crystal.js';
import { FAMILIES } from '../src/families.js';
import fs from 'node:fs';
const [out, fam = 'star', form = 'dendrite', seed = '3'] = process.argv.slice(2);
const F = FAMILIES[fam], fo = F.forms[form];
const t0 = Date.now();
const C = buildCrystal({ family: fam, growth: fo.growth, then: fo.then, column: fo.column, R: 100, size: 3, thick: F.thick, seed: +seed, sun: [1, 0.3], thetaIce: 0.85 });
console.log('build ms', Date.now() - t0, 'cells', C.nCells, 'tau', C.tau.toFixed(4), 'tauMelt', C.tauMelt.toFixed(4), 'Vwater', C.Vwater.toFixed(5), 'radius', C.radius.toFixed(2));
const W = 260, ext = C.radius * 1.1;
const sst = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// grille des sommets (plus proche voisin)
const nV = C.position.length / 3;
const cell = C.cell, idx = new Map();
for (let k = 0; k < nV; k++) { const x = C.position[k * 3], y = C.position[k * 3 + 1]; idx.set(`${Math.round(y / (cell * Math.sqrt(3) / 2))},${Math.round(x / cell - Math.round(y / (cell * Math.sqrt(3) / 2)) / 2)}`, k); }
const h0 = C.thick;
const frame = (t, sm) => {
  const img = Buffer.alloc(W * W * 3);
  // eau : interpolation des emplacements
  const fr = Math.min(C.water.frames - 1, Math.max(0, sm * (C.water.frames - 1)));
  const f0 = Math.floor(fr), f1 = Math.min(C.water.frames - 1, f0 + 1), w = fr - f0;
  const D = C.water.data, blobs = [];
  if (sm > 0) for (let k = 0; k < MAX_BLOBS; k++) {
    const g = (f, j) => D[(f * MAX_BLOBS + k) * 4 + j];
    const v = g(f0, 2) * (1 - w) + g(f1, 2) * w;
    if (v > 0) blobs.push([g(f0, 0) * (1 - w) + g(f1, 0) * w, g(f0, 1) * (1 - w) + g(f1, 1) * w, capBase(v, 0.85)]);
  }
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = (px / W * 2 - 1) * ext, y = (py / W * 2 - 1) * ext;
    const r = Math.round(y / (cell * Math.sqrt(3) / 2)), q = Math.round(x / cell - r / 2);
    const k = idx.get(`${r},${q}`);
    let v = -1;
    if (k !== undefined) {
      const h = C.A[k * 4], T = C.A[k * 4 + 1], M = C.A[k * 4 + 2];
      const g = sst((t - T) / C.tau), m = sst((sm - M) / C.tauMelt);
      v = (h + 0.5 * h0) * g * (1 - m) - 0.5 * h0;
    }
    const o = (py * W + px) * 3;
    let R = 20, G = 24, B = 40;
    if (v > 0) { const l = 60 + 190 * Math.min(1, v / h0); R = l * 0.85; G = l * 0.92; B = l; }
    for (const [bx, by, ba] of blobs) { const d = Math.hypot(x - bx, y - by); if (d < ba) { const z = Math.sqrt(1 - (d / ba) ** 2); R = 40 + 120 * z; G = 90 + 140 * z; B = 200 + 55 * z; } }
    img[o] = R; img[o + 1] = G; img[o + 2] = B;
  }
  return img;
};
const shots = [[0.05, 0], [0.2, 0], [0.5, 0], [1.05, 0], [1.05, 0.2], [1.05, 0.4], [1.05, 0.6], [1.05, 0.8], [1.05, 0.95], [1.05, 1.05]];
const cols = 5, rows = 2, S = Buffer.alloc(cols * W * rows * W * 3);
shots.forEach(([t, sm], n) => { const im = frame(t, sm); const ox = (n % cols) * W, oy = Math.floor(n / cols) * W; for (let y = 0; y < W; y++) im.copy(S, ((oy + y) * cols * W + ox) * 3, y * W * 3, (y + 1) * W * 3); });
fs.writeFileSync(out + '.ppm', Buffer.concat([Buffer.from(`P6 ${cols * W} ${rows * W} 255\n`), S]));
