// Invariants du cœur : l'optique du mirascope (où se forme l'image, comment
// elle s'efface quand on lève le couvercle), la pose des objets sur le fond
// courbe, la chorégraphie (boucle refermée, temps monotones).
//   node --test 'mirage/test/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAB, mirrors, hitParab, traceCavity, imageOf } from '../src/gen/mirascope.js';
import { TOP, CASE, CANDLE, CROWN, BOW, WICK, FLAME_Y, COMPASS, COMP_RING, PIVOT, NEEDLE, CARD_Y, COIN, COINS, MAX_H, BOUND, bowl } from '../src/gen/profiles.js';
import { CHORE, JOLTS, liftAt, diveAt, cameraAt, objectAt, swingAt } from '../src/timeline.js';
import { layout, toWorld } from '../src/gen/layout.js';
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

const sphereClear = (c, r, margin, msg) => {
  for (let k = 0; k < 400; k++) {
    const th = Math.acos(1 - 2 * (k + 0.5) / 400), ph = k * 2.39996323;
    const x = c[0] + r * Math.sin(th) * Math.cos(ph), z = (c[2] ?? 0) + r * Math.sin(th) * Math.sin(ph), y = c[1] + r * Math.cos(th);
    assert.ok(y - bowl(Math.hypot(x, z)) > margin, msg);
  }
};
const torusClear = ([x0, y0, R, r], margin, msg) => {
  for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; sphereClear([x0 + R * Math.cos(a), y0, R * Math.sin(a)], r, margin, msg); }
};

test('les objets reposent exactement sur le fond courbe (aucun ne flotte, aucun ne le traverse)', () => {
  for (const [name, P] of [['toupie', TOP], ['montre', CASE], ['chauffe-plat', CANDLE], ['boussole', COMPASS]]) {
    let gap = Infinity;
    for (const [r, y] of P) { const g = y - bowl(r); assert.ok(g > -1e-6, `${name} : sommet (${r}, ${y}) sous le fond`); gap = Math.min(gap, g); }
    // aussi le long des arêtes du profil
    for (let i = 1; i < P.length; i++) for (let s = 0; s <= 20; s++) {
      const r = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * s / 20, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * s / 20;
      assert.ok(y - bowl(r) > -1e-6, `${name} : arête sous le fond en r = ${r}`);
    }
    assert.ok(gap < 1e-5, `${name} : flotte de ${(gap * 1000).toFixed(2)} mm`);
  }
  // les pièces : la première sur l'arête de son fond, chacune à plat sur la précédente, sans toucher le fond ailleurs
  close(COINS[0].y, bowl(COIN.r), 1e-5);
  for (let i = 1; i < COINS.length; i++) {
    close(COINS[i].y, COINS[i - 1].y + COIN.h, 1e-12);
    const d = Math.hypot(COINS[i].x - COINS[i - 1].x, COINS[i].z - COINS[i - 1].z);
    assert.ok(d < COIN.r * 0.5, 'le centre de chaque pièce au-dessus de la précédente (elle ne bascule pas)');
    for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2, x = COINS[i].x + COIN.r * Math.cos(a), z = COINS[i].z + COIN.r * Math.sin(a); assert.ok(COINS[i].y - bowl(Math.hypot(x, z)) > 1e-4); }
  }
  // couronne, bélière, anneau de la boussole : loin du fond
  sphereClear(CROWN, CROWN[2], 2e-4, 'couronne contre le fond');
  torusClear(BOW, 2e-4, 'bélière contre le fond');
  torusClear(COMP_RING, 2e-4, 'anneau de la boussole contre le fond');
  // l'aiguille au-dessus de la rose, sous le sommet du pivot ; la flamme au-dessus de la mèche
  assert.ok(NEEDLE.y - NEEDLE.th > CARD_Y && NEEDLE.y + NEEDLE.th < PIVOT.y1);
  assert.ok(FLAME_Y > WICK.y1);
});

test('aucun objet ne dépasse 11,5 mm : son image entière passe par l’ouverture', () => {
  for (const P of [TOP, CASE, CANDLE, COMPASS]) for (const [, y] of P) assert.ok(y <= MAX_H);
  assert.ok(COINS.at(-1).y + COIN.h <= MAX_H && PIVOT.y1 <= MAX_H && FLAME_Y + 0.003 <= MAX_H);
  // et tout l'objet dans la sphère englobante du tracé
  for (const P of [TOP, CASE, CANDLE, COMPASS]) for (const [r, y] of P) assert.ok(Math.hypot(r, y - BOUND.y) < BOUND.r, `(${r}, ${y}) hors de la sphère englobante`);
  for (const [x, y, R, r] of [BOW, COMP_RING]) assert.ok(Math.hypot(x + R + r, y - BOUND.y) < BOUND.r);
  for (const c of COINS) assert.ok(Math.hypot(Math.hypot(c.x, c.z) + COIN.r, c.y + COIN.h - BOUND.y) < BOUND.r);
});

