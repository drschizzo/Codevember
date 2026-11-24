// La géométrie de la ferraille : chaque pièce est une section (profilé réel, à
// ses cotes) balayée le long de son axe, droit ou cintré (Bézier quadratique
// dont la flèche au milieu vaut P.bend.s), avec un écrasement éventuel près
// d'un bout (tube aplati : section ovalisée). Bouts coupés droit (rôle EDGE :
// métal à nu), chanfreins (EDGE), faces (OUT), soudure (IN).
//
// Les mêmes fonctions servent au peuplement (pieces.js : surface réelle de la
// mère pour poser une soudure) et au maillage : ce que teste le test est ce
// que montre l'écran.
// Module pur (Node, worker).
import { Buffers, roundedBox, OUT, IN, EDGE } from '../../../shared/gen/mesh.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Repère d'une pièce : X le long de l'axe, (Y, Z) la section, tournée de roll.
export function pieceFrame(P) {
  const X = norm(sub(P.p1, P.p0));
  const a = Math.abs(X[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const Y0 = norm(cross(X, a)), Z0 = cross(X, Y0), t = P.roll;
  const Y = [0, 1, 2].map((i) => Y0[i] * Math.cos(t) + Z0[i] * Math.sin(t));
  return { X, Y, Z: cross(X, Y) };
}

// Point de l'axe (cintré) au paramètre t ∈ [0, 1].
export function axisAt(P, t) {
  if (!P.bend || !P.bend.s) return add(P.p0, mul(sub(P.p1, P.p0), t));
  const { Y, Z } = pieceFrame(P);
  const d = add(mul(Y, Math.cos(P.bend.dir)), mul(Z, Math.sin(P.bend.dir)));
  const C = add(mul(add(P.p0, P.p1), 0.5), mul(d, 2 * P.bend.s));
  const u = 1 - t;
  return add(add(mul(P.p0, u * u), mul(C, 2 * u * t)), mul(P.p1, t * t));
}

// Écrasement (ovalisation) au paramètre t : 0 sauf près du bout écrasé.
export function crushAt(P, t) {
  if (!P.crush) return 0;
  const x = P.crush.end ? t : 1 - t; // distance au bout écrasé : 1 − x
  return P.crush.c * Math.min(1, Math.max(0, (x - 0.78) / 0.22)) ** 1.5;
}

// Échelle de la section au paramètre t : la branche de bois flotté s'amincit
// (−28 % vers le bout libre) et l'a usé en dôme sur ~0,7 r. 1 ailleurs.
export function sectionScale(P, t) {
  if (!P.taper) return 1;
  const L = Math.hypot(P.p1[0] - P.p0[0], P.p1[1] - P.p0[1], P.p1[2] - P.p0[2]);
  const dome = P.kind === 'rond' ? Math.min(0.45, (0.7 * P.r) / L) : 0;
  let k = 1 - 0.28 * t;
  // renflements et étranglements (nœuds, usure inégale) : la section ne dépasse jamais r
  const x = t * L / P.r;
  k *= 0.9 + 0.05 * Math.sin(x * 0.9 + P.roll * 7) + 0.05 * Math.sin(x * 2.3 + P.roll * 13);
  if (dome && t > 1 - dome) { const x = (t - (1 - dome)) / dome; k *= Math.sqrt(Math.max(0, 1 - x * x)) * 0.92 + 0.08; }
  return k;
}

// Relief d'une branche de bois flotté : creux relatif g(θ, t) ∈ [0, 0,32] du
// rayon (le rayon vaut r · (1 − g) · échelle). Sillons entre 13 veines qui
// serpentent, une ou deux fentes, un ou deux nœuds en creux ; tirés de P.roll.
export function woodRelief(P, L) {
  const h = (k) => { const x = Math.sin(k * 127.1 + P.roll * 311.7) * 43758.5453; return x - Math.floor(x); };
  const cracks = [0, 1].map((i) => ({ th: h(i + 1) * 2 * Math.PI, t0: h(i + 3) * 0.5, t1: 0.5 + h(i + 5) * 0.5, on: i === 0 || h(i + 7) < 0.5 }));
  const knots = [0, 1].map((i) => ({ th: h(i + 11) * 2 * Math.PI, t: 0.15 + 0.7 * h(i + 13), on: i === 0 || h(i + 17) < 0.6 }));
  const angd = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
  return (th, t) => {
    const w = 1.8 * Math.sin(t * L * 4 + P.roll * 5) + 0.8 * Math.sin(t * L * 11 + P.roll * 2);
    const ridge = 0.5 + 0.5 * Math.sin(th * 13 + w);
    let g = 0.07 * (1 - ridge) ** 2; // sillon entre deux veines
    for (const c of cracks) if (c.on && t > c.t0 && t < c.t1) g += 0.2 * Math.exp(-((angd(th, c.th) / 0.06) ** 2)) * Math.sin(Math.PI * (t - c.t0) / (c.t1 - c.t0));
    for (const k of knots) if (k.on) { const u = (t - k.t) * L / (1.1 * P.r), v = angd(th, k.th) / 0.55; g += 0.14 * Math.exp(-(u * u + v * v)); }
    return Math.min(0.32, g);
  };
}

// Section dans le plan (Y, Z) en multiples de r : contours fermés de points
// [y, z, rôle de la face qui suit] ; smooth : normales lissées (rond).
const SECTIONS = new Map();
export function section(kind, nr = 16) {
  const k = `${kind}:${nr}`;
  let S = SECTIONS.get(k);
  if (!S) SECTIONS.set(k, (S = makeSection(kind, nr)));
  return S;
}
function makeSection(kind, nr) {
  const circle = (R) => Array.from({ length: nr }, (_, i) => { const a = (2 * Math.PI * i) / nr; return [R * Math.cos(a), R * Math.sin(a), OUT]; });
  const ch = (pts, c) => { // chanfreins aux coins (rôle EDGE)
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
      const da = norm([a[0] - p[0], a[1] - p[1], 0]), db = norm([b[0] - p[0], b[1] - p[1], 0]);
      out.push([p[0] + da[0] * c, p[1] + da[1] * c, EDGE], [p[0] + db[0] * c, p[1] + db[1] * c, OUT]);
    }
    return out;
  };
  switch (kind) {
    case 'rond': return { loops: [circle(1)], smooth: true, center: [0, 0] };
    case 'tube': return { loops: [circle(1), circle(0.8).reverse()], smooth: true, center: [0, 0], hollow: true };
    case 'carre': return { loops: [ch([[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.1)], center: [0, 0] };
    case 'plat': return { loops: [ch([[-1.5, -0.5], [1.5, -0.5], [1.5, 0.5], [-1.5, 0.5]], 0.07)], center: [0, 0] };
    case 'corniere': {
      const o = -0.6, e = 0.28;
      return { loops: [ch([[o, o], [o + 2, o], [o + 2, o + e], [o + e, o + e], [o + e, o + 2], [o, o + 2]], 0.05)], center: [o + e / 2, o + e / 2] };
    }
    default: throw new Error(`profilé inconnu : ${kind}`);
  }
}

// Étendue de la section dans la direction n (support), en mètres.
export function supportAt(P, n, t = 0.5) {
  const { Y, Z } = pieceFrame(P);
  const ny = dot(n, Y), nz = dot(n, Z), c = crushAt(P, t);
  const S = section(P.kind, 12);
  let m = 0;
  for (const [y, z] of S.loops[0]) m = Math.max(m, y * (1 + c) * ny + z * (1 - c) * nz);
  return m * P.r * sectionScale(P, t);
}

// Maillage de toutes les pièces.
// accord : profilés et jonctions propres à la matière (pieces.js, ACCORDS) ;
// le bois flotté s'amincit vers son bout libre et l'a usé en dôme, sans soudure.
export function forgeMesh(pieces, rnd, accord = 'rouille', joint = 'soudure') {

  const B = new Buffers(1 << 16);
  const ranges = [];
  for (const [pi, P] of pieces.entries()) {
    const n0 = B.n;
    B.piece = Math.floor(rnd() * 256);
    const wood = P.taper && P.kind === 'rond';
    const S = section(P.kind, wood ? (P.r > 0.03 ? 40 : 28) : P.r > 0.03 ? 22 : 14);
    const L = Math.hypot(...sub(P.p1, P.p0));
    const nSeg = wood ? Math.max(8, Math.ceil(L / 0.012)) : P.bend?.s || P.crush || P.taper ? Math.max(6, Math.ceil(L / 0.04)) : 1;
    // paramètres des rangées : réguliers, plus serrés près d'un bout usé en dôme
    const ts = Array.from({ length: nSeg + 1 }, (_, k) => k / nSeg);
    const dome = P.taper && P.kind === 'rond' ? Math.min(0.45, (0.7 * P.r) / L) : 0;
    if (dome) { for (let k = 1; k <= 5; k++) ts.push(1 - dome * (1 - Math.sin((k / 6) * Math.PI / 2))); ts.sort((a, b) => a - b); }
    const scaleAt = (t) => sectionScale(P, t);
    const F0 = pieceFrame(P);
    const rows = [];
    let Y = F0.Y;
    for (const t of ts) {
      const c = axisAt(P, t);
      const T = norm(sub(axisAt(P, Math.min(1, t + 1e-3)), axisAt(P, Math.max(0, t - 1e-3))));
      Y = norm(sub(Y, mul(T, dot(Y, T))));
      rows.push({ c, T, Y, Z: cross(T, Y), cr: crushAt(P, t), sc: scaleAt(t) });
    }
    const at = (row, y, z) => add(add(row.c, mul(row.Y, y * (1 + row.cr) * P.r * row.sc)), mul(row.Z, z * (1 - row.cr) * P.r * row.sc));
    const nrmAt = (row, ny, nz) => norm(add(mul(row.Y, ny / (1 + row.cr)), mul(row.Z, nz / (1 - row.cr))));
    for (const [li, loop] of S.loops.entries()) {
      const inner = S.hollow && li === 1;
      const M = loop.length;
      if (wood && !inner) {
        // bois flotté : le relief est dans la géométrie (le fil peint disparaît à
        // distance). Sillons entre les veines dures, qui serpentent le long de la
        // branche ; une ou deux fentes profondes ; un ou deux nœuds en creux. Le
        // rayon ne dépasse jamais la section nominale (les contacts restent justes).
        // La profondeur du creux va dans le canal y de surf : le shader fonce les creux.
        const relief = woodRelief(P, L);
        const M2 = loop.length, R = rows.length;
        const pos = rows.map((row, k) => loop.map(([y, z]) => {
          const th = Math.atan2(z, y), g = relief(th, ts[k]);
          return { p: at(row, y * (1 - g), z * (1 - g)), g };
        }));
        const grid = rows.map((row, k) => loop.map((_, i) => {
          // normale de la surface déformée : différences centrées sur la grille
          const a = pos[k][(i + 1) % M2].p, b = pos[k][(i - 1 + M2) % M2].p;
          const c = pos[Math.min(R - 1, k + 1)][i].p, d = pos[Math.max(0, k - 1)][i].p;
          let n = norm(cross(sub(a, b), sub(c, d)));
          const radial = nrmAt(row, loop[i][0], loop[i][1]);
          if (dot(n, radial) < 0) n = mul(n, -1);
          return B.vert(pos[k][i].p, n, [255, Math.round(255 * Math.min(1, pos[k][i].g / 0.2)), 0], row.T);
        }));
        B.grid(grid, true);
      } else if (S.smooth) {
        const grid = rows.map((row) => loop.map(([y, z]) => {
          const n = inner ? [-y, -z] : [y, z];
          return B.vert(at(row, y, z), nrmAt(row, n[0], n[1]), OUT, row.T);
        }));
        B.grid(grid, true);
      } else {
        // une bande par côté (normales plates) : arêtes vives, chanfreins en EDGE
        for (let i = 0; i < M; i++) {
          const a = loop[i], b = loop[(i + 1) % M];
          const n = [b[1] - a[1], -(b[0] - a[0])]; // normale sortante (contour dans le sens direct)
          const strip = rows.map((row) => [a, b].map((q) => B.vert(at(row, q[0], q[1]), nrmAt(row, n[0], n[1]), a[2], row.T)));
          B.grid(strip);
        }
      }
    }
    // bouts coupés : disque, polygone (éventail depuis le centre) ou anneau
    for (const [k, sgn] of [[0, -1], [rows.length - 1, 1]]) {
      const row = rows[k], nn = mul(row.T, sgn);
      if (S.hollow) {
        const o = S.loops[0], i = S.loops[1].slice().reverse();
        const A = o.map(([y, z]) => B.vert(at(row, y, z), nn, EDGE)), C = i.map(([y, z]) => B.vert(at(row, y, z), nn, EDGE));
        B.grid([A, C], true);
      } else {
        const ctr = B.vert(at(row, S.center[0], S.center[1]), nn, EDGE);
        const ring = S.loops[0].map(([y, z]) => B.vert(at(row, y, z), nn, EDGE));
        for (let j = 0; j < ring.length; j++) B.tri(ctr, ring[j], ring[(j + 1) % ring.length]);
      }
    }
    // la soudure : un cordon bombé à la jonction, sur le flanc de la mère
    if (P.parent >= 0 && joint !== 'aucun') {
      const row = rows[0], w = P.r * (P.kind === 'plat' ? 1.6 : P.kind === 'corniere' ? 1.5 : 1.15);
      B.frame(row.c, row.T, row.Y, row.Z);
      roundedBox(B, [P.r * 0.1, P.kind === 'corniere' ? 0.4 * P.r : 0, P.kind === 'corniere' ? 0.4 * P.r : 0], [P.r * 0.32, w, P.kind === 'plat' ? 0.7 * P.r : w], P.r * 0.4, 3, IN, IN, [1, 0, 0]);
      B.noFrame();
    }
    ranges.push([n0, B.n, pi]);
  }
  // pc : pour chaque sommet, le milieu de l'axe de sa pièce (à sa place) et son
  // numéro (la scène y lit la pose de la pièce : src/gen/assembly.js)
  const out = B.out();
  const pc = new Float32Array(out.position.length / 3 * 4);
  for (const [n0, n1, pi] of ranges) {
    const P = pieces[pi], c = [(P.p0[0] + P.p1[0]) / 2, (P.p0[1] + P.p1[1]) / 2, (P.p0[2] + P.p1[2]) / 2];
    for (let v = n0; v < n1; v++) { pc[v * 4] = c[0]; pc[v * 4 + 1] = c[1]; pc[v * 4 + 2] = c[2]; pc[v * 4 + 3] = pi; }
  }
  out.pc = pc;
  return out;
}
