// Recette de la scène : tout ce qui découle de la graine (orbite demandée,
// humeur, matières, astres, trace, mise en scène, lumières). L'objet est
// sérialisable (« Copier le lien ») et entièrement modifiable depuis le
// panneau ; les réglages de rendu n'en font pas partie (app/settings.js).
//
// L'orbite elle-même n'est pas dans la recette : elle se recalcule, à
// l'identique, à partir de la graine et des contraintes demandées (nombre de
// corps, symétrie, rotation du plateau).
import { createRng } from './rng.js';

const r2 = (x) => Math.round(x * 100) / 100;

// Matières (modèle physique) : couleur linéaire, métal, rugosité, vernis ;
// irid : irisation (nacre), sheen : lustre (bois ciré)
export const MATTERS = {
  laiton: { label: 'Laiton', color: [0.86, 0.64, 0.33], metal: 1, rough: 0.26, coat: 0.4 },
  laitonBrosse: { label: 'Laiton brossé', color: [0.8, 0.6, 0.3], metal: 1, rough: 0.4, coat: 0 },
  bronze: { label: 'Bronze patiné', color: [0.3, 0.2, 0.11], metal: 1, rough: 0.42, coat: 0.5 },
  bronzeVert: { label: 'Bronze vert-de-gris', color: [0.16, 0.24, 0.19], metal: 0.6, rough: 0.6, coat: 0.2 },
  or: { label: 'Or', color: [1.0, 0.77, 0.34], metal: 1, rough: 0.18, coat: 0 },
  orRose: { label: 'Or rose', color: [0.98, 0.64, 0.52], metal: 1, rough: 0.2, coat: 0 },
  cuivre: { label: 'Cuivre', color: [0.95, 0.58, 0.42], metal: 1, rough: 0.3, coat: 0.2 },
  acierBleui: { label: 'Acier bleui', color: [0.1, 0.14, 0.32], metal: 1, rough: 0.2, coat: 0.6 },
  acierPoli: { label: 'Acier poli', color: [0.92, 0.92, 0.9], metal: 1, rough: 0.14, coat: 0 },
  acierNoirci: { label: 'Acier noirci', color: [0.07, 0.07, 0.075], metal: 1, rough: 0.35, coat: 0.3 },
  chrome: { label: 'Chrome', color: [0.95, 0.95, 0.96], metal: 1, rough: 0.05, coat: 0 },
  argent: { label: 'Argent', color: [0.97, 0.96, 0.93], metal: 1, rough: 0.2, coat: 0 },
  titane: { label: 'Titane anodisé', color: [0.32, 0.18, 0.55], metal: 1, rough: 0.25, coat: 0.3, irid: 0.6 },
  fonte: { label: 'Fonte', color: [0.18, 0.18, 0.19], metal: 1, rough: 0.6, coat: 0 },
  porcelaine: { label: 'Porcelaine', color: [0.86, 0.85, 0.82], metal: 0, rough: 0.25, coat: 1 },
  emailBleu: { label: 'Émail bleu de Sèvres', color: [0.02, 0.05, 0.3], metal: 0, rough: 0.2, coat: 1 },
  emailRouge: { label: 'Émail rouge', color: [0.35, 0.02, 0.02], metal: 0, rough: 0.2, coat: 1 },
  laqueNoire: { label: 'Laque noire', color: [0.012, 0.012, 0.014], metal: 0, rough: 0.3, coat: 1 },
  marbreNoir: { label: 'Marbre noir', color: [0.02, 0.02, 0.022], metal: 0, rough: 0.12, coat: 0.6 },
  marbreBlanc: { label: 'Marbre blanc', color: [0.78, 0.77, 0.74], metal: 0, rough: 0.15, coat: 0.6 },
  ardoise: { label: 'Ardoise', color: [0.05, 0.055, 0.06], metal: 0, rough: 0.7, coat: 0 },
  ebene: { label: 'Ébène cirée', color: [0.025, 0.015, 0.01], metal: 0, rough: 0.35, coat: 0.8, sheen: 0.4 },
  noyer: { label: 'Noyer ciré', color: [0.16, 0.07, 0.03], metal: 0, rough: 0.4, coat: 0.7, sheen: 0.4 },
  nacre: { label: 'Nacre', color: [0.82, 0.8, 0.76], metal: 0, rough: 0.15, coat: 1, irid: 1 },
};

