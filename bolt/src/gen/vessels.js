// Les récipients : tasse et soucoupe, théière, verre à thé, bol — et la
// cuillère. Tout est tourné : un profil extérieur (points de contrôle lissés
// en Catmull-Rom), une paroi d'épaisseur constante, une lèvre roulée, un pied
// annulaire ; puis les pièces rapportées (anse, bec, bouton), balayées le long
// d'une courbe. Les rôles de surface : externe (émail), interne, tranche (la
// lèvre : le filet d'or).
//
// Unité : 1 = 10 cm. Axe y vers le haut, le récipient posé sur y = 0.
// Module pur : worker, tests, bancs.
import { Buffers, OUT, IN, EDGE, cross, norm, add, sub, mul } from '../../../shared/gen/mesh.js';

const { PI, cos, sin, hypot, max, min, atan2, asin, sqrt } = Math;
const TAU = PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = max(0, min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Catmull-Rom centripète simplifié (uniforme) sur des points 2D
function spline(pts, n) {
  const out = [];
  const P = (i) => pts[max(0, min(pts.length - 1, i))];
  const segs = pts.length - 1;
  for (let k = 0; k <= n; k++) {
    const x = (k / n) * segs, i = min(segs - 1, Math.floor(x)), t = x - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c = (a, b, cc, d) => 0.5 * ((2 * b) + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t);
    out.push([max(0, c(p0[0], p1[0], p2[0], p3[0])), c(p0[1], p1[1], p2[1], p3[1])]);
  }
  return out;
}

// Coque tournée : profil fermé (sens trigonométrique dans le plan (r, y)), de
// l'axe sous le pied à l'axe au fond de la paraison.
//   outer : points de contrôle [r, y] de la face externe, du pied (y = 0) au bord
//   t : épaisseur ; floor : hauteur du fond intérieur ; foot : { rIn, depth } | null
export function shellProfile(outer, { t = 0.03, floor = 0.05, foot = null, n = 56, fillet = 0.05 }) {
  const O = spline(outer, n);
  const nrm = O.map((_, k) => {
    const a = O[max(0, k - 1)], b = O[min(n, k + 1)];
    const d = [b[0] - a[0], b[1] - a[1]], l = hypot(d[0], d[1]) || 1;
    return [d[1] / l, -d[0] / l];
  });
  const I = O.map((p, k) => [max(0.001, p[0] - t * nrm[k][0]), p[1] - t * nrm[k][1]]);
  const prof = [];
  const P = (r, y, s) => prof.push({ r, y, s });
  if (foot) {
    P(0, foot.depth, OUT); P(foot.rIn - 0.012, foot.depth, OUT); P(foot.rIn, 0.004, OUT); P((foot.rIn + O[0][0]) / 2, 0, OUT);
  } else P(0, 0, OUT);
  for (const p of O) P(p[0], p[1], OUT);
  // lèvre : demi-cercle de la face externe à la face interne
  const a = O[n], b = I[n], c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rad = hypot(a[0] - b[0], a[1] - b[1]) / 2;
  const a0 = atan2(a[1] - c[1], a[0] - c[0]);
  for (let k = 1; k < 8; k++) { const an = a0 + (PI * k) / 8; P(c[0] + rad * cos(an), c[1] + rad * sin(an), EDGE); }
  // face interne, en descendant jusqu'au congé du fond
  const yF = floor + fillet;
  let rF = I[0][0];
  for (let k = n; k >= 0; k--) {
    if (I[k][1] <= yF) { const q = I[min(n, k + 1)], p = I[k], u = (yF - p[1]) / ((q[1] - p[1]) || 1); rF = lerp(p[0], q[0], u); break; }
    P(I[k][0], I[k][1], IN);
  }
  const f = min(fillet, rF * 0.8);
  for (let k = 0; k <= 6; k++) { const an = (PI / 2) * (k / 6); P(rF - f + f * cos(an), floor + f - f * sin(an), IN); }
  P(0, floor, IN);
  // rayons intérieur et extérieur en fonction de la hauteur
  const at = (C) => (y) => {
    if (y <= C[0][1]) return C[0][0];
    for (let k = 1; k <= n; k++) if (C[k][1] >= y) { const u = (y - C[k - 1][1]) / ((C[k][1] - C[k - 1][1]) || 1); return lerp(C[k - 1][0], C[k][0], u); }
    return C[n][0];
  };
  return { prof, rIn: at(I), rOut: at(O), lip: { r: c[0], y: c[1], rad }, top: c[1] + rad, floor, t };
}

// Révolution d'un profil autour de l'axe y ; flute : { n, amp, y0, y1 } (côtes)
export function revolve(B, prof, M = 96, flute = null, o = [0, 0, 0]) {
  const L = prof.length;
  const rows = [];
  for (let j = 0; j < L; j++) {
    const q = prof[j], a = prof[max(0, j - 1)], b = prof[min(L - 1, j + 1)];
    let d = [b.r - a.r, b.y - a.y];
    const l = hypot(d[0], d[1]) || 1;
    let n2 = [d[1] / l, -d[0] / l];
    if (q.r < 1e-6) n2 = [0, n2[1] < 0 ? -1 : 1];
    const fw = flute ? flute.amp * sstep(flute.y0, flute.y0 + 0.06, q.y) * (1 - sstep(flute.y1 - 0.06, flute.y1, q.y)) * (q.s === OUT ? 1 : 0.35) : 0;
    const row = [];
    for (let i = 0; i < M; i++) {
      const ph = (TAU * i) / M;
      const k = fw ? 1 - fw * (0.5 + 0.5 * cos(flute.n * ph)) : 1;
      const dr = fw ? q.r * fw * 0.5 * flute.n * sin(flute.n * ph) : 0; // dr/dφ
      const r = q.r * k;
      // normale : profil (n2) tourné, corrigé de la pente des côtes
      const er = [cos(ph), 0, sin(ph)], ep = [-sin(ph), 0, cos(ph)];
      const hl = hypot(r, dr) || 1;
      const nh = [(er[0] * r - ep[0] * dr) / hl, 0, (er[2] * r - ep[2] * dr) / hl];
      row.push(B.vert([o[0] + er[0] * r, o[1] + q.y, o[2] + er[2] * r], norm([nh[0] * n2[0], n2[1], nh[2] * n2[0]]), q.s, ep));
    }
    rows.push(row);
  }
  B.grid(rows, true);
}

// Surface paramétrée f(u, v), normales par différences finies
export function paramSurface(B, f, nu, nv, { closeU = true, s = OUT, flip = false } = {}) {
  const e = 2e-3, rows = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv, row = [];
    for (let i = 0; i < (closeU ? nu : nu + 1); i++) {
      const u = i / nu;
      const p = f(u, v);
      const vv = min(1 - 2 * e, max(2 * e, v));
      const du = sub(f(u + e, vv), f(u - e, vv)), dv = sub(f(u, vv + e), f(u, vv - e));
      let n = cross(du, dv);
      if (hypot(n[0], n[1], n[2]) < 1e-14) n = dv;
      if (flip) n = mul(n, -1);
      row.push(B.vert(p, norm(n), typeof s === 'function' ? s(u, v) : s, norm(du)));
    }
    rows.push(row);
  }
  B.grid(rows, closeU);
}

