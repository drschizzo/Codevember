// Invariants de la recette et de la direction artistique, sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES, EDGES, pathIsValid, hatIsValid } from '../src/recipe.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => `t${i}`);
const ALL = SEEDS.map((s) => generate(s));
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 40)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille et chaque dessin d’arête sont tirés', () => {
  for (const m of Object.keys(MOODS)) assert.ok(ALL.some((R) => R.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(ALL.some((R) => R.family === f), `famille jamais tirée : ${f}`);
  for (const e of Object.keys(EDGES)) assert.ok(ALL.some((R) => R.comb.lobes.some((l) => l.tiling.edges === e)), `arêtes jamais tirées : ${e}`);
});

test('chaque cadre a son motif : jamais deux fois la même famille avec les mêmes arêtes, et trois familles pour trois cadres', () => {
  for (const R of ALL) {
    const keys = R.comb.lobes.map((l) => `${l.tiling.family}/${l.tiling.edges}`);
    assert.equal(new Set(keys).size, keys.length, `${R.seed} : ${keys}`);
    if (keys.length >= 3) assert.equal(new Set(R.comb.lobes.slice(0, 3).map((l) => l.tiling.family)).size, 3, R.seed);
    assert.equal(R.comb.lobes[0].tiling.family, R.family);
    assert.equal(R.comb.lobes.filter((l) => l.tiling.family === 'chapeau').length, 1, `${R.seed} : un chapeau et un seul par scène`);
  }
});

test('le chemin de chaque pavage garde l’alvéole simple, et passe par deux portes différentes (le relais)', () => {
  for (const R of ALL.slice(0, 120)) for (const l of R.comb.lobes) {
    const T = l.tiling;
    if (T.group === 'hat') { assert.ok(hatIsValid(T.loop), `${R.seed} : chapeau non simple`); assert.equal(T.wave, 0); continue; }
    assert.ok(pathIsValid(T.group, T.path, T.profiles, T.amp, 60), `${R.seed} : alvéole non simple`);
    assert.equal(T.path.legs.length, 2);
    assert.notEqual(T.path.legs[0].a, T.path.legs[0].b);
    assert.deepEqual([T.path.legs[1].a, T.path.legs[1].b], [T.path.legs[0].b, T.path.legs[0].a]);
    for (const g of T.path.legs) assert.ok(Math.abs(g.q[0] + g.q[1] + g.q[2] - 1) < 0.01 && Math.min(...g.q) > 0.05, `${R.seed} : point de contrôle hors de la face`);
  }
});

test('les arêtes dessinées restent le plus souvent entières (peu de pavages adoucis)', () => {
  let n = 0, soft = 0;
  for (const R of ALL) for (const l of R.comb.lobes) { n++; if (l.tiling.amp < 0.6) soft++; }
  assert.ok(soft / n < 0.15, `${soft} / ${n} pavages adoucis de plus de 40 %`);
});

test('direction artistique : la cire est plus claire que le miel, le miel profond plus sombre que le miel', () => {
  for (const [k, M] of Object.entries(MOODS)) {
    assert.ok(lum(M.wax) > lum(M.honey) * 1.5, `${k} : cire trop proche du miel`);
    assert.ok(lum(M.honey) > lum(M.honeyDeep) * 2, `${k} : miel sans profondeur`);
    assert.ok(lum(M.cap) >= lum(M.wax) * 0.95, `${k} : opercules plus sombres que la cire`);
  }
});

test('direction artistique : des valeurs de fond contrastées (une claire, une sombre), et pas deux fonds voisins', () => {
  const L = Object.values(MOODS).map((M) => lum(M.bg));
  assert.ok(Math.max(...L) > 0.6 && Math.min(...L) < 0.02);
  const keys = Object.values(MOODS).map((M) => `${M.env}|${M.bg}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('lampes presque blanches (≥ 5000 K)', () => {
  for (const [k, M] of Object.entries(MOODS)) assert.ok(M.key.K >= 5000, k);
});

test('caméra : le gros plan est pris de biais, jamais de face', () => {
  for (const R of ALL) assert.ok(Math.hypot(R.camera.rake[0], R.camera.rake[1]) > 0.3, R.seed);
});
