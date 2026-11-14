// Invariants de Melt (le bain de bismuth) : node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, HABITS, OXIDES, CLUSTERS, FRAMINGS } from '../src/recipe.js';
import { level, emerge, reach, descent, buildCluster, crystalsAt, tideFor, topOf } from '../src/cycle.js';
import { cameraAt } from '../src/camera.js';
import { simulate, gridsFor, stepsFor, bathAt, PHYS } from '../src/melt/model.js';

test('recette déterministe, JSON, tous les choix tirés', () => {
  assert.deepEqual(generate('x1'), generate('x1'));
  const R = generate('x1');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  const seen = { mood: new Set(), habit: new Set(), oxide: new Set(), cluster: new Set(), framing: new Set() };
  for (let i = 0; i < 400; i++) { const r = generate(`s${i}`); for (const k of Object.keys(seen)) seen[k].add(r[k]); }
  assert.equal(seen.mood.size, Object.keys(MOODS).length);
  assert.equal(seen.habit.size, Object.keys(HABITS).length);
  assert.equal(seen.oxide.size, Object.keys(OXIDES).length);
  assert.equal(seen.cluster.size, Object.keys(CLUSTERS).length);
  assert.equal(seen.framing.size, Object.keys(FRAMINGS).length);
});

test('bain et descente : continus, périodiques, monotones par temps ; le bain ne bouge pas pendant la fonte', () => {
  const C = tideFor(buildCluster('m0', CLUSTERS.grappe));
  assert.ok(Math.abs(level(0, C) - level(1 - 1e-9, C)) < 1e-6);
  let prevL = level(0, C), prevD = descent(0, C);
  for (let k = 1; k < 4000; k++) {
    const t = k / 4000, L = level(t, C), D = descent(t, C);
    assert.ok(Math.abs(L - prevL) < 0.01, `saut de niveau à t = ${t}`);
    assert.ok(Math.abs(D - prevD) < 0.01, `saut de descente à t = ${t}`);
    if (t > C.T0 && t < C.T1) assert.ok(L <= prevL + 1e-12);
    if (t >= C.T1 && t < C.T4) assert.equal(L, C.LL); // (la fonte : c'est la grappe qui descend, pas le bain qui monte)
    if (t > C.T4) assert.ok(L >= prevL - 1e-12);
    assert.ok(D >= prevD - 1e-12, 'la grappe remonte pendant la boucle');
    prevL = L; prevD = D;
  }
  // le métal sort du bain dans l'ordre de la hauteur ; la ligne atteint le cristal de bas en haut
  for (let y = 0; y < 3; y += 0.1) { assert.ok(emerge(y + 0.1, C) <= emerge(y, C)); assert.ok(reach(y + 0.1, C) >= reach(y, C)); }
});

// plus haut point d'un cristal dans le monde (cube tourné, incliné), à sa descente près
const topWorld = (c) => topOf(c) - c.desc;

test('raccord : au début et à la fin de la boucle, le bain couvre tout', () => {
  for (let i = 0; i < 200; i++) {
    const R = generate(`r${i}`);
    const cl = buildCluster(R.seed, CLUSTERS[R.cluster]), C = tideFor(cl);
    for (const t of [0, 0.02, C.T0 - 1e-3, C.T3 + 0.02, C.T4 + 0.01, 0.95, 0.999]) {
      const L = level(t, C);
      for (const c of crystalsAt(cl, t, C)) assert.ok(topWorld(c) < L - 0.02, `graine r${i}, t = ${t} : un cristal dépasse (${topWorld(c).toFixed(2)} ≥ ${L.toFixed(2)})`);
    }
  }
});

test('grappe : cristaux posés, sans interpénétration franche', () => {
  for (let i = 0; i < 100; i++) {
    const cl = buildCluster(`g${i}`, CLUSTERS.grappe);
    assert.ok(cl.length >= 5);
    for (const c of cl) assert.ok(c.y - c.s < 0.05, 'un cristal flotte au-dessus de la croûte');
    for (let a = 0; a < cl.length; a++) for (let b = a + 1; b < cl.length; b++) {
      assert.ok(Math.hypot(cl[a].x - cl[b].x, cl[a].z - cl[b].z) >= (cl[a].s + cl[b].s) * 0.95 - 1e-9);
    }
  }
});

