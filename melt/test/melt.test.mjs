// Invariants de Melt (le bain de bismuth) : node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, HABITS, OXIDES, CLUSTERS, FRAMINGS } from '../src/recipe.js';
import { level, emerge, reach, line, lift, meltU, SINK, buildCluster, crystalsAt, tideFor, topOf, cycleT, apparatusAt, GRID_WIRE } from '../src/cycle.js';
import { cameraAt, potFor } from '../src/camera.js';
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

test('bain fixe ; la grappe sort, attend, redescend par paliers ; tout est continu et périodique', () => {
  const C = tideFor(buildCluster('m0', CLUSTERS.grappe));
  assert.ok(Math.abs(line(0, C) - line(1 - 1e-9, C)) < 1e-6);
  let prev = line(0, C);
  for (let k = 1; k < 4000; k++) {
    const t = k / 4000, l = line(t, C);
    assert.equal(level(t, C), C.LB); // (le métal ne quitte jamais la marmite)
    assert.ok(Math.abs(l - prev) < 0.01, `saut de la ligne à t = ${t}`);
    if (t > C.T0 && t < C.T1) assert.ok(l <= prev + 1e-12, 'la grappe redescend pendant la levée');
    if (t > C.T2 && t < C.T3) assert.ok(l >= prev - 1e-12, 'la grappe remonte pendant la fonte');
    prev = l;
  }
  // (la fonte calée sur la simulation : quelle que soit sa durée, la ligne reste
  // continue, ne redescend pas, et la grille vide regagne le fond)
  for (const UM of [0.4, 0.7]) {
    const Cu = { ...C, UM };
    let p = line(0, Cu);
    for (let k = 1; k < 4000; k++) {
      const t = k / 4000, l = line(t, Cu);
      assert.ok(Math.abs(l - p) < 0.02, `UM = ${UM} : saut de la ligne à t = ${t}`); // (la grille vide regagne le fond vite, mais sans saut)
      if (t > Cu.T2) assert.ok(l >= p - 1e-12);
      p = l;
    }
    assert.ok(Math.abs(line(Cu.T3 + SINK + 1e-3, Cu) - Cu.LH) < 1e-9);
  }
  // suspendue : la grille au-dessus du bain ; au repos : tout sous le bain
  assert.ok(lift((C.T1 + C.T2) / 2, C) > C.LB + 0.2);
  // les arrêts : au milieu de chaque palier, le cadre ne bouge pas
  for (let k = 0; k < 4; k++) {
    const u = k / 4 + 0.07 + 0.09, t = C.T2 + u * (C.T3 - C.T2), e = 1e-3;
    assert.ok(Math.abs(line(t + e, C) - line(t - e, C)) < 1e-9, `le cadre bouge au palier ${k}`);
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
    for (const t of [0, 0.005, C.T0 - 1e-3, C.T3 + 0.005, 0.97, 0.999]) {
      const L = level(t, C);
      for (const c of crystalsAt(cl, t, C)) assert.ok(topWorld(c) < L - 0.02, `graine r${i}, t = ${t} : un cristal dépasse (${topWorld(c).toFixed(2)} ≥ ${L.toFixed(2)})`);
    }
  }
});

test('grappe : cristaux posés sur la grille, sans la traverser, sans interpénétration franche', () => {
  for (let i = 0; i < 100; i++) {
    const cl = buildCluster(`g${i}`, CLUSTERS.grappe);
    assert.ok(cl.length >= 5);
    // (posés SUR la grille : le point le plus bas de chaque cristal touche le dessus des fils, sans les traverser ni flotter)
    for (const c of cl) { const low = 2 * c.y - topOf(c); assert.ok(Math.abs(low - GRID_WIRE) < 1e-9, `pied à ${low}`); }
    for (let a = 0; a < cl.length; a++) for (let b = a + 1; b < cl.length; b++) {
      assert.ok(Math.hypot(cl[a].x - cl[b].x, cl[a].z - cl[b].z) >= (cl[a].s + cl[b].s) * 0.95 - 1e-9);
    }
  }
});

