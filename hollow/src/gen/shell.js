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

// Détail par niveau : 0 = héros, 1 = moyen, 2 = lointain (tous trois affichés,
// tous biseautés : d'un niveau à l'autre, rien n'apparaît ni ne disparaît),
// 3 = ombres seulement (arêtes vives, contour grossier)
// (turn : rotation maximale de la normale du bord du trou entre deux points)
export const LODS = [
  { spacing: 0.022, bevelSegs: 3, faceSeg: 0.07, turn: 0.14 },
  { spacing: 0.034, bevelSegs: 2, faceSeg: 0.12, turn: 0.2 },
  { spacing: 0.05, bevelSegs: 1, faceSeg: 0.2, turn: 0.3 },
  { spacing: 0.075, bevelSegs: 0, faceSeg: 0.3, turn: 0.45 },
];

// ── Tampons extensibles ──────────────────────────────────────────────────────
class Buffers {
  constructor(cap = 1 << 15) {
    this.n = 0; this.cap = cap; this.ni = 0; this.icap = cap * 2;
    this.pos = new Float32Array(cap * 3); this.nor = new Float32Array(cap * 3);
    this.tan = new Float32Array(cap * 4); this.surf = new Uint8Array(cap * 4); this.bev = new Float32Array(cap * 4);
    this.idx = new Uint32Array(this.icap);
  }
  grow() {
    const g = (a, k) => { const b = new a.constructor(this.cap * 2 * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.nor = g(this.nor, 3); this.tan = g(this.tan, 4); this.surf = g(this.surf, 4); this.bev = g(this.bev, 4);
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
    return {
      position: this.pos.slice(0, this.n * 3), normal: this.nor.slice(0, this.n * 3),
      tangent: this.tan.slice(0, this.n * 4), surf: this.surf.slice(0, this.n * 4), bev: this.bev.slice(0, this.n * 4),
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

// distance de sortie d'un polygone convexe (sens trigo) depuis le point
// intérieur o, dans la direction unitaire u
function rayExit(P, o, u) {
  let t = Infinity;
  for (let k = 0; k < P.length; k++) {
    const A = P[k], B = P[(k + 1) % P.length];
    let nx = B[1] - A[1], ny = A[0] - B[0];
    const l = sqrt(nx * nx + ny * ny);
    if (l < 1e-12) continue;
    nx /= l; ny /= l;
    const den = u[0] * nx + u[1] * ny;
    if (den <= 1e-12) continue;
    t = min(t, ((A[0] - o[0]) * nx + (A[1] - o[1]) * ny) / den);
  }
  return t === Infinity ? 0 : max(0, t);
}

// distance de sortie du polygone arrondi P2 ⊕ disque(rc) (somme de Minkowski) :
// exacte, sans itération — le décalage des arêtes, ou le cercle d'un sommet
function roundedExit(P2, rc, o, u) {
  const circle = (V) => {
    const wx = o[0] - V[0], wy = o[1] - V[1], bq = wx * u[0] + wy * u[1], cq = wx * wx + wy * wy - rc * rc;
    return -bq + sqrt(max(0, bq * bq - cq));
  };
  if (P2.length < 3) return circle(P2[0]);
  let best = Infinity, bk = -1;
  for (let k = 0; k < P2.length; k++) {
    const A = P2[k], B = P2[(k + 1) % P2.length];
    let nx = B[1] - A[1], ny = A[0] - B[0];
    const l = sqrt(nx * nx + ny * ny);
    if (l < 1e-12) continue;
    nx /= l; ny /= l;
    const den = u[0] * nx + u[1] * ny;
    if (den <= 1e-12) continue;
    const t = ((A[0] - o[0]) * nx + (A[1] - o[1]) * ny + rc) / den;
    if (t < best) { best = t; bk = k; }
  }
  if (bk < 0) return 0;
  const A = P2[bk], B = P2[(bk + 1) % P2.length], ex = B[0] - A[0], ey = B[1] - A[1];
  const x = o[0] + u[0] * best, y = o[1] + u[1] * best;
  const s = ((x - A[0]) * ex + (y - A[1]) * ey) / (ex * ex + ey * ey);
  return s < 0 ? circle(A) : s > 1 ? circle(B) : best;
}

const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };

// Bord du trou : courbe polaire autour de O (polygone arrondi ∩ forme),
// échantillonnée finement puis rééchantillonnée selon un coût
// max(longueur / pas, rotation de la tangente / rotation max). Renvoie les points
// (plan gnomonique de la cellule) et les normales vers l'intérieur du trou.
function holeRim(info, spec, shape, rmaxShape, spacing, maxTurn) {
  const A = 1024, D = new Array(A);
  const useShape = !info.portal && spec.shape && spec.shape !== 'poly';
  for (let j = 0; j < A; j++) {
    const a = (j / A) * 2 * PI, u = [cos(a), sin(a)];
    let r = roundedExit(info.P2, info.rc, info.O, u);
    // (minimum lisse : un congé là où la forme coupe le polygone, comme une fraise)
    if (useShape) r = smin(r, rmaxShape * shape(a - info.theta0, spec), 0.2 * info.rho);
    D[j] = [info.O[0] + u[0] * r, info.O[1] + u[1] * r];
  }
  const T = D.map((_, j) => {
    const a = D[(j + A - 1) % A], b = D[(j + 1) % A], tx = b[0] - a[0], ty = b[1] - a[1], l = sqrt(tx * tx + ty * ty) || 1;
    return [tx / l, ty / l];
  });
  const cum = new Float64Array(A + 1);
  for (let j = 0; j < A; j++) {
    const p = D[j], q = D[(j + 1) % A], t0 = T[j], t1 = T[(j + 1) % A];
    const turn = Math.acos(max(-1, min(1, t0[0] * t1[0] + t0[1] * t1[1])));
    // (le plus exigeant des deux critères ; un angle vif — rotation sur une
    // longueur nulle — ne reçoit pas plus d'un point par huitième de pas)
    const len = dist2(p, q);
    cum[j + 1] = cum[j] + max(len / spacing, min(turn / maxTurn, (len / spacing) * 8));
  }
  const N = max(12, Math.round(cum[A]));
  const pts = [], nws = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = (i / N) * cum[A];
    while (j < A - 1 && cum[j + 1] <= target) j++;
    const f = (target - cum[j]) / max(1e-12, cum[j + 1] - cum[j]);
    const p = D[j], q = D[(j + 1) % A], t0 = T[j], t1 = T[(j + 1) % A];
    pts.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
    let tx = t0[0] + (t1[0] - t0[0]) * f, ty = t0[1] + (t1[1] - t0[1]) * f;
    const l = sqrt(tx * tx + ty * ty) || 1;
    tx /= l; ty /= l;
    nws.push([-ty, tx]); // (à gauche du sens trigo : vers O, l'intérieur du trou)
  }
  return { pts, nws };
}

// ── Préparation des cellules (indépendante du niveau de détail) ──────────────
// Calcule pour chaque cellule son repère, son contour plan et la forme de son
// trou (polygone noyau P2 + rayon de congé rc, rayon intérieur rho, orientation
// de la forme). Partagé par les trois LOD et par le placement des cristaux.
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
    // orientation de la forme du trou : l'est local (tangente à la latitude),
    // plus un angle fixe, une spirale selon la latitude, et un peu de hasard
    const east = norm(cross([0, 0, 1], c).map((v, i) => (abs(c[2]) > 0.999 ? [1, 0, 0][i] : v)));
    const lat = Math.asin(max(-1, min(1, c[2])));
    info.theta0 = Math.atan2(dot(east, e2), dot(east, e1)) + (spec.orient || 0) + (spec.swirl || 0) * lat * 2 + (rng.next() - 0.5) * (spec.orientJitter || 0);
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
    Object.assign(info, { closed: false, P2, rc, O: centroid2(P2), rho });
  }
  return out;
}

// Forme du trou, en coordonnées polaires autour du centre du trou : rayon
// relatif (≤ 1) dans la direction a (angle relatif à l'orientation de la cellule).
// Le trou réel est l'intersection de cette forme et du polygone arrondi.
const SHAPES = {
  poly: () => Infinity,
  star: (a, s) => 1 - s.depth * (0.5 + 0.5 * cos(s.petals * a)),
  ellipse: (a, s) => 1 / sqrt(cos(a) ** 2 + (sin(a) / max(0.08, s.aspect)) ** 2),
  iris: (a, s) => { // polygone régulier tourné (lames de diaphragme)
    const k = s.petals, seg = (2 * PI) / k;
    const r = ((a % seg) + seg) % seg - seg / 2;
    return cos(PI / k) / cos(r);
  },
};

// le point plan x est-il dans le trou de la cellule ? (avec une marge ; forme polygonale)
export const inHole = (info, x, margin = 0) => !info.closed && dist2(closest(info.P2, x), x) < info.rc + margin;

// hauteur des barreaux bombés (au-dessus de R), selon la proximité du bord du trou
const pillowH = (spec, prox) => (spec.pillow || 0) * spec.thickness * 0.55 * (1 - prox * prox);

// ── Maillage ─────────────────────────────────────────────────────────────────
export function buildShell(prepared, spec, lod) {
  const L = LODS[lod];
  const R = 1, Ri = 1 - spec.thickness;
  const sharp = L.bevelSegs === 0 || spec.bevel <= 1e-5;
  const B = new Buffers(lod === 0 ? 1 << 18 : 1 << 15);
  const OUT = [255, 0, 0], IN = [0, 255, 0], EDGE = [0, 0, 255];
  const u8 = (x) => Math.round(max(0, min(1, x)) * 255);
  const shape = SHAPES[spec.shape] || SHAPES.poly;
  // contour des cellules : même pas pour toutes (donc maillage étanche) ; le bord
  // des trous a son propre échantillonnage (holeRim)
  const spacing = L.spacing;
  const pillow = (spec.pillow || 0) > 0;
  const top = R + pillowH(spec, 0); // crête des barreaux (et plateau des cellules pleines)

  for (const info of prepared) {
    const { c, e1, e2, pts } = info;
    // contour échantillonné (mêmes points que la cellule voisine)
    const Q = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], n = edgeSteps(a, b, spacing);
      for (let s = 0; s < n; s++) Q.push(norm(add(a, scale(sub(b, a), s / n))));
    }
    const M = Q.length;

