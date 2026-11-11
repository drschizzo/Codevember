// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'caustic/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES, FLOORS, TANKS, kelvinToHex } from '../src/recipe.js';
import { FINISHES } from '../src/finishes.js';
import { SERIES } from '../src/gen/motifs.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  for (const s of SEEDS.slice(0, 40)) {
    const R = generate(s);
    assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
    assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
  }
});

test('chaque famille et chaque humeur sont tirées ; une humeur n’accueille que ses familles', () => {
  const fams = new Set(), moods = new Set(), series = new Set();
  for (const s of SEEDS) {
    const R = generate(s);
    fams.add(R.family); moods.add(R.mood);
    if (R.foyer) series.add(R.foyer.series);
    assert.ok(MOODS[R.mood].families.includes(R.family), `${s} : ${R.family} dans ${R.mood}`);
    assert.ok(FLOORS[R.tank.floor] && TANKS[R.tank.style], `${s} : décor inconnu`);
    assert.ok(FINISHES[TANKS[R.tank.style].frame], `${s} : finition du bâti`);
  }
  for (const f of Object.keys(FAMILIES)) assert.ok(fams.has(f), `famille jamais tirée : ${f}`);
  for (const m of Object.keys(MOODS)) assert.ok(moods.has(m), `humeur jamais tirée : ${m}`);
  for (const k of Object.keys(SERIES)) assert.ok(series.has(k), `série jamais tirée : ${k}`);
});

test('boucle parfaite : les grandeurs entières le sont', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    if (R.faraday) assert.ok(Number.isInteger(R.faraday.beats));
    if (R.karman) assert.ok(Number.isInteger(R.karman.emissions));
    if (R.foyer) assert.equal(R.foyer.events.length, 3);
  }
});

test('direction artistique : lampes presque blanches, sauf le soleil bas justifié', () => {
  for (const [k, M] of Object.entries(MOODS)) {
    const K = M.light.K;
    assert.ok(K >= 4700 || k === 'doree', `${k} : ${K} K`);
    assert.ok(/^#[0-9a-f]{6}$/.test(kelvinToHex(K)));
  }
});

test('direction artistique : des décors, pas des teintes (fond, cuve, lumière, cadrage)', () => {
  const sig = Object.entries(MOODS).map(([k, M]) => [k, `${M.floor}|${M.tank}|${M.light.kind}|${M.camera}|${M.env}`]);
  const seen = new Map();
  for (const [k, s] of sig) { assert.ok(!seen.has(s), `${k} et ${seen.get(s)} ont le même décor`); seen.set(s, k); }
  // au moins une humeur claire, une sombre, une froide
  const lum = (hex) => { const c = parseInt(hex.slice(1), 16); return ((c >> 16) + ((c >> 8) & 255) + (c & 255)) / 765; };
  const bgs = Object.values(MOODS).map((M) => lum(M.bg[0]));
  assert.ok(Math.max(...bgs) > 0.6 && Math.min(...bgs) < 0.05, 'une claire et une sombre');
  assert.ok(Object.values(MOODS).some((M) => M.light.K >= 7000), 'une froide');
});
