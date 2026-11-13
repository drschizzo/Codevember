// Les récipients : tasse et soucoupe, théière, verre à thé, bol — et la
// machine qui chauffe le thé de chacun. Tout est tourné : un profil extérieur (points de contrôle lissés
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

// Révolution d'un profil autour de l'axe y.
// flute : { n, amp, y0, y1 } — des godrons : n lobes bombés séparés par des
// gorges vives (profil |sin|^0,85 : une arête au fond de la gorge),
// qui naissent au-dessus du pied et meurent sous un jonc (une moulure en
// relief, à y1). Les normales sont alors prises sur le maillage.
export function revolve(B, prof, M = 96, flute = null, o = [0, 0, 0], heat = null) {
  const L = prof.length;
  const rows = [], P = [], N0 = [];
  for (let j = 0; j < L; j++) {
    const q = prof[j];
    const a = prof[max(0, j - 1)], b = prof[min(L - 1, j + 1)];
    let d = [b.r - a.r, b.y - a.y];
    const l = hypot(d[0], d[1]) || 1;
    let n2 = [d[1] / l, -d[0] / l];
    if (q.r < 1e-6) n2 = [0, n2[1] < 0 ? -1 : 1];
    const act = flute ? sstep(flute.y0, flute.y0 + 0.05, q.y) * (1 - sstep(flute.y1 - 0.05, flute.y1 - 0.008, q.y)) : 0;
    const fw = flute ? flute.amp * act * (q.s === OUT ? 1 : 0.75) : 0; // (la face interne suit : la paroi garde son épaisseur au fond des gorges)
    // (le jonc : un tore en relief qui coiffe les godrons, sur la face externe)
    const bead = flute && q.s === OUT ? 0.0055 * Math.exp(-(((q.y - flute.y1 - 0.004) / 0.0075) ** 2)) : 0;
    const pr = [], nr = [];
    for (let i = 0; i < M; i++) {
      const ph = (TAU * i) / M;
      const r = (q.r + bead) * (fw ? 1 - fw * (1 - Math.abs(sin(flute.n * ph * 0.5)) ** 0.85) : 1);
      const er = [cos(ph), 0, sin(ph)];
      pr.push([o[0] + er[0] * r, o[1] + q.y, o[2] + er[2] * r]);
      nr.push(norm([er[0] * n2[0], n2[1], er[2] * n2[0]]));
    }
    P.push(pr); N0.push(nr);
  }
  for (let j = 0; j < L; j++) {
    const q = prof[j];
    if (heat) B.anchor = heat(q.y);
    const row = [];
    for (let i = 0; i < M; i++) {
      const ph = (TAU * i) / M, ep = [-sin(ph), 0, cos(ph)];
      let n = N0[j][i];
      if (flute && q.r > 1e-6) {
        // normale du maillage (différences centrées), orientée comme celle du profil
        const tu = sub(P[j][(i + 1) % M], P[j][(i + M - 1) % M]), tv = sub(P[min(L - 1, j + 1)][i], P[max(0, j - 1)][i]);
        let m = cross(tu, tv);
        const ml = hypot(m[0], m[1], m[2]);
        if (ml > 1e-12) { m = mul(m, 1 / ml); n = m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0 ? mul(m, -1) : m; }
      }
      row.push(B.vert(P[j][i], n, q.s, ep));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  if (heat) B.anchor = [0, 0, 0];
}

// heat(u, v) → [s, nature, 0] : la place du sommet sur le chemin de la chaleur (voir HEAT)
export function paramSurface(B, f, nu, nv, { closeU = true, s = OUT, flip = false, heat = null } = {}) {
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
      if (heat) B.anchor = heat(u, v);
      row.push(B.vert(p, norm(n), typeof s === 'function' ? s(u, v) : s, norm(du)));
    }
    rows.push(row);
  }
  B.grid(rows, closeU);
  if (heat) B.anchor = [0, 0, 0];
}

// Bézier cubique 3D et son repère (dans le plan z = 0 par défaut)
const bez = (P, t) => {
  const m = 1 - t;
  return [0, 1, 2].map((k) => m * m * m * P[0][k] + 3 * m * m * t * P[1][k] + 3 * m * t * t * P[2][k] + t * t * t * P[3][k]);
};
// tube de section elliptique (a dans le plan de la courbe, b hors plan), rayon variable, bouts arrondis
function tubeAlong(B, curve, rad, { nu = 20, nv = 40, s = OUT, capped = true, side = [0, 0, 1], heat = null } = {}) {
  const f = (u, v) => {
    const c = curve(v), d = norm(sub(curve(min(1, v + 1e-3)), curve(max(0, v - 1e-3))));
    const N = norm(cross(side, d)), [ra, rb] = rad(v);
    // (bouts : la section se referme en demi-ellipse)
    const k = capped ? sqrt(max(0, 1 - (max(0, abs2(v) - 1 + 0.04) / 0.04) ** 2)) : 1;
    const an = TAU * u;
    return add(c, add(mul(N, cos(an) * ra * k), mul(side, sin(an) * rb * k)));
  };
  paramSurface(B, f, nu, nv, { s, heat: heat ? (u, v) => heat(v) : null });
}
const abs2 = (v) => Math.abs(v * 2 - 1);

