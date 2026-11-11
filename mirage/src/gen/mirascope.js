// Le mirascope : deux miroirs paraboliques concaves face à face, le sommet de
// chacun au foyer de l'autre ; celui du haut est percé. Un objet posé au fond
// forme, après deux réflexions, une image réelle au-dessus de l'ouverture.
//
// Repère : y vertical (l'axe des coupes), origine au sommet de la coupe du
// bas. Mètres. f est la distance focale (= l'écart entre les deux sommets).
//   coupe du bas  : y = r² / 4f            (r ≤ R = √2·f, où les coupes se rejoignent)
//   coupe du haut : y = f + L − r² / 4f     (r_trou ≤ r ≤ R), L la levée du couvercle
// Une réflexion sur un paraboloïde : intersection d'un rayon et d'une quadrique
// (équation du second degré), normale par le gradient.
//
// Ce module sert aux tests, aux outils et au dessin du chargement ; le rendu
// refait exactement le même calcul en TSL (scene/raytrace.js).

export const PARAB = { f: 0.05, holeK: 0.42, rimK: Math.SQRT2 };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// intersection de o + t·d (t > eps) avec y = a·r² + b ; renvoie le plus petit t
// dont le point vérifie rMin ≤ r ≤ rMax
export function hitParab(o, d, a, b, rMin, rMax, eps = 1e-7) {
  const A = a * (d[0] * d[0] + d[2] * d[2]);
  const B = 2 * a * (o[0] * d[0] + o[2] * d[2]) - d[1];
  const C = a * (o[0] * o[0] + o[2] * o[2]) + b - o[1];
  const ts = [];
  if (Math.abs(A) < 1e-14) { if (Math.abs(B) > 1e-14) ts.push(-C / B); } else {
    const D = B * B - 4 * A * C;
    if (D < 0) return null;
    const s = Math.sqrt(D);
    ts.push((-B - s) / (2 * A), (-B + s) / (2 * A));
  }
  ts.sort((x, y) => x - y);
  for (const t of ts) {
    if (t <= eps) continue;
    const p = add(o, d, t), r = Math.hypot(p[0], p[2]);
    if (r >= rMin && r <= rMax) return { t, p, n: norm([2 * a * p[0], -1, 2 * a * p[2]]) };
  }
  return null;
}

export const reflect = (d, n) => { const k = 2 * dot(d, n); return [d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]; };

// les deux surfaces miroir intérieures
export function mirrors(f, L = 0, holeK = PARAB.holeK) {
  const R = PARAB.rimK * f, rh = holeK * f;
  return [
    { id: 'bas', a: 1 / (4 * f), b: 0, rMin: 0, rMax: R },
    { id: 'haut', a: -1 / (4 * f), b: f + L, rMin: rh, rMax: R },
  ];
}

// Suit un rayon dans la cavité : jusqu'à n réflexions ; s'arrête quand il ne
// rencontre plus de miroir (il sort par l'ouverture ou par le jour du couvercle
// levé). objet(o, d, tMax) → t ou null : un objet à l'intérieur.
export function traceCavity(o, d, f, L = 0, n = 8, objet = null) {
  const M = mirrors(f, L);
  let p = o, dir = norm(d);
  const path = [p];
  for (let k = 0; k <= n; k++) {
    let best = null;
    for (const m of M) { const h = hitParab(p, dir, m.a, m.b, m.rMin, m.rMax); if (h && (!best || h.t < best.t)) best = { ...h, m }; }
    if (objet) { const t = objet(p, dir, best ? best.t : Infinity); if (t !== null) { const q = add(p, dir, t); path.push(q); return { fate: 'objet', p: q, bounces: k, path, dir }; } }
    if (!best) return { fate: 'sortie', p, dir, bounces: k, path };
    p = best.p; dir = reflect(dir, best.n); path.push(p);
  }
  return { fate: 'piégé', p, dir, bounces: n, path };
}

// L'image réelle d'un point P du fond : les rayons qu'il émet vers le haut, deux
// fois réfléchis, sortent par l'ouverture ; on cherche le point le plus proche
// de tous ces rayons (moindres carrés) et l'étalement autour de lui.
export function imageOf(P, f, L = 0, nDirs = 400) {
  const rays = [];
  for (let i = 0; i < nDirs; i++) {
    // directions réparties sur l'hémisphère supérieur (Fibonacci)
    const yv = 0.05 + 0.95 * ((i + 0.5) / nDirs), phi = i * 2.39996323, s = Math.sqrt(1 - yv * yv);
    const res = traceCavity(P, [s * Math.cos(phi), yv, s * Math.sin(phi)], f, L, 6);
    if (res.fate === 'sortie' && res.bounces === 2 && res.dir[1] > 0) rays.push([res.p, res.dir]); // (sorti par l'ouverture après deux réflexions)
  }
  if (rays.length < 8) return null;
  // point qui minimise Σ distance² aux droites : (Σ (I − ddᵀ)) X = Σ (I − ddᵀ) p
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  for (const [p, d] of rays) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const m = (i === j ? 1 : 0) - d[i] * d[j]; A[i][j] += m; b[i] += m * p[j]; }
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A), X = [0, 1, 2].map((c) => det(A.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)))) / D);
  let spread = 0;
  for (const [p, d] of rays) { const w = add(X, p, -1), t = dot(w, d), q = add(w, d, -t); spread += dot(q, q); }
  return { X, spread: Math.sqrt(spread / rays.length), n: rays.length };
}