    if (info.closed) { // cellule pleine : anneaux concentriques (la sphère reste ronde)
      // dont le nombre de points décroît vers le centre (triangles bien
      // proportionnés), cousus deux à deux ; éventail au centre
      let rmax = 0;
      for (const q of Q) rmax = max(rmax, angle(q, c));
      const K = max(0, ceil(rmax / L.faceSeg) - 1);
      const gnc = (v) => { const w = dot(v, c); return Math.atan2(dot(v, e2) / w, dot(v, e1) / w); };
      // contour Q rééchantillonné en m points (longueur d'arc)
      const cumQ = [0];
      for (let k = 0; k < M; k++) cumQ.push(cumQ[k] + angle(Q[k], Q[(k + 1) % M]));
      const resample = (m) => {
        const out = [];
        let k = 0;
        for (let i = 0; i < m; i++) {
          const target = (i / m) * cumQ[M];
          while (k < M - 1 && cumQ[k + 1] <= target) k++;
          const f = (target - cumQ[k]) / max(1e-12, cumQ[k + 1] - cumQ[k]);
          out.push(norm(add(scale(Q[k], 1 - f), scale(Q[(k + 1) % M], f))));
        }
        return out;
      };
      const rings = [];
      for (let i = 0; i <= K; i++) {
        const t = i / (K + 1), m = i === 0 ? M : max(6, Math.round(M * (1 - t)));
        const base = i === 0 ? Q : resample(m);
        rings.push({ t, pts: base.map((q) => norm(add(scale(q, 1 - t), scale(c, t)))) });
      }
      for (const side of [0, 1]) {
        const r = side ? Ri : top, sg = side ? -1 : 1, S = side ? IN : OUT;
        let prev = -1, prevAng = null;
        for (const ring of rings) {
          const start = B.n;
          for (const d of ring.pts) B.vert(scale(d, r), scale(d, sg), S[0], S[1], S[2], u8(ring.t));
          const ang = ring.pts.map(gnc);
          if (prev >= 0) B.zip(prev, prevAng, start, ang);
          prev = start; prevAng = ang;
        }
        const C = B.vert(scale(c, r), scale(c, sg), S[0], S[1], S[2], 255);
        B.fan(prev, C, prevAng.length);
      }
      continue;
    }

