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
export const LODS = [
  { spacing: 0.022, bevelSegs: 3, faceSeg: 0.07 },
  { spacing: 0.034, bevelSegs: 2, faceSeg: 0.12 },
  { spacing: 0.05, bevelSegs: 1, faceSeg: 0.2 },
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
  // formes dessinées : contour plus finement échantillonné (même pas pour toutes
  // les cellules, donc toujours étanche)
  const spacing = L.spacing * (spec.shape === 'star' || spec.shape === 'iris' ? 0.7 : 1);
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

    if (info.closed) { // cellule pleine : deux éventails subdivisés (la sphère reste ronde)
      let rmax = 0;
      for (const q of Q) rmax = max(rmax, angle(q, c));
      const K = max(0, ceil(rmax / L.faceSeg) - 1);
      for (const side of [0, 1]) {
        const r = side ? Ri : top, sg = side ? -1 : 1, S = side ? IN : OUT;
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

    // contour du trou (plan) : polygone arrondi ∩ forme
    const rmaxShape = (spec.holeScale ?? 1) * info.rho;
    const H2 = Q.map((q) => {
      const w = dot(q, c), q2 = [dot(q, e1) / w, dot(q, e2) / w];
      const dir = [q2[0] - info.O[0], q2[1] - info.O[1]];
      // le point du rayon O→q2 à distance rc du noyau : dichotomie (distance croissante)
      let lo = 0, hi = 1;
      for (let it = 0; it < 22; it++) {
        const m = (lo + hi) / 2, x = [info.O[0] + dir[0] * m, info.O[1] + dir[1] * m];
        if (dist2(closest(info.P2, x), x) < info.rc) lo = m; else hi = m;
      }
      if (!info.portal && spec.shape && spec.shape !== 'poly') {
        const len = sqrt(dir[0] * dir[0] + dir[1] * dir[1]) || 1;
        const a = Math.atan2(dir[1], dir[0]) - info.theta0;
        lo = min(lo, (rmaxShape * shape(a, spec)) / len);
      }
      return [info.O[0] + dir[0] * lo, info.O[1] + dir[1] * lo];
    });
    // normale de la paroi : perpendiculaire au contour, vers l'intérieur du trou
    const prof = Q.map((q, k) => {
      const h2 = H2[k];
      let nx, ny;
      if (!spec.shape || spec.shape === 'poly' || info.portal) {
        const cp = closest(info.P2, h2);
        nx = cp[0] - h2[0]; ny = cp[1] - h2[1];
      } else { nx = 0; ny = 0; }
      if (sqrt(nx * nx + ny * ny) < 1e-9) {
        const a = H2[(k + 1) % M], b = H2[(k - 1 + M) % M];
        nx = -(a[1] - b[1]); ny = a[0] - b[0];
        if (nx * (info.O[0] - h2[0]) + ny * (info.O[1] - h2[1]) < 0) { nx = -nx; ny = -ny; }
        if (sqrt(nx * nx + ny * ny) < 1e-12) { nx = info.O[0] - h2[0]; ny = info.O[1] - h2[1]; }
      }
      const h = norm(add(c, add(scale(e1, h2[0]), scale(e2, h2[1]))));
      let nw = add(scale(e1, nx), scale(e2, ny));
      nw = norm(sub(nw, scale(h, dot(nw, h))));
      return { q, h, nw };
    });

    // biseau : limité par l'épaisseur et par la largeur du barreau
    let minBar = Infinity, fmax = 0, minHoleR = Infinity;
    for (let k = 0; k < M; k++) {
      const p = prof[k], a = angle(p.q, p.h);
      minBar = min(minBar, a); fmax = max(fmax, a);
      minHoleR = min(minHoleR, dist2(H2[k], info.O));
    }
    const b = sharp ? 0 : min(spec.bevel, spec.thickness * 0.45, minBar * 0.6);
    const K = max(pillow ? [3, 3, 2, 1][lod] : 0, ceil(fmax / L.faceSeg) - 1);
    // chambrage (trou à épaulement) : l'épaulement rétrécit le trou de `ledge`
    const ledge = !info.portal && (spec.step || 0) > 0 ? min(spec.step * minHoleR, minHoleR * 0.6) : 0;
    const Rs = R - spec.thickness * (spec.stepDepth ?? 0.45);
    // Courbure locale du contour (sens trigo) : là où la matière s'avance en
    // pointe dans le trou, le biseau doit rester plus petit que le rayon de
    // courbure (sinon il se replie) ; là où le trou est bombé, l'épaulement aussi.
    const rConc = new Float64Array(M).fill(Infinity), rConv = new Float64Array(M).fill(Infinity);
    for (let k = 0; k < M; k++) {
      const A = H2[(k - 1 + M) % M], Bp = H2[k], C = H2[(k + 1) % M];
      const ab = dist2(A, Bp), bc = dist2(Bp, C), ca = dist2(C, A);
      const cr = (Bp[0] - A[0]) * (C[1] - Bp[1]) - (Bp[1] - A[1]) * (C[0] - Bp[0]);
      if (ab < 1e-9 || bc < 1e-9 || abs(cr) < 1e-14) continue;
      const rad = (ab * bc * ca) / (2 * abs(cr));
      if (cr < 0) rConc[k] = rad; else rConv[k] = rad;
    }
    const W = 3;
    for (let k = 0; k < M; k++) {
      let mc = Infinity, mv = Infinity;
      for (let j = -W; j <= W; j++) { const i = (k + j + M) % M; mc = min(mc, rConc[i]); mv = min(mv, rConv[i]); }
      prof[k].b = min(b, mc * 0.8);
      prof[k].ledge = min(ledge, mv * 0.8);
    }
    // Garde-fou direct : deux décalages consécutifs ne doivent jamais se croiser
    // (contour sous-échantillonné aux pointes) ; on réduit localement jusqu'à
    // ce que l'ordre des points soit préservé.
    // anneau extérieur A (contour de la cellule ou bord du trou), anneau décalé
    // O(k) : chaque quadrilatère (A_k, A_k+1, O_k+1, O_k) doit rester orienté
    // comme la face (sens trigo vu de l'extérieur), sinon on réduit le décalage
    const ccw = (a, b2, c2) => dot(cross(sub(b2, a), sub(c2, a)), c);
    const unfold = (key, sign, outerRing) => {
      for (let it = 0; it < 12; it++) {
        let ok = true;
        const off = (p) => add(p.h, scale(p.nw, (sign * p[key] * 2.5) / Ri)); // (marge : la face interne et les anneaux intermédiaires y sont plus sensibles)
        for (let k = 0; k < M; k++) {
          const p0 = prof[k], p1 = prof[(k + 1) % M];
          const a0 = outerRing(p0), a1 = outerRing(p1), o0 = off(p0), o1 = off(p1);
          const d = sub(p1.h, p0.h), dd = dot(d, d);
          const flipped = ccw(a0, a1, o1) < 0 || ccw(a0, o1, o0) < 0 || (dd > 1e-14 && dot(sub(o1, o0), d) < 0.3 * dd);
          if (flipped && (p0[key] > 1e-7 || p1[key] > 1e-7)) { p0[key] *= 0.55; p1[key] *= 0.55; ok = false; }
        }
        if (ok) break;
      }
    };
    unfold('b', -1, (p) => p.q);
    if (ledge > 0) unfold('ledge', 1, (p) => p.h);

    // stations : [position, normale, surf, prox, relié à la précédente]
    const stations = (p) => {
      const { q, h, nw } = p, S = [];
      const b = p.b, ledgeK = p.ledge, b2 = min(b * 0.6, ledgeK * 0.4, (Rs - Ri) * 0.4);
      const st = (pos, n, s, prox, link) => S.push([pos, n, s, prox, link]);
      // bord supérieur arrondi : un quart de cercle de rayon r autour du coin
      // (hh, rad) ; de la normale n0 (angle a0) à la paroi
      const arcDown = (hh, rad, r, a0, link0) => {
        const oc = sub(scale(hh, rad - r), scale(nw, r));
        const nb = L.bevelSegs;
        for (let i = 0; i <= nb; i++) {
          const a = a0 * (1 - i / nb), n = add(scale(nw, cos(a)), scale(hh, sin(a)));
          st(add(oc, scale(n, r)), n, EDGE, 1, i > 0 || link0);
        }
      };
      // pente de la face bombée au bord du trou : le biseau part de cette pente
      const tilt = pillow ? Math.atan(2 * pillowH(spec, 0) / max(1e-4, angle(q, h))) : 0;
      const a0 = PI / 2 - min(tilt, PI / 3);
      // face externe (bombée : rayon R + hauteur(prox), normale inclinée vers le trou)
      const ocTop = sub(scale(h, R - b), scale(nw, b));
      const F = b > 0 ? add(ocTop, scale(add(scale(nw, cos(a0)), scale(h, sin(a0))), b)) : scale(h, R);
      const fd = norm(F), span = max(1e-4, angle(q, fd));
      for (let i = 0; i <= K + 1; i++) {
        const t = i / (K + 1);
        const d = i === K + 1 ? fd : norm(add(scale(q, 1 - t), scale(fd, t)));
        const ph = pillowH(spec, t);
        let n = d;
        if (pillow && t > 0) {
          const u = norm(sub(fd, scale(q, dot(fd, q))));
          n = norm(add(d, scale(u, min(2.2, (2 * pillowH(spec, 0) * t) / span)))); // (pente bornée : barreaux très étroits)
        }
        st(i === K + 1 ? F : scale(d, R + ph), n, OUT, t, i > 0);
      }
      // biseau externe → paroi (→ épaulement → paroi) → biseau interne
      const hIn = ledge > 0 ? norm(add(h, scale(nw, ledgeK))) : h;
      if (sharp || spec.bevel <= 1e-5) {
        st(scale(h, R), nw, EDGE, 1, false);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true);
          st(scale(h, Rs), h, EDGE, 1, false); st(scale(hIn, Rs), h, EDGE, 1, true);
          st(scale(hIn, Rs), nw, EDGE, 1, false);
        }
        st(scale(hIn, Ri), nw, EDGE, 1, true);
      } else if (spec.chamfer) {
        const n1 = norm(add(nw, h)), n2 = norm(sub(nw, h));
        st(F, n1, EDGE, 1, false); st(scale(h, R - b), n1, EDGE, 1, true);
        st(scale(h, R - b), nw, EDGE, 1, false);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true);
          st(scale(h, Rs), h, EDGE, 1, false); st(sub(scale(hIn, Rs), scale(nw, b2)), h, EDGE, 1, true);
          st(sub(scale(hIn, Rs), scale(nw, b2)), n1, EDGE, 1, false); st(scale(hIn, Rs - b2), n1, EDGE, 1, true);
          st(scale(hIn, Rs - b2), nw, EDGE, 1, false);
        }
        st(scale(hIn, Ri + b), nw, EDGE, 1, true);
        st(scale(hIn, Ri + b), n2, EDGE, 1, false); st(sub(scale(hIn, Ri), scale(nw, b)), n2, EDGE, 1, true);
      } else {
        arcDown(h, R, b, a0, false);
        if (ledge > 0) {
          st(scale(h, Rs), nw, EDGE, 1, true);                               // paroi du lamage
          st(scale(h, Rs), h, EDGE, 1, false);                               // épaulement (plat)
          st(sub(scale(hIn, Rs), scale(nw, b2)), h, EDGE, 1, true);
          arcDown(hIn, Rs, b2, PI / 2, true);                                // arête de l'épaulement
        }
        const ic = sub(scale(hIn, Ri + b), scale(nw, b));
        for (let i = 0; i <= L.bevelSegs; i++) {
          const a = (PI / 2) * (i / L.bevelSegs), n = sub(scale(nw, cos(a)), scale(hIn, sin(a)));
          st(add(ic, scale(n, b)), n, EDGE, 1, true);
        }
      }
      // face interne
      const Fi = sub(scale(hIn, Ri), scale(nw, b)), fi = norm(Fi);
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
      for (let j = 0; j <= rings; j++) {
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
      B.fan(start + rings * segs, apex, segs);
    }
  }
  return B.result();
}
