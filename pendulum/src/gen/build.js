// Géométrie usinée des machines (module pur : worker, tests). Toutes les
// pièces sont des solides fermés aux arêtes arrondies, normales exactes :
// - slab : une plaque au contour convexe (stade, disque, rectangle à coins
//   ronds), extrudée, son bord arrondi en quart de cercle ;
// - turned : un solide de révolution (profil r(z) aux congés arrondis) ;
// - box : un pavé arrondi.
// Repère d'une pièce donné par B.frame(origine, X, Y, Z).
//
// Rôles de surface : OUT (face, finition externe), EDGE (congés et chants,
// polis), IN (finition interne : fond de gorge, alésage).
import { Buffers, OUT, IN, EDGE, roundedBox, lathe, norm, cross, add, mul, sub } from './mesh.js';

const { PI, cos, sin, max, min, hypot, ceil } = Math;
const TAU = 2 * PI;

// ── Contours convexes (sens trigonométrique) ─────────────────────────────────
// stade : deux demi-cercles de rayon r centrés en (0, 0) et (0, −L)
export function stadium(L, r, k = 18) {
  const pts = [];
  for (let i = 0; i <= k; i++) { const a = (i / k) * PI; pts.push([r * cos(a), r * sin(a)]); }
  for (let i = 0; i <= k; i++) { const a = PI + (i / k) * PI; pts.push([r * cos(a), -L + r * sin(a)]); }
  return pts;
}
export const disc = (r, k = 48) => Array.from({ length: k }, (_, i) => [r * cos((i / k) * TAU), r * sin((i / k) * TAU)]);
export function roundRect(hx, hy, rc, k = 6) {
  const pts = [], c = [[hx - rc, hy - rc, 0], [-hx + rc, hy - rc, PI / 2], [-hx + rc, -hy + rc, PI], [hx - rc, -hy + rc, 1.5 * PI]];
  for (const [cx, cy, a0] of c) for (let i = 0; i <= k; i++) { const a = a0 + (i / k) * (PI / 2); pts.push([cx + rc * cos(a), cy + rc * sin(a)]); }
  return pts;
}

// normales 2D sortantes d'un contour convexe (moyenne des deux côtés)
function outlineNormals(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const t = [b[0] - a[0], b[1] - a[1]], l = hypot(t[0], t[1]) || 1;
    return [t[1] / l, -t[0] / l];
  });
}

// ── Plaque : contour convexe (plan XY local), épaisseur t (selon Z local),
// bord arrondi de rayon f (≤ t/2). Les points du contour sont ramenés vers
// l'intérieur de f : la silhouette reste exactement le contour.
export function slab(B, pts, t, f, { face = OUT, edge = EDGE, rimSteps = 5 } = {}) {
  f = min(f, t / 2 - 1e-5);
  const N = outlineNormals(pts), n = pts.length;
  const inset = pts.map((p, i) => [p[0] - N[i][0] * f, p[1] - N[i][1] * f]);
  // faces (éventail depuis le centre)
  const c = inset.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  for (const sgn of [1, -1]) {
    const z = sgn * (t / 2);
    const ci = B.vert([c[0], c[1], z], [0, 0, sgn], face, [0, 1, 0]);
    const ring = inset.map((p) => B.vert([p[0], p[1], z], [0, 0, sgn], face, [0, 1, 0]));
    for (let i = 0; i < n; i++) B.tri(ci, ring[i], ring[(i + 1) % n]);
  }
  // bord : du dessus (normale +Z) au flanc puis au dessous, en quarts de cercle
  const rows = [];
  const zc = t / 2 - f;
  const prof = [];
  for (let j = 0; j <= rimSteps; j++) { const a = (j / rimSteps) * (PI / 2); prof.push([sin(a), cos(a), zc]); }
  if (zc > 1e-5) prof.push([1, 0, -zc]);
  for (let j = rimSteps - (zc > 1e-5 ? 0 : 1); j >= 0; j--) { const a = (j / rimSteps) * (PI / 2); prof.push([sin(a), -cos(a), -zc]); }
  for (const [s, cz, z0] of prof) {
    const row = inset.map((p, i) => {
      const nn = [N[i][0] * s, N[i][1] * s, cz];
      return B.vert([p[0] + N[i][0] * f * s, p[1] + N[i][1] * f * s, z0 + cz * f], nn, edge, [-N[i][1], N[i][0], 0]);
    });
    rows.push(row);
  }
  B.grid(rows, true);
}

