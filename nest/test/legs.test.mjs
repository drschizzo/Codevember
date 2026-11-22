// L'appui des pattes (src/legs.js) : le bout de chaque tarse rejoint le papier
// sous lui, sur un plan plus bas ou plus haut que la pose de repos et sur une
// surface bombée, à toutes les phases du pas (pose d'appui).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legLifts, legTip, legAngles, qrot } from '../src/legs.js';
import { frameQuat } from '../src/flight.js';

const tipsAt = (st, L) => [0, 1, 2, 3, 4, 5].map((c) => {
  const t = legTip(c, legAngles(c, st.pose, 0, L[c], true));
  const w = qrot(st.q, t.map((x) => x * st.s));
  return w.map((x, i) => x + st.p[i]);
});

test('sans correction, les tarses sont au niveau de l’appui (y ≈ −0,026)', () => {
  const st = { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1, pose: [0, 0, 0, 1] };
  for (const t of tipsAt(st, [0, 0, 0, 0, 0, 0])) assert.ok(Math.abs(t[1] + 0.026) < 0.004, `tarse à y = ${t[1].toFixed(4)}`);
});

for (const h of [-0.034, -0.02]) test(`plan à ${h} : chaque tarse le touche, à toutes les phases`, () => {
  for (let g = 0; g < 12; g++) {
    const st = { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1, pose: [(g / 12) * 2 * Math.PI, 0, 0, 1] };
    const L = legLifts(st, [0, 1, 0], () => h);
    for (const t of tipsAt(st, L)) assert.ok(Math.abs(t[1] - h) < 4e-4, `tarse à ${t[1].toFixed(4)} pour ${h}`);
  }
});

test('surface bombée, guêpe penchée : les tarses sur la sphère', () => {
  const R = 0.3, n = [0.3, 0.9, 0.2].map((x, _, a) => x / Math.hypot(...a));
  const p = n.map((x) => x * (R + 0.025));
  const st = { p, q: frameQuat([n[1], -n[0], 0], n), s: 1, pose: [1.1, 0, 0, 1] };
  // (hauteur le long de n, depuis p, de la sphère sous le point x)
  const height = (x) => {
    const d = x.map((v, i) => v - p[i]), a = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    const lat = d.map((v, i) => v - n[i] * a), l2 = lat[0] ** 2 + lat[1] ** 2 + lat[2] ** 2;
    return Math.sqrt(R * R - l2) - (R + 0.025);
  };
  const L = legLifts(st, n, height);
  for (const t of tipsAt(st, L)) assert.ok(Math.abs(Math.hypot(...t) - R) < 6e-4, `tarse à ${(Math.hypot(...t) - R).toFixed(5)} de la sphère`);
});

import { legReach, packLeg, unpackLeg } from '../src/legs.js';
test('une patte au-dessus du vide atteint un point de papier voisin (hanche + fémur)', () => {
  const st = { p: [0, 0, 0], q: [0, 0, 0, 1], s: 1, pose: [0.7, 0, 0, 1] };
  for (let c = 0; c < 6; c++) {
    // (un point que la hanche et le fémur peuvent atteindre : la patte portée
    // en avant ou en arrière, abaissée vers un bord)
    const target = legTip(c, legAngles(c, st.pose, 0, -0.35 + 0.1 * c, true, 0.3 - 0.12 * c));
    const r = legReach(st, c, target);
    assert.ok(r, `patte ${c} : hors de portée`);
    const t = legTip(c, legAngles(c, st.pose, 0, r[0], true, r[1]));
    assert.ok(Math.hypot(...t.map((x, i) => x - target[i])) < 0.0002, `patte ${c} : à ${(Math.hypot(...t.map((x, i) => x - target[i])) * 100).toFixed(2)} mm`);
  }
});
test('les deux corrections tiennent dans un flottant', () => {
  for (const [l, y] of [[0, 0], [-1.1, 0.6], [1.05, -0.6], [0.3, -0.017]]) {
    const [l2, y2] = unpackLeg(Math.fround(packLeg(l, y)));
    assert.ok(Math.abs(l2 - l) < 2e-3 && Math.abs(y2 - y) < 1.5e-3, `${l}, ${y} → ${l2}, ${y2}`);
  }
});
