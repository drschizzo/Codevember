// Maillages de l'appareil, construits dans le worker. Module pur.
//
// Le plateau est construit dans son repère local three (X = x, Y = z, Z = −y),
// en unités de la scène (mm × S) : parois balayées le long des segments et des
// arcs de maze.js (les mêmes que la physique), poteaux tournés aux jonctions,
// dalle et cadre balayés le long du contour, fond et rigole triangulés entre
// contours appariés. Les mécanismes sont construits dans leur propre repère et
// posés par la scène (matrices de kin.js).
import { Buffers, OUT, IN, EDGE, lathe, tube, sphere, roundedBox, norm, cross } from '../../../shared/gen/mesh.js';
import { DIM } from './maze.js';
import { S, layout, beltPath, discFrame } from '../kin.js';

const TAU = Math.PI * 2;
const { cos, sin } = Math;

// repère local three du plateau, en mm → unités
const boardFrame = (B) => B.frame([0, 0, 0], [S, 0, 0], [0, 0, -S], [0, S, 0]);

// ── Contours appariés (rectangle arrondi ou cercle) ──────────────────────────
// t ∈ [0, 1) ; δ : décalage vers l'extérieur (le rectangle arrondi décalé de δ
// garde ses normales au même paramètre). Côtés droits et quarts de cercle ont
// chacun un nombre fixe d'échantillons.
const NS = 40, NA = 18; // échantillons par côté droit, par quart de coin
export function contour(shape, t, d) {
  if (shape.t === 'circle') { const a = t * TAU; return { x: (shape.r + d) * cos(a), y: (shape.r + d) * sin(a), nx: cos(a), ny: sin(a) }; }
  const { hx, hy, rr } = shape, ix = hx - rr, iy = hy - rr, n = 4 * (NS + NA);
  let k = t * n;
  // ordre : côté droit (x = +), coin haut-droit, côté haut, coin haut-gauche, …
  const sides = [
    [[ix, -iy], [ix, iy], [1, 0]], [[ix, iy], 0], [[ix, iy], [-ix, iy], [0, 1]], [[-ix, iy], 1],
    [[-ix, iy], [-ix, -iy], [-1, 0]], [[-ix, -iy], 2], [[-ix, -iy], [ix, -iy], [0, -1]], [[ix, -iy], 3],
  ];
  for (let s = 0; s < 8; s++) {
    const len = s % 2 === 0 ? NS : NA;
    if (k < len || s === 7) {
      const f = Math.min(1, k / len), S2 = sides[s];
      if (s % 2 === 0) { const [a, b, nn] = S2; return { x: a[0] + (b[0] - a[0]) * f + nn[0] * (rr + d), y: a[1] + (b[1] - a[1]) * f + nn[1] * (rr + d), nx: nn[0], ny: nn[1] }; }
      const [c, q] = S2, ang = (q * Math.PI) / 2 + (f * Math.PI) / 2;
      return { x: c[0] + (rr + d) * cos(ang), y: c[1] + (rr + d) * sin(ang), nx: cos(ang), ny: sin(ang) };
    }
    k -= len;
  }
}
const contourN = (shape) => (shape.t === 'circle' ? 288 : 4 * (NS + NA));

