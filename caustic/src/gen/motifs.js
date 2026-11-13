// Les dessins que la lumière doit tracer au fond de la cuve — fonctions pures.
//
// Chaque motif est dessiné dans le disque unité (coordonnées [−1, 1]²), en
// traits et en points de lumière, sur une grille m×m. La cible du transport
// optimal en dérive : t = 1 + w(r)·(motif − c), où w passe de 1 dans le disque
// à 0 au bord du carré et c est choisi pour que la lumière totale soit
// conservée — hors du disque, la lumière reste où elle est (t = 1), dans le
// disque elle quitte le fond pour se rassembler sur les traits.
//
// Les séries (diatomées, oursins, méduses, rosaces, phyllotaxies, radiolaires)
// sont des formes de Haeckel dessinées à la règle : symétries rayonnantes,
// points et filets, ce que la lumière d'une caustique sait le mieux tracer.

import { createRng } from '../../../shared/rng.js';

// ── Toile : primitives accumulées dans une grille ──────────────────────────
function canvas(m) {
  const a = new Float64Array(m * m);
  const px = 2 / m; // taille d'une cellule en unités du disque
  const toI = (v) => ((v + 1) / 2) * m - 0.5;
  // trait gaussien de demi-largeur w autour de la distance d(x, y) à une forme
  const splat = (x0, y0, x1, y1, fn) => {
    const i0 = Math.max(0, Math.floor(toI(x0))), i1 = Math.min(m - 1, Math.ceil(toI(x1)));
    const j0 = Math.max(0, Math.floor(toI(y0))), j1 = Math.min(m - 1, Math.ceil(toI(y1)));
    for (let j = j0; j <= j1; j++) {
      const y = ((j + 0.5) / m) * 2 - 1;
      for (let i = i0; i <= i1; i++) {
        const x = ((i + 0.5) / m) * 2 - 1;
        const v = fn(x, y);
        if (v > 0) a[j * m + i] += v;
      }
    }
  };
  const prof = (d, w) => { const q = d / Math.max(w, px * 0.6); return q < 3 ? Math.exp(-q * q) : 0; };
  return {
    a, m, px,
    // point de lumière (rayon w)
    dot(x, y, w, k = 1) {
      const R = 3 * Math.max(w, px);
      splat(x - R, y - R, x + R, y + R, (X, Y) => k * prof(Math.hypot(X - x, Y - y), w));
    },
    // segment
    seg(xa, ya, xb, yb, w, k = 1) {
      const R = 3 * Math.max(w, px);
      const dx = xb - xa, dy = yb - ya, L2 = dx * dx + dy * dy || 1e-12;
      splat(Math.min(xa, xb) - R, Math.min(ya, yb) - R, Math.max(xa, xb) + R, Math.max(ya, yb) + R, (X, Y) => {
        const t = Math.max(0, Math.min(1, ((X - xa) * dx + (Y - ya) * dy) / L2));
        return k * prof(Math.hypot(X - xa - t * dx, Y - ya - t * dy), w);
      });
    },
    // cercle (anneau de rayon R, trait w)
    ring(cx, cy, R, w, k = 1) {
      const E = R + 3 * Math.max(w, px);
      splat(cx - E, cy - E, cx + E, cy + E, (X, Y) => k * prof(Math.abs(Math.hypot(X - cx, Y - cy) - R), w));
    },
    // polyligne (points [[x, y], …])
    poly(pts, w, k = 1, closed = false) {
      const n = pts.length;
      for (let i = 0; i < n - (closed ? 0 : 1); i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        this.seg(p[0], p[1], q[0], q[1], w, k);
      }
    },
  };
}

const TAU = Math.PI * 2;
const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

// ── Les séries ────────────────────────────────────────────────────────────
// chaque dessinateur reçoit la toile, un générateur, un niveau de richesse
// (0, 1, 2 : les trois dessins d'une boucle, en crescendo) et ses paramètres

// Diatomée centrique (Arachnoidiscus, Actinoptychus) : anneau central, côtes
// rayonnantes, aréoles en rangées, secteurs alternés, double bord.
function diatom(c, rng, level) {
  const ribs = [16, 24, 32][level] + 8 * rng.int(0, 1);
  const w = 0.012;
  c.ring(0, 0, 0.93, w * 1.3, 1.2);
  c.ring(0, 0, 0.86, w * 0.8, 0.7);
  const r0 = 0.16 + 0.04 * rng.next();
  c.ring(0, 0, r0, w, 1);
  if (level >= 1) c.ring(0, 0, r0 * 0.45, w * 0.8, 0.8);
  const sectors = level === 2 ? 6 + 2 * rng.int(0, 1) : 0;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * TAU;
    const [x0, y0] = rot(r0, 0, a), [x1, y1] = rot(0.86, 0, a);
    c.seg(x0, y0, x1, y1, w * 0.75, 0.9);
    // aréoles entre deux côtes : des perles de plus en plus grosses vers le bord
    const am = a + Math.PI / ribs;
    const rows = 4 + 2 * level;
    for (let k = 0; k < rows; k++) {
      const r = r0 + ((k + 0.7) / rows) * (0.84 - r0);
      const s = 0.012 + 0.016 * (r / 0.86);
      const sec = sectors ? Math.floor(((am / TAU) * sectors) % sectors) % 2 : 0;
      const [x, y] = rot(r, 0, am);
      c.dot(x, y, s * (sec ? 0.6 : 1), sec ? 0.7 : 1.1);
    }
  }
  if (sectors) for (let i = 0; i < sectors; i++) {
    const a = (i / sectors) * TAU;
    const [x1, y1] = rot(0.86, 0, a);
    c.seg(0, 0, x1, y1, w * 1.4, 0.8);
  }
}

