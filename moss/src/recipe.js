// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est un DÉCOR (support, fond, accessoires), une LUMIÈRE (soleil
//   tacheté du sous-bois, ciel couvert, brouillard blanc qui se lève, plein
//   midi, contre-jour du soir, lune puis aube), une VALEUR et un CADRAGE —
//   avant d'être une couleur ;
// - les matières des décors sont des accords composés à la main ;
// - les lampes sont presque blanches (≥ 4700 K), sauf la lune (bleutée) ;
//   la chaleur vient des matières, du ciel, des contre-jours et de l'étalonnage.
import { createRng } from '../../shared/rng.js';
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

// ── Humeurs (décors) ─────────────────────────────────────────────────────────
// support : forme du substrat sous le coussin (cx, cz : courbures en 1/cm ;
// log : souche couchée) ; props : accessoires du décor ; water : ce qui
// mouille la mousse (pondéré) ; families : familles favorites (pondérées) ;
// sun : la lumière principale { K, el (rad), az, I (relatif), flecks
// (taches du couvert), cloud (part de lumière gardée sous la pluie) } ;
// sky : couleurs du fond [pendant l'eau, au soleil] ; fog : brume (densité
// relative) [pendant l'eau, au soleil] ; hemi : lumière du lieu [ciel, sol,
// intensité] ; frame : cadrage (ras, plongee, contre, longue) ; accords :
// matières du décor [support, sol, accessoires].
export const MOODS = {
  sousbois: {
    label: 'Souche', env: 'studio', value: 'sombre, tachetée',
    support: 'log', props: [],
    water: [['rain', 3], ['fog', 1]], families: [['tortule', 2], ['polytric', 3], ['funaire', 1], ['sphaigne', 1]],
    sun: { K: 5400, el: 0.9, az: -2.2, I: 1.15, cloud: 0.25 },
    sky: [['#1b1c1a', '#2a2b28'], ['#222320', '#363732']], fog: [0.45, 0.22], hemi: ['#c8d0b8', '#4a3c20', 1.3],
    frame: ['ras', 'longue'],
    accords: [{ support: 'bark', ground: 'litter', accent: 'fern' }, { support: 'barkMossy', ground: 'litter', accent: 'fern' }],
    grade: { contrast: 1.06, saturation: 1.04, shadows: [0.94, 1.02, 0.98], highlights: [1.03, 1.02, 0.94] },
  },
  kokedera: {
    label: 'Kokedera', env: 'softbox', value: 'moyenne, douce',
    support: 'granite', props: [],
    water: [['rain', 4], ['fog', 1]], families: [['tortule', 2], ['polytric', 2], ['funaire', 2], ['sphaigne', 1]],
    sun: { K: 5800, el: 1.25, az: -1.4, I: 0.55, cloud: 0.25 },
    sky: [['#6c706c', '#8a8e8a'], ['#7c807b', '#9da09b']], fog: [0.5, 0.2], hemi: ['#d8e0d8', '#5a5a50', 1.1],
    frame: ['plongee', 'ras'],
    accords: [{ support: 'granite', ground: 'gravel', accent: 'stoneLantern' }, { support: 'graniteDark', ground: 'gravel', accent: 'stoneLantern' }],
    grade: { contrast: 0.96, saturation: 0.96, shadows: [0.97, 1.01, 1.02], highlights: [1, 1.01, 1.0] },
  },
  lande: {
    label: 'Lande', env: 'fogwhite', value: 'très claire, puis plein jour',
    support: 'boulder', props: [],
    water: [['fog', 5], ['rain', 1]], families: [['tortule', 4], ['polytric', 2], ['funaire', 1], ['sphaigne', 1]],
    sun: { K: 5900, el: 0.75, az: -2.6, I: 1.15, cloud: 0.05 },
    sky: [['#c9cccd', '#e4e6e6'], ['#c4c8cc', '#e8eaec']], fog: [0.35, 0.08], hemi: ['#dfe6ee', '#6a6a5a', 1.0],
    frame: ['ras', 'contre'],
    accords: [{ support: 'graniteLichen', ground: 'heath', accent: 'heather' }],
    grade: { contrast: 1.0, saturation: 0.98, shadows: [0.97, 1.0, 1.04], highlights: [1.0, 1.0, 1.0] },
  },
  muret: {
    label: 'Muret', env: 'softbox', value: 'très claire, contrastée',
    support: 'wall', props: [],
    water: [['rain', 1]], families: [['tortule', 4], ['funaire', 2], ['polytric', 1]],
    sun: { K: 5700, el: 1.15, az: -1.9, I: 1.35, cloud: 0.06 },
    sky: [['#a39d92', '#bdb7ab'], ['#c0b9ad', '#dcd6ca']], fog: [0.35, 0.05], hemi: ['#d8dce6', '#9a8a70', 0.9],
    frame: ['contre', 'ras'],
    accords: [{ support: 'limestone', ground: 'limestone', accent: 'lichenYellow' }, { support: 'sandstone', ground: 'sandstone', accent: 'lichenGrey' }],
    grade: { contrast: 1.1, saturation: 1.02, shadows: [0.95, 0.98, 1.06], highlights: [1.03, 1.01, 0.97] },
  },
  tourbiere: {
    label: 'Tourbière', env: 'studio', value: 'sombre, contre-jour',
    support: 'peat', props: [],
    water: [['fog', 3], ['dew', 2]], families: [['sphaigne', 6], ['polytric', 1]],
    sun: { K: 4900, el: 0.22, az: 0.25, I: 1.05, back: true, cloud: 0.15 },
    sky: [['#24272c', '#32363c'], ['#2c2a28', '#46403a']], fog: [0.6, 0.3], hemi: ['#8a8a9a', '#2a2018', 0.55],
    frame: ['contre', 'ras'],
    accords: [{ support: 'peat', ground: 'peat', accent: 'cotton' }],
    grade: { contrast: 1.08, saturation: 1.05, shadows: [0.94, 0.96, 1.06], highlights: [1.06, 1.0, 0.9] },
  },
  rosee: {
    label: 'Rosée', env: 'studio', value: 'sombre et froide',
    support: 'ground', props: ['needles'],
    water: [['dew', 1]], families: [['tortule', 3], ['funaire', 3], ['polytric', 2]],
    sun: { K: 5000, el: 0.32, az: 2.4, I: 0.9, moon: { K: 7600, I: 0.6, el: 0.9, az: -1.2 }, cloud: 0.35 },
    sky: [['#1a1f28', '#262c36'], ['#2a303a', '#3c4450']], fog: [0.5, 0.3], hemi: ['#6a7ca8', '#1c1814', 0.6],
    frame: ['plongee', 'ras'],
    accords: [{ support: 'soil', ground: 'needles', accent: 'cone' }],
    grade: { contrast: 1.08, saturation: 0.92, shadows: [0.92, 0.97, 1.1], highlights: [1.02, 1.0, 0.98] },
  },
};

