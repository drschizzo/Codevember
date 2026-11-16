// Les deux volumes de bruit du nuage (d'après Schneider, « The real-time
// volumetric cloudscapes of Horizon Zero Dawn », 2015, et Hillaire, « Physically
// based sky, atmosphere and cloud rendering in Frostbite », 2016). Périodiques,
// 8 bits, indépendants de la graine (la graine décale la lecture).
//
//   forme  (64³, RGBA) : R = Perlin-Worley (un Perlin fractal dont les creux
//          sont ceux d'un Worley : des bourgeons ronds et liés, pas des
//          billes), G, B, A = Worley inversé fractal à 4, 8 et 16 cellules
//   détail (32³, RGBA) : Worley inversé fractal à 2, 4 et 8 cellules ; A = Perlin
//
// Le volume de détail fait 128 Ko : il tient dans le cache de la carte, et se
// lit à haute fréquence sans le faire déborder (le volume de bruit commun,
// 128³ en demi-flottants, coûtait 6 à 8 ms par image dès qu'on le lisait plus
// fin). Module pur.

const hash3 = (i, j, k, s) => {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// Worley périodique : F1 à la position (x, y, z) ∈ [0, 1)³, F cellules par tuile → [0, 1] inversé
function worley(x, y, z, F, s) {
  const X = x * F, Y = y * F, Z = z * F, xi = Math.floor(X), yi = Math.floor(Y), zi = Math.floor(Z);
  let d2 = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ci = xi + dx, cj = yi + dy, ck = zi + dz;
    const wi = ((ci % F) + F) % F, wj = ((cj % F) + F) % F, wk = ((ck % F) + F) % F;
    const px = ci + hash3(wi, wj, wk, s), py = cj + hash3(wi, wj, wk, s + 1), pz = ck + hash3(wi, wj, wk, s + 2);
    const ex = px - X, ey = py - Y, ez = pz - Z, e = ex * ex + ey * ey + ez * ez;
    if (e < d2) d2 = e;
  }
  return 1 - Math.min(1, Math.sqrt(d2));
}
// Perlin périodique (gradients hachés), ≈ [-1, 1]
function perlin(x, y, z, F, s) {
  const X = x * F, Y = y * F, Z = z * F, xi = Math.floor(X), yi = Math.floor(Y), zi = Math.floor(Z);
  const fx = X - xi, fy = Y - yi, fz = Z - zi;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const u = fade(fx), v = fade(fy), w = fade(fz);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const wi = (((xi + dx) % F) + F) % F, wj = (((yi + dy) % F) + F) % F, wk = (((zi + dz) % F) + F) % F;
    const th = hash3(wi, wj, wk, s) * 6.2832, cz = hash3(wi, wj, wk, s + 7) * 2 - 1, sz = Math.sqrt(1 - cz * cz);
    const g = (fx - dx) * Math.cos(th) * sz + (fy - dy) * Math.sin(th) * sz + (fz - dz) * cz;
    r += g * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r * 1.7;
}
const wfbm = (x, y, z, F, s, max) => {
  const f = (k) => worley(x, y, z, Math.min(max, F * k), s + k * 31);
  return f(1) * 0.625 + f(2) * 0.25 + f(4) * 0.125;
};
const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const b8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function buildCloudNoise() {
  const S = 64, shape = new Uint8Array(S * S * S * 4);
  for (let k = 0; k < S; k++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = i / S, y = j / S, z = k / S, o = ((k * S + j) * S + i) * 4;
    const p = perlin(x, y, z, 4, 11) * 0.62 + perlin(x, y, z, 8, 23) * 0.26 + perlin(x, y, z, 16, 37) * 0.12;
    const w4 = wfbm(x, y, z, 4, 101, 32);
    // Perlin-Worley : le Perlin remappé dans [Worley, 1] — ses creux suivent les cellules
    shape[o] = b8(Math.max(0, remap(Math.max(0, Math.min(1, p * 0.5 + 0.5)), 0, 1, w4, 1)));
    shape[o + 1] = b8(w4);
    shape[o + 2] = b8(wfbm(x, y, z, 8, 211, 32));
    shape[o + 3] = b8(wfbm(x, y, z, 16, 307, 32));
  }
  const D = 32, detail = new Uint8Array(D * D * D * 4);
  for (let k = 0; k < D; k++) for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
    const x = i / D, y = j / D, z = k / D, o = ((k * D + j) * D + i) * 4;
    detail[o] = b8(wfbm(x, y, z, 2, 401, 16));
    detail[o + 1] = b8(wfbm(x, y, z, 4, 503, 16));
    detail[o + 2] = b8(wfbm(x, y, z, 8, 607, 16));
    detail[o + 3] = b8(perlin(x, y, z, 4, 709) * 0.5 + 0.5);
  }
  return { shape, shapeSize: S, detail, detailSize: D };
}
