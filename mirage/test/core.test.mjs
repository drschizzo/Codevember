// Invariants du cœur : l'optique du mirascope (où se forme l'image, comment
// elle s'efface quand on lève le couvercle), la pose des objets sur le fond
// courbe, la chorégraphie (boucle refermée, temps monotones).
//   node --test 'mirage/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAB, mirrors, hitParab, traceCavity, imageOf } from '../src/gen/mirascope.js';
import { TOP, CASE, CANDLE, CROWN, WICK, FLAME_Y, BOUND, bowl } from '../src/gen/profiles.js';
import { CHORE, liftAt, diveAt, cameraAt, objectAt } from '../src/timeline.js';
import { generate } from '../src/recipe.js';

const f = PARAB.f, R = PARAB.rimK * f, rh = PARAB.holeK * f;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('les deux coupes se rejoignent à leur bord quand le couvercle est fermé (r = √2·f, y = f/2)', () => {
  const [lo, hi] = mirrors(f, 0);
  close(lo.a * R * R + lo.b, f / 2, 1e-12);
  close(hi.a * R * R + hi.b, f / 2, 1e-12);
  // chaque sommet au foyer de l'autre : foyer du bas en y = f, sommet du haut en y = f
  close(1 / (4 * lo.a), f, 1e-12);
  close(hi.b, f, 1e-12);
});

test('un rayon parallèle à l’axe repasse par le foyer après réflexion sur la coupe du bas', () => {
  for (const x of [0.005, 0.02, 0.05]) {
    const [lo] = mirrors(f, 0);
    const h = hitParab([x, 0.2, 0], [0, -1, 0], lo.a, lo.b, lo.rMin, lo.rMax);
    const d = [0, -1, 0], k = 2 * (d[0] * h.n[0] + d[1] * h.n[1]), r = [d[0] - k * h.n[0], d[1] - k * h.n[1], 0];
    const t = -h.p[0] / r[0];
    close(h.p[1] + r[1] * t, f, 1e-9, `x = ${x}`);
  }
});

test('l’image réelle d’un point du fond flotte en y ≈ f + h, au-dessus de l’ouverture', () => {
  const holeY = f - (rh * rh) / (4 * f);
  for (const h of [0.002, 0.004, 0.006]) {
    const I = imageOf([0, h, 0], f, 0, 1500);
    close(I.X[0], 0, 1e-6); close(I.X[2], 0, 1e-6);
    close(I.X[1], f + h, 0.0008, `h = ${h}`);
    assert.ok(I.X[1] > holeY, 'au-dessus du bord de l’ouverture');
    assert.ok(I.spread < 0.0004, `image nette (étalement ${I.spread})`);
  }
});

test('l’image est tournée d’un demi-tour autour de l’axe (x, z → −x, −z)', () => {
  for (const P of [[0.004, 0.003, 0], [0, 0.003, -0.005], [0.003, 0.002, 0.003]]) {
    const I = imageOf(P, f, 0, 1500);
    close(I.X[0], -P[0], 0.15 * Math.hypot(P[0], P[2]) + 2e-4, 'x');
    close(I.X[2], -P[2], 0.15 * Math.hypot(P[0], P[2]) + 2e-4, 'z');
  }
});

test('couvercle levé : l’image descend dans la cavité et perd ses rayons (elle s’efface)', () => {
  const P = [0, 0.004, 0];
  let prevY = Infinity;
  const n0 = imageOf(P, f, 0, 2000).n;
  for (const L of [0, 0.005, 0.01, 0.015, 0.02]) {
    const I = imageOf(P, f, L, 2000);
    assert.ok(I.X[1] < prevY, `L = ${L} : l'image descend`);
    prevY = I.X[1];
  }
  for (let i = 0; i < 20; i++) {
    const Rr = generate(`t${i}`), I = imageOf(P, f, Rr.mirascope.liftMax, 2000);
    assert.ok(!I || I.n < 0.15 * n0, `${Rr.seed} : ${I?.n} rayons sur ${n0} au plus haut`);
  }
});

test('un rayon de l’œil qui entre par l’ouverture vers le fond rencontre l’objet après deux réflexions', () => {
  // (le chemin que suit le lancer de rayons pour former l'image)
  const sphere = (o, d, tMax) => { // l'objet : une bille au fond
    const c = [0, 0.004, 0], r = 0.004, oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
    const b = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2], cc = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - r * r, D = b * b - cc;
    if (D < 0) return null; const t = -b - Math.sqrt(D); return t > 1e-7 && t < tMax ? t : null;
  };
  // l'œil au-dessus, qui vise l'image (en y = f + 0,004)
  let hits = 0, n = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const eye = [0.1, 0.2, 0.05], tgt = [i * 0.0008, f + 0.004 + j * 0.0008, 0];
    const d = tgt.map((v, k) => v - eye[k]);
    const res = traceCavity(eye, d, f, 0, 8, sphere);
    n++; if (res.fate === 'objet' && res.bounces === 2) hits++;
  }
  assert.ok(hits > 0.6 * n, `${hits} / ${n}`);
});

