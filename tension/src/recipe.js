// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette, la simulation qu'elle décrit et la
// phase : même recette, même phase → même image.
//
// Règles (skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main [tube, virole, embout, câble, treuil] ;
// - une seule couleur d'accent par scène (la corde, ou l'anodisation) ;
// - les lampes sont presque blanches (≥ 4700 K), la chaleur vient du sol, du
//   fond, des contre-jours et de l'étalonnage.
import { createRng } from '../../shared/rng.js';
import { FINISHES } from '../../shared/finishes.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Familles ─────────────────────────────────────────────────────────────────
// sim : ce que le worker simule (gen/gait.js · prepare) ; tout le reste est rendu.
export const FAMILIES = {
  culbute: { label: 'Culbute', sims: [{ family: 'culbute', n: 6 }] },
  chenille: { label: 'Chenille', sims: [{ family: 'chenille', m: 4 }, { family: 'chenille', m: 6 }] },
  cerceau: { label: 'Cerceau', sims: [{ family: 'cerceau', m: 12 }] },
};

// ── Câbles (une matière par scène) ──────────────────────────────────────────
export const CABLES = {
  steel: { label: 'Fil d’acier tressé', color: '#bfc2c6', metal: 1, rough: 0.32, braid: 0.8, sheen: 0, r: 0.011 },
  dyneemaBlack: { label: 'Dyneema noir', color: '#141416', metal: 0, rough: 0.55, braid: 1, sheen: 0.5, r: 0.013 },
  dyneemaWhite: { label: 'Dyneema blanc', color: '#e6e2d8', metal: 0, rough: 0.6, braid: 1, sheen: 0.4, r: 0.013 },
  red: { label: 'Tresse rouge', color: '#a3201c', metal: 0, rough: 0.55, braid: 1, sheen: 0.6, r: 0.013, accent: true },
  orange: { label: 'Tresse orange', color: '#c4561c', metal: 0, rough: 0.55, braid: 1, sheen: 0.6, r: 0.013, accent: true },
  hemp: { label: 'Chanvre ciré', color: '#a58553', metal: 0, rough: 0.5, braid: 1, sheen: 0.3, r: 0.015 },
  blue: { label: 'Tresse bleu de Prusse', color: '#1d3a6e', metal: 0, rough: 0.55, braid: 1, sheen: 0.6, r: 0.013, accent: true },
};

