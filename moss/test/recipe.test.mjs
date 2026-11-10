// Invariants de la recette et de la direction artistique, sur 400 graines.
//   node --test 'moss/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, DECOR_FINISHES } from '../src/recipe.js';
import { FAMILIES } from '../src/families.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);
const hexK = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille et chaque eau sont tirées', () => {
  const Rs = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(Rs.some((R) => R.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(Rs.some((R) => R.family === f), `famille jamais tirée : ${f}`);
  for (const w of ['rain', 'fog', 'dew']) assert.ok(Rs.some((R) => R.water === w), `eau jamais tirée : ${w}`);
});

test('les accords ne citent que des matières existantes', () => {
  for (const [m, M] of Object.entries(MOODS)) for (const a of M.accords) for (const k of Object.values(a)) assert.ok(DECOR_FINISHES[k], `${m} : matière inconnue ${k}`);
});

test('les humeurs diffèrent par le décor, la lumière et la valeur (pas seulement la teinte)', () => {
  const E = Object.entries(MOODS);
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const [a, A] = E[i], [b, B] = E[j];
    const same = (A.support === B.support) + (A.env === B.env) + (A.value === B.value);
    assert.ok(same <= 1, `${a} et ${b} se ressemblent`);
  }
});

test('les lampes sont presque blanches (la lune exceptée)', () => {
  for (const s of SEEDS) {
    const [r, , b] = hexK(generate(s).light.sun.color);
    assert.ok(b / r > 0.68, `${s} : soleil trop chaud`);
  }
});

test('les familles ont des gestes distincts', () => {
  const F = Object.values(FAMILIES);
  // (le geste : ce qui change le plus entre sec et mouillé)
  const sig = (f) => [Math.sign(Math.round(f.wet.theta - f.dry.theta)), Math.round(Math.abs(f.dry.tw - f.wet.tw)), f.spor.kind, !!f.shoot.capitulum].join();
  assert.equal(new Set(F.map(sig)).size, F.length);
});