// ── Les machines ─────────────────────────────────────────────────────────────
// Ce que la foudre touche, et ce qu'elle en fait : chaque récipient a sa
// machine à chauffer le thé. La foudre tombe sur une pointe ; la chaleur
// descend le métal ; une résistance, des braises ou des pierres rougissent, et
// le thé repart en vapeur.
//
//   plongeur : un thermoplongeur à paratonnerre pincé sur la lèvre (tasse, verre)
//   rechaud  : un réchaud à spirale sous la théière, et son mât
//   braise   : un brasero sous la bouilloire de fonte ; la foudre tombe sur l'arceau
//   pierres  : des pierres chaudes dans le bol ; un arc par pierre
//
// Chaque sommet porte sa place sur le chemin de la chaleur (attribut anchor) :
// [s, nature, grain]. s : 0 à la pointe, 1 au bout de la résistance ; nature :
// 0 inerte, ROD le métal mince (il rougit au passage et refroidit vite), HOT ce
// qui garde la chaleur toute la boucle.
export const HEAT = { ROD: 1, HOT: 2 };
const rod = (s) => [s, HEAT.ROD, 0], hot = (s, g = 0) => [s, HEAT.HOT, g];
const hsh = (i, k = 0) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// courbe lisse par des points 3D (Catmull-Rom uniforme), paramétrée sur [0, 1]
const cr3 = (pts) => (v) => {
  const segs = pts.length - 1, x = min(segs - 1e-9, max(0, v) * segs), i = Math.floor(x), t = x - i;
  const P = (k) => pts[max(0, min(segs, k))], p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));
};
// tube rond le long d'une courbe gauche (hélice, spirale) ; bouts fermés en demi-sphère
function tube3(B, curve, r, { nu = 12, nv = 64, up = [0, 1, 0], s = OUT, heat = null } = {}) {
  const f = (u, v) => {
    const c = curve(v), d = norm(sub(curve(min(1, v + 1e-3)), curve(max(0, v - 1e-3))));
    let N = cross(up, d);
    if (hypot(N[0], N[1], N[2]) < 1e-4) N = cross([1, 0, 0], d);
    N = norm(N);
    const Bn = cross(d, N), an = TAU * u;
    const k = sqrt(max(0, 1 - (max(0, abs2(v) - 1 + 0.03) / 0.03) ** 2));
    return add(c, add(mul(N, cos(an) * r * k), mul(Bn, sin(an) * r * k)));
  };
  paramSurface(B, f, nu, nv, { s, heat: heat ? (u, v) => heat(v) : null });
}
// galet, braise : un ellipsoïde cabossé (rayons R, cabosses d'amplitude amp), posé en c, tourné de rot
function lump(B, c, R, { amp = 0.12, seed = 1, rot = 0, nu = 22, nv = 14, heat = null } = {}) {
  const ca = cos(rot), sa = sin(rot);
  const f = (u, v) => {
    const th = PI * min(0.999, max(0.001, v)), an = TAU * u;
    const d = [sin(th) * cos(an), cos(th), sin(th) * sin(an)];
    // (cabosses : quelques ondes de basse fréquence, propres à chaque pierre)
    let k = 1;
    for (let j = 0; j < 4; j++) k += amp * 0.5 * sin(d[0] * (2 + j) * (1 + hsh(seed, j)) + d[1] * (1.5 + j) * (1 + hsh(seed, j + 7)) + d[2] * (2.5 + j * 0.7) + hsh(seed, j + 13) * TAU) / (1 + j * 0.6);
    const q = [d[0] * R[0] * k, d[1] * R[1] * k, d[2] * R[2] * k];
    return [c[0] + q[0] * ca + q[2] * sa, c[1] + q[1], c[2] - q[0] * sa + q[2] * ca];
  };
  paramSurface(B, f, nu, nv, { s: OUT, heat: heat ? (u, v) => heat(v) : null });
}
// Le mât : une tige tournée, sa boule (le paratonnerre des toits : une boule
// de laiton sous la pointe), une bague, et la pointe effilée. Base en o, hauteur
// H ; la chaleur y descend de s = 0 (la pointe) à s1 (le pied).
function mast(B, o, H, { r = 0.0105, ball = 0.04, s1 = 0.4, style = 0 } = {}) {
  const pr = [[r * 1.9, 0], [r * 1.9, 0.012], [r * 1.25, 0.02], [r, 0.035]];
  const yb = H * (style ? 0.6 : 0.68);
  pr.push([r, yb - ball * 1.5], [r * 1.5, yb - ball * 1.15], [r * 1.5, yb - ball * 1.0]);
  for (let k = 0; k <= 10; k++) { const a = -PI / 2 + (PI * k) / 10; pr.push([max(r * 1.2, ball * cos(a) * (style ? 0.8 : 1)), yb + ball * sin(a) * (style ? 1.25 : 0.92)]); }
  pr.push([r * 1.5, yb + ball * 1.0], [r * 1.5, yb + ball * 1.15], [r * 0.95, yb + ball * 1.5]);
  if (style) { const y2 = H * 0.82, b2 = ball * 0.55; pr.push([r * 0.95, y2 - b2 * 1.3]); for (let k = 0; k <= 6; k++) { const a = -PI / 2 + (PI * k) / 6; pr.push([max(r, b2 * cos(a)), y2 + b2 * sin(a)]); } pr.push([r * 0.9, y2 + b2 * 1.3]); }
  pr.push([r * 0.8, H - 0.12], [r * 0.42, H - 0.05], [0.0012, H]);
  const prof = [];
  for (let i = 0; i < pr.length; i++) {
    const [ra, ya] = pr[i];
    prof.push({ r: ra, y: ya, s: OUT });
    if (i + 1 < pr.length && pr[i + 1][1] - ya > 0.08) { const n = Math.ceil((pr[i + 1][1] - ya) / 0.06); for (let k = 1; k < n; k++) prof.push({ r: lerp(ra, pr[i + 1][0], k / n), y: lerp(ya, pr[i + 1][1], k / n), s: OUT }); }
  }
  prof.push({ r: 0, y: H, s: OUT });
  revolve(B, prof, 20, null, o, (y) => rod(s1 * (1 - y / H)));
  return [o[0], o[1] + H, o[2]];
}

