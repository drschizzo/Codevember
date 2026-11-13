// Pièces de verrier : un corps de révolution (profil de souffleur), modelé
// (côtes optiques, torsade, lobes, bord festonné), et des parties assemblées
// (anses, bouchon, fil appliqué en spirale). Toutes les parties forment une
// seule surface externe, que la fracture découpe d'un seul tenant.
//
// Repère : la pièce est posée sur le sol (y = 0 à sa base), centrée sur
// l'axe ; sa plus grande dimension vaut `size`.
import { floorH } from '../cycle.js';
//
// Le paramètre d'accrétion (acc) de chaque sommet dit quand il prend forme au
// soufflage : l'abscisse le long du profil pour le corps (du pied vers le
// bord) ; 2 + t pour les parties posées après coup (anse, bouchon, fil).

// profils [r, y] (y de 0 à 1 ; r en part de la hauteur) ; flip : ouverte en
// bas (cloche, dôme) ; bowl : abscisse du profil où commence la coupe (le
// modelé ne touche ni le pied ni la jambe) ; parts : parties possibles
export const FORMS = {
  verre: { label: 'Verre à pied', bowl: 0.55, pts: [[0, 0], [0.3, 0], [0.31, 0.012], [0.14, 0.03], [0.04, 0.07], [0.032, 0.26], [0.058, 0.31], [0.034, 0.36], [0.05, 0.42], [0.2, 0.52], [0.28, 0.68], [0.27, 0.9], [0.25, 1]] },
  flute: { label: 'Flûte', bowl: 0.5, pts: [[0, 0], [0.22, 0], [0.23, 0.01], [0.09, 0.025], [0.025, 0.06], [0.022, 0.3], [0.045, 0.34], [0.03, 0.38], [0.11, 0.46], [0.15, 0.62], [0.15, 0.88], [0.14, 1]] },
  tazza: { label: 'Coupe sur pied', bowl: 0.6, h: 0.6, pts: [[0, 0], [0.42, 0], [0.43, 0.02], [0.2, 0.05], [0.06, 0.12], [0.05, 0.42], [0.1, 0.5], [0.06, 0.58], [0.32, 0.72], [0.8, 0.88], [0.98, 1]] },
  bulle: { label: 'Bulle', pts: [[0, 0], [0.18, 0.005], [0.38, 0.12], [0.47, 0.36], [0.44, 0.64], [0.29, 0.86], [0.12, 0.96], [0.085, 1]], parts: ['fil'] },
  bol: { label: 'Bol', h: 0.62, pts: [[0, 0], [0.22, 0], [0.24, 0.03], [0.44, 0.14], [0.6, 0.4], [0.67, 0.72], [0.7, 1]] },
  vase: { label: 'Vase à taille', pts: [[0, 0], [0.2, 0], [0.31, 0.1], [0.34, 0.33], [0.2, 0.6], [0.16, 0.78], [0.21, 0.92], [0.28, 1]], parts: ['anses2', 'fil'] },
  bouteille: { label: 'Bouteille', pts: [[0, 0], [0.24, 0], [0.28, 0.05], [0.29, 0.52], [0.23, 0.66], [0.1, 0.76], [0.075, 0.92], [0.095, 0.95], [0.08, 1]], parts: ['bouchon', 'fil'] },
  fiole: { label: 'Flacon', pts: [[0, 0], [0.2, 0.01], [0.36, 0.12], [0.39, 0.3], [0.3, 0.46], [0.1, 0.58], [0.075, 0.86], [0.1, 0.9], [0.085, 0.94]], parts: ['bouchon'] },
  carafe: { label: 'Carafe', pts: [[0, 0], [0.28, 0], [0.34, 0.09], [0.33, 0.33], [0.18, 0.58], [0.11, 0.74], [0.13, 0.9], [0.19, 1]], parts: ['anse', 'bouchon'] },
  cruche: { label: 'Cruche', pts: [[0, 0], [0.22, 0], [0.3, 0.12], [0.33, 0.4], [0.24, 0.66], [0.2, 0.82], [0.24, 1]], parts: ['anse'] },
  amphore: { label: 'Amphore', pts: [[0, 0], [0.13, 0], [0.14, 0.04], [0.09, 0.08], [0.28, 0.22], [0.37, 0.45], [0.29, 0.7], [0.13, 0.8], [0.12, 0.94], [0.18, 1]], parts: ['anses2'] },
  tulipe: { label: 'Tulipe', pts: [[0, 0], [0.12, 0.01], [0.27, 0.16], [0.35, 0.45], [0.31, 0.75], [0.34, 0.92], [0.4, 1]] },
  cloche: { label: 'Cloche', flip: true, pts: [[0, 0], [0.05, 0.005], [0.06, 0.04], [0.16, 0.06], [0.3, 0.14], [0.36, 0.34], [0.38, 0.65], [0.42, 0.92], [0.46, 1]] },
  dome: { label: 'Dôme', flip: true, h: 0.5, thick: 2, pts: [[0, 0], [0.3, 0.03], [0.55, 0.16], [0.75, 0.42], [0.86, 0.75], [0.9, 1]] },
};