// Bézier cubique 3D et son repère (dans le plan z = 0 par défaut)
const bez = (P, t) => {
  const m = 1 - t;
  return [0, 1, 2].map((k) => m * m * m * P[0][k] + 3 * m * m * t * P[1][k] + 3 * m * t * t * P[2][k] + t * t * t * P[3][k]);
};
// tube de section elliptique (a dans le plan de la courbe, b hors plan), rayon variable, bouts arrondis
function tubeAlong(B, curve, rad, { nu = 20, nv = 40, s = OUT, capped = true, side = [0, 0, 1] } = {}) {
  const f = (u, v) => {
    const c = curve(v), d = norm(sub(curve(min(1, v + 1e-3)), curve(max(0, v - 1e-3))));
    const N = norm(cross(side, d)), [ra, rb] = rad(v);
    // (bouts : la section se referme en demi-ellipse)
    const k = capped ? sqrt(max(0, 1 - (max(0, abs2(v) - 1 + 0.04) / 0.04) ** 2)) : 1;
    const an = TAU * u;
    return add(c, add(mul(N, cos(an) * ra * k), mul(side, sin(an) * rb * k)));
  };
  paramSurface(B, f, nu, nv, { s });
}
const abs2 = (v) => Math.abs(v * 2 - 1);

// ── La cuillère ──────────────────────────────────────────────────────────────
// Repère local : x le long de la tige (0 : pointe du cuilleron, L : bouton),
// y vers le dessus. Renvoie aussi le point le plus haut du bouton.
function buildSpoon(B, { L = 1.3, bowlL = 0.36, bowlW = 0.22, depth = 0.055, th = 0.022, finial = 0.04 }, frame) {
  B.frame(frame.o, frame.X, frame.Y, frame.Z);
  // cuilleron : une lame épaisse, creuse dessus, bombée dessous, bord arrondi
  const a = bowlL / 2, b = bowlW / 2;
  const bowl = (u, v) => {
    // v : 0 centre du dessus → 0,5 bord → 1 centre du dessous
    const an = TAU * u, top = v < 0.5, q = top ? v * 2 : (1 - v) * 2; // q : 0 au centre, 1 au bord
    const rr = sin((PI / 2) * q);
    const egg = 1 - 0.18 * cos(an); // (plus pointu vers l'avant)
    const x = a - cos(an) * a * rr * egg, z = sin(an) * b * rr;
    const dome = (1 - rr * rr);
    const edge = 0.006 * sqrt(max(0, 1 - q ** 8));
    const y = top ? -depth * dome * 0.85 + edge * 0 : -depth * dome - th * 0.6 * sqrt(max(0, 1 - q ** 4)) - 0.001;
    return [x, y + (top ? 0 : 0), z];
  };
  paramSurface(B, bowl, 40, 28, { s: (u, v) => (Math.abs(v - 0.5) < 0.04 ? EDGE : v < 0.5 ? IN : OUT), flip: true });
  // tige : plate, qui s'élargit en spatule puis se resserre avant le bouton
  const x0 = bowlL * 0.86;
  const stem = (v) => [lerp(x0, L - finial * 0.6, v), lerp(-depth * 0.25, 0, sstep(0, 0.25, v)) + 0.02 * sin(PI * v) * 0, 0];
  const w = (v) => 0.03 + 0.035 * sstep(0.55, 0.9, v) * (1 - sstep(0.9, 1, v) * 0.75) + 0.03 * (1 - sstep(0, 0.12, v));
  tubeAlong(B, stem, (v) => [th / 2, w(v)], { nu: 16, nv: 40, s: OUT, side: [0, 0, 1], capped: false });
  // bouton : une boule sur un col
  const fr = finial;
  const knob = (u, v) => { const th2 = PI * v, an = TAU * u; return [L - fr + cos(th2) * -fr * 1 + fr, sin(th2) * cos(an) * fr * 0.9, sin(th2) * sin(an) * fr * 0.9]; };
  paramSurface(B, knob, 20, 14, { s: EDGE, flip: true });
  B.noFrame();
  const tip = add(add(frame.o, mul(frame.X, L)), [0, fr * 0.9, 0]); // sommet du bouton
  return { tip };
}