// Thermoplongeur : une pince à cheval sur la lèvre, le mât au-dessus, une
// jambe qui descend le long de la paroi et la résistance en hélice dans le thé.
function buildPlunger(B, S, { az, yBase, level, style = 0 }) {
  const ca = cos(az), sa = sin(az), to3 = (r, y) => [r * ca, y + yBase, r * sa];
  const lr = S.lip.r, top = S.top, side = [-sa, 0, ca];
  // pince : un ruban plié en U renversé sur la lèvre
  const g = S.lip.rad + 0.014;
  const clip = cr3([to3(lr + g + 0.004, top - 0.075), to3(lr + g, top - 0.03), to3(lr + g * 0.7, top + 0.006), to3(lr, top + 0.016), to3(lr - g * 0.7, top + 0.006), to3(lr - g, top - 0.03), to3(lr - g - 0.002, top - 0.075)]);
  tubeAlong(B, clip, () => [0.0065, 0.026], { nu: 14, nv: 36, side, heat: () => rod(0.42) });
  // mât
  const H = 0.6 + 0.08 * style;
  const tip = mast(B, to3(lr, top + 0.018), H, { s1: 0.4, style });
  // jambe : de la pince au fond, le long de la paroi
  const Rc = min(0.085, S.rIn(level) * 0.27), depth = level - S.floor;
  const y0 = level - min(0.045, depth * 0.3), y1 = S.floor + max(0.03, depth * 0.16), turns = max(3, min(7, Math.round((y0 - y1) / 0.028)));
  const rw = (y) => S.rIn(max(y, S.floor + 0.06)) - 0.017;
  // (l'hélice tient dans le récipient sur toute sa hauteur : il se resserre vers le fond)
  let rwMin = Infinity;
  for (let k = 0; k <= 8; k++) rwMin = min(rwMin, S.rIn(lerp(y1, y0, k / 8)) - 0.024);
  const rc = rwMin - Rc;
  const leg = cr3([to3(lr - g - 0.002, top - 0.06), to3(rw(top - 0.12) + 0.004, top - 0.12), to3(rw((top + y0) / 2), (top + y0) / 2), to3(min(rw(y0 + 0.03), rc + Rc + 0.01), y0 + 0.03), to3(rc + Rc, y0)]);
  tube3(B, leg, 0.0075, { nu: 10, nv: 40, up: side, heat: (v) => rod(0.42 + 0.14 * v) });
  // résistance : une hélice d'axe vertical, qui descend ; elle part de la paroi
  const cx = rc * ca, cz = rc * sa;
  const coil = (v) => { const an = az + TAU * turns * v; return [cx + Rc * cos(an), lerp(y0, y1, v) + yBase, cz + Rc * sin(an)]; };
  tube3(B, coil, 0.0105, { nu: 10, nv: turns * 28, heat: (v) => hot(0.58 + 0.42 * v) });
  return { kind: 'plongeur', tip, glow: { c: [cx, level + yBase, cz], r: Rc, y: (y0 + y1) / 2 + yBase, liquid: true }, spots: [[cx, cz, Rc]] };
}

