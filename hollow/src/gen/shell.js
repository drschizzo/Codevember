// Maillage d'une coquille sphérique percée, avec une vraie épaisseur.
//
// Chaque cellule du pavage est percée d'un trou : son contour est rétréci de
// la demi-largeur du barreau (barreaux d'égale largeur partout), puis arrondi
// d'un rayon de congé (0 : trou polygonal, 1 : trou circulaire). Le trou
// traverse l'épaisseur radialement ; ses arêtes reçoivent un biseau arrondi
// ou un chanfrein plat, qui accrochent la lumière.
//
// Le maillage est construit en « stations » : pour chaque point du contour de
// la cellule, un profil qui part du bord de la cellule sur la face externe,
// rejoint le trou, descend le biseau, la paroi, le biseau intérieur, et
// remonte la face interne. Deux stations consécutives forment une bande de
// quadrilatères ; une station « coupée » duplique les sommets (changement de
// finition, arête vive).
//
// Attributs : position, normal, tangent (direction du brossage : cercles de
// latitude autour de l'axe z local), surf (u8×4 normalisés : poids des
// finitions externe / interne / tranche, et proximité du bord du trou).

import { norm, dot, cross, add, sub, scale, tangentFrame, edgeSteps, angle } from './cells.js';

const { sqrt, cos, sin, PI, max, min, abs, ceil, floor } = Math;

// Détail par niveau : 0 = héros, 1 = moyen, 2 = lointain / ombres
export const LODS = [
  { spacing: 0.022, bevelSegs: 3, faceSeg: 0.07 },
  { spacing: 0.036, bevelSegs: 2, faceSeg: 0.14 },
  { spacing: 0.075, bevelSegs: 0, faceSeg: 0.3 },
];

// ── Tampons extensibles ──────────────────────────────────────────────────────
class Buffers {
  constructor(cap = 1 << 15) {
    this.n = 0; this.cap = cap; this.ni = 0; this.icap = cap * 2;
    this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3);
    this.tan = new Float32Array(cap * 4); this.surf = new Uint8Array(cap * 4);
    this.idx = new Uint32Array(this.icap);
  }
  grow() {
    const g = (a, k) => { const b = new a.constructor(this.cap * 2 * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nor = g(this.nor, 3); this.tan = g(this.tan, 4); this.surf = g(this.surf, 4);
    this.cap *= 2;
  }
  vert(p, n, s0, s1, s2, s3) {
    if (this.n === this.cap) this.grow();
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    this.pos[i3] = p[0]; this.pos[i3 + 1] = p[1]; this.pos[i3 + 2] = p[2];
    this.nor[i3] = n[0]; this.nor[i3 + 1] = n[1]; this.nor[i3 + 2] = n[2];
    // brossage circulaire autour de z : t = z × n
    let tx = -n[1], ty = n[0];
    const l = sqrt(tx * tx + ty * ty);
    if (l < 1e-5) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
    this.tan[i4] = tx; this.tan[i4 + 1] = ty; this.tan[i4 + 2] = 0; this.tan[i4 + 3] = 1;
    this.surf[i4] = s0; this.surf[i4 + 1] = s1; this.surf[i4 + 2] = s2; this.surf[i4 + 3] = s3;
    return i;
  }
  tri(a, b, c) {
    if (this.ni + 3 > this.icap) { const b2 = new Uint32Array(this.icap * 2); b2.set(this.idx); this.idx = b2; this.icap *= 2; }
    this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c;
  }
  // bande fermée entre deux anneaux de M sommets ; orientation choisie pour
  // que les faces regardent du côté des normales
  strip(A, B, M) {
    let s = 0;
    for (let k = 0; k < M; k++) {
      const a0 = A + k, a1 = A + (k + 1) % M, b1 = B + (k + 1) % M;
      const u = this.sub3(a1, a0), v = this.sub3(b1, a0), c = cross(u, v);
      s += c[0] * (this.nor[a0 * 3] + this.nor[b1 * 3]) + c[1] * (this.nor[a0 * 3 + 1] + this.nor[b1 * 3 + 1]) + c[2] * (this.nor[a0 * 3 + 2] + this.nor[b1 * 3 + 2]);
    }
    const flip = s < 0;
    for (let k = 0; k < M; k++) {
      const a0 = A + k, a1 = A + (k + 1) % M, b0 = B + k, b1 = B + (k + 1) % M;
      if (flip) { this.tri(a0, b1, a1); this.tri(a0, b0, b1); } else { this.tri(a0, a1, b1); this.tri(a0, b1, b0); }
    }
  }
  fan(A, C, M) {
    let s = 0;
    for (let k = 0; k < M; k++) {
      const a0 = A + k, a1 = A + (k + 1) % M, c = cross(this.sub3(a1, a0), this.sub3(C, a0));
      s += c[0] * this.nor[C * 3] + c[1] * this.nor[C * 3 + 1] + c[2] * this.nor[C * 3 + 2];
    }
    for (let k = 0; k < M; k++) {
      const a0 = A + k, a1 = A + (k + 1) % M;
      if (s < 0) this.tri(a0, C, a1); else this.tri(a0, a1, C);
    }
  }
  sub3(i, j) { const p = this.pos; return [p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]]; }
  result() {
    return {
      position: this.pos.slice(0, this.n * 3), normal: this.nor.slice(0, this.n * 3),
      tangent: this.tan.slice(0, this.n * 4), surf: this.surf.slice(0, this.n * 4),
      index: this.idx.slice(0, this.ni),
    };
  }
}