// ── Dalle, cadre, fond, rigole ───────────────────────────────────────────────
// profil du cadre (w : décalage depuis le bord intérieur du cadre, z) : paroi
// intérieure, congé, dessus, gros congé extérieur, chant, congé du dessous
function rimProfile(Hr, Wr, slab) {
  const P = [];
  const arc = (cx, cz, r, a0, a1, s, n = 5) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push({ w: cx + r * cos(a), z: cz + r * sin(a), nw: cos(a), nz: sin(a), s }); } };
  const r1 = 1.6, r2 = 4, r3 = 2.5;
  P.push({ w: 0, z: 0, nw: -1, nz: 0, s: OUT });
  P.push({ w: 0, z: Hr - r1, nw: -1, nz: 0, s: OUT });
  arc(r1, Hr - r1, r1, Math.PI, Math.PI / 2, EDGE, 4);
  P.push({ w: Wr - r2, z: Hr, nw: 0, nz: 1, s: OUT });
  arc(Wr - r2, Hr - r2, r2, Math.PI / 2, 0, EDGE, 6);
  P.push({ w: Wr, z: -slab + r3, nw: 1, nz: 0, s: EDGE });
  arc(Wr - r3, -slab + r3, r3, 0, -Math.PI / 2, EDGE, 4);
  return P;
}
function buildBody(B, maze, L) {
  const shape = maze.race.rim.t === 'circle' ? { t: 'circle', r: maze.race.rim.r } : { t: 'rect', ...maze.race.rim };
  const n = contourN(shape), w = maze.race.width;
  const prof = rimProfile(L.Hr, DIM.rim, DIM.slab);
  // cadre : profil balayé le long du contour (rangées : un sommet par point du profil)
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = contour(shape, i / n, 0);
    rows.push(prof.map((p) => B.vert([c.x + c.nx * p.w, c.y + c.ny * p.w, p.z], [c.nx * p.nw, c.ny * p.nw, p.nz], p.s)));
  }
  // (rangées le long du contour, refermées)
  const cols = prof.map((_, j) => rows.map((r) => r[j]));
  for (let j = 0; j + 1 < cols.length; j++) {
    for (let i = 0; i < n; i++) B.quad(cols[j][i], cols[j][(i + 1) % n], cols[j + 1][(i + 1) % n], cols[j + 1][i]);
  }
  // rigole (anneau) : du bord du labyrinthe (δ = −w) au cadre (δ = 0)
  const ring = (d, z, s, nz = 1) => Array.from({ length: n }, (_, i) => { const c = contour(shape, i / n, d); return B.vert([c.x, c.y, z], [0, 0, nz], s); });
  const steps = [-w, -w * 0.66, -w * 0.33, 0];
  const R = steps.map((d) => ring(d, 0, IN));
  for (let j = 0; j + 1 < R.length; j++) for (let i = 0; i < n; i++) B.quad(R[j][i], R[j][(i + 1) % n], R[j + 1][(i + 1) % n], R[j + 1][i]);
  // fond du labyrinthe : anneaux homothétiques du bord vers le centre
  const inner = [];
  for (const f of [1, 0.8, 0.6, 0.4, 0.2]) inner.push(Array.from({ length: n }, (_, i) => { const c = contour(shape, i / n, -w); return B.vert([c.x * f, c.y * f, 0], [0, 0, 1], OUT); }));
  for (let j = 0; j + 1 < inner.length; j++) for (let i = 0; i < n; i++) B.quad(inner[j][i], inner[j][(i + 1) % n], inner[j + 1][(i + 1) % n], inner[j + 1][i]);
  const ctr = B.vert([0, 0, 0], [0, 0, 1], OUT), last = inner[inner.length - 1];
  for (let i = 0; i < n; i++) B.tri(ctr, last[i], last[(i + 1) % n]);
  // dessous
  const lip = DIM.rim - 2.5;
  const bot = Array.from({ length: n }, (_, i) => { const c = contour(shape, i / n, lip); return B.vert([c.x, c.y, -DIM.slab], [0, 0, -1], EDGE); });
  const bc = B.vert([0, 0, -DIM.slab], [0, 0, -1], EDGE);
  for (let i = 0; i < n; i++) B.tri(bc, bot[(i + 1) % n], bot[i]);
}