// Réchaud : un tambour bas sur trois pieds, une spirale chauffante au fond,
// trois taquets où pose le pied de la théière ; un bras en sort et porte le mât.
function buildWarmer(B, { az, lift, rFoot, rMax, topMost, style = 0 }) {
  const Rd = rFoot + 0.13, yT = lift - 0.012, yS = lift - 0.062;
  // tambour : une cuvette de tôle à bord roulé
  const drum = [{ r: 0, y: 0.042 }, { r: Rd - 0.03, y: 0.042 }, { r: Rd + 0.004, y: 0.05 }, { r: Rd + 0.014, y: 0.058 }, { r: Rd + 0.014, y: 0.068 }, { r: Rd + 0.008, y: 0.075 }];
  for (let k = 0; k <= 8; k++) { const a = (PI * k) / 8; drum.push({ r: Rd + 0.008 * cos(a), y: yT - 0.008 + 0.01 * sin(a) }); }
  drum.push({ r: Rd - 0.012, y: yT - 0.008 }, { r: Rd - 0.012, y: yS - 0.012 }, { r: Rd - 0.03, y: yS - 0.02 }, { r: 0, y: yS - 0.02 });
  revolve(B, drum.map((q) => ({ ...q, s: OUT })), 96);
  for (let k = 0; k < 3; k++) { // pieds et taquets
    const a = az + PI / 3 + (TAU * k) / 3, er = [cos(a), 0, sin(a)];
    const foot = [[0, 0], [0.02, 0], [0.02, 0.006], [0.014, 0.012], [0.022, 0.03], [0.02, 0.05]].map(([r, y]) => ({ r, y, s: OUT }));
    revolve(B, foot, 16, null, mul(er, Rd - 0.07));
    tubeAlong(B, (v) => add(mul(er, lerp(rFoot - 0.09, Rd - 0.01, v)), [0, lift - 0.011, 0]), () => [0.011, 0.016], { nu: 12, nv: 10, side: [-er[2], 0, er[0]] });
  }
  // spirale chauffante (d'Archimède), de la périphérie vers le centre
  const turns = 4.5, r1 = Rd - 0.045, r0 = 0.05;
  const spiral = (v) => { const an = az + TAU * turns * v, r = lerp(r1, r0, v); return [r * cos(an), yS + 0.003, r * sin(an)]; };
  tube3(B, spiral, 0.013, { nu: 10, nv: 220, heat: (v) => hot(0.58 + 0.42 * v) });
  // bras et mât : hors de portée de la panse
  const rm = rMax + 0.1, er = [cos(az), 0, sin(az)], side = [-er[2], 0, er[0]];
  const yA = lift * 0.5 + 0.02, arm = cr3([add(mul(er, Rd - 0.03), [0, yS + 0.003, 0]), add(mul(er, Rd + 0.03), [0, yA, 0]), add(mul(er, (Rd + rm) / 2), [0, yA, 0]), add(mul(er, rm - 0.03), [0, yA, 0]), add(mul(er, rm), [0, yA + 0.035, 0])]);
  tube3(B, arm, 0.0115, { nu: 10, nv: 36, up: side, heat: (v) => rod(0.58 - 0.18 * v) });
  const tip = mast(B, add(mul(er, rm), [0, yA + 0.03, 0]), topMost + 0.36 - yA, { r: 0.012, ball: 0.046, s1: 0.4, style });
  return { kind: 'rechaud', tip, glow: { c: [0, yS, 0], r: Rd, y: yS, table: true }, spots: [], radius: rm + 0.05, mastAt: [er[0] * rm, er[2] * rm] };
}

