// La guêpe (Vespula, ouvrière de 13 mm ; la reine : ×1,35) : un modèle
// anatomique construit une fois dans un worker, instancié, et animé par un
// squelette dans le vertex shader (scene/wasps.js).
//
// Module pur (Node, worker). Repère de la guêpe : x vers l'avant (la tête), y
// vers le haut, z à droite ; unités de la scène (1 = 10 cm).
//
// Anatomie : tête de vespidé (capsule large et plate, yeux réniformes
// échancrés, trois ocelles, clypéus, mandibules dentées), antennes coudées
// (scape, flagelle de dix articles annelés), mésosome découpé (pronotum en
// collerette, scutum bombé, scutellum, propodéum qui descend vers le
// pétiole), gastre de six tergites distincts qui se recouvrent et un aiguillon,
// six pattes (hanche, fémur, tibia à éperons, cinq articles de tarse, deux
// griffes), soies dorées. Ailes à part (matériau transparent).
//
// Le squelette : douze chaînes — 0 à 5 les pattes (paire × 2 + côté, 0 à
// droite), 6–7 les antennes, 8–9 les mandibules, 10 la tête, 11 le gastre —
// chacune de 1 à 4 articulations (pivot, axe). Un sommet porte sa chaîne et
// son article : il tourne autour des articulations 0 à article (de la plus
// lointaine à la plus proche) ; antennes et mandibules suivent ensuite la tête.
//
// Attributs : wp = (pièce, s, angle, code) — s : abscisse le long de la pièce
// (motif), angle autour de son axe (0 : dessus), code = chaîne·8 + article
// (−1 : le thorax, fixe).

const PI = Math.PI, TAU = 2 * PI;
export const PART = { head: 0, eye: 1, antenna: 2, thorax: 3, waist: 4, gaster: 5, leg: 6, mandible: 7, hair: 8, ocellus: 9, clypeus: 10 };

class Mesh {
  constructor() { this.P = []; this.N = []; this.A = []; this.I = []; }
  vert(p, n, a) { this.P.push(...p); this.N.push(...n); this.A.push(...a); return this.P.length / 3 - 1; }
  tri(a, b, c) { this.I.push(a, b, c); }
  out() { return { position: new Float32Array(this.P), normal: new Float32Array(this.N), wp: new Float32Array(this.A), index: new Uint32Array(this.I) }; }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const code = (chain, seg) => (chain < 0 ? -1 : chain * 8 + seg);
// niveau de détail : 1 (proche, complet) ou 0,45 (loin : sections plus grossières, sans soies ni griffes)
let DETAIL = 1;
const nq = (n, lo) => Math.max(lo, Math.round(n * DETAIL));

// courbe de Catmull-Rom par des points
function spline(pts) {
  return (s) => {
    const n = pts.length - 1, x = Math.min(n - 1e-6, Math.max(0, s * n)), i = Math.floor(x), t = x - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
  };
}

// Un corps allongé (section elliptique) le long d'une courbe c(s), rayons
// (ry, rz)(s) dans le repère (haut, côté) de la courbe. Bouts fermés.
function sweep(M, c, ry, rz, part, cd, nS = 24, nA = 20) {
  nS = nq(nS, 3); nA = nq(nA, 6);
  const P = [];
  for (let i = 0; i <= nS; i++) {
    const s = i / nS, e = 1e-3;
    const p = c(s), t = norm(sub(c(Math.min(1, s + e)), c(Math.max(0, s - e))));
    let side = cross(t, [0, 1, 0]); if (Math.hypot(...side) < 1e-4) side = [0, 0, 1];
    side = norm(side);
    const up = norm(cross(side, t));
    P.push(Array.from({ length: nA + 1 }, (_, j) => { const a = (TAU * j) / nA; return add(p, add(mul(up, Math.cos(a) * ry(s)), mul(side, Math.sin(a) * rz(s)))); }));
  }
  const idx = P.map((row, i) => row.map((p, j) => {
    const di = sub(P[Math.min(nS, i + 1)][j], P[Math.max(0, i - 1)][j]);
    const dj = sub(row[(j + 1) % nA], row[(j - 1 + nA) % nA]);
    let n = norm(cross(di, dj));
    const ax = c(i / nS);
    if (dot(n, sub(p, ax)) < 0) n = mul(n, -1);
    if (!Number.isFinite(n[0]) || Math.hypot(...n) < 0.5) n = norm(sub(p, ax));
    if (i === 0) n = norm(sub(c(0), c(0.002)));
    if (i === nS) n = norm(sub(c(1), c(0.998)));
    return M.vert(p, n, [part, i / nS, (j / nA) * TAU, cd]);
  }));
  for (let i = 0; i < nS; i++) for (let j = 0; j < nA; j++) { const a = idx[i][j], b = idx[i][j + 1], c2 = idx[i + 1][j + 1], d = idx[i + 1][j]; M.tri(a, d, c2); M.tri(a, c2, b); }
}

// Un volume autour d'un centre : ellipsoïde modulé r(dir) ; skip(dir) retire
// des faces (l'échancrure de l'œil)
function blob(M, c, R, mod, part, cd, nU = 32, nV = 20, skip = null, partOf = null) {
  nU = nq(nU, 8); nV = nq(nV, 5);
  const pt = (u, v) => {
    const d = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
    const k = mod(d);
    return { p: add(c, [d[0] * R[0] * k, d[1] * R[1] * k, d[2] * R[2] * k]), d };
  };
  const rows = [];
  for (let j = 0; j <= nV; j++) {
    const v = -PI / 2 + (PI * j) / nV, row = [];
    for (let i = 0; i <= nU; i++) {
      const u = (TAU * i) / nU, e = 1e-3;
      const A = pt(u, v), B = pt(u + e, v), C = pt(u, Math.min(PI / 2, v + e)), D = pt(u, Math.max(-PI / 2, v - e));
      let n = norm(cross(sub(C.p, D.p), sub(B.p, A.p)));
      if (!Number.isFinite(n[0]) || Math.hypot(...n) < 0.5 || dot(n, sub(A.p, c)) < 0) n = norm(sub(A.p, c));
      row.push({ i: M.vert(A.p, n, [partOf ? partOf(A.d) : part, (j / nV), u, cd]), d: A.d });
    }
    rows.push(row);
  }
  for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
    const a = rows[j][i], b = rows[j][i + 1], cc = rows[j + 1][i + 1], d = rows[j + 1][i];
    if (skip && skip(norm(add(add(a.d, b.d), add(cc.d, d.d))))) continue;
    M.tri(a.i, d.i, cc.i); M.tri(a.i, cc.i, b.i);
  }
}

