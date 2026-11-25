// Le chapeau : substitution par métatuiles, coefficients (A, B), famille continue Tile(a, b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hatPatch, hatParams, hatTile, hatShape, HAT_EDGES, NE } from '../src/gen/hat.js';
import { isSimple, area } from '../src/gen/tiling.js';
import { bakeTiling, bakeHatInstances } from '../src/gen/bake.js';

const inside = (P, x, y) => { let c = false; const n = P.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = P[2 * i], yi = P[2 * i + 1], xj = P[2 * j], yj = P[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const LOOP = { r0: 0.03, dr: 0.5, dphi: 0.22 };
const H3 = hatPatch(3);
// couverture d'un disque au milieu du pavage : nombre de points couverts 0 fois, et plus d'une fois
function coverage(P, R = 9, N = 500) {
  const polys = H3.tiles.map((T) => hatTile(T, P.a, P.b));
  let cx = 0, cy = 0; for (const Q of polys) { cx += Q[0]; cy += Q[1]; } cx /= polys.length; cy /= polys.length;
  let s = 17; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let hole = 0, over = 0;
  for (let i = 0; i < N; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    let c = 0; for (const Q of polys) { if (Math.abs(Q[0] - x) > 6 || Math.abs(Q[1] - y) > 6) continue; if (inside(Q, x, y)) c++; }
    if (c === 0) hole++; if (c > 1) over++;
  }
  return { hole, over };
}

test('le chapeau a 14 arêtes (8 a, 6 b) et se referme séparément en a et en b', () => {
  assert.equal(NE, 14);
  const sum = [[0, 0], [0, 0]];
  for (const [u, t] of HAT_EDGES) { sum[t][0] += u[0]; sum[t][1] += u[1]; }
  assert.equal(HAT_EDGES.filter((e) => e[1] === 0).length, 8);
  for (const v of sum.flat()) assert.ok(Math.abs(v) < 1e-12);
});

test('substitution : 25, 169, 1 156 chapeaux par métatuile H, un sur huit environ retourné', () => {
  for (const [level, n] of [[1, 25], [2, 169], [3, 1156]]) {
    const H = level === 3 ? H3 : hatPatch(level);
    assert.equal(H.tiles.length, n);
    const r = H.tiles.filter((t) => t.mir).length / n;
    assert.ok(r > 0.1 && r < 0.15, `niveau ${level} : ${r} de tuiles retournées`);
  }
});

test('les coefficients (A, B) sont cohérents : le pavage est connexe et sans trou', () => {
  assert.ok(H3.connected);
  assert.ok(H3.err < 1e-9, `écart de fermeture ${H3.err}`);
});

test('au point d’origine (a = 1, b = √3), les tuiles pavent : ni jour ni recouvrement', () => {
  const c = coverage({ a: [1, 0], b: [Math.sqrt(3), 0] });
  assert.deepEqual(c, { hole: 0, over: 0 });
});

test('la famille continue : pour a, b complexes le long du lacet, le pavage reste un pavage', () => {
  for (let k = 0; k < 8; k++) {
    const P = hatParams(LOOP, k / 8);
    assert.ok(isSimple(hatShape(P.a, P.b, 0)) && isSimple(hatShape(P.a, P.b, 1)), `ψ = ${k / 8} : tuile non simple`);
    assert.deepEqual(coverage(P), { hole: 0, over: 0 }, `ψ = ${k / 8}`);
  }
});

test('témoin : un anti-chapeau pris pour le simple reflet du chapeau laisse des jours', () => {
  // (dès que b/a n'est pas réel, la tuile retournée n'est plus le reflet de l'autre)
  const P = hatParams(LOOP, 0.25);
  const polys = H3.tiles.map((T) => hatTile({ ...T, mir: 0, c: T.c, s: T.s }, P.a, P.b));
  let cx = 0, cy = 0; for (const Q of polys) { cx += Q[0]; cy += Q[1]; } cx /= polys.length; cy /= polys.length;
  let s = 5; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let bad = 0;
  for (let i = 0; i < 500; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 9, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a); let c = 0; for (const Q of polys) if (inside(Q, x, y)) c++; if (c !== 1) bad++; }
  assert.ok(bad > 5, `seulement ${bad} points mal couverts`);
});

test('le lacet se referme et ne rebrousse pas chemin', () => {
  const A = hatParams(LOOP, 0), B = hatParams(LOOP, 1);
  for (const k of ['a', 'b']) for (const i of [0, 1]) assert.ok(Math.abs(A[k][i] - B[k][i]) < 1e-12);
  // aller et retour ne passent pas par les mêmes formes : b/a a un argument opposé
  const P = hatParams(LOOP, 0.25), Q = hatParams(LOOP, 0.75);
  const arg = (X) => Math.atan2(X.b[1], X.b[0]) - Math.atan2(X.a[1], X.a[0]);
  assert.ok(Math.abs(arg(P) + arg(Q)) < 1e-9 && Math.abs(arg(P)) > 0.1);
});

test('l’aire moyenne d’une tuile reste 1 ; celle du chapeau varie de moins de 6 %', () => {
  for (let k = 0; k < 16; k++) {
    const P = hatParams(LOOP, k / 16);
    assert.ok(Math.abs((7 * P.area[0] + P.area[1]) / 8 - 1) < 1e-12);
    assert.ok(Math.abs(P.area[0] - 1) < 0.06, `ψ = ${k / 16} : aire du chapeau ${P.area[0]}`);
  }
});

test('cuisson : deux blocs de rangées (chapeau, anti-chapeau), contours dans le sens direct, (a, b) rangés', () => {
  const B = bakeTiling({ group: 'hat', loop: LOOP, wall: 0.04, n: 16, RL: 12, sdfN: 8 });
  assert.equal(B.rows, 24); assert.equal(B.W, B.M + 3);
  for (let r = 0; r < B.rows; r++) {
    const poly = new Float64Array(2 * B.M);
    for (let i = 0; i < B.M; i++) { poly[2 * i] = B.curves[(r * B.W + i) * 4]; poly[2 * i + 1] = B.curves[(r * B.W + i) * 4 + 1]; }
    assert.ok(area(poly) > 0.5, `rangée ${r} : aire ${area(poly)}`);
    const o = (r * B.W + B.M + 2) * 4, P = hatParams(LOOP, (r % 12) / 11);
    assert.ok(Math.abs(B.curves[o] - P.a[0]) < 1e-6 && Math.abs(B.curves[o + 3] - P.b[1]) < 1e-6);
  }
});

test('instances : une tuile du milieu reste à l’origine, et les places à ψ = 0 viennent de (A, B)', () => {
  const I = bakeHatInstances({ level: 2, rot: 0.4, loop: LOOP });
  assert.equal(I.count, 169);
  let zero = 0;
  for (let i = 0; i < I.count; i++) {
    const A = [I.hat[4 * i], I.hat[4 * i + 1]], B = [I.hat[4 * i + 2], I.hat[4 * i + 3]];
    if (Math.hypot(...A, ...B) < 1e-9) zero++;
    const [ax, ay, bx, by] = I.ab0;
    const x = A[0] * ax - A[1] * ay + B[0] * bx - B[1] * by, y = A[0] * ay + A[1] * ax + B[0] * by + B[1] * bx;
    assert.ok(Math.hypot(x - I.pos[2 * i], y - I.pos[2 * i + 1]) < 1e-4);
    assert.ok(Math.abs(Math.hypot(I.iso[4 * i], I.iso[4 * i + 1]) - 1) < 1e-6);
  }
  assert.ok(zero >= 1);
});