// Brasero : une vasque de fonte, un lit de cendre, des braises, et le trépied
// (gotoku) qui porte la bouilloire.
function buildBrazier(B, E, { lift, rFoot, seed = 1 }) {
  const sh = shellProfile([[0.52, 0], [0.6, 0.012], [0.84, 0.09], [0.93, 0.19], [0.9, 0.262]], { t: 0.034, floor: 0.07, foot: { rIn: 0.44, depth: 0.02 }, n: 40, fillet: 0.03 });
  revolve(B, sh.prof, 112);
  // cendre : un lit bosselé (inerte)
  const yAsh = 0.125;
  paramSurface(E, (u, v) => { const r = 0.83 * v, an = TAU * u; return [r * cos(an), yAsh + 0.012 * sin(r * 23 + an * 3) * sin(an * 5 + r * 9) * v, r * sin(an)]; }, 64, 18, { s: IN, flip: false });
  // trépied : trois montants plantés dans la cendre, un cercle où pose la bouilloire
  const rT = rFoot - 0.03;
  for (let k = 0; k < 3; k++) { const a = PI / 6 + (TAU * k) / 3; tube3(B, cr3([[1.5 * rT * cos(a), yAsh - 0.03, 1.5 * rT * sin(a)], [1.28 * rT * cos(a), (yAsh + lift) / 2, 1.28 * rT * sin(a)], [1.04 * rT * cos(a), lift - 0.03, 1.04 * rT * sin(a)], [rT * cos(a), lift - 0.012, rT * sin(a)]]), 0.016, { nu: 10, nv: 20, up: [-sin(a), 0, cos(a)], heat: (v) => rod(0.62 - 0.14 * v) }); }
  tube3(B, (v) => [rT * cos(TAU * v), lift - 0.013, rT * sin(TAU * v)], 0.013, { nu: 10, nv: 72, heat: () => rod(0.46) });
  // braises : un anneau visible autour de la bouilloire, quelques-unes dessous
  const spots = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const under = i >= 26, top = !under && i % 3 === 2, a = (TAU * (i + hsh(i + seed, 1) * 0.7)) / (under ? 8 : 26), r = under ? 0.12 + 0.22 * hsh(i + seed, 2) : 0.5 + 0.24 * hsh(i + seed, 2);
    const R = [0.075 + 0.045 * hsh(i + seed, 3), 0.05 + 0.03 * hsh(i + seed, 4), 0.065 + 0.04 * hsh(i + seed, 5)];
    const c = [r * cos(a), yAsh + R[1] * (top ? 1.7 : 0.7), r * sin(a)]; // (une sur trois posée sur les autres)
    lump(E, c, R, { amp: 0.3, seed: i * 3 + seed, rot: hsh(i + seed, 6) * TAU, nu: 14, nv: 9, heat: () => hot(0.6 + 0.4 * hsh(i + seed, 8), 0.25 + 0.75 * hsh(i + seed, 9)) });
    if (!under && i % 4 === 0) spots.push([c[0], c[2], 0.07]);
  }
  return { kind: 'braise', glow: { c: [0, yAsh + 0.05, 0], r: 0.8, y: yAsh + 0.05 }, spots: [], radius: 0.95 };
}

// Pierres chaudes : des galets posés au fond du bol, qui dépassent du thé. La
// foudre tombe sur chacun (un arc par pierre).
function buildStones(E, S, { count, level, yBase, az, seed = 1 }) {
  const depth = level - S.floor, pins = [], spots = [], stones = [];
  for (let i = 0; i < count; i++) {
    const emerge = 0.052 + 0.04 * hsh(i + seed, 1) - 0.006 * i;
    const b = (depth + emerge) / 2, a = b * (1.25 + 0.3 * hsh(i + seed, 2)), cz = b * (1.05 + 0.25 * hsh(i + seed, 3));
    const an = az + (TAU * i) / count + (hsh(i + seed, 4) - 0.5) * 0.5;
    const rs = count === 1 ? 0.04 : min(S.rIn(level) * (0.42 + 0.1 * hsh(i + seed, 5)), S.rIn(S.floor + 0.05) - a * 0.75);
    const c = [max(0, rs) * cos(an), S.floor + b * 0.97 + yBase, max(0, rs) * sin(an)];
    const R = [a, b, cz], rot = hsh(i + seed, 6) * TAU;
    // (la chaleur part du sommet, que la foudre touche, et gagne le galet)
    lump(E, c, R, { amp: 0.05, seed: i * 5 + seed, rot, nu: 30, nv: 20, heat: (v) => hot(0.05 + 0.5 * v, 0.4 + 0.6 * hsh(i + seed, 9)) });
    pins.push([c[0], c[1] + b, c[2]]);
    // (rayon de la pierre à la surface du thé : le halo qu'elle y fait)
    const yr = (level + yBase - c[1]) / b;
    spots.push([c[0], c[2], Math.sqrt(a * cz) * Math.sqrt(max(0.05, 1 - yr * yr))]);
    stones.push({ c, R });
  }
  return { kind: 'pierres', pins, glow: { c: [0, level + yBase, 0], r: S.rIn(level) * 0.6, y: level + yBase, liquid: true }, spots, stones };
}

