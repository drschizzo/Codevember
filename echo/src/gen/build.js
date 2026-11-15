// Géométrie de la pièce (module pur, exécuté dans le worker et dans Node).
// Tout est construit en coordonnées du monde (mètres ; plateau de la table en
// y = 0), sauf ce qui bouge : le cordon de la douille (repère de sa sortie) et
// la boule à facettes (repère de son centre).
//
// Chaque pièce est une lame ou un solide fermé (rien de plat sans épaisseur),
// aux arêtes arrondies : vases tournés à paroi épaisse et lèvre roulée,
// cadres à moulure balayée le long du contour, glace biseautée, douille
// tournée, filament en hélice sur ses supports.
import { Buffers, roundedBox, sphere, torus, tube, lathe, OUT, IN, EDGE, add, sub, mul, dot, norm, cross } from '../../../shared/gen/mesh.js';
import { createRng } from '../../../shared/rng.js';
import { TABLE_H, CEIL, footprint } from './layout.js';
import { makeEllipse, ellipseRadius, planeBasis, rowLat, rowCols, facetSize, BALL_LAT } from './optics.js';

const { PI, cos, sin, sqrt, max, min, abs } = Math;
const UP = [0, 1, 0];

// repère vertical (le profil d'un tour est en (r, z) autour de z) : z local → y
const vertical = (B, o, rot = 0) => B.frame(o, [cos(rot), 0, sin(rot)], [sin(rot), 0, -cos(rot)], UP);

// ── Profils de tour ──────────────────────────────────────────────────────────
// Un profil est une suite de points (r, z) le long de la paroi extérieure, de
// l'axe du fond au bord ; la paroi intérieure le suit à l'épaisseur t ; la
// lèvre est un demi-rond. Normales calculées sur la courbe (pas de facettes).
function smoothProfile(pts, n = 64) {
  // Catmull-Rom centripète sur les points de contrôle, rééchantillonnée à pas constant
  const P = pts;
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(P[P.length - 1]);
  // rééchantillonnage à pas constant
  const acc = [0];
  for (let i = 1; i < out.length; i++) acc.push(acc[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  const Ltot = acc[acc.length - 1], res = [];
  for (let k = 0, j = 0; k <= n; k++) {
    const s = (Ltot * k) / n;
    while (j < acc.length - 2 && acc[j + 1] < s) j++;
    const f = (s - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]);
    res.push([out[j][0] + (out[j + 1][0] - out[j][0]) * f, out[j][1] + (out[j + 1][1] - out[j][1]) * f]);
  }
  return res;
}
// normales 2D d'une polyligne (sortantes : à droite du sens de parcours vers le haut)
function normals2(pts, sign = 1) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    return [(sign * d[1]) / l, (-sign * d[0]) / l];
  });
}

// Vase tourné fermé : extérieur (fond → lèvre), lèvre en demi-rond, intérieur
// (lèvre → fond intérieur). outer : points (r, z) de l'axe du fond (r = 0) au
// bord ; t : épaisseur ; depth : profondeur de l'intérieur (part de la hauteur)
function vessel(B, outer, t, inner = 0.85, M = 64) {
  const ext = smoothProfile(outer, 72);
  const ne = normals2(ext, 1);
  const prof = [];
  // (le point de l'axe a une normale verticale vers le bas)
  ext.forEach((p, i) => prof.push({ r: max(0, p[0]), z: p[1], nr: ne[i][0], nz: ne[i][1], s: OUT }));
  prof[0].nr = 0; prof[0].nz = -1;
  // lèvre : demi-cercle de rayon t/2 centré entre l'extérieur et l'intérieur
  const top = ext[ext.length - 1], nt = ne[ne.length - 1];
  const c = [top[0] - (nt[0] * t) / 2, top[1] - (nt[1] * t) / 2];
  const a0 = Math.atan2(nt[1], nt[0]);
  for (let k = 1; k < 8; k++) {
    const a = a0 + (PI * k) / 8;
    prof.push({ r: c[0] + (cos(a) * t) / 2, z: c[1] + (sin(a) * t) / 2, nr: cos(a), nz: sin(a), s: EDGE });
  }
  // intérieur : la paroi extérieure décalée de t, jusqu'à la profondeur voulue
  const zmin = top[1] * (1 - inner);
  const inn = [];
  for (let i = ext.length - 1; i >= 0; i--) {
    const p = [ext[i][0] - ne[i][0] * t, ext[i][1] - ne[i][1] * t];
    if (p[1] < zmin || p[0] < 0.002) break;
    inn.push({ r: p[0], z: p[1], nr: -ne[i][0], nz: -ne[i][1], s: IN });
  }
  // fond intérieur : arrondi vers l'axe
  const last = inn[inn.length - 1];
  if (last) {
    for (let k = 1; k <= 6; k++) {
      const f = k / 6;
      inn.push({ r: last.r * (1 - f), z: last.z - 0.004 * sin(f * PI * 0.5), nr: -0.4 * (1 - f), nz: 1, s: IN });
    }
  }
  lathe(B, prof.concat(inn), M);
}

