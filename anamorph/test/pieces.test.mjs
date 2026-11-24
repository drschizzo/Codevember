// La ferraille : aucune pièce n'en traverse une autre ni le sol, toute pièce
// tient (au sol ou soudée à sa mère), et l'ombre reste lisible.
// L'objet est construit par la même fonction que le worker (buildObject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { segDist, jointZone } from '../src/gen/pieces.js';
import { axisAt, supportAt } from '../src/gen/forge.js';

globalThis.self ??= {}; // (le worker installe self.onmessage à l'import)
const { buildObject } = await import('../src/gen/worker.js');

for (const [seed, accord] of [['a1', 'rouille'], ['a1', 'bois'], ['t7', 'cuivre'], ['t7', 'peint'], ['a1', 'galva']]) {
  test(`${seed} · ${accord} : aucune interpénétration, rien ne flotte`, () => {
    const R = generate(seed);
    const o = buildObject({ seed: R.seed, family: 'fer', accord, lat: R.sun.lat, dec: R.sun.dec, height: R.object.height, figs: R.object.figs });
    const P = o.bars;
    assert.ok(P.length > 100);
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      // le sol : le point le plus bas de la vraie section (cintrage, écrasement compris)
      let low = Infinity;
      for (let k = 0; k <= 20; k++) low = Math.min(low, axisAt(a, k / 20)[1] - supportAt(a, [0, -1, 0], k / 20));
      assert.ok(low >= -1e-4, `${i} entre dans la neige (${low})`);
      // porté : au sol, ou soudé à une mère posée avant lui
      if (a.parent < 0) assert.ok(low < 0.002, `${i} flotte à ${low}`);
      else {
        assert.ok(a.parent < i);
        const m = P[a.parent];
        assert.ok(segDist(a.p0, a.p0, m.p0, m.p1) <= a.rc + m.rc + 1e-6, `${i} n'est pas soudée à sa mère`);
      }
      for (let j = 0; j < i; j++) {
        const b = P[j];
        if (a.parent === j) {
          // la soudure : seul le bout touche la mère
          const d = [a.p1[0] - a.p0[0], a.p1[1] - a.p0[1], a.p1[2] - a.p0[2]], L = Math.hypot(...d);
          const s = Math.min(1, jointZone(a.rc, b.rc) / L), a2 = [a.p0[0] + d[0] * s, a.p0[1] + d[1] * s, a.p0[2] + d[2] * s];
          assert.ok(segDist(a2, a.p1, b.p0, b.p1) >= a.rc + b.rc, `${i} traverse sa mère ${j}`);
        } else {
          assert.ok(segDist(a.p0, a.p1, b.p0, b.p1) >= a.rc + b.rc, `${i} traverse ${j}`);
        }
      }
    }
    for (const c of o.coverage) assert.ok(c > (accord === 'bois' ? 0.7 : 0.74), `ombre pleine ${(100 * c).toFixed(1)} %`);
  });
}