    // ── Bord du trou ─────────────────────────────────────────────────────────
    // Courbe plane exacte (polygone arrondi ∩ forme), échantillonnée par
    // longueur d'arc et par courbure : les pointes et les congés serrés
    // reçoivent autant de points qu'il faut, indépendamment du contour de la
    // cellule. Normale nw : dans le plan tangent, vers l'intérieur du trou.
    const rim = holeRim(info, spec, shape, (spec.holeScale ?? 1) * info.rho, L.spacing, L.turn);
    const NR = rim.pts.length;
    // colonnes de la face : normales au bord (rayons depuis le centre pour
    // l'étoile, dont le bord concave ferait se croiser les normales)
    const radial = !info.portal && spec.shape === 'star';
    const g3 = (g) => norm(add(c, add(scale(e1, g[0]), scale(e2, g[1]))));
    const gn = (v) => { const w = dot(v, c); return [dot(v, e1) / w, dot(v, e2) / w]; };
    const dir2 = (g, n2) => { if (!radial) return [-n2[0], -n2[1]]; const x = g[0] - info.O[0], y = g[1] - info.O[1], l = sqrt(x * x + y * y) || 1; return [x / l, y / l]; };
    const prof = rim.pts.map((h2, k) => {
      const n2 = rim.nws[k];
      const h = g3(h2);
      let nw = add(scale(e1, n2[0]), scale(e2, n2[1]));
      nw = norm(sub(nw, scale(h, dot(nw, h))));
      // largeur de matière derrière ce point du bord (jusqu'au contour de la cellule)
      const Lb = rayExit(info.P, h2, dir2(h2, n2));
      return { h2, n2, h, nw, Lb };
    });

