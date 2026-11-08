// Géométrie d'une cellule (un cube du tesseract), dans ses coordonnées
// locales [-1, 1]³ : l'ossature (barres profilées et nœuds d'angle), les
// panneaux des six faces (plaque, verre, tôle perforée, persiennes, grille
// tissée) et l'objet exposé au centre. Le vertex shader l'emmène ensuite en
// 4D puis la projette (voir scene/project.js) : toutes les surfaces sont
// subdivisées, pour que la projection gonflée puisse les courber.

import {
  Buffers, OUT, IN, EDGE, sweep, polyProfile, arcProfile, roundedBox, sphere, torus, tube, gem, lathe, sharpProfile,
  polyhedron, icosahedron, dodecahedron, add, sub, mul, norm, cross, dot, PI, cos, sin, abs,
} from './mesh.js';
import { createRng } from '../rng.js';

const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const sgnv = (v, s) => v.map((x) => x * s);

// ── Profils des barres ───────────────────────────────────────────────────────
// (u, v) : vers l'extérieur du cube, dans le plan perpendiculaire à la barre
function profileOf(f) {
  const w = f.w, c = w * f.chamfer;
  switch (f.style) {
    case 'round': return arcProfile([0, 0], w, 0, 2 * PI, 20, OUT);
    case 'tube': return arcProfile([0, 0], w, 0, 2 * PI, 20, OUT);
    case 'angle': { // cornière : deux ailes rabattues vers l'intérieur
      const L = w * 2, th = w * 0.5;
      return polyProfile(
        [[w, -L], [w, w - c], [w - c, w], [-L, w], [-L, w - th], [w - th, w - th], [w - th, -L]],
        [OUT, EDGE, OUT, EDGE, IN, IN, EDGE],
      );
    }
    case 'extrusion': { // profilé d'aluminium à rainures (une sur chaque face)
      const g = w * 0.26, dp = w * 0.42, pts = [], surfs = [];
      for (let k = 0; k < 4; k++) {
        const a = (k * PI) / 2, ca = Math.round(cos(a)), sa = Math.round(sin(a));
        const R = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
        for (const [p, s] of [[[w, -w + c], OUT], [[w, -g], EDGE], [[w - dp, -g], EDGE], [[w - dp, g], EDGE], [[w, g], OUT], [[w, w - c], EDGE]]) { pts.push(R(p)); surfs.push(s); }
      }
      return polyProfile(pts, surfs);
    }
    default: { // section carrée, arêtes chanfreinées ou arrondies (congé poli)
      if (f.fillet) {
        const r = Math.max(c, w * 0.04), out = [];
        const corners = [[w - r, w - r, 0], [-w + r, w - r, PI / 2], [-w + r, -w + r, PI], [w - r, -w + r, 1.5 * PI]];
        for (let i = 0; i < 4; i++) {
          const [x, y, a] = corners[i];
          out.push(...arcProfile([x, y], r, a, a + PI / 2, 5, EDGE));
          const [nx, ny, na] = corners[(i + 1) % 4];
          const p0 = [x + r * cos(a + PI / 2), y + r * sin(a + PI / 2)], p1 = [nx + r * cos(na), ny + r * sin(na)];
          const n = [cos(a + PI / 2), sin(a + PI / 2)];
          out.push({ a: p0, b: p1, na: n, nb: n, s: OUT });
        }
        return out;
      }
      return polyProfile(
        [[w, -w + c], [w, w - c], [w - c, w], [-w + c, w], [-w, w - c], [-w, -w + c], [-w + c, -w], [w - c, -w]],
        [OUT, EDGE, OUT, EDGE, OUT, EDGE, OUT, EDGE],
      );
    }
  }
}

// demi-taille du nœud d'angle
export function nodeHalf(f) {
  if (f.node === 'none') return 0;
  const base = f.style === 'angle' ? f.w * 1.15 : f.w;
  return base * (f.node === 'sphere' ? 1.55 : 1.32) * f.nodeScale;
}

