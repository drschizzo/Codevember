// Recette et direction artistique : node --test 'fold/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, kelvinToHex } from '../src/recipe.js';
import { SETS, FINISHES } from '../src/finishes.js';
import { PLANTS } from '../src/gen/plant.js';
import { CONTAINERS } from '../src/container.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque décor, chaque plante, chaque monture sont tirés', () => {
  const R = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(R.some((r) => r.mood === m), `décor jamais tiré : ${m}`);
  for (const k of Object.keys(PLANTS)) assert.ok(R.some((r) => r.plant.kind === k), `plante jamais tirée : ${k}`);
  // quatre manières de plier, à peu près à parts égales
  for (const f of ['sensitive', 'biophytum', 'oxalis', 'dionaea']) { const n = R.filter((r) => r.leaf.family === f).length; assert.ok(n > 60, `${f} : ${n} / 400`); }
  for (const c of Object.keys(CONTAINERS)) assert.ok(R.some((r) => r.container === c), `monture jamais tirée : ${c}`);
});

test('les matières citées existent', () => {
  for (const s of SEEDS.slice(0, 100)) {
    const D = generate(s).decor;
    for (const k of ['table', 'pot', 'base', 'stand', 'brass', 'coil']) {
      if (!D[k]) continue;
      assert.ok(SETS[D[k].set], `${s} : jeu inconnu ${D[k].set}`);
      for (const side of ['outer', 'inner', 'edge']) assert.ok(FINISHES[D[k][side].preset], `${s} : finition inconnue`);
    }
  }
});

test('des décors, pas des teintes : fond, lumière, valeur et cadrage diffèrent', () => {
  const M = Object.values(MOODS);
  // un fond peint par décor
  assert.equal(new Set(M.map((m) => m.backdrop)).size, M.length);
  // au moins deux décors clairs et deux sombres (lumière du fond)
  assert.ok(M.filter((m) => m.wall >= 0.9).length >= 2);
  assert.ok(M.filter((m) => m.wall <= 0.1).length >= 2);
  // pas deux décors avec la même lampe (élévation, azimut relatif) et la même valeur
  for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) {
    const a = M[i], b = M[j];
    const same = Math.abs(a.key.el[0] - b.key.el[0]) < 0.1 && Math.abs(a.key.az[0] - b.key.az[0]) < 0.3 && Math.abs(a.wall - b.wall) < 0.2 && a.table[0] === b.table[0];
    assert.ok(!same, `${a.label} et ${b.label} se ressemblent`);
  }
});

test('lampes presque blanches (≥ 4700 K)', () => {
  for (const m of Object.values(MOODS)) assert.ok(m.key.K >= 4700, m.label);
  // (une lampe de 4700 K est d'un blanc chaud, pas orange)
  const c = kelvinToHex(4700), r = parseInt(c.slice(1, 3), 16), b = parseInt(c.slice(5, 7), 16);
  assert.ok(b / r > 0.65);
});

test('une boucle : 2 à 4 touchers, au moins une goutte, la goutte vient du toit sous verre', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    assert.ok(R.events.length >= 2 && R.events.length <= 4);
    // le marteau, s'il y en a un, vient en dernier (le temps fort)
    const t = R.events.findIndex((e) => e.cause === 'tap');
    assert.ok(t < 0 || t === R.events.length - 1);
    assert.ok(R.events.some((e) => e.cause === 'drop'));
    const roof = R.container === 'cloche' || R.container === 'ward';
    for (const e of R.events) if (e.cause === 'drop') assert.equal(e.source, roof ? 'roof' : 'burette');
  }
});
