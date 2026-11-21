// Invariants de la recette, vérifiés sans navigateur :
// node --test 'magma/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS } from '../src/recipe.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur est tirée', () => {
  const seen = new Set(SEEDS.map((s) => generate(s).mood));
  for (const m of Object.keys(MOODS)) assert.ok(seen.has(m), `humeur jamais tirée : ${m}`);
});

test('la percée est dans le cadre, en amont de la cible', () => {
  for (const s of SEEDS) {
    const R = generate(s), src = R.toes.sources[0], [tx, tz] = R.camera.target;
    assert.ok(src.z < tz && tz - src.z < 1.1, `${s} : percée trop loin (${src.z} / ${tz})`); // (en haut du cadre)
    assert.ok(Math.abs(src.x - tx) < 0.6, `${s} : percée hors champ`);
  }
});