// Pose de la cuillère dans un récipient : le cuilleron sur le fond, la tige
// appuyée sur la lèvre (tangente au tore de la lèvre, par-dessus)
function spoonFrame(S, spoon, az = 0) {
  const th = spoon.th ?? 0.022;
  const c = [S.lip.r, S.lip.y], rho = S.lip.rad + th / 2 + 0.002;
  // centre du cuilleron : du côté opposé, posé sur le fond
  let ang = 0.9, p0 = [0, 0];
  for (let it = 0; it < 4; it++) {
    const hb = (spoon.bowlL ?? 0.36) * 0.5 * sin(ang) + (spoon.depth ?? 0.055) * cos(ang) + th + 0.012;
    p0 = [-S.rIn(S.floor + 0.08) * 0.42, S.floor + hb];
    const d = [c[0] - p0[0], c[1] - p0[1]], D = hypot(d[0], d[1]);
    ang = atan2(d[1], d[0]) + asin(min(0.99, rho / D));
  }
  const ca = cos(az), sa = sin(az);
  const X2 = [cos(ang), sin(ang)], Y2 = [-sin(ang), cos(ang)];
  const to3 = (v) => [v[0] * ca, v[1], v[0] * sa];
  const a = (spoon.bowlL ?? 0.36) / 2;
  const o2 = [p0[0] - X2[0] * a, p0[1] - X2[1] * a];
  return { o: to3(o2), X: to3(X2), Y: to3(Y2), Z: [-sa, 0, ca], angle: ang };
}