// ── Le squelette (côté droit ; le gauche est son miroir en z) ────────────────
// pattes : J0 base de la hanche (axe vertical : la patte balaie d'avant en
// arrière), J1 base du fémur, J2 genou, J3 cheville (axe horizontal, perpendiculaire
// au plan de la patte : elle se lève, se plie) ; J4 le bout du tarse
export const LEGS = [
  [[0.038, -0.009, 0.006], [0.04, -0.013, 0.01], [0.053, -0.004, 0.02], [0.063, -0.02, 0.026], [0.075, -0.026, 0.029]],
  [[0.027, -0.012, 0.008], [0.027, -0.016, 0.012], [0.031, -0.004, 0.029], [0.029, -0.022, 0.041], [0.027, -0.026, 0.055]],
  [[0.016, -0.012, 0.008], [0.014, -0.016, 0.012], [0.002, -0.003, 0.029], [-0.017, -0.022, 0.039], [-0.037, -0.026, 0.045]],
];
const ANT = { socket: [0.0655, 0.0065, 0.0045], elbow: [0.0745, 0.0165, 0.0072], tip: [0.104, 0.0115, 0.03] };
const MAND = { base: [0.0645, -0.0105, 0.0058] };
export const EYE_U = 1.0, EYE_W = 0.56; // (l'œil : son centre et sa demi-largeur en angle autour de la tête)
export const NECK = [0.0475, 0.0035, 0], PETIOLE = [0.004, 0.0005, 0];

