// La roche (module pur) : un relief fin calculé une fois, dans un worker, et
// lu deux fois sur le GPU — en déplacement des sommets d'un maillage dense
// (vertex shader) et en normal map au pixel —, avec une carte de couleur
// minérale issue du même calcul.
//
// Granit : dalles séparées par des fissures nettes (diaclases, cellules de
// Voronoï), surface grenue et usée, grains de quartz, de feldspath et de
// biotite, taches d'oxydes, lichens crustacés en rosettes lobées.
// Calcaire : surface douce creusée de cupules de dissolution et de
// cannelures (karren), veines, lichens noirs ponctués.
// Grès : lits superposés (stratification) qui font des marches, grains,
// bandes ocre et rouille.
// Sol : grumeaux, gravillons, aiguilles et débris.
//
// La même fonction donne le relief à la mousse (gen/colony.js : chaque tige
// est plantée sur la vraie surface) et à l'habitat (field.js : les fissures
// gardent l'eau, la mousse y survit à la sécheresse).
import { createNoise3, smoothstep as sst, hashSeed } from '../rng.js';

const fract = (x) => x - Math.floor(x);
const h2 = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };

// Worley 2D sur grille (cellule de taille c) : F1, F2, identifiant de la cellule la plus proche
function worley(x, z, c, s, jit = 0.9) {
  const gx = Math.floor(x / c), gz = Math.floor(z / c);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j;
    const px = (cx + 0.5 + (h2(cx, cz, s) - 0.5) * jit) * c, pz = (cz + 0.5 + (h2(cx, cz, s + 1) - 0.5) * jit) * c;
    const d = Math.hypot(x - px, z - pz);
    if (d < f1) { f2 = f1; f1 = d; id = h2(cx, cz, s + 2); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}

export const ROCKS = {
  granite: { label: 'Granit', plate: 7.5, crack: 0.3, crackW: 0.16, rough: 0.09, grain: 0.12 },
  limestone: { label: 'Calcaire', plate: 9, crack: 0.22, crackW: 0.12, rough: 0.05, grain: 0.05 },
  sandstone: { label: 'Grès', plate: 9, crack: 0.2, crackW: 0.14, rough: 0.06, grain: 0.14 },
  bark: { label: 'Écorce', plate: 3.0, crack: 0.3, crackW: 0.2, rough: 0.04, grain: 0.1, refuge: 0.12 },
  soil: { label: 'Terre', plate: 3.0, crack: 0.05, crackW: 0.2, rough: 0.05, grain: 0.15, refuge: 0.3 },
};

// relief de détail D(x, z) (cm), et ce qu'il faut pour la couleur
export function makeRock(type, seed) {
  const K = ROCKS[type] ?? ROCKS.granite, s = hashSeed(`rock:${seed}`) % 997;
  const N = createNoise3(`rock:${seed}`);
  const warp = (x, z) => [x + 0.35 * N.noise(x * 0.4, 1.3, z * 0.4), z + 0.35 * N.noise(x * 0.4, 7.1, z * 0.4)];
  // sample : relief et attributs au point (x, z)
  function sample(x, z) {
    if (type === 'bark') return barkSample(x, z);
    const [wx, wz] = warp(x, z);
    const [f1, f2, id] = worley(wx, wz, K.plate, s);
    const edge = f2 - f1;
    // fissure : arrondie par l'usure (épaules en gaussienne), plus profonde par endroits
    const cw = K.crackW * (0.55 + 0.9 * sst(-0.3, 0.5, N.noise(x * 0.35, 3.3, z * 0.35)));
    const crack = Math.exp(-((edge / cw) ** 2));
    const plate = (id - 0.5) * 0.12 * (type === 'soil' ? 0 : 1);
    // usure à trois échelles : bosses (cm), crêtes (mm), grain
    const wear = N.fbm(x * 0.45, 0.7, z * 0.45, 4) * K.rough * 3;
    const ridge = (1 - Math.abs(N.noise(x * 2.4, 9.1, z * 2.4))) * 0.018 * (K.rough / 0.07);
    const gran = N.fbm(x * 9, 4.4, z * 9, 2) * 0.008;
    let d = plate + wear + ridge + gran - crack * K.crack;
    let extra = 0;
    if (type === 'limestone') {
      // cupules de dissolution (bords nets, fond rond) et cannelures
      const [p1, , pid] = worley(x, z, 1.1, s + 5, 1);
      const pit = pid > 0.62 ? sst(0.3, 0.12, p1) : 0;
      d -= pit * 0.05 * (0.6 + pid);
      d += Math.sin(x * 1.6 + N.noise(x * 0.3, 2, z * 0.3) * 5) * 0.01;
      extra = pit;
    } else if (type === 'sandstone') {
      // lits : ondulations douces de la stratification
      const t = (x * 0.8 + z * 0.6) * 0.9 + N.fbm(x * 0.15, 4, z * 0.15, 3) * 2.5;
      d += (0.5 - 0.5 * Math.cos(t * 6.2832)) * 0.018;
      extra = fract(t);
    } else if (type === 'soil') {
      const [p1, , pid] = worley(x, z, 0.35, s + 7, 1);
      const pebble = pid > 0.82 ? Math.sqrt(Math.max(0, 1 - (p1 / 0.13) ** 2)) * 0.07 : 0;
      d += pebble + N.fbm(x * 2, 5, z * 2, 3) * 0.03;
      extra = pebble > 0 ? 1 : 0;
    }
    // grain fin
    d += N.noise(x * 22, 1.1, z * 22) * 0.004 * K.grain * 10;
    return { d, crack, edge, id, extra };
  }
  // écorce (x le long du tronc, z autour) : sillons longitudinaux, plaques
  // fendues en travers, lambeaux arrachés qui montrent le bois
  function barkSample(x, z) {
    // sillons : fissures longitudinales irrégulières qui se rejoignent (réseau
    // en losanges très étirés), crêtes arrondies, fibres le long du tronc
    const wz = z + 0.5 * N.noise(x * 0.1, 2.2, z * 0.3) + 0.2 * N.noise(x * 0.35, 5.1, z * 0.8);
    const [c1, c2] = worley(x * 0.2, wz * 2.4, 1.0, s + 3, 0.95);
    const e = c2 - c1;
    const furrow = Math.exp(-(e / 0.11));                         // 1 au fond du sillon (en V)
    const ridge = sst(0.05, 0.45, e) * 0.03 + Math.abs(N.noise(x * 1.5, 6.6, wz * 3)) * 0.02; // crêtes usées, écailleuses
    const fib = Math.sin(wz * 34 + N.noise(x * 0.6, 8.2, z * 3) * 4) * 0.004 + N.fbm(x * 1.2, 3, wz * 7, 3) * 0.012;
    const peel = sst(0.33, 0.42, N.fbm(x * 0.08, 7.7, z * 0.16, 3)); // bois mis à nu
    let d = -furrow * 0.2 + ridge + fib * 1.8 * (1 - furrow);
    const wood = -0.38 + Math.sin(z * 46 + N.noise(x * 0.5, 9, z * 4) * 3) * 0.004 + N.noise(x * 0.4, 8, z * 6) * 0.012;
    d = d * (1 - peel) + wood * peel;
    return { d, crack: furrow * (1 - peel), edge: e, id: peel, extra: furrow };
  }
  return { sample, type, K, noise: N };
}

// float → demi-flottant (IEEE 754 binaire16)
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function toHalf(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return sgn | (e << 10) | (m >> 13);
}

// cartes : M × M texels sur [−X, X]² — relief (R : D, G B : pente, A :
// occlusion des creux) en demi-flottants, couleur minérale (RGB) et rugosité (A)
export function bakeRock(type, seed, X, M = 1024, palette = null) {
  const rock = makeRock(type, seed), N = rock.noise;
  const D = new Float32Array(M * M), C = new Float32Array(M * M), E = new Float32Array(M * M), I = new Float32Array(M * M), Xx = new Float32Array(M * M);
  const px = (2 * X) / M;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -X + (i + 0.5) * px, z = -X + (j + 0.5) * px, o = rock.sample(x, z), k = j * M + i;
    D[k] = o.d; C[k] = o.crack; E[k] = o.edge; I[k] = o.id; Xx[k] = o.extra;
  }
  // occlusion : creux sous la moyenne locale (flou de boîte, deux échelles)
  const blur = (A, r) => {
    const T = new Float32Array(M * M), O = new Float32Array(M * M);
    for (let j = 0; j < M; j++) { let s = 0; for (let i = -r; i <= r; i++) s += A[j * M + Math.min(M - 1, Math.max(0, i))]; for (let i = 0; i < M; i++) { T[j * M + i] = s / (2 * r + 1); s += A[j * M + Math.min(M - 1, i + r + 1)] - A[j * M + Math.max(0, i - r)]; } }
    for (let i = 0; i < M; i++) { let s = 0; for (let j = -r; j <= r; j++) s += T[Math.min(M - 1, Math.max(0, j)) * M + i]; for (let j = 0; j < M; j++) { O[j * M + i] = s / (2 * r + 1); s += T[Math.min(M - 1, j + r + 1) * M + i] - T[Math.max(0, j - r) * M + i]; } }
    return O;
  };
  const B1 = blur(D, 3), B2 = blur(D, 14);
  const rel = new Uint16Array(M * M * 4), col = new Uint8Array(M * M * 4);
  const P = palette ?? ROCK_PALETTES[type];
  const c3 = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const base = c3(P.base), dark = c3(P.dark), light = c3(P.light), stain = c3(P.stain), lich = P.lichens.map(c3);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i, x = -X + (i + 0.5) * px, z = -X + (j + 0.5) * px;
    const gx = (D[j * M + Math.min(M - 1, i + 1)] - D[j * M + Math.max(0, i - 1)]) / (2 * px);
    const gz = (D[Math.min(M - 1, j + 1) * M + i] - D[Math.max(0, j - 1) * M + i]) / (2 * px);
    const cav = Math.max(0, B1[k] - D[k]) * 18 + Math.max(0, B2[k] - D[k]) * 5;
    const ao = Math.max(0.15, 1 - cav);
    rel[k * 4] = toHalf(D[k]); rel[k * 4 + 1] = toHalf(gx); rel[k * 4 + 2] = toHalf(gz); rel[k * 4 + 3] = toHalf(ao);
    // couleur minérale
    let r = base[0], g = base[1], b = base[2], rough = 0.72;
    const mix = (c, t) => { r += (c[0] - r) * t; g += (c[1] - g) * t; b += (c[2] - b) * t; };
    // variation lente (altération), taches d'oxydes
    const n1 = N.fbm(x * 0.3, 2.2, z * 0.3, 3), n2 = N.fbm(x * 1.4, 8.3, z * 1.4, 3);
    mix(n1 > 0 ? light : dark, Math.min(1, Math.abs(n1) * 1.2));
    mix(stain, sst(0.15, 0.45, N.fbm(x * 0.5, 13, z * 0.5, 3)) * 0.55);
    if (type === 'granite') {
      // grains : quartz gris translucide, feldspath blanc rosé, biotite noire
      // mosaïque de cristaux (1 à 2 mm) : biotite noire, feldspath laiteux, quartz gris vitreux
      const [g1, g2, gid] = worley(x + 0.015 * N.noise(x * 40, 1, z * 40), z, 0.07, 31, 1);
      const joint = sst(0.0, 0.006, g2 - g1);
      if (gid < 0.1) { mix([0.12, 0.115, 0.11], 0.4 * joint); rough = 0.5; }
      else if (gid < 0.42) mix(c3(P.feldspar ?? '#d8c8bc'), 0.16 * joint);
      else if (gid < 0.65) { mix([0.52, 0.54, 0.57], 0.12 * joint); rough = 0.42; }
    } else if (type === 'limestone') {
      mix(dark, Xx[k] * 0.35);
      // veines de calcite
      const v = Math.abs(Math.sin(x * 1.3 + z * 0.4 + n2 * 6));
      mix(light, sst(0.985, 1, v) * 0.6);
    } else if (type === 'sandstone') {
      const band = Math.sin(Xx[k] * 6.283 + n2 * 1.5) * 0.5 + 0.5;
      mix(stain, band * 0.22);
      const [, , gid] = worley(x, z, 0.035, 41, 1);
      mix(gid < 0.3 ? dark : light, 0.12);
    } else if (type === 'soil') {
      if (Xx[k] > 0) mix(light, 0.6);
      const [, , gid] = worley(x, z, 0.06, 43, 1);
      mix(gid < 0.25 ? dark : base, 0.4);
    }
    if (type === 'bark') {
      const peel = I[k];
      // écorce gris-brun, crêtes plus claires et verdies d'algues (Pleurococcus), sillons sombres
      mix(light, (1 - Xx[k]) * 0.18);
      mix([0.3, 0.36, 0.17], sst(0.3, 0.8, n1 + 0.5) * (1 - Xx[k]) * 0.4);
      // bois mis à nu : fauve, fibres, bord de l'écorce sombre et relevé
      mix(c3(P.wood), peel * 0.9);
      mix([0.35, 0.2, 0.1], peel * Math.abs(n2) * 0.6);
      if (peel > 0) rough = rough + (0.5 - rough) * peel;
    }
    // les fissures accumulent la terre et l'humus
    mix([0.06, 0.045, 0.03], C[k] * 0.85);
    // lichens crustacés : petites rosettes lobées, rares, à thalle aréolé
    // (craquelé en petites plaques), bord plus clair ; hors des fissures
    if (lich.length) {
      for (let L = 0; L < lich.length; L++) {
        const cell = (L === 0 ? 2.4 : 1.3) + L * 0.5;
        const [f1, , lid] = worley(x, z, cell, 51 + L * 13, 1);
        if (lid > (P.lichenCover ?? 0.15)) continue;
        const ang = Math.atan2(z, x);
        const lobes = Math.min(0.36, 0.22 + 0.15 * lid / 0.15 * 0.6 + 0.04 * Math.sin(ang * 11 + lid * 40) + 0.06 * N.noise(x * 4, L * 5.5, z * 4));
        const rr = f1 / cell;
        const inside = sst(lobes, lobes - 0.025, rr) * (1 - C[k]);
        if (inside > 0) {
          const [a1, a2] = worley(x, z, 0.06, 71 + L, 1);
          const areole = sst(0.0, 0.012, a2 - a1);
          const c = lich[L], var_ = 0.75 + 0.35 * N.noise(x * 6, L * 3.1, z * 6);
          mix([c[0] * var_, c[1] * var_, c[2] * var_], inside * (0.35 + 0.55 * areole));
          mix([0.92, 0.92, 0.85], sst(lobes - 0.06, lobes - 0.02, rr) * inside * 0.12);
          // apothécies : petits disques noirs semés dans le thalle (Lecidea, Rhizocarpon)
          if (P.dots && P.dots[L]) {
            const [q1, , qid] = worley(x, z, 0.055, 91 + L, 1);
            if (qid < 0.55) mix([0.04, 0.04, 0.035], sst(0.016 + 0.01 * qid, 0.008, q1) * inside * 0.95);
          }
          rough = rough + (0.92 - rough) * inside;
        }
      }
    }
    // algues et mousse grise des endroits humides (près des fissures, au creux)
    mix([0.24, 0.27, 0.16], sst(0.2, 0.7, C[k] * 0.6 + cav * 2) * 0.35);
    r *= 0.55 + 0.45 * ao; g *= 0.55 + 0.45 * ao; b *= 0.55 + 0.45 * ao;
    col[k * 4] = Math.round(Math.min(1, r) * 255); col[k * 4 + 1] = Math.round(Math.min(1, g) * 255); col[k * 4 + 2] = Math.round(Math.min(1, b) * 255); col[k * 4 + 3] = Math.round(rough * 255);
  }
  return { rel, col, M, X };
}

// couleurs (sRGB) : fond, clair, sombre, taches, lichens
export const ROCK_PALETTES = {
  granite: { base: '#83857a', light: '#a9ab9f', dark: '#585c4e', stain: '#727c58', feldspar: '#c9c8bc', lichens: ['#d6dad0', '#a4ab98', '#c2c08a'], dots: [1, 0, 0], lichenCover: 0.3 },
  limestone: { base: '#b8b4a2', light: '#dcd8c8', dark: '#7e7c6c', stain: '#8c9468', lichens: ['#e2e2d8', '#2a2a28', '#d9b84a'], dots: [1, 0, 0], lichenCover: 0.25 },
  sandstone: { base: '#b08a64', light: '#cfac84', dark: '#7a5a3e', stain: '#a2603a', lichens: ['#a8b098', '#c8a838'], lichenCover: 0.12 },
  bark: { base: '#3c342d', light: '#6e675c', dark: '#1a1512', stain: '#4e5a30', wood: '#b07a48', lichens: ['#9aa48a', '#7a8a5a'], dots: [0, 0], lichenCover: 0.07 },
  soil: { base: '#4a3a2c', light: '#8a7a68', dark: '#2a2018', stain: '#5a3e24', lichens: [], lichenCover: 0 },
};