// ── Catalogue ────────────────────────────────────────────────────────────────
// Chaque variante : profil externe [r, y], épaisseur, fond, pied, et ce qui
// s'y rapporte. k : tirages continus de la recette (proportions).
export const VARIANTS = {
  // tasses
  tulipe: { family: 'tasse', label: 'Tasse tulipe', outer: (k) => [[0.2, 0], [0.24, 0.03], [0.34, 0.12], [0.39, 0.28], [0.4, 0.42], [0.44 + 0.03 * k.flare, 0.54]], t: 0.022, floor: 0.045, foot: { rIn: 0.15, depth: 0.02 }, handle: 'oreille', saucer: 1, fill: 0.8 },
  litron: { family: 'tasse', label: 'Litron', outer: (k) => [[0.33, 0], [0.345, 0.012], [0.35, 0.05], [0.35, 0.3], [0.35 + 0.01 * k.flare, 0.6]], t: 0.022, floor: 0.04, foot: { rIn: 0.27, depth: 0.014 }, handle: 'equerre', saucer: 1, fill: 0.82 },
  pied: { family: 'tasse', label: 'Tasse à pied', outer: (k) => [[0.22, 0], [0.2, 0.03], [0.15, 0.09], [0.2, 0.15], [0.37, 0.25], [0.42, 0.42], [0.42 + 0.03 * k.flare, 0.6]], t: 0.022, floor: 0.17, foot: { rIn: 0.16, depth: 0.05 }, handle: 'question', saucer: 1, fill: 0.8 },
  // théières
  boule: { family: 'theiere', label: 'Théière boule', outer: () => [[0.3, 0], [0.36, 0.02], [0.56, 0.2], [0.62, 0.42], [0.52, 0.66], [0.3, 0.78], [0.26, 0.8]], t: 0.026, floor: 0.04, foot: { rIn: 0.24, depth: 0.018 }, lid: 'gland', spout: 'cygne', handle: 'anse', fill: 0.7 },
  tetsubin: { family: 'theiere', label: 'Tetsubin', outer: () => [[0.34, 0], [0.42, 0.015], [0.66, 0.16], [0.7, 0.3], [0.58, 0.48], [0.36, 0.56], [0.33, 0.57]], t: 0.03, floor: 0.04, foot: null, lid: 'boule', spout: 'court', handle: 'mobile', fill: 0.7, cast: 1 },
  // verres
  droit: { family: 'verre', label: 'Verre droit', outer: (k) => [[0.26, 0], [0.275, 0.01], [0.28, 0.05], [0.31, 0.4], [0.33 + 0.01 * k.flare, 0.82]], t: 0.018, floor: 0.07, foot: null, saucer: 0, fill: 0.78, glass: 1, spoon: { L: 1.5 } },
  evase: { family: 'verre', label: 'Verre évasé', outer: (k) => [[0.2, 0], [0.215, 0.01], [0.22, 0.06], [0.24, 0.3], [0.33, 0.62], [0.38 + 0.02 * k.flare, 0.86]], t: 0.018, floor: 0.08, foot: null, saucer: 0, fill: 0.74, glass: 1, spoon: { L: 1.55 } },
  // bols
  chawan: { family: 'bol', label: 'Chawan', outer: (k) => [[0.26, 0], [0.27, 0.05], [0.36, 0.09], [0.6, 0.2], [0.68, 0.36], [0.69 + 0.02 * k.flare, 0.5]], t: 0.032, floor: 0.085, foot: { rIn: 0.2, depth: 0.04 }, fill: 0.62 },
  bolPied: { family: 'bol', label: 'Bol à pied', outer: (k) => [[0.3, 0], [0.27, 0.04], [0.2, 0.14], [0.24, 0.22], [0.5, 0.32], [0.64, 0.46], [0.68 + 0.02 * k.flare, 0.62]], t: 0.026, floor: 0.26, foot: { rIn: 0.22, depth: 0.08 }, fill: 0.72 },
  creux: { family: 'bol', label: 'Assiette creuse', outer: (k) => [[0.42, 0], [0.44, 0.012], [0.5, 0.04], [0.62, 0.16], [0.74, 0.24], [0.95 + 0.03 * k.flare, 0.27]], t: 0.026, floor: 0.04, foot: { rIn: 0.36, depth: 0.014 }, fill: 0.62 },
};
export const FAMILIES = {
  tasse: { label: 'Tasse', bolt: 'strike', variants: ['tulipe', 'litron', 'pied'] },
  theiere: { label: 'Théière', bolt: 'upward', variants: ['boule', 'tetsubin'] },
  verre: { label: 'Verre à thé', bolt: 'spider', variants: ['droit', 'evase'] },
  bol: { label: 'Bol', bolt: 'fork', variants: ['chawan', 'bolPied', 'creux'] },
};