// profils extérieurs des formes (h, r : hauteur, rayon du ventre ; q : variation 0–1)
function outline(kind, h, r, q) {
  switch (kind) {
    case 'bottle': { // épaule, col long, lèvre à bague
      const sh = 0.58 + 0.08 * q, neck = r * (0.3 + 0.06 * q);
      return [[0, 0], [r * 0.9, 0], [r * 0.99, 0.01], [r, h * 0.12], [r, h * sh - r * 0.6], [r * 0.82, h * sh - r * 0.15], [neck * 1.25, h * sh + r * 0.35], [neck, h * 0.78], [neck, h * 0.93], [neck * 1.18, h * 0.96], [neck * 1.05, h]];
    }
    case 'jug': // ventre bas, col qui s'évase
      return [[0, 0], [r * 0.72, 0], [r * 0.82, 0.008], [r * 0.98, h * 0.28], [r, h * 0.42], [r * 0.82, h * 0.66], [r * 0.66, h * 0.8], [r * (0.72 + 0.08 * q), h * 0.94], [r * (0.8 + 0.08 * q), h]];
    case 'jar':
      return [[0, 0], [r * 0.82, 0], [r * 0.92, 0.008], [r, h * 0.3], [r * 0.98, h * 0.7], [r * 0.86, h * 0.88], [r * 0.82, h]];
    case 'bowl':
      return [[0, 0], [r * 0.42, 0], [r * 0.45, 0.006], [r * 0.7, h * 0.28], [r * 0.92, h * 0.7], [r, h]];
    case 'beaker':
      return [[0, 0], [r * 0.8, 0], [r * 0.84, 0.006], [r * (0.9 + 0.06 * q), h * 0.5], [r, h]];
    case 'vase': // ventre haut, col étroit, lèvre évasée
      return [[0, 0], [r * 0.55, 0], [r * 0.6, 0.008], [r * 0.85, h * 0.25], [r, h * 0.5], [r * 0.7, h * 0.72], [r * 0.42, h * 0.84], [r * 0.44, h * 0.92], [r * 0.62, h]];
    case 'flask': // flacon de pharmacie : épaule carrée, col court
      return [[0, 0], [r * 0.9, 0], [r * 0.98, 0.008], [r, h * 0.66], [r * 0.9, h * 0.76], [r * 0.4, h * 0.82], [r * 0.36, h * 0.92], [r * 0.42, h * 0.95], [r * 0.4, h]];
    default:
      return [[0, 0], [r, 0], [r, h]];
  }
}

// ── La nature morte ─────────────────────────────────────────────────────────
// Toutes les céramiques dans un seul maillage : la couleur, la rugosité et
// l'émail de chaque vase passent par un attribut (un seul shader).
function buildVessels(objs) {
  const B = new Buffers();
  const col = [], cr = [], vc = [];
  // (vc : centre du vase et sa hauteur — le shader en tire l'angle et la
  // hauteur relative : traces de tournage, coulures, pied nu)
  const tag = (from, o, kind) => {
    const c = hex(o.color);
    for (let i = from; i < B.n; i++) { col.push(...c); cr.push(o.rough, o.glazed, o.var, kind); vc.push(o.x, o.z, o.h); }
  };
  for (const o of objs) {
    const from = B.n;
    B.piece = Math.floor(o.var * 255);
    vertical(B, [o.x, 0, o.z], o.rot);
    const t = max(0.0035, o.r * 0.07);
    const pts = outline(o.kind, o.h, o.r, o.var);
    vessel(B, pts, t, o.kind === 'bowl' ? 0.82 : o.kind === 'bottle' || o.kind === 'flask' ? 0.12 : 0.6);
    if (o.kind === 'jug') { // anse : un boudin aplati qui part du col et revient au ventre
      const a = [r_at(pts, o.h * 0.84) + 0.002, 0, o.h * 0.84], b = [r_at(pts, o.h * 0.4) - 0.002, 0, o.h * 0.4];
      const ctrl = [];
      for (let k = 0; k <= 24; k++) {
        const f = k / 24;
        const x = a[0] + (b[0] - a[0]) * f + sin(f * PI) * o.r * 0.62, z = a[2] + (b[2] - a[2]) * f + sin(f * PI) * o.h * 0.06;
        ctrl.push([x, 0, z]);
      }
      tube(B, ctrl, max(0.005, o.r * 0.1), 14, OUT, true);
      // bec : un petit bourrelet pincé à l'opposé de l'anse
      B.frame([o.x, 0, o.z], [-cos(o.rot), 0, -sin(o.rot)], [-sin(o.rot), 0, cos(o.rot)], UP);
      const lip = r_at(pts, o.h * 0.99);
      tube(B, Array.from({ length: 9 }, (_, k) => { const f = (k / 8 - 0.5) * 1.1; return [lip + 0.006 * cos(f * 2.2), sin(f) * lip * 0.5, o.h - 0.002 - 0.002 * cos(f * 2.2)]; }), 0.0035, 10, EDGE, true);
    }
    if (o.kind === 'jar') { // couvercle à bouton
      vertical(B, [o.x, o.h - 0.004, o.z], o.rot);
      const rl = r_at(pts, o.h) + 0.004;
      vessel(B, [[0, 0], [rl, 0], [rl * 1.02, 0.008], [rl * 0.8, 0.02], [rl * 0.3, 0.026], [rl * 0.22, 0.032], [rl * 0.32, 0.045], [rl * 0.05, 0.05], [0, 0.05]].map(([x, y]) => [x, y]), 0.004, 0.0);
    }
    if (o.kind === 'bottle' && o.var > 0.5) { // bouchon de liège
      vertical(B, [o.x, o.h - 0.012, o.z], 0);
      const rn = r_at(pts, o.h * 0.9) - 0.002;
      lathe(B, cork(rn), 24);
    }
    B.noFrame();
    tag(from, o, ['bottle', 'jug', 'jar', 'bowl', 'beaker', 'vase', 'flask'].indexOf(o.kind) / 8);
  }
  const out = B.out();
  out.col = new Float32Array(col);
  out.cr = new Float32Array(cr);
  out.vc = new Float32Array(vc);
  return out;
}
function cork(r) {
  return [{ r: 0, z: 0, nr: 0, nz: -1, s: EDGE }, { r: r * 0.92, z: 0, nr: 0.3, nz: -1, s: EDGE }, { r, z: 0.004, nr: 1, nz: 0, s: EDGE }, { r: r * 1.04, z: 0.024, nr: 1, nz: 0.1, s: EDGE }, { r: r * 0.96, z: 0.03, nr: 0.5, nz: 1, s: EDGE }, { r: 0, z: 0.031, nr: 0, nz: 1, s: EDGE }];
}
// rayon extérieur d'un profil à la hauteur z
function r_at(pts, z) {
  const P = smoothProfile(pts, 96);
  for (let i = 0; i + 1 < P.length; i++) if ((P[i][1] - z) * (P[i + 1][1] - z) <= 0) {
    const f = (z - P[i][1]) / ((P[i + 1][1] - P[i][1]) || 1);
    return P[i][0] + (P[i + 1][0] - P[i][0]) * f;
  }
  return P[P.length - 1][0];
}
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => c ** 2.2); };

