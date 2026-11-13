// Le panache simulé (vapeur et nuage : un seul fluide).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulatePlume, PLUME } from '../src/gen/plume.js';

const spec = { r0: 0.2, top: 1.7, puffs: 8, gamma: 22, heat: 5, mix: 0.2 };
const P = simulatePlume(spec);
const at = (f, i, j) => P.frames[i + P.NR * (j + P.NZ * f)] / 255;

test('déterminisme, valeurs finies, première image vide', () => {
  assert.deepEqual(simulatePlume(spec).frames, P.frames);
  for (let k = 0; k < P.NR * P.NZ; k++) assert.equal(P.frames[k], 0);
  assert.equal(P.NF, PLUME.NF);
  assert.ok(P.mass.every((m) => Number.isFinite(m)));
});

test('le panache monte : sa tête atteint le niveau de condensation en moins d’un tiers du film, puis le plafond', () => {
  const head = (f) => { let z = 0; for (let j = 0; j < P.NZ; j++) if (at(f, 0, j) > 0.3 || at(f, 2, j) > 0.3) z = (j + 1) * P.DX; return z; };
  let prev = 0;
  for (let f = 1; f < P.NF / 3; f++) { const h = head(f); assert.ok(h >= prev - 2 * P.DX, `la tête redescend à l'image ${f}`); prev = h; }
  assert.ok(head(Math.round(P.NF / 3)) > 1, 'la vapeur n’a pas atteint la base du nuage');
  assert.ok(head(P.NF - 1) > spec.top - 0.15);
});

test('le nuage EST la vapeur accumulée : la masse au-dessus du niveau de condensation ne fait que croître, et domine à la fin', () => {
  const above = (f) => { let m = 0; for (let j = Math.round(0.9 / P.DX); j < P.NZ; j++) for (let i = 0; i < P.NR; i++) m += at(f, i, j) ** 2 * (i + 0.5); return m; };
  const below = (f) => { let m = 0; for (let j = 0; j < Math.round(0.9 / P.DX); j++) for (let i = 0; i < P.NR; i++) m += at(f, i, j) ** 2 * (i + 0.5); return m; };
  let prev = 0;
  for (let f = 4; f < P.NF; f += 2) { const m = above(f); assert.ok(m >= prev * 0.97, `le nuage se vide à l'image ${f}`); prev = m; }
  assert.ok(above(P.NF - 1) > 6 * below(P.NF - 1), 'la colonne pèse encore autant que le nuage');
  // il s'étale : son rayon dépasse quatre fois celui de la source
  assert.ok(P.rMax > 4 * spec.r0);
});

test('la source faiblit à la fin : la colonne n’est plus qu’un filet quand le nuage est plein', () => {
  const stem = (f) => { let m = 0; for (let j = 6; j < 20; j++) m += at(f, 0, j) ** 2; return m / 14; };
  assert.ok(stem(P.NF - 1) < 0.45 * stem(Math.round(P.NF * 0.6)));
});
