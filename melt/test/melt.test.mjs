// Invariants de Melt (le bain de bismuth) : node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, HABITS, OXIDES, CLUSTERS, FRAMINGS } from '../src/recipe.js';
import { CYCLE, level, emerge, reach, rising, buildCluster, crystalsAt, tideFor } from '../src/cycle.js';
import { cameraAt } from '../src/camera.js';

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

test('marée : continue, périodique, monotone par temps', () => {
  assert.equal(level(0), level(1 - 1e-12));
  let prev = level(0);
  for (let k = 1; k <= 4000; k++) {
    const t = k / 4000, L = level(t);
    assert.ok(Math.abs(L - prev) < 0.01, `saut de niveau à t = ${t}`);
    if (t > CYCLE.T0 && t < CYCLE.T1) assert.ok(L <= prev + 1e-12);
    if (t > CYCLE.T2 && t < CYCLE.T3) assert.ok(L >= prev - 1e-12);
    prev = L;
  }
  // le métal sort du bain dans l'ordre de la hauteur, la ligne remonte dans l'ordre aussi
  for (let y = 0; y < 3; y += 0.1) { assert.ok(emerge(y + 0.1) <= emerge(y)); assert.ok(reach(y + 0.1) >= reach(y)); }
  assert.equal(rising(0.5), 0);
});

// plus haut point d'un cristal (cube tourné, éventuellement allongé)
function topOf(c, stretch = 1) {
  let top = -1e9;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    // repère du cristal → monde : inverse de rotX(rotY(p − c, ang), tilt)
    let x = sx * c.s * stretch, y = sy * c.s, z = sz * c.s;
    const ct = Math.cos(-c.tilt), st = Math.sin(-c.tilt);
    [y, z] = [ct * y - st * z, st * y + ct * z];
    top = Math.max(top, c.y + y);
  }
  return top;
}

test('raccord : au début et à la fin de la boucle, le bain couvre tout', () => {
  for (let i = 0; i < 200; i++) {
    const R = generate(`r${i}`);
    const cl = buildCluster(R.seed, CLUSTERS[R.cluster]), C = tideFor(cl);
    for (const t of [0, 0.02, CYCLE.T0 - 1e-3, CYCLE.T3 + 0.03, 0.95, 0.999]) {
      const L = level(t, C);
      for (const c of crystalsAt(cl, t, C)) {
        const top = topOf(c, R.habit === 'allongee' ? 1 / 0.62 : 1);
        assert.ok(top < L - 0.02, `graine r${i}, t = ${t} : un cristal dépasse (${top.toFixed(2)} ≥ ${L})`);
        assert.equal(c.piece, null); assert.equal(c.drips.length, 0);
      }
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

test('fonte : affaissement, coin et gouttes dans l’ordre, peau après engloutissement', () => {
  const cl = buildCluster('f1', CLUSTERS.grappe);
  const c0 = cl[0];
  const at = (t) => crystalsAt(cl, t)[0];
  assert.ok(Math.abs(at(0.5).y - c0.y) < 1e-9); // rien ne bouge avant la remontée
  assert.ok(at(0.84).y < c0.y); // il s'est affaissé
  // la peau n'apparaît qu'une fois le haut englouti
  const tSub = reach(c0.y + c0.s * 1.1);
  assert.ok(at(tSub - 0.01).skin < 0 && at(tSub + 0.02).skin > 0);
});

test('caméra : périodique et lente', () => {
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

test('caméra : toujours au-dessus du métal, même à marée haute', () => {
  for (let i = 0; i < 200; i++) {
    const R = generate(`k${i}`);
    const LH = tideFor(buildCluster(R.seed, CLUSTERS[R.cluster])).LH;
    for (let k = 0; k < 100; k++) {
      const y = cameraAt(R, k / 100).pos[1];
      assert.ok(y > LH + 0.15, `graine k${i} (${R.framing}) : caméra à ${y.toFixed(2)} sous la marée haute ${LH.toFixed(2)}`);
    }
  }
});

test('marée de la grappe : juste au-dessus du plus haut cristal', () => {
  for (let i = 0; i < 100; i++) {
    const R = generate(`m${i}`), cl = buildCluster(R.seed, CLUSTERS[R.cluster]), C = tideFor(cl);
    assert.ok(C.LH < 3.2 && C.LH > C.LL + 0.5);
    // le bain ne reste pas haut et vide : à mi-remontée, au moins un cristal dépasse encore
    const L = level((C.T2 + C.T3) / 2, C);
    assert.ok(crystalsAt(cl, (C.T2 + C.T3) / 2, C).some((c) => c.y + c.s > L), `graine m${i} : tout est englouti à mi-fonte`);
  }
});
