// Maillage de rendu de la membrane : chaque triangle simulé est découpé en n²
// triangles, dont les sommets sont posés par le vertex shader sur le patch
// cubique des triangles PN (Vlachos et al., 2001), défini par les positions et
// normales de ses trois particules (voir scene/membrane.js). Les silhouettes et
// les lambeaux enroulés restent courbes, n² fois plus fins que le maillage
// simulé.
//
// Un sommet de rendu = trois particules (attribut tri) et ses barycentriques
// (bary : poids des deux dernières ; le premier vaut 1 − somme). Un sommet de
// coin ou d'arête est écrit sous une forme canonique, la même depuis les deux
// triangles qui le partagent — coin : (i, i, i) ; arête : (min, max, min), le
// poids du troisième étant nul. Le shader calcule alors exactement la même
// position des deux côtés : aucune fissure.
//
// Lèvres : un anneau de LIP_RING sommets par particule de couture (écrits par
// la pose à la suite des particules), relié d'une particule à la suivante le
// long des arêtes de bord par des bandes découpées comme les arêtes de la
// membrane (même courbe PN, mêmes n tronçons).

import { V3 } from './geo.js';

export const LIP_RING = 5;

// src : { ctri, nt, np, rest, boundary, lipOf, nl } ; n : découpage d'une arête
export function renderMesh({ ctri, nt, np, rest, boundary, lipOf, nl }, n) {
  const tri = [], bary = [], rst = [], kind = [];
  const lipPart = new Int32Array(nl);
  for (let p = 0; p < np; p++) if (lipOf[p] >= 0) lipPart[lipOf[p]] = p;
  // particule (ou sommet de lèvre, indice ≥ np) → position au repos
  const R = (i) => { const p = i < np ? i : lipPart[Math.floor((i - np) / LIP_RING)]; return [rest[p * 3], rest[p * 3 + 1], rest[p * 3 + 2]]; };
  const kindOf = (i) => (i < np ? 0 : 1);
  const add = (a, b, c, wb, wc, r, k) => { tri.push(a, b, c); bary.push(wb, wc); rst.push(...r); kind.push(k); return kind.length - 1; };

  const corners = new Map();
  const corner = (i) => {
    let v = corners.get(i);
    if (v === undefined) { v = add(i, i, i, 0, 0, R(i), kindOf(i)); corners.set(i, v); }
    return v;
  };
  // k-ième point (1 … n − 1) de l'arête a → b
  const edges = new Map();
  const edgePoint = (a, b, k) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), key = `${lo}_${hi}`;
    let base = edges.get(key);
    if (base === undefined) {
      base = kind.length;
      for (let q = 1; q < n; q++) add(lo, hi, lo, q / n, 0, V3.norm(V3.add(V3.mul(R(lo), 1 - q / n), V3.mul(R(hi), q / n))), kindOf(lo));
      edges.set(key, base);
    }
    return base + (a === lo ? k : n - k) - 1;
  };
  const index = [];

  // ── Triangles ──
  for (let t = 0; t < nt; t++) {
    const A = ctri[t * 3], B = ctri[t * 3 + 1], C = ctri[t * 3 + 2];
    const RA = R(A), RB = R(B), RC = R(C);
    // (i, j) : poids de B et de C, en n-ièmes
    const grid = [];
    for (let i = 0; i <= n; i++) {
      grid[i] = [];
      for (let j = 0; i + j <= n; j++) {
        let v;
        if (i === 0 && j === 0) v = corner(A);
        else if (i === n) v = corner(B);
        else if (j === n) v = corner(C);
        else if (j === 0) v = edgePoint(A, B, i);
        else if (i === 0) v = edgePoint(A, C, j);
        else if (i + j === n) v = edgePoint(B, C, j);
        else {
          const wb = i / n, wc = j / n, wa = 1 - wb - wc;
          v = add(A, B, C, wb, wc, V3.norm(V3.add(V3.add(V3.mul(RA, wa), V3.mul(RB, wb)), V3.mul(RC, wc))), 0);
        }
        grid[i][j] = v;
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; i + j < n; j++) {
      index.push(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
      if (i + j < n - 1) index.push(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
  }

  // ── Lèvres ──
  const directed = new Set();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) directed.add(ctri[t * 3 + k] * 1048576 + ctri[t * 3 + ((k + 1) % 3)]);
  const strip = (a, b) => Array.from({ length: n + 1 }, (_, s) => (s === 0 ? corner(a) : s === n ? corner(b) : edgePoint(a, b, s)));
  for (const [a, b] of boundary) {
    const la = np + lipOf[a] * LIP_RING, lb = np + lipOf[b] * LIP_RING;
    const flip = !directed.has(a * 1048576 + b);
    for (let k = 0; k + 1 < LIP_RING; k++) {
      const r0 = strip(la + k, lb + k), r1 = strip(la + k + 1, lb + k + 1);
      for (let s = 0; s < n; s++) {
        const q = [r0[s], r0[s + 1], r1[s + 1], r1[s]];
        if (flip) index.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        else index.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      }
    }
  }

  return { n, tri: Float32Array.from(tri), bary: Float32Array.from(bary), rest: Float32Array.from(rst), kind: Uint8Array.from(kind), index: Uint32Array.from(index) };
}