// modelés du corps
export const DECORS = {
  lisse: { label: 'Lisse' },
  cotes: { label: 'Côtes optiques' },
  torse: { label: 'Côtes torses' },
  lobes: { label: 'Lobé' },
  feston: { label: 'Bord festonné' },
  godrons: { label: 'Godrons' },
};

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

// profil échantillonné selon la longueur d'arc : [{ r, y, s }]
export function profile(spec, rows = 110) {
  const F = FORMS[spec.form];
  const hk = (F.h ?? 1) * (spec.stretch ?? 1);
  const bowl = F.bowl ?? 0;
  const pts = F.pts.map(([r, y], i) => {
    const t = bowl ? Math.max(0, (y - bowl) / (1 - bowl)) : y;
    const bulge = i > 0 && (!bowl || y > bowl) ? 1 + (spec.bulge ?? 0) * Math.sin(Math.PI * t) + (spec.waist ?? 0) * Math.sin(2 * Math.PI * t) : 1;
    return [r * bulge * (spec.wide ?? 1), y * hk];
  });
  const dense = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) for (let k = 0; k < 24; k++) {
    const t = k / 24;
    dense.push([Math.max(0, cr(P[i - 1][0], P[i][0], P[i + 1][0], P[i + 2][0], t)), cr(P[i - 1][1], P[i][1], P[i + 1][1], P[i + 2][1], t)]);
  }
  dense.push(pts[pts.length - 1]);
  const L = [0];
  for (let i = 1; i < dense.length; i++) L.push(L[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = L[L.length - 1];
  const out = [];
  let j = 0;
  for (let k = 0; k <= rows; k++) {
    const s = (k / rows) * total;
    while (j < L.length - 2 && L[j + 1] < s) j++;
    const f = (s - L[j]) / Math.max(1e-9, L[j + 1] - L[j]);
    out.push({ r: k === 0 ? 0 : dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, y: dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f, s: k / rows });
  }
  // (la spline peut passer un peu sous le pied : la pièce est reposée sur la sole)
  const ymin0 = Math.min(...out.map((p) => p.y));
  for (const p of out) p.y -= ymin0;
  // plus grande dimension → 1
  const ymax = Math.max(...out.map((p) => p.y)), rmax = Math.max(...out.map((p) => p.r));
  const H = Math.max(ymax, 2 * rmax);
  for (const p of out) { p.r /= H; p.y /= H; }
  const yTop = ymax / H;
  if (F.flip) for (const p of out) p.y = yTop - p.y;
  // abscisse du début de la coupe (le modelé commence là)
  let sBowl = 0;
  if (bowl) { const yb = bowl * hk / H; const k = out.findIndex((p) => (F.flip ? yTop - p.y : p.y) >= yb); sBowl = k < 0 ? 0 : out[k].s; }
  return { pts: out, flip: !!F.flip, thick: F.thick ?? 1, height: yTop, sBowl };
}

// rayon modelé (part du rayon du profil) en (s, θ)
function modulation(spec, s, th, sBowl) {
  const D = spec.decor ?? 'lisse', a = spec.decorAmp ?? 0.04, n = spec.decorN ?? 12;
  const w = Math.min(1, Math.max(0, (s - sBowl - 0.02) / 0.12)) * (1 - Math.max(0, (s - 0.97) / 0.03) * (D === 'feston' ? 0 : 0.6));
  if (D === 'cotes') return 1 + a * w * Math.cos(n * th);
  if (D === 'torse') return 1 + a * w * Math.cos(n * th + 2 * Math.PI * (spec.twist ?? 0.5) * s);
  if (D === 'godrons') return 1 + a * 1.6 * w * Math.pow(Math.max(0, Math.cos(n * th * 0.5)), 3) * Math.max(0, 1 - Math.abs(s - sBowl - 0.25) / 0.25);
  if (D === 'lobes') return 1 + a * 2.5 * w * Math.cos(n * th);
  if (D === 'feston') return 1 + a * 2.2 * Math.pow(Math.max(0, (s - 0.72) / 0.28), 2) * Math.sin(n * th);
  return 1;
}

// grille (rangées × méridiens) → sommets, normales (différences finies), triangles
function grid(P, rows, cols, acc, outwardHint, closedStart) {
  const pos = [], nor = [], ac = [], tri = [];
  const at = (k, i) => P[k][(i + cols) % cols];
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  for (let k = 0; k < rows; k++) for (let i = 0; i < cols; i++) {
    const p = at(k, i);
    const du = at(k, i + 1).map((x, c) => x - at(k, i - 1)[c]);
    const kk0 = Math.max(0, k - 1), kk1 = Math.min(rows - 1, k + 1);
    let dv = at(kk1, i).map((x, c) => x - at(kk0, i)[c]);
    if (Math.hypot(...dv) < 1e-9) dv = at(Math.min(rows - 1, k + 2), i).map((x, c) => x - p[c]);
    let n = nrm([du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]);
    const h = outwardHint(k, i, p);
    if (n[0] * h[0] + n[1] * h[1] + n[2] * h[2] < 0) n = n.map((x) => -x);
    if (!Number.isFinite(n[0]) || Math.hypot(...du) < 1e-9) n = nrm(h);
    pos.push(...p); nor.push(...n); ac.push(acc(k, i));
  }
  const id = (k, i) => k * cols + ((i + cols) % cols);
  for (let k = 0; k < rows - 1; k++) for (let i = 0; i < cols; i++) tri.push(id(k, i), id(k + 1, i), id(k, i + 1), id(k, i + 1), id(k + 1, i), id(k + 1, i + 1));
  void closedStart;
  return { pos, nor, acc: ac, tri };
}

// courbe de Bézier cubique
const bez = (a, b, c, d, t) => a.map((_, k) => (1 - t) ** 3 * a[k] + 3 * (1 - t) ** 2 * t * b[k] + 3 * (1 - t) * t * t * c[k] + t ** 3 * d[k]);

// tube le long d'une courbe (repère de transport parallèle), rayon r(t)
function tube(curve, radius, segs = 48, sides = 14, acc0 = 2) {
  const C = Array.from({ length: segs + 1 }, (_, k) => curve(k / segs));
  const T = C.map((_, k) => { const a = C[Math.max(0, k - 1)], b = C[Math.min(segs, k + 1)]; const d = b.map((x, c) => x - a[c]); const l = Math.hypot(...d) || 1; return d.map((x) => x / l); });
  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const frames = [];
  for (let k = 0; k <= segs; k++) {
    const t = T[k], d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
    N = N.map((x, c) => x - d * t[c]); const l = Math.hypot(...N); N = N.map((x) => x / l);
    const B = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]];
    frames.push([N, B]);
  }
  const P = [];
  for (let k = 0; k <= segs; k++) {
    const row = [], r = radius(k / segs), [Nn, B] = frames[k];
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; row.push(C[k].map((x, c) => x + r * (Math.cos(a) * Nn[c] + Math.sin(a) * B[c]))); }
    P.push(row);
  }
  return grid(P, segs + 1, sides, (k) => acc0 + k / segs, (k, i, p) => p.map((x, c) => x - C[k][c]));
}

