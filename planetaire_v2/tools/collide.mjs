// Contrôle des collisions de la machine, indépendant de sa conception : on fait
// tourner les chaînes sur une période et l'on teste chaque élément vertical
// (axe de pivot qui monte d'un bras au suivant, colonne de galet qui descend au
// plateau, goupille d'astre) contre chaque dalle (bras, contrepoids, train)
// qu'il traverse en hauteur, et chaque paire de dalles à la même hauteur.
//
//   node tools/collide.mjs [première graine] [nombre] [N imposé]
import { search, ARM_TOL } from '../src/orbit/search.js';
import { epicycles } from '../src/scene/epicycles.js';
import { designMachine, SLAB } from '../src/mech/design.js';

const TAU = Math.PI * 2;
const first = Number(process.argv[2] ?? 0), count = Number(process.argv[3] ?? 40), forceN = process.argv[4] ? Number(process.argv[4]) : null;
const SHAFT_R = 0.009, COL_R = 0.008, PIN_R = 0.007, SAMPLES = 400;

const pointSeg = (px, py, s) => {
  const vx = s[2] - s[0], vy = s[3] - s[1], l2 = vx * vx + vy * vy || 1e-12;
  const u = Math.max(0, Math.min(1, ((px - s[0]) * vx + (py - s[1]) * vy) / l2));
  return Math.hypot(px - s[0] - u * vx, py - s[1] - u * vy);
};
const segSeg = (a, b) => Math.min(pointSeg(a[0], a[1], b), pointSeg(a[2], a[3], b), pointSeg(b[0], b[1], a), pointSeg(b[2], b[3], a),
  (() => { const c = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const A0 = [a[0], a[1]], A1 = [a[2], a[3]], B0 = [b[0], b[1]], B1 = [b[2], b[3]];
    return c(A0, A1, B0) * c(A0, A1, B1) < 0 && c(B0, B1, A0) * c(B0, B1, A1) < 0 ? 0 : Infinity; })());

export function check(D) {
  const { n, N, L, cw, halfW, level, base, supports } = D;
  const y0 = (i, j) => base[i] + level[i][j] * SLAB; // bas de la dalle
  const P = new Float64Array(2 * n + 2);
  const hits = { shaft: 0, column: 0, pin: 0, slab: 0 };
  const worst = new Set();
  for (let s = 0; s < SAMPLES; s++) {
    const t = (TAU * s) / SAMPLES;
    const piv = [], seg = [];
    for (let j = 0; j < N; j++) {
      D.pivots(t + (TAU * j) / N, P);
      piv.push(Float64Array.from(P));
      seg.push(Array.from({ length: n }, (_, i) => {
        const x0 = P[2 * i], yy0 = P[2 * i + 1], x1 = P[2 * i + 2], y1 = P[2 * i + 3];
        const ux = (x1 - x0) / (L[i] || 1), uy = (y1 - yy0) / (L[i] || 1);
        return [x0 - ux * cw[i], yy0 - uy * cw[i], x1, y1];
      }));
    }
    // distance d'un point à la vraie forme d'une dalle : la barre (capsule du
    // contrepoids au bout), le contrepoids, et les roues du train qu'elle porte
    const slabDist = (x, y, j2, i2) => {
      const sg = seg[j2][i2];
      let d = pointSeg(x, y, sg) - D.barW[i2] / 2;
      const x0 = piv[j2][2 * i2], y0p = piv[j2][2 * i2 + 1], ux = (piv[j2][2 * i2 + 2] - x0) / (L[i2] || 1), uy = (piv[j2][2 * i2 + 3] - y0p) / (L[i2] || 1);
      d = Math.min(d, Math.hypot(x - (x0 - ux * cw[i2]), y - (y0p - uy * cw[i2])) - Math.max(0.006, D.barW[i2] * 0.95));
      const tr = D.trains[i2 + 1];
      if (tr) for (const g of tr.gears) d = Math.min(d, Math.hypot(x - (x0 + ux * g.x), y - (y0p + uy * g.x)) - (g.r + tr.m));
      return d;
    };
    // éléments verticaux : [x, y, bas, haut, rayon, chaîne, type]
    const verts = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < n - 1; i++) verts.push([piv[j][2 * i + 2], piv[j][2 * i + 3], y0(i, j) + 0.002, y0(i + 1, j) + 0.002, SHAFT_R, j, 'shaft', i]);
      verts.push([piv[j][2 * n], piv[j][2 * n + 1], y0(n - 1, j) + 0.002, D.height + 0.05, PIN_R, j, 'pin', n - 1]);
      supports.forEach((us, a) => (us || []).forEach((u) => {
        const x = piv[j][2 * a] + u * (piv[j][2 * a + 2] - piv[j][2 * a]), y = piv[j][2 * a + 1] + u * (piv[j][2 * a + 3] - piv[j][2 * a + 1]);
        verts.push([x, y, -0.05, y0(a, j) - 0.002, COL_R, j, 'column', a]);
      }));
    }
    for (const [x, y, lo, hi, r, j, kind, own] of verts) {
      for (let j2 = 0; j2 < N; j2++) for (let i2 = 0; i2 < n; i2++) {
        if (j2 === j && (i2 === own || i2 === own + 1 || (kind === 'column' && i2 <= own))) continue; // (sa propre chaîne)
        if (i2 === 0) continue; // (l'étoile tourne avec tout : pas d'axe qui la traverse hors de sa chaîne)
        const b = y0(i2, j2), t2 = b + SLAB * 0.9;
        if (t2 <= lo || b >= hi) continue;
        // (même axe que le pivot de cette dalle : montage coaxial, pas une collision)
        if (Math.hypot(x - piv[j2][2 * i2], y - piv[j2][2 * i2 + 1]) < 1e-6) continue;
        if (slabDist(x, y, j2, i2) < r) { hits[kind]++; worst.add(`${kind} ${own}/${j} × ${i2}/${j2}`); }
      }
    }
    for (let i = 1; i < n; i++) for (let j = 0; j < N; j++) for (let j2 = j + 1; j2 < N; j2++) {
      if (level[i][j] !== level[i][j2]) continue;
      if (segSeg(seg[j][i], seg[j2][i]) < 2 * halfW[i]) { hits.slab++; worst.add(`slab ${i} ${j}×${j2}`); }
    }
  }
  return { hits, pairs: worst.size, sample: [...worst].slice(0, 4) };
}

if (process.argv[1]?.endsWith('collide.mjs')) {
  let tot = 0, bad = 0;
  for (let sd = first; sd < first + count; sd++) {
    const r = search(String(sd), { maxAttempts: 24, over: { maxArms: 14, ...(forceN && { N: forceN, sym: null }) } });
    if (!r.ok) continue;
    const o = r.orbit, k = 1 / o.info.size;
    const coef = Float64Array.from(o.coef, (v) => v * k);
    const epi = epicycles(coef, o.params, 1, { tol: ARM_TOL, max: 14 });
    const D = designMachine(epi.arms, o.params.N);
    const c = check(D);
    tot++;
    const n = c.hits.shaft + c.hits.column + c.hits.pin + c.hits.slab;
    if (n) bad++;
    console.log(`${sd}\tN=${o.params.N}\tbras=${D.n}\tcoll(design)=${D.collisions}\tpénétrations=${n}\t${JSON.stringify(c.hits)}\t${c.sample.join(' ; ')}`);
  }
  console.log(`\n${bad}/${tot} machines avec pénétrations`);
}
