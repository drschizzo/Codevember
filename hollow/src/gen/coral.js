// Corail de Turing : un motif de réaction-diffusion (Gray-Scott) qui pousse
// sur la sphère — labyrinthes de corail cerveau, taches, vers, mitoses selon
// les taux d'alimentation F et de mort k — puis taillé dans la coquille et
// maillé comme les surfaces minimales (tpms.js).
//
// La simulation tourne sur une icosphère (graphe de voisinage : laplacien
// « moyenne des voisins − valeur », comme sur une grille) ; le champ est lu en
// tout point par interpolation exacte sur le réseau triangulaire de la face
// d'icosaèdre qui contient la direction (projection gnomonique).

import { createRng } from '../rng.js';
import { buildImplicit } from './tpms.js';

const { sqrt, abs, max, min } = Math;

// taux (F, k) : motifs classiques
export const CORAL_PATTERNS = {
  coral: [0.0545, 0.062], maze: [0.029, 0.057], worms: [0.078, 0.061], spots: [0.03, 0.062], mitosis: [0.0367, 0.0649],
};

const t = (1 + sqrt(5)) / 2;
const ICO = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
  .map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
const FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

// réseau de l'icosphère de fréquence f : sommets (dédoublonnés), table (i, j) → sommet par face, voisins
function lattice(f) {
  const verts = [], key = new Map(), faces = [];
  const vid = (x, y, z) => {
    const l = Math.hypot(x, y, z), k = `${Math.round((x / l) * 1e5)},${Math.round((y / l) * 1e5)},${Math.round((z / l) * 1e5)}`;
    let i = key.get(k);
    if (i === undefined) { i = verts.length; verts.push([x / l, y / l, z / l]); key.set(k, i); }
    return i;
  };
  for (const [a, b, c] of FACES) {
    const A = ICO[a], B = ICO[b], C = ICO[c], ids = [];
    for (let i = 0; i <= f; i++) {
      ids[i] = [];
      for (let j = 0; j <= f - i; j++) {
        const u = i / f, w = j / f;
        ids[i][j] = vid(A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * w, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * w, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * w);
      }
    }
    // normale du plan de la face (pour la projection gnomonique)
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    faces.push({ A, e1, e2, n, ids });
  }
  const nb = verts.map(() => new Set());
  for (const F of faces) for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
    const tri = [[F.ids[i][j], F.ids[i + 1][j], F.ids[i][j + 1]]];
    if (j < f - i - 1) tri.push([F.ids[i + 1][j], F.ids[i + 1][j + 1], F.ids[i][j + 1]]);
    for (const [p, q, r] of tri) { nb[p].add(q).add(r); nb[q].add(p).add(r); nb[r].add(p).add(q); }
  }
  // voisinage compact (CSR)
  const off = new Uint32Array(verts.length + 1);
  nb.forEach((s, i) => { off[i + 1] = off[i] + s.size; });
  const adj = new Uint32Array(off[verts.length]);
  nb.forEach((s, i) => { let k = off[i]; for (const j of s) adj[k++] = j; });
  return { verts, faces, off, adj, f };
}

// Gray-Scott (Du = 1, Dv = 0,5, pas 1), départ : quelques germes aléatoires
function simulate(L, F, k, iters, rng) {
  const n = L.verts.length, { off, adj } = L;
  let u = new Float32Array(n).fill(1), v = new Float32Array(n);
  let u2 = new Float32Array(n), v2 = new Float32Array(n);
  for (let s = 0; s < 40; s++) {
    const d = rng.dir(), r = rng.range(0.06, 0.14);
    for (let i = 0; i < n; i++) {
      const p = L.verts[i];
      if (p[0] * d[0] + p[1] * d[1] + p[2] * d[2] > Math.cos(r)) { u[i] = 0.5; v[i] = 0.25 + rng.next() * 0.05; }
    }
  }
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let su = 0, sv = 0;
      const a = off[i], b = off[i + 1];
      for (let j = a; j < b; j++) { su += u[adj[j]]; sv += v[adj[j]]; }
      const m = b - a, ui = u[i], vi = v[i], uvv = ui * vi * vi;
      u2[i] = ui + (su / m - ui) - uvv + F * (1 - ui);
      v2[i] = vi + 0.5 * (sv / m - vi) + uvv - (F + k) * vi;
    }
    [u, u2] = [u2, u]; [v, v2] = [v2, v];
  }
  return v;
}

