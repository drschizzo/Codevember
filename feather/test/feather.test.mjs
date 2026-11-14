// Invariants du cœur : déroulement isométrique, calendrier monotone, raccord
// de la boucle, la gerbe (ordre à l'angle d'or, chute de l'ancienne, rien ne
// traverse rien, rien sous le socle), caméra lente et périodique, motif du
// collier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { FAMILIES } from '../src/families.js';
import { createRng } from '../../shared/rng.js';
import {
  shapeOf, barbTable, barbPose, barbArc, BARB_STRIDE, SCHED, growth, unroll, zipAt, releaseAt, bendAt, settleAt, wearAt,
  qrot, sinkAt,
} from '../src/gen/feather.js';
import { layoutBouquet, bouquetState, ageOf, frameAt, oldPose, leanAt, surfaceDist, GERBE, GOLDEN } from '../src/gen/bouquet.js';
import { cameraPath } from '../src/camera.js';
import { bouquetCrossings, featherLines } from '../src/gen/collide.js';
import { simulateCollar, featherTexture, PROGRAMS } from '../src/gen/pattern.js';

const barb = (T, i) => [...T.slice(i * BARB_STRIDE, (i + 1) * BARB_STRIDE)];
const S0 = (P, u, wear = 0) => ({ u, L: P.L, k: 0, wear, g: [0, 0, 0], radial: P.radial, cal: P.calamus, over: P.over });

test('le déroulement est une isométrie : la longueur des barbes ne change pas', () => {
  for (const fam of ['vexille', 'ocelle']) {
    const P = shapeOf(fam, createRng(`iso-${fam}`));
    P.droop = 0; P.wave = 0;
    const T = barbTable(P, 'iso');
    for (let b = 0; b < T.length / BARB_STRIDE; b += 5) {
      const B = barb(T, b); B[12] = 0; B[13] = 0; B[14] = 0; // (sans affaissement, écart ni ondulation)
      B[6] = B[5]; // (rayon constant le long de la barbe : isométrie exacte)
      const lens = [];
      for (const u of [0.4, 0.42, 0.5, 0.56, 0.62, 0.7, 0.9]) {
        let len = 0, prev = null;
        for (let i = 0; i <= 400; i++) {
          const p = barbPose(B, i / 400, 0, 0, S0(P, u)).p;
          if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
          prev = p;
        }
        lens.push(len);
      }
      const ref = lens.at(-1);
      for (const l of lens) assert.ok(Math.abs(l - ref) < 2e-3 * ref + 1e-4, `${fam} barbe ${b} : ${l} ≠ ${ref}`);
    }
  }
});

test('le calendrier est monotone : croissance, déroulement, agrafage, courbure, pose, usure', () => {
  for (const L of [3, 6, 12]) {
    let pg = -1, pb = -1, ps = -1, pw = -1;
    for (let u = 0; u <= 1; u += 1 / 2000) {
      const g = growth(u, L), b = bendAt(u), s = settleAt(u), w = wearAt(u);
      assert.ok(g >= pg - 1e-12 && b >= pb - 1e-12 && s >= ps - 1e-12 && w >= pw - 1e-12, `u = ${u}`);
      pg = g; pb = b; ps = s; pw = w;
    }
    assert.ok(growth(0, L) === 0 && Math.abs(growth(1, L) - 1) < 1e-12);
  }
  // le front de déroulement descend de la pointe à la base, sans jamais remonter
  for (let s = 0; s < 1; s += 0.05) assert.ok(releaseAt(s) >= releaseAt(s + 0.05));
  // l'agrafage ne se défait jamais (sauf l'usure, à la fin)
  for (const s of [0.3, 0.6, 0.9]) {
    let pz = -1;
    for (let u = 0; u <= 0.85; u += 1 / 1000) { const z = zipAt(u, s, 0.5); assert.ok(z >= pz - 1e-12); pz = z; }
  }
  // tout est ouvert, agrafé et courbé quand la plume a pris sa place dans la gerbe
  assert.ok(unroll(SCHED.settle[1], 0) > 0.999 && zipAt(SCHED.settle[1], 0, 1) > 0.999 && bendAt(SCHED.settle[1]) > 0.999);
  // l'ancienne plume est chassée avant que la nouvelle ne pousse vraiment
  assert.ok(SCHED.fall[1] <= SCHED.grow[0] + 1e-9);
});

