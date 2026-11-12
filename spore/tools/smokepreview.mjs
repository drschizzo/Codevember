// Aperçu du nuage dans Node : projections de profil (x, y) de la densité à
// quelques images, grains en points, et le dépôt vu de dessus.
import fs from 'node:fs';
import { buildSite } from '../src/gen/site.js';
import { generate } from '../src/recipe.js';
import { SMOKE } from '../src/gen/smoke.js';
const out = process.argv[2] || '.';
for (const sd of (process.argv[3] || 'f6:cedre:stemonitis').split(',')) {
  const [s, mood, fam] = sd.split(':');
  const R = generate(s, { ...(mood ? { mood } : {}), ...(fam ? { family: fam } : {}) });
  const t0 = performance.now();
  const S = buildSite({ R });
  const ms = performance.now() - t0;
  const Sm = S.smoke, D = Sm.domain, { nx, ny, nz } = D, N = nx * ny * nz, sc = 4;
  const fr = [8, 16, 24, 32, 44, 63];
  const W = nx * sc, H = ny * sc;
  const img = Buffer.alloc(W * (H * fr.length + nz * sc) * 3, 20);
  fr.forEach((f, r) => {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let k = 0; k < nz; k++) { const v = Sm.rec[(f * N + (k * ny + j) * nx + i) * 4] / 255; acc += v * v; }
      const c = Math.min(255, Math.round(255 * (1 - Math.exp(-acc * 0.6))));
      for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) { const o = (((r * H) + (ny - 1 - j) * sc + b) * W + i * sc + a) * 3; img[o] = c; img[o + 1] = Math.round(c * 0.85); img[o + 2] = Math.round(c * 0.6); }
    }
    for (let g = 0; g < Sm.grains.count; g += 3) {
      const x = Sm.grains.pos[(f * Sm.grains.n + g) * 3], y = Sm.grains.pos[(f * Sm.grains.n + g) * 3 + 1];
      if (!(x === x)) continue;
      const px = Math.round((x - D.x0) / D.h * sc), py = r * H + Math.round((D.y1 - y) / D.h * sc);
      if (px < 0 || px >= W || py < r * H || py >= (r + 1) * H) continue;
      const o = (py * W + px) * 3; img[o] = 120; img[o + 1] = 200; img[o + 2] = 255;
    }
  });
  const y0 = H * fr.length;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const d = Sm.dep[(SMOKE.frames - 1) * nx * nz + k * nx + i] / Sm.depMax;
    const c = Math.round(255 * Math.sqrt(d));
    for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) { const o = ((y0 + k * sc + b) * W + i * sc + a) * 3; img[o] = c; img[o + 1] = Math.round(c * 0.7); img[o + 2] = 40; }
  }
  fs.writeFileSync(`${out}/smoke-${sd.replace(/:/g, '_')}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H * fr.length + nz * sc} 255\n`), img]));
  const B = Sm.budget;
  console.log(sd, R.family, `${ms.toFixed(0)} ms`, `grille ${nx}×${ny}×${nz}`, 'pas', Sm.steps, 'émis', B.emitted.toExponential(3), 'déposé', (B.deposited / B.emitted).toFixed(3), 'sorti', (B.outflow / B.emitted).toFixed(3), 'en l\'air', (B.airborne / B.emitted).toFixed(3), 'grains', Sm.grains.count, 'désignés', Sm.grains.designated.length);
}
