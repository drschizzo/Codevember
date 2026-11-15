// L'horloge du film : raccord, front qui avance sans reculer, temps figé au
// ralenti, charge du stroboscope, caméra calme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFilm, cameraAt, TIMELINE, RHO_MAX, durationFor, GAP } from '../src/film.js';

const F = createFilm({ duration: 12, rhoStart: 1.6, rhoEnd: 6.4 });

test('raccord : tout est identique à u = 0 et u = 1', () => {
  assert.equal(F.rho(0), RHO_MAX); assert.equal(F.rho(1 - 1e-9), RHO_MAX);
  assert.ok(Math.abs(F.charge(0) - F.charge(1 - 1e-9)) < 1e-6);
  const r0 = F.realPhase(0), r1 = F.realPhase(1 - 1e-9);
  assert.ok(r0 < 1e-6 && Math.abs(r1 - 1) < 1e-6);
});

test('le front avance sans jamais reculer pendant le ralenti, et quitte la scène', () => {
  let prev = -Infinity;
  for (let u = TIMELINE.slow; u < TIMELINE.up; u += 1e-4) {
    const r = F.rho(u);
    assert.ok(r >= prev - 1e-9, `le front recule en u = ${u}`);
    prev = r;
  }
  assert.ok(Math.abs(F.rho(TIMELINE.slow + 1e-6) - 1.6) < 0.01);
  assert.ok(F.rho(TIMELINE.up) >= 50);
});

test('au ralenti, le temps réel est figé ; la charge est vide juste après l’éclair, pleine juste avant', () => {
  assert.ok(Math.abs(F.realPhase(0.3) - F.realPhase(0.7)) < 1e-6);
  assert.ok(F.charge(TIMELINE.slow - 1e-4) > 0.99);
  assert.ok(F.charge(TIMELINE.slow + 1e-4) < 1e-3);
  let prev = -1;
  for (let u = TIMELINE.up; u < 1; u += 0.001) { const c = F.charge(u); assert.ok(c >= prev - 1e-9); prev = c; }
  for (let u = 0; u < TIMELINE.slow; u += 0.001) { const c = F.charge(u); assert.ok(c >= prev - 1e-9); prev = c; }
});

test('la durée découle du chemin : bornée entre 7 et 16 s', () => {
  assert.equal(durationFor(0.5), 7);
  assert.equal(durationFor(40), 16);
  const T = durationFor(4.8);
  assert.ok(T >= 7 && T <= 16);
});

test('caméra : périodique, lente et sans à-coup (120 i/s)', () => {
  const C = { az: 0.35, el: 0.12, dist: 2.4, sway: 0.06, swayPhase: 0.4, push: 0.06, target: [0, 0.2, -0.1], fov: 34 };
  const p0 = cameraAt(C, 0).pos, p1 = cameraAt(C, 1).pos;
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(p0[i] - p1[i]) < 1e-12);
  const dt = 1 / 120, T = 12;
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
  assert.ok(maxA < 0.8, `accélération de pointe ${maxA.toFixed(3)} m/s²`);
});

test('ralenti variable : le film file entre deux échos, ralentit dans les fenêtres, le front ne recule jamais', () => {
  const G = createFilm({ duration: 16, rhoStart: 1.6, rhoEnd: 11, windows: [[1.1, 5], [6.6, 9.5]] });
  let prev = -Infinity;
  const du = 1e-4;
  const slope = (r0) => { let u = TIMELINE.slow; while (G.rho(u) < r0) u += du; return (G.rho(u + du) - G.rho(u)) / du; };
  for (let u = TIMELINE.slow; u < TIMELINE.up; u += du) { const r = G.rho(u); assert.ok(r >= prev - 1e-9); prev = r; }
  const inWin = slope(3), inGap = slope(5.8);
  assert.ok(Math.abs(inGap / inWin - GAP) < 0.05, `rapport ${inGap / inWin}`);
  assert.ok(Math.abs(G.rho(TIMELINE.slow + 1e-6) - 1.6) < 0.01);
  assert.ok(Math.abs(G.rho(TIMELINE.end - 1e-6) - 11) < 0.05);
});