test('la boucle se referme : la plume à u = 1 est la plume couchée et usée du début', () => {
  for (const fam of Object.keys(FAMILIES)) {
    const P = shapeOf(fam, createRng(`seam-${fam}`));
    const T = barbTable(P, 'seam');
    const S1 = { ...S0(P, 1, 1), k: 0.1 };
    const S1b = { ...S0(P, 1 - 1e-9, wearAt(1 - 1e-9)), k: 0.1 };
    for (let b = 0; b < T.length / BARB_STRIDE; b += 9) {
      const B = barb(T, b);
      for (const t of [0, 0.5, 1]) {
        const a = barbPose(B, t, 0.5, 1, S1).p, c = barbPose(B, t, 0.5, 1, S1b).p;
        assert.ok(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) < 1e-5, `${fam}`);
      }
    }
    // à u = 0, la nouvelle plume est entièrement dans le follicule
    for (let b = 0; b < T.length / BARB_STRIDE; b += 9) assert.ok(barbPose(barb(T, b), 1, 0, 0, S0(P, 0)).hidden);
    assert.ok(sinkAt(0, P.L, P.calamus, P.over) >= P.L);
  }
});

// ── La gerbe ────────────────────────────────────────────────────────────────
const SEEDS = [['1', {}], ['6', {}], ['7', {}], ['0', {}], ['2', {}], ['g1', { family: 'vexille' }], ['g2', { family: 'plume' }], ['g3', { family: 'ocelle' }]];
const sceneOf = (seed, over) => { const R = generate(seed, over); return { R, lay: layoutBouquet(R.shape, R.seed), tables: { hero: barbTable(R.shape, R.seed) } }; };

test('la gerbe : à l’angle d’or, deux plumes nées l’une après l’autre sont loin l’une de l’autre', () => {
  const { lay } = sceneOf('1', {});
  for (let i = 1; i < lay.N; i++) {
    const d = Math.abs(((lay.follicles[i].az - lay.follicles[i - 1].az + Math.PI) % (2 * Math.PI)) - Math.PI);
    assert.ok(d > 2, `${i} : ${d}`);
  }
  assert.ok(Math.abs(GOLDEN - 2.39996) < 1e-4);
  // à chaque instant, une plume au moins se déplie
  for (let u = 0; u < 1; u += 0.01) assert.ok(lay.follicles.some((f) => { const a = ageOf(lay, f.i, u); return a > SCHED.front[0] && a < SCHED.front[1]; }), `u = ${u}`);
  // l'inclinaison ne revient jamais en arrière
  for (const fam of Object.keys(GERBE)) { let p = -1; for (let a = 0; a <= 1; a += 0.001) { const l = leanAt(GERBE[fam], a); assert.ok(l >= p - 1e-12); p = l; } }
});

test('le relais : au raccord d’un follicule, l’ancienne prend exactement la pose de la courante', () => {
  for (const [seed, over] of SEEDS) {
    const { R, lay } = sceneOf(seed, over);
    for (const f of lay.follicles) {
      const cur = frameAt(lay, f, 1 - 1e-9), old = oldPose(lay, f, 0, R.shape);
      assert.ok(Math.hypot(...cur.p.map((v, i) => v - old.p[i])) < 1e-6, seed);
      assert.ok(Math.abs(Math.abs(cur.q.reduce((s, v, i) => s + v * old.q[i], 0)) - 1) < 1e-6, seed);
    }
    // et toute la scène boucle
    const a = bouquetState(R, lay, 0.3), b = bouquetState(R, lay, 1.3);
    a.forEach((o, i) => assert.ok(Math.hypot(...o.p.map((v, k) => v - b[i].p[k])) < 1e-9 && o.vis === b[i].vis));
  }
});

