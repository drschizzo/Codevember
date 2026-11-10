// La plante : croissance, folioles qui ne se traversent jamais pendant le
// pli, pétioles qui tombent sans rien toucher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growPlant, PLANTS, leafletFrames, interpFrame, leafletPoint, leafletHalfWidth, LEAFLET, pinnaPose, leafPoints, v3, halfPoint, halfWidthOf } from '../src/gen/plant.js';
import { containerShape, outerRadius } from '../src/container.js';
import { limitDroop } from '../src/plan.js';
import { makeGrid } from '../src/grid.js';

const KINDS = Object.keys(PLANTS);

test('croissance : déterministe, assez de feuilles, aucun NaN', () => {
  for (const k of KINDS) for (const s of ['p1', 'p2']) {
    const a = growPlant({ kind: k, seed: s }), b = growPlant({ kind: k, seed: s });
    assert.deepEqual(JSON.stringify(a.leaves.map((L) => L.base)), JSON.stringify(b.leaves.map((L) => L.base)));
    assert.ok(a.leaves.length >= (k === 'seedling' || k === 'dionaea' ? 5 : k === 'oxalis' ? 6 : 10), `${k}/${s} : ${a.leaves.length} feuilles`);
    for (const L of a.leaves) for (const x of [...L.base, ...L.tip, ...L.dir]) assert.ok(Number.isFinite(x));
  }
});

// une foliole (repère, longueur, largeur) : points du gabarit, et test « ce
// point traverse-t-il la nappe de l'autre foliole ? »
function blade(F, base, len, wid, half = null, sg = 1) {
  const [X, Y, Z] = F;
  const toW = (u, v) => { const p = half ? halfPoint(half, u, Math.abs(v), sg) : leafletPoint(u, v); return v3.add(base, v3.add(v3.add(v3.mul(X, p[0] * len), v3.mul(Y, p[1] * wid)), v3.mul(Z, p[2] * wid))); };
  const toL = (q) => { const d = v3.sub(q, base); return [v3.dot(d, X) / len, v3.dot(d, Y) / wid, v3.dot(d, Z) / wid]; };
  return { toW, toL, half, sg };
}
function crosses(A, B) {
  // signe de la distance (le long de Z) des points de A à la nappe de B, sur
  // la partie de A qui est au-dessus du contour de B
  let pos = 0, neg = 0;
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 6; j++) {
    const q = A.toW(0.03 + (0.97 * i) / 16, A.half ? 0.08 + (0.92 * j) / 6 : -1 + (2 * j) / 6);
    const [u, y, z] = B.toL(q);
    if (u < 0.02 || u > 1) continue;
    let zs;
    if (B.half) {
      // (demi-limbe : du bon côté de la nervure, hors de la charnière commune)
      const hw = halfWidthOf(B.half, u);
      if (y * B.sg < 0.05 * hw || Math.abs(y) > hw) continue;
      zs = halfPoint(B.half, u, Math.abs(y) / Math.max(hw, 1e-6))[2];
    } else {
      const hw = leafletHalfWidth(u, y);
      if (Math.abs(y) > hw) continue;
      zs = leafletPoint(u, y / Math.max(hw, 1e-6))[2];
    }
    const d = z - zs;
    if (d > 1e-5) pos++; else if (d < -1e-5) neg++;
  }
  return pos > 0 && neg > 0;
}

test('le pli : deux folioles voisines ne se traversent à aucun instant', () => {
  for (const k of ['bush', 'bijuga', 'biophytum', 'oxalis', 'dionaea']) {
    const P = growPlant({ kind: k, seed: 'fold' });
    for (const L of P.leaves.slice(0, 6)) for (const Pn of L.pinnae) {
      const pr = pinnaPose(Pn, 0);
      const t = pr.t, n = pr.n, y = v3.cross(n, t);
      const leaflets = [];
      for (const q of Pn.pairs) for (const sg of [1, -1]) {
        const F = leafletFrames(t, n, sg, Pn.fold ?? Pn.down);
        const base = v3.add(v3.add(L.tip, v3.mul(t, q.s * Pn.len)), v3.mul(y, sg * LEAFLET.rachisR));
        leaflets.push({ F, base, q, sg });
      }
      for (let f = 0; f <= 1.0001; f += 0.1) {
        const half = Pn.fold?.shape ?? null;
        const B = leaflets.map((l) => blade(interpFrame(l.F, f), l.base, l.q.len, l.q.wid, half, l.sg));
        for (let i = 0; i < B.length; i++) for (let j = i + 1; j < Math.min(B.length, i + 6); j++) {
          assert.ok(!crosses(B[i], B[j]) && !crosses(B[j], B[i]), `${k} feuille ${L.id} : folioles ${i} et ${j} se traversent à f = ${f.toFixed(1)}`);
        }
      }
    }
  }
});

