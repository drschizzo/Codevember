// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'cocoon/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, THREADS, ACCORDS, FAMILIES, SHAPES, windSpec } from '../src/recipe.js';
import { MATERIALS } from '../src/scene/materials-list.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille, chaque forme et chaque fil sont tirés', () => {
  const Rs = SEEDS.map((s) => generate(s));
  for (const [k, set] of [['mood', MOODS], ['family', FAMILIES]]) {
    const seen = new Set(Rs.map((R) => R[k]));
    for (const m of Object.keys(set)) assert.ok(seen.has(m), `${k} jamais tiré : ${m}`);
  }
  const shapes = new Set(Rs.map((R) => R.cage.shape)), threads = new Set(Rs.map((R) => R.thread.kind));
  for (const s of Object.keys(SHAPES)) assert.ok(shapes.has(s), `forme jamais tirée : ${s}`);
  for (const t of Object.keys(THREADS)) assert.ok(threads.has(t), `fil jamais tiré : ${t}`);
});

test('accords : matières existantes, trois familles au moins, une seule matière chaude', () => {
  const fam = (k) => (/walnut|boxwood|ebony/.test(k) ? 'bois' : /brass/.test(k) ? 'chaud' : /porcelain|agate|Enamel/.test(k) ? 'céramique' : 'froid');
  for (const [name, A] of Object.entries(ACCORDS)) {
    for (const r of ['structure', 'fittings', 'cage', 'wood', 'eye']) assert.ok(MATERIALS[A[r]], `${name}.${r} : ${A[r]} inconnu`);
    const fams = new Set(['structure', 'fittings', 'cage', 'wood', 'eye'].map((r) => fam(A[r])));
    assert.ok(fams.size >= 3, `${name} : ${[...fams]}`);
    // l'or (laiton) n'est jamais à la fois sur la structure et sur les ferrures
    assert.ok(!(fam(A.structure) === 'chaud' && fam(A.fittings) === 'chaud'), `${name} : laiton partout`);
  }
  for (const [m, M] of Object.entries(MOODS)) {
    for (const a of M.accords) assert.ok(ACCORDS[a], `${m} : accord inconnu ${a}`);
    for (const t of M.threads) assert.ok(THREADS[t], `${m} : fil inconnu ${t}`);
  }
});

test('lumière : la pièce est presque blanche, les lampes chaudes mais claires', () => {
  for (const s of SEEDS.slice(0, 100)) {
    const R = generate(s);
    assert.ok(R.light.lamp.K >= 3300, `${s} : lampe à ${R.light.lamp.K} K`);
    if (R.light.key.kind !== 'none' && R.light.key.kind !== 'sky') assert.ok(R.light.key.K >= 4700, `${s} : lumière de la pièce à ${R.light.key.K} K`);
  }
});

test('variété : deux humeurs n’ont pas le même décor', () => {
  const sig = (M) => [M.room.window, M.key.kind, Math.round(parseInt(M.room.wall.slice(1, 3), 16) / 64), M.camera.close ?? 0].join();
  const seen = new Map();
  for (const [k, M] of Object.entries(MOODS)) { const g = sig(M); assert.ok(!seen.has(g), `${k} ressemble à ${seen.get(g)}`); seen.set(g, k); }
});

test('le bobinage ne dépend que de la recette (spécification stable)', () => {
  const R = generate('w1');
  assert.deepEqual(windSpec(R), windSpec(JSON.parse(JSON.stringify(R))));
});