// pivots et axes par chaîne (12 × 4), pour le shader ; flat : [x, y, z, 0]
export function skeleton() {
  const piv = [], ax = [];
  const put = (p, a) => { piv.push(...p, 0); ax.push(...norm(a), 0); };
  for (let k = 0; k < 3; k++) for (const sd of [1, -1]) {
    const J = LEGS[k].map((p) => [p[0], p[1], p[2] * sd]);
    const flat = norm([J[4][0] - J[1][0], 0, J[4][2] - J[1][2]]);
    const bend = norm(cross(flat, [0, 1, 0]));
    put(J[0], [0, 1, 0]); put(J[1], bend); put(J[2], bend); put(J[3], bend);
  }
  for (const sd of [1, -1]) {
    const s = [ANT.socket[0], ANT.socket[1], ANT.socket[2] * sd], e = [ANT.elbow[0], ANT.elbow[1], ANT.elbow[2] * sd];
    const scape = norm(sub(e, s));
    put(s, [0, 1, 0]); put(s, norm(cross(scape, [0, 1, 0]))); put(e, norm(cross(norm(sub([ANT.tip[0], ANT.tip[1], ANT.tip[2] * sd], e)), [0, 1, 0]))); put(e, [0, 1, 0]);
  }
  for (const sd of [1, -1]) { const b = [MAND.base[0], MAND.base[1], MAND.base[2] * sd]; put(b, [0.25, 1, 0]); put(b, [0, 1, 0]); put(b, [0, 1, 0]); put(b, [0, 1, 0]); }
  put(NECK, [0, 1, 0]); put(NECK, [0, 0, 1]); put(NECK, [0, 0, 1]); put(NECK, [0, 0, 1]);
  put(PETIOLE, [0, 0, 1]); put(PETIOLE, [0, 1, 0]); put(PETIOLE, [0, 0, 1]); put(PETIOLE, [0, 0, 1]);
  return { piv: new Float32Array(piv), ax: new Float32Array(ax) };
}

// une soie : une fine aiguille courbe (trois faces), de la base au bout
function hair(M, P, d, len, r, cd, tint = 0.5) {
  if (DETAIL < 1) return; // (loin : pas de soies)
  const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(d, a)), v = cross(d, u);
  const ring = (c, rr) => [0, 1, 2].map((k) => { const ang = (TAU * k) / 3; const o = add(mul(u, Math.cos(ang)), mul(v, Math.sin(ang))); return [add(c, mul(o, rr)), o]; });
  const mid = add(add(P, mul(d, len * 0.55)), mul(v, -len * 0.08)), end = add(add(P, mul(d, len)), mul(v, -len * 0.22));
  const A = ring(P, r).map(([p, n]) => M.vert(p, n, [8, 0, tint, cd]));
  const B = ring(mid, r * 0.6).map(([p, n]) => M.vert(p, n, [8, 0.5, tint, cd]));
  const T = M.vert(end, d, [8, 1, tint, cd]);
  for (let k = 0; k < 3; k++) { const k1 = (k + 1) % 3; M.tri(A[k], B[k], B[k1]); M.tri(A[k], B[k1], A[k1]); M.tri(B[k], T, B[k1]); }
}

