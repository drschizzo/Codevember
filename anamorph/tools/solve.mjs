// Banc : résout une paire de figures, imprime les couvertures, écrit les ombres
// exactes (rayons vers le disque solaire) en planche.
// node anamorph/tools/solve.mjs <sortie> debout:H couchee:H
import fs from 'node:fs';
import { createRng } from '../../shared/rng.js';
import { setupFigures, solvePlacement, voxelHull, fromFigure, SUN_RADIUS, sunAt } from '../src/gen/shadowart.js';
const [out, ...pairs] = process.argv.slice(2);
const figs = pairs.map((p) => { const [name, H] = p.split(':'); return { name, H: Number(H) * Math.PI / 180 }; });
const spec = { lat: 78, dec: 20, height: 0.8, camAz: 180, figs };
const F = setupFigures(spec);
const rng = createRng('banc');
const t0 = performance.now();
const best = solvePlacement(F, spec.height, rng.next);
console.log(`placement ${(performance.now() - t0).toFixed(0)} ms :`, best.cov.map((c) => (100 * c).toFixed(1) + ' %').join(' '));
const Hv = voxelHull(F, spec.height, 1.4, 220, 140);
const G = 300, W = G * 2 * F.length, img = Buffer.alloc(W * G * 3);
const DISK = []; for (let i = 0; i < 12; i++) { const r = SUN_RADIUS * Math.sqrt((i + 0.5) / 12), t = i * 2.39996; DISK.push([r * Math.cos(t), r * Math.sin(t)]); }
F.forEach((f, k) => {
  for (let j = 0; j < G; j++) for (let q = 0; q < G; q++) {
    const a = 1.05 - (j + 0.5) / G * 1.1, b = ((q + 0.5) / G - 0.5) * 1.1;
    const [gx, gz] = fromFigure(f, a, b);
    let hit = 0;
    for (const [dh, da] of DISK) {
      const h = f.sun.h + dh, az = f.sun.az + da / Math.cos(f.sun.h);
      const d = [Math.sin(az) * Math.cos(h), Math.sin(h), -Math.cos(az) * Math.cos(h)];
      for (let t = 0.003; t * d[1] < spec.height; t += 0.006) if (Hv.at(gx + t * d[0], t * d[1], gz + t * d[2])) { hit++; break; }
    }
    const s = hit / DISK.length, inT = f.mask.at(a, b);
    const put = (off, c) => { const p = (j * W + k * 2 * G + off + q) * 3; img[p] = c[0]; img[p + 1] = c[1]; img[p + 2] = c[2]; };
    put(0, inT ? [25, 25, 30] : [238, 238, 236]);
    put(G, [246, 247, 250].map((c, i) => Math.round(c + ([92, 112, 150][i] - c) * s)));
  }
});
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${W} ${G} 255\n`), img]));
