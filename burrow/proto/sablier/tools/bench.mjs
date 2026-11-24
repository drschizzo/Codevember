// Banc du cœur : champ + simulation pour quelques graines par famille.
//   node burrow/tools/bench.mjs [dossier de sortie] [graines…]
// Imprime temps, volumes, poches d'air, débordements, et écrit une planche PNG
// par graine : de face et de profil, le vide coloré par l'ordre de remplissage
// (bleu → jaune), les poches d'air en rouge, le filet en blanc.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { burrowPrims, drawParams, FAMILIES } from '../gen/burrows.js';
import { field, simulate } from '../gen/fill.js';
import { createRng } from '../../../../shared/rng.js';

const out = process.argv[2] || '/tmp';
const seeds = process.argv.slice(3);
if (!seeds.length) seeds.push('a1', 'b2');

function png(w, hgt, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0, 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(hgt, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ramp = (t) => [Math.round(40 + 215 * Math.min(1, t * 1.2)), Math.round(60 + 180 * t), Math.round(220 * (1 - t) + 30)];

for (const seed of seeds) for (const fam of Object.keys(FAMILIES)) {
  const P = drawParams(fam, createRng(`${seed}:params`));
  const t0 = performance.now();
  const prims = burrowPrims(fam, P, seed);
  const F = field(prims);
  const t1 = performance.now();
  const S = simulate(F);
  const t2 = performance.now();
  const vox = F.h ** 3;
  console.log(`${seed} ${fam.padEnd(8)} prims ${String(prims.length).padStart(4)} | champ ${(t1 - t0).toFixed(0)} ms, sim ${(t2 - t1).toFixed(0)} ms | vide ${(S.nVoid * vox * 1000).toFixed(0)} cm³, rempli ${(S.total * vox * 1000).toFixed(0)} cm³ (air ${(100 * (1 - S.total / S.nVoid)).toFixed(1)} %) | débordements ${S.events.length} | prise ${(S.geoMax * 10).toFixed(1)} cm`);
  // planche : face (x, y) et profil (z, y), premier vide le long de la vue
  const [nx, ny, nz] = F.n, W = nx + nz + 6, H = ny;
  const img = Buffer.alloc(W * H * 3, 24);
  const put = (x, y, c) => { const o = ((H - 1 - y) * W + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
  const wet = new Set(S.wetA.keys());
  const colour = (id) => (wet.has(id) && S.wetA.get(id) < S.order[id] - 50 ? [255, 255, 255] : S.filled[id] ? ramp(S.order[id] / S.total) : [220, 40, 40]);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { const id = i + nx * (j + ny * k); if (S.isVoid[id]) { put(i, j, colour(id)); break; } }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const id = i + nx * (j + ny * k); if (S.isVoid[id]) { put(nx + 6 + k, j, colour(id)); break; } }
  }
  fs.writeFileSync(path.join(out, `nest-${seed}-${fam}.png`), png(W, H, img));
  // courbe : hauteur du niveau en fonction de la fraction versée (20 points)
  const lv = [];
  let maxJ = 0, c = 0;
  const ids = [];
  for (let i = 0; i < S.filled.length; i++) if (S.filled[i]) ids.push(i);
  ids.sort((a, b) => S.order[a] - S.order[b]);
  for (const id of ids) { maxJ = Math.max(maxJ, S.J(id)); c++; if (c % Math.ceil(ids.length / 20) === 0) lv.push(maxJ); }
  console.log('   niveau (j max) :', lv.join(' '));
}
