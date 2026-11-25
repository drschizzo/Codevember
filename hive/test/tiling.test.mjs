// Le cœur : pavages isoèdres à sommet libre (p3, p4, p6), portes et relais.
// node --test 'hive/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, track, tileAt, elements, area, isSimple, applyIso, pathAt, isoPow } from '../src/gen/tiling.js';
import { bakeTiling, inset } from '../src/gen/bake.js';

const PROFILES = [{ a1: 0.1, a2: 0.1 }, { a1: -0.1, a3: 0.05 }, { a2: 0.12 }];
const CASES = [];
for (const group of ['p3', 'p4', 'p6']) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
  CASES.push({ group, name: `${group} ${a}-${b}`, path: { legs: [{ a, b, q: [0.34, 0.33, 0.33] }, { a: b, b: a, q: [0.24, 0.38, 0.38] }] } });
}
function inside(poly, x, y) {
  let c = false; const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const moved = (g, T) => { const P = new Float64Array(T.length); for (let i = 0; i < T.length; i += 2) { const p = applyIso(g, [T[i], T[i + 1]]); P[i] = p[0]; P[i + 1] = p[1]; } return P; };

test('les faces de référence ont l’aire 1/2 et les bons angles', () => {
  for (const [k, g] of Object.entries(GROUPS)) {
    const c = g.corners;
    const a = ((c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0])) / 2;
    assert.ok(Math.abs(a - 0.5) < 1e-12, `${k} : aire ${a}`);
    for (let i = 0; i < 3; i++) {
      const p = c[i], q = c[(i + 1) % 3], r = c[(i + 2) % 3];
      const ang = Math.acos(((q[0] - p[0]) * (r[0] - p[0]) + (q[1] - p[1]) * (r[1] - p[1])) / Math.hypot(q[0] - p[0], q[1] - p[1]) / Math.hypot(r[0] - p[0], r[1] - p[1]));
      assert.ok(Math.abs(ang - Math.PI / g.orders[i]) < 1e-9, `${k} : coin ${i}, angle ${ang}`);
    }
  }
});

test('l’aire d’une alvéole est constante tout le long de la boucle (le miel ne déborde pas)', () => {
  for (const c of CASES) {
    const tr = track(c.group, c.path);
    for (let k = 0; k < 200; k++) assert.ok(Math.abs(Math.abs(area(tileAt(c.group, c.path, tr, PROFILES, k / 200, 12))) - 1) < 1e-12, c.name);
  }
});

test('l’alvéole reste un polygone simple', () => {
  for (const c of CASES) {
    const tr = track(c.group, c.path);
    for (let k = 0; k < 120; k++) assert.ok(isSimple(tileAt(c.group, c.path, tr, PROFILES, (k + 0.5) / 120, 12)), `${c.name} à ${k}`);
  }
});

test('les images de l’alvéole par le groupe pavent le plan : ni jour ni recouvrement', () => {
  let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 160 }, () => [(rnd() - 0.5) * 3, (rnd() - 0.5) * 3]);
  for (const c of CASES) {
    const tr = track(c.group, c.path), els = elements(c.group, 6);
    for (const psi of [0.07, 0.21, 0.38, 0.49, 0.5, 0.63, 0.86, 0.999]) {
      const T = tileAt(c.group, c.path, tr, PROFILES, psi, 12);
      const tiles = els.map((g) => moved(g, T));
      for (const p of pts) { let n = 0; for (const P of tiles) if (inside(P, p[0], p[1])) n++; assert.equal(n, 1, `${c.name} à ψ = ${psi} : ${n} alvéoles au point ${p}`); }
    }
  }
});

test('témoin : sans le relais, la boucle ne se referme pas sur la même alvéole', () => {
  const c = CASES[0], tr = track(c.group, c.path);
  const T0 = tileAt(c.group, c.path, tr, PROFILES, 0, 12), T1 = tileAt(c.group, c.path, tr, PROFILES, 1 - 1e-9, 12);
  let d = 0; for (let i = 0; i < T0.length; i += 2) { let m = 1e9; for (let j = 0; j < T1.length; j += 2) m = Math.min(m, Math.hypot(T0[i] - T1[j], T0[i + 1] - T1[j + 1])); d = Math.max(d, m); }
  assert.ok(d > 0.2, `l’alvéole est revenue à sa place (${d})`);
});

