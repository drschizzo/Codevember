// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'tangle/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, CORDS } from '../src/recipe.js';
import { SETS, FINISHES } from '../src/finishes.js';
import { CATALOGUE, FAMILIES } from '../src/plan.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur et chaque famille sont tirées ; les accords citent des jeux existants', () => {
  const moods = new Set(SEEDS.map((s) => generate(s).mood)), fams = new Set(SEEDS.map((s) => generate(s).family));
  for (const m of Object.keys(MOODS)) assert.ok(moods.has(m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(CATALOGUE)) assert.ok(fams.has(f), `famille jamais tirée : ${f}`);
  for (const [m, M] of Object.entries(MOODS)) {
    for (const a of M.accords) for (const k of Object.values(a)) assert.ok(SETS[k], `${m} : jeu inconnu ${k}`);
    for (const c of M.cords) assert.ok(CORDS[c], `${m} : corde inconnue ${c}`);
  }
});

test('boucle parfaite : chaque cycle fait un nombre entier de tours, en crescendo', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    assert.equal(R.cycles.length, 3);
    for (const c of R.cycles) assert.ok(Number.isInteger(c.K) && c.K > 0, `${s} : K`);
    assert.ok(R.cycles[0].K < R.cycles[1].K && R.cycles[1].K <= R.cycles[2].K, `${s} : crescendo`);
  }
});

test('direction artistique : le métal chaud reste un accent (jamais à la fois bâti et métal)', () => {
  const warm = (set) => /brass|gold|bronze|copper/i.test(set);
  for (const s of SEEDS) {
    const B = generate(s).bench;
    assert.ok(!(warm(B.frame.set) && warm(B.metal.set)), `${s} : bâti et métal tous deux en métal chaud`);
    assert.ok(new Set([B.frame.set, B.metal.set, B.arm.set, B.table.set]).size >= 3, `${s} : moins de trois matières`);
  }
  assert.ok(Object.keys(FINISHES).length > 40);
});

test('les lampes sont presque blanches (≥ 4 700 K), sauf la lampe de bureau du Cabinet', () => {
  for (const [k, M] of Object.entries(MOODS)) if (k !== 'cabinet') assert.ok(M.key.K >= 4700, `${k} : ${M.key.K} K`);
});

test('les humeurs diffèrent par le décor, la lumière et la valeur (pas seulement la teinte)', () => {
  const sig = (M) => `${M.decor}|${M.key.kind}|${Math.round(M.key.el * 2)}|${M.env}`;
  const sigs = Object.values(MOODS).map(sig);
  assert.equal(new Set(sigs).size, sigs.length);
  const decors = new Set(Object.values(MOODS).map((M) => M.decor));
  assert.equal(decors.size, Object.keys(MOODS).length);
  // au moins une humeur très claire, une très sombre, une en plein jour (soleil)
  const lum = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  assert.ok(Object.values(MOODS).some((M) => lum(M.bg) > 550));
  assert.ok(Object.values(MOODS).some((M) => lum(M.bg) < 40));
  assert.ok(Object.values(MOODS).some((M) => M.key.kind === 'sun'));
});

test('trois familles au moins, aux gestes distincts', () => {
  const ks = Object.keys(CATALOGUE);
  assert.ok(ks.length >= 3);
  assert.equal(new Set(ks.map((k) => FAMILIES[k].gesture)).size, ks.length);
});