test('les points d’un objet sous 11,5 mm se voient dans l’image depuis la caméra (au-delà de 16 mm, non)', () => {
  // (la coupure que l'on verrait sur un objet trop haut est celle d'un vrai mirascope)
  const seen = (el, h) => {
    const e = (el * Math.PI) / 180, D = 0.38, eye = [0, f + 0.006 + Math.sin(e) * D, Math.cos(e) * D], P = [0, f + h, 0];
    const d = P.map((v, k) => v - eye[k]);
    const plane = (o, dd, tMax) => { if (Math.abs(dd[1]) < 1e-9) return null; const t = (h - o[1]) / dd[1]; return t > 1e-7 && t < tMax && Math.hypot(o[0] + dd[0] * t, o[2] + dd[2] * t) < 0.011 ? t : null; };
    const r = traceCavity(eye, d, f, 0, 6, plane);
    return r.fate === 'objet' && r.bounces === 2;
  };
  for (const el of [40, 47]) { assert.ok(seen(el, MAX_H), `${el}°`); assert.ok(!seen(el, 0.02), `${el}° : 20 mm encore vu`); }
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

test('l’aiguille de la boussole : au repos au raccord, elle oscille à chaque à-coup du couvercle et s’amortit', () => {
  assert.equal(swingAt(0), 0); assert.equal(swingAt(0.999999), 0);
  for (const [u0] of JOLTS) {
    let m = 0; for (let u = u0; u < u0 + 0.05; u += 0.0005) m = Math.max(m, Math.abs(swingAt(u)));
    let late = 0; for (let u = u0 + 0.12; u < u0 + 0.16; u += 0.0005) late = Math.max(late, Math.abs(swingAt(u)));
    assert.ok(m > 0.08 && late < m * 0.1, `à-coup en ${u0} : ${m.toFixed(3)} puis ${late.toFixed(4)}`);
  }
  for (const u of [0.05, 0.15, 0.9]) assert.equal(swingAt(u), 0, `au repos en ${u}`);
});

test('caméra : jamais sous la table ni dans les coupes, et aucune pièce de la machinerie entre l’œil et l’image', () => {
  // distance de deux segments (échantillonnée)
  const segDist = (a, b, c, d) => {
    let m = Infinity;
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
      const p = a.map((v, k) => v + (b[k] - v) * i / 40), q = c.map((v, k) => v + (d[k] - v) * j / 40);
      m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
    return m;
  };
  for (const kind of ['cremaillere', 'vis', 'poulies']) for (let i = 0; i < 12; i++) {
    const Rr = generate(`t${i}`, { mechanism: kind }), Lmax = Rr.mirascope.liftMax, L0 = layout(kind, f);
    for (let k = 0; k <= 24; k++) {
      const u = k / 24, c = cameraAt(Rr, u), L = liftAt(u) * Lmax;
      assert.ok(Math.hypot(c.pos[0], c.pos[2]) > R + 0.1 || c.pos[1] > f + 0.1, `${Rr.seed} u = ${u}`);
      assert.ok(c.pos[1] > 0.02);
      if (L > 0.002) continue; // (couvercle levé : l'image s'est éteinte)
      const img = [0, f + 0.006, 0];
      for (const P of L0.posts) {
        const a = toWorld([P.x, P.y0, P.z], Rr.mechanism.yaw), b = toWorld([P.x, P.y1, P.z], Rr.mechanism.yaw);
        assert.ok(segDist(c.pos, img, a, b) > P.r + 0.004, `${kind} ${Rr.seed} u = ${u} : une colonne devant l’image`);
      }
      for (const B of L0.bars) {
        const a = toWorld(B.a, Rr.mechanism.yaw), b = toWorld(B.b, Rr.mechanism.yaw);
        assert.ok(segDist(c.pos, img, a, b) > B.r + 0.003, `${kind} ${Rr.seed} u = ${u} : une barre devant l’image`);
      }
      for (const C of L0.cords ?? []) {
        const a = toWorld([C.x, f / 2, C.z], Rr.mechanism.yaw), b = toWorld([C.x, L0.yS, C.z], Rr.mechanism.yaw);
        assert.ok(segDist(c.pos, img, a, b) > 0.004, `${kind} ${Rr.seed} u = ${u} : une corde devant l’image`);
      }
    }
  }
});