// ── La table ────────────────────────────────────────────────────────────────
function buildTable(T, cloth) {
  const B = new Buffers();
  const w = T.width / 2, d = T.depth / 2, th = 0.032;
  roundedBox(B, [0, -th / 2, 0], [w, th / 2, d], 0.008, 8, EDGE, OUT);
  // ceinture
  const ap = 0.075, inset = 0.05;
  roundedBox(B, [0, -th - ap / 2, d - inset], [w - inset, ap / 2, 0.011], 0.004, 4, EDGE, OUT);
  roundedBox(B, [0, -th - ap / 2, -d + inset], [w - inset, ap / 2, 0.011], 0.004, 4, EDGE, OUT);
  roundedBox(B, [w - inset, -th - ap / 2, 0], [0.011, ap / 2, d - inset], 0.004, 4, EDGE, OUT);
  roundedBox(B, [-w + inset, -th - ap / 2, 0], [0.011, ap / 2, d - inset], 0.004, 4, EDGE, OUT);
  const legH = TABLE_H - th;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (w - inset - 0.012), z = sz * (d - inset - 0.012);
    vertical(B, [x, -TABLE_H, z], PI / 4);
    if (T.legs === 'tournés') {
      lathe(B, smoothLathe([[0, 0], [0.018, 0], [0.02, 0.01], [0.016, 0.06], [0.024, 0.1], [0.017, 0.14], [0.02, 0.5], [0.026, 0.56], [0.019, 0.6], [0.026, legH - 0.12], [0.028, legH]], EDGE), 28);
    } else if (T.legs === 'fuselés') {
      lathe(B, smoothLathe([[0, 0], [0.012, 0], [0.013, 0.01], [0.026, legH - 0.1], [0.026, legH]], EDGE), 4);
    } else { // tréteaux : pieds droits épais, chanfreinés
      lathe(B, smoothLathe([[0, 0], [0.024, 0], [0.026, 0.01], [0.026, legH]], EDGE), 4);
    }
    B.noFrame();
  }
  if (T.legs === 'tréteaux') { // entretoise
    roundedBox(B, [0, -TABLE_H + 0.12, 0], [w - inset, 0.018, 0.018], 0.005, 4, EDGE, OUT);
  }
  const out = { table: B.out() };
  if (cloth) out.cloth = buildCloth(T);
  return out;
}
function smoothLathe(pts, s) {
  const P = pts;
  const ne = normals2(P, 1);
  const prof = P.map((p, i) => ({ r: p[0], z: p[1], nr: ne[i][0], nz: ne[i][1], s }));
  prof[0].nr = 0; prof[0].nz = -1;
  prof.push({ r: 0, z: P[P.length - 1][1], nr: 0, nz: 1, s });
  return prof;
}
// nappe : le dessus, un ourlet arrondi au bord, une retombée plissée
function buildCloth(T) {
  const B = new Buffers();
  const w = T.width / 2 + 0.012, d = T.depth / 2 + 0.012, drop = 0.2, y0 = 0.0015;
  // dessus (grille)
  const nx = 40, nz = 24, rows = [];
  for (let j = 0; j <= nz; j++) { const row = []; for (let i = 0; i <= nx; i++) row.push(B.vert([-w + (2 * w * i) / nx, y0, -d + (2 * d * j) / nz], UP, OUT)); rows.push(row); }
  B.grid(rows);
  // retombée : le contour du plateau, arrondi aux coins, plissé
  const per = [];
  const rc = 0.02;
  const corner = (cx, cz, a0) => { for (let k = 0; k <= 6; k++) { const a = a0 + (PI / 2) * (k / 6); per.push([cx + rc * cos(a), cz + rc * sin(a), a]); } };
  corner(w - rc, d - rc, 0); corner(-w + rc, d - rc, PI / 2); corner(-w + rc, -d + rc, PI); corner(w - rc, -d + rc, 1.5 * PI);
  per.push(per[0]);
  // échantillonnage dense le long du contour
  const pts = [];
  for (let i = 0; i + 1 < per.length; i++) {
    const a = per[i], b = per[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = max(1, Math.ceil(L / 0.012));
    for (let k = 0; k < n; k++) { const f = k / n; pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
  }
  const rng = createRng('cloth');
  const ph = [rng.range(0, 6), rng.range(0, 6)];
  let s = 0;
  const hem = [], lower = [];
  const ring = (k) => {
    const i = k % pts.length, p = pts[i], q = pts[(i + 1) % pts.length], r = pts[(i - 1 + pts.length) % pts.length];
    const t = norm([q[0] - r[0], 0, q[1] - r[1]]);
    return { p, n: [t[2], 0, -t[0]] };
  };
  const cols = [];
  for (let k = 0; k <= pts.length; k++) {
    const { p, n } = ring(k);
    if (k > 0) s += Math.hypot(p[0] - pts[(k - 1) % pts.length][0], p[1] - pts[(k - 1) % pts.length][1]);
    const col = [];
    for (let j = 0; j <= 10; j++) {
      const f = j / 10;
      // ourlet arrondi en haut, puis les plis qui s'ouvrent vers le bas
      const a = min(1, f * 4) * PI / 2;
      const fold = (0.004 + 0.012 * f * f) * (sin(s * 42 + ph[0]) * 0.7 + sin(s * 17 + ph[1]) * 0.3);
      const out = 0.004 * sin(a) + fold + 0.003;
      const y = y0 - 0.006 * (1 - cos(a)) - drop * max(0, f - 0.25) / 0.75;
      const dfold = (0.004 + 0.012 * f * f) * (42 * cos(s * 42 + ph[0]) * 0.7 + 17 * cos(s * 17 + ph[1]) * 0.3);
      const nn = norm([n[0] - dfold * -n[2] * 0.6, f < 0.25 ? cos(a) : 0, n[2] - dfold * n[0] * 0.6]);
      col.push(B.vert([p[0] + n[0] * out, y, p[1] + n[2] * out], nn, OUT));
    }
    cols.push(col);
  }
  for (let k = 0; k + 1 < cols.length; k++) for (let j = 0; j < 10; j++) B.quad(cols[k][j], cols[k + 1][j], cols[k + 1][j + 1], cols[k][j + 1]);
  return B.out();
}

// ── La pièce ────────────────────────────────────────────────────────────────
function buildRoom(room, panel) {
  const B = new Buffers();
  const wz = room.wallZ, W = 3.2;
  // mur du fond (grille dense : le relief des lambris est peint en normales)
  const rows = [];
  for (let j = 0; j <= 30; j++) { const row = []; for (let i = 0; i <= 40; i++) row.push(B.vert([-W / 2 + (W * i) / 40, -TABLE_H + ((CEIL + TABLE_H) * j) / 30, wz], [0, 0, 1], OUT)); rows.push(row); }
  B.grid(rows);
  const wall = B.out();
  const F = new Buffers();
  const fr = [];
  for (let j = 0; j <= 30; j++) { const row = []; for (let i = 0; i <= 40; i++) row.push(F.vert([-W / 2 + (W * i) / 40, -TABLE_H, wz + (4 * j) / 30], UP, OUT)); fr.push(row); }
  F.grid(fr);
  const out = { wall, floor: F.out() };
  if (panel) out.panels = buildPanels(wz);
  // plinthe
  const P = new Buffers();
  roundedBox(P, [0, -TABLE_H + 0.07, wz + 0.01], [W / 2, 0.07, 0.01], 0.004, 4, EDGE, OUT);
  roundedBox(P, [0, -TABLE_H + 0.15, wz + 0.016], [W / 2, 0.008, 0.008], 0.006, 4, EDGE, OUT);
  out.skirting = P.out();
  return out;
}
// lambris : panneaux à table saillante, cadres à moulure (des boîtes arrondies)
function buildPanels(wz) {
  const B = new Buffers();
  const W = 3.2, pw = 0.62, gap = 0.1;
  const y0 = -TABLE_H + 0.22, y1 = 0.08, y2 = 0.2, y3 = CEIL - 0.1;
  // cimaise
  roundedBox(B, [0, (y1 + y2) / 2, wz + 0.008], [W / 2, 0.022, 0.008], 0.006, 4, EDGE, OUT);
  roundedBox(B, [0, y1 - 0.004, wz + 0.006], [W / 2, 0.012, 0.006], 0.005, 4, EDGE, OUT);
  for (let x = -W / 2 + gap; x + pw < W / 2; x += pw + gap) {
    for (const [a, b] of [[y0, y1 - 0.06], [y2 + 0.08, y3]]) {
      const cx = x + pw / 2, cy = (a + b) / 2, hx = pw / 2, hy = (b - a) / 2;
      // table saillante biseautée
      roundedBox(B, [cx, cy, wz + 0.006], [hx - 0.035, hy - 0.035, 0.006], 0.006, 4, EDGE, OUT);
      // cadre : quatre baguettes
      roundedBox(B, [cx, b - 0.008, wz + 0.006], [hx, 0.008, 0.006], 0.005, 4, EDGE, OUT);
      roundedBox(B, [cx, a + 0.008, wz + 0.006], [hx, 0.008, 0.006], 0.005, 4, EDGE, OUT);
      roundedBox(B, [x + 0.008, cy, wz + 0.006], [0.008, hy, 0.006], 0.005, 4, EDGE, OUT);
      roundedBox(B, [x + pw - 0.008, cy, wz + 0.006], [0.008, hy, 0.006], 0.005, 4, EDGE, OUT);
    }
  }
  return B.out();
}

// ── La lampe : douille à tirette, ampoule, filament, cordons ─────────────────
function bulbOutline(kind) {
  // (r, z) depuis le culot (z = 0) vers le bas (z < 0) : l'ampoule pend
  switch (kind) {
    case 'globe': return [[0.0135, 0], [0.014, -0.012], [0.034, -0.04], [0.047, -0.075], [0.04, -0.11], [0.02, -0.124], [0, -0.127]];
    case 'tube': return [[0.0135, 0], [0.014, -0.01], [0.016, -0.025], [0.016, -0.12], [0.012, -0.128], [0, -0.13]];
    case 'flamme': return [[0.0135, 0], [0.014, -0.012], [0.02, -0.03], [0.022, -0.05], [0.016, -0.075], [0.006, -0.095], [0, -0.1]];
    default: return [[0.0135, 0], [0.014, -0.012], [0.026, -0.04], [0.031, -0.07], [0.026, -0.098], [0.012, -0.11], [0, -0.112]];
  }
}
export function bulbGeometry(L) {
  // l'ampoule est accrochée sous la douille ; s (le centre lumineux) est au
  // milieu du filament : le culot est donc au-dessus de s
  const P = bulbOutline(L.kind), zMid = (P[2][1] + P[P.length - 1][1]) / 2;
  return { P, top: L.y - zMid, zMid };
}
function buildLamp(L) {
  const { P, top } = bulbGeometry(L);
  const s = [L.x, L.y, L.z];
  const out = {};
  // verre de l'ampoule (une lame mince : extérieur, lèvre au culot, intérieur)
  {
    const B = new Buffers();
    vertical(B, [L.x, top, L.z]);
    const ext = smoothProfile(P.map(([r, z]) => [r, z]).reverse(), 60).reverse();
    // (profil du culot vers le bas : on le retourne pour partir de l'axe en bas)
    const prof = smoothProfile(P.slice().reverse(), 60);
    const ne = normals2(prof, -1);
    const pr = prof.map((p, i) => ({ r: max(0, p[0]), z: p[1], nr: ne[i][0], nz: ne[i][1], s: OUT }));
    pr[0].nr = 0; pr[0].nz = -1;
    lathe(B, pr, 48);
    void ext;
    B.noFrame();
    out.glass = B.out();
  }
  // tube à éclats (xénon) : un tube de verre enroulé en hélice de trois spires
  // autour de l'axe de l'ampoule, ses deux électrodes qui remontent au pied
  {
    const B = new Buffers();
    const turns = 3, rc = L.kind === 'tube' ? 0.0085 : 0.011, h = L.kind === 'tube' ? 0.05 : 0.026;
    const pts = [];
    for (let k = 0; k <= turns * 40; k++) {
      const f = k / (turns * 40), a = f * turns * 2 * PI;
      pts.push([s[0] + rc * cos(a), s[1] - h / 2 + h * f, s[2] + rc * sin(a)]);
    }
    tube(B, pts, 0.0021, 10, OUT, true);
    out.filament = B.out();
    const S = new Buffers();
    const base = [L.x, top - 0.014, L.z];
    // électrodes (fils de tungstène dans le verre) et pied de verre
    tube(S, [pts[0], [s[0] + rc, base[1], s[2]], add(base, [0.003, 0, 0])], 0.0006, 6, EDGE, true);
    tube(S, [pts[pts.length - 1], [s[0] + rc * cos(turns * 2 * PI), base[1] - 0.002, s[2]], add(base, [-0.003, 0, 0])], 0.0006, 6, EDGE, true);
    tube(S, [[L.x, top - 0.002, L.z], [L.x, top - 0.018, L.z]], 0.0035, 12, OUT, true);
    out.stem = S.out();
  }
  // douille de stroboscope : culot, corps, bague, et le voyant de charge (une
  // lentille rouge dans son chaton, sur le côté) ; fil d'alimentation
  {
    const B = new Buffers();
    vertical(B, [L.x, top, L.z]);
    lathe(B, smoothLathe([[0, -0.001], [0.0142, -0.001], [0.0148, 0.004], [0.017, 0.006], [0.0185, 0.012], [0.0185, 0.04], [0.02, 0.043], [0.02, 0.05], [0.016, 0.058], [0.011, 0.062], [0.006, 0.07], [0.004, 0.08]], EDGE), 40);
    B.noFrame();
    // chaton du voyant
    B.frame([L.x, top + 0.026, L.z + 0.0185], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    lathe(B, smoothLathe([[0, 0], [0.0052, 0], [0.0055, 0.0015], [0.0048, 0.0032], [0.0042, 0.0034]], EDGE), 24);
    B.noFrame();
    out.socket = B.out();
    const V = new Buffers();
    sphere(V, [L.x, top + 0.026, L.z + 0.0207], 0.0036, 20, 12, OUT);
    out.ready = V.out();
    const W = new Buffers();
    tube(W, [[L.x, top + 0.07, L.z], [L.x, CEIL, L.z]], 0.0028, 10, OUT, false);
    out.wire = W.out();
  }
  return out;
}

// ── Cadres : moulure balayée le long d'un contour ────────────────────────────
// outline : points 2D (a, b) du contour de la glace (sens trigonométrique) ;
// la moulure (profil en (dehors, avant)) est balayée avec des onglets lissés
function contour(shape, hw, hh, n = 160) {
  const pts = [];
  if (shape === 'oval') for (let i = 0; i < n; i++) { const a = (2 * PI * i) / n; pts.push([hw * cos(a), hh * sin(a)]); }
  else if (shape === 'arch') {
    const k = hw, yc = hh - k;
    const m = n / 2;
    for (let i = 0; i <= m; i++) { const a = (PI * i) / m; pts.push([k * cos(a), yc + k * sin(a)]); }
    pts.push([-hw, -hh]); pts.push([hw, -hh]);
  } else {
    const rc = min(hw, hh) * 0.04;
    const corner = (cx, cy, a0) => { for (let k = 0; k <= 5; k++) { const a = a0 + (PI / 2) * (k / 5); pts.push([cx + rc * cos(a), cy + rc * sin(a)]); } };
    corner(hw - rc, hh - rc, 0); corner(-hw + rc, hh - rc, PI / 2); corner(-hw + rc, -hh + rc, PI); corner(hw - rc, -hh + rc, 1.5 * PI);
  }
  return densify(pts, 0.01);
}
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
// profil de moulure (dehors, avant) avec normales : feuillure, doucine, baguette
function moulding(width, depth) {
  const P = [];
  const add2 = (x, y, nx, ny, s) => P.push({ p: [x, y], n: [nx, ny], s });
  add2(0, 0.002, -1, 0, EDGE); // (feuillure contre la glace)
  add2(0.004, depth * 0.55, -0.4, 1, OUT);
  for (let k = 0; k <= 6; k++) { const a = PI - (PI * k) / 6; add2(0.004 + width * 0.18 * (1 - cos(PI - a)) / 2, depth * (0.55 + 0.35 * sin(PI - a)), cos(a) * -1 * 0 + -cos(PI - a) * 0.3, sin(PI - a) + 0.2, EDGE); }
  add2(width * 0.35, depth * 0.62, 0.3, 1, OUT);
  for (let k = 0; k <= 8; k++) { const a = PI - (PI * k) / 8; add2(width * 0.35 + width * 0.32 * (1 - cos(PI - a)) / 2 + width * 0.0, depth * (0.62 + 0.38 * sin(PI - a)), -cos(a), sin(a), EDGE); }
  add2(width * 0.85, depth * 0.7, 0.6, 0.8, OUT);
  add2(width, depth * 0.45, 1, 0.2, EDGE);
  add2(width, 0, 1, 0, OUT);
  add2(width * 0.5, -0.004, 0, -1, OUT);
  return P;
}
function frameAround(B, outline, width, depth, X) {
  // X(a, b, out, fwd) → point 3D ; N(a, b, nout, nfwd) → normale
  const M = outline.length;
  const prof = moulding(width, depth);
  const rows = [];
  for (let i = 0; i <= M; i++) {
    const p = outline[i % M], q = outline[(i + 1) % M], r = outline[(i - 1 + M) % M];
    const t = norm([q[0] - r[0], q[1] - r[1], 0]);
    const o = [t[1], -t[0]]; // (vers l'extérieur pour un contour trigonométrique)
    const row = prof.map(({ p: [u, v], n: [nu, nv], s }) => {
      const P3 = X.pos(p[0] + o[0] * u, p[1] + o[1] * u, v);
      const N3 = X.dir(o[0] * nu, o[1] * nu, nv);
      return B.vert(P3, N3, s, X.dir(t[0], t[1], 0));
    });
    rows.push(row);
  }
  for (let i = 0; i < M; i++) for (let j = 0; j + 1 < prof.length; j++) B.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
}
// glace : la face (éventail sur le contour), un biseau de 15 mm, le chant
function glassPane(G, Bv, outline, X, bevel = 0.014) {
  const M = outline.length;
  const c = G.vert(X.pos(0, 0, 0), X.dir(0, 0, 1), OUT);
  const inner = outline.map(([a, b]) => { const l = Math.hypot(a, b) || 1, k = max(0, 1 - bevel / l); return G.vert(X.pos(a * k, b * k, 0), X.dir(0, 0, 1), OUT); });
  for (let i = 0; i < M; i++) G.tri(c, inner[i], inner[(i + 1) % M]);
  // biseau (dans un maillage à part : il reflète l'environnement, pas la pièce)
  const r0 = [], r1 = [];
  for (let i = 0; i < M; i++) {
    const [a, b] = outline[i], l = Math.hypot(a, b) || 1, k = max(0, 1 - bevel / l);
    const nrm = norm([a / l * 0.35, b / l * 0.35, 1]);
    r0.push(Bv.vert(X.pos(a * k, b * k, 0), X.dir(...nrm), EDGE));
    r1.push(Bv.vert(X.pos(a, b, -0.004), X.dir(...nrm), EDGE));
  }
  for (let i = 0; i < M; i++) Bv.quad(r0[i], r0[(i + 1) % M], r1[(i + 1) % M], r1[i]);
}
const frameXf = (c, u, v, n) => ({
  pos: (a, b, f) => [c[0] + u[0] * a + v[0] * b + n[0] * f, c[1] + u[1] * a + v[1] * b + n[1] * f, c[2] + u[2] * a + v[2] * b + n[2] * f],
  dir: (a, b, f) => norm([u[0] * a + v[0] * b + n[0] * f, u[1] * a + v[1] * b + n[1] * f, u[2] * a + v[2] * b + n[2] * f]),
});

function buildPlaneMirror(R, Pl = R.reflector.plane) {
  const ol = contour(Pl.shape, Pl.hw, Pl.hh);
  const X = frameXf(Pl.c, Pl.u, Pl.v, Pl.n);
  const G = new Buffers(), Bv = new Buffers(), F = new Buffers(), S = new Buffers();
  glassPane(G, Bv, ol, X);
  const fw = R.family === 'psyche' ? 0.035 : 0.06, fd = R.family === 'psyche' ? 0.022 : 0.03;
  frameAround(F, ol, fw, fd, X);
  // dos (une planche derrière la glace)
  const back = ol.map(([a, b]) => { const l = Math.hypot(a, b) || 1; return [a + (a / l) * fw * 0.6, b + (b / l) * fw * 0.6]; });
  const cB = F.vert(X.pos(0, 0, -0.012), X.dir(0, 0, -1), IN);
  const rb = back.map(([a, b]) => F.vert(X.pos(a, b, -0.012), X.dir(0, 0, -1), IN));
  for (let i = 0; i < rb.length; i++) F.tri(cB, rb[(i + 1) % rb.length], rb[i]);
  if (R.family === 'psyche') buildPsycheStand(S, R, X, Pl);
  else { // trumeau : deux pitons et un fil
    const top = Pl.c[1] + Pl.hh + fw;
    for (const sx of [-1, 1]) tube(S, [[Pl.c[0] + sx * Pl.hw * 0.5, top - 0.06, Pl.c[2] - Pl.n[2] * 0.016], [Pl.c[0], top + 0.12, Pl.c[2] - Pl.n[2] * 0.026]], 0.0009, 6, OUT, true);
    sphere(S, [Pl.c[0], top + 0.12, Pl.c[2] - Pl.n[2] * 0.024], 0.006, 12, 8, EDGE);
  }
  return { glass: G.out(), bevel: Bv.out(), frame: F.out(), stand: S.out() };
}
// psyché : deux montants tournés sur des pieds en patins, une traverse, deux
// pivots à molette qui tiennent la glace à mi-hauteur
function buildPsycheStand(B, R, X, Pl) {
  const yaw = R.reflector.yaw;
  const c = Pl.c;
  const ux = [cos(yaw), 0, -sin(yaw)]; // (horizontal, dans le plan de la glace)
  const fz = [sin(yaw), 0, cos(yaw)];
  const half = Pl.hw + 0.06;
  const floorY = -TABLE_H;
  for (const sx of [-1, 1]) {
    const base = add([c[0], floorY, c[2]], mul(ux, sx * half));
    vertical(B, base, 0);
    const Hc = c[1] - floorY + 0.04;
    lathe(B, smoothLathe([[0, 0], [0.016, 0], [0.018, 0.02], [0.013, 0.08], [0.019, 0.14], [0.012, 0.2], [0.014, Hc * 0.6], [0.019, Hc * 0.64], [0.012, Hc * 0.68], [0.011, Hc - 0.02], [0.016, Hc - 0.01], [0.013, Hc]], EDGE), 24);
    B.noFrame();
    // pied en patin
    const f0 = add(base, mul(fz, -0.2)), f1 = add(base, mul(fz, 0.24));
    tube(B, Array.from({ length: 13 }, (_, k) => { const f = k / 12; const p = add(f0, mul(sub(f1, f0), f)); return [p[0], floorY + 0.012 + 0.03 * sin(f * PI), p[2]]; }), 0.012, 12, OUT, true);
    // pivot à molette (laiton)
    const pv = add([c[0], c[1], c[2]], mul(ux, sx * (Pl.hw + 0.035)));
    tube(B, [add(pv, mul(ux, -sx * 0.03)), add(pv, mul(ux, sx * 0.03))], 0.006, 12, EDGE, true);
    sphere(B, add(pv, mul(ux, sx * 0.036)), 0.011, 16, 10, EDGE);
  }
  // traverse basse
  tube(B, [add([c[0], floorY + 0.09, c[2]], mul(ux, -half)), add([c[0], floorY + 0.09, c[2]], mul(ux, half))], 0.011, 12, OUT, true);
}

// ── Miroir ardent : calotte d'ellipsoïde, bague, fourche, colonne, pied ──────
function buildArdent(R, s) {
  const Rf = R.reflector;
  const E = makeEllipse(s, Rf.focus, Rf.center, Rf.cap);
  const { u, v } = planeBasis(E.axis);
  const th = Math.acos(E.cosCap);
  const nr = 28, na = 72;
  const cap = new Buffers(), back = new Buffers(), metal = new Buffers();
  const rim = [];
  const ringF = [], ringB = [];
  const rows = [], rowsB = [];
  for (let i = 0; i <= nr; i++) {
    const t = (th * i) / nr, row = [], rowB = [];
    for (let j = 0; j < (i === 0 ? 1 : na); j++) {
      const p = (2 * PI * j) / na;
      const d = norm(add(add(mul(E.axis, cos(t)), mul(u, sin(t) * cos(p))), mul(v, sin(t) * sin(p))));
      const r = ellipseRadius(E, d), P = add(E.f2, mul(d, r));
      const n = norm(add(norm(sub(E.f1, P)), norm(sub(E.f2, P))));
      row.push(cap.vert(P, n, OUT));
      rowB.push(back.vert(sub(P, mul(n, 0.006 + 0.01 * (1 - (i / nr) ** 2))), mul(n, -1), IN));
      if (i === nr) { rim.push(P); ringF.push(n); }
    }
    rows.push(row); rowsB.push(rowB);
  }
  for (const [G, Rw] of [[cap, rows], [back, rowsB]]) {
    for (let j = 0; j < na; j++) G.tri(Rw[0][0], Rw[1][j], Rw[1][(j + 1) % na]);
    for (let i = 1; i < nr; i++) for (let j = 0; j < na; j++) G.quad(Rw[i][j], Rw[i][(j + 1) % na], Rw[i + 1][(j + 1) % na], Rw[i + 1][j]);
  }
  // bague : un tore qui épouse le bord
  const rimC = rim.reduce((a, b) => add(a, b), [0, 0, 0]).map((x) => x / rim.length);
  tube(metal, rim.concat([rim[0], rim[1]]), 0.0075, 12, EDGE, false);
  // fourche et colonne
  const nM = E.normal; // (axe de la calotte en son centre)
  const side = norm(cross(nM, UP));
  const rr = Math.hypot(...sub(rim[0], rimC)) + 0.012;
  const base = [Rf.stand[0], 0, Rf.stand[2]];
  const yokeY = rimC[1] - rr - 0.03;
  for (const sx of [-1, 1]) {
    const pv = add(rimC, mul(side, sx * rr));
    sphere(metal, add(pv, mul(side, sx * 0.008)), 0.009, 14, 10, EDGE);
    const low = add([rimC[0], yokeY, rimC[2]], mul(side, sx * rr));
    tube(metal, [pv, add(pv, [0, -0.02, 0]), low, add([rimC[0], yokeY, rimC[2]], mul(side, sx * rr * 0.4)), [rimC[0], yokeY - 0.01, rimC[2]]], 0.0045, 10, OUT, true);
  }
  vertical(metal, base, 0);
  const colH = yokeY - 0.01;
  lathe(metal, smoothLathe([[0, 0], [0.07, 0], [0.072, 0.006], [0.066, 0.016], [0.03, 0.024], [0.014, 0.034], [0.009, 0.05], [0.008, colH - 0.02], [0.012, colH - 0.01], [0.01, colH]], EDGE), 40);
  metal.noFrame();
  return { cap: cap.out(), back: back.out(), metal: metal.out() };
}

// ── Boule à facettes (dans le repère de son centre) ──────────────────────────
function buildBall(R) {
  const Rf = R.reflector;
  const Bc = { r: Rf.ball.r, rows: Rf.ball.rows, cols: Math.round((PI * Rf.ball.rows) / BALL_LAT) };
  const F = new Buffers(), core = new Buffers(), chain = new Buffers();
  const size = facetSize(Bc), h = size / 2, th = 0.0012;
  for (let i = 0; i < Bc.rows; i++) {
    const lat = rowLat(Bc, i), nc = rowCols(Bc, i);
    for (let j = 0; j < nc; j++) {
      const lon = ((j + 0.5 * (i % 2)) / nc) * 2 * PI;
      const n = [cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)];
      const t = [-sin(lon), 0, cos(lon)], b = mul(cross(n, t), -1);
      const c = mul(n, Bc.r);
      F.frame(c, t, b, n);
      // tesselle : un miroir plan, un chanfrein tout autour (il accroche un
      // filet de lumière), un chant qui descend jusqu'au noyau
      const k = h - th * 0.6;
      const top = [[-k, -k], [k, -k], [k, k], [-k, k]].map(([x, y]) => F.vert([x, y, 0], [0, 0, 1], OUT));
      const ring = [[-h, -h], [h, -h], [h, h], [-h, h]];
      const bev = ring.map(([x, y]) => F.vert([x, y, -th * 0.6], norm([x / h * 0.6, y / h * 0.6, 1]), EDGE));
      const low = ring.map(([x, y]) => F.vert([x, y, -th * 2.5], norm([x / h, y / h, 0]), EDGE));
      F.quad(top[0], top[1], top[2], top[3]);
      for (let e = 0; e < 4; e++) { const f = (e + 1) % 4; F.quad(top[e], bev[e], bev[f], top[f]); F.quad(bev[e], low[e], low[f], bev[f]); }
      F.noFrame();
    }
  }
  sphere(core, [0, 0, 0], Bc.r * 0.985, 40, 24, IN);
  // calotte et anneau du haut, chaînette
  const topY = Bc.r * 1.0;
  vertical(chain, [0, topY - 0.004, 0], 0);
  lathe(chain, smoothLathe([[0, 0], [0.012, 0], [0.012, 0.006], [0.004, 0.012], [0.003, 0.016]], EDGE), 20);
  chain.noFrame();
  const links = Math.ceil((CEIL - Rf.ballC[1] - topY) / 0.012);
  for (let k = 0; k < links; k++) {
    const y = topY + 0.02 + k * 0.012;
    chain.frame([0, y, 0], k % 2 ? [1, 0, 0] : [0, 0, 1], UP, k % 2 ? [0, 0, 1] : [1, 0, 0]);
    torus(chain, [0, 0, 0], 0.0045, 0.0011, 12, 6, EDGE);
    chain.noFrame();
  }
  return { facets: F.out(), core: core.out(), chain: chain.out() };
}

// ── Poussière : positions et phases, tirées une fois ─────────────────────────
function buildDust(n, seed, box) {
  const rng = createRng(`${seed}:dust`);
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a[i * 4] = rng.range(box[0][0], box[1][0]); a[i * 4 + 1] = rng.range(box[0][1], box[1][1]); a[i * 4 + 2] = rng.range(box[0][2], box[1][2]);
    a[i * 4 + 3] = rng.range(0.6, 1.4); // (taille relative)
    b[i * 4] = rng.range(0, 6.283); b[i * 4 + 1] = rng.range(0, 6.283); b[i * 4 + 2] = rng.range(0, 6.283); b[i * 4 + 3] = rng.range(0.6, 1.4);
  }
  return { a, b };
}

export function buildScene(R, opts = {}) {
  const s = [R.lamp.x, R.lamp.y, R.lamp.z];
  const out = {
    room: buildRoom(R.room, R.room.wall.endsWith('Panel')),
    table: buildTable(R.table, R.table.mat === 'linen'),
    vessels: buildVessels(R.objects),
    lamp: buildLamp(R.lamp),
  };
  if (R.reflector.plane) out.mirror = buildPlaneMirror(R);
  // galerie : la glace d'en face, accrochée au mur du devant (derrière la
  // caméra : on ne la voit que dans la première glace)
  if (R.reflector.planeB) {
    const B = R.reflector.planeB;
    out.mirrorB = buildPlaneMirror(R, B);
    const W = new Buffers(), zf = B.c[2] + 0.03, Wd = 3.2, rows = [];
    for (let j = 0; j <= 20; j++) { const row = []; for (let i = 0; i <= 30; i++) row.push(W.vert([-Wd / 2 + (Wd * i) / 30, -TABLE_H + ((CEIL + TABLE_H) * j) / 20, zf], [0, 0, -1], OUT)); rows.push(row); }
    W.grid(rows);
    out.frontWall = W.out();
  }
  if (R.family === 'ardent') out.ardent = buildArdent(R, s);
  if (R.family === 'facettes') out.ball = buildBall(R);
  const wz = R.room.wallZ;
  out.dust = buildDust(opts.dust ?? 6000, R.seed, [[-1.1, -0.05, wz + 0.05], [1.2, 1.1, 1.1]]);
  return out;
}

export { outline, footprint };