test('la chute : l’ancienne glisse hors du follicule, bascule, glisse sur le socle et sort du cadre, sans saut', () => {
  for (const [seed, over] of SEEDS) {
    const { R, lay } = sceneOf(seed, over);
    const P = R.shape, f = lay.follicles[0];
    // pendant la poussée : le long de son axe, de la longueur de son calamus au plus
    const p0 = oldPose(lay, f, 0, P).p, p1 = oldPose(lay, f, SCHED.push[1], P).p;
    assert.ok(Math.hypot(...p0.map((v, i) => v - p1[i])) <= 0.85 * P.calamus * P.L * f.scale + 1e-9);
    // continue : à 60 i/s, son follicule bouge de moins de 1,5 L par seconde de film
    const dt = 1 / (R.loop.duration * 60);
    let prev = null, worst = 0, py = Infinity;
    for (let a = 0; a < SCHED.fall[1] + 0.08; a += dt) {
      const o = oldPose(lay, f, a, P);
      if (prev) worst = Math.max(worst, Math.hypot(...o.p.map((v, i) => v - prev[i])));
      if (a > SCHED.push[1] + 0.01) { assert.ok(o.p[1] <= py + 1e-9, `${seed} : elle remonte`); py = o.p[1]; }
      prev = o.p;
    }
    assert.ok(worst < 0.03 * P.L * 8, `${seed} : ${worst.toFixed(3)} cm par image`);
    // retirée hors du cadre, avant que la boucle ne la redemande
    assert.ok(bouquetState(R, lay, 0).filter((o) => o.kind === 'old' && o.f === 0).every((o) => o.vis) && oldPose(lay, f, SCHED.fall[1] + 0.08, P).vis === 0, seed);
  }
});

test('rien ne traverse rien : toutes les plumes de la gerbe, sur toute la boucle', () => {
  // parties pleines (vexilles agrafés, disque de l'œil, rachis), hors du pied
  // duveteux de la gerbe : au plus 0,6 mm pour les vexilles, le duvet et le
  // paon. L'autruche, dont seuls les rachis sont pleins : deux rachis se
  // frôlent encore un instant (≤ 5,5 mm, sur un ou deux centièmes de boucle).
  // Le socle : rien à plus de 1,5 mm sous la couche de duvet, dans le cadre.
  for (const [seed, over] of SEEDS) {
    const { R, lay, tables } = sceneOf(seed, over);
    const max = R.family === 'plume' ? 0.55 : R.family === 'ocelle' ? 0.08 : 0.06;
    let worst = { depth: 0 }, at = 0, body = 0;
    for (let i = 0; i < 100; i++) {
      const c = bouquetCrossings(R, lay, i / 100, tables);
      body = Math.max(body, c.body);
      if (c.depth > worst.depth) { worst = c; at = i / 100; }
    }
    assert.ok(worst.depth < max, `${seed} (${R.family}) : traversée de ${worst.depth.toFixed(3)} cm à u = ${at.toFixed(2)} (${worst.pair})`);
    assert.ok(body < 0.15, `${seed} (${R.family}) : ${body.toFixed(3)} cm dans le socle`);
  }
});

