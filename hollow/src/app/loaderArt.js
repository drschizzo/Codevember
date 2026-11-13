// Hollow — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// La plongée elle-même, au trait : les coquilles emboîtées vues à travers
// leurs oculus, en vraie perspective (une coquille de profondeur x a pour
// rayon kˣ, la caméra est à la distance 1 ; on ne voit d'elle que la calotte
// tournée vers nous, et par son oculus la suivante, puis l'intérieur de sa
// propre paroi). Le dessin de chaque couche est celui de la scène : les
// pavages (alvéoles de Goldberg, Voronoï, fentes, moucharabieh) sont calculés
// ici par les mêmes fonctions que les workers de génération, avec la même
// graine ; les autres types ont leur épure (anneaux de la sphère armillaire,
// écailles en phyllotaxie, rubans dessus-dessous, isolignes de la surface
// minimale). Le corail de Turing, trop long à simuler ici, est esquissé par
// les isolignes d'un bruit.
//
// Avant la recette : le tunnel vide, rien que les bords des oculus autour du
// cœur. Pendant la génération : chaque couche se trace depuis son oculus vers
// l'extérieur, au rythme de ses niveaux de détail qui arrivent. Pendant la
// préparation de la lumière : le cœur s'allume, l'intérieur des parois prend
// sa couleur, les bords d'oculus s'éclairent. À la fin : on file à travers
// l'oculus suivant en s'effaçant. La plongée ne s'arrête jamais (avec la
// respiration des passages de la scène).
import { createRng, createNoise3 } from '../../../shared/rng.js';
import { goldbergCells, slotCells, voronoiCells, norm, dot, tangentFrame } from '../gen/cells.js';
import { girihCells } from '../gen/girih.js';
import { tpmsField } from '../gen/tpms.js';