// ── Géométrie plane (repère gnomonique de la cellule) ────────────────────────
const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const centroid2 = (P) => {
  if (P.length < 3) return P.reduce((m, p) => [m[0] + p[0] / P.length, m[1] + p[1] / P.length], [0, 0]);
  let cx = 0, cy = 0, A = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], w = a[0] * b[1] - b[0] * a[1];
    A += w; cx += (a[0] + b[0]) * w; cy += (a[1] + b[1]) * w;
  }
  return abs(A) < 1e-14 ? P[0] : [cx / (3 * A), cy / (3 * A)];
};

// intersection de demi-plans : arêtes de P (sens trigo) décalées vers
// l'intérieur de d[k] ; découpe de Sutherland–Hodgman d'un grand carré
function inset(P, d) {
  let S = [[-9, -9], [9, -9], [9, 9], [-9, 9]];
  for (let k = 0; k < P.length && S.length; k++) {
    const A = P[k], B = P[(k + 1) % P.length];
    let nx = -(B[1] - A[1]), ny = B[0] - A[0];
    const l = sqrt(nx * nx + ny * ny);
    if (l < 1e-12) continue;
    nx /= l; ny /= l;
    const f = (p) => (p[0] - A[0]) * nx + (p[1] - A[1]) * ny - (typeof d === 'number' ? d : d[k]);
    const out = [];
    for (let i = 0; i < S.length; i++) {
      const p = S[i], q = S[(i + 1) % S.length], fp = f(p), fq = f(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    S = out;
  }
  return S.length >= 3 && area2(S) > 1e-10 ? S : null;
}

// point le plus proche de x sur le polygone convexe P (ou sur P s'il est dégénéré)
function closest(P, x) {
  if (P.length === 1) return P[0];
  let inside = P.length >= 3;
  let best = null, bd = Infinity;
  for (let k = 0; k < P.length; k++) {
    const A = P[k], B = P[(k + 1) % P.length];
    const ex = B[0] - A[0], ey = B[1] - A[1];
    if (inside && ex * (x[1] - A[1]) - ey * (x[0] - A[0]) < 0) inside = false;
    const L = ex * ex + ey * ey;
    const t = L > 0 ? max(0, min(1, ((x[0] - A[0]) * ex + (x[1] - A[1]) * ey) / L)) : 0;
    const q = [A[0] + ex * t, A[1] + ey * t], dd = (q[0] - x[0]) ** 2 + (q[1] - x[1]) ** 2;
    if (dd < bd) { bd = dd; best = q; }
  }
  return inside ? x : best;
}
const dist2 = (a, b) => sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);

// ── Préparation des cellules (indépendante du niveau de détail) ──────────────
// Calcule pour chaque cellule son repère, son contour plan et la forme de son
// trou (polygone noyau P2 + rayon de congé rc). Partagé par les trois LOD et
// par le placement des cristaux.
export function prepareCells(cells, spec, noise, rng) {
  const out = [];
  const gAxis = norm(spec.gradAxis || [0, 0, 1]);
  for (const cell of cells) {
    const c = cell.c, [e1, e2] = tangentFrame(c);
    let pts = cell.pts, ins = cell.ins;
    const g = (p) => { const w = dot(p, c); return [dot(p, e1) / w, dot(p, e2) / w]; };
    let P = pts.map(g);
    if (area2(P) < 0) { // sens trigo exigé
      pts = [...pts].reverse(); P = [...P].reverse();
      ins = [...ins.slice(0, -1).reverse(), ins[ins.length - 1]];
    }
    const info = { c, e1, e2, pts, P, closed: true, P2: null, rc: 0, portal: cell.portal };
    out.push(info);
    // demi-largeur du barreau, modulée par le champ de bruit et le gradient
    let w;
    if (cell.portal) w = spec.portalRim / 2;
    else {
      const n = noise.fbm(c[0] * spec.barFreq + 11, c[1] * spec.barFreq - 7, c[2] * spec.barFreq + 3, 3);
      const field = 1 + spec.barVar * n * 2 + spec.barGrad * dot(c, gAxis);
      w = (spec.bar / 2) * max(0.25, field);
      if (rng.next() < spec.closed) continue; // cellule pleine
    }
    const P1 = inset(P, ins.map((f) => f * w));
    if (!P1) continue;
    const O1 = centroid2(P1);
    let rho = Infinity;
    for (let k = 0; k < P1.length; k++) {
      const A = P1[k], B = P1[(k + 1) % P1.length], ex = B[0] - A[0], ey = B[1] - A[1], l = sqrt(ex * ex + ey * ey);
      if (l > 1e-12) rho = min(rho, abs((O1[0] - A[0]) * ey - (O1[1] - A[1]) * ex) / l);
    }
    if (!(rho > spec.minHole)) continue;
    const round = cell.portal ? 1 : spec.round;
    const rc = round * rho * 0.97;
    const P2 = inset(P1, rc) || [O1];
    Object.assign(info, { closed: false, P2, rc, O: centroid2(P2) });
  }
  return out;
}

// le point plan x est-il dans le trou de la cellule ? (avec une marge)
export const inHole = (info, x, margin = 0) => !info.closed && dist2(closest(info.P2, x), x) < info.rc + margin;

// ── Maillage ─────────────────────────────────────────────────────────────────
export function buildShell(prepared, spec, lod) {
  const L = LODS[lod];
  const R = 1, Ri = 1 - spec.thickness;
  const sharp = L.bevelSegs === 0 || spec.bevel <= 1e-5;
  const B = new Buffers(lod === 0 ? 1 << 18 : 1 << 15);
  const OUT = [255, 0, 0], IN = [0, 255, 0], EDGE = [0, 0, 255];
  const u8 = (x) => Math.round(max(0, min(1, x)) * 255);

  for (const info of prepared) {
    const { c, e1, e2, pts } = info;
    // contour échantillonné (mêmes points que la cellule voisine)
    const Q = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], n = edgeSteps(a, b, L.spacing);
      for (let s = 0; s < n; s++) Q.push(norm(add(a, scale(sub(b, a), s / n))));
    }
    const M = Q.length;

    if (info.closed) { // cellule pleine : deux éventails subdivisés (la sphère reste ronde)
      let rmax = 0;
      for (const q of Q) rmax = max(rmax, angle(q, c));
      const K = max(0, ceil(rmax / L.faceSeg) - 1);
      for (const side of [0, 1]) {
        const r = side ? Ri : R, sg = side ? -1 : 1, S = side ? IN : OUT;
        let prev = -1;
        for (let i = 0; i <= K; i++) {
          const t = i / (K + 1), start = B.n;
          for (const q of Q) { const d = norm(add(scale(q, 1 - t), scale(c, t))); B.vert(scale(d, r), scale(d, sg), S[0], S[1], S[2], u8(t)); }
          if (prev >= 0) B.strip(prev, start, M);
          prev = start;
        }
        const C = B.vert(scale(c, r), scale(c, sg), S[0], S[1], S[2], 255);
        B.fan(prev, C, M);
      }
      continue;
    }

    // profil de chaque échantillon : point du trou (h), normale de la paroi (nw)
    const prof = Q.map((q) => {
      const w = dot(q, c), q2 = [dot(q, e1) / w, dot(q, e2) / w];
      const dir = [q2[0] - info.O[0], q2[1] - info.O[1]];
      // le point du rayon O→q2 à distance rc du noyau : dichotomie (distance croissante)
      let lo = 0, hi = 1;
      for (let it = 0; it < 22; it++) {
        const m = (lo + hi) / 2, x = [info.O[0] + dir[0] * m, info.O[1] + dir[1] * m];
        if (dist2(closest(info.P2, x), x) < info.rc) lo = m; else hi = m;
      }
      const h2 = [info.O[0] + dir[0] * lo, info.O[1] + dir[1] * lo];
      const cp = closest(info.P2, h2);
      let nx = cp[0] - h2[0], ny = cp[1] - h2[1];
      const nl = sqrt(nx * nx + ny * ny);
      if (nl < 1e-9) { nx = -dir[0]; ny = -dir[1]; } // (trou réduit à un point)
      const h = norm(add(c, add(scale(e1, h2[0]), scale(e2, h2[1]))));
      let nw = add(scale(e1, nx), scale(e2, ny));
      nw = norm(sub(nw, scale(h, dot(nw, h))));
      return { q, h, nw };
    });

    // biseau : limité par l'épaisseur et par la largeur du barreau
    let minBar = Infinity;
    for (const p of prof) minBar = min(minBar, angle(p.q, p.h));
    const b = sharp ? 0 : min(spec.bevel, spec.thickness * 0.45, minBar * 0.6);
    let fmax = 0;
    for (const p of prof) fmax = max(fmax, minBar > 0 ? angle(p.q, p.h) : 0);
    const K = max(0, ceil(fmax / L.faceSeg) - 1);

    // stations : [position, normale, surf, prox, relié à la précédente]
    const stations = (p) => {
      const { q, h, nw } = p, S = [];
      const st = (pos, n, s, prox, link) => S.push([pos, n, s, prox, link]);
      // face externe
      const F = sub(scale(h, R), scale(nw, b)), fd = norm(F);
      st(scale(q, R), q, OUT, 0, false);
      for (let i = 1; i <= K; i++) { const d = norm(add(scale(q, 1 - i / (K + 1)), scale(fd, i / (K + 1)))); st(scale(d, R), d, OUT, i / (K + 1), true); }
      st(F, fd, OUT, 1, true);
      // biseau externe → paroi → biseau interne
      if (b === 0) {
        st(scale(h, R), nw, EDGE, 1, false);
        st(scale(h, Ri), nw, EDGE, 1, true);
      } else if (spec.chamfer) {
        const n1 = norm(add(nw, h)), n2 = norm(sub(nw, h));
        st(F, n1, EDGE, 1, false); st(scale(h, R - b), n1, EDGE, 1, true);
        st(scale(h, R - b), nw, EDGE, 1, false); st(scale(h, Ri + b), nw, EDGE, 1, true);
        st(scale(h, Ri + b), n2, EDGE, 1, false); st(sub(scale(h, Ri), scale(nw, b)), n2, EDGE, 1, true);
      } else {
        const nb = L.bevelSegs, oc = sub(scale(h, R - b), scale(nw, b)), ic = sub(scale(h, Ri + b), scale(nw, b));
        for (let i = 0; i <= nb; i++) {
          const a = (PI / 2) * (1 - i / nb), n = add(scale(nw, cos(a)), scale(h, sin(a)));
          st(add(oc, scale(n, b)), n, EDGE, 1, i > 0);
        }
        for (let i = 0; i <= nb; i++) {
          const a = (PI / 2) * (i / nb), n = sub(scale(nw, cos(a)), scale(h, sin(a)));
          st(add(ic, scale(n, b)), n, EDGE, 1, true);
        }
      }
      // face interne
      const Fi = sub(scale(h, Ri), scale(nw, b)), fi = norm(Fi);
      st(Fi, scale(fi, -1), IN, 1, false);
      for (let i = K; i >= 1; i--) { const d = norm(add(scale(q, 1 - i / (K + 1)), scale(fi, i / (K + 1)))); st(scale(d, Ri), scale(d, -1), IN, i / (K + 1), true); }
      st(scale(q, Ri), scale(q, -1), IN, 0, true);
      return S;
    };

    const all = prof.map(stations), NS = all[0].length;
    let prev = -1;
    for (let s = 0; s < NS; s++) {
      const start = B.n;
      for (let k = 0; k < M; k++) { const [p, n, S, prox] = all[k][s]; B.vert(p, n, S[0], S[1], S[2], u8(prox)); }
      if (all[0][s][4] && prev >= 0) B.strip(prev, start, M);
      prev = start;
    }
  }
  return B.result();
}