// Construit un récipient. spec : { variant, flare, flutes, spoonAz, scale }
// Renvoie { parts: { body, metal, liquid, liquidBody? }, meta }.
export function buildVessel(spec) {
  const V = VARIANTS[spec.variant];
  const k = { flare: spec.flare ?? 0.5 };
  const yBase = V.saucer ? 0.031 : 0; // (la tasse est posée dans la cuvette de la soucoupe)
  const S = shellProfile(V.outer(k), { t: V.t, floor: V.floor, foot: V.foot });
  const body = new Buffers(1 << 15), metal = new Buffers(1 << 13);
  const lift = (p) => [p[0], p[1] + yBase, p[2]];
  const flute = spec.flutes && !V.glass && !V.cast ? { n: spec.flutes, amp: 0.035, y0: S.floor + 0.02, y1: S.top - 0.1 } : null;
  revolve(body, S.prof, 112, flute, [0, yBase, 0]);
  const meta = { variant: spec.variant, family: V.family, top: S.top + yBase, yBase, lip: { r: S.lip.r, y: S.lip.y + yBase, rad: S.lip.rad }, glass: !!V.glass, cast: !!V.cast };
  const rO = (y) => S.rOut(y), H = S.top;
  const obstacles = [{ type: 'shell', rIn: S.rIn(H * 0.8) - 0.01, rOut: max(rO(H), rO(H * 0.5)) + 0.01, yTop: S.top + yBase, yFloor: 0 }];
  let highest = null; // la pointe que la foudre choisit
  let steam = { p: [0, 0, 0], r: 0.2 };

  // ── liquide ──
  const level = S.floor + (S.top - S.floor) * V.fill;
  meta.liquid = { y: level + yBase, r: S.rIn(level), drop: 0.022 };
  // (le disque déborde un peu dans l'épaisseur de la paroi : son bord est caché)
  meta.liquid.disc = S.rIn(level) + V.t * 0.45;
  steam = { p: [0, level + yBase, 0], r: S.rIn(level) * 0.7 };
  let liquidBody = null;
  if (V.glass) {
    // (verre : on voit le thé à travers la paroi — un corps plein, juste à l'intérieur)
    const LB = new Buffers(1 << 13);
    const prof = [{ r: 0, y: S.floor + 0.003, s: OUT }];
    for (let j = 0; j <= 24; j++) { const y = lerp(S.floor + 0.003, level - 0.002, j / 24); prof.push({ r: max(0.01, S.rIn(max(y, S.floor + 0.05)) - 0.004) * (j === 0 ? 0.9 : 1), y, s: OUT }); }
    prof.push({ r: 0, y: level - 0.002, s: OUT });
    revolve(LB, prof, 72, null, [0, yBase, 0]);
    liquidBody = LB.out();
  }

  // Attache d'une anse : un point enfoui dans l'épaisseur de la paroi (au fond
  // des côtes s'il y en a) et la normale sortante de la paroi à cette hauteur.
  // L'anse quitte la paroi le long de cette normale : sa section d'attache est
  // tangente à la paroi, entièrement noyée, quelle que soit la pente du profil.
  const fluteAmp = flute ? flute.amp : 0;
  const attach = (y, side = 1) => {
    const e = 0.01, sl = (rO(y + e) - rO(y - e)) / (2 * e), l = hypot(1, sl);
    // (sous la panse, la normale plonge : on la redresse, sinon l'anse descend jusqu'à la soucoupe)
    let ny = Math.max(-0.3, Math.min(0.3, -sl / l)), nx = Math.sqrt(1 - ny * ny);
    return { p: [side * (rO(y) * (1 - fluteAmp) - V.t * 0.3), y, 0], n: [side * nx, ny, 0] };
  };
  const handleCurve = (a1, a0, out, k1, k0, d1 = 0, d0 = 0) => [a1.p, add(add(a1.p, mul(a1.n, out * k1)), [0, d1, 0]), add(add(a0.p, mul(a0.n, out * k0)), [0, d0, 0]), a0.p];
  // (la section s'épaissit vers les attaches, comme une anse collée à la barbotine)
  const handleRad = (ra, rb) => (v) => { const e = 1 + 0.55 * (1 - sin(PI * v)) ** 3; return [ra * e, rb * e]; };

  // ── anse de tasse ──
  if (V.family === 'tasse') {
    const y1 = H * (V.handle === 'question' ? 0.82 : 0.78), y0 = H * { oreille: 0.4, equerre: 0.22, question: 0.47 }[V.handle];
    const out = 0.24 + 0.03 * (spec.flare ?? 0.5), a1 = attach(y1), a0 = attach(y0);
    const C = {
      oreille: handleCurve(a1, a0, out, 1.5, 1.4, 0.07, -0.05),
      equerre: handleCurve(a1, a0, out, 1.9, 1.7, 0.02, 0.02),
      question: handleCurve(a1, a0, out, 1.8, 1.2, 0.16, -0.02),
    }[V.handle];
    tubeAlong(body, (v) => lift(bez(C, v)), handleRad(0.022, 0.034), { nu: 20, nv: 56, s: OUT, capped: false });
    obstacles.push({ type: 'ellipsoid', c: [rO(y1) + out * 0.6, (y0 + y1) / 2 + yBase, 0], r: [out * 0.75, (y1 - y0) * 0.7 + 0.05, 0.08] });
    meta.handleAz = 0;
    // (pour les tests : l'axe de l'anse et son rayon, dans le repère posé)
    meta.handle = Array.from({ length: 25 }, (_, i) => { const q = lift(bez(C, i / 24)); return [q[0], q[1], handleRad(0.022, 0.034)(i / 24)[0]]; });
  }

  // ── théière : couvercle, bouton, bec, anse ──
  if (V.family === 'theiere') {
    const rG = S.lip.r - S.lip.rad, yG = S.top;
    // couvercle : une calotte posée sur la lèvre, avec un rebord qui descend dans le col
    const lidH = V.cast ? 0.05 : 0.1;
    const lid = [{ r: 0, y: yG - 0.03, s: IN }, { r: rG - 0.03, y: yG - 0.03, s: IN }, { r: rG - 0.03, y: yG + 0.004, s: IN }, { r: rG + S.lip.rad * 2 + 0.012, y: yG + 0.004, s: EDGE }, { r: rG + S.lip.rad * 2 + 0.016, y: yG + 0.016, s: EDGE }];
    for (let j = 1; j <= 10; j++) { const a = (PI / 2) * (j / 10); lid.push({ r: (rG + S.lip.rad * 2 + 0.012) * cos(a), y: yG + 0.016 + lidH * sin(a), s: OUT }); }
    revolve(body, lid, 72, null, [0, yBase, 0]);
    const yK = yG + 0.016 + lidH;
    // bouton : gland (col, boule, pointe) ou boule aplatie
    const knobP = V.lid === 'gland'
      ? [[0.03, -0.01], [0.028, 0.02], [0.05, 0.045], [0.062, 0.08], [0.04, 0.12], [0.012, 0.15], [0, 0.158]]
      : [[0.035, -0.01], [0.03, 0.015], [0.07, 0.04], [0.075, 0.07], [0.04, 0.095], [0, 0.1]];
    const kp = spline(knobP, 28).map(([r, y]) => ({ r, y: y + yK, s: V.cast ? OUT : EDGE }));
    kp[kp.length - 1].r = 0;
    revolve(body, kp, 40, null, [0, yBase, 0]);
    const knobTop = [0, yK + knobP[knobP.length - 1][1] + yBase, 0];
    highest = knobTop;
    // bec
    const yS = H * 0.42, rS = rO(yS) - V.t * 0.3;
    const sp = V.spout === 'cygne'
      ? [[rS, yS, 0], [rS + 0.3, yS - 0.02, 0], [rS + 0.26, H * 0.82, 0], [rS + 0.5, H * 0.98, 0]]
      : [[rS, yS + 0.06, 0], [rS + 0.12, yS + 0.08, 0], [rS + 0.16, H * 0.74, 0], [rS + 0.24, H * 0.82, 0]];
    const sr = (v) => { const r = lerp(V.spout === 'cygne' ? 0.12 : 0.085, 0.045, sstep(0, 1, v)); return [r, r * 0.92]; };
    tubeAlong(body, (v) => lift(bez(sp, v)), sr, { nu: 22, nv: 44, s: OUT, capped: false });
    // (l'embouchure : un anneau et l'intérieur du bec, sombre)
    const tipP = bez(sp, 1), tipD = norm(sub(bez(sp, 1), bez(sp, 0.97)));
    tubeAlong(body, (v) => lift(add(tipP, mul(tipD, -0.1 * v))), (v) => { const r = lerp(0.045, 0.03, min(1, v * 6)); return [r, r * 0.92]; }, { nu: 22, nv: 8, s: IN, capped: false });
    steam = { p: lift(add(tipP, mul(tipD, 0.02))), r: 0.05, dir: tipD };
    obstacles.push({ type: 'ellipsoid', c: [rS + 0.3, H * 0.7 + yBase, 0], r: [0.3, 0.36, 0.12] });
    // anse
    if (V.handle === 'anse') {
      const y1 = H * 0.78, y0 = H * 0.3;
      const C = handleCurve(attach(y1, -1), attach(y0, -1), 0.3, 1.6, 1.5, 0.12, -0.1);
      tubeAlong(body, (v) => lift(bez(C, v)), handleRad(0.03, 0.042), { nu: 20, nv: 56, s: OUT, capped: false });
      obstacles.push({ type: 'ellipsoid', c: [-rO(H * 0.5) - 0.2, H * 0.55 + yBase, 0], r: [0.28, 0.34, 0.1] });
    } else {
      // anse mobile de fonte : un arceau au-dessus du couvercle, sur deux oreilles (dans le plan z)
      const rA = rO(H * 0.86) + 0.0, yA = H * 0.86, apex = yK + 0.42;
      const C = [[0, yA, -rA], [0, apex + 0.12, -rA * 1.25], [0, apex + 0.12, rA * 1.25], [0, yA, rA]];
      tubeAlong(metal, (v) => lift(bez(C, v)), () => [0.022, 0.03], { nu: 14, nv: 56, s: OUT, capped: true, side: [1, 0, 0] });
      for (const sg of [-1, 1]) { // oreilles : deux anneaux de fonte soudés à l'épaule
        const c = [0, yA + 0.0, sg * rA];
        paramSurface(body, (u, v) => { const a = TAU * u, b2 = TAU * v; const R0 = 0.05, r = 0.02; return lift([c[0] + (R0 + r * cos(b2)) * cos(a) * 0 + r * sin(b2), c[1] + (R0 + r * cos(b2)) * sin(a), c[2] + (R0 + r * cos(b2)) * cos(a)]); }, 20, 12, { s: OUT });
      }
      const top = bez(C, 0.5);
      highest = [top[0], top[1] + 0.03 + yBase, top[2]]; // (le haut de l'arceau dépasse le bouton)
    }
    obstacles.push({ type: 'ellipsoid', c: [0, yK * 0.5 + yBase, 0], r: [rO(H * 0.5) + 0.03, yK * 0.5 + 0.12, rO(H * 0.5) + 0.03] });
    obstacles.shift(); // (la coque : remplacée par l'ellipsoïde plein)
    meta.closed = true;
  }
  if (V.cast) {
    // picots de fonte (arare) : des rangées de petites demi-sphères sur la panse
    for (let row = 0; row < 5; row++) {
      const y = H * (0.2 + 0.11 * row), r = rO(y), cnt = Math.round((TAU * r) / 0.085);
      for (let i = 0; i < cnt; i++) {
        const an = (TAU * (i + (row % 2) * 0.5)) / cnt;
        if (Math.abs(an < PI ? an : an - TAU) < 0.28) continue; // (place du bec)
        const c = [cos(an) * (r - 0.004), y + yBase, sin(an) * (r - 0.004)];
        paramSurface(body, (u, v) => { const a = TAU * u, b2 = (PI / 2) * (1 - v); const er = [cos(an), 0, sin(an)], ep = [-sin(an), 0, cos(an)]; const rr = 0.017; return add(c, add(mul(er, rr * sin(b2) * 0.9), add(mul(ep, rr * cos(b2) * cos(a)), [0, rr * cos(b2) * sin(a), 0]))); }, 8, 4, { s: OUT });
      }
    }
  }

  // ── soucoupe ──
  if (V.saucer) {
    const rw = (V.foot ? S.rOut(0) : 0.3) + 0.03, R = max(0.78, rO(H) * 1.75);
    const sau = shellProfile([[rw * 0.9, 0], [rw + 0.02, 0.012], [rw + 0.05, 0.03], [R * 0.72, 0.075], [R, 0.125]], { t: 0.022, floor: 0.03, foot: { rIn: rw * 0.75, depth: 0.012 }, n: 40, fillet: 0.012 });
    revolve(body, sau.prof, 144); // (soucoupe lisse : des côtes sur une seule face la rendaient polygonale)
    meta.saucer = { r: R, top: sau.top, well: 0.03 + 0.022, surface: Array.from({ length: 30 }, (_, i) => { const y = 0.035 + (sau.top - 0.04) * (i / 29); return [sau.rIn(y), y]; }) };
    meta.yBaseWanted = 0.03 + 0.001; // (fond de la cuvette)
  }

  // ── cuillère ──
  if (V.family === 'tasse' || V.family === 'verre') {
    const sp = { L: 1.22, bowlL: 0.3, bowlW: 0.2, depth: 0.05, th: 0.022, finial: 0.036, ...(V.spoon ?? {}) };
    if (V.family === 'verre') { sp.bowlL = 0.24; sp.bowlW = 0.15; }
    sp.L = max(sp.L, (S.top - S.floor) * 1.75);
    const fr = spoonFrame(S, sp, spec.spoonAz ?? 2.4);
    fr.o = lift(fr.o);
    const out = buildSpoon(metal, sp, fr);
    highest = out.tip;
    meta.spoon = { ...sp, frame: fr };
  }
  meta.strike = highest; // (null : la foudre tombe sur le liquide)
  meta.steam = steam;
  meta.obstacles = obstacles.map((o) => (o.type === 'shell' ? { ...o, yFloor: meta.liquid.y } : o));
  meta.radius = V.saucer ? meta.saucer.r : max(rO(H), rO(H * 0.5)) + (V.family === 'theiere' ? 0.5 : 0);
  meta.profile = { rIn: null, top: S.top };
  return { parts: { body: body.out(), metal: metal.n ? metal.out() : null, liquidBody }, meta, shell: S };
}
