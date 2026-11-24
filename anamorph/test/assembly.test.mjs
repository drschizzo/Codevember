// Le scénario des pièces : éparpillées au sol au raccord de la boucle, posées
// dans un ordre qui respecte les mères, tas complet pendant les deux figures,
// démontage = assemblage à l'envers, places au sol sans contact et posées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { flightAt, poseAt, unpackPlan, qrot } from '../src/gen/assembly.js';
import { assemblyTiming, timeline } from '../src/gen/clock.js';
import { segDist } from '../src/gen/pieces.js';

globalThis.self ??= {};
const { buildObject } = await import('../src/gen/worker.js');

for (const seed of ['k8', 't7']) {
  const R = generate(seed);
  const o = buildObject({ seed, family: 'fer', accord: R.object.accord, lat: R.sun.lat, dec: R.sun.dec, height: R.object.height, figs: R.object.figs });
  const P = o.bars, plan = unpackPlan(o.assembly.data, o.assembly.n), N = P.length, tm = assemblyTiming(R), T = timeline(R);
  const s = (u, i) => flightAt(u, plan[i].k, N, tm);

  test(`${seed} : au raccord, tout est au sol ; pendant les figures, tout est posé`, () => {
    for (let i = 0; i < N; i++) {
      assert.equal(s(0, i), 0); assert.equal(s(1 - 1e-9, i), 0);
      for (const u of [T.u1 - 0.05, T.u1, T.u2, T.u2 + 0.05]) assert.equal(s(u, i), 1, `pièce ${i} pas posée à u = ${u}`);
    }
  });

  test(`${seed} : une mère est posée avant sa fille, et repart après elle`, () => {
    for (let i = 0; i < N; i++) {
      const m = P[i].parent;
      if (m < 0) continue;
      assert.ok(plan[m].k < plan[i].k, `mère ${m} après sa fille ${i}`);
      // à tout instant de l'assemblage, une fille qui touche sa place a sa mère posée
      for (let u = 0; u < 0.5; u += 0.002) if (s(u, i) >= 0.99) assert.equal(s(u, m), 1);
    }
  });

  test(`${seed} : le démontage est l'assemblage à l'envers`, () => {
    for (let i = 0; i < N; i += 7) for (let u = 0.01; u < tm.m; u += 0.013) assert.ok(Math.abs(s(u, i) - s(2 * tm.m - u, i)) < 1e-9);
  });

  test(`${seed} : au sol, les pièces ne se touchent pas et reposent sur la neige`, () => {
    const seg = plan.map((pl, i) => {
      const L = Math.hypot(P[i].p1[0] - P[i].p0[0], P[i].p1[1] - P[i].p0[1], P[i].p1[2] - P[i].p0[2]);
      const X = qrot(pl.g.q, [(P[i].p1[0] - P[i].p0[0]) / L, (P[i].p1[1] - P[i].p0[1]) / L, (P[i].p1[2] - P[i].p0[2]) / L]);
      return [pl.g.c.map((c, d) => c - X[d] * L / 2), pl.g.c.map((c, d) => c + X[d] * L / 2)];
    });
    for (let i = 0; i < N; i++) {
      assert.ok(Math.abs(seg[i][0][1] - seg[i][1][1]) < 1e-3, `pièce ${i} pas à plat`);
      for (let j = 0; j < i; j++) assert.ok(segDist(...seg[i], ...seg[j]) >= P[i].rc + P[j].rc, `pièces ${i} et ${j} se touchent au sol`);
    }
    // une pose à s = 0 est bien la place au sol, à s = 1 la place dans le tas
    for (let i = 0; i < N; i += 11) { assert.deepEqual(poseAt(plan[i], 0).c, plan[i].g.c); assert.deepEqual(poseAt(plan[i], 1).q, [0, 0, 0, 1]); }
  });

  test(`${seed} : la plupart des pièces ont un couloir d'approche libre`, () => {
    assert.ok(o.assembly.free / N > 0.8, `${o.assembly.free} / ${N}`);
  });
}
