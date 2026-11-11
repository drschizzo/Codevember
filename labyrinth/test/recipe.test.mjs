// Invariants de la recette et de la direction artistique, sur 400 graines :
// node --test 'labyrinth/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, FAMILIES } from '../src/recipe.js';
import { FINISHES } from '../src/finishes.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);
const metalWarm = (f) => f.metal > 0.5 && /brass|gold|bronze|copper/i.test(f.preset ?? '');
const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (x / 255) ** 2.2); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur et chaque famille sont tirées ; les accords ne citent que des finitions existantes', () => {
  const R = SEEDS.map((s) => generate(s));
  for (const m of Object.keys(MOODS)) assert.ok(R.some((r) => r.mood === m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(R.some((r) => r.family === f), `famille jamais tirée : ${f}`);
  for (const [m, M] of Object.entries(MOODS)) for (const a of M.accords) for (const v of Object.values(a)) for (const k of [v].flat()) assert.ok(FINISHES[k], `${m} : finition inconnue ${k}`);
});

test('les lampes sont presque blanches (≥ 4700 K)', () => {
  for (const M of Object.values(MOODS)) assert.ok(M.keyK >= 4700);
});

test('direction artistique : l’or et le laiton restent un accent (jamais plateau et parois à la fois)', () => {
  for (const s of SEEDS) {
    const R = generate(s), F = R.finishes;
    assert.ok(!(metalWarm(F.board.outer) && metalWarm(F.walls.outer)), `${s} : plateau et parois en métal chaud`);
    assert.ok(!(metalWarm(F.walls.outer) && metalWarm(F.metal.outer) && metalWarm(F.ball.outer)), `${s} : tout en métal chaud`);
  }
});

test('au moins trois familles de matières par scène', () => {
  const fam = (f) => (f.metal > 0.5 ? 'métal' : f.pattern === 'wood' ? 'bois' : f.clearcoat > 0.7 && f.pattern !== 'marble' ? 'laque' : ['rock', 'marble'].includes(f.pattern) ? 'pierre' : f.pattern);
  for (const s of SEEDS.slice(0, 100)) {
    const F = generate(s).finishes;
    const kinds = new Set([F.board.outer, F.walls.outer, F.ball.outer, F.metal.outer, F.base.outer, F.support.outer].map(fam));
    assert.ok(kinds.size >= 3, `${s} : ${[...kinds]}`);
  }
});

test('la bille tranche sur son fond (valeur)', () => {
  for (const [m, M] of Object.entries(MOODS)) for (const a of M.accords) {
    const b = FINISHES[a.ball], f = FINISHES[a.board[0]];
    // un métal poli reflète le studio : il tranche sur un fond sombre ; sinon, contraste de luminance
    if (b.metal > 0.5) assert.ok(lum(f.color) < 0.2 || /Copper|Brass/.test(a.ball), `${m} : bille de métal sur fond clair`);
    else assert.ok(Math.abs(Math.log((lum(b.color) + 0.01) / (lum(f.color) + 0.01))) > 1.2, `${m} : la bille ne tranche pas (${a.ball} sur ${a.board[0]})`);
  }
});

test('les humeurs diffèrent par le décor, la lumière et la valeur, pas seulement la teinte', () => {
  const M = Object.values(MOODS);
  const sig = (m) => `${m.env}|${lum(m.bg) > 0.3 ? 'clair' : lum(m.bg) > 0.04 ? 'moyen' : 'sombre'}|${m.style}|${m.key.el[0] > 0.7 ? 'haut' : m.key.el[0] > 0.4 ? 'mi' : 'ras'}`;
  assert.equal(new Set(M.map(sig)).size, M.length);
  const vals = new Set(M.map((m) => (lum(m.bg) > 0.3 ? 'clair' : lum(m.bg) > 0.04 ? 'moyen' : 'sombre')));
  assert.equal(vals.size, 3, 'au moins une humeur claire, une moyenne, une sombre');
});