// spline de Catmull-Rom passant par les points de contrôle, n sous-pas par segment
function catmull(P, n) {
  const out = [], at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < n; j++) {
    const t = j / n, a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2), t2 = t * t, t3 = t2 * t;
    out.push([0, 1].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t3)));
  }
  out.push(P[P.length - 1].slice());
  return out;
}
// petit corps de révolution fermé aux deux bouts (bouchon)
function closedLathe(prof, cx, cy, cz, cols = 40, acc0 = 2) {
  const P = prof.map(([r, y]) => Array.from({ length: cols }, (_, i) => { const a = (i / cols) * Math.PI * 2; return [cx + r * Math.cos(a), cy + y, cz + r * Math.sin(a)]; }));
  return grid(P, prof.length, cols, (k) => acc0 + k / prof.length, (k, i, p) => [p[0] - cx, 0.2 * Math.sign(p[1] - cy - prof[Math.floor(prof.length / 2)][1]), p[2] - cz]);
}

// Surface externe complète : sommets, normales, accrétion, triangles, arêtes de bord
export function shellSurface(spec, { rows = 110, cols = 144 } = {}) {
  const { pts, flip, thick, height, sBowl } = profile(spec, rows);
  const S = spec.size ?? 2;
  const R = (k) => pts[k].r * S, Y = (k) => pts[k].y * S;
  // corps : grille modelée
  const P = [];
  for (let k = 0; k <= rows; k++) {
    const row = [];
    for (let i = 0; i < cols; i++) {
      const th = (i / cols) * Math.PI * 2, m = modulation(spec, pts[k].s, th, sBowl);
      const lipWave = spec.decor === 'feston' && pts[k].s > 0.85 ? (spec.decorAmp ?? 0.04) * 0.6 * S * Math.pow((pts[k].s - 0.85) / 0.15, 2) * Math.cos((spec.decorN ?? 8) * th) : 0;
      row.push([R(k) * m * Math.cos(th), Y(k) + lipWave * (flip ? -1 : 1), R(k) * m * Math.sin(th)]);
    }
    P.push(row);
  }
  const parts = [];
  const body = grid(P, rows + 1, cols, (k) => pts[k].s, (k, i, p) => {
    // (vers l'extérieur : à partir du profil)
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(rows, k + 1)];
    let nr = b.y - a.y, ny = -(b.r - a.r);
    if (flip) { nr = -nr; }
    const th = (i / cols) * Math.PI * 2;
    if (k === 0) return [0, flip ? 1 : -1, 0];
    return [nr * Math.cos(th), ny * (flip ? -1 : 1), nr * Math.sin(th)];
  });
  parts.push(body);
  // le pôle (rangée 0) : tous ses sommets au même point — on garde la grille
  // (triangles dégénérés écartés par la fracture)

  const rAt = (s) => { const k = Math.min(rows, Math.round(s * rows)); return { r: R(k), y: Y(k) }; };
  const wanted = new Set(spec.parts ?? []);
  const th0 = spec.handleAngle ?? 0;
  const handle = (ang, s0, s1, reach) => {
    const a = rAt(s0), b = rAt(s1);
    const dir = [Math.cos(ang), 0, Math.sin(ang)];
    const A = [dir[0] * a.r * 0.92, a.y, dir[2] * a.r * 0.92], D = [dir[0] * b.r * 0.92, b.y, dir[2] * b.r * 0.92];
    const out = Math.max(a.r, b.r) + reach * S;
    const Bc = [dir[0] * out, a.y + (b.y - a.y) * 0.05 + 0.04 * S, dir[2] * out], Cc = [dir[0] * out * 0.95, a.y + (b.y - a.y) * 0.75, dir[2] * out * 0.95];
    return tube((t) => bez(A, Bc, Cc, D, t), (t) => S * (spec.handleR ?? 0.022) * (1 - 0.25 * Math.sin(Math.PI * t)), 56, 14, 2);
  };
  if (wanted.has('anse')) parts.push(handle(th0, 0.86, 0.5, 0.17));
  if (wanted.has('anses2')) { parts.push(handle(th0, 0.8, 0.55, 0.12)); parts.push(handle(th0 + Math.PI, 0.8, 0.55, 0.12)); }
  if (wanted.has('bouchon') && !flip) {
    const top = pts[rows], rn = Math.max(0.02, top.r) * S;
    // (profil de contrôle lissé par une spline de Catmull-Rom : dix points
    // reliés en ligne brisée donnaient une boule octogonale, facettée de profil)
    const ctrl = [[0, -0.5], [0.85, -0.45], [0.9, 0.15], [0.62, 0.42], [0.55, 0.72], [1.15, 1.2], [1.55, 1.9], [1.55, 2.55], [1.15, 3.15], [0.5, 3.52], [0, 3.6]];
    // (la tige rodée épouse l'embouchure, mais la tête est proportionnée au col,
    // pas à l'embouchure : une carafe évasée recevait une boule de 15 cm)
    const rf = Math.min(rn, 0.085 * S), yk = 0.72;
    const prof = catmull(ctrl, 6).map(([r, y]) => (y <= yk ? [Math.max(0, r) * rn, y * rn] : [Math.max(0, r) * (rn + (rf - rn) * Math.min(1, (y - yk) / 0.5)), yk * rn + (y - yk) * rf]));
    prof[0][0] = 0; prof[prof.length - 1][0] = 0;
    parts.push(closedLathe(prof, 0, top.y * S, 0, 72, 2));
  }
  if (wanted.has('fil') && !flip) {
    // fil appliqué : un filet de verre enroulé en spirale autour du col ou de la panse
    const s0 = spec.threadFrom ?? 0.55, s1 = spec.threadTo ?? 0.9, turns = spec.threadTurns ?? 5, rr = S * 0.008;
    parts.push(tube((t) => {
      const s = s0 + (s1 - s0) * t, k = s * rows, k0 = Math.floor(k), f = k - k0, k1 = Math.min(rows, k0 + 1);
      const r = (R(k0) * (1 - f) + R(k1) * f) + rr * 0.6, y = Y(k0) * (1 - f) + Y(k1) * f, a = th0 + 2 * Math.PI * turns * t;
      return [r * Math.cos(a), y, r * Math.sin(a)];
    }, () => rr, Math.round(60 * turns), 8, 2));
  }

  // fusion ; dans chaque partie, les sommets confondus (pôles) sont soudés
  const pos = [], nor = [], acc = [], tri = [];
  for (const p of parts) {
    const o = pos.length / 3, map = new Map(), remap = [];
    for (let i = 0; i < p.pos.length / 3; i++) {
      const k = `${Math.round(p.pos[3 * i] * 1e7)},${Math.round(p.pos[3 * i + 1] * 1e7)},${Math.round(p.pos[3 * i + 2] * 1e7)}`;
      if (map.has(k)) { remap.push(map.get(k)); continue; }
      const j = pos.length / 3 - o;
      map.set(k, j); remap.push(j);
      pos.push(p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]); nor.push(p.nor[3 * i], p.nor[3 * i + 1], p.nor[3 * i + 2]); acc.push(p.acc[i]);
    }
    for (const i of p.tri) tri.push(remap[i] + o);
  }
  // arêtes de bord : celles qu'un seul triangle utilise (bord de la coupe,
  // bouts des anses et du fil)
  const count = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) { const e = key(tri[t + k], tri[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
  const border = new Set([...count].filter(([, c]) => c === 1).map(([e]) => e));
  // la sole est une cuvette : la pièce repose sur son bord le plus bas (pied,
  // lèvre d'une cloche), pas sur le plan y = 0 — sinon elle s'y enfonce
  let lift = 0;
  for (let i = 0; i < pos.length; i += 3) lift = Math.max(lift, floorH(Math.hypot(pos[i], pos[i + 2])) - pos[i + 1]);
  for (let i = 1; i < pos.length; i += 3) pos[i] += lift;
  // triangles dégénérés (pôle) écartés
  const keep = [];
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    const v = (i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
    const A = v(a), B = v(b), C = v(c);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-12) keep.push(a, b, c);
  }
  const thickness = S * (spec.thickness ?? 0.018) * thick;
  return { pos: Float64Array.from(pos), nor: Float64Array.from(nor), acc: Float64Array.from(acc), tri: Uint32Array.from(keep), border, thickness, size: S, flip, height: height * S, sBowl };
}