// Humeurs : studio, lumières, matières et natures préférées, couleur des astres
export const MOODS = {
  atelier: {
    label: 'Atelier d’horloger', env: 'atelier', envIntensity: 0.45, bg: '#050403', floor: '#0d0b09',
    key: { color: '#ffe2c0', intensity: 6 }, rim: { color: '#bcd2ff', intensity: 0.5 }, warmth: 0.1,
    plate: ['bronze', 'laitonBrosse', 'emailBleu'], arms: ['laiton', 'or'], arms2: ['acierBleui', 'acierPoli'], gears: ['laiton', 'or', 'cuivre'], pins: ['acierPoli', 'acierBleui'], foot: ['laiton', 'bronze'],
    finish: ['guilloche', 'soleil', 'perlage'], present: [['pied', 3], ['cloche', 2]], bodies: [['perle', 3], ['lanterne', 1], ['gemme', 1]], trace: [['verre', 3], ['or', 1], ['gravure', 1]],
    body: '#ffc489', glass: '#07080a',
  },
  observatoire: {
    label: 'Observatoire', env: 'night', envIntensity: 0.6, bg: '#020307', floor: '#05070c',
    key: { color: '#9fb8ff', intensity: 3 }, rim: { color: '#7d9cff', intensity: 0.8 }, warmth: -0.25,
    plate: ['laqueNoire', 'marbreNoir', 'acierBleui', 'emailBleu'], arms: ['argent', 'acierPoli'], arms2: ['acierBleui', 'laiton'], gears: ['laiton', 'argent'], pins: ['chrome'], foot: ['acierNoirci', 'argent'],
    finish: ['lisse', 'soleil'], present: [['pied', 2], ['suspendue', 2]], bodies: [['perle', 2], ['gemme', 2]], trace: [['verre', 2], ['gravure', 1]],
    body: '#cfe0ff', glass: '#05070b',
  },
  clinique: {
    label: 'Clinique', env: 'studio', envIntensity: 0.9, bg: '#d9d6d0', floor: '#cfccc6',
    key: { color: '#ffffff', intensity: 7 }, rim: { color: '#ffffff', intensity: 0.6 }, warmth: 0,
    plate: ['porcelaine', 'marbreBlanc'], arms: ['chrome', 'acierPoli'], arms2: ['porcelaine', 'chrome'], gears: ['chrome', 'laiton'], pins: ['chrome'], foot: ['chrome', 'porcelaine'],
    finish: ['lisse', 'perlage'], present: [['pied', 2], ['cloche', 1], ['suspendue', 1]], bodies: [['metal', 2], ['perle', 1], ['gemme', 1]], trace: [['verre', 2], ['aucune', 1]],
    body: '#ffd9a8', glass: '#0c0d0f',
  },
  // cabinet de curiosités : bois cirés, nacre, or ; lumière de bougie
  cabinet: {
    label: 'Cabinet de curiosités', env: 'atelier', envIntensity: 0.35, bg: '#070403', floor: '#120905',
    key: { color: '#ffc98a', intensity: 4.5 }, rim: { color: '#ffd9b0', intensity: 0.3 }, warmth: 0.3,
    plate: ['noyer', 'ebene', 'nacre'], arms: ['or', 'laiton'], arms2: ['nacre', 'ebene', 'orRose'], gears: ['or', 'laiton'], pins: ['or'], foot: ['ebene', 'noyer'],
    finish: ['lisse', 'guilloche'], present: [['cloche', 3], ['pied', 1]], bodies: [['lanterne', 2], ['gemme', 2], ['perle', 1]], trace: [['or', 2], ['verre', 1]],
    body: '#ffb45e', glass: '#0a0705',
  },
  // forge : fonte, cuivre et métal en fusion
  forge: {
    label: 'Forge', env: 'atelier', envIntensity: 0.25, bg: '#030202', floor: '#0a0807',
    key: { color: '#ff9a5a', intensity: 3 }, rim: { color: '#ff6a2a', intensity: 0.4 }, warmth: 0.35,
    plate: ['fonte', 'ardoise', 'acierNoirci'], arms: ['cuivre', 'fonte'], arms2: ['acierNoirci', 'bronze'], gears: ['cuivre', 'bronze'], pins: ['acierNoirci'], foot: ['fonte'],
    finish: ['lisse', 'perlage'], present: [['pied', 2], ['suspendue', 1]], bodies: [['perle', 3], ['metal', 1]], trace: [['gravure', 2], ['verre', 2]],
    body: '#ff8a3a', glass: '#0a0503',
  },
  // sacré : or, émaux, pénombre d'une nef
  sacre: {
    label: 'Sacré', env: 'atelier', envIntensity: 0.3, bg: '#060402', floor: '#0c0804',
    key: { color: '#ffd28a', intensity: 5 }, rim: { color: '#9ab4ff', intensity: 0.35 }, warmth: 0.25,
    plate: ['emailBleu', 'emailRouge', 'marbreNoir'], arms: ['or'], arms2: ['or', 'orRose'], gears: ['or'], pins: ['or'], foot: ['or', 'marbreNoir'],
    finish: ['soleil', 'guilloche'], present: [['suspendue', 2], ['cloche', 1], ['pied', 1]], bodies: [['gemme', 2], ['lanterne', 2]], trace: [['or', 2], ['verre', 1]],
    body: '#ffe0a0', glass: '#080604',
  },
};