// matières du décor (diélectriques ; albédo linéaire approximatif)
export const DECOR_FINISHES = {
  bark: { color: '#4a3a2c', rough: 0.85, relief: 1, pattern: 'bark' },
  barkMossy: { color: '#3e3a26', rough: 0.85, relief: 1, pattern: 'bark', lichen: '#6a7a3a' },
  granite: { color: '#8a8a84', rough: 0.7, relief: 0.6, pattern: 'granite' },
  graniteDark: { color: '#5a5a58', rough: 0.72, relief: 0.6, pattern: 'granite' },
  graniteLichen: { color: '#9a9a92', rough: 0.75, relief: 0.6, pattern: 'granite', lichen: '#c8c49a' },
  limestone: { color: '#c8bca4', rough: 0.8, relief: 0.7, pattern: 'stone', lichen: '#d8b030' },
  sandstone: { color: '#b49470', rough: 0.85, relief: 0.7, pattern: 'stone', lichen: '#a8aca0' },
  peat: { color: '#3a2a1e', rough: 0.9, relief: 0.8, pattern: 'peat' },
  soil: { color: '#3a2c20', rough: 0.92, relief: 0.8, pattern: 'peat' },
  gravel: { color: '#a8a8a0', rough: 0.7, relief: 0.5, pattern: 'granite' },
  litter: { color: '#3a3020', rough: 0.8, relief: 0.6, pattern: 'peat' },
  heath: { color: '#4a4030', rough: 0.9, relief: 0.6, pattern: 'peat' },
  needles: { color: '#7a5030', rough: 0.7, relief: 0.4, pattern: 'peat' },
  fern: { color: '#4a7a2a', rough: 0.55 }, stoneLantern: { color: '#8c8a82', rough: 0.75 }, heather: { color: '#7a4a6a', rough: 0.7 },
  lichenYellow: { color: '#d8b030', rough: 0.8 }, lichenGrey: { color: '#a8aca0', rough: 0.8 }, cotton: { color: '#f0eee8', rough: 0.9 }, cone: { color: '#6a4228', rough: 0.7 },
};

// formes du substrat (voir gen/colony.js, makeSubstrate)
// matière du support → relief de roche cuit (gen/rock.js)
const ROCK_OF = { bark: 'bark', barkMossy: 'bark', granite: 'granite', graniteDark: 'granite', graniteLichen: 'granite', limestone: 'limestone', sandstone: 'sandstone', peat: 'soil', soil: 'soil' };
const SUPPORTS = {
  log: () => ({ cx: 0.0, cz: 0.2, tilt: 0, bumps: 0.12 }),
  granite: () => ({ cx: 0.03, cz: 0.04, tilt: 0.03, bumps: 0.45 }),
  boulder: () => ({ cx: 0.035, cz: 0.025, tilt: -0.04, bumps: 0.5 }),
  wall: () => ({ cx: 0.02, cz: 0.12, tilt: 0.02, bumps: 0.15 }),
  peat: () => ({ cx: 0.01, cz: 0.01, tilt: 0, bumps: 0.25 }),
  ground: () => ({ cx: 0.015, cz: 0.02, tilt: 0.02, bumps: 0.3 }),
};
// rayon du coussin par famille (cm)
const RADIUS = { tortule: 3.6, polytric: 4.2, funaire: 3.0, sphaigne: 4.0 };

