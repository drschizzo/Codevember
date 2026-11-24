// L'art des ombres : un objet dont l'ombre, au soleil de minuit, dessine deux
// figures à deux heures du jour (Mitra et Pauly, « Shadow Art », SIGGRAPH Asia
// 2009, adapté à un sol et à un soleil réel).
//
// Module pur (pas de three) : le worker, les tests et les bancs Node le lisent.
// Repère de three.js : x vers l'est, y vers le haut, z vers le sud ; le sol est
// le plan y = 0, l'objet est posé autour de l'origine.
//
// 1. Le soleil : hauteur et azimut à la latitude φ, déclinaison δ, angle
//    horaire H (0 = midi, soleil au sud ; π = minuit, soleil au nord, au plus bas).
// 2. Les cibles : chaque figure (src/gen/silhouettes.js) est posée au sol dans
//    son repère (a le long de l'ombre, b en travers), placée par (a0, b0) et
//    mise à l'échelle pour que son bout soit l'ombre du sommet de l'objet.
// 3. La coque : les points dont l'ombre tombe dans les deux cibles à la fois.
//    Tout ce qui est dedans fait une ombre qui ne déborde jamais des cibles.
// 4. Le placement : recherche des (a0, b0) qui maximisent la plus petite des
//    deux couvertures (ombre de la coque ∩ cible) / cible.
import { figureMask, figurePolygon, SILHOUETTES } from './silhouettes.js';

export const DEG = Math.PI / 180;
export const SUN_RADIUS = 0.267 * DEG; // demi-diamètre apparent du soleil

export function sunAt(latDeg, decDeg, H) {
  const lat = latDeg * DEG, dec = decDeg * DEG;
  const h = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  // azimut depuis le nord, vers l'est
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H));
  return { h, az, d: [Math.sin(az) * Math.cos(h), Math.sin(h), -Math.cos(az) * Math.cos(h)] }; // d : vers le soleil
}

// spec : { lat, dec, height, camAz, figs: [{ name, H, camAz? }] }
// camAz : azimut (depuis le nord, vers l'est) de la direction où regarde la caméra.
// Une figure « debout » se lit droite si son ombre s'éloigne de la caméra ; une
// figure « couchée » a le dos tourné vers le fond de l'image.
export function setupFigures(spec) {
  return spec.figs.map(({ name, H, camAz = spec.camAz }) => {
    // la vue d'où la figure doit se lire (chaque figure peut avoir la sienne)
    const fwd = [Math.sin(camAz * DEG), -Math.cos(camAz * DEG)]; // (x, z) au sol
    const right = [-fwd[1], fwd[0]]; // à droite de l'image
    const s = sunAt(spec.lat, spec.dec, H);
    const n = Math.hypot(s.d[0], s.d[2]);
    const u = [-s.d[0] / n, -s.d[2] / n]; // direction de l'ombre au sol
    let v = [-u[1], u[0]];
    const S = SILHOUETTES[name];
    if (S.axis === 'x') { if (v[0] * fwd[0] + v[1] * fwd[1] > 0) v = [-v[0], -v[1]]; } // le haut du dessin (b < 0) vers le fond
    else if (v[0] * right[0] + v[1] * right[1] < 0) v = [-v[0], -v[1]]; // la droite du dessin à droite de l'image
    return { name, H, sun: s, u, v, L: spec.height / Math.tan(s.h), mask: figureMask(name, 512), a0: 0, b0: 0, scale: 1 };
  });
}

export function place(F, P) {
  F.forEach((f, i) => { f.a0 = Math.min(0, P[i][0]); f.b0 = P[i][1]; f.scale = f.L - f.a0; });
}

// point du sol (x, z) → repère de la figure (a, b), en unités de figure
export const toFigure = (f, x, z) => [(x * f.u[0] + z * f.u[1] - f.a0) / f.scale, (x * f.v[0] + z * f.v[1] - f.b0) / f.scale];
// repère de la figure → sol
export const fromFigure = (f, a, b) => {
  const A = a * f.scale + f.a0, B = b * f.scale + f.b0;
  return [A * f.u[0] + B * f.v[0], A * f.u[1] + B * f.v[1]];
};
// ombre au sol du point (x, y, z) pour la figure f (le long de la direction du soleil)
export const shadowOf = (f, x, y, z) => { const t = y / f.sun.d[1]; return [x - t * f.sun.d[0], z - t * f.sun.d[2]]; };