test('fonte : la grappe descend pendant la fonte seulement ; la peau vient après', () => {
  const cl = buildCluster('f1', CLUSTERS.grappe), C = tideFor(cl);
  const at = (t) => crystalsAt(cl, t, C)[0];
  assert.equal(at(0.45).desc, 0); // rien ne bouge avant la fonte
  assert.ok(at((C.T2 + C.T3) / 2).desc > 0);
  assert.ok(Math.abs(at(C.T3).desc - (C.LH - C.LL)) < 1e-9); // à la fin, la grappe est descendue de toute la marée
  // la peau n'apparaît qu'une fois le haut englouti
  const tSub = reach(topOf(cl[0]) + 0.05, C);
  assert.ok(at(tSub - 0.01).skin < 0 && at(tSub + 0.02).skin > 0);
});

test('modèle de fonte (Node, grille grossière) : les parties minces d’abord, puis le front suit la ligne', () => {
  const c = { s: 1, y: 0.8, ang: 0.5, tilt: 0.08 }, LL = 0.22, D = 1.85;
  const { tau, grid } = simulate(c, 0, { LL, D, quality: 2.2 });
  const { h, X, nx, ny } = grid;
  const lead = [];
  for (let id = 0; id < tau.length; id++) {
    if (tau[id] < 0 || tau[id] > 50) continue;
    const j = Math.floor(id / nx) % ny, y = (j + 0.5) * h;
    if (y <= LL + h) continue;
    // instant où le bain (repère du cristal) atteint y, sans tassement
    const uLine = Math.pow(Math.min(Math.max((y - LL) / D, 0), 1), 1 / PHYS.rise);
    lead.push(tau[id] - uLine);
  }
  lead.sort((a, b) => a - b);
  const q = (f) => lead[Math.floor(f * (lead.length - 1))];
  assert.ok(lead.length > 1000);
  assert.ok(q(0.5) < 0 && q(0.5) > -0.12, `médiane de l’avance de la fonte sur la ligne : ${q(0.5)}`);
  // (avance modeste : le panache est tiède à la ligne, pour que les petits cristaux fondent en s'enfonçant)
  assert.ok(q(0.05) < q(0.5) - 0.02, `les parties minces ne fondent pas avant le reste (${q(0.05)} / ${q(0.5)})`);
  assert.ok(bathAt(1, LL, D) === LL + D && X > c.s);
});

test('caméra : périodique, lente, toujours au-dessus du métal', () => {
  for (let i = 0; i < 200; i++) {
    const R = generate(`k${i}`);
    const LH = tideFor(buildCluster(R.seed, CLUSTERS[R.cluster])).LH;
    for (let k = 0; k < 100; k++) {
      const y = cameraAt(R, k / 100).pos[1];
      assert.ok(y > LH + 0.15, `graine k${i} (${R.framing}) : caméra à ${y.toFixed(2)} sous la marée haute ${LH.toFixed(2)}`);
    }
  }
  for (const s of ['c1', 'c2', 'c3']) {
    const R = generate(s);
    const a = cameraAt(R, 0).pos, b = cameraAt(R, 1).pos;
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9);
    let vmax = 0;
    for (let k = 0; k < 2000; k++) {
      const p = cameraAt(R, k / 2000).pos, q = cameraAt(R, (k + 1) / 2000).pos;
      vmax = Math.max(vmax, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 2000 / R.loop.duration);
    }
    assert.ok(vmax < 1.5, `caméra trop rapide : ${vmax} cm/s`);
  }
});

test('grilles de fonte : elles contiennent le cristal et tiennent dans le budget', () => {
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    const R = generate(`a${i}`), habit = HABITS[R.habit].id;
    const cl = buildCluster(R.seed, CLUSTERS[R.cluster]);
    const grids = gridsFor(cl, habit);
    let work = 0;
    grids.forEach((g, k) => {
      assert.ok(g.Y > topOf(cl[k]) && g.nx < 400 && g.ny < 300, `grille ${g.nx}×${g.ny}`);
      work += g.nx * g.ny * g.nz * stepsFor(g.h).steps;
    });
    worst = Math.max(worst, work);
  }
  assert.ok(worst <= 2.5e10, `travail ${worst.toExponential(2)}`);
});
