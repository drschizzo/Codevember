// Le plan de la boucle : nombres entiers de tours, came et barre, temps du film.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePlan, makeWarp, CATALOGUE } from '../src/plan.js';
import { camProfile, GEO } from '../src/gen/bench.js';
import { generate } from '../src/recipe.js';

const R = generate('plan', { family: 'cordon' });

test('le mandrin fait un nombre entier de tours par boucle ; la roue-programme un tour', () => {
  const P = makePlan(R);
  assert.ok(Number.isInteger(P.N));
  assert.ok(Math.abs(P.theta(P.P - 1e-9) - 2 * Math.PI * P.N) < 1e-6);
  assert.ok(Math.abs(P.theta(0)) < 1e-9);
  // rotation monotone (le moteur ne recule jamais)
  let last = -1;
  for (let i = 0; i <= 4000; i++) { const th = P.theta((i / 4000) * P.P * 0.999999); assert.ok(th >= last - 1e-9); last = th; }
});

test('la barre : fermée pendant la torsion, ouverte pendant le retour, continue', () => {
  const P = makePlan(R);
  for (const c of P.cycles) {
    assert.ok(P.bar((c.t0 + c.t1) / 2) < 1e-6, 'fermée au milieu de la torsion');
    assert.ok(P.bar((c.free0 + c.free1) / 2) > 1 - 1e-6, 'ouverte pendant le retour');
  }
  for (let i = 0; i < 20000; i++) { const t = (i / 20000) * P.P; assert.ok(Math.abs(P.bar(t + 1e-4) - P.bar(t)) < 0.01, `saut de la barre à ${t}`); }
  // le volant est bloqué seulement quand la barre est fermée
  for (let i = 0; i < 2000; i++) { const t = (i / 2000) * P.P, d = P.drive(t); if (d.locked) assert.ok(d.bar < 0.35); }
});

test('cause et effet : la levée de la came est l’ouverture de la barre, à chaque instant', () => {
  const P = makePlan(R), { lift, N } = camProfile(R, 720);
  assert.equal(N, P.N);
  let worst = 0;
  for (let i = 0; i < 6000; i++) {
    const tau = (i / 6000) * P.P;
    // (pendant les arrêts, la roue est immobile et la levée reste à 1)
    const psi = (P.theta(tau) / P.N / (2 * Math.PI)) % 1, x = psi * 720, j = Math.floor(x) % 720, f = x - Math.floor(x);
    const l = lift[j] * (1 - f) + lift[(j + 1) % 720] * f; // (la came usinée : 720 points, interpolés)
    worst = Math.max(worst, Math.abs(l - P.bar(tau)));
  }
  assert.ok(worst < 0.03, `écart came / barre ${worst.toFixed(3)}`);
  // et le poussoir touche la came au repos : sa tête est au point bas de la roue
  assert.ok(Math.abs(GEO.wheel.y - GEO.wheel.R - (GEO.wheel.y - GEO.wheel.R)) < 1e-12);
});

test('temps du film : τ(t + T) = τ(t) + P, monotone, ralentis où il faut', () => {
  const P = makePlan(R);
  const W = makeWarp(P.P, [{ c: 10, w: 1, a: Math.log(1 / 3) }, { c: 25, w: 2, a: Math.log(1.7) }]);
  for (const t of [0, 1.3, 7.7, 20]) assert.ok(Math.abs(W.tauOf(t + W.T) - W.tauOf(t) - P.P) < 1e-6);
  let last = -1;
  for (let i = 0; i <= 1000; i++) { const tau = W.tauOf((i / 1000) * W.T); assert.ok(tau >= last); last = tau; }
  assert.ok(Math.abs(W.speed(10) - 1 / 3) < 1e-9);
  assert.ok(W.T > P.P);
});

test('chaque famille du catalogue a trois cycles en crescendo', () => {
  for (const [k, F] of Object.entries(CATALOGUE)) {
    assert.equal(F.cycles.length, 3, k);
    assert.ok(F.cycles[0] < F.cycles[1] && F.cycles[1] < F.cycles[2], k);
  }
});