// ── Coque en voxels (recherche, tests) ──
export function voxelHull(F, height, box, N, NY) {
  const vox = new Uint8Array(N * N * NY);
  const c = (i) => -box + (i + 0.5) * 2 * box / N;
  for (let iy = 0; iy < NY; iy++) {
    const y = (iy + 0.5) * height / NY;
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      let ok = 1;
      for (const f of F) {
        const [gx, gz] = shadowOf(f, c(ix), y, c(iz));
        const [a, b] = toFigure(f, gx, gz);
        if (!f.mask.at(a, b)) { ok = 0; break; }
      }
      vox[(iy * N + iz) * N + ix] = ok;
    }
  }
  return { vox, N, NY, box, height, at: (x, y, z) => {
    const ix = Math.floor((x + box) / (2 * box) * N), iz = Math.floor((z + box) / (2 * box) * N), iy = Math.floor(y / height * NY);
    return ix >= 0 && iz >= 0 && iy >= 0 && ix < N && iz < N && iy < NY ? vox[(iy * N + iz) * N + ix] : 0;
  } };
}

// Couverture de chaque cible par l'ombre de la coque (projection des voxels, grille G de la figure).
// Poids de chaque pixel d'une cible : ce qui fait lire la figure, c'est son
// contour et ses parties fines (oreilles, museau, bec), qui pèsent jusqu'à 5 fois
// plus que le milieu (distance au bord par chanfrein 3-4, en pixels de la grille).
const WCACHE = new Map();
export function figureWeights(name, G) {
  const key = `${name}:${G}`;
  if (WCACHE.has(key)) return WCACHE.get(key);
  const m = figureMask(name, 512), T = new Uint8Array(G * G), D = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const q = j * G + i; T[q] = m.at(1 - (j + 0.5) / G, (i + 0.5) / G - 0.5); D[q] = T[q] ? 1e9 : 0; }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const q = j * G + i; if (!T[q]) continue; if (i) D[q] = Math.min(D[q], D[q - 1] + 3); if (j) D[q] = Math.min(D[q], D[q - G] + 3); if (i && j) D[q] = Math.min(D[q], D[q - G - 1] + 4); if (i < G - 1 && j) D[q] = Math.min(D[q], D[q - G + 1] + 4); }
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) { const q = j * G + i; if (!T[q]) continue; if (i < G - 1) D[q] = Math.min(D[q], D[q + 1] + 3); if (j < G - 1) D[q] = Math.min(D[q], D[q + G] + 3); if (i < G - 1 && j < G - 1) D[q] = Math.min(D[q], D[q + G + 1] + 4); if (i && j < G - 1) D[q] = Math.min(D[q], D[q + G - 1] + 4); }
  const W = new Float32Array(G * G), px = G / 384; // (même échelle de poids que le peuplement, grille de 384)
  for (let q = 0; q < G * G; q++) if (T[q]) W[q] = 1 + 4 * Math.exp(-D[q] / 3 / (6 * px));
  const out = { T, W };
  WCACHE.set(key, out);
  return out;
}

// weighted : couverture pondérée par figureWeights (le placement), sinon la part brute
export function coverage(F, Hv, G = 128, weighted = false) {
  const { vox, N, NY, box, height } = Hv;
  return F.map((f) => {
    const sh = new Uint8Array(G * G);
    for (let iy = 0; iy < NY; iy++) for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      if (!vox[(iy * N + iz) * N + ix]) continue;
      const x = -box + (ix + 0.5) * 2 * box / N, z = -box + (iz + 0.5) * 2 * box / N;
      for (const oy of [0.25, 0.75]) {
        const [gx, gz] = shadowOf(f, x, (iy + oy) * height / NY, z);
        const [a, b] = toFigure(f, gx, gz);
        const j = Math.floor((1 - a) * G), q = Math.floor((b + 0.5) * G);
        for (let dj = -1; dj <= 1; dj++) for (let dq = -1; dq <= 1; dq++) {
          const jj = j + dj, qq = q + dq;
          if (jj >= 0 && qq >= 0 && jj < G && qq < G) sh[jj * G + qq] = 1;
        }
      }
    }
    let t = 0, c = 0;
    if (weighted) {
      const { T, W } = figureWeights(f.name, G);
      let tr = 0, cr = 0;
      for (let q = 0; q < G * G; q++) if (T[q]) { t += W[q]; tr++; if (sh[q]) { c += W[q]; cr++; } }
      return weighted === 'both' ? [cr / tr, c / t] : c / t;
    }
    for (let j = 0; j < G; j++) for (let q = 0; q < G; q++) {
      if (f.mask.at(1 - (j + 0.5) / G, (q + 0.5) / G - 0.5)) { t++; if (sh[j * G + q]) c++; }
    }
    return c / t;
  });
}

