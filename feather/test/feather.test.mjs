// Invariants du cœur : déroulement isométrique, calendrier monotone, raccord
// de la boucle, contact de la poussée, plumage sans interpénétration, caméra
// lente et périodique, motif du collier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/recipe.js';
import { FAMILIES } from '../src/families.js';
import { createRng } from '../src/rng.js';
import {
  shapeOf, barbTable, barbPose, barbArc, BARB_STRIDE, SCHED, growth, unroll, zipAt, releaseAt, bendAt, settleAt, wearAt,
  layoutPlumage, featherFrame, bendOf, tubeRadius, betaAt, bodyFrame, qrot, LIE, ejection, sinkAt,
} from '../src/gen/feather.js';
import { cameraPath } from '../src/camera.js';
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
  // tout est ouvert, agrafé et courbé avant que la plume se couche
  assert.ok(unroll(SCHED.settle[0], 0) > 0.999 && zipAt(SCHED.settle[0], 0, 1) > 0.999 && bendAt(SCHED.settle[0]) > 0.97);
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
    assert.ok(Math.abs(betaAt(1) - (Math.PI / 2 - LIE.eps)) < 1e-12 && sinkAt(0, P.L, P.calamus, P.over) >= P.L);
  }
});

test('la poussée : la base de l’ancienne plume repose exactement sur la pointe du tuyau', () => {
  for (const fam of ['vexille', 'plume']) {
    const P = shapeOf(fam, createRng(`push-${fam}`));
    const lay = layoutPlumage(P, 'push');
    for (let u = 0; u <= SCHED.push[1]; u += SCHED.push[1] / 20) {
      const ej = ejection(u, P, lay);
      // hauteur de la pointe du tuyau au-dessus de la peau : longueur émergée
      const tip = Math.max(0, P.L - sinkAt(u, P.L, P.calamus, P.over));
      assert.ok(Math.abs(ej.base - tip) < 1e-6, `u = ${u} : ${ej.base} ≠ ${tip}`);
    }
    // ensuite elle s'en va, vers la queue, et finit hors du plumage visible
    const late = ejection(SCHED.fall[1], P, lay);
    assert.ok(late.gone && late.th > lay.thH);
    // elle glisse vers la queue, de plus en plus vite, sans jamais remonter
    let pth = -1;
    for (let u = SCHED.fall[0]; u <= SCHED.fall[1]; u += 0.002) { const e = ejection(u, P, lay); assert.ok(e.th >= pth); pth = e.th; }
  }
});

test('le plumage : les rangées se recouvrent comme des tuiles, sans se traverser', () => {
  for (const fam of ['vexille', 'ocelle', 'plume']) {
    const P = shapeOf(fam, createRng(`tile-${fam}`));
    const lay = layoutPlumage(P, 'tile');
    const k = bendOf(P, lay.Rd);
    // hauteur au-dessus du corps du rachis couché : croît avec la distance au follicule
    const fr = featherFrame(lay.Rd, lay.thH, 0, betaAt(1), LIE.omega);
    let prev = -1;
    for (let s = 0.2; s <= 1; s += 0.1) {
      const y = s * P.L - sinkAt(1, P.L, P.calamus, P.over), kk = k;
      const loc = [0, Math.sin(kk * y) / kk, -(1 - Math.cos(kk * y)) / kk];
      const w = qrot(fr.q, loc).map((v, i) => v + fr.p[i]);
      const h = Math.hypot(w[0], w[1] + lay.Rd, w[2]) - lay.Rd;
      assert.ok(h > 0 && h > prev - 1e-9, `${fam} s = ${s} : h = ${h}`);
      prev = h;
    }
    // aucune tuile ne recouvre le follicule de la plume héroïne (la fente)
    const root = bodyFrame(lay.Rd, lay.thH, 0).p;
    for (const t of lay.tiles.filter((t) => t.k === -1)) {
      const f = featherFrame(lay.Rd, t.th, t.ph, betaAt(1), LIE.omega);
      const tipLoc = qrot(f.q, [0, P.L * 0.9, 0]).map((v, i) => v + f.p[i]);
      const lat = Math.abs(tipLoc[0] - root[0]);
      assert.ok(lat > Math.max(0.25, P.radial ? 0 : P.W * 0.12), `${fam} : tuile au-dessus du follicule (${lat})`);
    }
  }
});

test('la plume ne passe jamais sous le plumage (points témoins à pas fixe)', () => {
  for (const fam of ['vexille', 'ocelle', 'plume']) {
    const R = generate('pen', { family: fam });
    const P = R.shape, lay = layoutPlumage(P, R.seed);
    const T = barbTable(P, R.seed);
    const k = bendOf(P, lay.Rd);
    const mouth = 2.2 * Math.max(...Array.from({ length: 21 }, (_, i) => tubeRadius(P, i / 20))) + 0.1;
    let worst = Infinity, where = '';
    for (let u = 0.15; u <= 1; u += 0.025) {
      const fr = featherFrame(lay.Rd, lay.thH, 0, betaAt(u), LIE.omega * settleAt(u));
      const g = qrot([-fr.q[0], -fr.q[1], -fr.q[2], fr.q[3]], [0, -1, 0]);
      const S = { u, L: P.L, k, wear: wearAt(u), g, radial: P.radial, cal: P.calamus, over: P.over };
      for (let b = 0; b < T.length / BARB_STRIDE; b += 3) {
        const B = barb(T, b);
        for (let i = 1; i <= 8; i++) {
          const r = barbPose(B, i / 8, 0, 0, S);
          if (r.hidden) continue;
          const w = qrot(fr.q, r.p).map((v, j) => v + fr.p[j]);
          // (la bouche du follicule : la peau s'y enroule autour du tuyau)
          if (Math.hypot(w[0] - fr.p[0], w[1] - fr.p[1], w[2] - fr.p[2]) < mouth) continue;
          const h = Math.hypot(w[0], w[1] + lay.Rd, w[2]) - lay.Rd;
          if (h < worst) { worst = h; where = `u=${u.toFixed(3)} b=${b} s0=${B[0].toFixed(2)} plum=${B[7].toFixed(2)} t=${i / 8}`; }
        }
      }
    }
    // (le corps est dessiné 1,5 mm sous la sphère de référence : la peau sous le duvet)
    assert.ok(worst > -0.15, `${fam} : ${worst.toFixed(3)} cm sous la surface du corps (${where})`);
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
    assert.ok(peak < 25, `${seed} : ${peak.toFixed(1)}°/s`);
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