test('le vrai pli (trèfle, dionée) : les deux moitiés du limbe ne se traversent jamais', async () => {
  const { HALF, foldPoint, foldAngle, trapFlip } = await import('../src/gen/plant.js');
  const G = await import('../src/gen/build.js');
  for (const [fam, F] of Object.entries(HALF)) {
    const tpl = G.halfTemplate(false, F.shape);
    for (let f = 0; f <= 1.2001; f += 0.1) {
      const th = foldAngle(F, f);
      for (let i = 0; i < tpl.position.length; i += 3) {
        const v = tpl.leafuv[i + 1];
        if (Math.abs(v) > 1.01) continue; // (les cils s'entrecroisent : décalés d'un demi-pas)
        const dz = F.shape === 'trap' ? trapFlip(tpl.leafuv[i], Math.max(-1, Math.min(1, v)), f) : 0;
        const q = foldPoint([tpl.position[i], tpl.position[i + 1], tpl.position[i + 2] + dz], th);
        // chaque moitié reste de son côté du plan de la nervure
        assert.ok(q[1] * Math.sign(tpl.position[i + 1] || v || 1) >= -2e-3, `${fam} : la moitié traverse à f = ${f.toFixed(1)}`);
      }
    }
  }
});

test('pendant tout le pli, aucune feuille ne touche une autre feuille ni un pétiole', () => {
  for (const kind of ['bush', 'oxalis', 'biophytum', 'dionaea']) for (const seed of ['whr8od', 'm2']) {
    const P = growPlant({ kind, seed });
    const others = (fo) => { const g = makeGrid(0.04); for (const M of P.leaves) { const q = leafPoints(M, fo, fo, 0, true); for (let j = 0; j < q.length; j += 3) g.add([q[j], q[j + 1], q[j + 2]], M.id); } return g; };
    const G0 = others(0), G1 = others(1);
    for (const L of P.leaves) for (let f = 0.125; f < 1; f += 0.125) {
      const pts = leafPoints(L, f, f, 0, true);
      for (let i = 0; i < pts.length; i += 3) {
        const p = [pts[i], pts[i + 1], pts[i + 2]];
        for (const G of [G0, G1]) { const q = G.any(p, 0.006, (t) => t === L.id); assert.ok(!q, `${kind}/${seed} : la feuille ${L.id} touche la feuille ${q?.[3]} à f = ${f}`); }
      }
    }
  }
});

test('le pétiole tombe sans toucher la terre, le pot, ni une autre feuille', () => {
  for (const [k, c] of [['bush', 'terracotta'], ['trailing', 'cloche'], ['bijuga', 'ward'], ['biophytum', 'bonsai']]) {
    const P = growPlant({ kind: k, seed: 'droop' });
    const E = P.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + 0.5), 0.6);
    const S = containerShape(c, P.H, E);
    limitDroop(P, S);
    const others = makeGrid(0.05);
    for (const M of P.leaves) for (const [fl, dp] of [[0, 0], [1, 0]]) { const q = leafPoints(M, fl, fl, dp, true); for (let j = 0; j < q.length; j += 3) others.add([q[j], q[j + 1], q[j + 2]], M.id); }
    for (const L of P.leaves) {
      const pts = leafPoints(L, 1, 1, L.droopFrac * 1.22, true);
      for (let i = 0; i < pts.length; i += 3) {
        const p = [pts[i], pts[i + 1], pts[i + 2]], rho = Math.hypot(p[0], p[2]);
        assert.ok(p[1] > S.tableY + 0.02, `${k} : sous la table`);
        assert.ok(!(rho < S.rimR && p[1] < S.rimY + 0.01), `${k} feuille ${L.id} : dans le pot`);
        assert.ok(!(rho >= S.rimR && p[1] < S.rimY && rho < outerRadius(S, p[1])), `${k} : dans la paroi`);
      }
      // aucune autre feuille, ouverte ou fermée, à moins de 1 cm
      for (let i = 0; i < pts.length; i += 3) {
        const q = others.any([pts[i], pts[i + 1], pts[i + 2]], 0.01, (tag) => tag === L.id);
        assert.ok(!q, `${k} : la feuille ${L.id} touche la feuille ${q?.[3]}`);
      }
    }
  }
});