// Part de chaque cible cachée sous le tas : les pixels de la figure qui tombent
// dans l'emprise au sol de la coque (vue d'en haut, la caméra ne les voit pas :
// l'objet est dessus). Un placement qui loge la moitié de l'animal sous le tas
// couvre bien la cible, mais ne se lit pas.
export function hiddenFraction(F, Hv, G = 128, plunge = 68) {
  // (vu par la caméra de la tenue : elle regarde dans l'axe de l'ombre u, plongée
  // de « plunge » degrés ; un point du tas à la hauteur y cache le sol en
  // p + u · y · cot(plongée). C'est cette vue, et non l'emprise au sol, qui compte :
  // la coque s'évase en montant.)
  const { vox, N, NY, box, height } = Hv;
  const cot = 1 / Math.tan(plunge * DEG);
  return F.map((f) => {
    const hid = new Uint8Array(G * G);
    for (let iy = 0; iy < NY; iy++) {
      const y = (iy + 0.5) * height / NY;
      for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
        if (!vox[(iy * N + iz) * N + ix]) continue;
        const x = -box + (ix + 0.5) * 2 * box / N + f.u[0] * y * cot, z = -box + (iz + 0.5) * 2 * box / N + f.u[1] * y * cot;
        const [a, b] = toFigure(f, x, z);
        const j = Math.floor((1 - a) * G), i = Math.floor((b + 0.5) * G);
        const rr = Math.ceil(2 * box / N / f.scale * G * 0.6);
        for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && ii >= 0 && jj < G && ii < G) hid[jj * G + ii] = 1; }
      }
    }
    let t = 0, h = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      if (!f.mask.at(1 - (j + 0.5) / G, (i + 0.5) / G - 0.5)) continue;
      t++; if (hid[j * G + i]) h++;
    }
    return h / t;
  });
}

// Recherche des placements (a0 ≤ 0 : la figure peut commencer derrière le pied
// de l'objet ; b0 : décalage en travers). Déterministe : rnd vient de la graine.
export function solvePlacement(F, height, rnd, { iters = 160, box = 1.4, onStep = null, hide = 1.5, hideFree = 0.08, baseMin = 0.12 } = {}) {
  let best = { score: -1, P: F.map(() => [0, 0]), cov: null };
  for (let it = 0; it < iters; it++) {
    const local = it > 0 && rnd() < 0.7;
    const P = F.map((f, i) => (it === 0 ? [0, 0] : local
      ? [Math.min(0, best.P[i][0] + (rnd() - 0.5) * 0.25), best.P[i][1] + (rnd() - 0.5) * 0.25]
      : [-rnd() * 1.6, (rnd() - 0.5) * 1.0]));
    place(F, P);
    const Hv = voxelHull(F, height, box, 56, 40);
    const both = coverage(F, Hv, 128, 'both'); // (une passe : brute, et pondérée par le contour et les parties fines)
    const cov = both.map((x) => x[0]), wcov = both.map((x) => x[1]);
    // (la figure doit se lire : la part cachée sous le tas pèse contre le placement,
    // au-delà d'une part tolérée, le pied de l'animal, sans laquelle le tas n'a plus
    // d'assise au sol)
    const hid = hide ? hiddenFraction(F, Hv, 96) : F.map(() => 0);
    // (et le tas doit avoir une assise : l'aire de la coque dans les 4 premiers cm)
    const cell = (2 * box / 56) ** 2, NY = 40;
    const layer = (iy) => { let n = 0; for (let q = 0; q < 56 * 56; q++) n += Hv.vox[iy * 56 * 56 + q]; return n * cell; };
    const baseArea = Math.min(layer(0), layer(1));
    const score = Math.min(...wcov) - hide * Math.max(0, Math.max(...hid) - hideFree) - (baseMin ? 2 * Math.max(0, baseMin - baseArea) / baseMin : 0);
    if (score > best.score) best = { score, P, cov, hid };
    onStep?.(it / iters, best);
  }
  place(F, best.P);
  return best;
}