// ── Pièce tournée : profil [[r, z], …] (du bas vers le haut, r ≥ 0) ; chaque
// angle du profil est arrondi d'un rayon fil (sauf sur l'axe). Les normales
// sont celles du profil adouci.
export function turned(B, prof, { fil = 0.002, M = 40, surf = null, axial = true } = {}) {
  const start = B.n;
  // arrondit les coins : chaque coin intérieur devient un arc
  const P = [];
  for (let i = 0; i < prof.length; i++) {
    const p = prof[i];
    if (i === 0 || i === prof.length - 1 || fil <= 0) { P.push({ p, s: surf?.(i) ?? OUT }); continue; }
    const a = prof[i - 1], b = prof[i + 1];
    const da = norm2([a[0] - p[0], a[1] - p[1]]), db = norm2([b[0] - p[0], b[1] - p[1]]);
    const la = hypot(a[0] - p[0], a[1] - p[1]), lb = hypot(b[0] - p[0], b[1] - p[1]);
    const ang = Math.acos(Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1])));
    if (ang > PI - 0.05) { P.push({ p, s: surf?.(i) ?? OUT }); continue; }
    const d = Math.min(fil / Math.tan(ang / 2), la * 0.45, lb * 0.45);
    const p0 = [p[0] + da[0] * d, p[1] + da[1] * d], p1 = [p[0] + db[0] * d, p[1] + db[1] * d];
    const k = 4;
    for (let j = 0; j <= k; j++) {
      const t = j / k;
      // Bézier quadratique (proche de l'arc, tangente exacte aux deux bouts)
      const q = [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p[1] + t * t * p1[1]];
      P.push({ p: q, s: EDGE });
    }
  }
  // normales : perpendiculaires au profil (moyenne des deux côtés), orientées vers l'extérieur
  const pr = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)].p, b = P[Math.min(P.length - 1, i + 1)].p;
    const t = norm2([b[0] - a[0], b[1] - a[1]]);
    let nr = t[1], nz = -t[0];
    // (profil parcouru du bas vers le haut, extérieur à droite : r croissant = dehors)
    if (P[i].p[0] < 1e-7) { nr = 0; nz = i === 0 ? -1 : 1; }
    pr.push({ r: P[i].p[0], z: P[i].p[1], nr, nz, s: P[i].s });
  }
  lathe(B, pr, M);
  // tangente le long de l'axe (fil du bois, brossage d'une pièce tournée)
  if (axial) {
    const a = B._v([0, 0, 1]);
    for (let i = start; i < B.n; i++) {
      const n = [B.nor[i * 3], B.nor[i * 3 + 1], B.nor[i * 3 + 2]];
      let d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2], T = [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d];
      if (hypot(...T) < 0.2) { const c = B._v([1, 0, 0]); d = c[0] * n[0] + c[1] * n[1] + c[2] * n[2]; T = [c[0] - n[0] * d, c[1] - n[1] * d, c[2] - n[2] * d]; }
      T = norm(T);
      B.tan[i * 4] = T[0]; B.tan[i * 4 + 1] = T[1]; B.tan[i * 4 + 2] = T[2];
    }
  }
}
const norm2 = (v) => { const l = hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// cylindre plein d'axe Z local, de z0 à z1, rayon r, arêtes arrondies
export function cylinder(B, r, z0, z1, fil = 0.0015, M = 36, s = OUT) {
  turned(B, [[0, z0], [r, z0], [r, z1], [0, z1]], { fil, M, surf: (i) => (i === 1 || i === 2 ? s : OUT) });
}

// ── Maillon ──────────────────────────────────────────────────────────────────
// Repère : pivot à l'origine, le maillon pend selon −Y jusqu'au pivot suivant
// (0, −l, 0) ; épaisseur selon Z, centrée. Rendu en trois rôles :
// body (le maillon), hub (chapes, roulements, axe), bob (lentille).
// dzNext : décalage de l'axe vers le maillon suivant (+Z), 0 pour le dernier.
export function linkParts(L, dzNext) {
  const body = new Buffers(), hub = new Buffers(), bob = new Buffers();
  const { l, w, t, style } = L;
  const id = [0, 0, 0], X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const th = style === 'bar' ? t : w; // épaisseur dans le plan Z
  const bossR = style === 'bar' ? w * 0.5 : max(w * 0.9, 0.013);
  if (style === 'bar') {
    body.frame(id, X, Y, Z);
    slab(body, stadium(l, w / 2, 20), t, min(t * 0.4, 0.003));
    // deux lignes de vis à tête fendue près de chaque chape (accent de hub)
  } else {
    // tube ou tige entre deux têtes de bielle (plaques en stade courtes)
    const head = (y0) => { body.frame([0, y0, 0], X, Y, Z); slab(body, stadium(0.0001, bossR, 18), th * 1.0, min(th * 0.35, 0.003)); };
    head(0); head(-l);
    body.frame([0, -bossR * 0.7, 0], X, [0, 0, -1], [0, -1, 0]);
    // (axe Z de la pièce tournée = −Y du maillon)
    cylinder(body, w / 2, 0, l - bossR * 1.4, 0.0008, 24);
  }
  // chapes : roulement au pivot (bague extérieure, cage, bague intérieure)
  const bear = (y, zc, rOut) => {
    hub.frame([0, y, zc], X, Y, Z);
    turned(hub, [[0, -th / 2 - 0.0025], [rOut, -th / 2 - 0.0025], [rOut, th / 2 + 0.0025], [0, th / 2 + 0.0025]], { fil: 0.0012, M: 40 });
  };
  bear(0, 0, bossR * 0.78);
  // axe vers le maillon suivant, avec un écrou
  if (dzNext > 0) {
    hub.frame([0, -l, 0], X, Y, Z);
    turned(hub, [[0, -th / 2 - 0.002], [0.0055, -th / 2 - 0.002], [0.0055, dzNext + 0.002], [0, dzNext + 0.002]], { fil: 0.0008, M: 24 });
    hub.frame([0, -l, 0], X, Y, Z);
    turned(hub, [[0, -th / 2 - 0.004], [bossR * 0.62, -th / 2 - 0.004], [bossR * 0.62, -th / 2 - 0.0005], [0, -th / 2 - 0.0005]], { fil: 0.0008, M: 6 });
  } else {
    bear(-l, 0, bossR * 0.55);
  }
  // vis de blocage près des chapes (sur la face avant)
  for (const y of [-bossR * 1.35, -l + bossR * 1.35]) {
    if (style !== 'bar') continue;
    hub.frame([0, y, th / 2], X, Y, Z);
    turned(hub, [[0, -0.001], [0.0028, -0.001], [0.0028, 0.0012], [0.0018, 0.0018], [0, 0.0018]], { fil: 0.0004, M: 16 });
  }
  // lentille : disque biconvexe dans le plan du balancement, traversé par le maillon
  if (L.bob) {
    const { r, at } = L.bob, e = max(th * 1.8, 0.016);
    bob.frame([0, -at * l, 0], X, Y, Z);
    const k = 12, prof = [[0, -e / 2]];
    for (let i = 1; i <= k; i++) { const a = (i / k) * PI; prof.push([r * sin(a), -(e / 2) * cos(a) * (0.35 + 0.65 * Math.abs(cos(a)))]); }
    prof.push([0, e / 2]);
    turned(bob, prof, { fil: 0, M: 48 });
    // écrou de réglage moleté sous la lentille
    bob.frame([0, -at * l - r - 0.006, 0], X, [0, 0, 1], [0, 1, 0]);
    cylinder(bob, max(w * 0.7, 0.008), -0.006, 0.006, 0.0008, 24, EDGE);
  }
  return { body: body.out(), hub: hub.out(), bob: L.bob ? bob.out() : null, th };
}

// ── Banc du chariot ──────────────────────────────────────────────────────────
// x le long du rail, y vers le haut, z vers l'avant (le côté des maillons).
// Retourne les pièces fixes par rôle, et les dimensions utiles à la scène.
export function cartBench(M, wood) {
  const half = M.rail.half, H = M.height;
  const base = new Buffers(), frame = new Buffers(), guide = new Buffers(), accent = new Buffers();
  const id = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const pulX = half + 0.13, beamL = pulX + 0.16;
  const rodY = H - 0.012, beamTop = H - 0.05;
  // socle : longue dalle posée au sol
  base.frame([0, 0, 0], id, Y, Z);
  roundedBox(base, [0, 0.03, 0], [beamL + 0.06, 0.03, 0.28], 0.012, 8);
  // colonnes aux deux bouts (tournées si bois, en caisson sinon)
  for (const sx of [-1, 1]) {
    const x = sx * (beamL - 0.08);
    if (wood) {
      frame.frame([x, 0.06, 0], id, [0, 0, -1], Y);
      const h = beamTop - 0.06 - 0.06;
      // balustre : base, renflement, gorge, chapiteau
      const prof = [[0, 0], [0.045, 0], [0.045, 0.03], [0.032, 0.05], [0.036, 0.12], [0.024, h * 0.45], [0.02, h * 0.5], [0.026, h * 0.55], [0.022, h - 0.06], [0.034, h - 0.035], [0.042, h - 0.02], [0.042, h], [0, h]];
      base.frame([x, 0.06, 0], id, Z, [0, 1, 0]); // (colonnes de bois : la matière du socle)
      turned(base, prof.map(([r, z]) => [r, z]), { fil: 0.004, M: 32 });
    } else {
      frame.frame([0, 0, 0], id, Y, Z);
      roundedBox(frame, [x, (beamTop + 0.06) / 2, 0], [0.03, (beamTop - 0.06) / 2, 0.035], 0.006, 6);
    }
    // patin sous la colonne
    frame.frame([0, 0, 0], id, Y, Z);
    roundedBox(frame, [x, 0.068, 0], [0.06, 0.008, 0.06], 0.004, 6);
  }
  // poutre
  base.frame([0, 0, 0], id, Y, Z);
  roundedBox(base, [0, beamTop - 0.04, 0], [beamL, 0.04, 0.05], 0.008, 6);
  // barres de guidage (deux) sur leurs paliers d'extrémité
  for (const z of [-0.028, 0.028]) {
    guide.frame([0, rodY, z], [0, 0, 1], Y, [1, 0, 0]);
    cylinder(guide, 0.0075, -(pulX - 0.03), pulX - 0.03, 0.001, 32, OUT);
  }
  for (const sx of [-1, 1]) {
    frame.frame([0, 0, 0], id, Y, Z);
    roundedBox(frame, [sx * (pulX - 0.012), (rodY + beamTop) / 2, 0], [0.018, (rodY - beamTop) / 2 + 0.016, 0.048], 0.004, 8);
    // butées : tampons de caoutchouc sur les barres
    for (const z of [-0.028, 0.028]) {
      accent.frame([sx * (half + 0.07), rodY, z], [0, 0, 1], Y, [sx, 0, 0]);
      turned(accent, [[0.0075, -0.012], [0.016, -0.012], [0.016, 0.004], [0.012, 0.012], [0.0075, 0.012]], { fil: 0.002, M: 24 });
    }
  }
  // moteur et réducteur au bout (derrière la poutre, axe selon Z)
  const mx = M.motorSide * pulX;
  frame.frame([mx, rodY - 0.035, -0.05], id, Y, [0, 0, -1]);
  turned(frame, [[0, 0], [0.035, 0], [0.035, 0.05], [0.03, 0.06], [0.03, 0.065], [0, 0.065]], { fil: 0.003, M: 36 }); // réducteur
  accent.frame([mx, rodY - 0.035, -0.115], id, Y, [0, 0, -1]);
  const fins = [[0, 0], [0.042, 0]];
  for (let i = 0; i < 9; i++) fins.push([0.042, 0.008 + i * 0.012], [0.046, 0.011 + i * 0.012], [0.046, 0.015 + i * 0.012], [0.042, 0.018 + i * 0.012]);
  fins.push([0.042, 0.13], [0.03, 0.14], [0, 0.14]);
  turned(accent, fins, { fil: 0.0012, M: 40 }); // moteur à ailettes
  return {
    parts: { base: base.out(), frame: frame.out(), guide: guide.out(), accent: accent.out() },
    dims: { pulX, rodY, beamTop, beamL, belt: { y: rodY - 0.035, r: 0.024 } },
  };
}

// chariot : bloc sur quatre douilles, axe du premier maillon vers l'avant
export function cartCarriage(M, dz0) {
  const body = new Buffers(), hub = new Buffers();
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  body.frame([0, 0, 0], X, Y, Z);
  roundedBox(body, [0, 0.004, 0], [0.075, 0.03, 0.052], 0.006, 10);
  // plaque de constructeur sur la face avant (léger relief)
  hub.frame([0, 0, 0], X, Y, Z);
  roundedBox(hub, [0.042, 0.012, 0.0525], [0.022, 0.011, 0.0012], 0.0008, 6);
  // douilles à billes (quatre boîtiers en saillie sous la plaque)
  for (const sx of [-1, 1]) for (const z of [-0.028, 0.028]) {
    hub.frame([sx * 0.045, -0.012, z], Z, Y, [1, 0, 0]);
    turned(hub, [[0.0075, -0.025], [0.014, -0.025], [0.014, 0.025], [0.0075, 0.025]], { fil: 0.002, M: 28 });
  }
  // palier de l'axe principal et l'axe lui-même
  hub.frame([0, 0, 0.052], X, Y, Z);
  turned(hub, [[0, 0], [0.018, 0], [0.018, 0.008], [0.011, 0.012], [0, 0.012]], { fil: 0.0015, M: 36 });
  hub.frame([0, 0, 0.05], X, Y, Z);
  turned(hub, [[0, 0], [0.0055, 0], [0.0055, dz0 + 0.004], [0, dz0 + 0.004]], { fil: 0.0008, M: 24 });
  return { body: body.out(), hub: hub.out() };
}

// poulie dentée (axe Z), jante à flasques, voile ajouré de trous ronds (vus
// tourner) ; le moyeu en accent
export function pulley(r, w) {
  const B = new Buffers(), A = new Buffers();
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  B.frame([0, 0, 0], X, Y, Z);
  turned(B, [[0, -w / 2], [r * 0.45, -w / 2], [r * 0.45, -w / 2 + 0.002], [r * 0.85, -w / 2 + 0.002], [r * 0.85, -w / 2], [r + 0.004, -w / 2], [r + 0.004, -w / 2 + 0.0025], [r, -w / 2 + 0.003], [r, w / 2 - 0.003], [r + 0.004, w / 2 - 0.0025], [r + 0.004, w / 2], [r * 0.85, w / 2], [r * 0.85, w / 2 - 0.002], [r * 0.45, w / 2 - 0.002], [r * 0.45, w / 2], [0, w / 2]], { fil: 0.0008, M: 48 });
  // quatre trous (des bouchons sombres simulent l'ajour : disques en retrait)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + PI / 4;
    A.frame([r * 0.66 * cos(a), r * 0.66 * sin(a), w / 2 - 0.0015], X, Y, Z);
    cylinder(A, r * 0.13, -0.001, 0.0012, 0.0005, 18, OUT);
  }
  A.frame([0, 0, w / 2], X, Y, Z);
  cylinder(A, r * 0.32, -0.002, 0.004, 0.001, 24, EDGE);
  return { body: B.out(), hub: A.out() };
}

