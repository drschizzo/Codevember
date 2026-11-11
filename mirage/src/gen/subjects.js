// Primitives de maillage communes aux objets et à l'appareil (boîte orientée,
// cylindre ou cône entre deux points, tour de révolution, relief), hasard local
// et bruit. Attributs : position, normal, mat (u8×4 : albédo sRGB et rugosité).
//
// Module pur.
const { sin, cos, abs, max, min, sqrt, PI, floor, pow, exp, hypot } = Math;
const TAU = PI * 2;

// ── Hasard local (déterministe) ─────────────────────────────────────────────
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// bruit de valeur 2D lissé (pour les reliefs)
export function noise2(seed) {
  const h = (i, j) => { let x = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = floor(x), j = floor(y), fx = s(x - i), fy = s(y - j);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
export const fbm = (n, x, y, o = 5, l = 2, g = 0.5) => { let v = 0, a = 1, f = 1, t = 0; for (let i = 0; i < o; i++) { v += a * n(x * f, y * f); t += a; a *= g; f *= l; } return v / t; };

// ── Tampons ─────────────────────────────────────────────────────────────────
export class Mesh {
  constructor() { this.p = []; this.n = []; this.m = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(p, n, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.m.push(c[0], c[1], c[2], c[3] ?? 200); return this.count - 1; }
  t(a, b, c) { this.i.push(a, b, c); }
  out() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), mat: new Uint8Array(this.m), index: new Uint32Array(this.i) };
  }
}
const nrm = (a) => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// boîte orientée (centre c, demi-tailles h, rotation autour de y)
export function box(M, c, h, col, yaw = 0, tilt = [0, 0]) {
  const cy = cos(yaw), sy = sin(yaw), ct = cos(tilt[0]), st = sin(tilt[0]), cz = cos(tilt[1]), sz = sin(tilt[1]);
  const R = (v) => {
    let [x, y, z] = v;
    [y, z] = [y * ct - z * st, y * st + z * ct]; // inclinaison autour de x
    [x, y] = [x * cz - y * sz, x * sz + y * cz]; // autour de z
    return [x * cy + z * sy, y, -x * sy + z * cy];
  };
  const F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, u, w] of F) {
    const nn = R(n), q = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lp = [n[0] * h[0] + u[0] * a * h[0] + w[0] * b * h[0], n[1] * h[1] + u[1] * a * h[1] + w[1] * b * h[1], n[2] * h[2] + u[2] * a * h[2] + w[2] * b * h[2]];
      const wp = R(lp);
      q.push(M.v([c[0] + wp[0], c[1] + wp[1], c[2] + wp[2]], nn, col));
    }
    M.t(q[0], q[1], q[2]); M.t(q[0], q[2], q[3]);
  }
}

// cylindre (ou cône) entre deux points, rayons r0 → r1
export function cyl(M, a, b, r0, r1, col, seg = 10, caps = true) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = hypot(...d), ax = nrm(d);
  const ref = abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = nrm(crs(ax, ref)), w = crs(ax, u);
  const slope = (r0 - r1) / L;
  const base = M.count;
  for (let k = 0; k <= seg; k++) {
    const t = (k / seg) * TAU, c = cos(t), s = sin(t);
    const rd = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
    const n = nrm([rd[0] + ax[0] * slope, rd[1] + ax[1] * slope, rd[2] + ax[2] * slope]);
    M.v([a[0] + rd[0] * r0, a[1] + rd[1] * r0, a[2] + rd[2] * r0], n, col);
    M.v([b[0] + rd[0] * r1, b[1] + rd[1] * r1, b[2] + rd[2] * r1], n, col);
  }
  for (let k = 0; k < seg; k++) { const i = base + k * 2; M.t(i, i + 2, i + 1); M.t(i + 1, i + 2, i + 3); }
  if (caps) for (const [p, r, sg] of [[a, r0, -1], [b, r1, 1]]) {
    if (r <= 0) continue;
    const c0 = M.v(p, [ax[0] * sg, ax[1] * sg, ax[2] * sg], col), b0 = M.count;
    for (let k = 0; k <= seg; k++) { const t = (k / seg) * TAU; M.v([p[0] + (u[0] * cos(t) + w[0] * sin(t)) * r, p[1] + (u[1] * cos(t) + w[1] * sin(t)) * r, p[2] + (u[2] * cos(t) + w[2] * sin(t)) * r], [ax[0] * sg, ax[1] * sg, ax[2] * sg], col); }
    for (let k = 0; k < seg; k++) sg > 0 ? M.t(c0, b0 + k, b0 + k + 1) : M.t(c0, b0 + k + 1, b0 + k);
  }
}