test('le relais : à ψ = 1 l’alvéole est l’image de celle de ψ = 0 par une rotation du groupe, d’ordre égal à celui du troisième centre', () => {
  for (const c of CASES) {
    const tr = track(c.group, c.path), h = tr.relay;
    assert.ok(h.err < 1e-12);
    const T0 = moved(h, tileAt(c.group, c.path, tr, PROFILES, 0, 12)), T1 = tileAt(c.group, c.path, tr, PROFILES, 1 - 1e-10, 12);
    let d = 0; for (let i = 0; i < T0.length; i += 2) { let m = 1e9; for (let j = 0; j < T1.length; j += 2) m = Math.min(m, Math.hypot(T0[i] - T1[j], T0[i + 1] - T1[j + 1])); d = Math.max(d, m); }
    assert.ok(d < 1e-7, `${c.name} : écart ${d}`);
    const third = 3 - c.path.legs[0].a - c.path.legs[0].b, order = GROUPS[c.group].orders[third];
    const ang = Math.abs(Math.atan2(h.s, h.c));
    assert.ok(Math.abs(ang - 2 * Math.PI / order) < 1e-9, `${c.name} : rotation de ${ang}, ordre ${order}`);
    const id = isoPow(h, order);
    assert.ok(Math.abs(id.c - 1) < 1e-9 && Math.hypot(id.tx, id.ty) < 1e-9, `${c.name} : h^${order} ≠ identité`);
  }
});

test('la forme est continue à travers les portes et le raccord (l’alvéole suivie ne saute pas)', () => {
  let s = 5; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 400 }, () => [(rnd() - 0.5) * 4, (rnd() - 0.5) * 4]);
  for (const c of CASES) {
    const tr = track(c.group, c.path);
    for (const g of [0.5, 1]) {
      const A = tileAt(c.group, c.path, tr, PROFILES, g - 1e-4, 12), B = tileAt(c.group, c.path, tr, PROFILES, g + 1e-4, 12);
      let ch = 0; for (const p of pts) if (inside(A, p[0], p[1]) !== inside(B, p[0], p[1])) ch++;
      assert.ok(ch <= 1, `${c.name} : ${ch} points changent d’alvéole à ψ = ${g}`);
    }
  }
});

test('la vitesse du point libre est nulle aux portes (les paliers)', () => {
  const path = CASES[0].path;
  for (const g of [0, 0.5]) {
    const a = pathAt(path, g + 1e-3).beta, b = pathAt(path, g + 2e-3).beta;
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5);
  }
});

test('cuisson : la face intérieure de la paroi reste dans l’alvéole, à moins d’une demi-épaisseur de l’axe au plus', () => {
  const c = CASES[4];
  const B = bakeTiling({ group: c.group, path: c.path, profiles: PROFILES, wall: 0.04, n: 12, RL: 16, sdfN: 8 });
  assert.equal(B.curves.length, B.rows * B.W * 4);
  for (let r = 0; r < B.rows; r++) {
    const poly = new Float64Array(2 * B.M);
    for (let i = 0; i < B.M; i++) { poly[2 * i] = B.curves[(r * B.W + i) * 4]; poly[2 * i + 1] = B.curves[(r * B.W + i) * 4 + 1]; }
    for (let i = 0; i < B.M; i++) {
      const o = (r * B.W + i) * 4, x = B.curves[o + 2], y = B.curves[o + 3];
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      // distance au contour ≤ demi-épaisseur (+ tolérance), jamais dehors de plus d'un rien
      let d = Infinity; for (let j = 0; j < B.M; j++) d = Math.min(d, Math.hypot(x - poly[2 * j], y - poly[2 * j + 1]));
      assert.ok(d < 0.04 * 1.6 + 0.02, `rangée ${r}, point ${i} : ${d}`);
    }
    // centre de gravité dans la boîte de l'étape
    const o = (r * B.W + B.M) * 4, leg = Math.floor(r / B.RL);
    assert.ok(B.curves[o] > B.boxes[4 * leg] && B.curves[o] < B.boxes[4 * leg] + B.boxes[4 * leg + 2]);
  }
  void inset;
});