// lecture du champ simulé en une direction (interpolation sur le réseau)
function sampler(L, v) {
  const { faces, f } = L;
  // (face la plus probable d'abord : celle dont le centre est le plus proche)
  const cen = faces.map((F) => { const c = [0, 1, 2].map((k) => F.A[k] + (F.e1[k] + F.e2[k]) / 3), l = Math.hypot(...c); return c.map((x) => x / l); });
  return (x, y, z) => {
    let best = 0, bd = -2;
    for (let i = 0; i < 20; i++) { const d = x * cen[i][0] + y * cen[i][1] + z * cen[i][2]; if (d > bd) { bd = d; best = i; } }
    for (let o = 0; o <= 20; o++) {
      const F = faces[o === 0 ? best : o - 1];
      const dn = x * F.n[0] + y * F.n[1] + z * F.n[2];
      if (dn <= 0) continue;
      const s = (F.A[0] * F.n[0] + F.A[1] * F.n[1] + F.A[2] * F.n[2]) / dn;
      const px = x * s - F.A[0], py = y * s - F.A[1], pz = z * s - F.A[2];
      // coordonnées (u, w) dans la base (e1, e2)
      const d11 = F.e1[0] * F.e1[0] + F.e1[1] * F.e1[1] + F.e1[2] * F.e1[2], d12 = F.e1[0] * F.e2[0] + F.e1[1] * F.e2[1] + F.e1[2] * F.e2[2];
      const d22 = F.e2[0] * F.e2[0] + F.e2[1] * F.e2[1] + F.e2[2] * F.e2[2];
      const p1 = px * F.e1[0] + py * F.e1[1] + pz * F.e1[2], p2 = px * F.e2[0] + py * F.e2[1] + pz * F.e2[2];
      const den = d11 * d22 - d12 * d12, u = (p1 * d22 - p2 * d12) / den, w = (p2 * d11 - p1 * d12) / den;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      const fu = min(f - 1e-6, max(0, u * f)), fw = min(f - 1e-6, max(0, w * f));
      let i = Math.floor(fu), j = Math.floor(fw);
      if (i + j > f - 1) { if (i > 0) i = f - 1 - j; else j = f - 1 - i; }
      const a = fu - i, b = fw - j;
      const ids = F.ids;
      // (dernière rangée : seul le triangle inférieur existe)
      if (a + b <= 1 || i + j >= f - 1) { const s2 = max(1, a + b); return v[ids[i][j]] * (1 - (a + b) / s2) + v[ids[i + 1][j]] * (a / s2) + v[ids[i][j + 1]] * (b / s2); }
      return v[ids[i + 1][j + 1]] * (a + b - 1) + v[ids[i + 1][j]] * (1 - b) + v[ids[i][j + 1]] * (1 - a);
    }
    return 0;
  };
}

const cache = new Map();
function pattern(spec) {
  const key = `${spec.seed}|${spec.pattern}|${spec.scale}|${spec.iters}`;
  if (!cache.has(key)) {
    const L = lattice(Math.round(spec.scale));
    const [F, k] = CORAL_PATTERNS[spec.pattern] ?? CORAL_PATTERNS.coral;
    cache.set(key, sampler(L, simulate(L, F, k, spec.iters, createRng(`${spec.seed}:coral`))));
    if (cache.size > 4) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

// champ implicite : coquille ∩ motif (réseau : là où v > seuil ; feuille :
// parois le long de l'isoligne), adouci par un maximum lisse, oculus alésé
export function coralField(spec) {
  const R = 1, Ri = 1 - spec.thickness, Rm = (R + Ri) / 2, half = spec.thickness / 2;
  const sample = pattern(spec);
  const k = 0.03, G = 6; // (congé ; pente typique du motif, pour une distance approchée)
  const portalR = Math.tan(spec.portal), portalCos = Math.cos(spec.portal);
  const smax = (a, b) => { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; };
  const field = (x, y, z, out) => {
    const r = sqrt(x * x + y * y + z * z) || 1e-9;
    const s = abs(r - Rm) - half;
    const vv = sample(x / r, y / r, z / r);
    const t = (spec.sheet ? abs(vv - spec.threshold) - spec.wall : spec.threshold - vv) / G;
    let d = smax(s, t);
    const cyl = max((sqrt(x * x + y * y) - portalR * (z / R)) * portalCos, -z);
    d = smax(d, -cyl);
    if (out) { out[0] = d; out[1] = s > t ? 0 : 1; out[2] = r; out[3] = s; out[4] = t; }
    return d;
  };
  // gradient : différences centrées (le motif n'a pas d'expression analytique)
  const e = 0.002;
  const fieldGrad = (x, y, z, Gv) => {
    Gv[0] = field(x + e, y, z) - field(x - e, y, z);
    Gv[1] = field(x, y + e, z) - field(x, y - e, z);
    Gv[2] = field(x, y, z + e) - field(x, y, z - e);
    return field(x, y, z);
  };
  return { field, fieldGrad, Rm, half, k };
}

export const buildCoral = (spec, lod) => buildImplicit(coralField(spec), lod);
