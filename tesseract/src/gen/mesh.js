// Tampons de maillage et primitives, partagés par tous les constructeurs.
//
// Attributs : position, normal, tangent (direction du brossage), surf (u8×4
// normalisés : poids des finitions externe / interne / tranche, et un tirage
// propre à la pièce — chaque latte, chaque barre a sa nuance), pat
// (coordonnées du motif dans le repère de la pièce), anchor (centre de la
// face d'un panneau : il s'ajoure quand cette face regarde l'œil 4D).
//
// Les triangles sont orientés d'après les normales des sommets (sens direct
// vu du côté de la normale) : l'orientation est cohérente dans tout le
// maillage, quelle que soit la symétrie qui a servi à placer une pièce. C'est
// indispensable ici : une cellule projetée depuis la 4D peut être vue en miroir
// (retournement), et le shader s'appuie sur le sens des faces (voir
// scene/project.js).

const { sqrt, PI, cos, sin, abs, max, min, sign } = Math;

export const OUT = [255, 0, 0], IN = [0, 255, 0], EDGE = [0, 0, 255];

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

export class Buffers {
  constructor(cap = 1 << 14) {
    this.n = 0; this.cap = cap; this.ni = 0; this.icap = cap * 2;
    this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3);
    this.tan = new Float32Array(cap * 4); this.surf = new Uint8Array(cap * 4); this.pat = new Float32Array(cap * 3); this.anc = new Float32Array(cap * 3);
    this.anchor = [0, 0, 0]; // point d'ancrage de la pièce (centre de la face d'un panneau) : voir scene/project.js
    this.patOff = [0, 0, 0]; // décalage des coordonnées du motif (chaque face a son propre veinage)
    this.idx = new Uint32Array(this.icap);
    this.piece = 0; // tirage de la pièce en cours (0..255)
    this.xf = null; // transformation appliquée aux sommets qui suivent : { o, X, Y, Z } (repère)
  }
  grow() {
    const g = (a, k) => { const b = new a.constructor(this.cap * 2 * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nor = g(this.nor, 3); this.tan = g(this.tan, 4); this.surf = g(this.surf, 4); this.pat = g(this.pat, 3); this.anc = g(this.anc, 3);
    this.cap *= 2;
  }
  // repère courant (les primitives sont construites dans un repère local)
  frame(o, X, Y, Z) { this.xf = { o, X, Y, Z }; }
  noFrame() { this.xf = null; }
  _p(p) { const f = this.xf; return f ? [f.o[0] + f.X[0] * p[0] + f.Y[0] * p[1] + f.Z[0] * p[2], f.o[1] + f.X[1] * p[0] + f.Y[1] * p[1] + f.Z[1] * p[2], f.o[2] + f.X[2] * p[0] + f.Y[2] * p[1] + f.Z[2] * p[2]] : p; }
  _v(v) { const f = this.xf; return f ? norm([f.X[0] * v[0] + f.Y[0] * v[1] + f.Z[0] * v[2], f.X[1] * v[0] + f.Y[1] * v[1] + f.Z[1] * v[2], f.X[2] * v[0] + f.Y[2] * v[1] + f.Z[2] * v[2]]) : v; }
  vert(p, n, s, t = null) {
    if (this.n === this.cap) this.grow();
    const i = this.n++, i3 = i * 3, i4 = i * 4;
    const P = this._p(p), N = this._v(n);
    this.pos[i3] = P[0]; this.pos[i3 + 1] = P[1]; this.pos[i3 + 2] = P[2];
    this.nor[i3] = N[0]; this.nor[i3 + 1] = N[1]; this.nor[i3 + 2] = N[2];
    // tangente : donnée, sinon une direction quelconque du plan tangent
    let T = t ? this._v(t) : null;
    if (!T) { const a = abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; T = norm(cross(cross(N, a), N)); }
    // (projetée dans le plan tangent)
    const d = dot(T, N);
    T = norm([T[0] - N[0] * d, T[1] - N[1] * d, T[2] - N[2] * d]);
    this.tan[i4] = T[0]; this.tan[i4 + 1] = T[1]; this.tan[i4 + 2] = T[2]; this.tan[i4 + 3] = 1;
    this.surf[i4] = s[0]; this.surf[i4 + 1] = s[1]; this.surf[i4 + 2] = s[2]; this.surf[i4 + 3] = this.piece;
    // coordonnées du motif : dans le repère de la pièce (une plaque a son motif
    // dans son plan, quelle que soit la face qu'elle occupe)
    this.anc[i3] = this.anchor[0]; this.anc[i3 + 1] = this.anchor[1]; this.anc[i3 + 2] = this.anchor[2];
    this.pat[i3] = p[0] + this.patOff[0]; this.pat[i3 + 1] = p[1] + this.patOff[1]; this.pat[i3 + 2] = p[2] + this.patOff[2];
    return i;
  }
  same(i, j) { const p = this.pos, a = i * 3, b = j * 3; return p[a] === p[b] && p[a + 1] === p[b + 1] && p[a + 2] === p[b + 2]; }
  tri(a, b, c) {
    if (this.same(a, b) || this.same(b, c) || this.same(c, a)) return;
    // orientation d'après les normales des sommets
    const P = this.pos, N = this.nor;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const s = gx * (N[a * 3] + N[b * 3] + N[c * 3]) + gy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + gz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (this.ni + 3 > this.icap) { const b2 = new Uint32Array(this.icap * 2); b2.set(this.idx); this.idx = b2; this.icap *= 2; }
    if (s < 0) { this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = b; } else { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  // grille de sommets (rangées de même longueur) → quadrilatères
  grid(rows, closedU = false) {
    for (let j = 0; j + 1 < rows.length; j++) {
      const A = rows[j], B = rows[j + 1], M = A.length;
      for (let i = 0; i < (closedU ? M : M - 1); i++) this.quad(A[i], A[(i + 1) % M], B[(i + 1) % M], B[i]);
    }
  }
  out() {
    return {
      position: this.pos.slice(0, this.n * 3), normal: this.nor.slice(0, this.n * 3), tangent: this.tan.slice(0, this.n * 4),
      surf: this.surf.slice(0, this.n * 4), pat: this.pat.slice(0, this.n * 3), anchor: this.anc.slice(0, this.n * 3), index: this.idx.slice(0, this.ni),
    };
  }
}

// ── Balayage d'un profil le long d'un segment ────────────────────────────────
// profile : tronçons [{ a: [u, v], b: [u, v], na, nb, s }] (arêtes vives : un
// tronçon par face plane ; arrondis : normales lissées) ; le profil est dans
// le plan (U, V), balayé de t0 à t1 le long de A, avec nSeg subdivisions (la
// projection 4D courbe les barres gonflées : il faut des sommets le long).
export function sweep(B, profile, o, A, U, V, t0, t1, nSeg) {
  for (const seg of profile) {
    const rows = [];
    for (let k = 0; k <= nSeg; k++) {
      const t = t0 + ((t1 - t0) * k) / nSeg;
      const row = [];
      for (const [p, n] of [[seg.a, seg.na], [seg.b, seg.nb]]) {
        const P = add(add(add(o, mul(A, t)), mul(U, p[0])), mul(V, p[1]));
        const N = add(mul(U, n[0]), mul(V, n[1]));
        row.push(B.vert(P, N, seg.s, A));
      }
      rows.push(row);
    }
    B.grid(rows);
  }
}

// Profil fermé à partir d'une suite de points (sens trigonométrique) :
// chaque côté est plan (normale sortante), sa finition est donnée.
export function polyProfile(pts, surfs) {
  const out = [];
  // (sens quelconque : la normale est retournée pour sortir du profil)
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const o = area >= 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    const n = [(o * d[1]) / l, (-o * d[0]) / l];
    out.push({ a, b, na: n, nb: n, s: surfs[i] });
  }
  return out;
}
// arc lissé (congé ou cercle) : centre c, rayon r, de l'angle a0 à a1, k pas
export function arcProfile(c, r, a0, a1, k, s, inward = false) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const t0 = a0 + ((a1 - a0) * i) / k, t1 = a0 + ((a1 - a0) * (i + 1)) / k;
    const n0 = [cos(t0), sin(t0)], n1 = [cos(t1), sin(t1)];
    out.push({ a: [c[0] + r * n0[0], c[1] + r * n0[1]], b: [c[0] + r * n1[0], c[1] + r * n1[1]], na: inward ? n0.map((x) => -x) : n0, nb: inward ? n1.map((x) => -x) : n1, s });
  }
  return out;
}

