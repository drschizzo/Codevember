// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'erosion/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, SANDS, STRATA, specOf } from '../src/recipe.js';
import { FAMILIES, MAX_LAYERS } from '../src/gen/table.js';
import { ENV_PRESETS } from '../src/gen/envmap.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille, chaque sable et chaque stratigraphie sont tirés', () => {
  const R = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(R.some((r) => r.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(R.some((r) => r.family === f), `famille jamais tirée : ${f}`);
  for (const k of Object.keys(SANDS)) assert.ok(R.some((r) => r.sand.key === k), `sable jamais tiré : ${k}`);
  for (const k of ['fines', 'corniches', 'chapeau']) assert.ok(R.some((r) => r.strataKind === k), `stratigraphie jamais tirée : ${k}`);
  for (const k of Object.keys(STRATA)) assert.ok(STRATA[k].label);
});

test('les strates : au plus 12 couches, profondeurs croissantes, duretés bornées', () => {
  for (const s of SEEDS) {
    const L = generate(s).strata;
    assert.ok(L.length >= 2 && L.length <= MAX_LAYERS, `${s} : ${L.length} couches`);
    for (let k = 1; k < L.length; k++) assert.ok(L[k].bottom > L[k - 1].bottom, `${s} : couche ${k}`);
    for (const c of L) assert.ok(c.hard >= 0 && c.hard <= 0.9);
  }
});

test('chaque humeur a son studio, et la spécification de simulation est complète', () => {
  for (const [m, M] of Object.entries(MOODS)) assert.ok(ENV_PRESETS[M.env], `${m} : studio inconnu ${M.env}`);
  for (const s of SEEDS.slice(0, 80)) {
    const S = specOf(generate(s));
    assert.ok(S.T > 10 && S.T < 40 && S.morfac >= 10 && S.base.length >= 2 && S.form.kind);
  }
});

test('direction artistique : lampes presque blanches (le soleil couchant excepté)', () => {
  for (const [m, M] of Object.entries(MOODS)) {
    assert.ok(M.key.K >= 4200, `${m} : lampe trop chaude (${M.key.K} K)`);
    if (m !== 'finDeJour') assert.ok(M.key.K >= 4700, `${m} : lampe trop chaude (${M.key.K} K)`);
  }
});

test('direction artistique : les humeurs diffèrent par le décor, la lumière et la valeur', () => {
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const M = Object.values(MOODS);
  // au moins une très claire, une très sombre
  assert.ok(M.some((m) => lum(m.bg) > 0.8), 'aucune humeur très claire');
  assert.ok(M.some((m) => lum(m.bg) < 0.05), 'aucune humeur très sombre');
  // deux humeurs ne partagent jamais à la fois le studio, la direction de la lampe et la valeur du fond
  const sig = (m) => `${m.env}|${Math.round(m.key.el * 4)}|${Math.round(m.key.az * 2)}|${Math.round(lum(m.bg) * 4)}`;
  assert.equal(new Set(M.map(sig)).size, M.length);
  // au moins trois directions de lumière : rasante, haute, contre-jour
  assert.ok(M.some((m) => m.key.el < 0.3) && M.some((m) => m.key.el > 0.9) && M.every((m) => m.key.el < 1.0) && M.some((m) => Math.cos(m.key.az) < -0.9 && m.key.el < 0.5));
});

test('les familles ont des gestes distincts (source, pluie, niveau de base, forme)', () => {
  const S = Object.keys(FAMILIES).map((f) => specOf(generate('g', { family: f })));
  const sig = (s) => [s.form.kind, !!s.rain, (s.inflow ?? []).length, s.base.length].join('|');
  assert.equal(new Set(S.map(sig)).size, S.length);
});
