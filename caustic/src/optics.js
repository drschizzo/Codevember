// Optique et hydrodynamique de l'eau — fonctions pures (Node et navigateur),
// sans three.js. Unités SI (mètres, secondes), longueurs d'onde en nm.

// Indice de réfraction de l'eau pure (Quan et Fry, 1995), à T °C :
// n = n0 + n4 T² + (n5 + n7 T)/λ + n8/λ² + n9/λ³ — 1,3330 à 589 nm et 20 °C.
export function nWater(lambda, T = 20) {
  return 1.31405 - 2.02e-6 * T * T + (15.868 - 0.00423 * T) / lambda - 4382 / (lambda * lambda) + 1.1455e6 / (lambda * lambda * lambda);
}

// Les trois longueurs d'onde du rendu (rouge, vert, bleu) et leurs indices
export const LAMBDAS = [630, 545, 465];
export const N_RGB = LAMBDAS.map((l) => nWater(l));

// Absorption de l'eau pure (Pope et Fry, 1997), m⁻¹ : le rouge s'éteint en
// premier — l'eau profonde est cyan.
export const ABSORB_RGB = [0.29, 0.055, 0.0145];

// Ondes de capillarité-gravité en profondeur finie :
// ω² = (g k + (σ/ρ) k³) tanh(k H)
export const GRAV = 9.81;
export const SIGMA_RHO = 7.28e-5; // tension superficielle / masse volumique (m³/s²)
export const NU = 1.0e-6; // viscosité cinématique (m²/s)
export function omega(k, depth) {
  return Math.sqrt((GRAV * k + SIGMA_RHO * k * k * k) * Math.tanh(k * depth));
}
// vitesse de groupe dω/dk (différence centrée)
export function groupVelocity(k, depth) {
  const e = k * 1e-4 + 1e-9;
  return (omega(k + e, depth) - omega(k - e, depth)) / (2 * e);
}
// amortissement visqueux de l'amplitude (Lamb) : γ = 2νk²
export const damping = (k) => 2 * NU * k * k;

// ── Vecteurs (tableaux [x, y, z]) ────────────────────────────────────────────
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Réfraction de Snell-Descartes (convention GLSL) : i incident unitaire, n
// normale unitaire tournée vers le milieu d'où vient i, eta = n1/n2.
// Renvoie null en réflexion totale.
export function refract(i, n, eta) {
  const c = dot(n, i);
  const k = 1 - eta * eta * (1 - c * c);
  if (k < 0) return null;
  const s = eta * c + Math.sqrt(k);
  return [eta * i[0] - s * n[0], eta * i[1] - s * n[1], eta * i[2] - s * n[2]];
}

// Facteur de Fresnel en réflexion, lumière non polarisée (cosI = cos de
// l'angle d'incidence, n1 → n2)
export function fresnel(cosI, n1, n2) {
  const ci = Math.min(1, Math.abs(cosI));
  const si = Math.sqrt(Math.max(0, 1 - ci * ci));
  const st = (n1 / n2) * si;
  if (st >= 1) return 1;
  const ct = Math.sqrt(1 - st * st);
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n1 * ct - n2 * ci) / (n1 * ct + n2 * ci);
  return 0.5 * (rs * rs + rp * rp);
}

// Normale qui envoie le rayon incident i (unitaire, dans l'air) dans la
// direction t (unitaire, dans l'eau) : n ∥ n1·i − n2·t, tournée vers le haut.
export function snellNormal(i, t, n1, n2) {
  const v = [n1 * i[0] - n2 * t[0], n1 * i[1] - n2 * t[1], n1 * i[2] - n2 * t[2]];
  const n = vnorm(v);
  return n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
}

// Convention du repère : y vers le haut ; la surface de l'eau au repos est
// y = 0, le fond y = −H ; le plan de la surface est (x, z).
