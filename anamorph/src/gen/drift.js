// La congère : la neige soufflée s'accumule contre ce qui l'arrête. Contre
// chaque pièce posée près du sol, elle monte en bourrelet (elle enfouit le bas
// de la section, ce qui pose la pièce : plus de contact « posé sur une
// image »), s'étire en queue sous le vent, et comble le pied du tas, à l'abri.
// Un champ de hauteur (mètres) sur une grille, appliqué en déplacement au sol.
// Module pur (Node, worker).
import { axisAt, supportAt } from './forge.js';

export const WIND_AZ = 0.6; // direction du vent (radians, repère x/z du sol) : la même que le relief de la neige

export function computeDrift(pieces, bounds, { N = 320, margin = 1.1 } = {}) {
  const x0 = bounds[0] - margin, z0 = bounds[2] - margin;
  const size = Math.max(bounds[3] - bounds[0], bounds[5] - bounds[2]) + 2 * margin;
  const H = new Float32Array(N * N);
  const wx = Math.cos(WIND_AZ), wz = Math.sin(WIND_AZ);
  // les pièces basses, échantillonnées le long de leur axe : (x, z, hauteur du dessous, demi-largeur)
  const S = [];
  for (const P of pieces) {
    const L = Math.hypot(P.p1[0] - P.p0[0], P.p1[1] - P.p0[1], P.p1[2] - P.p0[2]);
    const n = Math.max(2, Math.ceil(L / 0.03));
    for (let k = 0; k <= n; k++) {
      const t = k / n, c = axisAt(P, t), low = c[1] - supportAt(P, [0, -1, 0], t);
      if (low > 0.12) continue;
      S.push([c[0], c[2], low, supportAt(P, [0, -1, 0], t), P.r]);
    }
  }
  // grille d'accélération
  const cell = 0.25, G = new Map(), key = (i, j) => i * 4096 + j;
  for (const s of S) { const k = key(Math.floor((s[0] - x0) / cell), Math.floor((s[1] - z0) / cell)); if (!G.has(k)) G.set(k, []); G.get(k).push(s); }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = x0 + (i / (N - 1)) * size, z = z0 + (j / (N - 1)) * size;
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
    let h = 0, shelter = 0;
    for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
      const l = G.get(key(ci + di, cj + dj)); if (!l) continue;
      for (const [sx, sz, low, half, r] of l) {
        const dx = x - sx, dz = z - sz;
        const along = dx * wx + dz * wz; // > 0 : sous le vent
        const across = -dx * wz + dz * wx;
        const stretch = along > 0 ? 2.8 : 1.0;
        const lam = 0.06 + 1.4 * r;
        const d2 = (along / (lam * stretch)) ** 2 + (across / lam) ** 2;
        // bourrelet : monte jusqu'à ~45 % de la hauteur de la section, moins si la pièce est haute
        const A = 0.45 * 2 * half * Math.exp(-low / 0.03);
        h = Math.max(h, A * Math.exp(-d2));
        shelter = Math.max(shelter, Math.exp(-(dx * dx + dz * dz) / 0.18));
      }
    }
    // pied du tas : une nappe abritée, ondulée
    h += 0.018 * shelter * (0.7 + 0.3 * Math.sin(x * 7.1 + z * 3.3) * Math.sin(z * 5.3 - x * 2.1));
    // fondu vers le sol plat au bord de la grille
    const e = Math.min(i, j, N - 1 - i, N - 1 - j) / (N * 0.08);
    H[j * N + i] = h * Math.min(1, e) ** 2;
  }
  return { heights: H, N, x0, z0, size };
}
