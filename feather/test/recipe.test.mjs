// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'feather/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, kelvinToHex } from '../src/recipe.js';
import { FAMILIES, BIRDS } from '../src/families.js';
import { ENV_PRESETS } from '../src/gen/envmap.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque famille, chaque oiseau et chaque humeur sont tirés ; l’oiseau est de la famille', () => {
  const R = SEEDS.map((s) => generate(s));
  for (const k of Object.keys(FAMILIES)) assert.ok(R.some((r) => r.family === k), `famille jamais tirée : ${k}`);
  for (const k of Object.keys(BIRDS)) assert.ok(R.some((r) => r.bird === k), `oiseau jamais tiré : ${k}`);
  for (const k of Object.keys(MOODS)) assert.ok(R.some((r) => r.mood === k), `humeur jamais tirée : ${k}`);
  for (const r of R) assert.equal(BIRDS[r.bird].family, r.family);
  for (const M of Object.values(MOODS)) assert.ok(ENV_PRESETS[M.env], `studio inconnu : ${M.env}`);
});

test('des humeurs qui sont des décors : fond, lumière, valeur et cadrage différents', () => {
  const M = Object.values(MOODS);
  const values = M.map((m) => lum(m.bg[1]));
  assert.ok(Math.max(...values) > 0.5 && Math.min(...values) < 0.01, 'au moins une humeur très claire et une très sombre');
  // deux humeurs ne partagent pas à la fois la direction de la lampe, sa dureté et la valeur du fond
  for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) {
    const a = M[i], b = M[j];
    const same = Math.abs(a.key.az - b.key.az) < 0.4 && Math.abs(a.key.el - b.key.el) < 0.3 && Math.abs((a.key.soft ?? 0.5) - (b.key.soft ?? 0.5)) < 0.3 && Math.abs(lum(a.bg[1]) - lum(b.bg[1])) < 0.1;
    assert.ok(!same, `${a.label} et ${b.label} se ressemblent`);
  }
  // au moins un contre-jour vrai (la lampe derrière la plume)
  assert.ok(M.some((m) => m.key.az > 2.5));
});

test('lampes presque blanches (sauf la lanterne, une flamme)', () => {
  for (const [k, M] of Object.entries(MOODS)) for (const l of [M.key, M.rim, M.fill]) assert.ok(l.K >= (k === 'lanterne' ? 4000 : 4700), `${k} : ${l.K} K`);
  assert.equal(kelvinToHex(6600).length, 7);
});

test('l’objet tranche sur son fond : contraste de valeur entre la plume et le fond', () => {
  for (const s of SEEDS) {
    const R = generate(s);
    const f = lum(R.look.base), b = lum(R.bg.bottom), t = lum(R.bg.top);
    const c = Math.max(f, (b + t) / 2) / Math.max(1e-3, Math.min(f, (b + t) / 2));
    assert.ok(c > 1.6 || R.look.irid > 0.5 || R.family === 'ocelle', `${s} : ${R.bird} sur ${R.mood} (rapport ${c.toFixed(2)})`);
  }
});
