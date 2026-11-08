// L'armature d'une couche : ce qui pousse la membrane de l'intérieur et la
// déchire. Rayon de la membrane au repos : 1 ; la couche suivante (plus
// petite, rayon q) loge au centre.
//
// Natures :
//   calyx : calice — n lames bombées, en quartiers, articulées sur une
//           couronne à l'arrière, qui s'ouvrent comme des sépales
//   iris  : lames vrillées qui pivotent presque à plat, autour de l'axe radial
//           de leur pivot (comme les lames d'un diaphragme) : elles glissent
//           les unes sur les autres et dégagent le centre en tournoyant
//   pod   : gousse — deux ou trois mâchoires larges, épaisses, nervurées
//   ribs  : ombrelle — de nombreuses baleines (joncs) le long des méridiens
//   crown : couronne d'épines — des aiguilles sortent, percent, puis s'inclinent
//   cage  : polyèdre (arcs et nœuds) qui gonfle et tend la membrane jusqu'à
//           la rupture, face par face
//
// Sortie : les pièces (cinématique, voir kin.js) avec leurs volumes de
// collision (pour la simulation), et le maillage (attributs rigA–rigD : la
// même cinématique dans le vertex shader).

import { Buffers, OUT, IN, EDGE, norm, cross, dot, add, sub, mul } from './mesh.js';
import { createRng } from '../rng.js';

const { PI, sin, cos, atan2, acos, max, min, abs, sqrt } = Math;
const sph = (th, ph, r = 1) => [r * sin(th) * cos(ph), r * sin(th) * sin(ph), r * cos(th)];

class RigBuffers extends Buffers {
  constructor() {
    super(1 << 15);
    this.rig = { b: [0, 0, 0], th: 0, a: [1, 0, 0], ext: 0, dir: [0, 0, 1], delay: 0, sc: 0, mode: 0 };
    this.rA = []; this.rB = []; this.rC = []; this.rD = [];
  }
  vert(p, n, s, t = null) {
    const i = super.vert(p, n, s, t), r = this.rig;
    this.rA.push(r.b[0], r.b[1], r.b[2], r.th);
    this.rB.push(r.a[0], r.a[1], r.a[2], r.ext);
    this.rC.push(r.delay, r.sc, r.mode, this.piece / 255);
    this.rD.push(r.dir[0], r.dir[1], r.dir[2], 0);
    return i;
  }
  out() {
    const o = super.out();
    return { ...o, rigA: Float32Array.from(this.rA), rigB: Float32Array.from(this.rB), rigC: Float32Array.from(this.rC), rigD: Float32Array.from(this.rD) };
  }
}

// grille de points [rangée][colonne] → sommets (normales par différences) et triangles
function emitGrid(B, P, surfOf, closedU, tangentOf = null) {
  const R = P.length, C = P[0].length;
  const ids = [];
  for (let j = 0; j < R; j++) {
    const row = [];
    for (let i = 0; i < C; i++) {
      const jm = max(0, j - 1), jp = min(R - 1, j + 1);
      const im = closedU ? (i - 1 + C) % C : max(0, i - 1), ip = closedU ? (i + 1) % C : min(C - 1, i + 1);
      const du = sub(P[j][ip], P[j][im]), dv = sub(P[jp][i], P[jm][i]);
      let n = cross(du, dv);
      if (Math.hypot(...n) < 1e-12) n = norm(P[j][i]);
      n = norm(n);
      row.push(B.vert(P[j][i], n, surfOf(j, i), tangentOf ? tangentOf(j, i) : dv));
    }
    ids.push(row);
  }
  B.grid(ids, closedU);
  return ids;
}