// Plan et étendue des panneaux, d'après l'ossature : les panneaux sont pris
// dans la barre (à mi-épaisseur), ou posés contre l'aile de la cornière.
export function panelSeat(f, t) {
  const e = 1 - f.w;
  if (f.style === 'angle') { const th = f.w * 0.5; return { plane: e + f.w - th - t / 2 - 0.001, ext: e + f.w - th - 0.002 }; }
  return { plane: e, ext: e };
}

// ── Ossature ─────────────────────────────────────────────────────────────────
export function buildFrame(f) {
  const B = new Buffers(1 << 15), rng = createRng(`frame:${f.seed}`);
  const e = 1 - f.w, nh = nodeHalf(f), prof = profileOf(f);
  const segPerUnit = 16;
  // Point d'ancrage de chaque pièce (voir scene/project.js, frameMerge) :
  // barre : son axe, la coordonnée libre remplacée par 10 + numéro de barre ;
  // nœud : son centre. Une fois le tesseract plié, les ossatures des cellules
  // fusionnent : chaque barre se recentre sur l'arête, et les doublons se
  // rétractent dans leur axe.
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      B.piece = rng.int(0, 255);
      const o = add(sgnv(AX[b], sb * e), sgnv(AX[c], sc * e));
      B.anchor = o.map((v, i) => (i === a ? 10 + a * 4 + (sb > 0 ? 2 : 0) + (sc > 0 ? 1 : 0) : v));
      // les barres entrent dans les nœuds ; sans nœud, elles s'assemblent
      // bout à bout (celles de x vont jusqu'à l'angle, celles de y et z
      // s'arrêtent contre elles : pas de faces superposées)
      const t1 = nh > 0 ? e - nh * 0.6 : a === 0 ? 1 : 1 - 2 * f.w;
      sweep(B, prof, o, AX[a], sgnv(AX[b], sb), sgnv(AX[c], sc), -t1, t1, Math.ceil(2 * t1 * segPerUnit));
      if (f.style === 'tube') { // bagues aux extrémités du tube
        for (const s of [-1, 1]) {
          const pos = s * (t1 - f.w * 0.55);
          B.frame(add(o, sgnv(AX[a], pos)), AX[b], AX[c], AX[a]);
          collar(B, f.w * 1.2, f.w * 0.5);
          B.noFrame();
        }
      }
    }
  }
  // nœuds affleurants : leur face externe s'arrête à l'angle du cube (ils ne
  // débordent pas sur la cellule voisine du patron)
  // (sans nœud : de petits nœuds quand même, qui n'apparaissent qu'à la
  // fusion, pour couvrir la jonction des barres aux sommets)
  const nodeless = nh === 0, nhh = nodeless ? f.w * 1.45 : nh;
  const en = 1 - Math.max(nhh, f.w);
  if (nhh > 0) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    B.piece = rng.int(0, 255);
    const c = [sx * en, sy * en, sz * en];
    B.anchor = c;
    if (f.node === 'sphere') sphere(B, c, nhh, 28, 16, OUT);
    else roundedBox(B, c, [nhh, nhh, nhh], nhh * (f.node === 'knob' ? 0.55 : 0.22), 4, EDGE, OUT);
  }
  B.anchor = [0, 0, 0];
  return B.out();
}