test('les objets reposent exactement sur le fond courbe (aucun ne flotte, aucun ne le traverse)', () => {
  for (const [name, P] of [['toupie', TOP], ['montre', CASE], ['chauffe-plat', CANDLE]]) {
    let gap = Infinity;
    for (const [r, y] of P) { const g = y - bowl(r); assert.ok(g > -1e-6, `${name} : sommet (${r}, ${y}) sous le fond`); gap = Math.min(gap, g); }
    // aussi le long des arêtes du profil
    for (let i = 1; i < P.length; i++) for (let s = 0; s <= 20; s++) {
      const r = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * s / 20, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * s / 20;
      assert.ok(y - bowl(r) > -1e-6, `${name} : arête sous le fond en r = ${r}`);
    }
    assert.ok(gap < 1e-5, `${name} : flotte de ${(gap * 1000).toFixed(2)} mm`);
  }
  // la couronne de la montre (une sphère) ne touche pas le fond
  for (let k = 0; k < 400; k++) {
    const th = Math.acos(1 - 2 * (k + 0.5) / 400), ph = k * 2.39996323;
    const x = CROWN[0] + CROWN[2] * Math.sin(th) * Math.cos(ph), z = CROWN[2] * Math.sin(th) * Math.sin(ph), y = CROWN[1] + CROWN[2] * Math.cos(th);
    assert.ok(y - bowl(Math.hypot(x, z)) > 2e-4, 'couronne contre le fond');
  }
  // la flamme au-dessus de la mèche, tout dans la sphère englobante du tracé
  assert.ok(FLAME_Y > WICK.y1);
  for (const P of [TOP, CASE, CANDLE]) for (const [r, y] of P) assert.ok(Math.hypot(r, y - BOUND.y) < BOUND.r, `(${r}, ${y}) hors de la sphère englobante`);
  assert.ok(Math.hypot(CROWN[0] + CROWN[2], CROWN[1] - BOUND.y) < BOUND.r);
});

test('la boucle se referme : levée, plongée, caméra et objets identiques à u = 0 et u = 1', () => {
  for (let i = 0; i < 20; i++) {
    const Rr = generate(`t${i}`);
    assert.equal(liftAt(0), liftAt(1)); assert.equal(diveAt(0), diveAt(1));
    const c0 = cameraAt(Rr, 0), c1 = cameraAt(Rr, 1);
    for (let k = 0; k < 3; k++) { close(c0.pos[k], c1.pos[k], 1e-12); close(c0.tgt[k], c1.tgt[k], 1e-12); }
    const o0 = objectAt(Rr, 0), o1 = objectAt(Rr, 1 - 1e-12);
    const wrap = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    assert.ok(wrap(o1.spin - o0.spin) < 1e-6 && wrap(o1.hands[2] - o0.hands[2]) < 1e-6 && wrap(o1.time - o0.time) < 1e-6);
    assert.ok(Number.isInteger(Rr.object.spinTurns) && Number.isInteger(Rr.object.secondTurns));
  }
});

test('chaque temps est monotone : le couvercle monte, reste levé, redescend ; fermé, l’image est là', () => {
  const N = 2000;
  for (let i = 1; i <= N; i++) {
    const u = i / N, a = liftAt((i - 1) / N), b = liftAt(u);
    if (u <= 0.5) assert.ok(b >= a - 1e-15, `levée en u = ${u}`); else assert.ok(b <= a + 1e-15, `retombée en u = ${u}`);
    const c = diveAt((i - 1) / N), d = diveAt(u);
    if (u <= 0.5) assert.ok(d >= c - 1e-15); else assert.ok(d <= c + 1e-15);
  }
  for (const u of [0, 0.1, CHORE.up[0], CHORE.down[1], 0.9]) assert.equal(liftAt(u), 0);
  for (let u = CHORE.up[1]; u <= CHORE.down[0]; u += 0.01) close(liftAt(u), 1, 1e-12);
  // la caméra ne plonge que couvercle déjà levé
  for (let u = 0; u < 0.5; u += 0.002) if (diveAt(u) > 0.02) assert.ok(liftAt(u) > 0.05, `u = ${u}`);
});

test('caméra : jamais sous la table ni dans les coupes, et la potence n’est jamais devant la coupe', () => {
  for (let i = 0; i < 100; i++) {
    const Rr = generate(`t${i}`);
    for (let k = 0; k <= 200; k++) {
      const u = k / 200, c = cameraAt(Rr, u);
      assert.ok(Math.hypot(c.pos[0], c.pos[2]) > R + 0.1 || c.pos[1] > f + 0.1, `${Rr.seed} u = ${u}`);
      assert.ok(c.pos[1] > 0.02);
      // potence en +x : l'azimut de l'œil (mesuré comme dans cameraAt) reste loin de 90°
      const az = (Math.atan2(c.pos[0], c.pos[2]) * 180) / Math.PI;
      assert.ok(Math.abs(az - 90) > 45, `${Rr.seed} : azimut ${az.toFixed(0)}°`);
    }
  }
});