// ── Catalogue ────────────────────────────────────────────────────────────────
// Chaque variante : profil externe [r, y], épaisseur, fond, pied, et ce qui
// s'y rapporte. k : tirages continus de la recette (proportions).
export const VARIANTS = {
  // tasses
  tulipe: { family: 'tasse', heater: 'plongeur', label: 'Tasse tulipe', outer: (k) => [[0.2, 0], [0.24, 0.03], [0.34, 0.12], [0.39, 0.28], [0.4, 0.42], [0.44 + 0.03 * k.flare, 0.54]], t: 0.022, floor: 0.045, foot: { rIn: 0.15, depth: 0.02 }, handle: 'oreille', saucer: 1, fill: 0.8 },
  litron: { family: 'tasse', heater: 'plongeur', label: 'Litron', outer: (k) => [[0.33, 0], [0.345, 0.012], [0.35, 0.05], [0.35, 0.3], [0.35 + 0.01 * k.flare, 0.6]], t: 0.022, floor: 0.04, foot: { rIn: 0.27, depth: 0.014 }, handle: 'equerre', saucer: 1, fill: 0.82 },
  pied: { family: 'tasse', heater: 'plongeur', label: 'Tasse à pied', outer: (k) => [[0.205, 0], [0.21, 0.01], [0.185, 0.028], [0.15, 0.05], [0.158, 0.075], [0.25, 0.12], [0.37, 0.21], [0.425, 0.36], [0.43 + 0.03 * k.flare, 0.55]], t: 0.022, floor: 0.112, foot: { rIn: 0.16, depth: 0.03 }, handle: 'question', saucer: 1, fill: 0.8 },
  // théières
  boule: { family: 'theiere', heater: 'rechaud', label: 'Théière boule', outer: () => [[0.3, 0], [0.36, 0.02], [0.56, 0.2], [0.62, 0.42], [0.52, 0.66], [0.3, 0.78], [0.26, 0.8]], t: 0.026, floor: 0.04, foot: { rIn: 0.24, depth: 0.018 }, lid: 'gland', spout: 'cygne', handle: 'anse', fill: 0.7 },
  tetsubin: { family: 'theiere', heater: 'braise', label: 'Tetsubin', outer: () => [[0.34, 0], [0.42, 0.015], [0.66, 0.16], [0.7, 0.3], [0.58, 0.48], [0.36, 0.56], [0.33, 0.57]], t: 0.03, floor: 0.04, foot: null, lid: 'boule', spout: 'court', handle: 'mobile', fill: 0.7, cast: 1 },
  // verres
  droit: { family: 'verre', heater: 'plongeur', label: 'Verre droit', outer: (k) => [[0.26, 0], [0.275, 0.01], [0.28, 0.05], [0.31, 0.4], [0.33 + 0.01 * k.flare, 0.82]], t: 0.018, floor: 0.07, foot: null, saucer: 0, fill: 0.78, glass: 1, spoon: { L: 1.5 } },
  evase: { family: 'verre', heater: 'plongeur', label: 'Verre évasé', outer: (k) => [[0.2, 0], [0.215, 0.01], [0.22, 0.06], [0.24, 0.3], [0.33, 0.62], [0.38 + 0.02 * k.flare, 0.86]], t: 0.018, floor: 0.08, foot: null, saucer: 0, fill: 0.74, glass: 1, spoon: { L: 1.55 } },
  // bols
  chawan: { family: 'bol', heater: 'pierres', label: 'Chawan', outer: (k) => [[0.26, 0], [0.27, 0.05], [0.36, 0.09], [0.6, 0.2], [0.68, 0.36], [0.69 + 0.02 * k.flare, 0.5]], t: 0.032, floor: 0.085, foot: { rIn: 0.2, depth: 0.04 }, fill: 0.62 },
  bolPied: { family: 'bol', heater: 'pierres', label: 'Bol à pied', outer: (k) => [[0.3, 0], [0.27, 0.04], [0.2, 0.14], [0.24, 0.22], [0.5, 0.32], [0.64, 0.46], [0.68 + 0.02 * k.flare, 0.62]], t: 0.026, floor: 0.26, foot: { rIn: 0.22, depth: 0.08 }, fill: 0.72 },
  creux: { family: 'bol', heater: 'pierres', label: 'Assiette creuse', outer: (k) => [[0.42, 0], [0.44, 0.012], [0.5, 0.04], [0.62, 0.16], [0.74, 0.24], [0.95 + 0.03 * k.flare, 0.27]], t: 0.026, floor: 0.04, foot: { rIn: 0.36, depth: 0.014 }, fill: 0.62 },
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
  // (la tasse est posée dans la cuvette de la soucoupe ; la théière sur son réchaud, la bouilloire sur son trépied)
  const stand = { rechaud: 0.2, braise: 0.3 }[V.heater] ?? 0;
  const yBase = (V.saucer ? 0.031 : 0) + stand;
  const S = shellProfile(V.outer(k), { t: V.t, floor: V.floor, foot: V.foot });
  const body = new Buffers(1 << 15), metal = new Buffers(1 << 13), element = new Buffers(1 << 12);
  const lift = (p) => [p[0], p[1] + yBase, p[2]];
  const flute = spec.flutes && !V.glass && !V.cast ? { n: spec.flutes, amp: 0.05, y0: S.floor + 0.015, y1: S.top - 0.11 } : null;
  // (godrons : un sommet au fond de chaque gorge, douze par lobe)
  revolve(body, S.prof, flute ? spec.flutes * 12 : 112, flute, [0, yBase, 0]);
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
    // (l'anse est à l'aplomb d'une gorge : elle s'attache au fond, là où les godrons existent à cette hauteur)
    const act = flute ? sstep(flute.y0, flute.y0 + 0.05, y) * (1 - sstep(flute.y1 - 0.05, flute.y1 - 0.008, y)) : 0;
    return { p: [side * (rO(y) * (1 - fluteAmp * act) - V.t * 0.2), y, 0], n: [side * nx, ny, 0] };
  };
  const handleCurve = (a1, a0, out, k1, k0, d1 = 0, d0 = 0) => [a1.p, add(add(a1.p, mul(a1.n, out * k1)), [0, d1, 0]), add(add(a0.p, mul(a0.n, out * k0)), [0, d0, 0]), a0.p];
  // Section d'une anse : un ruban (plus large qu'épais), qui s'évase en
  // collerette à chaque attache — la patte écrasée sur la paroi à la barbotine.
  // len : longueur de la courbe (l'évasement se compte en millimètres de la paroi).
  const handleRad = (ra, rb, len = 0.7) => (v) => {
    const d = min(v, 1 - v) * len, e = 1 + 0.2 * (1 - sin(PI * v)) ** 3;
    const c = 1.25 * Math.exp(-d / 0.02) + 0.55 * Math.exp(-d / 0.065);
    return [ra * (e + c), rb * (e + c * 0.8)];
  };

  // ── anse de tasse ──
  if (V.family === 'tasse') {
    const y1 = H * (V.handle === 'question' ? 0.82 : 0.78), y0 = H * { oreille: 0.4, equerre: 0.22, question: 0.47 }[V.handle];
    const out = 0.24 + 0.03 * (spec.flare ?? 0.5), a1 = attach(y1), a0 = attach(y0);
    const C = {
      oreille: handleCurve(a1, a0, out, 1.5, 1.4, 0.07, -0.05),
      equerre: handleCurve(a1, a0, out, 1.9, 1.7, 0.02, 0.02),
      question: handleCurve(a1, a0, out, 1.8, 1.2, 0.16, -0.02),
    }[V.handle];
    tubeAlong(body, (v) => lift(bez(C, v)), handleRad(0.017, 0.035), { nu: 24, nv: 96, s: OUT, capped: false });
    obstacles.push({ type: 'ellipsoid', c: [rO(y1) + out * 0.6, (y0 + y1) / 2 + yBase, 0], r: [out * 0.75, (y1 - y0) * 0.7 + 0.05, 0.08] });
    meta.handleAz = 0;
    // (pour les tests : l'axe de l'anse et son rayon, dans le repère posé)
    meta.handle = Array.from({ length: 25 }, (_, i) => { const q = lift(bez(C, i / 24)); return [q[0], q[1], handleRad(0.017, 0.035)(i / 24)[0]]; });
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
      ? [[rS - 0.1, yS + 0.01, 0], [rS + 0.3, yS - 0.02, 0], [rS + 0.26, H * 0.82, 0], [rS + 0.5, H * 0.98, 0]]
      : [[rS - 0.08, yS + 0.05, 0], [rS + 0.12, yS + 0.08, 0], [rS + 0.16, H * 0.74, 0], [rS + 0.24, H * 0.82, 0]];
    const sr = (v) => { const r = lerp(V.spout === 'cygne' ? 0.12 : 0.085, 0.045, sstep(0, 1, v)) * (1 + 0.3 * Math.exp(-v / 0.07)); return [r, r * 0.92]; }; // (il naît de la panse par un congé)
    tubeAlong(body, (v) => lift(bez(sp, v)), sr, { nu: 28, nv: 80, s: OUT, capped: false });
    // (l'embouchure : un anneau et l'intérieur du bec, sombre)
    const tipP = bez(sp, 1), tipD = norm(sub(bez(sp, 1), bez(sp, 0.97)));
    tubeAlong(body, (v) => lift(add(tipP, mul(tipD, -0.1 * v))), (v) => { const r = lerp(0.045, 0.03, min(1, v * 6)); return [r, r * 0.92]; }, { nu: 22, nv: 8, s: IN, capped: false });
    steam = { p: lift(add(tipP, mul(tipD, 0.02))), r: 0.05, dir: tipD };
    obstacles.push({ type: 'ellipsoid', c: [rS + 0.3, H * 0.7 + yBase, 0], r: [0.3, 0.36, 0.12] });
    // anse
    if (V.handle === 'anse') {
      const y1 = H * 0.78, y0 = H * 0.3;
      const C = handleCurve(attach(y1, -1), attach(y0, -1), 0.3, 1.6, 1.5, 0.12, -0.1);
      tubeAlong(body, (v) => lift(bez(C, v)), handleRad(0.024, 0.044, 1.1), { nu: 24, nv: 96, s: OUT, capped: false });
      obstacles.push({ type: 'ellipsoid', c: [-rO(H * 0.5) - 0.2, H * 0.55 + yBase, 0], r: [0.28, 0.34, 0.1] });
    } else {
      // anse mobile de fonte : un arceau au-dessus du couvercle, sur deux oreilles (dans le plan z)
      const rA = rO(H * 0.86) + 0.0, yA = H * 0.86, apex = yK + 0.42;
      const C = [[0, yA, -rA], [0, apex + 0.12, -rA * 1.25], [0, apex + 0.12, rA * 1.25], [0, yA, rA]];
      tubeAlong(metal, (v) => lift(bez(C, v)), () => [0.022, 0.03], { nu: 14, nv: 56, s: OUT, capped: true, side: [1, 0, 0], heat: (v) => rod(abs2(v) * 0.42) }); // (la foudre tombe sur l'arceau : la chaleur descend ses deux branches)
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
    // Soucoupe : un pied annulaire, un fond plat où pose la tasse, une gorge
    // (le « bassin ») qui remonte en courbe, puis l'aile presque plate jusqu'au
    // bord roulé. Hauteur : 1,6 cm pour 16 cm de diamètre.
    const rw = (V.foot ? S.rOut(0) : 0.3) + 0.035, R = max(0.8, rO(H) * 1.8);
    const sau = shellProfile([[rw * 0.86, 0], [rw + 0.02, 0.004], [rw + 0.075, 0.016], [lerp(rw, R, 0.38), 0.05], [lerp(rw, R, 0.62), 0.098], [lerp(rw, R, 0.84), 0.132], [R, 0.152]], { t: 0.027, floor: 0.03, foot: { rIn: rw * 0.72, depth: 0.014 }, n: 48, fillet: 0.01 });
    revolve(body, sau.prof, 144); // (soucoupe lisse : des côtes sur une seule face la rendaient polygonale)
    meta.saucer = { r: R, top: sau.top, well: 0.03, surface: Array.from({ length: 30 }, (_, i) => { const y = 0.034 + (sau.top - 0.04) * (i / 29); return [sau.rIn(y), y]; }) };
    meta.yBaseWanted = 0.03 + 0.001; // (fond de la cuvette)
  }

  // ── la machine ──
  const az = spec.mastAz ?? spec.spoonAz ?? 2.4, style = spec.mast ?? 0;
  let heater = null;
  if (V.heater === 'plongeur') heater = buildPlunger(metal, S, { az, yBase, level, style });
  if (V.heater === 'rechaud') {
    // (le mât sur le côté : ni devant le bec, ni dans l'anse)
    const a2 = (az < 0 ? -1 : 1) * (1.2 + 0.7 * ((Math.abs(az) - 2) / 0.9));
    heater = buildWarmer(metal, { az: a2, lift: yBase, rFoot: rO(0), rMax: max(rO(H * 0.5), rO(H * 0.35)), topMost: highest ? highest[1] : S.top + yBase, style });
  }
  if (V.heater === 'braise') heater = buildBrazier(metal, element, { lift: yBase, rFoot: rO(0), seed: 1 + Math.round(Math.abs(az) * 100) });
  if (V.heater === 'pierres') heater = buildStones(element, S, { count: max(1, min(4, spec.stones ?? 3)), level, yBase, az, seed: 1 + Math.round(Math.abs(az) * 100) });
  if (heater.tip) highest = heater.tip;
  meta.heater = heater;
  meta.strike = highest; // (null : la foudre tombe sur les pierres du bol, meta.heater.pins)
  meta.steam = steam;
  meta.obstacles = obstacles.map((o) => (o.type === 'shell' ? { ...o, yFloor: meta.liquid.y } : o));
  meta.radius = max(heater.radius ?? 0, V.saucer ? meta.saucer.r : max(rO(H), rO(H * 0.5)) + (V.family === 'theiere' ? 0.5 : 0));
  meta.profile = { rIn: null, top: S.top };
  return { parts: { body: body.out(), metal: metal.n ? metal.out() : null, element: element.n ? element.out() : null, liquidBody }, meta, shell: S };
}
