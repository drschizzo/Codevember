// Le cœur : l'arbre des orteils, la surface et sa boucle, le refroidissement,
// le temps du film.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growTree, bakeLists, bakeBlur, surfaceFromLists, toeZ, frontAt, passTime, local, frontS, outline, reliefAt, STRIDE } from '../src/gen/toes.js';
import { solveCooling, coolAt } from '../src/gen/cooling.js';
import { makeTimeline } from '../src/timeline.js';
import { blackbodyXYZ } from '../src/gen/planck.js';
import { generate } from '../src/recipe.js';

const R = generate('core');
const tree = growTree({ seed: 'core', ...R.toes });
const L = bakeLists(tree, 512, 0.1);
const VIEW = [-1.8, 1.8, -1.8, 1.4];
const h = R.toes.h, Bl = bakeBlur(tree, 512);
let tEnd = 0;
for (let k = 0; k < tree.n; k++) tEnd = Math.max(tEnd, tree.T[k * STRIDE + 8] + tree.T[k * STRIDE + 9]);

test('la nappe couvre tout le champ (aucun texel sans orteil)', () => {
  assert.equal(L.empty, 0);

});

test('boucle exacte : la nappe refroidie redessine le motif de départ, une nappe plus haut (R + h)', () => {
  let worst = 0, n = 0;
  for (let z = VIEW[2]; z <= VIEW[3]; z += 0.037) for (let x = VIEW[0]; x <= VIEW[1]; x += 0.041) {
    const a = surfaceFromLists(tree.T, L, x, z, -1, h, Bl), b = surfaceFromLists(tree.T, L, x, z, tEnd + 4000, h, Bl);
    assert.equal(a.S, reliefAt(tree.T, L, x, z)[0]);
    worst = Math.max(worst, Math.abs(b.S - (a.S + h)));
    n++;
  }
  assert.ok(worst < 1e-9, `écart max ${worst} m sur ${n} points`);
});

test('la lave ne creuse jamais l’ancienne nappe et ne dépasse pas trois épaisseurs', () => {
  for (let i = 0; i < 400; i++) {
    const x = Math.sin(i * 12.9) * 1.7, z = Math.cos(i * 7.3) * 1.5;
    const R0 = surfaceFromLists(tree.T, L, x, z, -1, h, Bl).S;
    for (let t = 0; t <= tEnd + 1; t += tEnd / 60) {
      const S = surfaceFromLists(tree.T, L, x, z, t, h, Bl).S;
      assert.ok(S >= R0 - 1e-9 && S <= R0 + 3 * h + 0.05, `(${x.toFixed(2)}, ${z.toFixed(2)}) : ${S - R0}`);
    }
  }
});

test('le front passe en (s, v) à l’instant passTime', () => {
  for (let k = 0; k < Math.min(200, tree.n); k += 7) {
    const o = k * STRIDE;
    for (const a of [0.2, 0.5, 0.8]) {
      const x = tree.T[o] + Math.cos(tree.T[o + 2]) * a * tree.T[o + 4], z = tree.T[o + 1] + Math.sin(tree.T[o + 2]) * a * tree.T[o + 4];
      const [s, v] = local(tree.T, k, x, z), tp = passTime(tree.T, k, s, v);
      assert.ok(Math.abs(frontAt(tree.T, k, tp) - frontS(tree.T, k, s, v)) < 1e-4);
    }
  }
});

test('refroidissement : la surface ne fait que refroidir, croûte et lueur plausibles (Hon, Keszthelyi)', () => {
  const c = solveCooling();
  // la surface ne fait que refroidir
  for (let i = 1; i < c.n; i++) assert.ok(c.surf[i] <= c.surf[i - 1] + 1e-6);
  // croûte de quelques cm à 1 h (Hon et al. 1994 : ~0,078 m √h)
  const cr = coolAt(c, 3600, 'crust');
  assert.ok(cr > 0.04 && cr < 0.1, `croûte à 1 h : ${cr}`);
  // la lueur s'éteint en quelques minutes (sous 600 °C)
  assert.ok(coolAt(c, 60) > 700 + 273 && coolAt(c, 600) < 600 + 273);
});

test('corps noir : 1 150 °C ≈ 3 000 cd/m², rien de visible sous 500 °C', () => {
  const Y = blackbodyXYZ(1423, 0.95)[1];
  assert.ok(Y > 2500 && Y < 3600, `Y = ${Y}`);
  assert.ok(blackbodyXYZ(773, 0.95)[1] < 0.01);
});

test('temps du film : τ(u + 1) = τ(u) + P, monotone, la coulée tient dans sa fenêtre', () => {
  const TL = makeTimeline({ P: 10800, tFlow: tEnd, u0: 0.08, u1: 0.7, lead: 20 });
  let prev = -Infinity;
  for (let i = 0; i <= 2000; i++) {
    const u = i / 1000, t = TL.tau(u);
    assert.ok(t > prev); prev = t;
    assert.ok(Math.abs(TL.tau(u + 1) - t - 10800) < 1e-6);
  }
  assert.ok(Math.abs(TL.tau(0.08) + 20) < 1e-6 && Math.abs(TL.tau(0.7) - tEnd) < 2);
});

test('causalité : chaque orteil sort d’un orteil dont le front a déjà passé son col', () => {
  const T = tree.T, n = tree.n;
  let worst = 0;
  for (let k = 1; k < n; k++) {
    const o = k * STRIDE, t0 = T[o + 8], x = T[o], z = T[o + 1];
    // (les orteils des percées elles-mêmes : leur cause est la percée)
    if (R.toes.sources.some((S) => Math.hypot(x - S.x, z - S.z) < 0.05 && t0 - S.t < 10)) continue;
    let best = 1e9;
    for (let j = 0; j < n; j++) {
      if (j === k || T[j * STRIDE + 8] >= t0) continue;
      const [s, v] = local(T, j, x, z);
      if (passTime(T, j, Math.max(0, s), v) > t0 + 1e-6) continue;
      best = Math.min(best, outline(T, j, s, v));
    }
    worst = Math.max(worst, best);
  }
  assert.ok(worst < 0.35, `un orteil naît à ${worst.toFixed(2)} m de toute lave déjà là`);
});

test('chaque point de la zone vue est atteint par un front (une seule fois, par le premier)', () => {
  for (let z = VIEW[2]; z <= VIEW[3]; z += 0.05) for (let x = VIEW[0]; x <= VIEW[1]; x += 0.05) {
    const r = surfaceFromLists(tree.T, L, x, z, tEnd + 10, h, Bl);
    assert.equal(r.layer, 1, `(${x.toFixed(2)}, ${z.toFixed(2)}) jamais atteint`);
  }
});

test('pas de falaise : d’un point au voisin (4 mm), la nappe ne saute jamais de plus de 5 cm', () => {
  const st = 0.0041;
  for (const t of [40, 120, 260]) {
    let worst = 0;
    for (let z = -1.2; z < 0.8; z += 0.031) {
      let prev = null;
      for (let x = -1.2; x < 1.2; x += st) {
        const S = surfaceFromLists(tree.T, L, x, z, t, h, Bl).S;
        if (prev !== null) worst = Math.max(worst, Math.abs(S - prev));
        prev = S;
      }
    }
    assert.ok(worst < 0.05, `t = ${t} s : saut de ${(worst * 100).toFixed(1)} cm`);
  }
});
