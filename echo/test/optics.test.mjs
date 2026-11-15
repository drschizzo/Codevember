// Le cœur optique : chaque chemin d'écho égale la longueur d'un rayon lancé
// depuis la lampe et réfléchi pas à pas sur la vraie surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sub, add, mul, dot, norm, dist, reflectDir, planeBasis, planeEcho, makeEllipse, ellipseEcho, rayEllipsoid,
  facetEcho, facetFrame, gate, galleryImages, galleryEcho,
} from '../src/gen/optics.js';
import { createRng } from '../../shared/rng.js';

const rnd = createRng('optics-test');
const rv = (lo, hi) => [rnd.range(lo[0], hi[0]), rnd.range(lo[1], hi[1]), rnd.range(lo[2], hi[2])];

test('miroir plan : L = |s → m| + |m → x| pour le point m où la loi de la réflexion est vérifiée', () => {
  const n = norm([0.2, 0, 1]);
  const { u, v } = planeBasis(n);
  const M = { c: [0, 0.5, -0.5], n, u, v, hw: 0.4, hh: 0.45, shape: 'rect' };
  const s = [-0.35, 0.45, 0.1];
  let checked = 0;
  for (let k = 0; k < 4000; k++) {
    const x = rv([-1, -0.2, -0.4], [1, 1.2, 1.5]);
    const e = planeEcho(x, s, M);
    if (!e) continue;
    const m = e.hit;
    assert.ok(Math.abs(dot(sub(m, M.c), n)) < 1e-12, 'm est sur la glace');
    assert.ok(Math.abs(dist(s, m) + dist(m, x) - e.L) < 1e-9, 'longueur du chemin');
    // la direction réfléchie en m pointe vers x
    const r = reflectDir(norm(sub(m, s)), n);
    assert.ok(dist(r, norm(sub(x, m))) < 1e-9, 'loi de la réflexion');
    checked++;
  }
  assert.ok(checked > 300, `assez de points éclairés (${checked})`);
});

test('miroir plan : rien derrière la glace, rien hors de son contour', () => {
  const n = [0, 0, 1];
  const { u, v } = planeBasis(n);
  const M = { c: [0, 0, 0], n, u, v, hw: 0.3, hh: 0.3, shape: 'oval' };
  assert.equal(planeEcho([0, 0, -0.2], [0, 0, 0.5], M), null);
  // le coin du carré circonscrit n'est pas dans l'ovale
  const s = [0, 0, 1];
  const x = [0.29 * 2, 0.29 * 2, 1]; // (rayon par le coin : (0.29, 0.29) sur la glace)
  assert.equal(planeEcho(x, s, M), null);
});

test('miroir elliptique : tout rayon parti de la lampe et réfléchi sur la calotte passe par le second foyer, chemin 2a', () => {
  const f1 = [-0.35, 0.45, 0.05], f2 = [0.1, 0.12, 0.15];
  const E = makeEllipse(f1, f2, [0.55, 0.3, -0.25], 0.12);
  const { u, v } = planeBasis(E.axis);
  let n = 0;
  for (let k = 0; k < 500; k++) {
    // un point de la calotte, puis le rayon de la lampe vers lui
    const th = Math.acos(E.cosCap) * Math.sqrt(rnd.next()), ph = rnd.range(0, 2 * Math.PI);
    const d2 = norm(add(add(mul(E.axis, Math.cos(th)), mul(u, Math.sin(th) * Math.cos(ph))), mul(v, Math.sin(th) * Math.sin(ph))));
    const P0 = add(f2, mul(d2, rayEllipsoid(f2, d2, f1, f2, E.a)));
    const d = norm(sub(P0, f1));
    const t = rayEllipsoid(f1, d, f1, f2, E.a);
    const P = add(f1, mul(d, t));
    // normale de l'ellipsoïde en P : bissectrice intérieure
    const nP = norm(add(norm(sub(f1, P)), norm(sub(f2, P))));
    const r = reflectDir(d, nP);
    // le rayon réfléchi pointe vers f2
    assert.ok(dist(r, norm(sub(f2, P))) < 1e-7, 'le rayon réfléchi vise f2');
    // un point x sur ce rayon, avant le foyer : L = |f1 P| + |P x| = 2a − |x f2|
    const x = add(P, mul(r, rnd.range(0.05, 0.95) * dist(P, f2)));
    const e = ellipseEcho(x, E);
    assert.ok(e && e.before, 'x est dans le cône convergent');
    assert.ok(Math.abs(dist(f1, P) + dist(P, x) - e.L) < 1e-7, 'chemin avant le foyer');
    // et après le foyer
    const y = add(f2, mul(r, rnd.range(0.05, 1)));
    const e2 = ellipseEcho(y, E);
    assert.ok(e2 && !e2.before, 'y est dans le cône divergent');
    assert.ok(Math.abs(dist(f1, P) + dist(P, y) - e2.L) < 1e-7, 'chemin après le foyer');
    n++;
  }
  assert.equal(n, 500);
});

