// Lumière d'un corps noir : la couleur et la luminance de la lave à sa
// température, calculées (loi de Planck intégrée sur les fonctions
// colorimétriques CIE 1931, approchées par Wyman, Sloan et Shirley 2013),
// en radiance linéaire sRGB, à la même échelle que le soleil et le ciel.
//
// Module pur (Node, workers, page).

const hP = 6.62607015e-34, cL = 2.99792458e8, kB = 1.380649e-23;

// lobes asymétriques (Wyman et al. 2013, ajustement « multi-lobes »)
const g = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
export const cie = (l) => [
  1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
  0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
  1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
];

// radiance spectrale (W · sr⁻¹ · m⁻² · nm⁻¹) à la longueur d'onde l (nm), T (K)
export function planck(l, T) {
  const m = l * 1e-9;
  return (2 * hP * cL * cL) / m ** 5 / Math.expm1((hP * cL) / (m * kB * T)) * 1e-9;
}

// XYZ (Y en cd/m²) d'un corps noir d'émissivité eps
export function blackbodyXYZ(T, eps = 1) {
  const s = [0, 0, 0];
  for (let l = 380; l <= 780; l += 2) {
    const b = planck(l, T) * 2, c = cie(l);
    s[0] += b * c[0]; s[1] += b * c[1]; s[2] += b * c[2];
  }
  return s.map((v) => v * 683 * eps);
}

// XYZ → sRGB linéaire (D65)
export const xyzToRgb = ([X, Y, Z]) => [
  3.2406 * X - 1.5372 * Y - 0.4986 * Z,
  -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
  0.0557 * X - 0.2040 * Y + 1.0570 * Z,
].map((v) => Math.max(0, v));

// Échelle de la scène : une unité de radiance = SCALE cd/m². Le soleil, le
// ciel et la lave partagent cette échelle (la lave n'éblouit pas en plein
// jour ; la nuit, elle éclaire tout).
export const SCALE = 1000;

// table de radiance (unités de scène, sRGB linéaire) de T0 à T1 (K), n pas
export function emissionLUT(n = 256, T0 = 700, T1 = 1500, eps = 0.95) {
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const T = T0 + ((T1 - T0) * i) / (n - 1);
    const rgb = xyzToRgb(blackbodyXYZ(T, eps));
    out.set([rgb[0] / SCALE, rgb[1] / SCALE, rgb[2] / SCALE, T], i * 4);
  }
  return out;
}