test('le mouvement est continu : à 60 i/s, aucune partie pleine ne saute', () => {
  // (les fils libres du paon et de l'autruche, roulés sur plusieurs tours, se
  // déroulent d'un coup de fouet : c'est leur geste, il n'est pas mesuré ici)
  for (const [seed, over] of SEEDS.slice(0, 5)) {
    const { R, lay, tables } = sceneOf(seed, over);
    const dt = 1 / (R.loop.duration * 60);
    let worst = 0, where = '';
    for (let k = 0; k < 120; k++) {
      const u = k / 120;
      const A = bouquetState(R, lay, u), B = bouquetState(R, lay, u + dt);
      for (let j = 0; j < A.length; j++) {
        if (!A[j].vis || !B[j].vis || A[j].kind === 'old') continue;
        const la = featherLines(R.shape, tables.hero, A[j], lay, { nt: 4, every: 7, skipPlum: false });
        const lb = featherLines(R.shape, tables.hero, B[j], lay, { nt: 4, every: 7, skipPlum: false });
        if (la.length !== lb.length) continue; // (une barbe qui sort du follicule)
        la.forEach((l, i) => l.solid && l.forEach((w, m) => { const v = lb[i][m]; if (!v || l.length !== lb[i].length) return; const d = Math.hypot(w[0] - v[0], w[1] - v[1], w[2] - v[2]); if (d > worst) { worst = d; where = `u=${u.toFixed(3)} ${A[j].kind}${A[j].f}`; } }));
      }
    }
    // (le rebond élastique du déroulement est le plus rapide : moins de 2 mm par image)
    assert.ok(worst < 0.2, `${seed} : ${worst.toFixed(3)} cm (${where})`);
  }
});

test('la caméra est périodique, lente, sans à-coup', () => {
  for (const seed of ['c1', 'c2', 'c3', 'c4']) {
    const R = generate(seed);
    const C = cameraPath(R);
    const a = C.at(0), b = C.at(1 - 1e-9);
    assert.ok(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) < 1e-5);
    const dt = 1 / (R.loop.duration * 120);
    let prev = null, prevW = null, peak = 0, peakAcc = 0;
    for (let u = 0; u < 1; u += dt) {
      const c = C.at(u);
      const d = c.target.map((v, i) => v - c.pos[i]), l = Math.hypot(...d);
      const n = d.map((v) => v / l);
      if (prev) {
        const w = Math.acos(Math.min(1, n[0] * prev[0] + n[1] * prev[1] + n[2] * prev[2])) * 180 / Math.PI * 120;
        peak = Math.max(peak, w);
        if (prevW !== null) peakAcc = Math.max(peakAcc, Math.abs(w - prevW) * 120);
        prevW = w;
      }
      prev = n;
    }
    assert.ok(peak < 12, `${seed} : ${peak.toFixed(1)}°/s`);
    assert.ok(a.focusDist > 0 && Math.abs(a.focusDist - b.focusDist) < 1e-5);
    assert.ok(peakAcc < 60, `${seed} : accélération ${peakAcc.toFixed(1)}°/s²`);
  }
});

test('le motif du collier : déterministe, non trivial, périodique autour du tube', () => {
  for (const k of Object.keys(PROGRAMS).filter((k) => k !== 'plain')) {
    const a = simulateCollar(k, 'm1', { nx: 64, nz: 96 }), b = simulateCollar(k, 'm1', { nx: 64, nz: 96 });
    assert.deepEqual(a, b);
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    const v = a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length;
    assert.ok(v > 1e-3, `${k} : variance ${v}`);
  }
  const t = featherTexture({ program: 'bars', cover: 0.3 }, 'x', { nx: 64, nz: 96 });
  assert.equal(t.data.length, 64 * 96 * 4);
  // les barres : la couverture demandée est respectée (à 10 % près)
  let dark = 0;
  for (let i = 0; i < 64 * 96; i++) dark += t.data[i * 4] > 127;
  assert.ok(Math.abs(dark / (64 * 96) - 0.3) < 0.1);
});

test('le geste des familles : quatre mouvements distincts', () => {
  // vexille : agrafé à la fin ; ocelle : fils libres en bas, œil agrafé en haut ;
  // duvet : radial ; plume : jamais agrafée
  const fz = (fam) => { const P = shapeOf(fam, createRng(fam)); const T = barbTable(P, fam); let z = 0, n = 0; for (let b = 0; b < T.length / BARB_STRIDE; b++) { z += T[b * BARB_STRIDE + 11]; n++; } return { P, z: z / n }; };
  const v = fz('vexille'), o = fz('ocelle'), d = fz('duvet'), p = fz('plume');
  assert.ok(v.z > 0.6 && o.z > 0.05 && o.z < 0.5 && p.z === 0 && d.z === 0 && d.P.radial && !p.P.radial);
  void barbArc;
});
