// Invariants de la recette et de la direction artistique, sans navigateur :
// node --test 'bolt/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, BODIES, METALS, TABLES, TEAS } from '../src/recipe.js';
import { VARIANTS, FAMILIES } from '../src/gen/vessels.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille et chaque variante sont tirées', () => {
  const Rs = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(Rs.some((R) => R.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(Rs.some((R) => R.vessel.family === f), `famille jamais tirée : ${f}`);
  for (const v of Object.keys(VARIANTS)) assert.ok(Rs.some((R) => R.vessel.variant === v), `variante jamais tirée : ${v}`);
});

test('accords : matières existantes, au moins trois familles de matières par scène', () => {
  for (const [m, M] of Object.entries(MOODS)) for (const [b, me, t, tea] of M.accords) {
    assert.ok(BODIES[b] && METALS[me] && TABLES[t] && TEAS[tea], `${m} : accord inconnu ${b} ${me} ${t} ${tea}`);
    const fams = new Set([BODIES[b].family, me === 'fonte' ? 'fonte' : 'métal poli', TABLES[t].family, 'liquide']);
    assert.ok(fams.size >= 3, `${m} : ${[...fams]}`);
  }
});

test('la matière convient au récipient (verre en verre, tetsubin en fonte)', () => {
  for (const s of SEEDS) {
    const R = generate(s), V = VARIANTS[R.vessel.variant], f = BODIES[R.vessel.body].family;
    assert.equal(V.family, R.vessel.family);
    assert.equal(!!V.glass, f === 'verre', `${s} : ${R.vessel.variant} en ${f}`);
    assert.equal(!!V.cast, f === 'fonte', `${s} : ${R.vessel.variant} en ${f}`);
    assert.equal(R.bolt.family, FAMILIES[R.vessel.family].bolt);
  }
});

test('l’humeur et la famille peuvent être imposées', () => {
  for (const m of Object.keys(MOODS)) for (const f of Object.keys(FAMILIES)) {
    const R = generate('x', { mood: m, family: f });
    assert.equal(R.mood, m);
    assert.ok(VARIANTS[R.vessel.variant]); // (la famille peut céder si l'humeur n'a aucun accord pour elle)
  }
});

test('direction artistique : l’or reste un accent (jamais le corps du récipient), une seule teinte franche', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    assert.ok(!/gold|brass/i.test(R.finish.body.outer.preset), `${s} : corps doré`);
    assert.ok(R.film.strokes.length >= 2 && R.film.strokes.length <= 6);
    assert.equal(R.film.strokes[0].amp, 1);
  }
});

test('décors : pas deux humeurs avec le même support, le même studio et la même valeur de mur', () => {
  const sig = Object.values(MOODS).map((M) => `${M.env}|${M.accords[0][2]}|${M.wall}`);
  assert.equal(new Set(sig).size, sig.length);
});
