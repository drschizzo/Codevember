// Direction artistique et catalogue (node --test) : humeurs différentes par le
// décor, la lumière et la valeur ; lampes presque blanches ; familles aux
// gestes distincts ; espèces complètes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS, MOOD_KEYS } from '../src/recipe.js';
import { FAMILIES, FAMILY_KEYS } from '../src/families.js';

const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

test('six décors : aucun n’a le même support, la même lumière et la même valeur', () => {
  const sig = MOOD_KEYS.map((k) => { const M = MOODS[k]; return [M.wood.pattern, M.key.kind, Math.round(M.key.el[0] * 2), lum(M.bg) > 0.4 ? 'clair' : lum(M.bg) > 0.08 ? 'moyen' : 'sombre'].join('|'); });
  assert.equal(new Set(sig).size, sig.length);
  const vals = MOOD_KEYS.map((k) => lum(MOODS[k].bg));
  assert.ok(vals.some((v) => v > 0.5), 'au moins un fond très clair');
  assert.ok(vals.some((v) => v < 0.02), 'au moins un fond très sombre');
  assert.ok(new Set(MOOD_KEYS.map((k) => MOODS[k].wood.pattern)).size >= 5, 'des supports différents');
});

test('lampes presque blanches (≥ 4700 K) ; la chaleur vient du bois et du fond', () => {
  for (const k of MOOD_KEYS) assert.ok(MOODS[k].key.K >= 4700, `${k} : ${MOODS[k].key.K} K`);
});

test('quatre familles aux gestes distincts, espèces complètes', () => {
  assert.equal(FAMILY_KEYS.length, 4);
  const gestures = new Set(FAMILY_KEYS.map((f) => FAMILIES[f].gesture));
  assert.equal(gestures.size, 4);
  const modes = new Set();
  for (const f of FAMILY_KEYS) for (const [k, sp] of Object.entries(FAMILIES[f].species)) {
    modes.add(sp.mode);
    for (const c of ['young', 'mid', 'ripe', 'net', 'stalk', 'hypo']) assert.match(sp.colors[c], /^#[0-9a-f]{6}$/i, `${k}.${c}`);
    assert.ok(sp.vein > 0 && sp.plasmodium);
    if (sp.mode !== 'net') assert.ok(sp.head && sp.stalk && sp.count[1] > sp.count[0]);
  }
  assert.ok(modes.size >= 4, 'grappes, touffes, perles le long des veines, réseau');
});

test('la variété : 400 graines tirent tous les décors, familles, réseaux et ordres', () => {
  const seen = { mood: new Set(), family: new Set(), net: new Set(), order: new Set(), species: new Set() };
  for (let i = 0; i < 400; i++) {
    const R = generate(`v${i}`);
    seen.mood.add(R.mood); seen.family.add(R.family); seen.net.add(R.plasmodium.net); seen.order.add(R.fruit.order); seen.species.add(`${R.family}.${R.species}`);
  }
  assert.equal(seen.mood.size, 6); assert.equal(seen.family.size, 4); assert.equal(seen.net.size, 4); assert.equal(seen.order.size, 4);
  assert.ok(seen.species.size >= 10);
});