export function buildWasp({ lod = 0 } = {}) {
  DETAIL = lod ? 0.45 : 1;
  const M = new Mesh();
  let hs = 1234567;
  const rnd = () => ((hs = (hs * 1664525 + 1013904223) >>> 0) / 4294967296);
  const HEAD = code(10, 1), GASTER = code(11, 0);

  // ── Gastre : six tergites distincts (chacun bombé, son bord postérieur un peu
  // évasé recouvre le début du suivant), puis l'aiguillon ──
  const segs = [0, 0.21, 0.38, 0.54, 0.69, 0.83, 1];
  const gx0 = -0.0035, gx1 = -0.079;
  const gc = (s) => [gx0 + (gx1 - gx0) * s, -0.0015 - 0.0065 * s * s, 0];
  const env = (s) => 0.0218 * Math.pow(Math.sin(PI * Math.min(1, Math.max(0.004, s ** 0.7))), 0.72) + 0.0005;
  for (let k = 0; k < 6; k++) {
    const a = Math.max(0, segs[k] - (k ? 0.03 : 0)), b = Math.min(1, segs[k + 1] + (k < 5 ? 0.008 : 0));
    const prof = (t) => { const s = a + (b - a) * t; return env(s) * (1 - 0.07 * (k ? Math.max(0, 1 - t * 6) : 0) + 0.035 * Math.pow(t, 6)); };
    sweep(M, (t) => gc(a + (b - a) * t), (t) => prof(t) * 0.9, prof, 5, GASTER, 16, 30);
  }
  sweep(M, (t) => add(gc(1), [-0.004 * t, -0.0006 * t, 0]), (t) => 0.0007 * (1 - t) + 0.0001, (t) => 0.0007 * (1 - t) + 0.0001, 5, GASTER, 4, 8);
  // le pétiole : une courte attache, étroite
  sweep(M, (s) => [0.0072 - 0.011 * s, 0.0016 - 0.002 * s, 0], (s) => 0.0034 + 0.0016 * Math.sin(PI * s), (s) => 0.0036 + 0.0016 * Math.sin(PI * s), 4, -1, 8, 16);

  // ── Mésosome : du propodéum (s = 0, derrière) au cou (s = 1) ; le dos monte en
  // pente, le scutellum fait une bosse, le scutum un dôme, le pronotum une collerette ──
  const hT = (s) => 0.0015 + 0.0165 * Math.pow(Math.sin(PI * Math.min(1, s * 1.02)), 0.55) * (1 + 0.07 * Math.exp(-((s - 0.36) ** 2) / 0.002) - 0.06 * Math.exp(-((s - 0.44) ** 2) / 0.0015) - 0.12 * Math.exp(-((s - 0.86) ** 2) / 0.0012));
  const wT = (s) => 0.0015 + 0.0148 * Math.pow(Math.sin(PI * s), 0.6);
  sweep(M, (s) => [0.0055 + 0.042 * s, 0.0015 + 0.0045 * Math.sin(PI * s), 0], hT, wT, 3, -1, 44, 30);
  // ── Tête : capsule large et plate, élargie en haut, resserrée vers le clypéus ;
  // les yeux sont un bombement de la capsule elle-même (pas des disques posés) :
  // un contour réniforme sur chaque flanc, échancré au bord avant à hauteur des
  // antennes, bombé en dôme ──
  const eyeBulge = (d) => { // (centre à ±EYE_U du devant : les yeux bordent la face, on les voit de face et de dessus)
    const u = Math.atan2(d[2], d[0]), v = Math.asin(Math.max(-1, Math.min(1, d[1])));
    const du = (Math.abs(u) - EYE_U) / EYE_W, dv = (v - 0.04) / 0.8;
    const e = du * du + dv * dv, nd = ((du + 1.02) / 0.62) ** 2 + ((dv - 0.3) / 0.4) ** 2;
    return 0.17 * Math.sqrt(Math.max(0, 1 - e)) * sm(0.8, 1.35, nd);
  };
  const headShape = (d) => (1 + 0.08 * d[1] - 0.1 * Math.max(0, -d[1]) ** 2) * (1 - 0.14 * sm(0.25, -0.45, d[0])) * (1 - 0.14 * Math.max(0, -d[1]) * Math.max(0, d[0])) * (1 + eyeBulge(d));
  blob(M, [0.0565, 0.002, 0], [0.0102, 0.0168, 0.0196], headShape, 0, HEAD, 76, 46, null, (d) => (eyeBulge(d) > 0.012 ? 1 : 0));
  // clypéus : un bouclier sur le bas de la face, son bord inférieur échancré
  blob(M, [0.0646, -0.0058, 0], [0.0032, 0.0058, 0.0074], (d) => 1 - 0.18 * Math.max(0, -d[1]) * Math.exp(-((d[2] * 4) ** 2)), 10, HEAD, 24, 14);
  // trois ocelles sur le vertex
  if (!lod) for (const o of [[0.0545, 0.0178, 0], [0.0527, 0.0171, 0.0032], [0.0527, 0.0171, -0.0032]]) blob(M, o, [0.0011, 0.0011, 0.0011], () => 1, 9, HEAD, 10, 6);
  // mandibules dentées (une lame courbe, trois dents sur le bord interne)
  for (const sd of [1, -1]) {
    const pts = [[0.0645, -0.0105, sd * 0.0058], [0.0705, -0.0128, sd * 0.0042], [0.0735, -0.0136, sd * 0.0012]];
    sweep(M, spline(pts), (s) => 0.0011 * (1 - 0.6 * s) + 0.0002, (s) => (0.0019 * (1 - 0.55 * s) + 0.0003) * (1 + 0.25 * Math.pow(Math.abs(Math.sin(3 * PI * s)), 4)), 7, code(sd > 0 ? 8 : 9, 0), 12, 10);
  }
  // antennes : scape (article 1), puis pédicelle et flagelle de dix articles annelés (article 2)
  for (const sd of [1, -1]) {
    const s0 = [ANT.socket[0], ANT.socket[1], ANT.socket[2] * sd], e0 = [ANT.elbow[0], ANT.elbow[1], ANT.elbow[2] * sd], t0 = [ANT.tip[0], ANT.tip[1], ANT.tip[2] * sd];
    const ch = sd > 0 ? 6 : 7;
    sweep(M, (s) => lerp3(s0, e0, s), (s) => 0.00095 + 0.00025 * s, (s) => 0.00095 + 0.00025 * s, 2, code(ch, 1), 8, 8);
    const mid = add(lerp3(e0, t0, 0.5), [0, 0.003, 0]);
    sweep(M, spline([e0, lerp3(e0, mid, 0.5), mid, lerp3(mid, t0, 0.6), t0]), (s) => (0.0012 - 0.0002 * s) * (1 - 0.12 * Math.pow(Math.abs(Math.cos(11 * PI * s)), 8)), (s) => (0.0012 - 0.0002 * s) * (1 - 0.12 * Math.pow(Math.abs(Math.cos(11 * PI * s)), 8)), 2, code(ch, 2), 44, 8);
  }
  // ── Pattes ──
  LEGS.forEach((L, k) => {
    for (const sd of [1, -1]) {
      const J = L.map((p) => [p[0], p[1], p[2] * sd]), ch = k * 2 + (sd > 0 ? 0 : 1);
      // hanche (trapue), fémur (renflé, aplati), tibia (qui s'évase vers le bout),
      // tarse (cinq articles, chacun renflé à son bout)
      const R = [[0.0021, 0.0016], [0.0012, 0.001], [0.0008, 0.0012], [0.00078, 0.0005]];
      for (let q = 0; q < 4; q++) {
        const a = J[q], b = J[q + 1];
        const bump = q === 3 ? (s) => 1 + 0.4 * Math.pow(Math.abs(Math.sin(5 * PI * s)), 3) : q === 1 ? (s) => 1 + 0.35 * Math.pow(Math.sin(PI * s), 0.7) : q === 2 ? (s) => 1 + 0.12 * Math.pow(s, 4) : (s) => 1 + 0.2 * Math.sin(PI * s);
        const flat = q === 1 ? 0.72 : q === 2 ? 0.82 : 0.92;
        sweep(M, (s) => lerp3(a, b, s), (s) => (R[q][0] + (R[q][1] - R[q][0]) * s) * bump(s), (s) => (R[q][0] + (R[q][1] - R[q][0]) * s) * bump(s) * flat, 6, code(ch, q), q === 3 ? 26 : 14, 10);
        // soies et épines (tibia, tarse), les deux éperons au bout du tibia
        if (q >= 2) for (let h = 0; h < (q === 2 ? 12 : 8); h++) {
          const sp = (h + 0.5) / (q === 2 ? 12 : 8), P0 = lerp3(a, b, sp), dir = norm(sub(b, a));
          const side = norm(cross(dir, [Math.cos(h * 2.4 + k), Math.sin(h * 2.4 + k), 0.3]));
          hair(M, add(P0, mul(side, R[q][0])), norm(add(mul(side, 0.55), mul(dir, 0.85))), q === 2 ? 0.003 : 0.0018, 0.0001, code(ch, q));
        }
        if (q === 2) for (const o of [0.5, -0.5]) { const dir = norm(sub(b, a)), side = norm(cross(dir, [0, o, 1])); hair(M, add(b, mul(side, 0.0008)), norm(add(dir, mul(side, 0.3))), 0.0028, 0.00022, code(ch, 2)); }
      }
      const dir = norm(sub(J[4], J[3]));
      if (!lod) for (const cs of [1, -1]) {
        const c0 = J[4], c1 = add(J[4], add(mul(dir, 0.0016), [0, -0.0007, 0.0007 * cs])), c2 = add(J[4], add(mul(dir, 0.002), [0, -0.0022, 0.0011 * cs]));
        sweep(M, spline([c0, c1, c2]), (s) => 0.00028 * (1 - 0.8 * s) + 0.00004, (s) => 0.00028 * (1 - 0.8 * s) + 0.00004, 6, code(ch, 3), 6, 5);
      }
    }
  });
  // ── Soies du corps : denses sur la tête et le thorax, plus rares sur le gastre ──
  const zones = [
    { n: 2100, c: (s) => [0.0055 + 0.042 * s, 0.0015 + 0.0045 * Math.sin(PI * s), 0], ry: hT, rz: wT, s0: 0.04, s1: 0.96, len: 0.0062, cd: -1 },
    { n: 520, c: gc, ry: (s) => env(s) * 0.9, rz: env, s0: 0.01, s1: 0.35, len: 0.0035, cd: GASTER },
  ];
  for (const Z of zones) for (let i = 0; i < Z.n; i++) {
    const sv = Z.s0 + (Z.s1 - Z.s0) * rnd(), a = rnd() * TAU;
    const c = Z.c(sv), P = add(c, [0, Math.cos(a) * Z.ry(sv), Math.sin(a) * Z.rz(sv)]);
    const n = norm(sub(P, c));
    if (n[1] < -0.55 && rnd() < 0.5) continue; // (le dessous, moins velu)
    hair(M, P, norm(add(n, [-0.75 + 0.3 * rnd(), 0.25 * (rnd() - 0.5), 0.4 * (rnd() - 0.5)])), Z.len * (0.45 + 0.8 * rnd()), 0.00009, Z.cd, rnd());
  }
  for (let i = 0; i < 760; i++) { // tête : front, vertex et joues (pas sur les yeux)
    const u = rnd() * TAU, v = (rnd() - 0.3) * 1.4;
    const d = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
    if (eyeBulge(d) > 0.004) continue;
    const P = add([0.0565, 0.002, 0], [d[0] * 0.0098, d[1] * 0.0162, d[2] * 0.0192]);
    hair(M, P, norm(add(d, [0.3, 0.5, 0])), 0.0032 * (0.5 + 0.7 * rnd()), 0.00008, HEAD, rnd());
  }
  const out = M.out();
  DETAIL = 1;
  return out;
}

