// La reine et le chantier qu'elle bâtit : le pétiole et les alvéoles ne
// traversent jamais son corps (tête, thorax, gastre), à aucun instant de la
// fondation. Les sommets du papier sont ceux du rendu (gen/comb.js), visibles
// dès leur naissance (attribut grow) ; la reine est posée par la même fonction
// que le rendu (flight.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClock, plan } from '../src/season.js';
import { waspsAt } from '../src/flight.js';
import { buildFoundation } from '../src/gen/comb.js';
import { generate } from '../src/recipe.js';

// le corps en trois ellipsoïdes (repère de la guêpe, gen/wasp.js)
const BODY = [
  { c: [0.0265, 0.006, 0], r: [0.021, 0.018, 0.0163] }, // mésosome
  { c: [0.0565, 0.002, 0], r: [0.0112, 0.0185, 0.0215] }, // tête (yeux compris)
  { c: [-0.041, -0.004, 0], r: [0.0378, 0.0196, 0.0218] }, // gastre
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

for (const seed of ['n29', 'a1', 'h8']) {
  test(`${seed} : le pétiole et le rayon ne traversent pas la reine`, () => {
    const R = generate(seed), C = makeClock(R.loop.duration), P = plan(C);
    const F = buildFoundation({ seed: R.seed, yBeam: R.decor.yBeam, s0: P.queen, s1: P.comb, n: 19 });
    const nV = F.position.length / 3;
    let worst = Infinity, at = null, checked = 0;
    for (let k = 0; k <= 400; k++) {
      const u = 0.04 + (0.16 - 0.04) * (k / 400);
      const Q = waspsAt(u, C, P, R.nest.spec, 0)[0];
      if (!Q || Q.pose[1] > 0.05) continue; // (en vol, loin du chantier)
      const s = C.s(u), qi = qconj(Q.q);
      for (let i = 0; i < nV; i++) {
        // (visible comme dans le shader : la paroi ou le pétiole jusqu'à la part
        // g de sa hauteur, le fond dès sa naissance)
        const g = Math.min(1, Math.max(0, (s - F.grow[i * 2]) / F.grow[i * 2 + 1])), role = F.cell[i * 4 + 3];
        if (role > 3.5 ? F.grow[i * 2] > s : F.cell[i * 4] > g * 1.0001 || s < F.grow[i * 2]) continue;
        const w = [F.position[i * 3] - Q.p[0], F.position[i * 3 + 1] - Q.p[1], F.position[i * 3 + 2] - Q.p[2]];
        const l = qrot(qi, w).map((x) => x / Q.s);
        for (const E of BODY) {
          const d = Math.hypot((l[0] - E.c[0]) / E.r[0], (l[1] - E.c[1]) / E.r[1], (l[2] - E.c[2]) / E.r[2]);
          if (d < worst) { worst = d; at = u; }
        }
        checked++;
      }
    }
    assert.ok(checked > 1000, 'le chantier est bien confronté à la reine');
    assert.ok(worst > 1, `un sommet du papier dans la reine (${worst.toFixed(3)} du rayon, u = ${at?.toFixed(4)})`);
  });
}
