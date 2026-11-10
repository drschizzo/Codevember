// La simulation de la corde : topologie (Călugăreanu-White), raccord de la
// boucle, contacts avec le banc, alignement du balancier sur la glissière.
// (Les trois familles sont simulées une fois : ~20 s.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRod, twist, writhe } from '../src/gen/rod.js';
import { simulate } from '../src/gen/sim.js';
import { makePlan, makeWarp, rodSpec, CATALOGUE } from '../src/plan.js';
import { sampleSim } from '../src/track.js';
import { GEO } from '../src/gen/bench.js';
import { generate } from '../src/recipe.js';

const SIMS = {};
const simOf = (fam) => {
  if (!SIMS[fam]) { const R = generate('sim-test', { family: fam }); SIMS[fam] = { R, S: simulate(R) }; }
  return SIMS[fam];
};

test('Lk = Tw + Wr : la corde ne se traverse jamais (cordon, deux cycles)', () => {
  const R = generate('topo', { family: 'cordon' });
  const plan = makePlan(R), rod = createRod(rodSpec('cordon', R.sim)), hz = 3000;
  const end = plan.cycles[1].free0 + 2;
  let worst = 0;
  for (let i = 1; i <= end * hz; i++) {
    const d = plan.drive(i / hz);
    rod.step(1 / hz, d);
    if (i % (hz / 2) === 0) {
      const lk = (d.theta - rod.state.fly.phi) / (2 * Math.PI);
      worst = Math.max(worst, Math.abs(lk - twist(rod) - writhe(rod)));
    }
  }
  // (le cisaillement borné de la tige laisse un petit écart de mesure ; une
  // traversée ferait un saut de 2)
  assert.ok(worst < 0.6, `écart d'enlacement ${worst.toFixed(3)}`);
});

for (const fam of Object.keys(CATALOGUE)) {
  test(`${fam} : la boucle se referme (résidu, balancier revenu de N tours entiers, raccord)`, () => {
    const { R, S } = simOf(fam);
    assert.ok(S.residual < 0.004, `résidu ${(S.residual * 1000).toFixed(2)} mm`);
    assert.ok(S.residualTurns < 0.08, `balancier ${S.residualTurns.toFixed(3)} tour`);
    const a = sampleSim(S, 0), b = sampleSim(S, S.T - 1e-6);
    let d = 0;
    for (let k = 0; k < S.nv * 3; k++) d = Math.max(d, Math.abs(a.buf[k] - b.buf[k]));
    assert.ok(d < 1e-3, `raccord ${d}`);
    assert.ok(Math.abs(a.flyY - b.flyY) < 1e-4);
    void R;
  });

  test(`${fam} : la corde ne touche ni la glissière, ni les colonnes, ni le mandrin, ni le balancier`, () => {
    const { R, S } = simOf(fam);
    const plan = makePlan(R), warp = makeWarp(S.P, S.bumps), g = GEO;
    let st = null, worstRail = 1, worstCol = 1;
    for (let f = 0; f < S.nf; f++) {
      const t = f / S.fps, tau = warp.tauOf(t), bar = plan.bar(tau);
      st = sampleSim(S, t, st ?? undefined);
      const o = st.buf, a = g.rail.maxAngle * bar;
      for (const strand of S.strands) for (let i = 2; i <= strand.n - 2; i++) {
        const v = (strand.v0 + i) * 3, x = o[v], y = o[v + 1], z = o[v + 2];
        // glissière : segment de droite du pivot vers le bas, tourné de a autour de z
        const px = g.rail.x, py = g.rail.pivotY, dy = py - y;
        const rx = px + Math.sin(a) * dy; // (abscisse de la glissière à la hauteur y)
        const dRail = Math.hypot(x - rx, z - g.rail.z) - S.r - 0.0065;
        worstRail = Math.min(worstRail, dRail);
        worstCol = Math.min(worstCol, Math.hypot(Math.abs(x) - g.colX, z) - S.r - 0.02);
        assert.ok(y < -S.r, `${fam} : dans le mandrin (y = ${y})`);
        assert.ok(y > st.flyY + S.r - 0.0015, `${fam} : dans le moyeu du balancier (${((y - st.flyY) * 1000).toFixed(1)} mm)`);
      }
    }
    assert.ok(worstRail > 0, `${fam} : la corde touche la glissière (${(worstRail * 1000).toFixed(1)} mm)`);
    assert.ok(worstCol > 0, `${fam} : la corde touche une colonne`);
  });

  test(`${fam} : la barre se referme sur un balancier immobile, aligné sur elle`, () => {
    const { R, S } = simOf(fam);
    const plan = makePlan(R), warp = makeWarp(S.P, S.bumps);
    const off = (t) => { const st = sampleSim(S, t); return st.flyPhi - 2 * Math.PI * Math.round(st.flyPhi / (2 * Math.PI)); };
    for (const c of plan.cycles) {
      // la barre commence à revenir : l'ergot doit être dans l'entrée en V de la
      // fourche (± 4°) ; quand elle est fermée, il est en place (± 0,5°)
      let tLock = c.t0;
      while (!plan.drive(tLock).locked) tLock += 0.002;
      const a = off(warp.tOf(c.t0 + 1e-3)), b = off(warp.tOf(tLock));
      assert.ok(Math.abs(a) < 0.07, `${fam} : balancier décalé de ${(a * 57.3).toFixed(1)}° quand la barre revient`);
      assert.ok(Math.abs(b) < 0.009, `${fam} : balancier décalé de ${(b * 57.3).toFixed(2)}° quand la barre se ferme`);
    }
  });
}