// courroie : boucle autour de deux poulies (x = ±X, rayon r), section plate ;
// abscisse curviligne dans `pat.x` (le dessin des dents défile dans le shader)
export function beltLoop(Xp, r, w, e) {
  const B = new Buffers();
  const path = [];
  const nArc = 24, nLin = 60;
  for (let i = 0; i <= nLin; i++) path.push([-Xp + (2 * Xp * i) / nLin, r, 0, 1]);
  for (let i = 1; i <= nArc; i++) { const a = PI / 2 - (i / nArc) * PI; path.push([Xp + r * cos(a), r * sin(a), 0, 1]); }
  for (let i = 1; i <= nLin; i++) path.push([Xp - (2 * Xp * i) / nLin, -r, 0, 1]);
  for (let i = 1; i < nArc; i++) { const a = -PI / 2 - (i / nArc) * PI; path.push([-Xp + r * cos(a), r * sin(a), 0, 1]); }
  // section : rectangle e × w (épaisseur radiale e), normales franches
  let s = 0;
  const rows = [];
  const P = path.length;
  for (let i = 0; i <= P; i++) {
    const p = path[i % P], q = path[(i + 1) % P], o = path[(i - 1 + P) % P];
    if (i > 0) s += hypot(p[0] - o[0], p[1] - o[1]);
    const t = norm([q[0] - o[0], q[1] - o[1], 0]);
    const nOut = [-t[1], t[0], 0]; // (sortant : la boucle tourne en sens horaire, l'extérieur est à gauche)
    const corner = (u, v, n) => {
      const pos = [p[0] + nOut[0] * u, p[1] + nOut[1] * u, v];
      B.patOff = [0, 0, 0];
      const id = B.vert(pos, n, n === nOut ? OUT : EDGE, t);
      B.pat[id * 3] = s; B.pat[id * 3 + 1] = u; B.pat[id * 3 + 2] = v;
      return id;
    };
    rows.push([corner(e, -w / 2, nOut), corner(e, w / 2, nOut), corner(e, w / 2, [0, 0, 1]), corner(0, w / 2, [0, 0, 1]), corner(0, w / 2, mul(nOut, -1)), corner(0, -w / 2, mul(nOut, -1)), corner(0, -w / 2, [0, 0, -1]), corner(e, -w / 2, [0, 0, -1])]);
  }
  for (let i = 0; i < P; i++) for (let k = 0; k < 8; k += 2) B.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
  return { body: B.out(), length: s };
}