// ── Lame en quartier (calice, iris, gousse) ──────────────────────────────────
// L : { phi, th0, th1, w (demi-largeur en azimut), tip, twist, R, T, ridge }
function luneProfile(L, s) {
  const tipK = min(1, s / L.tip);
  const base = 1 - 0.18 * max(0, (s - 0.85) / 0.15) ** 2;
  return L.w * sin((tipK * PI) / 2) ** 0.7 * base;
}
function luneMesh(B, L) {
  const NS = 44, NA = 18, NE = 6;
  const P = [];
  for (let j = 0; j <= NS; j++) {
    const s = j / NS, th = L.th0 + (L.th1 - L.th0) * s;
    const phc = L.phi + L.twist * (th - L.th0);
    const hw = luneProfile(L, s), st = max(sin(th), 0.02);
    // demi-largeur en arc ; la tranche arrondie (rayon T/2) ne descend pas sous T/2
    const half = max(hw * st, L.T * 0.5 + 1e-4);
    const ring = [];
    // (persienne : la lame s'abaisse d'un bord à l'autre — diaphragme, où chaque
    // lame passe au-dessus de sa voisine d'un côté et au-dessous de l'autre)
    const lv = (arc) => (L.louver || 0) * (arc / max(half, 1e-6) - 1) * 0.5;
    const at = (arc, rho) => sph(th, phc + arc / st, L.R + rho + lv(arc));
    // dessus (avec nervure centrale), de −half+T/2 à +half−T/2
    const e = half - L.T * 0.5;
    for (let k = 0; k <= NA; k++) {
      const v = -1 + (2 * k) / NA, arc = v * e;
      const ridge = L.ridge * L.T * (1 - min(1, abs(v) / 0.22)) ** 2 * (1 - s * 0.6);
      ring.push(at(arc, ridge));
    }
    for (let k = 1; k < NE; k++) { const a = PI / 2 - (PI * k) / NE; ring.push(at(e + L.T * 0.5 * cos(a), -L.T * 0.5 + L.T * 0.5 * sin(a))); }
    for (let k = 0; k <= NA; k++) { const v = 1 - (2 * k) / NA; ring.push(at(v * e, -L.T)); }
    for (let k = 1; k < NE; k++) { const a = -PI / 2 - (PI * k) / NE; ring.push(at(-e + L.T * 0.5 * cos(a), -L.T * 0.5 + L.T * 0.5 * sin(a))); }
    P.push(ring);
  }
  const top = NA + 1, cap = NE - 1;
  const surf = (j, i) => (i < top ? OUT : i < top + cap ? EDGE : i < 2 * top + cap ? IN : EDGE);
  const ids = emitGrid(B, P, surf, true);
  // bout de charnière : fermé par un éventail
  const last = ids[ids.length - 1], c = P[P.length - 1].reduce((a, b) => add(a, b), [0, 0, 0]).map((x) => x / last.length);
  const tdir = norm(sub(P[P.length - 1][0], P[P.length - 2][0]));
  const ci = B.vert(c, tdir, EDGE);
  const ring = P[P.length - 1].map((p) => B.vert(p, tdir, EDGE));
  for (let i = 0; i < ring.length; i++) B.tri(ci, ring[i], ring[(i + 1) % ring.length]);
}

