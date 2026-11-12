// La table à érosion : dimensions, strates du sable, surface laissée par le
// gabarit, et calendrier de chaque famille (sources, pluie, niveau de base).
// Module pur (sans three.js) : la simulation de référence (gen/sim.js), la
// simulation sur GPU (scene/gpusim.js), le rendu et les tests le partagent.
//
// Repère : x le long du bac (l'amont en x = 0, l'eau descend vers +x), y en
// travers, z la hauteur au-dessus du fond du bac. Mètres et secondes.

export const TABLE = {
  Lx: 1.28, Ly: 0.64, // bac utile (m)
  wall: 0.172,        // hauteur des parois au-dessus du fond
  NX: 512, NY: 256,   // grille de simulation (cellules de 2,5 mm) ; mobile : moitié
};

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ── Hachage et bruit de valeur (déterministes, sans état) ─────────────────────
export function hash2(i, j, s) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}
export const fbm = (x, y, s, oct = 4) => {
  let a = 0, w = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { a += w * vnoise(x * f, y * f, s + o * 17); f *= 2.03; w *= 0.5; }
  return a;
};

// ── Les strates ──────────────────────────────────────────────────────────────
// Le bac est rempli couche par couche, chacune régalée par le même gabarit :
// les strates sont parallèles à la surface de départ. Une couche se repère
// donc par sa profondeur sous b₀ : { bottom (m sous b₀), hard (0–0,9), tone
// (indice de couleur dans l'accord) }, de la surface vers le fond. La dureté
// réduit l'arrachement : les couches dures font des corniches.
export const MAX_LAYERS = 12;
export function layerAt(strata, depth) {
  for (let k = 0; k < strata.length; k++) if (depth <= strata[k].bottom) return k;
  return strata.length - 1;
}
// dureté adoucie à la frontière entre deux couches (0,6 mm), pour que la
// simulation ne voie pas de marche
export function hardnessAt(strata, depth) {
  const k = layerAt(strata, depth);
  const h = strata[k].hard;
  if (k + 1 < strata.length) { const t = sstep(strata[k].bottom - 0.0006, strata[k].bottom + 0.0006, depth); return lerp(h, strata[k + 1].hard, t); }
  return h;
}

// ── La surface du gabarit ────────────────────────────────────────────────────
// Le portique pousse une lame profilée (profil en travers P(y)) dont la
// hauteur suit un programme le long du bac Z(x) : b₀(x, y) = Z(x) + P(y),
// plus la micro-topographie que la lame laisse (stries dans le sens du
// passage, ondulations de quelques dixièmes de mm) — les germes des rigoles.
export function longProfile(form, x) {
  const F = form;
  switch (F.kind) {
    case 'lac': { // pente, rupture, lac
      const z = F.z0 - F.slope * x;
      const drop = sstep(F.xs, F.xs + F.ws, x);
      return lerp(z, F.floor, drop);
    }
    case 'talus': { // plateau, escarpement, glacis
      const zp = F.z0 - 0.01 * x;
      const ze = F.zb + 0.02 * (TABLE.Lx - x);
      const t = sstep(F.xs, F.xs + F.ws, x);
      return lerp(zp, ze, t);
    }
    case 'barrage': { // cuvette amont, digue, pente aval
      const zd = F.zd - F.slope * (x - F.xd);
      const pond = F.floor;
      const crest = F.crest;
      const up = sstep(F.xd - F.wd - 0.035, F.xd - F.wd, x);       // face amont
      const down = 1 - sstep(F.xd + F.wd, F.xd + F.wd + 0.05, x);   // face aval
      const zIn = lerp(pond, crest, up);
      const zOut = lerp(Math.min(zd, crest), crest, down);
      return x < F.xd ? zIn : zOut;
    }
    default: return F.z0 - F.slope * x;
  }
}
export function crossProfile(form, y) {
  const c = (y - TABLE.Ly / 2) / (TABLE.Ly / 2); // −1 … 1
  const v = form.vee ?? 0;     // creux central (m)
  const tilt = form.tilt ?? 0; // dévers (m d'un bord à l'autre)
  // nez de la lame : un chenal pilote (ou l'échancrure de la digue), arrondi
  const nd = form.notchD ?? 0, nw = form.notchW ?? 0.03, ny = form.notchY ?? TABLE.Ly / 2;
  const notch = nd ? -nd * Math.exp(-(((y - ny) / (nw / 2)) ** 2)) : 0;
  return -v * (1 - c * c) * (1 - 0.35 * c * c) + 0.5 * tilt * c + notch;
}
// micro-topographie du gabarit (m) : ondulations + stries
export function screedMarks(x, y, seed, amp) {
  const s = seed | 0;
  const und = fbm(x * 9, y * 9, s, 4) * amp;
  const streak = (vnoise(y * 260, x * 6, s + 101) * 0.6 + vnoise(y * 610, x * 3, s + 202) * 0.4) * amp * 0.08;
  return und + streak;
}
export function b0At(form, x, y, seed) {
  return longProfile(form, x) + crossProfile(form, y) + screedMarks(x, y, seed, form.rough ?? 0.0006);
}
export function initialTerrain(form, NX, NY, seed) {
  const l = TABLE.Lx / NX, b = new Float32Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) b[j * NX + i] = b0At(form, (i + 0.5) * l, (j + 0.5) * l, seed);
  return b;
}

