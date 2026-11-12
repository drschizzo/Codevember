// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Règles (skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est un DÉCOR (support, lumière, valeur, cadrage), pas une teinte ;
// - les lampes sont presque blanches ; la chaleur vient du bois, du fond, des
//   contre-jours et de l'étalonnage.
// Unités : centimètres.
import { createRng } from './rng.js';
import { FAMILIES, FAMILY_KEYS } from './families.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// Le site : le bois est périodique de période L (cm) le long du vent (x) ;
// largeur W en travers ; rayon de la bûche (le dessus s'arrondit, le fond
// tombe hors du net).
export const SITE = { L: 4.4, W: 5.2, logR: 6.5 };

// Le support : sa courbure change toute la composition (une bûche presque
// plate qui file vers l'horizon ; une branche dont le dos se détache sur le
// fond ; un rameau qu'on voit de profil, la forêt en crête sur sa ligne)
export const SUPPORTS = {
  log: { label: 'Bûche', R: 6.5, rz: 1, w: 0.5 },
  branch: { label: 'Branche', R: 2.1, rz: 0.82, w: 0.3 },
  twig: { label: 'Rameau', R: 1.05, rz: 0.55, w: 0.2 },
};

// ── Humeurs : six décors ─────────────────────────────────────────────────────
// wood : le support cuit (gen/wood.js) ; env : studio HDR ; bg : fond et
// brume ; key : la lumière principale (soleil : direction fixe ; lampe
// frontale : solidaire de la caméra) ; rim : contre-jour ; night : part de la
// lumière qui reste la nuit ; cam : cadrage (élévations du réseau et de la
// forêt, champ, distance) ; grade : étalonnage.
export const MOODS = {
  greve: {
    label: 'Grève', desc: 'bois flotté décortiqué, soleil rasant et dur, fond pâle',
    wood: { pattern: 'drift', color: '#b8b2a6', color2: '#7d766b', rough: 0.82, relief: 1 },
    env: 'shore', envIntensity: [0.55, 0.7], bg: '#d9d3c7', fog: [9, 26],
    key: { kind: 'sun', K: 5600, az: [-2.5, -2.1], el: [0.28, 0.4], intensity: 5.2 }, rim: { K: 7000, az: 1.3, el: 0.4, intensity: 1.8 }, night: 0.42,
    cam: { elNet: [0.85, 1.0], elForest: [0.42, 0.55], fov: [26, 30], dist: [5.4, 6.2], az: [-0.35, -0.1] },
    grade: { contrast: 1.04, saturation: 0.98, shadows: [0.97, 0.99, 1.04], highlights: [1.03, 1.0, 0.96], exposure: 0.9 },
  },
  brulis: {
    label: 'Brûlis', desc: 'bois carbonisé fendu en écailles, lumière douce d’en haut et fort contre-jour, fond noir',
    wood: { pattern: 'char', color: '#141312', color2: '#080707', rough: 0.74, relief: 1.2 },
    env: 'charcoal', envIntensity: [0.5, 0.7], bg: '#040404', fog: [8, 20],
    key: { kind: 'sun', K: 6200, az: [-1.9, -1.3], el: [1.05, 1.25], intensity: 3.0 }, rim: { K: 6800, az: 1.45, el: 0.32, intensity: 2.6 }, night: 0.5,
    cam: { elNet: [0.75, 0.9], elForest: [0.14, 0.24], fov: [24, 28], dist: [5.2, 6.0], az: [-0.2, 0.2] },
    grade: { contrast: 1.1, saturation: 1.02, shadows: [0.94, 0.97, 1.08], highlights: [1.02, 1.0, 0.98], exposure: 1.15 },
  },
  humus: {
    label: 'Humus', desc: 'bois pourri brun, fibreux et mouillé, la nuit, à la lampe frontale',
    wood: { pattern: 'rot', color: '#4a3020', color2: '#20140c', rough: 0.55, relief: 1.1 },
    env: 'nightsky', envIntensity: [0.6, 0.8], bg: '#020304', fog: [6, 14],
    key: { kind: 'lamp', K: 5200, az: [0, 0], el: [0, 0], intensity: 4.2 }, rim: { K: 7500, az: -1.5, el: 0.7, intensity: 1.4 }, night: 0.6,
    cam: { elNet: [0.95, 1.1], elForest: [0.55, 0.7], fov: [26, 30], dist: [4.6, 5.2], az: [-0.25, 0.25] },
    grade: { contrast: 1.06, saturation: 1.05, shadows: [0.95, 0.98, 1.06], highlights: [1.04, 1.0, 0.95], exposure: 1.2 },
  },
  brume: {
    label: 'Brume', desc: 'tronc gris décortiqué dans un brouillard laiteux, à contre-jour',
    wood: { pattern: 'weathered', color: '#8f8a82', color2: '#55514b', rough: 0.85, relief: 0.9 },
    env: 'fogwhite', envIntensity: [0.45, 0.6], bg: '#c9ced0', fog: [4.5, 16],
    key: { kind: 'sun', K: 6000, az: [-1.85, -1.3], el: [0.28, 0.42], intensity: 4.0 }, rim: { K: 6500, az: 1.6, el: 0.5, intensity: 1.3 }, night: 0.5,
    cam: { elNet: [0.75, 0.9], elForest: [0.16, 0.26], fov: [28, 32], dist: [5.6, 6.4], az: [-0.2, 0.15] },
    grade: { contrast: 0.98, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1.0, 1.0, 1.0], exposure: 0.95 },
  },
  sousbois: {
    label: 'Sous-bois', desc: 'bûche humide écorcée, veinée de lignes noires, ciel couvert de côté',
    wood: { pattern: 'spalted', color: '#b4916a', color2: '#5a4430', rough: 0.7, relief: 0.8 },
    env: 'forest', envIntensity: [0.8, 1.0], bg: '#3a3f31', fog: [7, 20],
    key: { kind: 'sun', K: 6400, az: [-2.9, -2.5], el: [0.7, 0.9], intensity: 2.6 }, rim: { K: 6000, az: 1.2, el: 0.5, intensity: 1.2 }, night: 0.5,
    cam: { elNet: [0.8, 0.95], elForest: [0.32, 0.45], fov: [26, 30], dist: [5.2, 6.0], az: [-0.45, -0.2] },
    grade: { contrast: 1.03, saturation: 1.0, shadows: [0.96, 1.0, 1.02], highlights: [1.02, 1.01, 0.97], exposure: 1.05 },
  },
  cedre: {
    label: 'Cèdre', desc: 'planche de cèdre débitée, cernes et rayons, soleil bas de trois-quarts arrière, fond sombre et chaud',
    wood: { pattern: 'cedar', color: '#b4683e', color2: '#6e341c', rough: 0.6, relief: 0.6 },
    env: 'dusk', envIntensity: [0.4, 0.55], bg: '#140b07', fog: [7, 18],
    key: { kind: 'sun', K: 4900, az: [0.9, 1.3], el: [0.2, 0.3], intensity: 6.4 }, rim: { K: 6500, az: -2.2, el: 0.7, intensity: 0.5 }, night: 0.45,
    cam: { elNet: [0.7, 0.85], elForest: [0.08, 0.16], fov: [24, 28], dist: [5.4, 6.2], az: [0.1, 0.4] },
    grade: { contrast: 1.08, saturation: 1.04, shadows: [0.98, 0.97, 1.02], highlights: [1.05, 1.0, 0.93], exposure: 1.0 },
  },
};
export const MOOD_KEYS = Object.keys(MOODS);

