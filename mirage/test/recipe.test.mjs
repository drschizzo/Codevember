// Invariants de la recette : déterminisme, partage, catalogue, décors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES, FINISHES } from '../src/recipe.js';
import { ENV_PRESETS } from '../src/gen/envmap.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien), et une recette à jour passe telle quelle', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque famille, chaque décor et chaque finition sont tirés ; la finition va avec le décor', () => {
  const seen = { f: new Set(), m: new Set(), x: new Set() };
  for (const s of SEEDS) {
    const R = generate(s);
    seen.f.add(R.family); seen.m.add(R.mood); seen.x.add(R.mirascope.finish);
    assert.ok(MOODS[R.mood].finishes.includes(R.mirascope.finish));
    assert.ok(FAMILIES[R.family].colors.some(([a, b]) => a === R.object.c1 && b === R.object.c2));
  }
  for (const k of Object.keys(FAMILIES)) assert.ok(seen.f.has(k), k);
  for (const k of Object.keys(MOODS)) assert.ok(seen.m.has(k), k);
  for (const k of Object.keys(FINISHES)) assert.ok(seen.x.has(k), k);
});

test('des décors, pas des teintes : studio, table, lampe et valeur diffèrent d’un décor à l’autre', () => {
  const keys = Object.values(MOODS).map((M) => `${M.env}|${M.table}|${M.lamp}|${M.grade.exposure}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const M of Object.values(MOODS)) assert.ok(ENV_PRESETS[M.env], M.env);
  // valeurs : au moins un décor clair et un décor sombre
  const amb = Object.values(MOODS).map((M) => ENV_PRESETS[M.env].ambient[1]);
  assert.ok(Math.max(...amb) > 0.3 && Math.min(...amb) < 0.02);
});

test('les surcharges imposent la famille et le décor', () => {
  for (const family of Object.keys(FAMILIES)) for (const mood of Object.keys(MOODS)) {
    const R = generate('x', { family, mood });
    assert.equal(R.family, family); assert.equal(R.mood, mood);
  }
});
