// Classes de symétrie (orbites planes). On écrit la courbe en complexe,
// z(t) = Σ_{k ∈ ℤ} c_k e^{ikt}, et l'on impose :
//
//   - une symétrie de rotation : z(t + 2π/m) = e^{2iπl/m} z(t), soit
//     c_k = 0 sauf si k ≡ l (mod m). La courbe a m pétales identiques ;
//   - éventuellement un miroir : z(−t) = conj z(t), soit c_k réels.
//
// L'action est invariante par ces symétries (repère tournant compris), donc,
// par le principe de criticité symétrique (Palais), un point critique de
// l'action restreinte au sous-espace est un point critique tout court : une
// vraie chorégraphie. Le minimum dans le sous-espace est en général un point
// selle de l'action complète, que la descente libre ne trouverait jamais.
// Avec l premier avec m et l ≢ ±1 (mod m), les fréquences ±1 sont exclues :
// le cercle de Lagrange n'est pas dans la classe.
//
// Coefficients réels (Aₖ, Bₖ) ↔ complexes : pour k ≥ 1,
//   c_k  = ((ax + by) + i (ay − bx)) / 2,   c_−k = ((ax − by) + i (ay + bx)) / 2.
// Ce changement de base est orthogonal (à un facteur près) : annuler des
// coordonnées complexes est une projection orthogonale.

const mod = (a, m) => ((a % m) + m) % m;

export function allowedFrequency(k, { N, sym }) {
  if (k === 0 || mod(k, N) === 0) return false;
  if (sym && sym.m > 1 && mod(k - sym.l, sym.m) !== 0) return false;
  return true;
}

// projette des coefficients réels (disposition de action.js, D = 2) sur la classe
export function project(c, p) {
  const { K, sym } = p;
  if (!sym || p.D !== 2) return c;
  for (let k = 1; k <= K; k++) {
    const o = (k - 1) * 4, ax = c[o], ay = c[o + 1], bx = c[o + 2], by = c[o + 3];
    let pr = (ax + by) / 2, pi = (ay - bx) / 2, mr = (ax - by) / 2, mi = (ay + bx) / 2;
    if (!allowedFrequency(k, p)) pr = pi = 0;
    if (!allowedFrequency(-k, p)) mr = mi = 0;
    if (sym.mirror) pi = mi = 0;
    c[o] = pr + mr; c[o + 3] = pr - mr; c[o + 1] = pi + mi; c[o + 2] = mi - pi;
  }
  return c;
}

// courbe de départ dans la classe : quelques fréquences permises dominantes
// (|k| ≤ 3N), un peu de toutes les autres, amplitude en 1/|k|
export function initialGuessSym(p, rng, K) {
  const freqs = [];
  for (let k = -K; k <= K; k++) if (allowedFrequency(k, p)) freqs.push(k);
  const low = freqs.filter((k) => Math.abs(k) <= Math.max(3, 3 * p.N));
  const dom = new Map();
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) dom.set(rng.pick(low), rng.range(0.4, 1));
  const c = new Float64Array(K * 4);
  for (const k of freqs) {
    const amp = (dom.get(k) ?? 0.06) / Math.abs(k);
    const re = amp * rng.gauss(), im = p.sym.mirror ? 0 : amp * rng.gauss();
    const o = (Math.abs(k) - 1) * 4;
    // ajoute c_k e^{ikt} : partie réelle en cos/sin selon le signe de k
    if (k > 0) { c[o] += re; c[o + 3] += re; c[o + 1] += im; c[o + 2] -= im; }
    else { c[o] += re; c[o + 3] -= re; c[o + 1] += im; c[o + 2] += im; }
  }
  return project(c, { ...p, K });
}

// plus basse fréquence permise de la classe (en valeur absolue)
export function lowestFrequency(p) {
  for (let a = 1; a < 200; a++) for (const k of [a, -a]) if (allowedFrequency(k, p)) return k;
  return 0;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Tirage d'une classe. Le minimum de l'action dans une classe est presque
// toujours le polygone de Lagrange tournant à la plus basse fréquence permise
// kmin… sauf si ce polygone est une collision, c'est-à-dire si kmin et N ont
// un diviseur commun (les corps j et j + N/d s'y superposent). Mesuré sur 300
// graines : ces classes donnent une orbite dans 100 % des cas, les autres dans
// 0 à 37 %. Elles n'existent que pour N composé (4, 6, 8, 9) ; pour N premier,
// on garde les classes à ±1 (moins fiables) ou pas de symétrie.
export function pickSymmetry(rng, N) {
  const good = [], weak = [];
  for (let m = 2; m <= 9; m++) {
    for (let l = 1; l < m; l++) {
      if (gcd(l, m) !== 1) continue;
      const k = lowestFrequency({ N, sym: { m, l } });
      if (!k || Math.abs(k) > 2 * N) continue;
      (gcd(Math.abs(k), N) > 1 ? good : weak).push({ m, l });
    }
  }
  let pick = null, isWeak = false;
  if (good.length && rng.chance(0.85)) pick = rng.pick(good);
  else if (weak.length && rng.chance(0.5)) { pick = rng.pick(weak); isWeak = true; }
  return pick && { ...pick, mirror: rng.chance(0.5), weak: isWeak };
}

// classes proposées au panneau pour N corps : [{ m, l, weak }]
export function symmetryOptions(N) {
  const out = [];
  for (let m = 2; m <= 9; m++) {
    for (let l = 1; l < m; l++) {
      if (gcd(l, m) !== 1) continue;
      const k = lowestFrequency({ N, sym: { m, l } });
      if (!k || Math.abs(k) > 2 * N) continue;
      out.push({ m, l, weak: gcd(Math.abs(k), N) === 1 });
    }
  }
  return out;
}