// ── Humeurs : un décor, une lumière, une valeur, un cadrage ──────────────────
// floor : sol (scene/floor.js) ; bg : fond et brume ; env : studio HDR ;
// key : lampe principale { K, az, el (rad, dans le repère de la marche :
// az 0 = devant, π/2 = côté caméra), angle, penumbra, scale, dist } ;
// rim : contre-jours [couleur, az, el, part] ; cam : cadrage { az (rad,
// 0 = profil strict depuis −z… voir main.js), el, dist, fov } ;
// accords : [tube, virole, embout, câble, treuil (corps)].
export const MOODS = {
  galerie: {
    label: 'Galerie', floor: 'oak', bg: '#e8e4dd', fogNear: 4, fogFar: 30, env: 'softbox', envI: [0.2, 0.28],
    key: { K: 5600, az: 0.5, el: 1.2, angle: 0.75, penumbra: 0.75, scale: 0.85, dist: 14 },
    rim: [['#ffffff', 2.6, 0.45, 0.25], ['#fff4e8', -2.4, 0.35, 0.12]],
    cam: { az: 0.55, el: 0.32, dist: 1.0, fov: 30 },
    accords: [['diamondCut', 'blackenedSteel', 'polishedBrass', 'dyneemaBlack', 'blackCeramic'], ['blackenedSteel', 'brushedBrass', 'polishedBrass', 'red', 'blackenedSteel'], ['carbon', 'diamondCut', 'brushedSteel', 'orange', 'diamondCut']],
    grade: { contrast: 0.98, saturation: 0.92, shadows: [0.98, 0.99, 1.02], highlights: [1.0, 0.99, 0.97] },
  },
  ardoise: {
    label: 'Ardoise', floor: 'slate', bg: '#060607', fogNear: 2, fogFar: 16, env: 'night', envI: [0.3, 0.4],
    key: { K: 5200, az: -2.3, el: 0.62, angle: 0.42, penumbra: 0.55, scale: 1.25, dist: 11 },
    rim: [['#dfe8ff', 1.25, 0.45, 0.4], ['#ffe2c0', -0.9, 0.25, 0.25]],
    cam: { az: 0.85, el: 0.16, dist: 0.85, fov: 34 },
    accords: [['chrome', 'blackenedSteel', 'polishedBrass', 'steel', 'blackCeramic'], ['brushedSteel', 'polishedCopper', 'polishedCopper', 'red', 'blackenedSteel'], ['oxideTitanium', 'rawTitanium', 'polishedBrass', 'dyneemaBlack', 'blackCeramic']],
    grade: { contrast: 1.1, saturation: 0.95, shadows: [0.94, 0.97, 1.06], highlights: [1.04, 1.0, 0.95] },
  },
  midi: {
    label: 'Midi', floor: 'concrete', bg: '#c9d2d9', fogNear: 8, fogFar: 45, env: 'clearsky', envI: [0.45, 0.6],
    key: { K: 5800, az: 1.0, el: 1.18, angle: 0.75, penumbra: 0.25, scale: 1.1, dist: 30 },
    rim: [['#dbe8ff', -2.0, 0.6, 0.18], ['#ffffff', 2.8, 0.3, 0.08]],
    cam: { az: 0.35, el: 0.42, dist: 1.1, fov: 32 },
    accords: [['anodized', 'diamondCut', 'brushedSteel', 'dyneemaWhite', 'whiteCeramic'], ['brushedSteel', 'polishedBrass', 'polishedBrass', 'orange', 'blackCeramic'], ['diamondCut', 'carbon', 'chrome', 'dyneemaBlack', 'carbon']],
    grade: { contrast: 1.04, saturation: 1.0, shadows: [0.96, 0.99, 1.05], highlights: [1.03, 1.01, 0.97] },
  },
  labo: {
    label: 'Labo', floor: 'lino', bg: '#6c7276', fogNear: 5, fogFar: 28, env: 'softbox', envI: [0.45, 0.55],
    key: { K: 6500, az: 0.0, el: 1.45, angle: 0.9, penumbra: 1.0, scale: 0.75, dist: 12 },
    rim: [['#e8f0ff', 1.57, 1.0, 0.45], ['#e8f0ff', -1.57, 1.0, 0.45]],
    cam: { az: 0.0, el: 0.2, dist: 1.05, fov: 28 },
    accords: [['diamondCut', 'anodized', 'chrome', 'dyneemaBlack', 'blackCeramic'], ['carbon', 'chrome', 'chrome', 'red', 'chrome'], ['brushedSteel', 'blackCeramic', 'brushedSteel', 'blue', 'blackCeramic']],
    grade: { contrast: 1.0, saturation: 0.86, shadows: [0.95, 0.99, 1.05], highlights: [0.98, 1.0, 1.03] },
  },
  crepuscule: {
    label: 'Crépuscule', floor: 'brick', bg: '#1b1411', fogNear: 3, fogFar: 22, env: 'dusk', envI: [0.3, 0.42],
    key: { K: 4800, az: 0.15, el: 0.2, angle: 0.3, penumbra: 0.35, scale: 1.4, dist: 22 },
    rim: [['#ffd7b0', 2.9, 0.25, 0.35], ['#9fb4ff', -1.8, 0.7, 0.12]],
    cam: { az: 0.2, el: 0.1, dist: 1.0, fov: 34 },
    accords: [['rawTitanium', 'bronzeDark', 'polishedBrass', 'hemp', 'bronzeDark'], ['blackenedSteel', 'polishedCopper', 'polishedCopper', 'dyneemaBlack', 'blackenedSteel'], ['oxideTitanium', 'blackenedSteel', 'brushedBrass', 'steel', 'blackCeramic']],
    grade: { contrast: 1.08, saturation: 1.02, shadows: [0.95, 0.96, 1.05], highlights: [1.06, 1.0, 0.92] },
  },
  scene: {
    label: 'Scène', floor: 'stage', bg: '#030303', fogNear: 2, fogFar: 14, env: 'night', envI: [0.18, 0.26],
    key: { K: 5000, az: 0.6, el: 1.2, angle: 0.22, penumbra: 0.45, scale: 1.5, dist: 12 },
    rim: [['#ffe6cc', -2.6, 0.5, 0.45], ['#c8d4ff', 2.5, 0.2, 0.15]],
    cam: { az: -0.65, el: 0.24, dist: 0.95, fov: 32 },
    accords: [['chrome', 'blackenedSteel', 'polishedBrass', 'red', 'blackCeramic'], ['polishedBrass', 'blackenedSteel', 'polishedBrass', 'dyneemaBlack', 'blackenedSteel'], ['diamondCut', 'carbon', 'polishedCopper', 'steel', 'carbon']],
    grade: { contrast: 1.12, saturation: 0.98, shadows: [0.97, 0.96, 1.02], highlights: [1.05, 1.0, 0.94] },
  },
  brume: {
    label: 'Brume', floor: 'wet', bg: '#7f868a', fogNear: -3, fogFar: 14, env: 'overcast', envI: [0.5, 0.65],
    key: { K: 6200, az: 2.2, el: 1.3, angle: 0.9, penumbra: 1.0, scale: 0.45, dist: 14 },
    rim: [['#e8eef2', -2.2, 0.6, 0.25], ['#e8eef2', 1.0, 0.8, 0.1]],
    cam: { az: 0.45, el: 0.22, dist: 1.4, fov: 22 },
    accords: [['blackenedSteel', 'brushedBrass', 'brushedBrass', 'orange', 'blackenedSteel'], ['carbon', 'chrome', 'chrome', 'dyneemaWhite', 'carbon'], ['brushedSteel', 'blackCeramic', 'polishedCopper', 'red', 'blackCeramic']],
    grade: { contrast: 0.94, saturation: 0.8, shadows: [0.98, 1.0, 1.03], highlights: [1.0, 1.0, 1.0] },
  },
};