export const PRESENTATIONS = { pied: 'Sur pied', cloche: 'Sous cloche', suspendue: 'Suspendue' };
export const FINISHES = { lisse: 'Lisse', guilloche: 'Guilloché', soleil: 'Soleil (rayonnant)', perlage: 'Perlage' };
export const BODY_KINDS = { perle: 'Perle incandescente', gemme: 'Gemme taillée', metal: 'Métal poli', lanterne: 'Lanterne' };
export const TRACE_KINDS = { verre: 'Verre filé', or: 'Fil d’or', gravure: 'Gravure rougeoyante', aucune: 'Aucune' };

// plans de caméra (voir scene/choreo.js)
export const SHOT_KINDS = { ensemble: 'Ensemble', rasant: 'Rasant', zenith: 'Zénith', astre: 'Astre', machine: 'Machine' };

export function generate(seed, { mood } = {}) {
  const rng = createRng(`recipe:${seed}`);
  const moodKey = mood ?? rng.pick(Object.keys(MOODS));
  const M = MOODS[moodKey];
  return {
    v: 1, seed: String(seed), mood: moodKey,
    // contraintes sur l'orbite (null : tirées de la graine)
    orbit: { N: null, sym: null, omega: null },
    stage: { presentation: rng.weighted(M.present), finish: rng.pick(M.finish), finishScale: r2(rng.range(0.7, 1.4)) },
    matters: { plate: rng.pick(M.plate), arms: rng.pick(M.arms), arms2: rng.pick(M.arms2), gears: rng.pick(M.gears), pins: rng.pick(M.pins), foot: rng.pick(M.foot) },
    bodies: { kind: rng.weighted(M.bodies), color: M.body, glow: r2(rng.range(0.85, 1.15)), flare: r2(rng.range(1.2, 2.2)), light: r2(rng.range(0.1, 0.16)) },
    trace: { kind: rng.weighted(M.trace), show: true, cool: r2(rng.range(4.5, 7.5)), thick: r2(rng.range(0.8, 1.3)), glow: 1, glass: M.glass },
    motion: { period: Math.round(rng.range(8, 12)), slowmo: r2(rng.range(0.8, 1.15)), shotLength: 6, free: false },
    light: {
      env: M.env, envIntensity: M.envIntensity, bg: M.bg, floor: M.floor, warmth: M.warmth,
      key: { ...M.key }, rim: { ...M.rim },
    },
  };
}

// recette d'une version antérieure : complétée par les valeurs par défaut
export function upgrade(R) {
  const base = generate(R.seed ?? 'x', { mood: MOODS[R.mood] ? R.mood : undefined });
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      if (a[k] === undefined) a[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v);
    }
    return a;
  };
  return merge(R, base);
}

// contraintes de la recette → paramètres imposés au solveur
export function orbitOverrides(R) {
  const o = {};
  if (R.orbit.N) o.N = R.orbit.N;
  if (R.orbit.sym !== null && R.orbit.sym !== undefined) o.sym = R.orbit.sym === 'none' ? null : R.orbit.sym;
  if (R.orbit.omega) o.omegaFrac = R.orbit.omega;
  return o;
}

// partage : recette compressée dans l'ancre (#r=…)
export async function packRecipe(R) {
  const s = new Blob([JSON.stringify(R)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackRecipe(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(s).text());
}
