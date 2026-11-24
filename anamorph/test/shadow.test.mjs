// Invariants du cœur : l'ombre de la coque couvre chaque figure, et ne
// déborde jamais de sa cible aux heures des figures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../shared/rng.js';
import { sunAt, setupFigures, solvePlacement, voxelHull, shadowOf, toFigure } from '../src/gen/shadowart.js';

const PAIRS = [['renard', 'lievre'], ['lievre', 'macareux'], ['macareux', 'renard']];

for (const [n1, n2] of PAIRS) {
  test(`${n1} + ${n2} : couverture ≥ 95 %, aucun débord`, () => {
    const figs = [[n1, Math.PI - 0.8], [n2, Math.PI + 0.8]].map(([name, H]) => ({ name, H, camAz: (sunAt(78, 20, H).az * 180 / Math.PI + 540) % 360 }));
    const spec = { lat: 78, dec: 20, height: 0.8, figs };
    const F = setupFigures(spec);
    const best = solvePlacement(F, spec.height, createRng('test').next);
    for (const c of best.cov) assert.ok(c >= 0.95, `couverture ${(100 * c).toFixed(1)} %`);
    // tout voxel plein projette dans les deux cibles (par construction)
    const H = voxelHull(F, spec.height, 1.4, 64, 40);
    let n = 0;
    for (let iy = 0; iy < H.NY; iy++) for (let iz = 0; iz < H.N; iz++) for (let ix = 0; ix < H.N; ix++) {
      if (!H.vox[(iy * H.N + iz) * H.N + ix]) continue;
      const x = -H.box + (ix + 0.5) * 2 * H.box / H.N, z = -H.box + (iz + 0.5) * 2 * H.box / H.N, y = (iy + 0.5) * H.height / H.NY;
      for (const f of F) { const [a, b] = toFigure(f, ...shadowOf(f, x, y, z)); assert.ok(f.mask.at(a, b)); }
      n++;
    }
    assert.ok(n > 100);
  });
}