// Les ailes : une lame mince par aile, en coordonnées d'aile (u le long, de la
// charnière à la pointe ; v en travers, 0 au bord d'attaque). En vol, chaque
// aile est tracée en cinq exemplaires pris à cinq instants du battement, chacun
// à un cinquième de l'opacité : l'aile floue d'un vrai battement à 150 Hz vu
// à 60 i/s (un fondu fixe, sans scintillement). Attribut ww = (aile + 4·copie, u, v, face).
export const WINGS = [
  { hinge: [0.032, 0.0145, 0.009], len: 0.092, chord: 0.024 }, // aile antérieure
  { hinge: [0.023, 0.0125, 0.008], len: 0.066, chord: 0.017 }, // aile postérieure
];
export const WING_COPIES = 5;
export function buildWings() {
  const P = [], N = [], W = [], I = [];
  // contour : étroite à la charnière, large aux deux tiers, pointe arrondie ;
  // le bord de fuite légèrement concave
  const outline = (u) => Math.pow(Math.sin(PI * Math.min(1, u * 0.98 + 0.02)), 0.55) * (0.55 + 0.45 * Math.sin(PI * Math.min(1, u * 0.85)));
  for (let c = 0; c < WING_COPIES; c++) [0, 1].forEach((w) => {
    for (const sd of [1, -1]) {
      const id = w * 2 + (sd > 0 ? 0 : 1) + 4 * c;
      const nU = 22, nV = 7, base = P.length / 3;
      for (const face of [1, -1]) for (let i = 0; i <= nU; i++) for (let j = 0; j <= nV; j++) {
        const u = i / nU, v = j / nV, cc = outline(u);
        P.push(u, face * 0.00012, v * cc); N.push(0, face, 0); W.push(id, u, v * cc, face);
      }
      const rowN = nV + 1, faceN = (nU + 1) * rowN;
      for (let f = 0; f < 2; f++) for (let i = 0; i < nU; i++) for (let j = 0; j < nV; j++) {
        const a = base + f * faceN + i * rowN + j, b = a + 1, c2 = a + rowN + 1, d = a + rowN;
        if (f === 0) I.push(a, d, c2, a, c2, b); else I.push(a, b, c2, a, c2, d);
      }
    }
  });
  return { position: new Float32Array(P), normal: new Float32Array(N), ww: new Float32Array(W), index: new Uint32Array(I) };
}
