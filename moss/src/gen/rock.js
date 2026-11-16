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
import { createNoise3, smoothstep as sst, hashSeed } from '../../../shared/rng.js';

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
    // (un réseau de diaclases fermé fait un ballon de cuir : les fissures
    // s'éteignent par endroits, la roche reste d'un seul tenant entre elles)
    const live = type === 'soil' ? 1 : sst(-0.05, 0.25, N.noise(x * 0.14, 5.5, z * 0.14));
    // (la terre n'a pas de fissures visibles : ses refuges sont des creux
    // entre les grumeaux ; edge les garde pour l'habitat, field.js)
    const crack = type === 'soil' ? 0 : Math.exp(-((edge / cw) ** 2)) * live;
    const plate = (id - 0.5) * 0.12 * (type === 'soil' ? 0 : live);
    // usure à trois échelles : bosses (cm), crêtes (mm), grain
    const wear = N.fbm(x * 0.45, 0.7, z * 0.45, 4) * K.rough * 3;
    const ridge = (1 - Math.abs(N.noise(x * 2.4, 9.1, z * 2.4))) * 0.018 * (K.rough / 0.07);
    const gran = N.fbm(x * 9, 4.4, z * 9, 2) * 0.008;
    let d = plate + wear + ridge + gran - crack * K.crack;
    let extra = 0;
    if (type === 'limestone') {
      // cupules de dissolution (bords nets, fond rond) et cannelures
      const [p1, , pid] = worley(x, z, 1.1, s + 5, 1);
      const pr = 0.1 + 0.18 * (pid - 0.86) / 0.14 + 0.05 * N.noise(x * 6, 3.7, z * 6);
      const pit = pid > 0.86 ? sst(pr, pr * 0.4, p1) : 0;
      d -= pit * 0.03 * (0.6 + pid);
      d += Math.sin(x * 1.6 + N.noise(x * 0.3, 2, z * 0.3) * 5) * 0.01;
      extra = pit;
    } else if (type === 'sandstone') {
      // lits : ondulations douces de la stratification
      const t = (x * 0.8 + z * 0.6) * 0.9 + N.fbm(x * 0.15, 4, z * 0.15, 3) * 2.5;
      d += (0.5 - 0.5 * Math.cos(t * 6.2832)) * 0.018;
      extra = fract(t);
    } else if (type === 'soil') {
      // mottes arrondies sans joints (un sol d'humus n'a pas de dalles),
      // miettes, et çà et là un gravillon à demi enterré
      const [p1, , pid] = worley(x, z, 0.5, s + 7, 1);
      const clod = sst(-0.25, 0.55, N.fbm(x * 1.6, 5, z * 1.6, 3)) * 0.06;
      const crumb = Math.max(0, N.noise(x * 9, 6.3, z * 9)) * 0.016;
      const pebble = pid > 0.94 ? Math.min(1, Math.max(0, 1 - p1 / 0.17) * 2.2) * 0.06 : 0;
      d += clod + crumb + pebble;
      extra = pebble > 0 ? 1 : 0;
    }
    // grain fin
    d += N.noise(x * 22, 1.1, z * 22) * 0.004 * K.grain * 10;
    // (edge : distance à une fissure VISIBLE ; field.js en tire les refuges)
    return { d, crack, edge: edge / Math.max(0.05, live), id, extra };
  }
  // écorce (x le long du tronc, z autour) : crêtes liégeuses séparées par des
  // sillons profonds à parois raides (réseau en losanges très étirés), crêtes
  // feuilletées en écailles superposées (des marches, dont la tranche montre
  // l'écorce fraîche, rousse), cassures en travers qui découpent les crêtes en
  // blocs, fibres le long du tronc ; lambeaux arrachés qui montrent le bois
  function barkSample(x, z) {
    // (déformation forte et lente : des crêtes de longueurs et de largeurs
    // inégales, qui ondulent, plutôt qu'un appareil régulier de losanges)
    const wz = z + 0.9 * N.noise(x * 0.06, 2.2, z * 0.2) + 0.18 * N.noise(x * 0.4, 5.1, z * 1.1);
    const wx = x + 2.6 * N.noise(x * 0.07, 3.3, z * 0.35);
    // (crêtes de 4 à 6 mm, longues de 10 cm et plus : de loin, des traînées)
    const [c1, c2] = worley(wx * 0.09, wz * 1.9, 1.0, s + 3, 0.95);
    const e = c2 - c1;
    // sillon : fond étroit, parois raides ; largeur et profondeur variables
    // (profil en travers : une crête arrondie qui plonge en V jusqu'au fond
    // du sillon, sans plateau ; largeur du sillon variable)
    const nf = N.noise(x * 0.12, 4.4, z * 0.6);
    const fw = 0.05 + 0.08 * sst(-0.4, 0.6, nf);
    const furrow = 1 - sst(0.0, fw, e);
    const crest = Math.pow(sst(0.0, 0.42, e), 0.7);
    const depth = 0.21 - 0.06 * nf;
    // écailles : couches en marches sur la crête (le rebord de chaque couche est sa tranche)
    const q = (N.fbm(wx * 0.45, 1.7, wz * 1.9, 2) * 0.5 + 0.5) * 4.5, fl = Math.floor(q), fq = q - fl;
    const rise = sst(0.72, 0.97, fq);
    const layer = (fl + rise) / 4.5;
    // cassures en travers des crêtes (tous les 1,5 à 3 cm, pas partout)
    const tl = Math.abs(Math.sin(wx * 1.3 + 3 * N.noise(x * 0.3, 8.8, z * 0.8)));
    const tcrack = (1 - sst(0.0, 0.14, tl)) * sst(0.0, 0.35, N.noise(x * 0.5, 9.9, z * 1.3) + 0.15);
    const shoulder = crest;
    const fib = Math.sin(wz * 38 + N.noise(x * 0.6, 8.2, z * 3) * 5) * 0.0035 + N.fbm(x * 1.6, 3, wz * 9, 2) * 0.01;
    const peel = sst(0.36, 0.42, N.fbm(x * 0.08, 7.7, z * 0.16, 3)); // bois mis à nu
    let d = -depth * (1 - crest) + crest * (layer * 0.035 + fib * 2.4 - tcrack * 0.06);
    const wood = -0.38 + Math.sin(z * 46 + N.noise(x * 0.5, 9, z * 4) * 3) * 0.004 + N.noise(x * 0.4, 8, z * 6) * 0.012;
    d = d * (1 - peel) + wood * peel;
    // tone : hauteur de la crête (usée, grise au sommet) ; riser : tranche d'une écaille
    return { d, crack: Math.max(furrow, tcrack * 0.25) * (1 - peel), edge: e, id: peel, extra: furrow, tone: shoulder * (0.4 + 0.6 * layer), riser: rise * (1 - rise) * 4 * (1 - furrow) };
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
  const Tn = type === 'bark' ? new Float32Array(M * M) : null, Rs = type === 'bark' ? new Float32Array(M * M) : null;
  const px = (2 * X) / M;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -X + (i + 0.5) * px, z = -X + (j + 0.5) * px, o = rock.sample(x, z), k = j * M + i;
    D[k] = o.d; C[k] = o.crack; E[k] = o.edge; I[k] = o.id; Xx[k] = o.extra;
    if (Tn) { Tn[k] = o.tone; Rs[k] = o.riser; }
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
    if (type !== 'bark') mix(stain, sst(0.15, 0.45, N.fbm(x * 0.5, 13, z * 0.5, 3)) * 0.55); // (l'écorce a ses algues, plus bas)
    if (type === 'granite') {
      // grains : quartz gris translucide, feldspath blanc rosé, biotite noire
      // mosaïque de cristaux (1 à 2 mm) : biotite noire, feldspath laiteux, quartz gris vitreux
      const [g1, g2, gid] = worley(x + 0.015 * N.noise(x * 40, 1, z * 40), z, 0.07, 31, 1);
      const joint = sst(0.0, 0.006, g2 - g1);
      if (gid < 0.1) { mix([0.12, 0.115, 0.11], 0.4 * joint); rough = 0.5; }
      else if (gid < 0.42) mix(c3(P.feldspar ?? '#d8c8bc'), 0.16 * joint);
      else if (gid < 0.65) { mix([0.52, 0.54, 0.57], 0.12 * joint); rough = 0.42; }
    } else if (type === 'limestone') {
      mix(dark, Xx[k] * 0.14);
      // patine grise par plaques, coulures plus sombres, piqûres noires de
      // lichens endolithes (Verrucaria) : une pierre au soleil n'est pas un plâtre
      mix(dark, sst(0.05, 0.45, n2) * 0.4);
      mix([0.16, 0.16, 0.14], sst(0.42, 0.62, N.noise(x * 0.3, 21, z * 2.4)) * 0.22);
      mix([0.05, 0.05, 0.045], sst(0.52, 0.6, N.noise(x * 6.5, 17, z * 6.5)) * 0.7);
      // veines de calcite
      const v = Math.abs(Math.sin(x * 1.3 + z * 0.4 + n2 * 6));
      mix(light, sst(0.985, 1, v) * 0.6);
    } else if (type === 'sandstone') {
      const band = Math.sin(Xx[k] * 6.283 + n2 * 1.5) * 0.5 + 0.5;
      mix(stain, band * 0.22);
      const [, , gid] = worley(x, z, 0.035, 41, 1);
      mix(gid < 0.3 ? dark : light, 0.12);
    } else if (type === 'soil') {
      if (Xx[k] > 0) mix(light, 0.3 + 0.25 * N.noise(x * 3, 1.9, z * 3));
      const [, , gid] = worley(x, z, 0.06, 43, 1);
      mix(gid < 0.25 ? dark : base, 0.4);
    }
    if (type === 'bark') {
      const peel = I[k], fur = Xx[k];
      // écorce gris-brun : sommets des crêtes usés, gris argent ; tranches
      // des écailles rousses (écorce fraîche) ; sillons brun noir ; poudre
      // verte d'algues (Pleurococcus) sur les crêtes, par plaques
      mix(light, Tn[k] * 0.28 * (1 - fur) * sst(-0.5, 0.6, N.noise(x * 0.5, 2.9, z * 1.6)));
      mix(c3(P.inner ?? '#7a4a2c'), Rs[k] * 0.15);
      // (le flanc des crêtes s'assombrit jusqu'au sillon : sous un soleil
      // direct, l'occlusion seule ne creuserait pas l'écorce)
      mix(dark, fur * 0.85 + (1 - Math.min(1, Tn[k] * 2)) * 0.3 * (1 - fur));
      // (de loin, l'écorce se lit en longues traînées le long du tronc, pas en
      // cellules : une variation lente, étirée dans l'axe, couvre les crêtes)
      const lf = 1 + 0.2 * N.noise(x * 0.12, 15.5, z * 2.2);
      r *= lf; g *= lf; b *= lf;
      // (algues : un voile gris vert, rare et léger ; vert foncé, l'écorce semblait sale)
      mix(stain, sst(0.25, 0.7, n1) * Tn[k] * (1 - fur) * 0.18);
      // bois mis à nu : fauve, fibres
      mix(c3(P.wood), peel * 0.9);
      mix([0.35, 0.2, 0.1], peel * Math.abs(n2) * 0.6);
      rough = 0.82 - 0.1 * Rs[k];
      if (peel > 0) rough = rough + (0.5 - rough) * peel;
    }
    // les fissures accumulent la terre et l'humus
    mix([0.06, 0.045, 0.03], C[k] * 0.85);
    // lichens crustacés : petites rosettes lobées, rares, à thalle aréolé
    // (craquelé en petites plaques), bord plus clair ; hors des fissures
    if (lich.length) {
      for (let L = 0; L < lich.length; L++) {
        const cell = (L === 0 ? 2.4 : 1.3) + L * 0.5;
        // (contour déformé à deux échelles : une colonie de lichen n'est pas
        // un disque, elle s'étale en lobes inégaux et bute sur ses voisines)
        const wn = 0.32 * cell * N.noise(x * 0.9 / cell, L * 2.3 + 0.7, z * 0.9 / cell), lx = x + wn, lz = z - 0.8 * wn;
        const [f1, f2l, lid] = worley(lx, lz, cell, 51 + L * 13, 1);
        if (lid > (P.lichenCover ?? 0.15) * (P.cover ? P.cover[L] : 1)) continue;
        const lobes = Math.min(0.42, 0.16 + 1.4 * lid + 0.07 * N.noise(x * 4.5, L * 5.5, z * 4.5));
        const rr = f1 / cell;
        const inside = sst(lobes, lobes - 0.02, rr) * sst(0.0, 0.03, (f2l - f1) / cell) * (1 - C[k]);
        // prothalle : un liseré noir autour des thalles jaune-vert (Rhizocarpon)
        if (P.rims && P.rims[L]) mix([0.05, 0.05, 0.045], sst(lobes + 0.035, lobes + 0.012, rr) * sst(lobes - 0.01, lobes + 0.004, rr) * (1 - C[k]) * 0.85);
        if (inside > 0) {
          const [a1, a2] = worley(x, z, 0.06, 71 + L, 1);
          const areole = sst(0.0, 0.012, a2 - a1);
          const c = lich[L], var_ = 0.75 + 0.35 * N.noise(x * 6, L * 3.1, z * 6);
          mix([c[0] * var_, c[1] * var_, c[2] * var_], inside * (0.35 + 0.55 * areole));
          mix([0.92, 0.92, 0.85], sst(lobes - 0.05, lobes - 0.015, rr) * inside * 0.1);
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
    if (type !== 'bark') mix([0.24, 0.27, 0.16], sst(0.2, 0.7, C[k] * 0.6 + cav * 2) * 0.35);
    r *= 0.55 + 0.45 * ao; g *= 0.55 + 0.45 * ao; b *= 0.55 + 0.45 * ao;
    col[k * 4] = Math.round(Math.min(1, r) * 255); col[k * 4 + 1] = Math.round(Math.min(1, g) * 255); col[k * 4 + 2] = Math.round(Math.min(1, b) * 255); col[k * 4 + 3] = Math.round(rough * 255);
  }
  return { rel, col, M, X };
}

// couleurs (sRGB) : fond, clair, sombre, taches, lichens
export const ROCK_PALETTES = {
  granite: { base: '#7d7f75', light: '#a3a598', dark: '#4f5346', stain: '#6c7454', feldspar: '#c4c2b4', lichens: ['#c9cec2', '#9aa38c', '#a9ac62'], dots: [1, 0, 0], rims: [0, 0, 1], cover: [1, 0.8, 0.35], lichenCover: 0.24 },
  limestone: { base: '#a39f8e', light: '#c6c1ae', dark: '#6c6a5c', stain: '#7c845c', lichens: ['#d4d4c8', '#55554a', '#c9a640'], dots: [1, 0, 0], cover: [1, 0.45, 0.8], lichenCover: 0.13 },
  sandstone: { base: '#b08a64', light: '#cfac84', dark: '#7a5a3e', stain: '#a2603a', lichens: ['#a8b098', '#c8a838'], lichenCover: 0.12 },
  bark: { base: '#2f2b26', light: '#57544c', dark: '#120e0b', stain: '#6a6c58', inner: '#4a3427', wood: '#a87444', lichens: ['#8e8f80', '#82836e'], dots: [0, 0], lichenCover: 0.006 },
  soil: { base: '#4a3a2c', light: '#8a7a68', dark: '#2a2018', stain: '#5a3e24', lichens: [], lichenCover: 0 },
};
