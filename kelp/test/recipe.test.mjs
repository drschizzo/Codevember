// Invariants de la recette et de la direction artistique, sur 400 graines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES } from '../src/recipe.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur et chaque famille sont tirées', () => {
  const moods = new Set(SEEDS.map((s) => generate(s).mood)), fams = new Set(SEEDS.map((s) => generate(s).family));
  for (const m of Object.keys(MOODS)) assert.ok(moods.has(m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(fams.has(f), `famille jamais tirée : ${f}`);
});

test('la série : trois vagues en crescendo, la plus grande en dernier, la boucle finit au calme', () => {
  for (const s of SEEDS) {
    const R = generate(s), w = R.sea.waves;
    assert.ok(w[0].A < w[1].A && w[1].A < w[2].A, `${s} : pas de crescendo`);
    assert.ok(w[0].t < w[1].t && w[1].t < w[2].t && w[2].t < R.loop.duration - 8.5, `${s} : la grande vague n'a pas le temps de se retirer`);
  }
});

test('des humeurs qui sont des décors : chacune sa roche, sa lumière et sa valeur', () => {
  const rocks = new Set(Object.values(MOODS).map((M) => M.rock));
  assert.ok(rocks.size >= 5, 'au moins cinq roches');
  const els = Object.values(MOODS).map((M) => M.sun.el[0]);
  assert.ok(Math.min(...els) < 0 && Math.max(...els) > 1, 'du crépuscule au midi');
  assert.ok(Object.values(MOODS).some((M) => M.sun.moon), 'une humeur de nuit');
  assert.ok(Object.values(MOODS).some((M) => M.sky.cloud >= 0.9), 'un ciel couvert');
});