// ── Parois et poteaux ────────────────────────────────────────────────────────
// profil d'une paroi (u en travers, z) : flancs droits, dessus arrondi ;
// « taillé » : un congé creux au pied (≤ 1,5 mm, sous le point de contact de
// la bille — voir test)
export const COVE = 1.4;
function wallProfile(style) {
  const hw = DIM.hw, H = DIM.H, rt = hw * 0.9, P = [];
  const arc = (cu, cz, r, a0, a1, s, n, inv = false) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push({ u: cu + r * cos(a), z: cz + r * sin(a), nu: (inv ? -1 : 1) * cos(a), nz: (inv ? -1 : 1) * sin(a), s }); } };
  if (style === 'carved') arc(-hw - COVE, COVE, COVE, -Math.PI / 2, 0, OUT, 4, true);
  else P.push({ u: -hw, z: 0, nu: -1, nz: 0, s: OUT });
  P.push({ u: -hw, z: H - rt, nu: -1, nz: 0, s: OUT });
  arc(-hw + rt, H - rt, rt, Math.PI, Math.PI / 2, OUT, 5);
  arc(hw - rt, H - rt, rt, Math.PI / 2, 0, OUT, 5);
  if (style === 'carved') arc(hw + COVE, COVE, COVE, Math.PI, Math.PI * 1.5, OUT, 4, true);
  else P.push({ u: hw, z: 0, nu: 1, nz: 0, s: OUT });
  return P;
}
function sweepPath(B, prof, pts, tans) {
  // pts : points du tracé (x, y) ; tans : tangentes ; la normale en travers est (−ty, tx)
  const rows = pts.map((p, i) => {
    const t = tans[i], nx = -t[1], ny = t[0];
    return prof.map((q) => B.vert([p[0] + nx * q.u, p[1] + ny * q.u, q.z], [nx * q.nu, ny * q.nu, q.nz], q.s, [t[0], t[1], 0]));
  });
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < prof.length; j++) B.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
}
function buildWalls(B, maze, style) {
  const prof = wallProfile(style);
  for (const w of maze.walls) {
    if (w.t === 'seg') {
      const L = Math.hypot(w.bx - w.ax, w.by - w.ay), t = [(w.bx - w.ax) / L, (w.by - w.ay) / L];
      const n = Math.max(1, Math.ceil(L / 30));
      const pts = Array.from({ length: n + 1 }, (_, i) => [w.ax + ((w.bx - w.ax) * i) / n, w.ay + ((w.by - w.ay) * i) / n]);
      sweepPath(B, prof, pts, pts.map(() => t));
    } else if (w.t === 'arc') {
      const n = Math.max(2, Math.ceil(((w.a1 - w.a0) * w.r) / 4));
      const pts = [], tans = [];
      for (let i = 0; i <= n; i++) { const a = w.a0 + ((w.a1 - w.a0) * i) / n; pts.push([w.cx + w.r * cos(a), w.cy + w.r * sin(a)]); tans.push([-sin(a), cos(a)]); }
      sweepPath(B, prof, pts, tans);
    }
  }
}
function buildPosts(B, maze) {
  // (les poteaux sont tournés autour de l'axe z local du tour : on les construit
  // dans un repère où z est la normale du plateau)
  B.frame([0, 0, 0], [S, 0, 0], [0, 0, -S], [0, S, 0]);
  for (const w of maze.walls) if (w.t === 'post') {
    const base = B.n;
    lathe(B, postProfile(w.r), 20);
    for (let i = base; i < B.n; i++) { B.pos[i * 3] += w.x * S; B.pos[i * 3 + 2] += -w.y * S; }
  }
}
function postProfile(r) {
  const H = DIM.H, prof = [{ r, z: 0, nr: 1, nz: 0, s: EDGE }, { r, z: H - 0.6, nr: 1, nz: 0, s: EDGE }];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); const nr = cos(a) / r, nz = sin(a) / 1.6, l = Math.hypot(nr, nz); prof.push({ r: Math.max(1e-3, r * cos(a)), z: H - 0.6 + 1.6 * sin(a), nr: nr / l, nz: nz / l, s: EDGE }); }
  return prof;
}

// ── Pièces tournées et boîtes (mm, puis unités) ──────────────────────────────
// profil [r, z] lisse (normales calculées par différences), axe z local
function smoothLathe(B, pts, s = OUT, M = 40) {
  const prof = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1;
    return { r: Math.max(1e-3, p[0]), z: p[1], nr: dz / l, nz: -dr / l, s: p[2] ?? s };
  });
  lathe(B, prof, M);
}
// repère d'une pièce : origine o (mm, monde ou local), axe z de la pièce = ax
function frameAxis(B, o, ax, ref = [0, 1, 0]) {
  const Z = norm(ax);
  let X = norm(cross(ref, Z));
  if (!Number.isFinite(X[0]) || Math.hypot(...cross(ref, Z)) < 1e-6) X = norm(cross([1, 0, 0], Z));
  const Y = cross(Z, X);
  B.frame(o.map((x) => x * S), X.map((x) => x * S), Y.map((x) => x * S), Z.map((x) => x * S));
}
const box = (B, c, h, r, s = OUT, e = EDGE) => { B.frame(c.map((x) => x * S), [S, 0, 0], [0, S, 0], [0, 0, S]); roundedBox(B, [0, 0, 0], h, r, 0.2, e, s); };

// moteur : carter cylindrique (axe z local), flasques, bossage, arbre
function motor(B, R, len) {
  smoothLathe(B, [[0, -len / 2 - 3, EDGE], [R * 0.55, -len / 2 - 3, EDGE], [R * 0.62, -len / 2 - 1, EDGE], [R * 0.9, -len / 2, EDGE], [R, -len / 2 + 3], [R, len / 2 - 6],
    [R * 1.04, len / 2 - 5, EDGE], [R * 1.04, len / 2 - 1, EDGE], [R * 0.9, len / 2, EDGE], [R * 0.42, len / 2 + 0.5, EDGE], [R * 0.4, len / 2 + 6, EDGE], [R * 0.2, len / 2 + 7, EDGE], [0.001, len / 2 + 7, EDGE]], OUT, 36);
}

