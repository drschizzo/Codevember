// Recette et direction artistique, sur 400 graines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES, CABLES } from '../src/recipe.js';
import { FINISHES } from '../../shared/finishes.js';
import { FLOORS } from '../src/floors.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);
const WARM = new Set(['polishedBrass', 'brushedBrass', 'polishedCopper', 'bronzeDark', 'polishedGold', 'hammeredGold']);
const family = (k) => (FINISHES[k].metal ? (WARM.has(k) ? 'métal chaud' : 'métal froid') : k.startsWith('carbon') ? 'composite' : 'céramique');

test('déterministe, JSON pur, upgrade sans effet sur une recette à jour', () => {
  for (const s of SEEDS.slice(0, 40)) {
    const a = generate(s), b = generate(s);
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
    assert.deepEqual(upgrade(JSON.parse(JSON.stringify(a))), a);
  }
});

test('toutes les humeurs et toutes les familles sont tirées', () => {
  const moods = new Set(), fams = new Set();
  for (const s of SEEDS) { const R = generate(s); moods.add(R.mood); fams.add(R.family); }
  assert.deepEqual([...moods].sort(), Object.keys(MOODS).sort());
  assert.deepEqual([...fams].sort(), Object.keys(FAMILIES).sort());
});

test('accords : des finitions existantes, au moins trois familles de matières, le métal chaud en accent', () => {
  for (const [k, M] of Object.entries(MOODS)) {
    assert.ok(FLOORS[M.floor], `${k} : sol inconnu`);
    for (const [tube, ferrule, fitting, cable, winch] of M.accords) {
      for (const f of [tube, ferrule, fitting, winch]) assert.ok(FINISHES[f], `${k} : finition inconnue ${f}`);
      assert.ok(CABLES[cable], `${k} : câble inconnu ${cable}`);
      // le tube (la plus grande surface de la sculpture) n'est pas en métal chaud, sauf exception assumée
      const fams = new Set([family(tube), family(ferrule), family(fitting), family(winch), CABLES[cable].metal ? 'métal froid' : 'textile']);
      assert.ok(fams.size >= 3, `${k} : ${[...fams]}`);
    }
  }
  // sur 400 graines : au plus un quart des sculptures ont un tube en métal chaud
  let warm = 0;
  for (const s of SEEDS) if (WARM.has(generate(s).mats.strut.outer.preset)) warm++;
  assert.ok(warm / SEEDS.length <= 0.25, `tubes en métal chaud : ${warm}`);
});

test('une seule couleur d’accent : corde colorée ⇒ pas d’anodisation colorée', () => {
  for (const s of SEEDS) {
    const R = generate(s), C = CABLES[R.mats.cable];
    const anod = [R.mats.strut, R.mats.winch].flatMap((m) => [m.outer, m.inner, m.edge]).filter((f) => f.preset?.startsWith('anodized'));
    if (C.accent) for (const f of anod) assert.equal(f.color, '#3b3f48', `${s} : deux accents`);
  }
});

test('lampes presque blanches (≥ 4 700 K), lumière et cadrage propres à chaque humeur', () => {
  const sig = new Set();
  for (const [k, M] of Object.entries(MOODS)) {
    assert.ok(M.key.K >= 4700, `${k} : lampe trop chaude`);
    sig.add([M.floor, M.key.el.toFixed(1), Math.sign(Math.cos(M.key.az)), M.bg].join('|'));
  }
  assert.equal(sig.size, Object.keys(MOODS).length, 'deux humeurs ont le même décor et la même lumière');
});

test('valeurs : au moins une humeur très claire, une très sombre, une en plein jour', () => {
  const lum = (h) => { const c = parseInt(h.slice(1), 16); return (0.2126 * (c >> 16) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255; };
  const L = Object.values(MOODS).map((M) => lum(M.bg));
  assert.ok(L.some((v) => v > 0.8), 'pas d’humeur claire');
  assert.ok(L.filter((v) => v < 0.05).length >= 2, 'pas assez d’humeurs sombres');
  assert.ok(MOODS.midi.env === 'clearsky');
});
