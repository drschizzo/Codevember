// Géométrie d'une cellule (un cube du tesseract), dans ses coordonnées
// locales [-1, 1]³ : l'ossature (barres profilées et nœuds d'angle), les
// panneaux des six faces (plaque, verre, tôle perforée, persiennes, grille
// tissée) et l'objet exposé au centre. Le vertex shader l'emmène ensuite en
// 4D puis la projette (voir scene/project.js) : toutes les surfaces sont
// subdivisées, pour que la projection gonflée puisse les courber.

import {
  Buffers, OUT, IN, EDGE, sweep, polyProfile, arcProfile, roundedBox, sphere, torus, tube, gem,
  add, mul, norm, cross, PI, cos, sin, abs,
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
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      B.piece = rng.int(0, 255);
      const o = add(sgnv(AX[b], sb * e), sgnv(AX[c], sc * e));
      // les barres entrent dans les nœuds ; sans nœud, elles vont jusqu'au bout
      // et se recouvrent à l'angle (assemblage à plat)
      const t1 = nh > 0 ? e - nh * 0.6 : 1;
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
  if (nh > 0) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    B.piece = rng.int(0, 255);
    const c = [sx * e, sy * e, sz * e];
    if (f.node === 'sphere') sphere(B, c, nh, 28, 16, OUT);
    else roundedBox(B, c, [nh, nh, nh], nh * (f.node === 'knob' ? 0.55 : 0.22), 4, EDGE, OUT);
  }
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

// Tôle perforée : n × n carreaux, chacun percé d'un trou (superellipse
// d'exposant ex, tournée de rot) dont la taille suit un motif ; arêtes du trou
// chanfreinées (facettes polies). Les carreaux voisins partagent exactement
// les mêmes points le long de leur bord commun.
function perforated(B, a, t, P, rng) {
  const n = P.n, q = a / n, M = 24, ch = Math.min(t * 0.32, q * 0.12);
  const ex = P.shape === 'square' ? 5 : P.shape === 'diamond' ? 1.25 : P.shape === 'cross' ? 0.8 : 2;
  const rot = P.shape === 'diamond' ? 0 : P.shape === 'cross' ? PI / 4 : P.twist || 0;
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
    const r = holeR(cx, cy, i, j) * q * (P.shape === 'cross' ? 1.05 : 0.92);
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
    // bord du trou (superellipse) et sa normale 2D (vers la matière)
    const hole = (rr) => (th) => {
      const u = th - rot, cu = cos(u), su = sin(u);
      const rho = rr / Math.pow(Math.pow(abs(cu), ex) + Math.pow(abs(su), ex), 1 / ex);
      return [rho * cos(th), rho * sin(th)];
    };
    const holeN = (th) => {
      const u = th - rot, cu = cos(u), su = sin(u);
      const gx = Math.sign(cu) * Math.pow(Math.max(abs(cu), 1e-3), ex - 1), gy = Math.sign(su) * Math.pow(Math.max(abs(su), 1e-3), ex - 1);
      const l = Math.hypot(gx, gy) || 1, gxr = gx / l, gyr = gy / l;
      return [gxr * cos(rot) - gyr * sin(rot), gxr * sin(rot) + gyr * cos(rot)];
    };
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

// Panneaux d'une cellule : { panel, glass } (deux maillages : le verre a son
// propre matériau)
export function buildPanels(cell, f) {
  const P = new Buffers(1 << 15), G = new Buffers(1 << 12), rng = createRng(`panels:${cell.seed}`);
  for (let face = 0; face < 6; face++) {
    const kind = cell.faces[face];
    if (kind === 'open') continue;
    const t = kind === 'glass' ? cell.glassT : cell.panelT;
    const seat = panelSeat(f, t), F = faceFrame(face, seat.plane), a = seat.ext;
    const B = kind === 'glass' ? G : P;
    B.frame(F.o, F.X, F.Y, F.Z);
    B.piece = rng.int(0, 255);
    B.patOff = [rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3)];
    B.anchor = F.o;
    if (kind === 'plate' || kind === 'glass') plate(B, a, t);
    else if (kind === 'perf') perforated(B, a, t, cell.perf, rng);
    else if (kind === 'louvre') { B.noFrame(); B.xf = F; louvres(B, f, a, t, cell.louvre, rng); }
    else if (kind === 'grid') woven(B, a, cell.grid, rng);
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
    default: return null;
  }
  return B.out();
}