// Test d'oursin vu d'en haut : cinq ambulacres de paires de pores qui
// s'écartent puis se resserrent, tubercules entre eux, disque apical.
function urchin(c, rng, level) {
  const n5 = 5;
  const petal = level >= 1; // dollar des sables : ambulacres en pétales
  c.ring(0, 0, 0.92, 0.014, 1.1);
  // disque apical : cinq plaques génitales et le périprocte
  for (let i = 0; i < n5; i++) {
    const [x, y] = rot(0.1, 0, (i / n5) * TAU + Math.PI / n5);
    c.dot(x, y, 0.028, 1.2);
  }
  c.ring(0, 0, 0.055, 0.01, 1);
  for (let i = 0; i < n5; i++) {
    const a = (i / n5) * TAU;
    const rows = 13 + 4 * level;
    for (const side of [-1, 1]) {
      for (let k = 0; k < rows; k++) {
        const t = (k + 0.5) / rows;
        const r = 0.16 + t * (petal ? 0.6 : 0.74);
        const width = petal ? 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.02 : 0.05 + 0.05 * Math.sin(Math.PI * t);
        const [x, y] = rot(r, side * width, a);
        c.dot(x, y, 0.012 + 0.006 * t, 1);
        if (level >= 1) { const [x2, y2] = rot(r, side * (width + 0.03), a); c.dot(x2, y2, 0.009, 0.7); }
      }
    }
    // tubercules de l'interambulacre
    const am = a + Math.PI / n5;
    const tub = 3 + level * 2;
    for (let k = 0; k < tub; k++) {
      const r = 0.25 + (k / Math.max(1, tub - 1)) * 0.55;
      const spread = 0.05 + 0.13 * (r - 0.2);
      for (const s of k % 2 ? [-1, 1] : [0]) {
        const [x, y] = rot(r, s * spread, am);
        const big = 0.026 + 0.02 * r;
        c.dot(x, y, big * 0.45, 1.3);
        c.ring(x, y, big, 0.006, 0.6);
      }
    }
  }
}

// Méduse vue du dessus : bord de l'ombrelle, canal circulaire, canaux
// radiaires, quatre gonades en fer à cheval, bras oraux, bulbes tentaculaires.
function medusa(c, rng, level) {
  const canals = [4, 8, 16][level];
  c.ring(0, 0, 0.92, 0.01, 0.8);
  c.ring(0, 0, 0.84, 0.016, 1.2);
  for (let i = 0; i < canals; i++) {
    const a = (i / canals) * TAU + 0.12;
    const [x0, y0] = rot(0.14, 0, a), [x1, y1] = rot(0.84, 0, a);
    c.seg(x0, y0, x1, y1, 0.012, 0.9);
  }
  // gonades : arcs en fer à cheval
  for (let g = 0; g < 4; g++) {
    const a0 = (g / 4) * TAU + 0.12 + Math.PI / 4;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24, ang = a0 + (t - 0.5) * 1.1;
      const r = 0.38 + 0.14 * Math.sin(Math.PI * t);
      pts.push(rot(r, 0, ang));
    }
    c.poly(pts, 0.03, 1);
  }
  // bras oraux
  const arms = 4;
  for (let i = 0; i < arms; i++) {
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, ang = (i / arms) * TAU + 0.12 + 0.6 * t * t;
      pts.push(rot(0.03 + 0.26 * t, 0, ang));
    }
    c.poly(pts, 0.018 * (1 - 0.5 * pts.length / 40), 1);
  }
  // bulbes au bord
  const bulbs = [16, 32, 48][level];
  for (let i = 0; i < bulbs; i++) {
    const [x, y] = rot(0.88, 0, (i / bulbs) * TAU);
    c.dot(x, y, 0.02, 1.2);
  }
}

// Rosace : cercles entrelacés en couronnes (fleur de vie, rose gothique).
function rosette(c, rng, level) {
  const n = [6, 8, 12][level];
  const w = 0.012;
  c.ring(0, 0, 0.93, w * 1.2, 1);
  const r = 0.3;
  for (let i = 0; i < n; i++) {
    const [x, y] = rot(r, 0, (i / n) * TAU);
    c.ring(x, y, r, w, 1);
  }
  c.ring(0, 0, r, w, 1);
  if (level >= 1) for (let i = 0; i < n; i++) {
    const [x, y] = rot(0.62, 0, ((i + 0.5) / n) * TAU);
    c.ring(x, y, 0.24, w * 0.8, 0.8);
  }
  if (level >= 2) for (let i = 0; i < 2 * n; i++) {
    const [x, y] = rot(0.84, 0, (i / (2 * n)) * TAU);
    c.dot(x, y, 0.022, 1.2);
  }
  c.dot(0, 0, 0.04, 1.5);
}