// bague (tore aplati) autour de l'axe z local
function collar(B, R, L) {
  const prof = [];
  const k = 8;
  for (let i = 0; i <= k; i++) {
    const a = -PI / 2 + (PI * i) / k;
    prof.push([R * 0.92 + R * 0.08 * cos(a), (L / 2) * sin(a), cos(a), sin(a)]);
  }
  const rows = [];
  for (const [r, z, nr, nz] of prof) {
    const row = [];
    for (let i = 0; i < 32; i++) {
      const ph = (2 * PI * i) / 32, d = [cos(ph), sin(ph), 0];
      row.push(B.vert(add(mul(d, r), [0, 0, z]), norm(add(mul(d, nr), [0, 0, nz])), EDGE, [-sin(ph), cos(ph), 0]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
}

// ── Panneaux ─────────────────────────────────────────────────────────────────
// Repère d'une face : origine sur le plan du panneau, X et Y dans la face, Z
// vers l'extérieur du cube.
function faceFrame(face, plane) {
  const k = face >> 1, s = face & 1 ? 1 : -1;
  return { o: sgnv(AX[k], s * plane), X: AX[(k + 1) % 3], Y: AX[(k + 2) % 3], Z: sgnv(AX[k], s) };
}
// finition d'une face plane du panneau, selon sa normale locale
const plateSurf = (n) => (n[2] > 0.5 ? OUT : n[2] < -0.5 ? IN : EDGE);

function plate(B, a, t, sub = 10) {
  roundedBox(B, [0, 0, 0], [a, a, t / 2], t * 0.32, sub, EDGE, plateSurf, [1, 0, 0]);
}

// Forme d'un trou : rayon polaire ρ(θ) (rayon 1 de référence) et normale 2D
// du bord (vers la matière). Superellipses (rond, carré, losange, étoile,
// fente) et polygone régulier (hexagone).
function holeShape(P) {
  const rot = P.shape === 'cross' ? PI / 4 : P.twist || 0;
  const R2 = (v, a) => [v[0] * cos(a) - v[1] * sin(a), v[0] * sin(a) + v[1] * cos(a)];
  if (P.shape === 'hex') {
    const n = 6, seg = (2 * PI) / n;
    const local = (th) => { let u = th - rot; u -= Math.floor(u / seg) * seg; return u; };
    return {
      k: 0.98,
      rho: (th) => cos(PI / n) / cos(local(th) - PI / n),
      n: (th) => { const u = local(th); const a = th - u + PI / n; // (normale de la face ; moyenne aux sommets)
        if (u < 1e-6 || seg - u < 1e-6) return [cos(th), sin(th)];
        return [cos(a), sin(a)]; },
    };
  }
  const ex = { square: 5, diamond: 1.25, cross: 0.8, slot: 3 }[P.shape] ?? 2;
  const [ax, ay] = P.shape === 'slot' ? [1, 0.38] : [1, 1];
  return {
    k: P.shape === 'cross' ? 1.05 : P.shape === 'slot' ? 1.02 : 0.92,
    rho: (th) => {
      const u = th - rot, cu = cos(u), su = sin(u);
      return 1 / Math.pow(Math.pow(abs(cu / ax), ex) + Math.pow(abs(su / ay), ex), 1 / ex);
    },
    n: (th) => {
      const u = th - rot, cu = cos(u), su = sin(u);
      const gx = (Math.sign(cu) * Math.pow(Math.max(abs(cu / ax), 1e-3), ex - 1)) / ax, gy = (Math.sign(su) * Math.pow(Math.max(abs(su / ay), 1e-3), ex - 1)) / ay;
      const l = Math.hypot(gx, gy) || 1;
      return R2([gx / l, gy / l], rot);
    },
  };
}

// Tôle perforée : n × n carreaux, chacun percé d'un trou (superellipse
// d'exposant ex, tournée de rot) dont la taille suit un motif ; arêtes du trou
// chanfreinées (facettes polies). Les carreaux voisins partagent exactement
// les mêmes points le long de leur bord commun.
function perforated(B, a, t, P, rng) {
  const n = P.n, q = a / n, M = 24, ch = Math.min(t * 0.32, q * 0.12);
  const shape = holeShape(P);
  const holeR = (x, y, i, j) => { // fraction du demi-carreau
    const d = Math.hypot(x, y) / (a * 1.4142);
    let f;
    switch (P.grad) {
      case 'radial': f = 1 - d; break;
      case 'edge': f = d; break;
      case 'diagonal': f = (x + y) / (4 * a) + 0.5; break;
      case 'wave': f = 0.5 + 0.5 * cos((x / a) * PI * 1.5) * cos((y / a) * PI * 1.5); break;
      case 'random': f = rng.next(); break;
      default: f = 0.75;
    }
    return P.min + (P.max - P.min) * Math.min(1, Math.max(0, f));
  };
  const sq = (th) => { const c = cos(th), s = sin(th), m = Math.max(abs(c), abs(s)); return [(c / m) * q, (s / m) * q]; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    B.piece = rng.int(0, 255);
    const cx = -a + q * (2 * i + 1), cy = -a + q * (2 * j + 1);
    const r = holeR(cx, cy, i, j) * q * shape.k;
    const ring = (fn, z, nfn, s) => Array.from({ length: M }, (_, k) => {
      const th = (2 * PI * k) / M, p = fn(th);
      return B.vert([cx + p[0], cy + p[1], z], nfn(th, p), s);
    });
    const upN = () => [0, 0, 1], dnN = () => [0, 0, -1];
    if (r < q * 0.12) { // carreau plein (éventail depuis le centre, pour rester conforme aux voisins)
      for (const [z, nf, s] of [[t / 2, upN, OUT], [-t / 2, dnN, IN]]) {
        const ctr = B.vert([cx, cy, z], nf(), s), R = ring(sq, z, nf, s);
        for (let k = 0; k < M; k++) B.tri(ctr, R[k], R[(k + 1) % M]);
      }
      continue;
    }
    // bord du trou et sa normale 2D (vers la matière)
    const hole = (rr) => (th) => { const rho = rr * shape.rho(th); return [rho * cos(th), rho * sin(th)]; };
    const holeN = shape.n;
    const wallN = (th) => { const g = holeN(th); return [-g[0], -g[1], 0]; };
    const chUp = (th) => { const g = holeN(th); return norm([-g[0], -g[1], 1]); };
    const chDn = (th) => { const g = holeN(th); return norm([-g[0], -g[1], -1]); };
    const Ho = hole(r + ch), Hi = hole(r);
    const S0 = ring(sq, t / 2, upN, OUT), C0 = ring(Ho, t / 2, upN, OUT);
    const C0b = ring(Ho, t / 2, chUp, EDGE), H0 = ring(Hi, t / 2 - ch, chUp, EDGE);
    const H0b = ring(Hi, t / 2 - ch, wallN, EDGE), H1 = ring(Hi, -t / 2 + ch, wallN, EDGE);
    const H1b = ring(Hi, -t / 2 + ch, chDn, EDGE), C1 = ring(Ho, -t / 2, chDn, EDGE);
    const C1b = ring(Ho, -t / 2, dnN, IN), S1 = ring(sq, -t / 2, dnN, IN);
    B.grid([S0, C0], true); B.grid([C0b, H0], true); B.grid([H0b, H1], true); B.grid([H1b, C1], true); B.grid([C1b, S1], true);
  }
  // chant du panneau
  B.piece = rng.int(0, 255);
  const per = n * 6;
  for (let side = 0; side < 4; side++) {
    const rows = [];
    for (const z of [t / 2, -t / 2]) {
      const row = [];
      for (let k = 0; k <= per; k++) {
        const s = -a + (2 * a * k) / per;
        const p = [[a, s], [-s, a], [-a, -s], [s, -a]][side], nn = [[1, 0], [0, 1], [-1, 0], [0, -1]][side];
        row.push(B.vert([p[0], p[1], z], [nn[0], nn[1], 0], EDGE));
      }
      rows.push(row);
    }
    B.grid(rows);
  }
}

// Persiennes : lames parallèles inclinées
function louvres(B, f, a, t, P, rng) {
  const n = P.n, pitch = (2 * a) / n, ph = P.angle;
  const F = B.xf;
  for (let i = 0; i < n; i++) {
    B.piece = rng.int(0, 255);
    const y = -a + pitch * (i + 0.5);
    const Y2 = add(mul(F.Y, cos(ph)), mul(F.Z, sin(ph))), Z2 = add(mul(F.Y, -sin(ph)), mul(F.Z, cos(ph)));
    const o = add(F.o, mul(F.Y, y));
    const keep = B.xf;
    B.xf = { o, X: F.X, Y: Y2, Z: Z2 };
    roundedBox(B, [0, 0, 0], [a, pitch * 0.62, Math.max(t * 0.45, 0.008)], Math.max(t * 0.4, 0.007), 8, EDGE, plateSurf, [1, 0, 0]);
    B.xf = keep;
  }
}

// Grille tissée : joncs ronds dessus-dessous
function woven(B, a, P, rng) {
  const n = P.n, q2 = (2 * a) / n, rr = Math.min(q2 * 0.2, 0.03), amp = rr * 1.05;
  const steps = n * 10;
  for (let j = 0; j < n; j++) {
    const y = -a + q2 * (j + 0.5);
    for (const dir of [0, 1]) {
      B.piece = rng.int(0, 255);
      const pts = [];
      for (let k = 0; k <= steps; k++) {
        const x = -a + (2 * a * k) / steps;
        const z = (dir ? -1 : 1) * amp * sin((PI * x) / q2 + j * PI);
        pts.push(dir ? [y, x, z] : [x, y, z]);
      }
      tube(B, pts, rr, 10, OUT, false);
    }
  }
}

// Pointes de diamant (pyramides), clous (dômes) ou caissons (pyramides en
// creux, vers l'intérieur) sur une plaque
function studded(B, a, t, P, rng) {
  plate(B, a, t);
  const n = P.n, q = a / n, h = q * P.height;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    B.piece = rng.int(0, 255);
    const cx = -a + q * (2 * i + 1), cy = -a + q * (2 * j + 1), b = q * 0.86;
    if (P.mode === 'dome') {
      const keep = B.xf;
      const prof = [];
      for (let k = 0; k <= 8; k++) { const al = (PI / 2) * (k / 8); prof.push({ r: b * cos(al), z: t / 2 + h * 0.8 * sin(al), nr: cos(al) * h * 0.8, nz: sin(al) * b, s: k < 2 ? EDGE : OUT }); }
      prof.forEach((x) => { const l = Math.hypot(x.nr, x.nz); x.nr /= l; x.nz /= l; });
      B.xf = { o: add(keep.o, add(mul(keep.X, cx), mul(keep.Y, cy))), X: keep.X, Y: keep.Y, Z: keep.Z };
      lathe(B, prof, 28);
      B.xf = keep;
      continue;
    }
    const sgn = P.mode === 'coffer' ? -1 : 1, z0 = sgn * (t / 2), apex = [cx, cy, z0 + sgn * h];
    const c = [[cx - b, cy - b], [cx + b, cy - b], [cx + b, cy + b], [cx - b, cy + b]].map(([x, y]) => [x, y, z0]);
    for (let k = 0; k < 4; k++) {
      const p0 = c[k], p1 = c[(k + 1) % 4];
      let n = norm(cross(sub(p1, p0), sub(apex, p0)));
      if (n[2] * sgn < 0) n = mul(n, -1);
      const sf = sgn > 0 ? OUT : IN;
      B.tri(B.vert(p0, n, sf), B.vert(p1, n, sf), B.vert(apex, n, sf));
    }
  }
}

// Tôle ondulée : z = A·sin(2π·n·x / 2a), épaisseur t, chants droits
function corrugated(B, a, t, P) {
  const nx = P.n * 12, ny = 8, A = P.amp * (a / P.n);
  const zf = (x) => A * sin((PI * P.n * (x + a)) / a);
  const dz = (x) => A * ((PI * P.n) / a) * cos((PI * P.n * (x + a)) / a);
  const vert = (x, y, side) => { const d = dz(x), n = norm([-d * side, 0, side]); return B.vert([x, y, zf(x) + (side * t) / 2], n, side > 0 ? OUT : IN, [0, 1, 0]); };
  for (const side of [1, -1]) {
    const rows = [];
    for (let j = 0; j <= ny; j++) { const y = -a + (2 * a * j) / ny, row = []; for (let i = 0; i <= nx; i++) row.push(vert(-a + (2 * a * i) / nx, y, side)); rows.push(row); }
    B.grid(rows);
  }
  for (const sy of [-1, 1]) { // chants le long de l'onde
    const rows = [1, -1].map((side) => Array.from({ length: nx + 1 }, (_, i) => { const x = -a + (2 * a * i) / nx; return B.vert([x, sy * a, zf(x) + (side * t) / 2], [0, sy, 0], EDGE); }));
    B.grid(rows);
  }
  for (const sx of [-1, 1]) {
    const rows = [1, -1].map((side) => Array.from({ length: ny + 1 }, (_, j) => B.vert([sx * a, -a + (2 * a * j) / ny, zf(sx * a) + (side * t) / 2], [sx, 0, 0], EDGE)));
    B.grid(rows);
  }
}

// barre droite (boîte arrondie) entre deux points du plan du panneau
function bar(B, p0, p1, w, h, z = 0) {
  const keep = B.xf, d = sub(p1, p0), L = Math.hypot(d[0], d[1]);
  if (L < 1e-4) return;
  const dx = d[0] / L, dy = d[1] / L, c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const X = add(mul(keep.X, dx), mul(keep.Y, dy)), Y = add(mul(keep.X, -dy), mul(keep.Y, dx));
  B.xf = { o: add(keep.o, add(add(mul(keep.X, c[0]), mul(keep.Y, c[1])), mul(keep.Z, z))), X, Y, Z: keep.Z };
  roundedBox(B, [0, 0, 0], [L / 2, w, h], Math.min(w, h) * 0.45, 10, EDGE, OUT, [1, 0, 0]);
  B.xf = keep;
}
// segment de la droite {p : p·n = c} contenu dans le carré [-a, a]²
function clipLine(n, c, a) {
  const pts = [];
  const d = [-n[1], n[0]];
  for (const [k, s] of [[0, -a], [0, a], [1, -a], [1, a]]) {
    if (abs(n[k]) < 1e-9) continue;
    // point de la droite avec coordonnée k = s
    const o = 1 - k, v = (c - n[k] * s) / (abs(n[o]) < 1e-9 ? 1 : n[o]);
    const p = k === 0 ? [s, abs(n[1]) < 1e-9 ? 0 : v] : [abs(n[0]) < 1e-9 ? 0 : v, s];
    if (abs(p[0]) <= a + 1e-6 && abs(p[1]) <= a + 1e-6) pts.push(p);
  }
  if (pts.length < 2) return null;
  pts.sort((p, q) => dot([...p, 0], [...d, 0]) - dot([...q, 0], [...d, 0]));
  return [pts[0], pts[pts.length - 1]];
}

// Vitrail : verre (maillage du verre) serti dans un réseau de plombs (losanges
// ou grille) ; les plombs ont la finition des panneaux
function leaded(B, G, a, t, P) {
  plate(G, a, t);
  const n = P.n, w = Math.max(0.006, a * 0.012), h = t / 2 + 0.004;
  const fams = P.pattern === 'grid' ? [[1, 0], [0, 1]] : [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
  const span = P.pattern === 'grid' ? a : a * Math.SQRT2;
  for (const nn of fams) for (let i = 1; i < (P.pattern === 'grid' ? n : 2 * n); i++) {
    const c = -span + (2 * span * i) / (P.pattern === 'grid' ? n : 2 * n);
    const seg = clipLine(nn, c, a);
    if (seg) bar(B, seg[0], seg[1], w, h);
  }
}

// Barreaux : joncs ronds parallèles, une traverse plate au milieu
function bars(B, a, P, rng) {
  const n = P.n, pitch = (2 * a) / n, r = Math.min(pitch * 0.2, 0.022);
  for (let i = 0; i < n; i++) {
    B.piece = rng.int(0, 255);
    const x = -a + pitch * (i + 0.5), pts = [];
    for (let k = 0; k <= 24; k++) pts.push([x, -a + (2 * a * k) / 24, 0]);
    tube(B, pts, r, 12, OUT, false);
  }
  if (P.cross) { B.piece = rng.int(0, 255); bar(B, [-a, 0], [a, 0], r * 1.6, r * 1.3); }
}

// Cible : anneaux plats concentriques tenus par une croix
function target(B, a, t, P, rng) {
  const n = P.n, keep = B.xf;
  for (let i = 0; i < n; i++) {
    B.piece = rng.int(0, 255);
    const r1 = a * (0.98 - (i / n) * 0.9), r0 = r1 - (a * 0.9) / n * P.fill;
    if (r0 <= 0.01) continue;
    lathe(B, sharpProfile([[r0, -t / 2], [r1, -t / 2], [r1, t / 2], [r0, t / 2]], [IN, EDGE, OUT, EDGE]), 96);
  }
  B.xf = keep;
  B.piece = rng.int(0, 255);
  bar(B, [-a, 0], [a, 0], t * 0.6, t * 0.6);
  bar(B, [0, -a], [0, a], t * 0.6, t * 0.6);
}

// Panneaux d'une cellule : { panel, glass } (deux maillages : le verre a son
// propre matériau)
export function buildPanels(cell, f) {
  const P = new Buffers(1 << 15), G = new Buffers(1 << 12), rng = createRng(`panels:${cell.seed}`);
  for (let face = 0; face < 6; face++) {
    const kind = cell.faces[face];
    if (kind === 'open') continue;
    const t = kind === 'glass' || kind === 'leaded' ? cell.glassT : cell.panelT;
    const seat = panelSeat(f, t), F = faceFrame(face, seat.plane), a = seat.ext;
    const B = kind === 'glass' ? G : P;
    if (kind === 'leaded') { G.frame(F.o, F.X, F.Y, F.Z); G.anchor = F.o; G.patOff = [face, 0, 0]; }
    B.frame(F.o, F.X, F.Y, F.Z);
    B.piece = rng.int(0, 255);
    B.patOff = [rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)];
    B.anchor = F.o;
    if (kind === 'plate' || kind === 'glass') plate(B, a, t);
    else if (kind === 'perf') perforated(B, a, t, cell.perf, rng);
    else if (kind === 'louvre') { B.noFrame(); B.xf = F; louvres(B, f, a, t, cell.louvre, rng); }
    else if (kind === 'grid') woven(B, a, cell.grid, rng);
    else if (kind === 'stud') studded(B, a, t, cell.stud, rng);
    else if (kind === 'corrugated') { const keep = B.xf; if (face & 1) B.xf = { ...keep, X: keep.Y, Y: mul(keep.X, -1) }; corrugated(B, a, t, cell.corr); B.xf = keep; }
    else if (kind === 'leaded') { leaded(B, G, a, t, cell.leaded); G.noFrame(); }
    else if (kind === 'bars') bars(B, a, cell.bars, rng);
    else if (kind === 'target') target(B, a, t, cell.target, rng);
    B.noFrame();
  }
  return { panel: P.n ? P.out() : null, glass: G.n ? G.out() : null };
}

// ── Objet exposé au centre de la cellule ─────────────────────────────────────
export function buildContent(c) {
  const B = new Buffers(1 << 13), s = c.size;
  switch (c.type) {
    case 'pearl': sphere(B, [0, 0, 0], s, 64, 32, OUT); break;
    case 'gem': gem(B, [0, 0, 0], s, OUT); break;
    case 'rings': { // gyroscope : trois anneaux emboîtés
      const R = [s, s * 0.82, s * 0.64];
      const frames = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]]];
      R.forEach((r, i) => {
        B.piece = i * 80;
        const [X, Y, Z] = frames[i];
        B.frame([0, 0, 0], X, Y, Z);
        torus(B, [0, 0, 0], r, s * 0.045, 96, 14, i === 1 ? EDGE : OUT);
      });
      B.noFrame();
      sphere(B, [0, 0, 0], s * 0.22, 32, 16, EDGE);
      break;
    }
    case 'cube': roundedBox(B, [0, 0, 0], [s * 0.72, s * 0.72, s * 0.72], s * 0.16, 8, EDGE, OUT); break;
    case 'saturn': {
      sphere(B, [0, 0, 0], s * 0.62, 48, 24, OUT);
      B.frame([0, 0, 0], [1, 0, 0], [0, 0.94, 0.34], [0, -0.34, 0.94]);
      torus(B, [0, 0, 0], s, s * 0.035, 96, 10, EDGE);
      torus(B, [0, 0, 0], s * 0.86, s * 0.02, 96, 8, EDGE);
      B.noFrame();
      break;
    }
    case 'mini': { // mise en abyme : un petit cube d'ossature
      const e = s * 0.8, r = s * 0.06;
      for (let a = 0; a < 3; a++) for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
        const b = (a + 1) % 3, cc = (a + 2) % 3, pts = [];
        for (let k = 0; k <= 12; k++) { const p = [0, 0, 0]; p[a] = -e + (2 * e * k) / 12; p[b] = sb * e; p[cc] = sc * e; pts.push(p); }
        tube(B, pts, r, 10, OUT, false);
      }
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) sphere(B, [x * e, y * e, z * e], r * 1.9, 16, 10, EDGE);
      break;
    }
    case 'knot': { // nœud de trèfle : tube le long de la courbe (p, q) = (2, 3)
      const pts = [];
      for (let k = 0; k <= 360; k++) {
        const u = (2 * PI * k) / 360, r = cos(3 * u) + 2;
        pts.push([r * cos(2 * u) * s * 0.3, r * sin(2 * u) * s * 0.3, -sin(3 * u) * s * 0.3]);
      }
      tube(B, pts, s * 0.11, 24, OUT, false);
      break;
    }
    case 'ico': polyhedron(B, icosahedron().V, icosahedron().F, s * 0.85, OUT); break;
    case 'dodeca': { const D = dodecahedron(); polyhedron(B, D.V, D.F, s * 0.85, OUT); break; }
    case 'stack': { // pile de jetons, légèrement décalés
      const n = 7, h = s * 0.12, r = s * 0.62;
      for (let i = 0; i < n; i++) {
        B.piece = i * 36;
        const z = -((n - 1) * h) / 2 + i * h, ox = 0.03 * s * sin(i * 2.1), oy = 0.03 * s * cos(i * 1.7);
        const rr = r * (1 - 0.03 * (i % 3)), e = h * 0.18;
        B.frame([ox, oy, z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        lathe(B, [
          { r: 0, z: -h / 2 + 0.002, nr: 0, nz: -1, s: IN }, { r: rr - e, z: -h / 2 + 0.002, nr: 0, nz: -1, s: IN },
          { r: rr - e, z: -h / 2 + 0.002, nr: 0.5, nz: -0.86, s: EDGE }, { r: rr, z: -h / 2 + e, nr: 1, nz: 0, s: EDGE },
          { r: rr, z: h / 2 - e, nr: 1, nz: 0, s: EDGE }, { r: rr - e, z: h / 2 - 0.002, nr: 0.5, nz: 0.86, s: EDGE },
          { r: rr - e, z: h / 2 - 0.002, nr: 0, nz: 1, s: OUT }, { r: 0, z: h / 2 - 0.002, nr: 0, nz: 1, s: OUT },
        ], 64);
      }
      B.noFrame();
      break;
    }
    default: return null;
  }
  return B.out();
}
