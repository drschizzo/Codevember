// Volume de bruit périodique (128³, 4 canaux, demi-flottants), calculé une fois au démarrage
// dans un worker puis échantillonné par les matériaux (texture 3D, filtrage
// trilinéaire) : un accès mémoire remplace des centaines d'instructions de
// bruit procédural par pixel.
//
//   R, G : bruit de gradient (Perlin amélioré), deux tirages indépendants, ≈ [-1, 1]
//   B    : Worley F1 (distance au germe le plus proche, en cellules)
//   A    : Worley F2 − F1 (≈ 0 sur les arêtes des cellules : craquelures)
//
// Période : P cellules par tuile (une cellule = une unité de fréquence).

import { createRng } from '../rng.js';

export const NOISE_SIZE = 128;
export const NOISE_PERIOD = 4;

export function buildNoiseVolume(seed = 'rust-noise', N = NOISE_SIZE, P = NOISE_PERIOD) {
  const rng = createRng(seed);
  const grads = (n) => Array.from({ length: n }, () => rng.dir());
  const gA = grads(P * P * P), gB = grads(P * P * P);
  const pts = Array.from({ length: P * P * P }, () => [rng.next(), rng.next(), rng.next()]);
  const idx = (i, j, k) => (((i % P) + P) % P) + P * ((((j % P) + P) % P) + P * (((k % P) + P) % P));
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  const perlin = (g, x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const gr = g[idx(X + dx, Y + dy, Z + dz)];
      const d = gr[0] * (fx - dx) + gr[1] * (fy - dy) + gr[2] * (fz - dz);
      s += d * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return s * 1.6;
  };

  const out = new Float32Array(N * N * N * 4);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N) * P, y = (j / N) * P, z = (k / N) * P;
    const o = ((k * N + j) * N + i) * 4;
    out[o] = perlin(gA, x, y, z);
    out[o + 1] = perlin(gB, x + 0.5, y + 0.5, z + 0.5);
    // Worley : germes des 27 cellules voisines (périodiques)
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    let f1 = 9, f2 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = pts[idx(X + dx, Y + dy, Z + dz)];
      const ex = X + dx + p[0] - x, ey = Y + dy + p[1] - y, ez = Z + dz + p[2] - z;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    out[o + 2] = f1;
    out[o + 3] = f2 - f1;
  }
  // conversion en demi-flottants ici (dans le worker), pas sur le fil principal
  const half = new Uint16Array(out.length), f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < out.length; i++) {
    f32[0] = out[i];
    const x = u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    half[i] = e <= 0 ? sign : e >= 31 ? sign | 0x7c00 : sign | (e << 10) | (m >>> 13);
  }
  return { data: half, size: N, period: P };
}
