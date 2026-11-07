// Tampons extensibles d'un maillage de coquille, partagés par tous les
// constructeurs. Attributs : position, normal, tangent (direction du brossage :
// cercles de latitude autour de l'axe z local), surf (u8×4 normalisés : poids
// des finitions externe / interne / tranche, et proximité du bord), bev
// (normale horizontale de la tranche et angle du profil : la normale du biseau
// est recalculée à chaque pixel), et, pour les pièces animées, rigA / rigB.

import { cross } from './cells.js';

const { sqrt, PI, max, abs } = Math;

// natures de pièces animées (voir scene/rig.js)
export const RIG = { none: 0, iris: 1, burst: 2, hinge: 3, spin: 4 };

// finitions (poids externe / interne / tranche)
export const OUT = [255, 0, 0], IN = [0, 255, 0], EDGE = [0, 0, 255];

// ── Tampons extensibles ──────────────────────────────────────────────────────
export class Buffers {
  constructor(cap = 1 << 15) {
    this.n = 0; this.cap = cap; this.ni = 0; this.icap = cap * 2;
    this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3);
    this.tan = new Float32Array(cap * 4); this.surf = new Uint8Array(cap * 4); this.bev = new Float32Array(cap * 4);
    this.idx = new Uint32Array(this.icap);
    this.rigA = null; this.rigB = null; // (pièces animées : alloués au premier sommet animé)
    this.cur = null;
  }
  // Pièce animée pour les sommets qui suivent (voir scene/rig.js) : pivot b,
  // axe a, amplitude, nature (RIG) et tirage propre à la pièce (0 ≤ rnd < 1).
  // rig(null) : sommets fixes.
  rig(b = null, a = null, amp = 0, kind = 0, rnd = 0) {
    this.cur = b ? [b[0], b[1], b[2], amp, a[0], a[1], a[2], kind + Math.min(0.98, rnd)] : null;
    if (this.cur && !this.rigA) { this.rigA = new Float32Array(this.cap * 4); this.rigB = new Float32Array(this.cap * 4); }
  }
  grow() {
    const g = (a, k) => { const b = new a.constructor(this.cap * 2 * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nor = g(this.nor, 3); this.tan = g(this.tan, 4); this.surf = g(this.surf, 4); this.bev = g(this.bev, 4);
    if (this.rigA) { this.rigA = g(this.rigA, 4); this.rigB = g(this.rigB, 4); }
    this.cap *= 2;
  }
  // bv, a : normale horizontale de la tranche et angle du profil (la normale du
  // biseau est recalculée à chaque pixel : cos(a)·bv + sin(a)·radiale)
  vert(p, n, s0, s1, s2, s3, bv = null, a = 0) {
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
    if (bv) { this.bev[i4] = bv[0]; this.bev[i4 + 1] = bv[1]; this.bev[i4 + 2] = bv[2]; this.bev[i4 + 3] = a / (PI / 2); }
    if (this.cur) { const c = this.cur; for (let k = 0; k < 4; k++) { this.rigA[i4 + k] = c[k]; this.rigB[i4 + k] = c[4 + k]; } }
    return i;
  }
  // (triangles d'aire nulle — deux sommets confondus — ignorés : biseau ou
  // épaulement réduits à zéro par endroits)
  same(i, j) { const p = this.pos, a = i * 3, b = j * 3; return p[a] === p[b] && p[a + 1] === p[b + 1] && p[a + 2] === p[b + 2]; }
  tri(a, b, c) {
    if (this.same(a, b) || this.same(b, c) || this.same(c, a)) return;
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
  // triangle orienté du côté des normales de ses sommets
  triN(a, b, c) {
    const u = this.sub3(b, a), v = this.sub3(c, a), x = cross(u, v), N = this.nor;
    const s = x[0] * (N[a * 3] + N[b * 3] + N[c * 3]) + x[1] * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + x[2] * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (s < 0) this.tri(a, c, b); else this.tri(a, b, c);
  }
  // Couture de deux boucles fermées de tailles différentes (A : na sommets
  // consécutifs depuis A0, B : nb depuis B0), parcourues dans le même sens
  // autour d'un centre : fusion de leurs angles (aA, aB), comme deux listes triées.
  zip(A0, aA, B0, aB) {
    const na = aA.length, nb = aB.length, TAU = 2 * PI;
    const wrapPi = (x) => x - TAU * Math.floor((x + PI) / TAU);
    let jb = 0, bd = Infinity;
    for (let j = 0; j < nb; j++) { const d = abs(wrapPi(aB[j] - aA[0])); if (d < bd) { bd = d; jb = j; } }
    const unwrap = (ang, s0, base) => {
      const n = ang.length, out = new Float64Array(n + 1);
      out[0] = base;
      // (pas signés : un léger recul local ne compte pas pour un tour entier ;
      // puis croissance forcée, la fusion exige des listes triées)
      for (let i = 1; i <= n; i++) out[i] = out[i - 1] + wrapPi(ang[(s0 + i) % n] - ang[(s0 + i - 1) % n]);
      const k = TAU / max(1e-9, out[n] - out[0]); // (un tour exactement)
      for (let i = 1; i <= n; i++) out[i] = max(out[i - 1], base + (out[i] - base) * k);
      return out;
    };
    const UA = unwrap(aA, 0, aA[0]), UB = unwrap(aB, jb, aA[0] + wrapPi(aB[jb] - aA[0]));
    let i = 0, j = 0;
    while (i < na || j < nb) {
      const a = A0 + (i % na), b = B0 + ((jb + j) % nb);
      if (j >= nb || (i < na && UA[i + 1] <= UB[j + 1])) { this.triN(a, b, A0 + ((i + 1) % na)); i++; }
      else { this.triN(a, b, B0 + ((jb + j + 1) % nb)); j++; }
    }
  }
  sub3(i, j) { const p = this.pos; return [p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2]]; }
  result() {
    const out = {
      position: this.pos.slice(0, this.n * 3), normal: this.nor.slice(0, this.n * 3),
      tangent: this.tan.slice(0, this.n * 4), surf: this.surf.slice(0, this.n * 4), bev: this.bev.slice(0, this.n * 4),
      index: this.idx.slice(0, this.ni),
    };
    if (this.rigA) { out.rigA = this.rigA.slice(0, this.n * 4); out.rigB = this.rigB.slice(0, this.n * 4); }
    return out;
  }
}