// ── Tube le long d'une suite de points (rayon variable) ─────────────────────
function tubeMesh(B, pts, radius, nr = 12, s = OUT, capEnds = true) {
  const M = pts.length;
  const T = pts.map((_, i) => norm(sub(pts[min(M - 1, i + 1)], pts[max(0, i - 1)])));
  let N = norm(cross(T[0], abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const P = [];
  for (let i = 0; i < M; i++) {
    if (i > 0) N = norm(cross(cross(T[i], N), T[i]));
    const Bn = cross(T[i], N), r = typeof radius === 'function' ? radius(i / (M - 1)) : radius;
    const ring = [];
    for (let k = 0; k < nr; k++) { const a = (2 * PI * k) / nr; ring.push(add(pts[i], add(mul(N, r * cos(a)), mul(Bn, r * sin(a))))); }
    P.push(ring);
  }
  emitGrid(B, P, () => s, true, (j) => T[j]);
  if (capEnds) for (const [i, d] of [[0, -1], [M - 1, 1]]) {
    const n = mul(T[i], d), ci = B.vert(pts[i], n, s);
    const ring = P[i].map((p) => B.vert(p, n, s));
    for (let k = 0; k < nr; k++) B.tri(ci, ring[k], ring[(k + 1) % nr]);
  }
}
function sphereMesh(B, c, r, s = EDGE, nu = 18, nv = 10) {
  const P = [];
  for (let j = 0; j <= nv; j++) { const th = (PI * j) / nv, row = []; for (let i = 0; i < nu; i++) row.push(add(c, sph(th, (2 * PI * i) / nu, r))); P.push(row); }
  const ids = [];
  for (let j = 0; j <= nv; j++) ids.push(P[j].map((p) => B.vert(p, norm(sub(p, c)), s)));
  B.grid(ids, true);
}
function torusMesh(B, z, R0, r, s = EDGE, nu = 96, nv = 14) {
  const P = [];
  for (let j = 0; j <= nv; j++) {
    const a = (2 * PI * j) / nv, row = [];
    for (let i = 0; i < nu; i++) { const ph = (2 * PI * i) / nu; row.push([(R0 + r * cos(a)) * cos(ph), (R0 + r * cos(a)) * sin(ph), z + r * sin(a)]); }
    P.push(row);
  }
  emitGrid(B, P, () => s, true);
}

// ── Volumes de collision ─────────────────────────────────────────────────────
// lune : { t: 0, L } ; capsule : { t: 1, p0, p1, r } ; sphère d'encombrement :
// bound { c, r } (au repos, dans le repère de la couche)

function luneBound(L) {
  const pts = [];
  for (let k = 0; k <= 8; k++) { const th = L.th0 + ((L.th1 - L.th0) * k) / 8; pts.push(sph(th, L.phi + L.twist * (th - L.th0), L.R)); }
  return boundOf(pts, L.w * L.R + 0.08);
}
function boundOf(pts, pad) {
  const c = pts.reduce((a, b) => add(a, b), [0, 0, 0]).map((x) => x / pts.length);
  let r = 0;
  for (const p of pts) r = max(r, Math.hypot(...sub(p, c)));
  return { c, r: r + pad };
}

// axe de charnière orienté pour que la pointe s'écarte du pôle
function hingeAxis(b, tip, tilt = 0) {
  const r = norm(b);
  let a = norm(cross([0, 0, 1], r)); // (tangente en azimut)
  if (Math.hypot(...a) < 1e-6) a = [1, 0, 0];
  if (tilt) a = norm(add(mul(a, cos(tilt)), mul(r, sin(tilt))));
  // test : un petit angle positif doit éloigner la pointe de l'axe z
  const v = sub(tip, b), c = cos(0.05), s = sin(0.05);
  const rot = add(add(mul(v, c), mul(cross(a, v), s)), mul(a, dot(a, v) * (1 - c)));
  const p1 = add(b, rot);
  return Math.hypot(p1[0], p1[1]) > Math.hypot(tip[0], tip[1]) ? a : mul(a, -1);
}

const rad = (d) => (d * PI) / 180;

// ── Armature complète ────────────────────────────────────────────────────────
export function buildArmature(spec) {
  const A = spec, rng = createRng(`arm:${A.seed}`);
  const B = new RigBuffers();
  const parts = [];
  let phi0 = 0, cageFeet = null;
  const sites = [];
  const R = A.radius ?? 0.955, T = A.thick, thH = rad(A.hinge);
  const dur = A.dur;
  const stagger = (i, n) => {
    const order = A.order === 'spiral' ? i / n : A.order === 'random' ? rng.next() : A.order === 'alternate' ? (i % 2) * 0.5 : 0;
    return order * A.stagger;
  };
  const piece = () => { B.piece = rng.int(0, 255); };
  const blades = (kind) => {
    const n = A.n, w = (PI / n) * A.width;
    phi0 = rng.next() * PI * 2;
    for (let i = 0; i < n; i++) {
      const phi = phi0 + (2 * PI * i) / n;
      // (la nervure reste sous la membrane : la lame est d'autant plus basse)
      const L = { phi, th0: rad(2.5), th1: thH, w, tip: A.tip, twist: kind === 'iris' ? A.twist : 0, R: R - A.ridge * T * 0.75, T, ridge: A.ridge, louver: kind === 'iris' ? T * 2.6 : 0 };
      const b = sph(thH, phi + L.twist * (thH - L.th0), L.R - T * 0.5);
      const tip = sph(L.th0 + 0.1, phi, R);
      const a = hingeAxis(b, tip, kind === 'iris' ? A.tilt : 0);
      const P = { b, a, th: rad(A.angle) * (1 + (rng.next() - 0.5) * A.jitter), ext: 0, dir: [0, 0, 1], sc: kind === 'iris' ? A.swell : 0, mode: 0, delay: stagger(i, n), cols: [{ t: 0, L, m: A.ridge * T * 0.75 }], bound: luneBound(L) };
      parts.push(P);
      B.rig = P; piece();
      luneMesh(B, L);
      // charnière : un manchon le long de l'axe
      tubeMesh(B, [sub(b, mul(a, T * 2.4)), b, add(b, mul(a, T * 2.4))], T * 0.62, 14, EDGE);
    }
  };
  switch (A.kind) {
    case 'calyx': case 'iris': case 'pod': blades(A.kind); break;
    case 'ribs': {
      const n = A.n;
      phi0 = rng.next() * PI * 2;
      for (let i = 0; i < n; i++) {
        const phi = phi0 + (2 * PI * i) / n, pts = [];
        for (let k = 0; k <= 40; k++) { const th = rad(4) + (thH - rad(4)) * (k / 40); pts.push(sph(th, phi, R - T * 0.4)); }
        const b = pts[pts.length - 1], a = hingeAxis(b, pts[0]);
        const cols = [];
        for (let k = 0; k < 40; k += 4) cols.push({ t: 1, p0: pts[k], p1: pts[min(40, k + 4)], r: T * 0.55 + 0.006 });
        const P = { b, a, th: rad(A.angle) * (1 + (rng.next() - 0.5) * A.jitter), ext: 0, dir: [0, 0, 1], sc: 0, mode: 0, delay: stagger(i, n), cols, bound: boundOf(pts, 0.05) };
        parts.push(P);
        B.rig = P; piece();
        tubeMesh(B, pts, (u) => T * 0.42 * (0.55 + 0.45 * sqrt(u)), 12, OUT);
        sphereMesh(B, pts[0], T * 0.55, EDGE);
        tubeMesh(B, [sub(b, mul(a, T * 1.6)), b, add(b, mul(a, T * 1.6))], T * 0.6, 12, EDGE);
      }
      break;
    }
    case 'crown': {
      // couronne d'épingles : chaque épingle part de la couronne de charnières
      // (à l'arrière) et vise un point de la calotte avant, tête perlée juste
      // sous la membrane ; elle coulisse dans son axe (la tête tend puis perce
      // la membrane), puis s'incline vers l'extérieur autour de sa charnière.
      const n = A.n, cap = rad(A.spread), ga = PI * (3 - sqrt(5));
      phi0 = rng.next() * PI * 2;
      const Rh = R - T * 0.5;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, phi = phi0 + i * ga;
        // cible : pas trop près du pôle (passage de la caméra), corde qui ne
        // traverse pas l'œuf suivant
        let th = rad(18) + (cap - rad(18)) * sqrt(u);
        const head = A.head * T;
        const base = sph(thH, phi, Rh);
        let tgt = sph(th, phi, R - head * 1.05);
        for (let k = 0; k < 20; k++) {
          const ab = sub(tgt, base), t = max(0, min(1, -dot(base, ab) / dot(ab, ab)));
          if (Math.hypot(...add(base, mul(ab, t))) > (A.inner ?? 0.5) + T * 2 + 0.03) break;
          th += rad(3); tgt = sph(th, phi, R - head * 1.05);
        }
        const d = norm(sub(tgt, base));
        sites.push(norm(tgt));
        const a = hingeAxis(base, tgt);
        const r0 = T * 0.5;
        const P = { b: base, a, th: rad(A.angle) * (0.7 + 0.6 * u), ext: A.ext, dir: d, sc: 0, mode: 1, delay: stagger(i, n) + u * 0.08,
          cols: [{ t: 1, p0: add(base, mul(d, 0.05)), p1: tgt, r: r0 + 0.006 }, { t: 1, p0: tgt, p1: tgt, r: head }], bound: boundOf([base, tgt], head + 0.06) };
        parts.push(P);
        B.rig = P; piece();
        const pts = [];
        for (let k = 0; k <= 24; k++) pts.push(add(base, mul(sub(tgt, base), k / 24)));
        tubeMesh(B, pts, (s) => r0 * (1 - s * 0.45), 12, OUT);
        // tête d'épingle : une perle polie, qui tend la membrane avant de la percer
        sphereMesh(B, tgt, head, EDGE, 28, 16);
        // pied : rotule sur la couronne
        sphereMesh(B, base, T * 0.9, EDGE);
      }
      break;
    }
    case 'cage': {
      // cage polyédrique fixe, sous la membrane (posée sur des rayons depuis la
      // coupe) : c'est la membrane qui gonfle (pression croissante), se décolle
      // des arêtes et cède au milieu des faces
      const poly = A.poly === 'dodeca' ? dodeca() : A.poly === 'octa' ? octa() : ico();
      const f0 = poly.F[0], fc = norm(f0.map((i) => poly.V[i]).reduce((a, b) => add(a, b), [0, 0, 0]));
      const Rm = rotTo(fc, [0, 0, 1]), Rz = rng.next() * PI * 2;
      const V = poly.V.map((v) => { const p = Rm(v); return [p[0] * cos(Rz) - p[1] * sin(Rz), p[0] * sin(Rz) + p[1] * cos(Rz), p[2]]; });
      const edges = new Set();
      for (const f of poly.F) for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; edges.add(a < b ? `${a},${b}` : `${b},${a}`); }
      const P = { b: [0, 0, 0], a: [1, 0, 0], th: 0, ext: 0, dir: [0, 0, 1], sc: 0, mode: 0, delay: 0, cols: [], bound: { c: [0, 0, 0], r: 1.3 } };
      parts.push(P);
      B.rig = P;
      const Rc = R - T * 0.5;
      for (const e of edges) {
        const [i, j] = e.split(',').map(Number), pts = [];
        const ang = acos(min(1, max(-1, dot(V[i], V[j])))), ns = max(10, Math.round(ang * 36));
        for (let k = 0; k <= ns; k++) pts.push(mul(slerp(V[i], V[j], k / ns), Rc));
        piece();
        tubeMesh(B, pts, T * 0.5, 12, OUT, false);
        for (let k = 0; k < ns; k += 2) P.cols.push({ t: 1, p0: pts[k], p1: pts[min(ns, k + 2)], r: T * 0.5 });
      }
      for (const v of V) { piece(); sphereMesh(B, mul(v, Rc), T * 1.1, EDGE); }
      P.verts = V;
      cageFeet = V.filter((v) => v[2] < -0.3).map((v) => mul(v, Rc));
      break;
    }
    default: break;
  }
  // ── Socle (fixe) : tout se tient ──
  // La couche suivante (rayon q) repose dans une coupe ; une tige la relie au
  // pôle arrière de la membrane (où la coupe de la couche précédente la
  // reçoit) ; des rayons relient la coupe à la couronne de charnières (ou aux
  // pieds de la cage). Rien ne flotte.
  B.rig = { b: [0, 0, 0], th: 0, a: [1, 0, 0], ext: 0, dir: [0, 0, 1], delay: 0, sc: 0, mode: 0 };
  B.piece = 128;
  const q = A.inner ?? 0.46, gap = 0.012;
  const cupR = q + gap + T * 0.4, cupTh = rad(128);
  // coupe : calotte sphérique épaisse, bord en bourrelet
  const cupRows = [];
  for (let k = 0; k <= 16; k++) {
    const th = cupTh + (PI - cupTh) * (k / 16), row = [];
    for (let i = 0; i < 64; i++) row.push(sph(th, (2 * PI * i) / 64, cupR));
    cupRows.push(row);
  }
  emitGrid(B, cupRows, () => IN, true);
  torusMesh(B, cupR * cos(cupTh), cupR * sin(cupTh), T * 0.45, EDGE, 64, 10);
  const cupOut = [];
  for (let k = 0; k <= 12; k++) {
    const th = cupTh + (PI - cupTh) * (k / 12), row = [];
    for (let i = 0; i < 64; i++) row.push(sph(th, (2 * PI * i) / 64, cupR + T * 0.8));
    cupOut.push(row);
  }
  emitGrid(B, cupOut.reverse(), () => OUT, true);
  // tige jusqu'au pôle arrière, avec sa collerette contre la membrane
  tubeMesh(B, [[0, 0, -(cupR + T * 0.7)], [0, 0, -0.995]], T * 0.9, 16, OUT, false);
  torusMesh(B, -0.985, T * 2.2, T * 0.6, EDGE, 32, 8);
  // rayons : du bord de la coupe aux charnières (ou aux pieds de la cage)
  const Rring = (['calyx', 'iris', 'pod'].includes(A.kind) ? R - A.ridge * T * 0.75 : R) - T * 0.5;
  const ringR = Rring * sin(thH), ringZ = Rring * cos(thH);
  const feet = cageFeet || Array.from({ length: A.kind === 'ribs' ? Math.min(A.n, 8) : A.kind === 'crown' ? 6 : A.n }, (_, i) => {
    const ph = phi0 + (2 * PI * i) / (A.kind === 'ribs' ? Math.min(A.n, 8) : A.kind === 'crown' ? 6 : A.n);
    return [ringR * cos(ph), ringR * sin(ph), ringZ];
  });
  for (const f of feet) {
    const ph = atan2(f[1], f[0]);
    const s0 = sph(cupTh + 0.06, ph, cupR + T * 0.4);
    const mid = add(mul(add(s0, f), 0.5), mul(norm(add(s0, f)), 0.05));
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(add(add(mul(s0, (1 - t) * (1 - t)), mul(mid, 2 * t * (1 - t))), mul(f, t * t))); }
    tubeMesh(B, pts, (t) => T * (0.42 - 0.12 * t), 10, OUT);
  }
  if (A.kind !== 'cage') torusMesh(B, ringZ, ringR, T * 0.75, EDGE);
  const mesh = B.out();
  return {
    mesh, dur, phi0, sites,
    parts: parts.map(({ b, a, th, ext, dir, sc, mode, delay, cols, bound, verts }) => ({ b, a, th, ext, dir, sc, mode, delay, cols, bound, verts })),
  };
}

