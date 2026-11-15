// L'horloge du film : raccord, monotonie des fronts, temps figé au ralenti,
// caméra calme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFilm, cameraAt, TIMELINE, RHO_MAX } from '../src/film.js';

const F = createFilm({ duration: 30, rhoStart: 2.1, rhoEnd: 8.5, cord: { length: 0.28, damping: 1.6, pull: 0.25, hold: 0.12, depth: 0.025, swing: 0.06, dir: 0.4 } });

test('raccord : tout est identique à u = 0 et u = 1', () => {
  const a = F.rho(0), b = F.rho(1 - 1e-9);
  assert.equal(a.on, RHO_MAX); assert.equal(b.on, RHO_MAX);
  assert.equal(a.off, RHO_MAX); assert.equal(b.off, RHO_MAX);
  const c0 = F.cordAt(0), c1 = F.cordAt(1 - 1e-9);
  for (const k of ['y', 'sx', 'sz']) assert.ok(Math.abs(c0[k] - c1[k]) < 1e-6, `cordon ${k}`);
  assert.ok(Math.abs(F.realPhase(1 - 1e-9) - 1) < 1e-6 || F.realPhase(1 - 1e-9) < 1e-6);
});

test('les fronts avancent sans jamais reculer pendant leur ralenti', () => {
  for (const [k, e] of [['on', TIMELINE.on], ['off', TIMELINE.off]]) {
    let prev = -Infinity;
    for (let u = e.slow; u < e.up; u += 1e-4) {
      const r = F.rho(u)[k];
      assert.ok(r >= prev - 1e-9, `${k} recule en u = ${u}`);
      prev = r;
    }
    assert.ok(Math.abs(F.rho(e.slow + 1e-6)[k] - 2.1) < 0.01, `${k} part de rhoStart`);
    assert.ok(F.rho(e.up)[k] >= 50, `${k} a traversé la pièce à la fin de la rampe`);
  }
});

test('au ralenti, le cordon est figé', () => {
  const a = F.cordAt(0.15), b = F.cordAt(0.35);
  assert.ok(Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.sx - b.sx) < 1e-9);
});

test('le déclic : la perle est en bas quand la lumière part', () => {
  const c = F.cordAt(TIMELINE.on.slow);
  assert.ok(c.y < -0.024);
});

test('caméra : périodique, lente et sans à-coup (120 i/s)', () => {
  const C = { az: 0.35, el: 0.12, dist: 2.4, sway: 0.06, swayPhase: 0.4, push: 0.06, target: [0, 0.2, -0.1], fov: 34 };
  const p0 = cameraAt(C, 0).pos, p1 = cameraAt(C, 1).pos;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(p0[i] - p1[i]) < 1e-12);
  const dt = 1 / 120, T = 30;
  let maxW = 0, maxA = 0, prevV = null;
  const dir = (u) => { const c = cameraAt(C, u); const d = c.target.map((t, i) => t - c.pos[i]); const l = Math.hypot(...d); return d.map((x) => x / l); };
  for (let k = 0; k < T * 120; k++) {
    const u0 = (k * dt) / T, u1 = ((k + 1) * dt) / T;
    const a = dir(u0), b = dir(u1);
    const w = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / dt * 180 / Math.PI;
    maxW = Math.max(maxW, w);
    const pa = cameraAt(C, u0).pos, pb = cameraAt(C, u1).pos;
    const v = pa.map((x, i) => (pb[i] - x) / dt);
    if (prevV) maxA = Math.max(maxA, Math.hypot(...v.map((x, i) => (x - prevV[i]) / dt)));
    prevV = v;
  }
  assert.ok(maxW < 25, `vitesse angulaire de pointe ${maxW.toFixed(2)}°/s`);
  assert.ok(maxA < 0.5, `accélération de pointe ${maxA.toFixed(3)} m/s²`);
});