// ── Distance signée de la coque ──
// Pour chaque figure, une grille de distances signées 2D (en mètres au sol,
// négatives dedans) ; la coque est l'intersection (max) des extrusions,
// bornée par le sol et par la hauteur, avec un arrondi des arêtes (max lissé).
// Transformée de distance euclidienne exacte (Felzenszwalb et Huttenlocher,
// 2012) : deux passes 1D d'enveloppe inférieure de paraboles, en O(N).
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while ((s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function edt2d(inside, res) { // distance (en pixels) au pixel le plus proche où inside est vrai
  const INF = 1e20, g = new Float64Array(res * res), f = new Float64Array(res), d = new Float64Array(res), v = new Int32Array(res), z = new Float64Array(res + 1);
  for (let i = 0; i < res * res; i++) g[i] = inside(i) ? 0 : INF;
  for (let x = 0; x < res; x++) { for (let y = 0; y < res; y++) f[y] = g[y * res + x]; edt1d(f, res, d, v, z); for (let y = 0; y < res; y++) g[y * res + x] = d[y]; }
  for (let y = 0; y < res; y++) { for (let x = 0; x < res; x++) f[x] = g[y * res + x]; edt1d(f, res, d, v, z); for (let x = 0; x < res; x++) g[y * res + x] = d[x]; }
  return g;
}
// (la grille ne dépend que de la figure : gardée d'une scène à l'autre dans le worker)
const SDF_CACHE = new Map();
export function polygonSDFGrid(name, res) {
  const key = `${name}:${res}`;
  if (SDF_CACHE.has(key)) return SDF_CACHE.get(key);
  const pad = 0.08, lo = -pad, span = 1 + 2 * pad; // a ∈ [−pad, 1 + pad], b ∈ [−0.5 − pad, 0.5 + pad]
  const mask = figureMask(name, 1024);
  const M = new Uint8Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) M[j * res + i] = mask.at(lo + (j / (res - 1)) * span, -0.5 - pad + (i / (res - 1)) * span);
  // distance signée : au dehors, distance au dedans ; au dedans, moins la distance au dehors (moins un demi-pixel : le bord est entre deux)
  const dIn = edt2d((q) => M[q] === 1, res), dOut = edt2d((q) => M[q] === 0, res), px = span / (res - 1);
  const g = new Float32Array(res * res);
  for (let q = 0; q < res * res; q++) g[q] = (M[q] ? -(Math.sqrt(dOut[q]) - 0.5) : Math.sqrt(dIn[q]) - 0.5) * px;
  const ret = { sample(a, b) { // bilinéaire, en unités de figure
    const fj = Math.min(res - 1.001, Math.max(0, (a - lo) / span * (res - 1)));
    const fi = Math.min(res - 1.001, Math.max(0, (b + 0.5 + pad) / span * (res - 1)));
    const j = Math.floor(fj), i = Math.floor(fi), tj = fj - j, ti = fi - i;
    const v00 = g[j * res + i], v01 = g[j * res + i + 1], v10 = g[(j + 1) * res + i], v11 = g[(j + 1) * res + i + 1];
    return (v00 * (1 - ti) + v01 * ti) * (1 - tj) + (v10 * (1 - ti) + v11 * ti) * tj;
  } };
  const out = { g, res, lo, span, sample: ret.sample };
  SDF_CACHE.set(key, out);
  return out;
}

const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

// floor : false pour le peuplement (le sol y est vérifié d'après la vraie section ;
// le plancher, adouci par le max lissé, y interdirait les assises étroites)
export function hullSDF(F, height, { res = 512, round = 0.006, floor = true } = {}) {
  const grids = F.map((f) => polygonSDFGrid(f.name, res));
  return (x, y, z) => {
    let d = floor ? -y : -1; // le sol
    d = floor ? smax(d, y - height, round) : y - height;
    F.forEach((f, i) => {
      const [gx, gz] = shadowOf(f, x, y, z);
      const [a, b] = toFigure(f, gx, gz);
      // distance au sol → distance à la paroi oblique. La paroi contient la
      // direction du soleil d et la tangente t du contour : sa distance vaut
      // d₂ · sin h / |t × d|. Avec n le gradient du contour (repère a, b),
      // t·d = n_b cos h, d'où le facteur sin h / √(1 − n_b² cos² h)
      // (1 pour un bord parallèle à l'ombre, sin h pour un bord en travers).
      const G = grids[i], e = 0.002;
      const ga = G.sample(a + e, b) - G.sample(a - e, b), gb = G.sample(a, b + e) - G.sample(a, b - e);
      const nb2 = (gb * gb) / (ga * ga + gb * gb || 1);
      const ch = Math.cos(f.sun.h);
      d = smax(d, G.sample(a, b) * f.scale * Math.sin(f.sun.h) / Math.sqrt(Math.max(1e-4, 1 - nb2 * ch * ch)), round);
    });
    return d;
  };
}
