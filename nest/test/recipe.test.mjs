// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'nest/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, VILLAGES, FAMILIES } from '../src/recipe.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);
const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const sat = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return (Math.max(...c) - Math.min(...c)) / Math.max(1, Math.max(...c)); };

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque famille et chaque village sont tirés', () => {
  const Rs = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(Rs.some((R) => R.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(Rs.some((R) => R.family === f), `famille jamais tirée : ${f}`);
  for (const v of Object.keys(VILLAGES)) assert.ok(Rs.some((R) => R.village === v), `village jamais tiré : ${v}`);
  for (const [m, M] of Object.entries(MOODS)) {
    for (const v of M.villages) assert.ok(VILLAGES[v], `${m} : village inconnu ${v}`);
    for (const [f] of M.families) assert.ok(FAMILIES[f], `${m} : famille inconnue ${f}`);
  }
});

test('direction artistique : le papier est d’abord du bois, la peinture en accent', () => {
  // (la liberté de la scène : les volets peints du village ; mais un nid de
  // guêpe reste gris et beige — la peinture pèse moins d'un tiers des charges)
  for (const [k, V] of Object.entries(VILLAGES)) {
    const tot = V.sources.reduce((a, [, w]) => a + w, 0);
    const paint = V.sources.filter(([c]) => sat(c) > 0.3).reduce((a, [, w]) => a + w, 0);
    assert.ok(paint / tot < 0.34, `${k} : peinture ${(paint / tot).toFixed(2)}`);
    assert.ok(sat(V.sources[V.paint][0]) > 0.3, `${k} : la couleur du temps fort n'est pas une peinture`);
    // contraste de valeur entre les bandes (c'est lui qui fait le rayé)
    const L = V.sources.map(([c]) => lum(c));
    assert.ok(Math.max(...L) / Math.min(...L) > 3, `${k} : bandes sans contraste`);
  }
});

test('direction artistique : des lampes presque blanches, sauf la lampe de porche (nuit)', () => {
  for (const [m, M] of Object.entries(MOODS)) if (m !== 'nuit') assert.ok(M.keyK >= 4700, `${m} : ${M.keyK} K`);
});

test('variété : six humeurs, six décors (fond, support, lumière ou valeur différents)', () => {
  const sig = (M) => [M.decor.support, M.decor.outdoor ? 'dehors' : 'dedans', Math.round(lum(M.bg) * 4), M.key.gobo, Math.round(M.key.el * 2)].join('|');
  const sigs = Object.values(MOODS).map(sig);
  assert.equal(new Set(sigs).size, sigs.length, sigs.join(' / '));
  assert.ok(Object.values(MOODS).some((M) => lum(M.bg) > 0.5), 'une humeur claire');
  assert.ok(Object.values(MOODS).some((M) => lum(M.bg) < 0.03), 'une humeur sombre');
});
