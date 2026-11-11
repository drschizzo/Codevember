// Champ de corrosion d'une pièce, échantillonné aux sommets, écrit pour
// tools/raster.py (les couleurs remplacent les finitions) :
//   node tools/field.mjs <famille> <graine> <sortie.bin> [canal: tow|streak|pool|concav|front|radial]
import fs from 'node:fs';
import { buildPiece, pieceParams } from '../src/gen/pieces.js';
import { corrosionField } from '../src/gen/corrosion.js';
import { createRng } from '../src/rng.js';
const [family = 'noeud', seed = 'a1', out = '/tmp/f.bin', ch = 'tow'] = process.argv.slice(2);
const params = pieceParams(family, createRng(seed).fork('piece'));
const P = buildPiece({ family, params, seed });
let t0 = performance.now();
const C = corrosionField(P.body, { seed });
console.log('champ', (performance.now() - t0).toFixed(0), 'ms', JSON.stringify(C.stats));
const { data, dims, lo, vox } = C.field;
const [nx, ny, nz] = dims;
const at = (p, c) => {
  const f = [0, 1, 2].map((k) => (p[k] - lo[k]) / vox - 0.5);
  const i = f.map(Math.floor), t = f.map((v, k) => v - i[k]);
  let s = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const x = Math.min(nx - 1, Math.max(0, i[0] + dx)), y = Math.min(ny - 1, Math.max(0, i[1] + dy)), z = Math.min(nz - 1, Math.max(0, i[2] + dz));
    const w = (dx ? t[0] : 1 - t[0]) * (dy ? t[1] : 1 - t[1]) * (dz ? t[2] : 1 - t[2]);
    s += w * data[((z * ny + y) * nx + x) * 4 + c] / 255;
  }
  return s;
};
const ramp = (v) => [Math.min(1, 2 * v), Math.max(0, 1 - Math.abs(v - 0.5) * 2) * 0.9, Math.max(0, 1 - 2 * v)];
const b = P.body, nv = b.position.length / 3, surf = new Uint8Array(nv * 4);
for (let i = 0; i < nv; i++) {
  const p = [b.position[i * 3], b.position[i * 3 + 1], b.position[i * 3 + 2]];
  let v;
  if (ch === 'front') { const F = C.front; const x = Math.floor((p[0] - F.lo[0]) / F.cell), y = Math.floor((p[1] - F.lo[1]) / F.cell); v = p[2] >= F.data[y * F.w + x] - 0.012 && b.normal[i * 3 + 2] > 0.05 ? 1 : 0; }
  else if (ch === 'radial') { const R = C.radial; const a = Math.floor(((Math.atan2(p[2], p[0]) / (2 * Math.PI) + 1) % 1) * R.w) % R.w, y = Math.floor((p[1] - R.y0) / R.cell); v = Math.hypot(p[0], p[2]) >= R.data[y * R.w + a] - 0.015 ? 1 : 0; }
  else v = at(p, { onset: 0, concav: 1, streak: 2, tow: 3 }[ch]);
  const c = ramp(v);
  for (let k = 0; k < 3; k++) surf[i * 4 + k] = Math.round(c[k] * 255);
}
const head = { dt: 0, info: P.info, parts: [{ nv, ni: b.index.length }], color: true };
const h = Buffer.from(JSON.stringify(head)); const len = Buffer.alloc(4); len.writeUInt32LE(h.length);
fs.writeFileSync(out, Buffer.concat([len, h, Buffer.from(b.position.buffer), Buffer.from(b.normal.buffer), Buffer.from(surf.buffer), Buffer.from(new Uint32Array(b.index).buffer)]));
