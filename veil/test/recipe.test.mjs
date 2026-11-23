// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'veil/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, VEIL_COLORS, LACES, lum } from '../src/recipe.js';
import { FINISHES } from '../../shared/finishes.js';
import { FORMS, PLINTHS } from '../src/gen/forms.js';
import { buildTimeline, descDuration, riseDuration } from '../src/timeline.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur, chaque dentelle, chaque fil, chaque forme et chaque socle sont tirés', () => {
  const Rs = SEEDS.map((s) => generate(s));
  const has = (set, key, what) => assert.ok(set.has(key), `${what} jamais tiré : ${key}`);
  const moods = new Set(Rs.map((R) => R.mood)), laces = new Set(Rs.map((R) => R.veil.lace.kind)), fils = new Set(Rs.map((R) => R.veil.colorKey));
  assert.ok(Rs.every((R) => R.fabric === 'dentelle'), 'le voile est toujours une dentelle');
  assert.ok(Rs.some((R) => R.veil.lace.color2 !== R.veil.color) && Rs.some((R) => R.veil.lace.color2 === R.veil.color), 'dentelles à un fil et à deux fils');
  const forms = new Set(Rs.flatMap((R) => R.forms.map((f) => f.kind))), plinths = new Set(Rs.map((R) => R.plinth.kind));
  for (const k of Object.keys(MOODS)) has(moods, k, 'humeur');
  for (const k of Object.keys(LACES)) has(laces, k, 'dentelle');
  for (const k of Object.keys(VEIL_COLORS)) has(fils, k, 'fil');
  for (const k of ['bust', 'cat', 'teapot', 'amphora', 'chair', 'blocks', 'lyre']) has(forms, k, 'forme'); // (cheval, amants, muse, mains et nature morte : au panneau seulement)
  for (const k of Object.keys(PLINTHS)) has(plinths, k, 'socle');
  for (const M of Object.values(MOODS)) for (const k of ['floor', 'plinthFinish']) assert.ok(FINISHES[M[k].base], `${M.label} : finition ${M[k].base}`);
});

test('une suite de formes ne répète jamais une forme', () => {
  for (const s of SEEDS) {
    const k = generate(s).forms.map((f) => f.kind);
    assert.equal(new Set(k).size, k.length, `${s} : ${k}`);
    assert.ok(k.length >= 2 && k.length <= 4);
  }
});

test('le voile tranche sur son fond (écart de luminance ≥ 0,25)', () => {
  let low = 0;
  for (const s of SEEDS) {
    const R = generate(s);
    const g = Math.abs(lum(R.veil.color) - lum(R.bg.color));
    if (g < 0.25) low++;
    assert.ok(VEIL_COLORS[R.veil.colorKey], `${s} : couleur inconnue`);
    assert.ok(Math.abs(lum(R.veil.lace.color2) - lum(R.bg.color)) >= 0.25 || R.veil.lace.color2 === R.veil.color, `${s} : le fil du motif se fond dans le fond`);
    assert.ok(Number.isInteger(R.veil.lace.scallops) && R.veil.L / R.veil.lace.scallops > 0.03 && R.veil.L / R.veil.lace.scallops < 0.052, `${s} : festons`);
  }
  assert.ok(low <= 4, `${low} graines sur 400 où le voile se fond dans le fond`);
});

test('la durée de la boucle est la somme des morceaux du film', () => {
  for (const s of SEEDS.slice(0, 100)) {
    const R = generate(s), TL = buildTimeline(R);
    const T = R.forms.length * (descDuration(R.timing.desc) + riseDuration(R.timing.rise));
    assert.ok(Math.abs(TL.total - T) < 1e-9);
    assert.ok(Math.abs(R.loop.duration - T) < 0.006);
    assert.ok(T >= 18 && T <= 60, `${s} : boucle de ${T} s`);
  }
});

test('les lampes restent presque blanches (≥ 4700 K)', () => {
  for (const s of SEEDS.slice(0, 100)) {
    const c = generate(s).light.color;
    const r = parseInt(c.slice(1, 3), 16), b = parseInt(c.slice(5, 7), 16);
    assert.ok(b / r > 0.82, `${s} : lampe trop chaude ${c}`);
  }
});
