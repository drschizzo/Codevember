// Invariants de Melt : node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, COLUMNS, ICES } from '../src/recipe.js';
import { simPhase, detachFilmPhase, stateAt, columnRows } from '../src/timeline.js';
import { simulateBody, bodyPose } from '../src/gen/body.js';
import { runLake, feedRate } from '../src/gen/lake.js';
import { cameraAt } from '../src/camera.js';

test('recette déterministe, JSON, toutes les humeurs et colonnes tirées', () => {
  const a = generate('x1'), b = generate('x1');
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
  const moods = new Set(), cols = new Set(), ices = new Set();
  for (let i = 0; i < 400; i++) { const R = generate(`s${i}`); moods.add(R.mood); cols.add(R.column); ices.add(R.ice); }
  assert.equal(moods.size, Object.keys(MOODS).length);
  assert.equal(cols.size, Object.keys(COLUMNS).length);
  assert.equal(ices.size, Object.keys(ICES).length);
});

test('horloge : s(0) = 0, s(1) = 1, monotone, détachement au milieu du ralenti', () => {
  for (const sd of [0.5, 0.613, 0.75]) {
    assert.ok(Math.abs(simPhase(0, sd)) < 1e-9);
    assert.ok(Math.abs(simPhase(1 - 1e-9, sd) - 1) < 1e-6);
    let prev = -1;
    for (let k = 1; k <= 2000; k++) { const s = simPhase(k / 2000 - 1e-12, sd); assert.ok(s >= prev - 1e-12); prev = s; }
    const c = detachFilmPhase(sd);
    assert.ok(Math.abs(simPhase(c, sd) - sd) < 1e-5);
    // ralenti : moins de 2,5 % de la vitesse moyenne au détachement
    assert.ok((simPhase(c + 0.001, sd) - simPhase(c - 0.001, sd)) / 0.002 < 0.025);
  }
});

test('flottaison : un fuseau élancé se couche à 8,3 % émergé, un bloc trapu reste debout', () => {
  const slim = Array.from({ length: 80 }, (_, j) => 6 * Math.sqrt(Math.min(1, j / 10)) * (1 - j / 80) ** 0.8 + 0.3);
  const B = simulateBody({ prof: slim, dz: 1e-3, tilt0: 0.1, T: 8, stub: false });
  assert.ok(Math.abs(Math.abs(B.final.th) - Math.PI / 2) < 0.12, `θ final ${B.final.th}`);
  assert.ok(Math.abs(B.final.emerged - (1 - 0.917)) < 0.006, `émergé ${B.final.emerged}`);
  const squat = Array.from({ length: 20 }, () => 14); // D/L = 1,4
  const C = simulateBody({ prof: squat, dz: 1e-3, tilt0: 0.1, T: 6, stub: false });
  assert.ok(Math.abs(C.final.th) < 0.15, `le bloc trapu a basculé (${C.final.th})`);
});

test('dérive : partie sans à-coup du repos', () => {
  const B = { traj: new Float32Array(8), dtOut: 1, Uc: 0.004, tauDrift: 2.5 };
  assert.equal(bodyPose(B, 0).drift, 0);
  assert.ok(bodyPose(B, 0.01).drift < 1e-6);
});

test('lac : un détachement par période, pendant l’arrêt de l’avance, et la boucle se referme', { timeout: 120000 }, () => {
  const R = generate('t1', { column: 'moyenne' });
  const S = runLake(R.sim);
  assert.ok(S.detach, 'aucun détachement');
  assert.ok(S.detach.phase > R.sim.feedOff[0] && S.detach.phase < R.sim.feedOff[1] + 0.05, `détachement à ${S.detach.phase}`);
  assert.ok(feedRate(R.sim, S.detach.phase) < 0.5);
  assert.ok(S.detach.prof.length > 20);
  // raccord : profils de la fin et du début de la période relevée
  let d = 0; for (let j = 0; j < S.nz; j++) d = Math.max(d, Math.abs(S.prof[(S.samples - 1) * S.nz + j] - S.prof[j]));
  assert.ok(d < 2.5, `écart de raccord ${d} mm`);
  // l'état du film est le même à u = 0 et u = 1
  const B = simulateBody({ prof: S.detach.prof, dz: S.dx, tilt0: R.body.tilt0, T: 6 });
  const a = stateAt(R, S, B, 0), b = stateAt(R, S, B, 1 - 1e-9);
  assert.equal(a.frag, null); assert.equal(b.frag, null);
  const ra = columnRows(S, a.s), rb = columnRows(S, b.s);
  let e = 0; for (let j = 0; j < S.nz; j++) e = Math.max(e, Math.abs(ra[j] - rb[j]));
  assert.ok(e < 2.5, `écart ${e} mm`);
  // le profil ne mélange jamais les relevés de part et d'autre du détachement
  const n = S.samples, kd = Math.ceil(S.detach.phase * n) % n;
  const before = columnRows(S, (kd - 0.5) / n), at = columnRows(S, S.detach.phase - 1e-6);
  assert.deepEqual(Array.from(at), Array.from(before));
});

test('caméra : périodique et lente', () => {
  const R = generate('c1');
  const p0 = cameraAt(R, 0).pos, p1 = cameraAt(R, 1).pos;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(p0[i] - p1[i]) < 1e-9);
  let vmax = 0;
  for (let k = 0; k < 2000; k++) {
    const a = cameraAt(R, k / 2000).pos, b = cameraAt(R, (k + 1) / 2000).pos;
    vmax = Math.max(vmax, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 2000 / R.loop.duration);
  }
  assert.ok(vmax < 2, `caméra trop rapide : ${vmax} cm/s`);
});