// tour : profil de révolution [[rayon, hauteur], …] autour de (x, z)
export function lathe(M, x, z, prof, col, seg = 24) {
  const base = M.count;
  for (let k = 0; k <= seg; k++) {
    const t = (k / seg) * TAU, c = cos(t), s = sin(t);
    for (let j = 0; j < prof.length; j++) {
      const a = prof[max(0, j - 1)], b = prof[min(prof.length - 1, j + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1];
      const n = nrm([c * dy, -dr, s * dy]);
      M.v([x + c * prof[j][0], prof[j][1], z + s * prof[j][0]], n, typeof col === 'function' ? col(prof[j][1]) : col);
    }
  }
  const P = prof.length;
  for (let k = 0; k < seg; k++) for (let j = 0; j < P - 1; j++) { const i = base + k * P + j; M.t(i, i + 1, i + P); M.t(i + 1, i + P + 1, i + P); }
}

// relief : grille (x ∈ [x0, x1], z ∈ [z0, z1]) de hauteur h(x, z) ≥ 0 ;
// col(x, z, y, pente) → couleur ; seulement les cellules dont un coin dépasse
// la surface (le reste est sous l'eau)
export function heightfield(M, x0, x1, z0, z1, nx, nz, h, col) {
  const H = new Float32Array((nx + 1) * (nz + 1)), idx = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
  const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) H[j * (nx + 1) + i] = h(x0 + i * dx, z0 + j * dz);
  const at = (i, j) => H[min(nz, max(0, j)) * (nx + 1) + min(nx, max(0, i))];
  const vert = (i, j) => {
    const k = j * (nx + 1) + i;
    if (idx[k] >= 0) return idx[k];
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
    const n = nrm([-gx, 1, -gz]);
    const x = x0 + i * dx, z = z0 + j * dz;
    return (idx[k] = M.v([x, H[k], z], n, col(x, z, H[k], 1 - n[1])));
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (max(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)) <= 0.05) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    M.t(a, d, c); M.t(a, c, b);
  }
}

// ── Les couleurs (sRGB, rugosité) ───────────────────────────────────────────
export const C = {
  hull: [38, 34, 32, 150], hullBand: [196, 188, 170, 170], copper: [92, 70, 52, 180], deck: [140, 112, 80, 220], spar: [120, 92, 62, 210],
  canvas: [206, 196, 172, 240], rope: [52, 44, 36, 230], funnel: [26, 26, 26, 160], funnelBand: [176, 52, 36, 170], house: [168, 160, 146, 200], boat: [190, 184, 170, 200],
  snow: [240, 243, 247, 230], ice: [214, 228, 236, 140], iceBlue: [120, 168, 196, 90], granite: [96, 92, 90, 240], lichen: [120, 104, 70, 250],
  white: [226, 222, 212, 190], red: [158, 40, 32, 190], lantern: [40, 44, 48, 60], roof: [70, 40, 34, 220], black: [24, 24, 26, 160],
  sand: [178, 92, 62, 245], sand2: [204, 130, 84, 245], earth: [176, 128, 88, 250], earthDark: [130, 88, 58, 250], cactus: [86, 104, 58, 230], rockGrey: [128, 116, 104, 245],
  wood: [88, 66, 48, 240], basalt: [52, 50, 50, 240], moss: [74, 84, 56, 250], scree: [110, 104, 98, 250],
};
export const shade = (c, k) => [min(255, c[0] * k), min(255, c[1] * k), min(255, c[2] * k), c[3]];
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

