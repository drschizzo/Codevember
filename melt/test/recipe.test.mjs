// La recette : déterminisme, variété, direction artistique (400 graines).
//   node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, MOOD_KEYS, crystalSpec } from '../src/recipe.js';
import { FAMILIES, FAMILY_KEYS } from '../src/families.js';

const seeds = Array.from({ length: 400 }, (_, i) => `s${i}`);
const kelvinOf = (hex) => { const c = parseInt(hex.slice(1), 16); const r = c >> 16, b = c & 255; return b / r; };

test('déterministe, aller-retour JSON, mise à niveau sans effet', () => {
  for (const s of seeds.slice(0, 40)) {
    const a = generate(s), b = generate(s);
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    assert.deepEqual(upgrade(JSON.parse(JSON.stringify(a))), a);
  }
});

test('toutes les humeurs, familles et formes sont tirées', () => {
  const moods = new Set(), fams = new Set(), forms = new Set();
  for (const s of seeds) { const R = generate(s); moods.add(R.mood); fams.add(R.family); forms.add(`${R.family}/${R.form}`); }
  assert.deepEqual([...moods].sort(), [...MOOD_KEYS].sort());
  assert.deepEqual([...fams].sort(), [...FAMILY_KEYS].sort());
  for (const f of FAMILY_KEYS) for (const k of Object.keys(FAMILIES[f].forms)) assert.ok(forms.has(`${f}/${k}`), `${f}/${k}`);
});

test('humeurs : un décor chacune (support, cadrage, valeur différents)', () => {
  const kinds = new Set(MOOD_KEYS.map((k) => MOODS[k].sub.kind));
  assert.equal(kinds.size, MOOD_KEYS.length);
  // des valeurs étagées : une très sombre, des moyennes (la glace claire ne
  // se lit pas sur un fond blanc : pas de fond très clair)
  const lum = (hex) => { const c = parseInt(hex.slice(1), 16); return (0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255; };
  const L = MOOD_KEYS.map((k) => lum(MOODS[k].bg));
  assert.ok(Math.max(...L) > 0.15 && Math.min(...L) < 0.02 && new Set(L.map((l) => Math.round(l * 10))).size >= 3);
  // cadrages : du ras du support (< 25°) à la plongée (> 65° ; jamais tout à
  // fait de dessus : l'image y perd sa profondeur)
  const els = MOOD_KEYS.map((k) => MOODS[k].cam.el);
  assert.ok(Math.min(...els.map((e) => e[0])) < 25 && Math.max(...els.map((e) => e[1])) > 65 && Math.max(...els.map((e) => e[1])) < 80);
});

test('lampes presque blanches (le soleil d’hiver un peu chaud)', () => {
  for (const s of seeds) {
    const R = generate(s);
    assert.ok(kelvinOf(R.light.key.color) > 0.85, `${s} ciel ${R.light.key.color}`);
    assert.ok(kelvinOf(R.light.sun.color) > 0.75, `${s} soleil ${R.light.sun.color}`);
  }
});

test('le cristal tient dans le cadre et a une taille réelle', () => {
  for (const s of seeds) {
    const R = generate(s), sp = crystalSpec(R);
    assert.ok(sp.size >= 1.5 && sp.size <= 3.7, `${s} ${sp.size}`);
    assert.ok(R.camera.el >= 12 && R.camera.el <= 89);
    assert.ok(R.water.theta > R.water.thetaIce * 0.5);
  }
});