test('boule à facettes : chemin par la facette = |x − s′ᶠ|, réflexion exacte', () => {
  const B = { c: [0.25, 0.75, -0.15], r: 0.09, rows: 16, cols: 40, spin: 0.3 };
  const s = [-0.35, 0.45, 0.05];
  let n = 0;
  for (let k = 0; k < 60000 && n < 200; k++) {
    const x = rv([-1.2, -0.2, -0.6], [1.2, 1.4, 1.2]);
    const e = facetEcho(x, s, B);
    if (!e) continue;
    const F = facetFrame(B, ...e.facet);
    assert.ok(Math.abs(dist(s, e.hit) + dist(e.hit, x) - e.L) < 1e-9);
    const r = reflectDir(norm(sub(e.hit, s)), F.n);
    assert.ok(dist(r, norm(sub(x, e.hit))) < 1e-9);
    n++;
  }
  assert.ok(n >= 100, `taches trouvées : ${n}`);
});

test('l’impulsion : 0 avant le front, un pic sur l’anneau, puis elle s’éteint', () => {
  assert.equal(gate(3.4, 2, 1.5), 0);
  assert.ok(gate(3.52, 2, 1.5) > 3);
  assert.ok(gate(5, 2, 1.5) < 0.02);
  let prev = Infinity;
  for (let r = 3.52; r < 5; r += 0.01) { const g = gate(r, 2, 1.5); assert.ok(g <= prev + 1e-12); prev = g; }
});

test('galerie : chaque image est le bout d’un rayon réellement réfléchi entre les deux glaces', () => {
  // (glaces latérales : plans x = −0.75 et x = 0.8 ; contours dans le plan (z, y))
  const G = { zA: -0.75, zB: 0.8, A: { cx: 0.2, cy: 0.5, hw: 0.85, hh: 0.55 }, B: { cx: 0.2, cy: 0.5, hw: 0.85, hh: 0.55 } };
  const s = [-0.2, 0.5, 0.1];
  let n = 0;
  for (let k = 0; k < 3000; k++) {
    const x = rv([-0.7, 0, -0.5], [0.75, 1, 1.0]);
    for (const e of galleryEcho(x, s, G, 4)) {
      let o = x, dir = norm(sub(e.q, x)), total = 0, hits = 0;
      for (let b = 0; b < 8; b++) {
        const xt = dir[0] < 0 ? G.zA : G.zB;
        const t = (xt - o[0]) / dir[0];
        const p = add(o, mul(dir, t));
        const ts = dot(sub(s, o), dir);
        if (hits === e.n && ts > 0 && ts < t + 1e-9) { total += ts; o = add(o, mul(dir, ts)); break; }
        total += t; o = p; dir = [-dir[0], dir[1], dir[2]]; hits++;
      }
      assert.equal(hits, e.n, 'nombre de réflexions');
      assert.ok(dist(o, s) < 1e-9, 'le rayon aboutit à la lampe');
      assert.ok(Math.abs(total - e.L) < 1e-9, 'longueur du chemin');
      n++;
    }
  }
  assert.ok(n > 500, `chemins vérifiés : ${n}`);
  const xs = galleryImages(s, G, 4).filter((i) => i.side === 'A').map((i) => i.q[0]);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] < xs[i - 1]);
});
