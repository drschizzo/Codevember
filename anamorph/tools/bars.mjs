// Banc : coque + barres soudées pour une paire de figures debout, chacune vue
// dans l'axe de sa propre ombre. Imprime le nombre de barres, la couverture,
// le temps ; écrit l'ombre exacte des barres (pénombre comprise) en planche.
// node anamorph/tools/bars.mjs <sortie.ppm> fig1 fig2
import fs from 'node:fs';
import { createRng } from '../../shared/rng.js';
import { setupFigures, solvePlacement, hullSDF, voxelHull, fromFigure, sunAt, SUN_RADIUS } from '../src/gen/shadowart.js';
import { coverWithPieces } from '../src/gen/pieces.js';
const [out, n1, n2] = process.argv.slice(2);
const H = [Math.PI - 0.8, Math.PI + 0.8];
const figs = [n1, n2].map((name, i) => ({ name, H: H[i], camAz: (sunAt(78, 20, H[i]).az * 180 / Math.PI + 540) % 360 }));
const spec = { lat: 78, dec: 20, height: 0.8, figs };
const F = setupFigures(spec);
const rng = createRng('bars');
let t = performance.now();
const best = solvePlacement(F, spec.height, rng.next);
console.log(`placement ${(performance.now() - t) | 0} ms`, best.cov.map((c) => (100 * c).toFixed(1)));
const sdf = hullSDF(F, spec.height);
const Hv = voxelHull(F, spec.height, 1.4, 112, 64);
let b = [9, 0, 9, -9, spec.height, -9];
for (let iy = 0; iy < Hv.NY; iy++) for (let iz = 0; iz < Hv.N; iz++) for (let ix = 0; ix < Hv.N; ix++) if (Hv.vox[(iy * Hv.N + iz) * Hv.N + ix]) {
  const x = -1.4 + (ix + 0.5) * 2.8 / Hv.N, z = -1.4 + (iz + 0.5) * 2.8 / Hv.N;
  b = [Math.min(b[0], x), 0, Math.min(b[2], z), Math.max(b[3], x), spec.height, Math.max(b[5], z)];
}
t = performance.now();
const { pieces: bars, coverage } = coverWithPieces(F, sdf, b, rng.next);
console.log(`barres ${(performance.now() - t) | 0} ms : ${bars.length} barres, couverture ${coverage.map((c) => (100 * c).toFixed(1)).join(' / ')} %`);
fs.writeFileSync(out.replace('.ppm', '.json'), JSON.stringify({ bars, F: F.map((f) => ({ name: f.name, a0: f.a0, b0: f.b0, scale: f.scale, u: f.u, v: f.v, h: f.sun.h, az: f.sun.az })) }));
// ombre exacte : rayons vers le disque solaire, test de distance aux capsules
const dseg = (p, a, c) => { const ab = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const tt = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(ap[0] - tt * ab[0], ap[1] - tt * ab[1], ap[2] - tt * ab[2]); };
// grille de barres par cellule (accélération)
const Gc = 0.1, cells = new Map(), key = (i, j, k) => `${i},${j},${k}`;
bars.forEach((B, n) => { const lo = [0, 1, 2].map((d) => Math.floor((Math.min(B.p0[d], B.p1[d]) - B.r) / Gc)), hi = [0, 1, 2].map((d) => Math.floor((Math.max(B.p0[d], B.p1[d]) + B.r) / Gc)); for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const kk = key(i, j, k); if (!cells.has(kk)) cells.set(kk, []); cells.get(kk).push(n); } });
const hit = (p) => { const l = cells.get(key(Math.floor(p[0] / Gc), Math.floor(p[1] / Gc), Math.floor(p[2] / Gc))); if (!l) return false; for (const n of l) if (dseg(p, bars[n].p0, bars[n].p1) < bars[n].r) return true; return false; };
const GP = 280, W = GP * 2 * F.length, img = Buffer.alloc(W * GP * 3);
const DISK = []; for (let i = 0; i < 10; i++) { const r = SUN_RADIUS * Math.sqrt((i + 0.5) / 10), a = i * 2.39996; DISK.push([r * Math.cos(a), r * Math.sin(a)]); }
F.forEach((f, k) => {
  for (let j = 0; j < GP; j++) for (let q = 0; q < GP; q++) {
    const a = 1.05 - (j + 0.5) / GP * 1.1, bb = ((q + 0.5) / GP - 0.5) * 1.1;
    const [gx, gz] = fromFigure(f, a, bb);
    let h = 0;
    for (const [dh, da] of DISK) {
      const el = f.sun.h + dh, az = f.sun.az + da / Math.cos(f.sun.h);
      const d = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
      for (let tt = 0.002; tt * d[1] < spec.height + 0.05; tt += 0.008) if (hit([gx + tt * d[0], tt * d[1], gz + tt * d[2]])) { h++; break; }
    }
    const s = h / DISK.length, inT = f.mask.at(a, bb);
    const put = (off, c) => { const p = (j * W + k * 2 * GP + off + q) * 3; img[p] = c[0]; img[p + 1] = c[1]; img[p + 2] = c[2]; };
    put(0, inT ? [25, 25, 30] : [238, 238, 236]);
    put(GP, [246, 247, 250].map((c, i) => Math.round(c + ([92, 112, 150][i] - c) * s)));
  }
});
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${GP} 255\n`), img]));
