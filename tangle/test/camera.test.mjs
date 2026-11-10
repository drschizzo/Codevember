// La caméra du film : périodique, lente (pointe < 25°/s), sans à-coups, jamais
// sous la table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../src/gen/sim.js';
import { cameraPath } from '../src/camera.js';
import { generate } from '../src/recipe.js';
import { S as SCALE, TABLE } from '../src/gen/bench.js';

const R = generate('cam-test', { family: 'cordon' });
const S = simulate(R);
const cam = cameraPath(S, R, { S: SCALE, Y0: TABLE * SCALE });

const dir = (p) => { const d = [p.tgt[0] - p.pos[0], p.tgt[1] - p.pos[1], p.tgt[2] - p.pos[2]], l = Math.hypot(...d); return d.map((x) => x / l); };

test('périodique : même pose à 0 et à T', () => {
  const a = cam.at(0), b = cam.at(S.T);
  for (let k = 0; k < 3; k++) { assert.ok(Math.abs(a.pos[k] - b.pos[k]) < 1e-9); assert.ok(Math.abs(a.tgt[k] - b.tgt[k]) < 1e-9); }
});

test('vitesse angulaire < 25°/s, accélération bornée (120 i/s), au-dessus de la table', () => {
  const dt = 1 / 120;
  let peak = 0, acc = 0, prevW = null;
  for (let t = 0; t < S.T; t += dt) {
    const a = dir(cam.at(t)), b = dir(cam.at(t + dt));
    const ang = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / dt * 57.2958;
    peak = Math.max(peak, ang);
    if (prevW !== null) acc = Math.max(acc, Math.abs(ang - prevW) / dt);
    prevW = ang;
    assert.ok(cam.at(t).pos[1] > 0.3, 'caméra sous la table');
  }
  assert.ok(peak < 25, `pointe ${peak.toFixed(1)}°/s`);
  assert.ok(acc < 200, `accélération ${acc.toFixed(0)}°/s²`);
});