    // biseau : limité par l'épaisseur et par la largeur du barreau
    let minBar = Infinity, maxBar = 0, minHoleR = Infinity;
    for (const p of prof) { minBar = min(minBar, p.Lb); maxBar = max(maxBar, p.Lb); minHoleR = min(minHoleR, dist2(p.h2, info.O)); }
    const b = sharp ? 0 : min(spec.bevel, spec.thickness * 0.45, minBar * 0.6);
    const K = max(pillow ? [3, 3, 2, 1][lod] : 0, ceil(maxBar / L.faceSeg) - 1);
    // chambrage (trou à épaulement) : l'épaulement rétrécit le trou de `ledge`
    const ledge = !info.portal && (spec.step || 0) > 0 ? min(spec.step * minHoleR, minHoleR * 0.6) : 0;
    const Rs = R - spec.thickness * (spec.stepDepth ?? 0.45);
    // Courbure locale du bord (bien échantillonné, donc fiable) : là où la
    // matière s'avance en pointe dans le trou, le biseau reste plus petit que le
    // rayon de courbure ; là où le trou est bombé, l'épaulement aussi.
    const rConc = new Float64Array(NR).fill(Infinity), rConv = new Float64Array(NR).fill(Infinity);
    for (let k = 0; k < NR; k++) {
      const A = prof[(k - 1 + NR) % NR].h2, Bp = prof[k].h2, C = prof[(k + 1) % NR].h2;
      const ab = dist2(A, Bp), bc = dist2(Bp, C), ca = dist2(C, A);
      const cr = (Bp[0] - A[0]) * (C[1] - Bp[1]) - (Bp[1] - A[1]) * (C[0] - Bp[0]);
      if (ab < 1e-9 || bc < 1e-9 || abs(cr) < 1e-14) continue;
      const rad = (ab * bc * ca) / (2 * abs(cr));
      if (cr < 0) rConc[k] = rad; else rConv[k] = rad;
    }
    // limites érodées puis lissées le long du bord (fenêtre en longueur d'arc) :
    // la largeur du biseau et de l'épaulement varie en douceur, sans jamais
    // dépasser la limite locale
    const sArc = new Float64Array(NR + 1);
    for (let k = 0; k < NR; k++) sArc[k + 1] = sArc[k] + dist2(prof[k].h2, prof[(k + 1) % NR].h2);
    const per = sArc[NR];
    const window = (k, rad, f) => { // f(i) pour les points à moins de rad (arc) de k
      f(k);
      for (let d = 1; d < NR; d++) { const i = (k + d) % NR, a = (sArc[k + d < NR ? k + d : k + d - NR] - sArc[k] + per) % per; if (a > rad) break; f(i); }
      for (let d = 1; d < NR; d++) { const i = (k - d + NR) % NR, a = (sArc[k] - sArc[i] + per) % per; if (a > rad) break; f(i); }
    };
    const smoothLimit = (raw, cap) => {
      const rad = max(cap * 2, L.spacing * 0.5), er = new Float64Array(NR), out = new Float64Array(NR);
      for (let k = 0; k < NR; k++) { let m = Infinity; window(k, rad, (i) => { m = min(m, raw[i]); }); er[k] = m; }
      for (let k = 0; k < NR; k++) { let sum = 0, n = 0; window(k, rad, (i) => { sum += er[i]; n++; }); out[k] = sum / n; }
      return out;
    };
    const bLim = smoothLimit(Array.from(rConc, (r) => min(b, r * 0.8)), b);
    const lLim = ledge > 0 ? smoothLimit(Array.from(rConv, (r) => min(ledge, r * 0.8)), ledge) : null;
    for (let k = 0; k < NR; k++) { prof[k].b = bLim[k]; prof[k].ledge = lLim ? lLim[k] : 0; }
    // garde-fou : deux décalages consécutifs ne doivent jamais s'inverser
    const unfold = (key, sign) => {
      for (let it = 0; it < 8; it++) {
        let ok = true;
        const off = (p) => add(p.h, scale(p.nw, (sign * p[key] * 1.5) / Ri));
        for (let k = 0; k < NR; k++) {
          const p0 = prof[k], p1 = prof[(k + 1) % NR];
          const d = sub(p1.h, p0.h), dd = dot(d, d);
          if (dd > 1e-14 && dot(sub(off(p1), off(p0)), d) < 0.2 * dd && (p0[key] > 1e-7 || p1[key] > 1e-7)) { p0[key] *= 0.55; p1[key] *= 0.55; ok = false; }
        }
        if (ok) break;
      }
    };
    unfold('b', -1);
    if (ledge > 0) unfold('ledge', 1);