const { sin, cos, sqrt, PI, acos, min, max, log, abs, floor, ceil } = Math;
const TAU = PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rgb = (h) => { const n = parseInt(String(h || '#888888').slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${max(0, min(1, a)).toFixed(3)})`;
// une teinte de matériau, ramenée à une encre claire (le carbone ou l'acier noirci restent lisibles)
const ink = (h) => { const c = rgb(h), m = max(1, ...c); return mix([236, 230, 220], c.map((v) => (v / m) * 245), 0.45); };

// ── Épures : des tracés sur la sphère unité (oculus sur +z) ──────────────────
// pts : sommets (x, y, z) ; start / len : un tracé ; round : arrondi des
// angles (tracés fermés), < 0 : tracé ouvert ; cen : direction moyenne.
// Les tracés sont triés depuis l'oculus vers le bas : l'ordre du dessin.
function builder() {
  const polys = [];
  return {
    poly(P, round = 0) { if (P.length >= 2) polys.push({ P, round }); },
    done() {
      const items = polys.map((o) => {
        let x = 0, y = 0, z = 0;
        for (const p of o.P) { x += p[0]; y += p[1]; z += p[2]; }
        const c = norm([x, y, z]);
        return { ...o, c, th: acos(max(-1, min(1, c[2]))) };
      }).sort((a, b) => a.th - b.th);
      let np = 0;
      for (const o of items) np += o.P.length;
      const pts = new Float32Array(np * 3), start = new Int32Array(items.length), len = new Int32Array(items.length);
      const round = new Float32Array(items.length), cen = new Float32Array(items.length * 3);
      let k = 0;
      items.forEach((o, i) => {
        start[i] = k; len[i] = o.P.length; round[i] = o.round;
        cen.set(o.c, i * 3);
        for (const p of o.P) { pts[k * 3] = p[0]; pts[k * 3 + 1] = p[1]; pts[k * 3 + 2] = p[2]; k++; }
      });
      return { pts, start, len, round, cen, n: items.length };
    },
  };
}

// un cercle d'axe `axis` à l'angle β (points, fermé)
function ring(axis, beta, n = 72, from = 0, to = TAU) {
  const [e1, e2] = tangentFrame(axis), cb = cos(beta), sb = sin(beta), P = [];
  const closed = to - from >= TAU - 1e-6, m = closed ? n : n + 1;
  for (let i = 0; i < m; i++) {
    const a = from + ((to - from) * i) / n;
    P.push([axis[0] * cb + (e1[0] * cos(a) + e2[0] * sin(a)) * sb, axis[1] * cb + (e1[1] * cos(a) + e2[1] * sin(a)) * sb, axis[2] * cb + (e1[2] * cos(a) + e2[2] * sin(a)) * sb]);
  }
  return P;
}
const Z = [0, 0, 1];

// pavages percés : le contour de chaque trou (cellule rétrécie de la demi-largeur du barreau)
const TILE = {
  cells: (g, rng) => goldbergCells(g, rng),
  voronoi: (g, rng) => voronoiCells(g, rng),
  slots: (g) => slotCells(g),
  girih: (g, rng) => girihCells(goldbergCells(g, rng), g),
};
function tiling(g) {
  const cells = TILE[g.type](g, createRng(g.seed));
  const B = builder(), bar = g.bar ?? 0.03, closed = g.closed ?? 0, hash = createRng(`${g.seed}:closed`);
  for (const c of cells) {
    if (c.portal || c.cap) continue;
    if (closed > 0 && hash.next() < closed * 0.6) continue; // (cellules pleines)
    const P = c.pts, n = P.length;
    let rin = 0, w = 0;
    for (let k = 0; k < n; k++) {
      const m = norm([P[k][0] + P[(k + 1) % n][0], P[k][1] + P[(k + 1) % n][1], P[k][2] + P[(k + 1) % n][2]]);
      rin += acos(max(-1, min(1, dot(m, c.c)))); w += c.ins?.[k] ?? 1;
    }
    rin /= n; w /= n;
    const s = 1 - (bar * 0.5 * w) / max(1e-4, rin);
    if (s < 0.22) continue;
    B.poly(P.map((p) => norm([c.c[0] + (p[0] - c.c[0]) * s, c.c[1] + (p[1] - c.c[1]) * s, c.c[2] + (p[2] - c.c[2]) * s])), 0.5 * (g.round ?? 0.5));
  }
  return B.done();
}

// sphère armillaire : lunette, anneau austral, méridiens, équateur, tropiques, écliptiques
function armillary(g) {
  const B = builder(), w = g.width ?? 0.06, wb = w * 1.6, south = PI - (g.south ?? 0.5);
  const band = (axis, beta, width, n = 96) => { B.poly(ring(axis, beta - width / 2, n), -1); B.poly(ring(axis, beta + width / 2, n), -1); };
  band(Z, g.portal + wb / 2, wb, 64);
  band(Z, south, w);
  band(Z, PI / 2, w * 1.2);
  if (g.tropics) { B.poly(ring(Z, PI / 2 - 0.41), -1); B.poly(ring(Z, PI / 2 + 0.41), -1); }
  const rng = createRng(`${g.seed}:armillary`), phase = rng.range(0, PI);
  for (let k = 0; k < (g.meridians ?? 4); k++) {
    const phi = phase + (k / g.meridians) * TAU;
    for (const o of [-0.4, 0.4]) {
      const P = [];
      for (let i = 0; i <= 40; i++) {
        const th = g.portal + wb * 0.9 + ((south - g.portal - wb * 0.9) * i) / 40, ph = phi + (o * w) / max(0.2, sin(th));
        P.push([sin(th) * cos(ph), sin(th) * sin(ph), cos(th)]);
      }
      B.poly(P, -1);
    }
  }
  for (let k = 0; k < (g.ecliptics ?? 1); k++) {
    const a = (k / g.ecliptics) * PI, t = g.tilt ?? 0.5;
    const axis = [sin(t) * cos(a), sin(t) * sin(a), cos(t)];
    band(axis, PI / 2, w);
  }
  return B.done();
}

// écailles : écussons en phyllotaxie, plus petits et plus serrés vers l'oculus (comme gen/scales.js)
function scales(g) {
  const B = builder(), n = g.count ?? 240, GA = PI * (3 - sqrt(5)), apex = g.apex ?? 0.42;
  B.poly(ring(Z, g.portal + 0.025, 64), -1); B.poly(ring(Z, g.portal + 0.05, 64), -1);
  const theta0 = g.portal + 0.075;
  const size = (th) => { const k = clamp01((th - theta0) / 0.95); return apex + (1 - apex) * k * k * (3 - 2 * k); };
  const M = 512, F = new Float64Array(M + 1), TH = (j) => theta0 + ((PI - theta0) * j) / M;
  for (let j = 0; j < M; j++) { const th = (TH(j) + TH(j + 1)) / 2; F[j + 1] = F[j] + (sin(th) / size(th) ** 2) * ((PI - theta0) / M); }
  const total = F[M], spacing = sqrt((TAU * total) / n);
  const thetaOf = (q) => { let lo = 0, hi = M; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F[m] < q) lo = m; else hi = m; } return TH(lo) + ((q - F[lo]) / max(1e-12, F[hi] - F[lo])) * (TH(hi) - TH(lo)); };
  const pt = g.pointed ?? 0.6;
  const shield = [[-0.35, -1], [0.2, -0.95], [0.62, -0.62], [0.9 - 0.1 * pt, -0.22 * (1 - pt)], [1, 0], [0.9 - 0.1 * pt, 0.22 * (1 - pt)], [0.62, 0.62], [0.2, 0.95], [-0.35, 1]];
  for (let i = 0; i < n; i++) {
    const th = thetaOf(((i + 0.5) / n) * total), sz = size(th), ph = i * GA;
    const c = [sin(th) * cos(ph), sin(th) * sin(ph), cos(th)];
    const u = [cos(th) * cos(ph), cos(th) * sin(ph), -sin(th)], v = [-sin(ph), cos(ph), 0];
    const a = spacing * 0.72 * (g.size ?? 1) * sz, b = spacing * 0.52 * (g.size ?? 1) * sz;
    B.poly(shield.map(([p, q]) => norm([c[0] + u[0] * p * a + v[0] * q * b, c[1] + u[1] * p * a + v[1] * q * b, c[2] + u[2] * p * a + v[2] * q * b])), -1);
  }
  return B.done();
}

// vannerie : deux familles de rubans ; chaque brin s'interrompt là où il passe dessous
function weave(g) {
  const B = builder(), n = g.strands ?? 16, D = PI / n, cb = cos(g.bias ?? 0), sb = sin(g.bias ?? 0);
  const X = [cb, sb, 0], Y = [-sb, cb, 0], cap = cos(g.portal + 0.02);
  B.poly(ring(Z, g.portal, 64), -1); B.poly(ring(Z, g.portal + 0.085, 64), -1);
  for (const [axis, other, sg] of [[X, Y, 1], [Y, X, -1]]) {
    for (let i = 0; i < n; i++) {
      const P = ring(axis, (i + 0.5) * D, 120), on = P.map((p) => {
        const lift = sg * (i % 2 ? -1 : 1) * cos((PI * (acos(max(-1, min(1, dot(p, other)))) - D / 2)) / D);
        return lift > -0.72 && p[2] < cap;
      });
      // morceaux visibles (en raccordant la fin au début)
      const k0 = on.indexOf(false);
      if (k0 < 0) { B.poly([...P, P[0]], -1); continue; }
      let run = [];
      for (let s = 1; s <= P.length; s++) {
        const k = (k0 + s) % P.length;
        if (on[k]) run.push(P[k]); else { if (run.length > 1) B.poly(run, -1); run = []; }
      }
      if (run.length > 1) B.poly(run, -1);
    }
  }
  return B.done();
}

// isolignes d'un champ sur la sphère (carrés marchants en θ, φ, tracés chaînés)
function contour(fn, th0, nt = 64, np = 128) {
  const B = builder(), th = (i) => th0 + ((PI - 0.02 - th0) * i) / nt, ph = (j) => (TAU * j) / np;
  const V = new Float32Array((nt + 1) * np);
  for (let i = 0; i <= nt; i++) for (let j = 0; j < np; j++) {
    const t = th(i), p = ph(j);
    V[i * np + j] = fn(sin(t) * cos(p), sin(t) * sin(p), cos(t));
  }
  const v = (i, j) => V[i * np + ((j + np) % np)];
  const H = (i, j) => i * np + ((j + np) % np), Vt = (i, j) => (nt + 1) * np + i * np + ((j + np) % np);
  const where = new Map(), adj = new Map();
  const point = (id) => {
    if (where.has(id)) return;
    let a, b, t, p0, p1, q0, q1;
    if (id < (nt + 1) * np) { const i = floor(id / np), j = id % np; a = v(i, j); b = v(i, j + 1); t = a / (a - b); p0 = th(i); p1 = p0; q0 = ph(j); q1 = ph(j + 1); }
    else { const k = id - (nt + 1) * np, i = floor(k / np), j = k % np; a = v(i, j); b = v(i + 1, j); t = a / (a - b); p0 = th(i); p1 = th(i + 1); q0 = ph(j); q1 = q0; }
    const T = p0 + (p1 - p0) * t, P = q0 + (q1 - q0) * t;
    where.set(id, [sin(T) * cos(P), sin(T) * sin(P), cos(T)]);
  };
  const link = (a, b) => {
    point(a); point(b);
    (adj.get(a) ?? adj.set(a, []).get(a)).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)).push(a);
  };
  for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
    const c = [v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)], e = [H(i, j), Vt(i, j + 1), H(i + 1, j), Vt(i, j)];
    const cut = [];
    for (let k = 0; k < 4; k++) if ((c[k] < 0) !== (c[(k + 1) % 4] < 0)) cut.push(e[k]);
    if (cut.length === 2) link(cut[0], cut[1]);
    else if (cut.length === 4) {
      const mid = (c[0] + c[1] + c[2] + c[3]) / 4;
      if ((mid < 0) === (c[0] < 0)) { link(cut[0], cut[3]); link(cut[1], cut[2]); } else { link(cut[0], cut[1]); link(cut[2], cut[3]); }
    }
  }
  // chaînage : d'abord les bouts libres, puis les boucles (coupées en morceaux d'au plus 48 points)
  const used = new Set();
  const walk = (s) => {
    let P = [where.get(s)], prev = -1, cur = s;
    used.add(s);
    for (;;) {
      const nx = (adj.get(cur) || []).find((q) => q !== prev && !used.has(q));
      if (nx === undefined) break;
      used.add(nx); P.push(where.get(nx)); prev = cur; cur = nx;
      if (P.length >= 48) { B.poly(P, -1); P = [where.get(nx)]; }
    }
    const first = (adj.get(s) || []).find((q) => q === cur);
    if (first !== undefined && P.length > 2) P.push(where.get(s));
    if (P.length > 1) B.poly(P, -1);
  };
  for (const [id, l] of adj) if (l.length === 1 && !used.has(id)) walk(id);
  for (const id of adj.keys()) if (!used.has(id)) walk(id);
  return B.done();
}

function outline(L) {
  const g = L.geo;
  if (TILE[g.type]) return tiling(g);
  if (g.type === 'armillary') return armillary(g);
  if (g.type === 'scales') return scales(g);
  if (g.type === 'weave') return weave(g);
  if (g.type === 'tpms') {
    const { field, Rm } = tpmsField(g);
    return contour((x, y, z) => field(x * Rm, y * Rm, z * Rm), g.portal + 0.03, 72, 144);
  }
  if (g.type === 'coral') {
    const { fbm } = createNoise3(`${g.seed}:coral`), f = (g.scale ?? 44) / 9, lvl = g.pattern === 'spots' || g.pattern === 'mitosis' ? 0.12 : 0;
    return contour((x, y, z) => fbm(x * f, y * f, z * f, 2) - lvl, g.portal + 0.03, 72, 144);
  }
  return builder().done();
}

// respiration des passages (main.js, beatShift) : τ = t − Σ a·w·K((t − k)/w)
const K7 = (x) => x - 3 * x ** 3 + 3 * x ** 5 - x ** 7;
function beatShift(t, N, beats, amp) {
  if (!beats?.length || !amp) return t;
  let tau = t;
  for (let k = Math.round(t) - 1; k <= Math.round(t) + 1; k++) {
    const b = beats[(((k % N) + N) % N) % beats.length], x = (t - k) / b.w;
    if (abs(x) < 1) tau -= amp * b.a * b.w * K7(x);
  }
  return tau;
}

export default function createArt() {
  // la recette (avant : le tunnel vide, aux proportions habituelles)
  let R = { seed: '', ratio: 0.62, core: 0.045, coreColor: [255, 200, 140], beats: null, ramp: 0, layers: [] };
  let shapes = [], reveal = [], prog = [];
  let tDive = 0, lit = 0, pend = 0;

  return {
    data(d) {
      if (d.layers) {
        const same = d.seed === R.seed && d.layers.length === R.layers.length;
        R = { seed: d.seed, ratio: d.ratio, core: d.core, coreColor: rgb(d.coreColor), beats: d.beats, ramp: d.ramp ?? 0,
          layers: d.layers.map((L) => ({ ...L, ink: ink(L.color) })) };
        if (!same) { shapes = R.layers.map(() => null); reveal = R.layers.map(() => 0); prog = R.layers.map(() => 0); pend = 0; }
      }
      if (d.prog && d.seed === R.seed) d.prog.forEach((p, i) => { if (i < prog.length) prog[i] = p; });
    },

    draw(ctx, S) {
      const { w, h, dpr, dt } = S;
      const m = min(w, h), cx = w / 2, cy = h * 0.46;
      const N = max(1, R.layers.length), k = R.ratio;
      // une épure calculée par image au plus (le pavage d'une couche : quelques ms)
      if (pend < R.layers.length) { try { shapes[pend] = outline(R.layers[pend]); } catch (e) { console.warn('épure :', e); shapes[pend] = null; } pend++; }
      // avancement du tracé de chaque couche : vers l'avancement réel, et sinon une lente avance
      const built = S.stepIdx >= 2 || S.done > 0;
      for (let i = 0; i < reveal.length; i++) {
        const target = built ? 1 : prog[i];
        if (reveal[i] < target) reveal[i] += (target - reveal[i]) * min(1, dt * 1.6) + dt * 0.02;
        else reveal[i] = min(target + 0.22 * (1 - target), reveal[i] + dt * 0.025);
        reveal[i] = min(1, reveal[i]);
      }
      // lumière : le cœur s'allume pendant la préparation des matériaux
      const litT = S.stepIdx >= 3 || S.done > 0 ? 1 : S.stepIdx === 2 ? 0.25 + 0.75 * S.real : 0;
      lit += (litT - lit) * min(1, dt * 1.8);
      // plongée : lente, avec la respiration des passages ; à la fin, on file à travers l'oculus suivant
      tDive += dt * (0.11 + 0.03 * lit);
      const fin = S.done * S.done * (3 - 2 * S.done);
      const tau = beatShift(tDive, N, R.beats, R.ramp) + 0.9 * fin;
      const fade = 1 - S.done;

      const F = 0.44 * m * sqrt(1 - k ** 3.2) / k ** 1.6; // (la coquille x = 1,6 affleure au bord du cadre)
      const xCore = log(R.core) / log(k), XB = ceil(xCore) + 1;
      const core = R.coreColor;
      const breathe = 0.5 + 0.5 * sin(S.t * 1.7);
      const lw = max(0.6, 0.85 * dpr);

      // les coquilles visibles, de la plus profonde à la plus proche
      const shells = [];
      for (let d = floor(tau + XB); d >= ceil(tau + 0.55); d--) {
        const x = d - tau, r = k ** x, j = ((d % N) + N) % N;
        const L = R.layers[j], portal = L?.geo.portal ?? 0.3;
        const sil = (F * r) / sqrt(1 - r * r), ocu = (F * r * sin(portal)) / (1 - r * cos(portal));
        const a = ss(0.85, 1.55, x) * (1 - ss(XB - 1.3, XB - 0.2, x)) * fade;
        if (a <= 0.003 || sil < 2.5 * dpr) continue;
        const spin = L ? L.phase + 0.035 * L.spin * (S.t + d * 7.3) : d * 1.7;
        shells.push({ d, x, r, j, L, portal, sil, ocu, a, ca: cos(spin), sa: sin(spin) });
      }

      // projection d'un point de la sphère unité de la coquille s (ou null s'il sort franchement du cadre)
      const proj = (s, px, py, pz, out) => {
        const X = s.ca * px - s.sa * py, Y = s.sa * px + s.ca * py, q = F * s.r / (1 - s.r * pz);
        out[0] = cx + q * X; out[1] = cy - q * Y;
      };
      const A = [0, 0], Bp = [0, 0], Cp = [0, 0];
      // tracé d'une épure (front : la calotte tournée vers nous ; sinon l'intérieur, vu par l'oculus)
      function trace(s, sh, front, upto, from = 0) {
        const { pts, start, len, round, cen } = sh;
        const lim = s.r, win = s.ocu * 1.08, far = 0.75 * m;
        let any = false;
        for (let i = from; i < upto; i++) {
          const cz = cen[i * 3 + 2];
          if (front ? cz < lim + 0.01 : cz > lim) continue;
          proj(s, cen[i * 3], cen[i * 3 + 1], cz, A);
          const ex = A[0] - cx, ey = A[1] - cy, e2 = ex * ex + ey * ey;
          if (front ? e2 > far * far : e2 > win * win) continue;
          const o = start[i] * 3, n = len[i], t = round[i];
          if (t < 0 || n < 3) { // tracé ouvert
            proj(s, pts[o], pts[o + 1], pts[o + 2], A);
            ctx.moveTo(A[0], A[1]);
            for (let q = 1; q < n; q++) { proj(s, pts[o + q * 3], pts[o + q * 3 + 1], pts[o + q * 3 + 2], A); ctx.lineTo(A[0], A[1]); }
          } else { // contour de trou, angles arrondis
            proj(s, pts[o + (n - 1) * 3], pts[o + (n - 1) * 3 + 1], pts[o + (n - 1) * 3 + 2], Bp);
            proj(s, pts[o], pts[o + 1], pts[o + 2], A);
            for (let q = 0; q < n; q++) {
              const nq = (q + 1) % n;
              proj(s, pts[o + nq * 3], pts[o + nq * 3 + 1], pts[o + nq * 3 + 2], Cp);
              const ax = A[0] + (Bp[0] - A[0]) * t, ay = A[1] + (Bp[1] - A[1]) * t, bx = A[0] + (Cp[0] - A[0]) * t, by = A[1] + (Cp[1] - A[1]) * t;
              if (q === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
              ctx.quadraticCurveTo(A[0], A[1], bx, by);
              Bp[0] = A[0]; Bp[1] = A[1]; A[0] = Cp[0]; A[1] = Cp[1];
            }
            ctx.closePath();
          }
          any = true;
        }
        return any;
      }

      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 1. l'intérieur des parois, du plus loin (la coquille la plus grande) au plus proche
      if (!S.lite) for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i], sh = shapes[s.j];
        if (!sh || s.ocu < 14 * dpr) continue;
        const n = Math.round(sh.n * reveal[s.j]);
        ctx.beginPath();
        if (!trace(s, sh, false, n)) continue;
        // (éclairé par le cœur : d'autant plus qu'il est proche)
        const glow = 0.1 + 0.32 * lit * (0.6 + 0.4 * ss(1.5, XB, s.x));
        ctx.strokeStyle = css(mix([150, 150, 160], core, 0.35 + 0.55 * lit), glow * s.a);
        ctx.lineWidth = lw * 0.8;
        ctx.stroke();
      }
      // 2. le cœur (une lueur qui respire, plus forte quand la lumière est prête)
      {
        const rc = F * R.core * (1 + 0.04 * breathe), I = (0.35 + 0.65 * lit) * fade;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rc * (5 + 3 * lit));
        g.addColorStop(0, css(mix(core, [255, 255, 255], 0.55), 0.95 * I));
        g.addColorStop(0.12, css(core, 0.5 * I));
        g.addColorStop(0.45, css(core, 0.08 * I));
        g.addColorStop(1, css(core, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rc * (5 + 3 * lit), 0, TAU); ctx.fill();
      }
      // 3. les calottes, de la plus profonde à la plus proche : chacune cache
      // ce qui est derrière elle, sauf par son oculus
      for (const s of shells) {
        const sh = shapes[s.j], L = s.L;
        // la paroi (sombre, à peine éclairée vers le cœur)
        ctx.beginPath();
        ctx.arc(cx, cy, s.sil, 0, TAU); ctx.arc(cx, cy, s.ocu, 0, TAU, true);
        const wall = ctx.createRadialGradient(cx, cy, s.ocu, cx, cy, s.sil);
        wall.addColorStop(0, css(mix([10, 10, 12], core, 0.06 + 0.1 * lit), 0.93 * s.a));
        wall.addColorStop(1, css([5, 5, 6], 0.93 * s.a));
        ctx.fillStyle = wall;
        ctx.fill('evenodd');
        // le contour de la coquille
        ctx.lineWidth = lw * 0.8;
        ctx.strokeStyle = css([226, 222, 214], 0.1 * s.a);
        ctx.beginPath(); ctx.arc(cx, cy, s.sil, 0, TAU); ctx.stroke();
        // l'épure, tracée depuis l'oculus (la tête du tracé un peu plus vive)
        const col = L ? mix([196, 202, 212], L.ink, lit) : [200, 200, 205];
        const depth = 0.55 + 0.45 * (1 - ss(1.5, XB, s.x));
        if (sh && sh.n) {
          const n = Math.round(sh.n * reveal[s.j]), head = Math.max(0, n - Math.max(3, Math.round(sh.n * 0.05)));
          ctx.lineWidth = lw * (s.sil > 0.25 * m ? 1 : 0.85);
          ctx.beginPath();
          if (trace(s, sh, true, head)) { ctx.strokeStyle = css(col, (0.42 + 0.2 * lit) * depth * s.a); ctx.stroke(); }
          if (n > head && reveal[s.j] < 0.999) {
            ctx.beginPath();
            if (trace(s, sh, true, n, head)) { ctx.strokeStyle = css([255, 246, 230], 0.85 * s.a); ctx.stroke(); }
          }
        }
        // le bord de l'oculus : il prend la lumière du cœur
        ctx.lineWidth = lw * (1 + 0.5 * lit);
        ctx.strokeStyle = css(mix(col, mix(core, [255, 255, 255], 0.4), lit * 0.8), (0.3 + 0.5 * lit) * depth * s.a);
        ctx.beginPath(); ctx.arc(cx, cy, s.ocu, 0, TAU); ctx.stroke();
      }
      // le cadre : un fondu vers le fond (le bas reste libre pour le nom et l'avancement)
      const R0 = 0.31 * m, R1 = 0.47 * m;
      const v = ctx.createRadialGradient(cx, cy, R0, cx, cy, R1);
      v.addColorStop(0, 'rgba(5, 5, 6, 0)'); v.addColorStop(1, S.bg || '#050506');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    },
  };
}