const ACCENT_TINTS = ['#2f5f9e', '#9e2f3a', '#2c7a64', '#b06a24', '#3b3f48'];

// trois finitions d'une barre : tube (OUT), virole (IN), embout (EDGE)
const fin = (k, tint) => ({ ...FINISHES[k], preset: k, ...(tint && ['anodized', 'anodizedMatte'].includes(k) ? { color: tint } : {}) });

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const family = overrides.family ?? rng.fork('family').weighted([['culbute', 1.2], ['chenille', 1], ['cerceau', 1]]);
  const Fm = FAMILIES[family];
  const rs = rng.fork('sim');
  const sim = { ...rs.pick(Fm.sims) };
  const ra = rng.fork('accord');
  const [tube, ferrule, fitting, cable, winchBody] = ra.pick(M.accords);
  const C = CABLES[cable];
  // une seule couleur d'accent : la corde si elle est colorée, sinon l'anodisation
  const tint = C.accent ? '#3b3f48' : ra.pick(ACCENT_TINTS);
  const rc = rng.fork('camera'), rl = rng.fork('light');
  const set = (o, i, e, wear = 0.06) => ({ outer: fin(o, tint), inner: fin(i, tint), edge: fin(e, tint), wear });

  return {
    v: 1, seed, mood, family, sim,
    loop: { duration: 0, speed: 1 }, // (durée : celle du pas simulé, connue après la simulation)
    camera: {
      fov: r2(M.cam.fov + rc.range(-2, 2)), dist: r2(M.cam.dist * rc.range(0.92, 1.08)), az: r2(M.cam.az + rc.range(-0.15, 0.15)),
      el: r2(M.cam.el + rc.range(-0.04, 0.05)), sway: r2(rc.range(0.04, 0.09)), lead: r2(rc.range(0.05, 0.2)),
    },
    light: {
      key: { color: kelvinToHex(M.key.K + rl.range(-150, 150)), scale: r2(M.key.scale * rl.range(0.92, 1.08)), az: r2(M.key.az + rl.range(-0.12, 0.12)), el: M.key.el, angle: M.key.angle, penumbra: M.key.penumbra, dist: M.key.dist },
      rim: M.rim.map(([c, az, el, s]) => ({ color: c, az, el, scale: r2(s * rl.range(0.85, 1.15)) })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envI)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: M.fogNear, far: M.fogFar },
    floor: { type: M.floor },
    mats: {
      strut: set(tube, ferrule, fitting),
      ball: set(fitting, ferrule, fitting, 0),
      winch: set(winchBody, cable === 'steel' ? 'brushedSteel' : 'blackenedSteel', fitting, 0.04),
      cable,
    },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
