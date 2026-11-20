// L'Icosaèdre et la troupe : node --test 'tension/test/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, FAMILIES, CABLE_COUNT } from '../src/recipe.js';
import { buildTopology } from '../src/gen/topology.js';
import { prepare } from '../src/gen/gait.js';
import { makeFilm } from '../src/gen/film.js';
import { makeTroupe } from '../src/gen/troupe.js';

const cache = new Map();
const filmOf = (sim) => {
  const k = JSON.stringify(sim);
  if (!cache.has(k)) { const P = prepare(sim); const f = makeFilm(P, { slow: 0 }); f.T = P.T; f.P = P; cache.set(k, f); }
  return cache.get(k);
};

test('Icosaèdre : six barres, vingt-quatre câbles, vingt-quatre symétries', () => {
  const T = buildTopology({ family: 'icosa' });
  assert.equal(T.nodes.length, 12); assert.equal(T.bars.length, 6); assert.equal(T.cables.length, 24);
  assert.equal(T.perms.length, 24); assert.equal(T.perms.filter((p) => p.mir).length, 12);
  // chaque nœud porte une barre et quatre câbles ; chaque symétrie envoie une barre sur une barre
  for (let i = 0; i < 12; i++) { assert.equal(T.bars.filter((b) => b.i === i || b.j === i).length, 1); assert.equal(T.cables.filter((c) => c.i === i || c.j === i).length, 4); }
  for (const { p } of T.perms) for (const b of T.bars) assert.ok(T.bars.some((q) => (q.i === p[b.i] && q.j === p[b.j]) || (q.i === p[b.j] && q.j === p[b.i])));
  // posé sur une face : trois nœuds au plus bas
  const ys = T.nodes.map((n) => n.p[1]).sort((a, b) => a - b);
  assert.ok(ys[2] - ys[0] < 1e-9 && ys[3] - ys[2] > 0.1);
});

test('Icosaèdre : quatre bascules font un pas droit, et le pas se referme', () => {
  const f = filmOf({ family: 'icosa', tips: 4 }), P = f.P;
  assert.equal(P.events.length, 4);
  assert.ok(f.dist > 4.5 && f.dist < 6.5, `pas de ${f.dist.toFixed(2)} u`);
  assert.ok(Math.abs(P.yaw) < 0.01, `lacet ${(P.yaw * 180 / Math.PI).toFixed(2)}°`);
  assert.ok(P.residual < 2e-4, `point fixe ${P.residual.toExponential(1)}`);
  // fin = début déplacé du pas (comme ensemble de nœuds : la fin est ré-étiquetée)
  const A = f.pose(0), B = f.pose(1 - 1e-9);
  for (let i = 0; i < f.N; i++) { let b = 1e9; for (let j = 0; j < f.N; j++) b = Math.min(b, Math.hypot(B[j * 3] - A[i * 3] - f.dist, B[j * 3 + 1] - A[i * 3 + 1], B[j * 3 + 2] - A[i * 3 + 2])); assert.ok(b < 1e-4); }
  // barres rigides, rien sous le sol
  const Q = new Float32Array(f.N * 3);
  for (let k = 0; k < 300; k++) {
    f.pose(k / 300, Q);
    for (const b of f.T.bars) assert.ok(Math.abs(Math.hypot(Q[b.i * 3] - Q[b.j * 3], Q[b.i * 3 + 1] - Q[b.j * 3 + 1], Q[b.i * 3 + 2] - Q[b.j * 3 + 2]) / b.L - 1) < 0.004);
    for (let i = 0; i < f.N; i++) assert.ok(Q[i * 3 + 1] > f.T.nodes[i].r - 0.03);
  }
});

test('Cerceau par tiers de tour : la roue se repose ré-étiquetée, le pas se referme', () => {
  const f = filmOf({ family: 'cerceau', m: 12, flats: 4, dur: 4.5 });
  assert.ok(f.dist > 4 && f.dist < 5, `pas de ${f.dist.toFixed(2)} u`); // (un tiers de la circonférence)
  assert.ok(f.perm.some((j, i) => j !== i));
  assert.ok(f.seamErr < 0.01);
});

