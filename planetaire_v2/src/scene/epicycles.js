// De l'orbite à la machine. Une courbe plane z(t) = Σ c_k e^{ikt} est une
// somme de cercles : un bras de longueur |c_k| qui tourne à la vitesse k,
// porté par le bras précédent (Ptolémée, Fourier). Chaque k est un entier :
// chaque bras est mené par un rapport d'engrenage exact.
//
// On garde les bras les plus longs jusqu'à ce que le reste tienne sous
// TOL de la taille de l'orbite (au plus MAX bras) ; l'astre, lui, est posé
// sur l'orbite exacte.
import { curveAt } from '../orbit/action.js';

const TAU = Math.PI * 2;

// termes complexes (k ∈ ℤ) à partir des coefficients réels (D = 2)
export function complexTerms(coef, K) {
  const out = [];
  for (let k = 1; k <= K; k++) {
    const o = (k - 1) * 4, ax = coef[o], ay = coef[o + 1], bx = coef[o + 2], by = coef[o + 3];
    const p = [(ax + by) / 2, (ay - bx) / 2], m = [(ax - by) / 2, (ay + bx) / 2];
    out.push({ k, re: p[0], im: p[1], amp: Math.hypot(...p) });
    out.push({ k: -k, re: m[0], im: m[1], amp: Math.hypot(...m) });
  }
  return out.filter((t) => t.amp > 0);
}

export function epicycles(coef, params, size, { tol = 0.003, max = 8 } = {}) {
  const terms = complexTerms(coef, params.K).sort((a, b) => b.amp - a.amp);
  let rest = terms.reduce((s, t) => s + t.amp, 0);
  const arms = [];
  while (arms.length < terms.length && arms.length < max && rest > tol * size) {
    const t = terms[arms.length];
    arms.push(t); rest -= t.amp;
  }
  return { arms, residual: rest / size };
}

// pivots d'une chaîne au temps t (repère du plateau) : P₀ = 0, Pᵢ₊₁ = Pᵢ + c e^{ikt}
export function pivots(arms, t, out) {
  let x = 0, y = 0;
  out[0] = 0; out[1] = 0;
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], ang = a.k * t, c = Math.cos(ang), s = Math.sin(ang);
    x += a.re * c - a.im * s; y += a.re * s + a.im * c;
    out[2 * i + 2] = x; out[2 * i + 3] = y;
  }
  return out;
}

// échantillons de la courbe exacte (repère du plateau)
export function sampleCurve(coef, params, n) {
  const pts = new Float32Array(n * 2), pos = new Float64Array(2);
  for (let i = 0; i < n; i++) {
    curveAt(coef, params, (TAU * i) / n, pos);
    pts[2 * i] = pos[0]; pts[2 * i + 1] = pos[1];
  }
  return pts;
}