    // ── Profil : stations du sommet du biseau externe (F) au sommet du biseau
    // interne (Fi). Chaque station : [position, normale, finition, prox, reliée
    // à la précédente, angle du profil (normale par pixel ; null hors tranche)]
    const H0 = pillowH(spec, 0);
    const stations = (p) => {
      const { h, nw } = p, S = [];
      const b = p.b, ledgeK = p.ledge, b2 = min(b * 0.6, ledgeK * 0.4, (Rs - Ri) * 0.4);
      const st = (pos, n, s, prox, link, a = null) => S.push([pos, n, s, prox, link, a]);
      // bord supérieur arrondi : quart de cercle de rayon r autour du coin (hh, rad)
      const arcDown = (hh, rad, r, a0, link0) => {
        const oc = sub(scale(hh, rad - r), scale(nw, r));
        const nb = L.bevelSegs;
        for (let i = 0; i <= nb; i++) {
          const a = a0 * (1 - i / nb), n = add(scale(nw, cos(a)), scale(hh, sin(a)));
          st(add(oc, scale(n, r)), n, EDGE, 1, i > 0 || link0, a);
        }
      };
      // pente de la face bombée au bord du trou : le biseau part de cette pente
      const slope0 = pillow ? min(2.2, (2 * H0) / max(1e-4, p.Lb)) : 0;
      const a0 = PI / 2 - min(Math.atan(slope0), PI / 3);
      const ocTop = sub(scale(h, R - b), scale(nw, b));
      const F = b > 0 ? add(ocTop, scale(add(scale(nw, cos(a0)), scale(h, sin(a0))), b)) : scale(h, R);
      const fd = norm(F);
      p.F = F;
      st(F, pillow ? norm(add(fd, scale(nw, slope0))) : fd, OUT, 1, false);
      const hIn = ledge > 0 ? norm(add(h, scale(nw, ledgeK))) : h;
      if (sharp || spec.bevel <= 1e-5) {
        st(scale(h, R), nw, EDGE, 1, false, 0);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true, 0);
          st(scale(h, Rs), h, EDGE, 1, false, PI / 2); st(scale(hIn, Rs), h, EDGE, 1, true, PI / 2);
          st(scale(hIn, Rs), nw, EDGE, 1, false, 0);
        }
        st(scale(hIn, Ri), nw, EDGE, 1, true, 0);
      } else if (spec.chamfer) {
        const n1 = norm(add(nw, h)), n2 = norm(sub(nw, h));
        st(F, n1, EDGE, 1, false, PI / 4); st(scale(h, R - b), n1, EDGE, 1, true, PI / 4);
        st(scale(h, R - b), nw, EDGE, 1, false, 0);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true, 0);
          st(scale(h, Rs), h, EDGE, 1, false, PI / 2); st(sub(scale(hIn, Rs), scale(nw, b2)), h, EDGE, 1, true, PI / 2);
          st(sub(scale(hIn, Rs), scale(nw, b2)), n1, EDGE, 1, false, PI / 4); st(scale(hIn, Rs - b2), n1, EDGE, 1, true, PI / 4);
          st(scale(hIn, Rs - b2), nw, EDGE, 1, false, 0);
        }
        st(scale(hIn, Ri + b), nw, EDGE, 1, true, 0);
        st(scale(hIn, Ri + b), n2, EDGE, 1, false, -PI / 4); st(sub(scale(hIn, Ri), scale(nw, b)), n2, EDGE, 1, true, -PI / 4);
      } else {
        arcDown(h, R, b, a0, false);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true, 0);                               // paroi du lamage
          st(scale(h, Rs), h, EDGE, 1, false, PI / 2);                          // épaulement (plat)
          st(sub(scale(hIn, Rs), scale(nw, b2)), h, EDGE, 1, true, PI / 2);
          arcDown(hIn, Rs, b2, PI / 2, true);                                   // arête de l'épaulement
        }
        const ic = sub(scale(hIn, Ri + b), scale(nw, b));
        for (let i = 0; i <= L.bevelSegs; i++) {
          const a = (PI / 2) * (i / L.bevelSegs), n = sub(scale(nw, cos(a)), scale(hIn, sin(a)));
          st(add(ic, scale(n, b)), n, EDGE, 1, true, -a);
        }
      }
      const Fi = sub(scale(hIn, Ri), scale(nw, b));
      p.Fi = Fi;
      st(Fi, scale(norm(Fi), -1), IN, 1, false);
      return S;
    };

    const all = prof.map(stations), NS = all[0].length;
    let prev = -1, ringF = -1, ringFi = -1;
    for (let s = 0; s < NS; s++) {
      const start = B.n;
      for (let k = 0; k < NR; k++) {
        const [p, n, S, prox, , a] = all[k][s];
        B.vert(p, n, S[0], S[1], S[2], u8(prox), a === null ? null : prof[k].nw, a);
      }
      if (all[0][s][4] && prev >= 0) B.strip(prev, start, NR);
      if (s === 0) ringF = start;
      if (s === NS - 1) ringFi = start;
      prev = start;
    }

    // ── Faces : colonnes du sommet du biseau vers le contour de la cellule,
    // anneaux à fraction constante de la largeur de matière (le bombé et la
    // proximité du bord suivent la vraie distance au trou), puis couture au
    // contour Q (partagé avec la cellule voisine : maillage étanche).
    const Q2 = Q.map(gn);
    const angQ = Q2.map((g) => Math.atan2(g[1] - info.O[1], g[0] - info.O[0]));
    const face = (inner) => {
      const cols = prof.map((p) => {
        const g0 = gn(inner ? p.Fi : p.F), d = dir2(g0, p.n2);
        return { g0, d, Lc: rayExit(info.P, g0, d) };
      });
      let prevRing = inner ? ringFi : ringF;
      let ringG = cols.map((cl) => cl.g0);
      for (let j = 1; j <= K; j++) {
        const lam = j / (K + 1), start = B.n;
        ringG = cols.map((cl) => [cl.g0[0] + cl.d[0] * lam * cl.Lc, cl.g0[1] + cl.d[1] * lam * cl.Lc]);
        for (let k = 0; k < NR; k++) {
          const d = g3(ringG[k]);
          if (inner) { B.vert(scale(d, Ri), scale(d, -1), IN[0], IN[1], IN[2], u8(1 - lam)); continue; }
          let n = d;
          if (pillow) { // pente vers le bord du trou
            const cl = cols[k];
            let toRim = scale(add(scale(e1, cl.d[0]), scale(e2, cl.d[1])), -1);
            toRim = norm(sub(toRim, scale(d, dot(toRim, d))));
            n = norm(add(d, scale(toRim, min(2.2, (2 * H0 * (1 - lam)) / max(1e-4, cl.Lc)))));
          }
          B.vert(scale(d, R + pillowH(spec, 1 - lam)), n, OUT[0], OUT[1], OUT[2], u8(1 - lam));
        }
        B.strip(prevRing, start, NR);
        prevRing = start;
      }
      // couture au contour de la cellule
      const qStart = B.n;
      for (const q of Q) {
        if (inner) B.vert(scale(q, Ri), scale(q, -1), IN[0], IN[1], IN[2], 0);
        else B.vert(scale(q, top), q, OUT[0], OUT[1], OUT[2], 0);
      }
      const angR = ringG.map((g) => Math.atan2(g[1] - info.O[1], g[0] - info.O[0]));
      B.zip(prevRing, angR, qStart, angQ);
    };
    face(false);
    face(true);
  }


  // rivets aux jonctions des barreaux (dômes posés sur la crête)
  if ((spec.rivets || 0) > 0 && lod < 3) {
    const seen = new Set(), rr = spec.rivets * spec.bar * 0.5, segs = [12, 8, 6][lod], rings = [4, 2, 1][lod];
    for (const info of prepared) for (const v of info.pts) {
      const k = `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
      if (seen.has(k) || v[2] > Math.cos(spec.portal * 0.9)) continue;
      seen.add(k);
      const [t1, t2] = tangentFrame(v);
      const base = scale(v, top - rr * 0.15);
      const start = B.n;
      // (anneaux sous le sommet seulement : le dernier se refermerait en un point)
      for (let j = 0; j < rings; j++) {
        const phi = (PI / 2) * (j / rings), cr = cos(phi), sr = sin(phi);
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * PI * 2, dir = add(scale(t1, cos(a)), scale(t2, sin(a)));
          const pos = add(base, add(scale(dir, rr * cr), scale(v, rr * 0.75 * sr)));
          const n = norm(add(scale(dir, cr * 0.75), scale(v, sr)));
          B.vert(pos, n, 0, 0, 255, 255);
        }
        if (j > 0) B.strip(start + (j - 1) * segs, start + j * segs, segs);
      }
      const apex = B.vert(add(base, scale(v, rr * 0.75)), v, 0, 0, 255, 255);
      B.fan(start + (rings - 1) * segs, apex, segs);
    }
  }
  const out = B.result();
  if (lod === 3) delete out.bev; // (ombres seulement)
  return out;
}
