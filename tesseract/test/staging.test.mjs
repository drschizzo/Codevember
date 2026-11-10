// Mise en lumière : dosage, étalonnage, portes en iris, enfilade,
// décalages du rendu accumulé (node --test tesseract/test). Modules purs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, MOODS } from '../src/recipe.js';
import { FINISHES } from '../src/finishes.js';
import { roomGain, heroGain } from '../src/scene/dose.js';
import { jitter } from '../src/rng.js';
import { voyageDoors } from '../src/scene/reveal.js';
import { stepOrientations, innerCell, cellTransforms } from '../src/math4.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => `ms${i}`);
const lining = (k) => ({ panel: { inner: FINISHES[k] } });

test('dosage : une pièce claire reçoit moins qu’une sombre, sans jamais sortir de la plage', () => {
  assert.ok(roomGain(lining('marble')) < roomGain(lining('pearlPaint')));
  assert.ok(roomGain(lining('pearlPaint')) < roomGain(lining('lacquerMatte')));
  assert.ok(roomGain(lining('lacquerMatte')) <= roomGain(lining('marbleNoir')));
  for (const k of Object.keys(FINISHES)) { const g = roomGain(lining(k)); assert.ok(g >= 0.22 && g <= 2.5, `${k} : ${g}`); }
  const obj = (k, type = 'pearl') => ({ type, finish: { outer: FINISHES[k] } });
  assert.ok(heroGain(obj('nacre')) < 1 && heroGain(obj('obsidian')) > 1);
  assert.equal(heroGain(obj('polishedGold')), 1);
  assert.equal(heroGain(obj('crystal')), 1);
  for (const seed of SEEDS.slice(0, 40)) for (const c of generate(seed).cells) {
    assert.ok(Number.isFinite(roomGain(c)) && Number.isFinite(heroGain(c.content)));
  }
});

test('étalonnage : chaque humeur a sa signature, discrète', () => {
  for (const [k, M] of Object.entries(MOODS)) {
    const g = M.grade;
    assert.ok(g, `${k} : pas d'étalonnage`);
    assert.ok(g.contrast > 0.9 && g.contrast < 1.15 && g.saturation > 0.8 && g.saturation < 1.2, k);
    for (const t of [...g.shadows, ...g.highlights]) assert.ok(t > 0.85 && t < 1.2, `${k} : teinte ${t}`);
    assert.deepEqual(generate('x', { mood: k }).grade, g);
  }
});

test('portes : un iris par paroi franchie, plus petit que la paroi ; quatre pour l’enfilade d’un tour en ligne droite', () => {
  let straight = 0;
  for (const seed of SEEDS) {
    const R = generate(seed), Q = stepOrientations(R.moves), n = R.moves.length;
    const rooms = Q.map(innerCell), frames = rooms.slice(1).map((cell) => ({ cell }));
    frames.rooms = rooms;
    const at = (phase, room, f) => {
      const T = cellTransforms({ theta: new Array(8).fill(0), move: null, turn: 0, Q: Q[Math.min(room, n)] }, R.net.parent);
      return voyageDoors({ phase, room, f }, R, frames, T, 2, 1);
    };
    const check = (D) => {
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      assert.ok(Math.abs(dot(D.n, D.n) - 1) < 1e-9 && Math.abs(dot(D.u, D.u) - 1) < 1e-9 && Math.abs(dot(D.v, D.v) - 1) < 1e-9);
      assert.ok(Math.abs(dot(D.n, D.u)) < 1e-9 && Math.abs(dot(D.n, D.v)) < 1e-9 && Math.abs(dot(D.u, D.v)) < 1e-9);
      assert.ok(D.r > 0 && Number.isFinite(D.r) && D.p.every(Number.isFinite));
    };
    // milieu d'une halte : aucune porte ; fin : celle d'après s'ouvre ; début : celle d'avant se ferme
    assert.deepEqual(at('dwell', 1, 0.4).filter(Boolean), []);
    const end = at('dwell', 1, 0.9), start = at('dwell', 1, 0.1);
    assert.ok(!end[0] && end[1] && start[0] && !start[1]);
    check(end[1]); check(start[0]);
    const through = at('travel', 1, 0.5);
    assert.ok(through[1].open === 1 && through[1].spin === 0 && through[1].r < through[1].half);
    // enfilade : à la dernière halte d'un tour en ligne droite
    const line = n === 4 && rooms[2] === (rooms[0] ^ 1) && rooms[3] === (rooms[1] ^ 1);
    const last = at('dwell', n, 0.5).filter(Boolean);
    if (line) { straight++; assert.equal(last.length, 4, seed); last.forEach(check); } else assert.ok(last.length <= 1, seed);
    assert.deepEqual(at('dwell', n, 0.97).filter(Boolean), [], `${seed} : tout est refermé avant la remontée`);
  }
  assert.ok(straight > SEEDS.length / 5, `tours en ligne droite : ${straight}`);
});

test('rendu accumulé : des décalages bornés, bien répartis, propres à chaque image', () => {
  const n = 32, S = Array.from({ length: n }, (_, i) => jitter(i, 3));
  for (const s of S) {
    assert.ok(Math.abs(s.time) <= 0.5 && Math.abs(s.pixel[0]) <= 0.5 && Math.abs(s.pixel[1]) <= 0.5);
    assert.ok(Math.hypot(...s.lens) <= 1 + 1e-9 && Math.hypot(...s.light) <= 1 + 1e-9);
  }
  const mean = (f) => S.reduce((a, s) => a + f(s), 0) / n;
  assert.ok(Math.abs(mean((s) => s.time)) < 0.06 && Math.abs(mean((s) => s.lens[0])) < 0.12 && Math.abs(mean((s) => s.pixel[0])) < 0.06);
  assert.notDeepEqual(jitter(0, 1), jitter(0, 2));
  assert.deepEqual(jitter(5, 9), jitter(5, 9));
});
