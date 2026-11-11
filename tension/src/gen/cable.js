// Câble mou : un câble de longueur au repos L entre deux points distants de d
// (d < L) pend en arc de parabole (la chaînette, pour une flèche modérée) dont
// la longueur d'arc vaut L. Longueur de l'arc de flèche f sur la corde d :
//   ℓ(f) = ½·√(d² + 16 f²) + d²/(8 f)·asinh(4 f / d)
// ℓ croît avec f : une dichotomie donne f. Même formule que le vertex shader
// (scene/cables.js) ; fonctions pures, testées.
export function arcLength(d, f) {
  if (f < 1e-9) return d;
  return 0.5 * Math.sqrt(d * d + 16 * f * f) + (d * d) / (8 * f) * Math.asinh((4 * f) / d);
}
export function sagOf(d, L) {
  if (!(L > d) || d < 1e-6) return 0;
  let lo = 0, hi = Math.max(L, d);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (arcLength(d, mid) < L) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