// ── Tourniquet (pendule de Furuta) ───────────────────────────────────────────
// socle en fonte, colonne, carter du moteur (fixes) ; le bras tourne autour de
// y à la hauteur H, le pendule pend à son extrémité (rayon r), dans le plan
// perpendiculaire au bras.
export function rotaryBase(M) {
  const base = new Buffers(), frame = new Buffers(), accent = new Buffers();
  const H = M.height, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const up = (B, y) => B.frame([0, y, 0], X, [0, 0, -1], Y); // (axe Z local = +y monde)
  up(base, 0);
  turned(base, [[0, 0], [0.17, 0], [0.17, 0.018], [0.15, 0.03], [0.07, 0.045], [0.055, 0.07], [0, 0.07]], { fil: 0.006, M: 64 });
  // nervures du socle
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    base.frame([cos(a) * 0.11, 0.035, sin(a) * 0.11], [cos(a), 0, sin(a)], Y, [-sin(a), 0, cos(a)]);
    roundedBox(base, [0, 0, 0], [0.045, 0.012, 0.006], 0.004, 6);
  }
  // colonne : fût tourné, bague, carter du moteur
  up(frame, 0.07);
  const h = H - 0.07 - 0.11;
  turned(frame, [[0, 0], [0.04, 0], [0.04, 0.02], [0.03, 0.035], [0.028, h * 0.5], [0.032, h - 0.02], [0.045, h - 0.01], [0.045, h], [0, h]], { fil: 0.003, M: 40 });
  up(accent, H - 0.11);
  const fins = [[0, 0], [0.055, 0]];
  for (let i = 0; i < 6; i++) fins.push([0.055, 0.006 + i * 0.012], [0.06, 0.009 + i * 0.012], [0.06, 0.013 + i * 0.012], [0.055, 0.016 + i * 0.012]);
  fins.push([0.055, 0.08], [0.04, 0.085], [0, 0.085]);
  turned(accent, fins, { fil: 0.0012, M: 48 });
  return { base: base.out(), frame: frame.out(), accent: accent.out() };
}

