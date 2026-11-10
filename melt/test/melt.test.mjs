// Invariants du cœur : croissance, fonte, eau, horloge, caméra, support.
//   node --test melt/test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { grow, lattice } from '../src/gen/growth.js';
import { buildCrystal, capBase, capVolume, MAX_BLOBS } from '../src/gen/crystal.js';
import { clock, TL } from '../src/timeline.js';
import { cameraPath, cameraAt } from '../src/camera.js';
import { generate, crystalSpec } from '../src/recipe.js';
import { buildWool } from '../src/gen/wool.js';
import { FAMILIES } from '../src/families.js';

const STELLAR = FAMILIES.star.forms.dendrite.growth;

test('croissance : symétrie d’ordre 6 sans bruit, attachement définitif', () => {
  const g = grow({ ...STELLAR, R: 60, sigma: 0 });
  const { L, a, T } = g;
  // rotation de 60° en coordonnées axiales : (q, r) → (−r, q + r)
  let checked = 0;
  for (let r = -L.R; r <= L.R; r++) for (let q = -L.R; q <= L.R; q++) {
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > L.R) continue;
    const i = L.idx(q, r), j = L.idx(-r, q + r);
    assert.equal(a[i], a[j]);
    if (a[i]) { assert.equal(T[i], T[j]); checked++; }
  }
  assert.ok(checked > 200);
  assert.ok(g.rmax >= 0.85 * 60);
});

const C = buildCrystal({ ...crystalSpec(generate('t1', { family: 'star', form: 'dendrite' })), R: 70 });
const P = buildCrystal({ ...crystalSpec(generate('t2', { family: 'plate', form: 'sectorstar' })), R: 70 });
const K = buildCrystal({ ...crystalSpec(generate('t3', { family: 'column', form: 'needle' })), R: 70 });

test('fonte : chaque cellule fond avant son chemin vers le centre ; le centre en dernier', () => {
  for (const X of [C, P]) {
    const n = X.nCells;
    const M = (k) => X.A[k * 4 + 2];
    // la cellule centrale (rayon nul) fond en dernier
    let centre = 0, best = 9;
    for (let k = 0; k < n; k++) { const r = Math.hypot(X.position[k * 3], X.position[k * 3 + 1]); if (r < best) { best = r; centre = k; } }
    assert.equal(M(centre), 1);
    // toute autre cellule a une voisine plus proche du centre qui fond après elle
    const s = X.cell * 1.01;
    const grid = new Map();
    for (let k = 0; k < n; k++) grid.set(`${Math.round(X.position[k * 3] / X.cell * 2)},${Math.round(X.position[k * 3 + 1] / X.cell * 2)}`, k);
    let bad = 0;
    for (let k = 0; k < n; k++) {
      if (k === centre) continue;
      const x = X.position[k * 3], y = X.position[k * 3 + 1];
      let ok = false;
      for (let m = 0; m < 6 && !ok; m++) {
        const a = (m * Math.PI) / 3, nx = x + Math.cos(a) * X.cell, ny = y + Math.sin(a) * X.cell;
        const j = grid.get(`${Math.round(nx / X.cell * 2)},${Math.round(ny / X.cell * 2)}`);
        if (j !== undefined && j < n && M(j) > M(k)) ok = true;
      }
      if (!ok) bad++;
    }
    assert.equal(bad, 0);
    void s;
  }
});

test('eau : la masse est conservée ; étoile et plaque finissent en une goutte, la colonne en chapelet', () => {
  for (const X of [C, P, K]) {
    const W = X.water, D = W.data;
    const sumAt = (f) => { let v = 0; for (let k = 0; k < MAX_BLOBS; k++) v += D[(f * MAX_BLOBS + k) * 4 + 2]; return v; };
    // dernière image : toute l'eau, dans l'emplacement 0
    const last = W.frames - 1;
    assert.ok(Math.abs(sumAt(last) - X.Vwater) / X.Vwater < 1e-3, `eau ${sumAt(last)} ≠ ${X.Vwater}`);
    let beads = 0;
    for (let k = 1; k < MAX_BLOBS; k++) if (D[(last * MAX_BLOBS + k) * 4 + 2] > X.Vwater * 0.01) beads++;
    if (X === K) assert.ok(beads >= 2, `chapelet : ${beads} perles`);
    else for (let k = 1; k < MAX_BLOBS; k++) assert.equal(D[(last * MAX_BLOBS + k) * 4 + 2], 0);
    // la goutte du centre est au centre (elle y regèlera)
    assert.ok(Math.hypot(D[last * MAX_BLOBS * 4], D[last * MAX_BLOBS * 4 + 1]) < X.cell * 1.5);
    // l'eau montrée ne dépasse jamais l'eau fondue et ne décroît pas
    let prev = 0;
    for (let f = 0; f < W.frames; f++) {
      const v = sumAt(f);
      assert.ok(v <= X.Vwater * (1 + 1e-4));
      assert.ok(v >= prev * 0.995 - 1e-9, `image ${f} : ${v} < ${prev}`);
      prev = v;
    }
  }
});