// ── Polyèdres ────────────────────────────────────────────────────────────────
function ico() {
  const t = (1 + sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { V, F };
}
function dodeca() {
  const I = ico();
  const V = I.F.map((f) => norm(f.map((i) => I.V[i]).reduce((a, b) => add(a, b), [0, 0, 0])));
  const F = I.V.map((v, vi) => {
    const fs = I.F.map((f, fi) => [f, fi]).filter(([f]) => f.includes(vi)).map(([, fi]) => fi);
    const a = norm(cross(v, abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), b = cross(v, a);
    return fs.sort((x, y) => atan2(dot(V[x], b), dot(V[x], a)) - atan2(dot(V[y], b), dot(V[y], a)));
  });
  return { V, F };
}
function octa() {
  const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  return { V, F };
}
function slerp(a, b, t) {
  const o = acos(min(1, max(-1, dot(a, b))));
  if (o < 1e-6) return a;
  const s = sin(o);
  return add(mul(a, sin((1 - t) * o) / s), mul(b, sin(t * o) / s));
}
// rotation qui amène u sur v
function rotTo(u, v) {
  const c = dot(u, v), ax = cross(u, v), s = Math.hypot(...ax);
  if (s < 1e-9) return c > 0 ? (p) => p : (p) => [p[0], -p[1], -p[2]];
  const k = norm(ax), th = atan2(s, c);
  return (p) => add(add(mul(p, cos(th)), mul(cross(k, p), sin(th))), mul(k, dot(k, p) * (1 - cos(th))));
}

// Les faces du polyèdre de la cage, tournées comme la cage (pour le motif de
// déchirure) : centres et sommets
export function cageFaces(spec, cagePart) {
  const poly = spec.poly === 'dodeca' ? dodeca() : spec.poly === 'octa' ? octa() : ico();
  return poly.F.map((f) => f.map((i) => cagePart.verts[i]));
}
export { sph };