// ── Boîte arrondie (pavé de demi-côtés h, rayon de congé r) ──────────────────
// Chaque face du pavé est quadrillée (plat subdivisé, congé en pas d'angle
// réguliers) ; un point q de la face est envoyé sur la surface arrondie :
// p = c(q) + r·(q − c(q))/|q − c(q)|, c(q) : q ramené dans le pavé intérieur.
// Deux faces voisines produisent exactement les mêmes points le long de leur
// arête commune (même q) : aucune fissure. Les congés reçoivent la finition
// « tranche » (polie), les plats la finition externe. nSub : pas sur un plat
// de longueur 1 (la projection 4D courbe les grands plats : il faut des sommets).
export function roundedBox(B, c, h, r, nSub = 6, edgeSurf = EDGE, flatSurf = OUT, tangent = null) {
  r = Math.min(r, h[0], h[1], h[2]);
  const I = [h[0] - r, h[1] - r, h[2] - r];
  const steps = (ax) => {
    const out = [], nf = Math.max(1, Math.ceil(nSub * I[ax]));
    const fil = r > 1e-5 ? [3, 2, 1].map((k) => I[ax] + r * Math.tan((PI / 4) * (k / 3))) : [];
    for (const x of fil) out.push(-x);
    for (let i = 0; i <= nf; i++) out.push(-I[ax] + (2 * I[ax] * i) / nf);
    for (const x of fil.reverse()) out.push(x);
    return out;
  };
  const S = [steps(0), steps(1), steps(2)];
  for (const [ax, u, v] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) for (const s of [-1, 1]) {
    const rows = [];
    for (const qv of S[v]) {
      const row = [];
      for (const qu of S[u]) {
        const q = [0, 0, 0];
        q[ax] = s * h[ax]; q[u] = qu; q[v] = qv;
        const cq = q.map((x, i) => Math.max(-I[i], Math.min(I[i], x)));
        const d = sub(q, cq);
        const n = r > 1e-5 ? norm(d) : (() => { const z = [0, 0, 0]; z[ax] = s; return z; })();
        const P = add(c, add(cq, mul(n, r)));
        const curved = Math.abs(qu) > I[u] + 1e-6 || Math.abs(qv) > I[v] + 1e-6;
        row.push(B.vert(P, n, curved ? edgeSurf : typeof flatSurf === 'function' ? flatSurf(n) : flatSurf, tangent));
      }
      rows.push(row);
    }
    B.grid(rows);
  }
}

