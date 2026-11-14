// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'melt/test/*.test.mjs'
//
// À compléter avec les invariants du thème : géométrie (maillage étanche, pas
// de triangle nul), boucle (l'état à u = 1 rejoint celui à u = 0), collisions,
// et les règles de direction artistique, sur quelques centaines de graines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS } from '../src/recipe.js';
import { SETS, FINISHES } from '../../shared/finishes.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur est tirée, et chaque accord ne cite que des jeux existants', () => {
  const seen = new Set(SEEDS.map((s) => generate(s).mood));
  for (const m of Object.keys(MOODS)) assert.ok(seen.has(m), `humeur jamais tirée : ${m}`);
  for (const [m, M] of Object.entries(MOODS)) for (const a of M.accords) for (const k of a.flat()) assert.ok(SETS[k], `${m} : jeu inconnu ${k}`);
});

test('boucle parfaite : les mouvements font un nombre entier de tours', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    for (const k of ['spin', 'orbit', 'bob']) assert.ok(Number.isInteger(R.motion[k]), `${s} : motion.${k}`);
    assert.ok(Number.isInteger(R.camera.orbit));
  }
});

test('direction artistique : l’or reste un accent', () => {
  const warm = (k) => /gold|brass|bronze|copper/i.test(`${SETS[k].outer} ${k}`);
  for (const s of SEEDS) {
    const R = generate(s);
    const share = R.pieces.filter((p) => warm(p.finish.set)).length / R.pieces.length;
    assert.ok(share <= 0.5, `${s} : ${Math.round(share * 100)} % de métal chaud`);
  }
  assert.ok(Object.keys(FINISHES).length > 20);
});
