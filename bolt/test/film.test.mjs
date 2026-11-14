// Le film : boucle refermée, eau conservée, tendances monotones, caméra lente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { stateAt, cameraAt, TIMES, RAIN, pulse, clockAt, clockRate } from '../src/film.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => `f${i}`);
const N = 2400;

test('la boucle se referme : l’état à u = 1 est l’état à u = 0', () => {
  for (const s of SEEDS) {
    const F = generate(s).film, a = stateAt(F, 0), b = stateAt(F, 1 - 1e-9);
    for (const k of ['cloud', 'air', 'level', 'dark', 'rain', 'light', 'sim', 'vis', 'visOld', 'rag', 'ragOld', 'heat']) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${s} ${k} : ${a[k]} ≠ ${b[k]}`);
    // la vapeur repart de rien, pendant que le nuage précédent finit de se vider
    const c = stateAt(F, TIMES.cycle);
    assert.ok(c.sim === 0 && c.vis === 1 && c.visOld > 0.5 && c.visOld < 1);
    assert.ok(c.cloud + c.air < 1 - RAIN + 1e-9);
  }
});

test('l’eau se conserve à chaque instant : nuage + pluie en vol + thé = constante', () => {
  const F = generate('eau').film;
  for (let i = 0; i < N; i++) {
    const S = stateAt(F, i / N);
    assert.ok(Math.abs(S.cloud + S.air + S.level) < 1e-12);
    assert.ok(S.cloud >= -1e-12 && S.air >= -1e-12 && S.cloud <= 1 + 1e-12);
  }
});

test('une seule horloge, des tendances monotones : la colonne ne fait que monter, le nuage précédent que se défaire', () => {
  const F = generate('mono').film;
  // (dans l'ordre du cycle de l'eau : de la reprise de la vapeur à la suivante)
  const at = (i) => stateAt(F, (TIMES.cycle + 1e-9 + (i / N) * (1 - 2e-9)) % 1);
  let prev = at(0);
  for (let i = 1; i < N; i++) {
    const S = at(i), v = i / N;
    assert.ok(S.grow >= prev.grow - 1e-12 && S.sim >= prev.sim - 1e-12 && S.rag >= prev.rag - 1e-12, `la colonne recule à v = ${v}`);
    assert.ok(S.vis <= prev.vis + 1e-12 && S.visOld <= prev.visOld + 1e-12, `un nuage se refait à v = ${v}`);
    prev = S;
  }
  for (let i = 1; i < N; i++) { const u = i / N; if (u > TIMES.leader[0] && u <= TIMES.strike) assert.ok(stateAt(F, u).a >= stateAt(F, u - 1 / N).a, `le traceur recule à u = ${u}`); }
});

test('ordre des temps : la pluie avant la foudre, la bourrasque après, rien qui tombe pendant le ralenti', () => {
  for (const s of SEEDS) {
    const F = generate(s).film, last = F.strokes[F.strokes.length - 1];
    // les arcs se sont tus avant que le nuage ait fini de se défaire
    const uLast = TIMES.strike + (last.t + 0.6) / F.duration;
    assert.ok(uLast < TIMES.fade[1], `${s} : dernier arc à u = ${uLast.toFixed(3)}`);
    // il pleut avant la foudre ; le nuage frappé tient encore le reste de son eau, et il est sombre
    assert.ok(stateAt(F, (TIMES.rain[0] + TIMES.rain[1]) / 2).rain > 0.9);
    const k = stateAt(F, TIMES.strike);
    assert.ok(Math.abs(k.cloud - (1 - RAIN)) < 1e-9 && k.dark > 0.99 && k.vis === 1);
    // (la pluie suit l'horloge du film, pas l'horloge lente : aucune goutte pendant le traceur)
    for (let u = TIMES.leader[0] - 0.02; u < TIMES.strike + 0.005; u += 0.001) assert.equal(stateAt(F, u).rain, 0, `pluie au ralenti, u = ${u.toFixed(3)}`);
    assert.ok(stateAt(F, (TIMES.gush[0] + TIMES.gush[1]) / 2).rain > 0.9);
    for (const f of F.flickers) assert.ok(f.u > TIMES.flicker[0] - 1e-9 && f.u < TIMES.leader[0]);
    assert.equal(stateAt(F, TIMES.leader[0] - 1e-6).a, -1);
    assert.equal(stateAt(F, TIMES.strike).a, 1);
    assert.ok(stateAt(F, TIMES.strike - 1e-6).light === 0 && stateAt(F, TIMES.strike + 0.03 / F.duration).light > 0.5);
  }
});

test('l’impulsion d’un arc : nulle avant, maximale en quelques millisecondes, éteinte en deux secondes', () => {
  assert.equal(pulse(-0.01), 0);
  assert.ok(pulse(0.012) > 0.85);
  assert.ok(pulse(2.5) < 0.001);
});

test('caméra : périodique, lente (< 25°/s), sans à-coup à 120 i/s', () => {
  for (const s of SEEDS.slice(0, 20)) {
    const R = generate(s), C = R.camera, D = R.film.duration, n = Math.round(D * 120);
    const P = (i) => cameraAt(C, i / n);
    const a = P(0), b = P(n);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a.pos[k] - b.pos[k]) < 1e-9);
    let vmax = 0, amax = 0;
    for (let i = 0; i < n; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1);
      const dir = (p) => { const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], l = Math.hypot(...d); return d.map((x) => x / l); };
      const d1 = dir(p1), d2 = dir(p2);
      const ang = Math.acos(Math.min(1, d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2])) * 120 * 180 / Math.PI;
      vmax = Math.max(vmax, ang);
      const acc = Math.hypot(p2.pos[0] - 2 * p1.pos[0] + p0.pos[0], p2.pos[1] - 2 * p1.pos[1] + p0.pos[1], p2.pos[2] - 2 * p1.pos[2] + p0.pos[2]) * 120 * 120;
      amax = Math.max(amax, acc);
    }
    assert.ok(vmax < 25, `${s} : ${vmax.toFixed(1)} °/s`);
    assert.ok(amax < 1.5, `${s} : accélération ${amax.toFixed(2)} u/s²`);
  }
});

test('horloge des mouvements lents : presque arrêtée pendant le traceur, un tour entier par boucle', () => {
  assert.equal(clockAt(0), 0);
  assert.ok(Math.abs(clockAt(1 - 1e-12) - 1) < 1e-9);
  let prev = 0;
  for (let i = 1; i <= N; i++) { const c = clockAt(Math.min(1 - 1e-12, i / N)); assert.ok(c >= prev, `l'horloge recule à u = ${i / N}`); prev = c; }
  const normal = clockRate(0.1);
  for (let u = TIMES.leader[0] + 0.02; u < TIMES.strike - 0.015; u += 0.01) assert.ok(clockRate(u) < normal * 0.08, `vapeur trop rapide pendant le traceur (u = ${u.toFixed(2)})`);
  assert.ok(clockRate(TIMES.strike + 0.03) > normal * 0.99 && clockRate(0.9) > normal * 0.99);
  // (pendant tout le traceur, la vapeur ne monte que de 2 % d'un tour)
  assert.ok(clockAt(TIMES.strike) - clockAt(TIMES.leader[0]) < 0.03);
});

test('le panache simulé : relu sans saute ; la colonne part dès que la chaleur atteint la machine', () => {
  const F = generate('panache').film, M = 4800;
  let prev = stateAt(F, 1 - 1 / M);
  for (let i = 0; i < M; i++) {
    const S = stateAt(F, i / M);
    // ce qu'on voit : l'image sim × vis (le cycle en cours) et la dernière image × visOld (le précédent).
    // Un saut d'image n'est permis qu'au passage d'un cycle à l'autre, où la lecture en cours devient
    // la lecture « précédente » sans changer de valeur (image 0 de la simulation : vide)
    const hand = prev.sim === 1 && S.sim < 0.002 && Math.abs(S.visOld - prev.vis) < 0.01 && prev.visOld < 1e-6;
    assert.ok((Math.abs(S.sim - prev.sim) < 0.002 && Math.abs(S.visOld - prev.visOld) < 0.01) || hand, `saute du panache à u = ${(i / M).toFixed(4)}`);
    assert.ok(Math.abs(S.heat - prev.heat) < 0.01 || Math.abs(i / M - TIMES.strike) < 2 / M, `saute de la chaleur à u = ${(i / M).toFixed(4)}`);
    prev = S;
  }
  assert.equal(stateAt(F, TIMES.leader[0]).sim, 1);
  assert.equal(stateAt(F, TIMES.fade[1] + 0.001).visOld, 0);
  // le scénario : la foudre laisse de la chaleur ; c'est elle qui fait partir la vapeur, aussitôt
  assert.ok(stateAt(F, TIMES.strike + 0.001).heat > 0.95);
  assert.ok(stateAt(F, TIMES.cycle).heat > 0.9 && stateAt(F, TIMES.strike - 0.001).heat < 0.02);
  // la machine est chaude quand la colonne part (la chaleur descend le métal en PHYS.cond)
  assert.ok((TIMES.cycle - TIMES.strike) * F.duration > 0.4);
});