// ── Plateau sur cardan ───────────────────────────────────────────────────────
function plateauParts(L) {
  const parts = {};
  // socle (pierre ou bois) et colonne tournée (métal)
  const base = new Buffers();
  box(base, [0, L.plinth.h / 2, 0], [L.plinth.hx, L.plinth.h / 2, L.plinth.hz], 6, OUT, EDGE);
  parts.base = base.out();
  const frame = new Buffers();
  const top = L.pivotY - 10;
  frameAxis(frame, [0, L.plinth.h, 0], [0, 1, 0], [0, 0, 1]);
  smoothLathe(frame, [[0.001, 0, EDGE], [40, 0, EDGE], [40, 5, EDGE], [34, 8], [26, 14], [20, 24], [17, top - L.plinth.h - 22], [20, top - L.plinth.h - 16, EDGE], [24, top - L.plinth.h - 10, EDGE], [24, top - L.plinth.h - 4, EDGE], [0.001, top - L.plinth.h - 4, EDGE]], OUT, 40);
  // chape fixe : deux oreilles (axe du pivot selon X)
  box(frame, [0, top - 6, 0], [27, 4, 11], 2);
  for (const sx of [-1, 1]) box(frame, [sx * 22, L.pivotY - 3, 0], [3.5, 14, 10], 1.8);
  // moteurs, consoles, axes
  for (const m of L.motors) {
    frameAxis(frame, m.M, m.axis, [0, 1, 0]);
    // le carter derrière la manivelle (côté extérieur de l'arbre)
    const B2 = frame;
    const base0 = B2.n;
    motor(B2, L.motorR, L.motorLen);
    // (recule le carter d'une demi-longueur + 6 mm le long de l'axe, loin de la manivelle)
    const off = m.axis.map((x) => -x * (L.motorLen / 2 + 10) * S);
    for (let i = base0; i < B2.n; i++) { B2.pos[i * 3] += off[0]; B2.pos[i * 3 + 1] += off[1]; B2.pos[i * 3 + 2] += off[2]; }
    // console : un bloc du socle au carter
    const cx = m.M[0] - m.axis[0] * (L.motorLen / 2 + 10), cz = m.M[2] - m.axis[2] * (L.motorLen / 2 + 10);
    const h0 = L.plinth.h, h1 = m.M[1] - L.motorR * 0.7;
    box(frame, [cx, (h0 + h1) / 2, cz], [m.axis[0] ? L.motorLen * 0.32 : 12, (h1 - h0) / 2, m.axis[2] ? L.motorLen * 0.32 : 12], 2);
  }
  parts.frame = frame.out();
  // croisillon (tourne de α, origine au pivot) : bloc, axe selon X, axe selon Z
  const crossB = new Buffers();
  box(crossB, [0, 0, 0], [8, 8, 8], 2);
  frameAxis(crossB, [-28, 0, 0], [1, 0, 0]); smoothLathe(crossB, [[0.001, 0, EDGE], [4.5, 0, EDGE], [4.5, 56, EDGE], [0.001, 56, EDGE]], EDGE, 20);
  frameAxis(crossB, [0, 0, -16], [0, 0, 1]); smoothLathe(crossB, [[0.001, 0, EDGE], [3.5, 0, EDGE], [3.5, 32, EDGE], [0.001, 32, EDGE]], EDGE, 20);
  parts.cross = crossB.out();
  // chape du plateau (dans le repère local du plateau, mm) : deux oreilles selon
  // Z sous la dalle, et deux étriers à rotule pour les bielles
  const fork = new Buffers();
  const yb = -DIM.slab; // dessous de la dalle (local : Y = z)
  box(fork, [0, yb - 3, 0], [12, 3, 20], 2);
  for (const sz of [-1, 1]) box(fork, [0, yb - 3 - (L.pz) / 2 - 2, sz * 13], [7, L.pz / 2 + 2, 2.6], 1.4);
  for (const m of L.motors) {
    const a = [m.attach[0], m.attach[2], -m.attach[1]]; // (x, z, −y)
    box(fork, [a[0], yb - 3, a[2]], [8, 3, 8], 1.5);
    // tige filetée de la rotule, jusqu'au centre de la boule (12 mm sous la dalle)
    frameAxis(fork, [a[0], yb - 6, a[2]], [0, -1, 0], [1, 0, 0]);
    smoothLathe(fork, [[0.001, 0, EDGE], [3, 0, EDGE], [3, 6, EDGE], [0.001, 6, EDGE]], EDGE, 16);
  }
  parts.fork = fork.out();
  // manivelle (repère : origine sur l'arbre, axe z = arbre, la manivelle selon +x local)
  const crank = new Buffers();
  B0(crank);
  smoothLathe(crank, [[0.001, -2, EDGE], [8, -2, EDGE], [8, 6, EDGE], [0.001, 6, EDGE]], EDGE, 24);
  B0(crank); box(crank, [L.rc / 2, 0, 2], [L.rc / 2 + 5, 5.5, 2.5], 2.4);
  frameAxis(crank, [L.rc, 0, 0], [0, 0, 1]);
  smoothLathe(crank, [[0.001, 0, EDGE], [4.5, 0, EDGE], [4.5, 9, EDGE], [3, 10, EDGE], [0.001, 10, EDGE]], EDGE, 18);
  parts.crank = crank.out();
  // bielle (repère : de l'origine (maneton) à +y·Lr) : tige, deux têtes à rotule
  const rod = new Buffers();
  B0(rod);
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push([0, 4 + ((L.Lr - 8) * i) / 8, 0].map((x) => x * S)); // (la tige entre dans les deux rotules)
  rod.noFrame();
  tube(rod, pts, 2.8 * S, 14, OUT, false);
  for (const y of [0, L.Lr]) { rod.noFrame(); sphere(rod, [0, y * S, 0], 6 * S, 24, 14, EDGE); }
  parts.rod = rod.out();
  return parts;
}
const B0 = (B) => B.frame([0, 0, 0], [S, 0, 0], [0, S, 0], [0, 0, S]);