// cadrages : distance (cm), hauteur du regard au-dessus du coussin (cm),
// élévation (rad), champ (°), course latérale (cm)
const FRAMES = {
  ras: { dist: [4.6, 5.6], el: [0.32, 0.45], fov: [26, 32], travel: [1.0, 1.5] },
  plongee: { dist: [5.2, 6.4], el: [0.6, 0.8], fov: [26, 30], travel: [0.8, 1.2] },
  contre: { dist: [4.8, 5.8], el: [0.24, 0.34], fov: [28, 34], travel: [0.9, 1.3] },
  longue: { dist: [9, 11], el: [0.25, 0.35], fov: [13, 16], travel: [1.2, 1.6] },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rf = rng.fork('family');
  let family = overrides.family ?? rf.weighted(M.families);
  if (!FAMILIES[family]) family = 'tortule';
  const F = FAMILIES[family];
  const water = overrides.water ?? rng.fork('water').weighted(M.water);
  const rc = rng.fork('camera'), rl = rng.fork('light'), ra = rng.fork('accord'), rs = rng.fork('colony');
  const acc = ra.pick(M.accords);
  const pal = F.palettes ? ra.pick(F.palettes) : {};
  const frameKey = rc.pick(M.frame);
  const Fr = FRAMES[frameKey];
  const windAz = rs.range(0, Math.PI * 2);
  const lite = !!overrides.lite;

  const sun = M.sun;
  return {
    v: 1, seed, mood, family, water,
    loop: { duration: rs.pick([36, 40, 44]) },
    colony: {
      family, seed: `${seed}`, radius: r2(RADIUS[family] * rs.range(0.92, 1.08)), lite,
      support: { ...SUPPORTS[M.support](), seed: rs.int(0, 9999), kind: M.support, rock: ROCK_OF[acc.support] ?? null },
      sporFrac: r2(F.spor.frac * rs.range(0.8, 1.25)),
      sunDir: [r3(Math.cos(sun.az) * Math.cos(sun.el)), r3(Math.sin(sun.el)), r3(Math.sin(sun.az) * Math.cos(sun.el))],
    },
    hydro: { kind: water, dir: [r3(Math.cos(windAz)), r3(Math.sin(windAz))], intensity: r2(rs.range(0.28, 0.4)) },
    look: {
      dry: F.color.dry, wet: pal.wet ?? F.color.wet, young: pal.young ?? F.color.young, old: F.color.old, hair: F.color.hair,
      trans: pal.trans ?? F.color.trans, seta: F.color.seta, capsule: F.color.capsule, calyptra: F.color.calyptra ?? '#d8b878',
      translucency: r2(rl.range(0.85, 1.15)), gloss: r2(rl.range(0.8, 1.1)),
    },
    camera: {
      frame: frameKey, fov: r2(rc.range(...Fr.fov)), dist: r2(rc.range(...Fr.dist)), el: r3(rc.range(...Fr.el)),
      travel: r2(rc.range(...Fr.travel)), az: r3(sun.az + Math.PI * (sun.back ? 1 : 0.62) + rc.range(-0.35, 0.35)), side: rc.pick([1, -1]),
      rise: r2(rc.range(0.25, 0.45)), aperture: r2(rc.range(0.8, 1.2)), elWide: r3(rc.range(0.26, 0.4)), gaps: M.gaps ?? 0,
    },
    light: {
      sun: { color: kelvinToHex(sun.K + rl.range(-150, 150)), intensity: r2(sun.I * rl.range(0.92, 1.08)), el: r3(sun.el), az: r3(sun.az + rl.range(-0.2, 0.2)), flecks: !!sun.flecks, back: !!sun.back, cloud: sun.cloud },
      moon: sun.moon ? { color: kelvinToHex(sun.moon.K), intensity: sun.moon.I, el: sun.moon.el, az: sun.moon.az } : null,
      rim: { color: kelvinToHex(6200), intensity: r2(rl.range(0.25, 0.45)), az: r3(sun.az + Math.PI + rl.range(-0.5, 0.5)), el: r3(rl.range(0.25, 0.45)) },
      hemi: { sky: M.hemi[0], ground: M.hemi[1], intensity: r2(M.hemi[2] * rl.range(0.9, 1.1)) },
    },
    sky: { wet: M.sky[0], dry: M.sky[1] },
    fog: { wet: M.fog[0], dry: M.fog[1] },
    env: { preset: M.env, intensity: r2(rl.range(0.55, 0.8)), rotation: r2(rl.range(0, Math.PI * 2)) },
    decor: { support: M.support, props: M.props, accord: acc, seed: rs.int(0, 99999), rock: ROCK_OF[acc.support] ?? null },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, water: R.water });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

export { FAMILIES, FAMILY_KEYS };
