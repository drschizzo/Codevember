// Hasard reproductible : toute la scène découle d'une graine (?seed=…).
// Ce module ne dépend de rien (il est aussi chargé par les workers).

// sfc32 : rapide, bonne qualité statistique, état sur 128 bits
export function createRng(seed) {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = hashSeed(seed);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next(); // (on chauffe l'état)
  const rng = {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // bornes incluses
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // choix pondéré : [[valeur, poids], …]
    weighted: (pairs) => {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let r = next() * total;
      for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
      return pairs[pairs.length - 1][0];
    },
    gauss: () => { // Box–Muller
      const u = Math.max(1e-9, next()), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // direction uniforme sur la sphère
    dir: () => {
      const z = next() * 2 - 1, t = next() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      return [s * Math.cos(t), s * Math.sin(t), z];
    },
    fork: (salt) => createRng(`${seed}:${salt}`),
  };
  return rng;
}

// graine (nombre ou texte) → entier 32 bits (FNV-1a + mélange final)
export function hashSeed(seed) {
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

// Bruit de gradient 3D (Perlin amélioré) à permutation tirée de la graine,
// et sa version fractale. Sert au CPU : variation des trous, cristaux.
export function createNoise3(seed) {
  const rng = createRng(`noise:${seed}`);
  const p = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  const noise = (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(l(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u),
        l(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
      l(l(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u),
        l(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
  };
  const fbm = (x, y, z, oct = 4) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
    return s;
  };
  return { noise, fbm };
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

// ── Décalages du rendu accumulé (voir render/accum.js) ───────────────────────
// suite de Halton (base b), décalée d'une rotation r propre à l'image
const halton = (i, b) => { let f = 1, r = 0; for (let k = i + 1; k > 0; k = Math.floor(k / b)) { f /= b; r += f * (k % b); } return r; };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// décalages du rendu i de l'image `frame` : temps (−½ … ½), lentille et lampe
// (disques de rayon 1), pixel (−½ … ½)
export function jitter(i, frame = 0) {
  const u = (b, k) => { const v = halton(i, b) + hash(frame * 7 + k); return v - Math.floor(v); };
  const disc = (a, b) => { const r = Math.sqrt(a), t = 2 * Math.PI * b; return [r * Math.cos(t), r * Math.sin(t)]; };
  return { time: u(2, 0) - 0.5, lens: disc(u(3, 1), u(5, 2)), pixel: [u(7, 3) - 0.5, u(11, 4) - 0.5], light: disc(u(13, 5), u(17, 6)) };
}