// le bras (repère : pivot du bras à l'origine, bras le long de +z jusqu'à r)
export function rotaryArm(M, Lay) {
  const arm = new Buffers(), hub = new Buffers(), accent = new Buffers();
  const r = M.arm.r, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  // moyeu tourné au-dessus du carter
  hub.frame([0, -0.025, 0], X, [0, 0, -1], Y);
  turned(hub, [[0, 0], [0.03, 0], [0.03, 0.03], [0.022, 0.04], [0, 0.04]], { fil: 0.002, M: 36 });
  // bras en caisson, du contrepoids à la tête
  arm.frame([0, 0, 0], X, Y, Z);
  roundedBox(arm, [0, 0, (r + 0.02 - 0.09) / 2], [0.016, 0.014, (r + 0.02 + 0.09) / 2], 0.005, 12, EDGE, OUT, Z);
  // contrepoids à l'arrière
  accent.frame([0, 0, -0.07], X, Y, Z);
  roundedBox(accent, [0, 0, 0], [0.028, 0.024, 0.022], 0.006, 8);
  // tête : palier dont l'axe est le long du bras, et l'axe du pendule
  hub.frame([0, 0, r - 0.012], X, Y, Z);
  turned(hub, [[0, 0], [0.019, 0], [0.019, 0.024], [0.013, 0.03], [0, 0.03]], { fil: 0.0015, M: 36 });
  hub.frame([0, 0, r], X, Y, Z);
  turned(hub, [[0, 0], [0.0055, 0], [0.0055, 0.042], [0, 0.042]], { fil: 0.0008, M: 24 });
  return { arm: arm.out(), hub: hub.out(), accent: accent.out() };
}