// réseau : forme du plasmodium (μ de Tero, exploration, nombre de foyers)
export const NETWORKS = {
  fan: { label: 'Éventail', mu: 1.3, explore: 0.25, foci: 1 },
  branch: { label: 'Rameux', mu: 1.8, explore: 0.15, foci: 1 },
  mesh: { label: 'Réticulé', mu: 1.05, explore: 0.6, foci: 1 },
  double: { label: 'Deux foyers', mu: 1.4, explore: 0.3, foci: 2 },
};
export const ORDERS = {
  center: 'du centre vers le bord', sweep: 'dans le sens du réseau', clusters: 'par grappes', together: 'd’un seul coup',
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(MOOD_KEYS);
  const M = MOODS[mood];
  const rf = rng.fork('family');
  const family = overrides.family ?? rf.pick(FAMILY_KEYS);
  const spKeys = Object.keys(FAMILIES[family].species);
  const species = overrides.species && FAMILIES[family].species[overrides.species] ? overrides.species : rf.pick(spKeys);
  const rsu = rng.fork('support');
  const support = overrides.support ?? rsu.weighted(Object.entries(SUPPORTS).map(([k, v]) => [k, v.w]));
  const SU = SUPPORTS[support];
  const rp = rng.fork('plasmodium'), rr = rng.fork('fruit'), rw = rng.fork('wind'), rc = rng.fork('camera'), rl = rng.fork('light');
  const net = rp.pick(Object.keys(NETWORKS));
  const N = NETWORKS[net];
  const rg = (a) => rc.range(a[0], a[1]);

  return {
    v: 1, seed, mood, family, species, support,
    loop: { duration: 40 },
    site: { ...SITE, logR: SU.R },
    wood: { ...M.wood, seed: `${seed}-wood` },
    plasmodium: {
      net, mu: r2(N.mu + rp.range(-0.1, 0.1)), explore: r2(N.explore), foci: N.foci,
      seeds: rp.int(7, 14), seed: `${seed}-net`,
      // territoire (ellipse, cm, coordonnées du site) : le réseau s'étend vers l'aval
      territory: [r2(rp.range(0.05, 0.25)), r2(rp.range(-0.15, 0.15) * SU.rz), r2(rp.range(1.25, 1.45)), r2(rp.range(0.72, 0.9) * SU.rz)],
      aniso: r2(rp.range(1.1, 1.5)), // (le front court plus vite le long du fil du bois)
      festoon: r2(rp.range(0.5, 1)),
    },
    fruit: {
      order: rr.pick(Object.keys(ORDERS)),
      density: r2(rr.range(0.85, 1.15)),
      spread: r2(rr.range(0.03, 0.06)), // (étalement des retards, en part de boucle)
      lean: r2(rr.range(0.05, 0.16)),   // (penchent vers la lumière, rad)
      seed: `${seed}-fruit`,
    },
    wind: { gust: r2(rw.range(0.2, 0.9)), strength: r2(rw.range(0.85, 1.15)), lift: r2(rw.range(0.7, 1.2)), seed: `${seed}-spores` },
    camera: {
      fov: r2(rg(M.cam.fov)), dist: r2(rg(M.cam.dist)), elNet: r2(rg(M.cam.elNet)), elForest: r2(rg(M.cam.elForest)),
      az: r2(rg(M.cam.az)), sway: r2(rc.range(0.01, 0.03)),
    },
    light: {
      key: { kind: M.key.kind, color: kelvinToHex(M.key.K + rl.range(-150, 150)), intensity: r2(M.key.intensity * rl.range(0.92, 1.08)), az: r2(rl.range(...M.key.az)), el: r2(rl.range(...M.key.el)) },
      rim: { color: kelvinToHex(M.rim.K), intensity: r2(M.rim.intensity * rl.range(0.9, 1.1)), az: r2(M.rim.az + rl.range(-0.15, 0.15)), el: r2(M.rim.el) },
      night: M.night,
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envIntensity)), rotation: r2(rl.range(-0.3, 0.3)) },
    fog: { color: M.bg, near: M.fog[0], far: M.fog[1] },
    grade: { ...M.grade },
    detail: r3(1),
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, species: R.species, support: R.support ?? 'log' });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