test('recette : une troupe de deux à quatre, deux espèces au plus, câbles comptés', () => {
  const counts = new Set(), fams = new Set();
  for (let i = 0; i < 200; i++) {
    const R = generate(`t${i}`);
    assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
    counts.add(R.troupe.length);
    assert.ok(R.troupe.length >= 2 && R.troupe.length <= 4);
    assert.equal(R.troupe.filter((m) => m.lead).length, 1);
    assert.equal(R.troupe.find((m) => m.lead).family, R.family);
    assert.ok(new Set(R.troupe.map((m) => JSON.stringify(m.sim))).size <= 2);
    assert.ok(R.troupe.reduce((a, m) => a + CABLE_COUNT(m.sim), 0) <= 192);
    for (const m of R.troupe) { fams.add(m.family); assert.equal(CABLE_COUNT(m.sim), buildTopology(m.sim).cables.length); }
    for (let k = 1; k < R.troupe.length; k++) assert.ok(R.troupe[k].size <= R.troupe[k - 1].size);
  }
  assert.deepEqual([...counts].sort(), [2, 3, 4]);
  assert.equal(fams.size, Object.keys(FAMILIES).length);
  assert.equal(generate('t1', { count: 1 }).troupe.length, 1);
});

test('troupe : même distance et même durée pour tous, couloirs disjoints, boucle exacte', () => {
  for (const seed of ['a1', 'c3', 'g7']) {
    const R = generate(seed);
    const F = makeTroupe(R.troupe.map((m) => ({ film: filmOf(m.sim), size: m.size, phase: m.phase, ahead: m.ahead })));
    assert.equal(F.N, F.T.nodes.length); assert.equal(F.NC, F.T.cables.length);
    for (const m of F.members) {
      // n pas à l'échelle s font la distance de la troupe ; chacun a le temps de les faire
      const f = filmOf(R.troupe[F.members.indexOf(m)].sim);
      assert.ok(Math.abs(m.steps * m.scale * f.dist - F.dist) < 1e-9);
      assert.ok(Math.abs(m.step - f.dur * Math.sqrt(m.scale)) < 1e-9);
      assert.ok(m.steps * m.step <= F.dur + 1e-9 && m.wait >= 0);
    }
    // couloirs : rangés, sans recouvrement
    for (let k = 1; k < F.members.length; k++) assert.ok(F.members[k].zlo > F.members[k - 1].zhi + 0.3, `${seed} : couloirs trop proches`);
    // fin de boucle = début déplacé de D, membre par membre (comme ensembles)
    const A = F.pose(0), B = F.pose(1 - 1e-9);
    for (let i = 0; i < F.N; i++) {
      let b = 1e9;
      for (let j = 0; j < F.N; j++) if (F.T.nodes[j].mem === F.T.nodes[i].mem) b = Math.min(b, Math.hypot(B[j * 3] - A[i * 3] - F.dist, B[j * 3 + 1] - A[i * 3 + 1], B[j * 3 + 2] - A[i * 3 + 2]));
      assert.ok(b < 1e-4, `${seed} : raccord ${b.toExponential(1)}`);
    }
    // à tout instant : chacun dans son couloir, rien sous le sol, barres rigides, aucun nœud ne saute
    const P = new Float32Array(F.N * 3), prev = new Float32Array(F.N * 3), NS = Math.round(F.dur * 120);
    for (let k = 0; k <= NS; k++) {
      F.pose((k / NS) * 0.999999, P);
      F.T.nodes.forEach((nd, i) => {
        const m = F.members[nd.mem];
        assert.ok(P[i * 3 + 2] > m.zlo - 1e-3 && P[i * 3 + 2] < m.zhi + 1e-3, `${seed} : hors couloir`);
        assert.ok(P[i * 3 + 1] > nd.r - 0.03, `${seed} : sous le sol`);
        if (k) assert.ok(Math.hypot(P[i * 3] - prev[i * 3], P[i * 3 + 1] - prev[i * 3 + 1], P[i * 3 + 2] - prev[i * 3 + 2]) * 120 < 30, `${seed} : un nœud saute`);
      });
      if (k % 40 === 0) for (const b of F.T.bars) { const s = F.T.members[b.mem].scale; assert.ok(Math.abs(Math.hypot(P[b.i * 3] - P[b.j * 3], P[b.i * 3 + 1] - P[b.j * 3 + 1], P[b.i * 3 + 2] - P[b.j * 3 + 2]) / (b.L * s) - 1) < 0.005, `${seed} : barre déformée`); }
      prev.set(P);
    }
  }
});