// ── Les familles ─────────────────────────────────────────────────────────────
// Chaque famille : la forme du gabarit, le calendrier en temps hydraulique T
// (sources, pluie, niveau de base), le facteur d'accélération morphologique
// (MORFAC : l'eau coule à sa vitesse, le relief change en accéléré), la durée.
export const FAMILIES = {
  ravines: { label: 'Ravines', gesture: 'la pluie : des rigoles naissent au pied de l\'escarpement et remontent en se ramifiant' },
  delta: { label: 'Delta', gesture: 'un courant : le chenal creuse l\'amont et construit un éventail qui bascule dans le lac' },
  recul: { label: 'Recul', gesture: 'le niveau de base baisse par crans : une marche remonte la vallée et laisse des terrasses' },
  breche: { label: 'Brèche', gesture: 'le lac déborde : la brèche s\'élargit en accélérant et le lac se vide en crue' },
};

// calendrier d'une famille, tiré de la recette (voir recipe.js) :
// { T (durée hydraulique), inflow: [{ t0, t1, q }], rain: { t0, t1, rate, x0, x1 },
//   base: [[t, niveau], …] (interpolé linéairement), morfac, src: { x, y, w } }
export function inflowAt(S, T) {
  let q = 0;
  for (const f of S.inflow ?? []) q += f.q * sstep(f.t0, f.t0 + 0.6, T) * (1 - sstep(f.t1, f.t1 + 1.2, T));
  return q; // m³/s
}
export function rainAt(S, T) {
  const r = S.rain;
  if (!r) return 0;
  return r.rate * sstep(r.t0, r.t0 + 1.0, T) * (1 - sstep(r.t1, r.t1 + 1.0, T)); // m/s
}
export function baseAt(S, T) {
  const B = S.base;
  if (T <= B[0][0]) return B[0][1];
  for (let k = 1; k < B.length; k++) {
    if (T <= B[k][0]) {
      const t = (T - B[k - 1][0]) / (B[k][0] - B[k - 1][0]);
      return lerp(B[k - 1][1], B[k][1], t * t * (3 - 2 * t)); // (la vanne descend en douceur)
    }
  }
  return B[B.length - 1][1];
}

// Forme du gabarit et calendrier d'une famille. t : tirages continus de la recette.
export function familySpec(family, t = {}) {
  const k = (name, d) => t[name] ?? d;
  switch (family) {
    case 'ravines': {
      const form = { kind: 'talus', z0: k('z0', 0.128), zb: 0.052, xs: k('xs', 0.42), ws: k('ws', 0.22), vee: 0.004, tilt: k('tilt', 0), rough: 0.0008 };
      return {
        form, T: 24, morfac: k('morfac', 40),
        rain: { t0: 0.8, t1: 15, rate: k('rain', 0.00035), x0: 0.0, x1: 1.24 },
        base: [[0, 0.03], [24, 0.03]],
        drain: 15,
      };
    }
    case 'delta': {
      const form = { kind: 'lac', z0: 0.118, slope: k('slope', 0.035), floor: 0.046, xs: k('xs', 0.74), ws: 0.09, vee: k('vee', 0.008), tilt: k('tilt', 0), rough: 0.0006, notchD: k('notchD', 0.01), notchW: 0.035, notchY: k('srcY', 0.32) };
      const lake = 0.071;
      return {
        form, T: 25, morfac: k('morfac', 50),
        inflow: [{ t0: 1.6, t1: 19, q: k('q', 0.00012) }],
        src: { x: 0.012, y: k('srcY', 0.32), w: k('srcW', 0.03) },
        base: [[0, 0.03], [0.3, 0.03], [1.8, lake], [19.4, lake], [22.5, 0.03]],
        drain: 19,
      };
    }
    case 'recul': {
      const form = { kind: 'lac', z0: 0.118, slope: k('slope', 0.03), floor: 0.044, xs: k('xs', 0.86), ws: 0.07, vee: k('vee', 0.01), tilt: k('tilt', 0), rough: 0.0006, notchD: k('notchD', 0.01), notchW: 0.04, notchY: k('srcY', 0.32) };
      const L0 = 0.076, steps = k('steps', 2), drop = (L0 - 0.048) / steps;
      const base = [[0, 0.03], [0.3, 0.03], [1.8, L0]];
      for (let s = 0; s < steps; s++) { const t0 = 6.5 + s * (11 / steps); base.push([t0, L0 - s * drop], [t0 + 1.2, L0 - (s + 1) * drop]); }
      base.push([19.4, L0 - steps * drop], [22.5, 0.03]);
      return {
        form, T: 25, morfac: k('morfac', 50),
        inflow: [{ t0: 1.6, t1: 19, q: k('q', 0.00014) }],
        src: { x: 0.012, y: k('srcY', 0.32), w: k('srcW', 0.03) },
        base, drain: 19,
      };
    }
    case 'breche': {
      const form = { kind: 'barrage', floor: 0.088, crest: 0.118, xd: k('xd', 0.40), wd: 0.012, zd: 0.10, slope: 0.045, vee: k('vee', 0.005), tilt: k('tilt', 0), rough: 0.0005, notchD: k('notchD', 0.014), notchW: 0.06, notchY: k('notchY', 0.32) };
      return {
        form, T: 26, morfac: k('morfac', 30),
        inflow: [{ t0: 0.8, t1: 20, q: k('q', 0.0005) }],
        src: { x: 0.012, y: k('srcY', 0.32), w: 0.08 },
        base: [[0, 0.03], [26, 0.03]],
        drain: 20,
      };
    }
  }
  throw new Error(`famille inconnue : ${family}`);
}
