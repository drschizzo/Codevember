// Invariants de la recette et de la direction artistique, vérifiés sans
// navigateur : node --test 'pendulum/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, upgrade, MOODS, finishesUsed } from '../src/recipe.js';
import { FINISHES } from '../src/finishes.js';
import { FAMILIES } from '../src/gen/machines.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => `t${i}`);

test('une graine donne toujours la même recette', () => {
  for (const s of SEEDS.slice(0, 50)) assert.deepEqual(generate(s), generate(s));
});

test('la recette est du JSON pur (partage par lien)', () => {
  const R = generate('json');
  assert.deepEqual(JSON.parse(JSON.stringify(R)), R);
  assert.deepEqual(upgrade(JSON.parse(JSON.stringify(R))), R);
});

test('chaque humeur et chaque famille sont tirées ; les finitions citées existent', () => {
  const moods = new Set(SEEDS.map((s) => generate(s).mood)), fams = new Set(SEEDS.map((s) => generate(s).family));
  for (const m of Object.keys(MOODS)) assert.ok(moods.has(m), `humeur jamais tirée : ${m}`);
  for (const f of Object.keys(FAMILIES)) assert.ok(fams.has(f), `famille jamais tirée : ${f}`);
  assert.deepEqual(finishesUsed(), []);
});

test('la suite d’équilibres part de la chaîne pendante, passe par le tout-debout, revient', () => {
  for (const s of SEEDS) {
    const R = generate(s), n = R.machine.links.length, seq = R.film.seq;
    assert.equal(seq[0], 'D'.repeat(n));
    assert.ok(seq.includes('U'.repeat(n)), `${s} : jamais debout`);
    // (un équilibre ne revient que par un grand tour, d'une tenue à la suivante)
    seq.forEach((c, i) => { if (i && c === seq[i - 1]) assert.ok(R.film.moves[i - 1].turn, `${s} : équilibre répété sans tour`); });
    assert.ok(new Set(seq).size >= seq.length - 1);
    assert.equal(R.film.moves.length, seq.length);
    assert.equal(R.film.holds.length, seq.length);
    // le ralenti est sur la manœuvre qui arrive au tout-debout, et seulement elle
    const top = seq.lastIndexOf('U'.repeat(n));
    R.film.moves.forEach((m, i) => assert.equal(!!m.slow, (i + 1) % seq.length === top, `${s} : ralenti ${i}`));
  }
});

// familles de matières (métal chaud, métal froid, bois, peinture / laque, minéral, textile)
const famOf = (k) => {
  const F = FINISHES[k];
  if (F.metal > 0.5) return /Brass|Gold|Copper|bronze/i.test(k) ? 'warm' : 'cold';
  if (F.pattern === 'wood' || F.pattern === 'parquet') return 'wood';
  if (F.pattern === 'velvet' || F.pattern === 'leather') return 'textile';
  if (['concrete', 'plaster', 'earth', 'rock', 'marble'].includes(F.pattern)) return 'mineral';
  return 'paint';
};

test('direction artistique : accords composés (trois familles au moins, l’or en accent)', () => {
  for (const [m, M] of Object.entries(MOODS)) for (const A of M.accords) {
    const fams = new Set([...Object.values(A), M.wall, M.floor].map(famOf));
    assert.ok(fams.size >= 3, `${m} : ${[...fams]}`);
    // pas de métal chaud à la fois sur le socle, le bâti et les maillons
    const warm = ['base', 'frame', 'link'].filter((r) => famOf(A[r]) === 'warm');
    assert.ok(warm.length <= 1 || (warm.length === 2 && !warm.includes('base')), `${m} : trop d'or ${warm}`);
    // les maillons (le sujet) tranchent sur le bâti
    assert.notEqual(A.link, A.frame, `${m} : maillons comme le bâti`);
  }
});

test('lampes presque blanches (sauf le soleil) et humeurs contrastées', () => {
  const hexK = (h) => { const r = parseInt(h.slice(1, 3), 16), b = parseInt(h.slice(5, 7), 16); return b / r; };
  for (const s of SEEDS.slice(0, 100)) {
    const R = generate(s);
    assert.ok(hexK(R.light.key.color) > 0.7, `${s} : lampe trop chaude ${R.light.key.color}`);
  }
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const bgs = Object.values(MOODS).map((M) => lum(M.bg));
  assert.ok(bgs.some((v) => v > 0.6), 'au moins une humeur claire');
  assert.ok(bgs.filter((v) => v < 0.05).length >= 2, 'au moins deux humeurs sombres');
});