// ── Acrobate : portique derrière la chaîne ───────────────────────────────────
// deux montants (x = ±xp) derrière le plan de la chaîne, une traverse en
// tête, et l'axe de l'épaule en porte-à-faux vers l'avant : rien devant la
// chaîne, rien que le second maillon puisse rencontrer quand il se replie.
export function portal(M, Lay, wood) {
  const frame = new Buffers(), base = new Buffers(), guide = new Buffers();
  const H = M.height, xp = 0.3, zb = -0.17, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const top = H + 0.07;
  for (const sx of [-1, 1]) {
    if (wood) {
      base.frame([sx * xp, 0.04, zb], X, [0, 0, -1], Y);
      turned(base, [[0, 0], [0.034, 0], [0.034, 0.03], [0.026, 0.06], [0.024, (top - 0.04) * 0.5], [0.027, top - 0.16], [0.034, top - 0.1], [0.034, top - 0.06], [0, top - 0.06]], { fil: 0.004, M: 32 });
    } else {
      frame.frame([0, 0, 0], X, Y, Z);
      roundedBox(frame, [sx * xp, (top - 0.02) / 2 + 0.02, zb], [0.024, (top - 0.02) / 2, 0.024], 0.005, 6, EDGE, OUT, Y);
    }
    // pied, le long de z
    base.frame([0, 0, 0], X, Y, Z);
    roundedBox(base, [sx * xp, 0.02, zb + 0.04], [0.05, 0.02, 0.26], 0.008, 8, EDGE, OUT, Z);
  }
  // traverse de tête
  frame.frame([0, 0, 0], X, Y, Z);
  roundedBox(frame, [0, top, zb], [xp + 0.04, 0.026, 0.03], 0.006, 8, EDGE, OUT, X);
  // console et palier de l'épaule, sous la traverse, en porte-à-faux vers l'avant
  frame.frame([0, 0, 0], X, Y, Z);
  roundedBox(frame, [0, (top + H) / 2, zb], [0.03, (top - H) / 2 + 0.02, 0.028], 0.005, 6);
  guide.frame([0, H, zb], X, Y, Z);
  turned(guide, [[0, 0], [0.026, 0], [0.026, 0.05], [0.018, 0.06], [0, 0.06]], { fil: 0.003, M: 36 });
  const zEnd = Lay.z[0] + 0.006;
  guide.frame([0, H, zb], X, Y, Z);
  cylinder(guide, 0.0095, 0.003, zEnd - zb, 0.0012, 28, OUT); // (l'axe sort du palier : pièce distincte)
  return { frame: frame.out(), base: base.out(), guide: guide.out() };
}