test('fonte : la grappe ne bouge pas pendant l’attente, regagne le fond à la fin ; la peau vient après', () => {
  const cl = buildCluster('f1', CLUSTERS.grappe), C = tideFor(cl);
  const at = (t) => crystalsAt(cl, t, C)[0];
  assert.equal(at(C.T1 + 0.01).desc, at(C.T2 - 0.01).desc);
  assert.ok(Math.abs(at(C.T3).desc - (C.LH - C.LB)) < 1e-9);
  const tSub = reach(topOf(cl[0]) + 0.05, C);
  assert.ok(at(tSub - 0.01).skin < 0 && at(tSub + 0.02).skin > 0);
});

test('modèle de fonte (Node, grille grossière) : les parties minces d’abord, puis le front suit la ligne', () => {
  const c = { s: 1, y: 0.8, ang: 0.5, tilt: 0.08 }, LL = -0.3, D = 2.2;
  const C = { ...tideFor([c]), LOW: LL, LH: LL + D };
  const { tau, grid } = simulate(c, 0, { LL, D, quality: 2.2 });
  const { h, X, nx, ny } = grid;
  const lead = [];
  for (let id = 0; id < tau.length; id++) {
    if (tau[id] < 0 || tau[id] > 50) continue;
    const j = Math.floor(id / nx) % ny, y = (j + 0.5) * h;
    if (y <= LL + h) continue;
    // instant où le bain (repère du cristal) atteint y, sans tassement
    const uLine = meltU(reach(y, C), C);
    lead.push(tau[id] - uLine);
  }
  lead.sort((a, b) => a - b);
  const q = (f) => lead[Math.floor(f * (lead.length - 1))];
  assert.ok(lead.length > 1000);
  // (par paliers : la ligne arrive d'un coup, la fonte la suit de près, sous elle)
  assert.ok(q(0.5) < 0.06 && q(0.5) > -0.12, `médiane de l’avance de la fonte sur la ligne : ${q(0.5)}`);
  // (avance modeste : le panache est tiède à la ligne, pour que les petits cristaux fondent en s'enfonçant)
  assert.ok(q(0.05) < q(0.5) - 0.02, `les parties minces ne fondent pas avant le reste (${q(0.05)} / ${q(0.5)})`);
  assert.ok(bathAt(1, LL, D) === LL + D && X > c.s);
});

test('caméra : périodique, lente, au-dessus du métal, dans le creuset ou dehors selon le cadrage', () => {
  for (let i = 0; i < 200; i++) {
    const R = generate(`k${i}`);
    const C = tideFor(buildCluster(R.seed, CLUSTERS[R.cluster])), pot = potFor(R);
    for (let k = 0; k < 100; k++) {
      const ph = k / 100, t = cycleT(ph), p = cameraAt(R, ph).pos, r = Math.hypot(p[0], p[2]);
      assert.ok(p[1] > level(t, C) + 0.15, `graine k${i} (${R.framing}) : caméra à ${p[1].toFixed(2)} sous le bain ${level(t, C).toFixed(2)}`);
      // (au-dessus du bain : la paroi proche reste sous l'objectif ; l'atelier : dehors, au-dessus du bord)
      if (R.framing === 'atelier') assert.ok(r > pot.Ri + pot.th + 1 && p[1] > pot.rim + 2, `graine k${i} : l'atelier est vu du dedans`);
      else assert.ok(r < pot.Ri - 0.5, `graine k${i} (${R.framing}) : caméra dans la paroi (${r.toFixed(2)} / ${pot.Ri.toFixed(2)})`);
    }
  }
  for (const s of ['c1', 'c2', 'c3', 's7']) {
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

test('appareillage : le brûleur s’allume pendant l’attente, avant la descente, et s’éteint après la fonte', () => {
  const C = tideFor(buildCluster('a0', CLUSTERS.grappe));
  const A = (t) => apparatusAt(t, C);
  assert.ok(A((C.T2 + C.T3) / 2).flame > 0.99 && A(C.T1).flame === 0 && A(0.98).flame === 0);
  assert.ok(A(C.T2 - 0.01).flame > 0.99); // (la cause avant l'effet)
  assert.equal(A(0.5).lift, lift(0.5, C));
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