test('calottes : volume ↔ rayon de base', () => {
  for (const th of [0.4, 0.9, 1.57, 2.0]) for (const V of [1e-4, 0.01, 0.1]) {
    const a = capBase(V, th);
    assert.ok(Math.abs(capVolume(a, th) - V) / V < 1e-9);
  }
});

test('horloge : raccord exact, temps monotones', () => {
  const k0 = clock(0, C), k1 = clock(1 - 1e-9, C);
  for (const key of ['sun', 'cold', 'frozen', 'frost', 'wet']) assert.ok(Math.abs(k0[key] - k1[key]) < 1e-6, key);
  // (les avancées de la croissance, de la fonte et de l'évaporation se remettent
  // à zéro au raccord, quand le cristal n'existe pas : avant sa croissance d'un
  // côté, après sa fonte de l'autre ; la goutte a le volume de la perle des deux)
  assert.ok(k0.tg < 0 && k1.sm > 1 + C.tauMelt && k1.evap === 1 && k0.evap === 0);
  // croissance monotone, fonte monotone, soleil nul au repos
  let tg = -1, sm = -1;
  for (let u = 0; u < 1; u += 0.0005) {
    const k = clock(u, C);
    if (u >= TL.grow0 && u <= TL.grow1) { assert.ok(k.tg >= tg - 1e-12); tg = k.tg; }
    if (u >= TL.melt0 && u <= TL.melt1) { assert.ok(k.sm >= sm - 1e-12); sm = k.sm; }
    if (u < TL.sun0 || u > TL.dusk1) assert.ok(k.sun < 1e-9);
  }
  // le cristal est entier avant la fonte, et rien n'en reste après
  assert.ok(clock(TL.grow1 + 0.01, C).tg > 1 + C.tau);
  assert.ok(clock(TL.melt1 + 0.01, C).sm > 1 + C.tauMelt);
  assert.ok(clock(TL.grow0 - 0.01, C).tg < 0);
});

test('caméra : périodique, lente, sans à-coups', () => {
  for (const seed of ['c1', 'c2', 'c3']) {
    const R = generate(seed);
    const X = { ...C, dropR: 0.3 };
    const path = cameraPath(R, X, 1.5);
    const fps = 120, n = Math.round(R.loop.duration * fps);
    const pose = (i) => cameraAt(i / n, R, path);
    const dir = (p) => { const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]]; const l = Math.hypot(...d); return d.map((x) => x / l); };
    let maxW = 0, maxAcc = 0, prevV = null;
    for (let i = 0; i < n; i++) {
      const a = pose(i), b = pose(i + 1);
      const da = dir(a), db = dir(b);
      const w = Math.acos(Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2])) * fps * 180 / Math.PI;
      maxW = Math.max(maxW, w);
      const v = [(b.pos[0] - a.pos[0]) * fps, (b.pos[1] - a.pos[1]) * fps, (b.pos[2] - a.pos[2]) * fps];
      if (prevV) maxAcc = Math.max(maxAcc, Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]) * fps);
      prevV = v;
    }
    assert.ok(maxW < 25, `${seed} : ${maxW.toFixed(1)} °/s`);
    assert.ok(maxAcc < 40, `${seed} : accélération ${maxAcc.toFixed(1)} mm/s²`);
    const a = cameraAt(0, R, path), b = cameraAt(1, R, path);
    assert.ok(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) < 1e-9);
    // la caméra reste au-dessus du support
    for (let i = 0; i < 200; i++) assert.ok(cameraAt(i / 200, R, path).pos[1] > 0.5);
  }
});

test('laine : le cristal pose sur les fibres, rien ne dépasse dans son emprise', () => {
  const w = buildWool({ seed: 5, clear: 1.9 });
  let top = -9;
  for (const P of [w.near.position, w.far.position]) for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i], P[i + 2]) < 1.9) top = Math.max(top, P[i + 1]);
  assert.ok(top <= 0 && top > -0.01, `sommet ${top}`);
});

test('glace : jamais sous le support, épaisseur nulle hors du temps du cristal', () => {
  // (l'épaisseur affichée est max(v, 0) : vérifier qu'au repos v < 0 partout)
  const S = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const h0 = C.thick;
  for (const u of [0, 0.02, 0.8, 0.95]) {
    const k = clock(u, C);
    for (let i = 0; i < C.position.length / 3; i++) {
      const h = C.A[i * 4], T = C.A[i * 4 + 1], M = C.A[i * 4 + 2];
      const v = (h + 0.5 * h0) * S((k.tg - T) / C.tau) * (1 - S((k.sm - M) / C.tauMelt)) - 0.5 * h0;
      assert.ok(v <= 0, `u=${u} cellule ${i} : ${v}`);
    }
  }
});