// ── Disques dressés : volant, axe, colonne, palier, moteur, poulie, courroie ─
function discParts(L) {
  const parts = {};
  const F = discFrame(L);
  // dans le repère local du plateau (three, mm) : volant à gorge, moyeu, axe
  const hub = new Buffers();
  boardAxis(hub, [0, 0, 0]);
  const zb = -DIM.slab, zv = L.zv, tv = L.tv, Rv = L.Rv;
  smoothLathe(hub, [[0.001, zb + 1, EDGE], [30, zb + 1, EDGE], [30, zb - L.gap], [Rv - 6, zv + tv / 2, EDGE], [Rv, zv + tv / 2 - 1, EDGE], [Rv, zv + 3, EDGE], [Rv - 4, zv, EDGE], [Rv, zv - 3, EDGE], [Rv, zv - tv / 2 + 1, EDGE],
    [Rv - 6, zv - tv / 2, EDGE], [24, zv - tv / 2], [12, zv - tv / 2 - 4, EDGE], [9, zv - tv / 2 - 6, EDGE], [9, L.zAxle - 18, EDGE], [0.001, L.zAxle - 18, EDGE]], OUT, 64);
  parts.hub = hub.out();
  // fixe (monde) : socle, colonne, palier, moteur et sa console
  const base = new Buffers();
  const pc = pulleyC(L, F);
  const axleEnd = add3(F.C, mul3(F.n, L.zAxle));
  // chevalet : deux jambes écartées, du socle au palier, derrière le volant
  const spread = Math.max(L.Rout * 0.78, 120), zFoot = axleEnd[2] - 70;
  const feet = [-1, 1].map((sx) => [sx * spread, L.base.h, zFoot]);
  const zmin = Math.min(zFoot, pc[2]) - 45, zmax = Math.max(pc[2], 0) + 55;
  const hx = spread + 34;
  box(base, [0, L.base.h / 2, (zmin + zmax) / 2], [hx, L.base.h / 2, (zmax - zmin) / 2], 6, OUT, EDGE);
  parts.base = base.out();
  const frame = new Buffers();
  // palier : boîte tournée le long de l'axe, derrière le volant
  frameAxis(frame, axleEnd, F.n, [1, 0, 0]);
  smoothLathe(frame, [[0.001, -16, EDGE], [24, -16, EDGE], [27, -12], [27, 12], [22, 16, EDGE], [12, 17, EDGE], [0.001, 17, EDGE]], OUT, 36);
  // jambes (barres tournées, sabots au pied, tenons dans le palier) et entretoise
  for (const f of feet) {
    const head = [Math.sign(f[0]) * 20, axleEnd[1] - 6, axleEnd[2] - 4];
    const d = [head[0] - f[0], head[1] - f[1], head[2] - f[2]], len = Math.hypot(...d);
    frameAxis(frame, f, d, [0, 0, 1]);
    smoothLathe(frame, [[0.001, 0, EDGE], [17, 0, EDGE], [17, 8, EDGE], [12, 12], [10, 24], [9, len - 20], [11, len - 12, EDGE], [11, len, EDGE], [0.001, len, EDGE]], OUT, 28);
  }
  {
    const y = L.base.h + (axleEnd[1] - L.base.h) * 0.42, zz = zFoot + (axleEnd[2] - 4 - zFoot) * 0.42;
    const x = spread + (20 - spread) * 0.42;
    frameAxis(frame, [-x, y, zz], [1, 0, 0], [0, 1, 0]);
    smoothLathe(frame, [[0.001, 0, EDGE], [6, 0, EDGE], [6, 2 * x, EDGE], [0.001, 2 * x, EDGE]], EDGE, 18);
  }
  // moteur : carter dans l'axe de la poulie (parallèle à l'axe du disque), derrière elle
  frameAxis(frame, add3(pc, mul3(F.n, -(L.motorLen / 2 + 12))), F.n, [1, 0, 0]);
  motor(frame, L.motorR, L.motorLen);
  // console du moteur
  const mc = add3(pc, mul3(F.n, -(L.motorLen / 2 + 12)));
  box(frame, [mc[0], (L.base.h + mc[1] - L.motorR * 0.7) / 2, mc[2]], [L.motorR * 0.75, (mc[1] - L.motorR * 0.7 - L.base.h) / 2, L.motorLen * 0.34], 2);
  parts.frame = frame.out();
  // poulie (repère : axe z = axe du moteur, origine au centre de la gorge) : gorge et rayons
  const pul = new Buffers();
  B0(pul);
  const rp = L.rp;
  smoothLathe(pul, [[0.001, -9, EDGE], [6, -9, EDGE], [6, -7], [rp, -6, EDGE], [rp, -2.5, EDGE], [rp - 3, 0, EDGE], [rp, 2.5, EDGE], [rp, 6, EDGE], [6, 7], [6, 9, EDGE], [0.001, 9, EDGE]], OUT, 36);
  // (trois perçages figurés par des bossages : la rotation se lit)
  for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; frameAxis(pul, [cos(a) * rp * 0.55, sin(a) * rp * 0.55, 6], [0, 0, 1]); smoothLathe(pul, [[0.001, 0, EDGE], [2.4, 0, EDGE], [2.4, 1.2, EDGE], [0.001, 1.2, EDGE]], EDGE, 12); }
  parts.pulley = pul.out();
  // courroie : tube de 2,6 mm dans le plan de la gorge (repère du plateau non tourné)
  const belt = new Buffers();
  const P = beltPath(L).map(([x, y]) => add3(add3(F.C, add3(mul3(F.X, x), mul3(F.up, y))), mul3(F.n, L.zv)).map((c) => c * S));
  P.push(P[0], P[1]);
  belt.noFrame();
  tube(belt, P, 2.6 * S, 12, OUT, false);
  parts.belt = belt.out();
  return parts;
}
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function pulleyC(L, F) { return add3(add3(F.C, mul3(F.up, -L.Dm)), mul3(F.n, L.zv)); }
// repère local three du plateau, tour autour de Y (la normale du plateau)
function boardAxis(B, o) { frameAxis(B, o, [0, 1, 0], [0, 0, 1]); }

// ── La bille ─────────────────────────────────────────────────────────────────
function ballMesh() {
  const B = new Buffers();
  B.noFrame();
  sphere(B, [0, 0, 0], DIM.ball * S, 64, 40, OUT);
  return B.out();
}

// ── Tout ─────────────────────────────────────────────────────────────────────
export function buildApparatus(maze, family, style = 'strip') {
  const L = layout(maze, family);
  const body = new Buffers(1 << 15);
  boardFrame(body);
  buildBody(body, maze, L);
  const walls = new Buffers(1 << 16);
  boardFrame(walls);
  buildWalls(walls, maze, style);
  buildPosts(walls, maze);
  const parts = family === 'plateau' ? plateauParts(L) : discParts(L);
  return { layout: L, meshes: { body: body.out(), walls: walls.out(), ball: ballMesh(), ...parts } };
}