// moteur et courroie du coude, portés par le premier maillon (repère du
// maillon : pivot à l'origine, maillon selon −y), derrière lui (−z)
export function acroDrive(L0, zBack, motorAt) {
  const accent = new Buffers(), belt = new Buffers(), guide = new Buffers();
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const ym = -motorAt * L0.l, rm = 0.012, re = 0.024;
  // carter du moteur (cylindre à ailettes, axe z, derrière)
  accent.frame([0, ym, zBack - 0.012], X, Y, [0, 0, -1]);
  const fins = [[0, 0], [0.026, 0]];
  for (let i = 0; i < 4; i++) fins.push([0.026, 0.006 + i * 0.011], [0.029, 0.009 + i * 0.011], [0.029, 0.012 + i * 0.011], [0.026, 0.015 + i * 0.011]);
  fins.push([0.026, 0.05], [0.018, 0.055], [0, 0.055]);
  turned(accent, fins, { fil: 0.001, M: 32 });
  // courroie entre la poulie du moteur et celle du coude
  const k = 20, path = [];
  for (let i = 0; i <= k; i++) { const a = PI + (i / k) * PI; path.push([rm * cos(a), ym + rm * sin(a) * 0 + rm * sin(a)]); }
  void path;
  belt.frame([0, 0, zBack], X, Y, Z);
  const seg = (y0, y1, x) => { belt.frame([x, (y0 + y1) / 2, zBack], X, Y, Z); roundedBox(belt, [0, 0, 0], [0.0015, Math.abs(y1 - y0) / 2, 0.006], 0.001, 4, EDGE, OUT, Y); };
  seg(ym, -L0.l, -(rm + re) / 2);
  seg(ym, -L0.l, (rm + re) / 2);
  guide.frame([0, ym, zBack], X, Y, Z);
  turned(guide, [[0, -0.007], [rm, -0.007], [rm, 0.007], [0, 0.007]], { fil: 0.001, M: 24 });
  return { accent: accent.out(), belt: belt.out(), guide: guide.out(), rm, re };
}
// poulie du coude, solidaire du second maillon (repère du coude)
export function elbowPulley(re, zBack) {
  const B = new Buffers(), A = new Buffers();
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  B.frame([0, 0, zBack], X, Y, Z);
  turned(B, [[0, -0.008], [re + 0.003, -0.008], [re + 0.003, -0.006], [re, -0.005], [re, 0.005], [re + 0.003, 0.006], [re + 0.003, 0.008], [0, 0.008]], { fil: 0.0006, M: 40 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    A.frame([re * 0.55 * cos(a), re * 0.55 * sin(a), zBack + 0.0085], X, Y, Z);
    cylinder(A, re * 0.18, -0.001, 0.001, 0.0004, 16, OUT);
  }
  return { body: B.out(), hub: A.out() };
}

// ── Roue d'inertie : potence et volant ───────────────────────────────────────
export function gallows(M, Lay, wood) {
  const frame = new Buffers(), base = new Buffers(), hub = new Buffers();
  const H = M.height, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], zc = -0.14;
  base.frame([0, 0, 0], X, Y, Z);
  roundedBox(base, [0, 0.025, zc - 0.05], [0.2, 0.025, 0.16], 0.01, 8);
  if (wood) {
    base.frame([0, 0.05, zc], X, [0, 0, -1], Y);
    turned(base, [[0, 0], [0.04, 0], [0.04, 0.03], [0.03, 0.06], [0.028, (H - 0.05) * 0.5], [0.032, H - 0.1], [0.04, H - 0.06], [0, H - 0.04]], { fil: 0.004, M: 32 });
  } else {
    frame.frame([0, 0, 0], X, Y, Z);
    roundedBox(frame, [0, (H + 0.05) / 2, zc], [0.028, (H - 0.05) / 2 + 0.01, 0.028], 0.006, 6);
  }
  // potence : bras horizontal du montant au pivot
  frame.frame([0, 0, 0], X, Y, Z);
  roundedBox(frame, [0, H, (zc + 0.035) / 2], [0.022, 0.02, (0.035 - zc) / 2 + 0.02], 0.006, 8, EDGE, OUT, Z);
  // palier et axe du pendule
  hub.frame([0, H, 0.03], X, Y, Z);
  turned(hub, [[0, 0], [0.022, 0], [0.022, 0.016], [0.014, 0.022], [0, 0.022]], { fil: 0.0015, M: 36 });
  hub.frame([0, H, 0.05], X, Y, Z);
  turned(hub, [[0, 0], [0.0055, 0], [0.0055, Lay.z0 + 0.004], [0, Lay.z0 + 0.004]], { fil: 0.0008, M: 24 });
  return { frame: frame.out(), base: base.out(), hub: hub.out() };
}
// volant : jante lourde, rayons, moyeu (repère : axe z, centré)
export function flywheel(W) {
  const rim = new Buffers(), hub = new Buffers();
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], r = W.r, e = 0.018;
  rim.frame([0, 0, 0], X, Y, Z);
  // jante : anneau à section arrondie (tournée, creuse au centre)
  turned(rim, [[r - 0.016, -e / 2], [r, -e / 2], [r + 0.002, -e / 2 + 0.003], [r + 0.002, e / 2 - 0.003], [r, e / 2], [r - 0.016, e / 2], [r - 0.018, e / 2 - 0.004], [r - 0.018, -e / 2 + 0.004]].map(([a, b]) => [a, b]).concat([[r - 0.016, -e / 2]]), { fil: 0.0015, M: 72, axial: false });
  // rayons
  for (let i = 0; i < W.spokes; i++) {
    const a = (i / W.spokes) * TAU, d = [cos(a), sin(a), 0];
    hub.frame([0, 0, 0], [-sin(a), cos(a), 0], [0, 0, 1], d);
    cylinder(hub, 0.0035, 0.016, r - 0.015, 0.0008, 14, OUT);
  }
  hub.frame([0, 0, 0], X, Y, Z);
  turned(hub, [[0, -0.012], [0.02, -0.012], [0.02, 0.012], [0.012, 0.015], [0, 0.015]], { fil: 0.0015, M: 36 });
  return { rim: rim.out(), hub: hub.out() };
}
// moteur du volant, porté au bout du pendule, derrière lui
export function wheelMotor(L, zBack) {
  const A = new Buffers(), X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  A.frame([0, -L.l, zBack], X, Y, [0, 0, -1]);
  const fins = [[0, 0], [0.028, 0]];
  for (let i = 0; i < 4; i++) fins.push([0.028, 0.006 + i * 0.011], [0.031, 0.009 + i * 0.011], [0.031, 0.012 + i * 0.011], [0.028, 0.015 + i * 0.011]);
  fins.push([0.028, 0.05], [0.02, 0.055], [0, 0.055]);
  turned(A, fins, { fil: 0.001, M: 32 });
  return A.out();
}