// Phyllotaxie de Vogel : capitule de tournesol, des points de lumière qui
// grossissent du centre au bord, spirales de Fibonacci.
function phyllo(c, rng, level) {
  const N = [180, 320, 520][level];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const R = 0.88;
  for (let i = 1; i <= N; i++) {
    const r = R * Math.sqrt(i / N), a = i * golden;
    const [x, y] = rot(r, 0, a);
    c.dot(x, y, (0.55 * R) / Math.sqrt(N) * (0.6 + 0.5 * r), 1.1);
  }
  c.ring(0, 0, 0.95, 0.012, 0.8);
}

// Radiolaire : treillis concentriques à mailles polygonales, épines.
function radiolarian(c, rng, level) {
  const shells = 2 + level;
  const sym = [6, 8, 10][level];
  for (let s = 0; s < shells; s++) {
    const R = 0.3 + (s / Math.max(1, shells - 1)) * 0.55;
    c.ring(0, 0, R, 0.011, 1);
    const cells = Math.round(sym * (1 + s));
    for (let i = 0; i < cells; i++) {
      const a = (i / cells) * TAU + (s % 2) * (Math.PI / cells);
      const [x, y] = rot(R, 0, a);
      c.dot(x, y, 0.018, 1);
      if (s > 0) {
        const r0 = 0.3 + ((s - 1) / Math.max(1, shells - 1)) * 0.55;
        const [x0, y0] = rot(r0, 0, a + Math.PI / cells);
        c.seg(x0, y0, x, y, 0.008, 0.7);
      }
    }
  }
  for (let i = 0; i < sym; i++) {
    const a = (i / sym) * TAU;
    const [x0, y0] = rot(0.85, 0, a), [x1, y1] = rot(0.96, 0, a);
    c.seg(x0, y0, x1, y1, 0.014, 1.2);
  }
  c.dot(0, 0, 0.09, 1.2);
}

export const SERIES = {
  diatom: { draw: diatom, name: 'Diatomées' },
  urchin: { draw: urchin, name: 'Oursins' },
  medusa: { draw: medusa, name: 'Méduses' },
  rosette: { draw: rosette, name: 'Rosaces' },
  phyllo: { draw: phyllo, name: 'Phyllotaxies' },
  radiolarian: { draw: radiolarian, name: 'Radiolaires' },
};

// Cible du transport optimal sur une grille m×m couvrant le carré [−1, 1]² :
// densité de moyenne 1, égale à 1 hors du disque de rayon `rIn`/`rOut`,
// fond du disque à `floor` (la lumière qui reste entre les traits).
export function target(series, level, seed, m, { rIn = 0.66, rOut = 0.8, floor = 0.32, rotation = 0 } = {}) {
  const c = canvas(m);
  const rng = createRng(`${seed}:${series}:${level}`);
  SERIES[series].draw(c, rng, level);
  // dessin dans un disque de rayon rIn (le motif est dessiné en rayon 1)
  const a = new Float64Array(m * m);
  const cr = Math.cos(rotation), sr = Math.sin(rotation);
  // ré-échantillonne le dessin mis à l'échelle rIn (bilinéaire)
  const sample = (x, y) => {
    const fx = ((x + 1) / 2) * m - 0.5, fy = ((y + 1) / 2) * m - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (ii, jj) => (ii < 0 || jj < 0 || ii >= m || jj >= m ? 0 : c.a[jj * m + ii]);
    return (1 - v) * ((1 - u) * g(i, j) + u * g(i + 1, j)) + v * ((1 - u) * g(i, j + 1) + u * g(i + 1, j + 1));
  };
  const w = new Float64Array(m * m);
  let sw = 0, swm = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const x = ((i + 0.5) / m) * 2 - 1, y = ((j + 0.5) / m) * 2 - 1;
    const r = Math.hypot(x, y);
    const X = (x * cr + y * sr) / rIn, Y = (-x * sr + y * cr) / rIn;
    // saturation douce : les recouvrements ne font pas de points brûlés
    const v = 1 - Math.exp(-1.6 * sample(X, Y));
    const t = Math.min(1, Math.max(0, (rOut - r) / (rOut - rIn)));
    const ww = t * t * (3 - 2 * t);
    a[j * m + i] = v; w[j * m + i] = ww;
    sw += ww; swm += ww * v;
  }
  // c est la moyenne pondérée du dessin ; on règle l'intensité des traits
  // pour que le fond du disque tombe à `floor` : 1 − k·c = floor
  const cm = swm / sw;
  const k = (1 - floor) / Math.max(cm, 1e-6);
  const out = new Float64Array(m * m);
  for (let i = 0; i < m * m; i++) out[i] = 1 + w[i] * k * (a[i] - cm);
  return out;
}