// ── Sphère UV (axe z) ────────────────────────────────────────────────────────
export function sphere(B, c, r, nu = 32, nv = 18, s = OUT) {
  const rows = [];
  for (let j = 0; j <= nv; j++) {
    const th = (PI * j) / nv, row = [];
    for (let i = 0; i < nu; i++) {
      const ph = (2 * PI * i) / nu;
      const n = [sin(th) * cos(ph), sin(th) * sin(ph), cos(th)];
      row.push(B.vert(add(c, mul(n, r)), n, s, [-sin(ph), cos(ph), 0]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
}

// ── Tore (axe z), rayon R, section r ─────────────────────────────────────────
export function torus(B, c, R, r, nu = 64, nv = 16, s = OUT) {
  const rows = [];
  for (let j = 0; j <= nv; j++) {
    const th = (2 * PI * j) / nv, row = [];
    for (let i = 0; i < nu; i++) {
      const ph = (2 * PI * i) / nu;
      const d = [cos(ph), sin(ph), 0], n = [cos(th) * d[0], cos(th) * d[1], sin(th)];
      row.push(B.vert(add(c, add(mul(d, R), mul(n, r))), n, s, [-sin(ph), cos(ph), 0]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
}

// ── Tube le long d'une courbe ────────────────────────────────────────────────
// pts : points de la courbe ; r : rayon ; repère de transport parallèle ; bouts
// fermés par des calottes hémisphériques
export function tube(B, pts, r, nr = 12, s = OUT, caps = true) {
  const M = pts.length;
  const T = pts.map((_, i) => norm(sub(pts[Math.min(M - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let N = norm(cross(T[0], abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const rows = [];
  for (let i = 0; i < M; i++) {
    if (i > 0) { N = norm(cross(cross(T[i], N), T[i])); }
    const Bn = cross(T[i], N), row = [];
    for (let k = 0; k < nr; k++) {
      const a = (2 * PI * k) / nr, n = add(mul(N, cos(a)), mul(Bn, sin(a)));
      row.push(B.vert(add(pts[i], mul(n, r)), n, s, T[i]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  if (caps) for (const [i, dir] of [[0, -1], [M - 1, 1]]) {
    const t = mul(T[i], dir);
    let Nn = norm(cross(t, abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const Bn = cross(t, Nn), crow = [rows[i]];
    for (let j = 1; j <= 4; j++) {
      const be = (PI / 2) * (j / 4), row = [];
      for (let k = 0; k < nr; k++) {
        const a = (2 * PI * k) / nr;
        const n = norm(add(mul(add(mul(Nn, cos(a)), mul(Bn, sin(a))), cos(be)), mul(t, sin(be))));
        row.push(B.vert(add(pts[i], mul(n, r)), n, s, T[i]));
      }
      crow.push(row);
    }
    // (les premières rangées ne sont pas dans le même repère : on recoud par
    // l'anneau d'extrémité du tube, recalculé dans le repère de la calotte)
    const ring0 = [];
    for (let k = 0; k < nr; k++) { const a = (2 * PI * k) / nr, n = add(mul(Nn, cos(a)), mul(Bn, sin(a))); ring0.push(B.vert(add(pts[i], mul(n, r)), n, s, T[i])); }
    crow[0] = ring0;
    B.grid(crow, true);
  }
}

// ── Taille brillant (pierre), table vers +y, rondiste de rayon 1 ─────────────
export function gem(B, c, size, s = OUT) {
  const ring = (n, r, y, off) => Array.from({ length: n }, (_, i) => { const a = ((i + off) / n) * PI * 2; return [r * cos(a), y, r * sin(a)]; });
  const table = ring(8, 0.56, 0.32, 0.5), star = ring(8, 0.8, 0.22, 0), girdle = ring(16, 1, 0, 0), girdleLo = ring(16, 1, -0.03, 0);
  const pav = ring(8, 0.45, -0.48, 0.5), culet = [0, -0.86, 0];
  const face = (a, b, d) => {
    const n0 = norm(cross(sub(b, a), sub(d, a)));
    const m = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3 + 0.2, (a[2] + b[2] + d[2]) / 3];
    const n = dot(n0, m) < 0 ? mul(n0, -1) : n0;
    const P = (p) => add(c, mul(p, size));
    B.tri(B.vert(P(a), n, s), B.vert(P(b), n, s), B.vert(P(d), n, s));
  };
  const T = [0, 0.32, 0];
  for (let i = 0; i < 8; i++) face(T, table[i], table[(i + 1) % 8]);
  for (let i = 0; i < 8; i++) {
    const g0 = girdle[2 * i], g1 = girdle[2 * i + 1], g2 = girdle[(2 * i + 2) % 16];
    face(table[(i + 7) % 8], table[i], star[i]);
    face(table[(i + 7) % 8], star[i], g0);
    face(table[i], g0, star[i]);
    face(star[i], g0, g1); face(star[i], g1, g2);
    face(table[i], star[i], g2);
  }
  for (let i = 0; i < 16; i++) { const a = girdle[i], b = girdle[(i + 1) % 16], d = girdleLo[i], e = girdleLo[(i + 1) % 16]; face(a, d, e); face(a, e, b); }
  for (let i = 0; i < 8; i++) {
    const g0 = girdleLo[2 * i], g1 = girdleLo[2 * i + 1], g2 = girdleLo[(2 * i + 2) % 16];
    face(g0, g1, pav[i]); face(g1, g2, pav[i]);
    face(pav[i], g2, culet); face(pav[i], culet, g0);
  }
}

export { sqrt, PI, cos, sin, abs, max, min, sign };
