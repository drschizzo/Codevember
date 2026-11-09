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

// Matières (modèle physique) : couleur linéaire, métal, rugosité, vernis
export const MATTERS = {
  laiton: { label: 'Laiton', color: [0.86, 0.64, 0.33], metal: 1, rough: 0.26, coat: 0.4 },
  laitonBrosse: { label: 'Laiton brossé', color: [0.8, 0.6, 0.3], metal: 1, rough: 0.4, coat: 0 },
  bronze: { label: 'Bronze patiné', color: [0.3, 0.2, 0.11], metal: 1, rough: 0.42, coat: 0.5 },
  or: { label: 'Or', color: [1.0, 0.77, 0.34], metal: 1, rough: 0.18, coat: 0 },
  cuivre: { label: 'Cuivre', color: [0.95, 0.58, 0.42], metal: 1, rough: 0.3, coat: 0.2 },
  acierBleui: { label: 'Acier bleui', color: [0.1, 0.14, 0.32], metal: 1, rough: 0.2, coat: 0.6 },
  acierPoli: { label: 'Acier poli', color: [0.92, 0.92, 0.9], metal: 1, rough: 0.14, coat: 0 },
  chrome: { label: 'Chrome', color: [0.95, 0.95, 0.96], metal: 1, rough: 0.05, coat: 0 },
  argent: { label: 'Argent', color: [0.97, 0.96, 0.93], metal: 1, rough: 0.2, coat: 0 },
  fonte: { label: 'Fonte', color: [0.18, 0.18, 0.19], metal: 1, rough: 0.6, coat: 0 },
  porcelaine: { label: 'Porcelaine', color: [0.86, 0.85, 0.82], metal: 0, rough: 0.25, coat: 1 },
  laqueNoire: { label: 'Laque noire', color: [0.012, 0.012, 0.014], metal: 0, rough: 0.3, coat: 1 },
  marbreNoir: { label: 'Marbre noir', color: [0.02, 0.02, 0.022], metal: 0, rough: 0.12, coat: 0.6 },
};

// Humeurs : studio, lumières, matières préférées, couleur des astres
export const MOODS = {
  atelier: {
    label: 'Atelier d’horloger', env: 'atelier', envIntensity: 0.45, bg: '#050403', floor: '#0d0b09',
    key: { color: '#ffe2c0', intensity: 6 }, rim: { color: '#bcd2ff', intensity: 0.5 }, warmth: 0.1,
    plate: ['bronze', 'laitonBrosse'], arms: ['laiton', 'or'], arms2: ['acierBleui', 'acierPoli'], gears: ['laiton', 'or', 'cuivre'], pins: ['acierPoli'],
    body: '#ffc489', glass: '#07080a',
  },
  observatoire: {
    label: 'Observatoire', env: 'night', envIntensity: 0.6, bg: '#020307', floor: '#05070c',
    key: { color: '#9fb8ff', intensity: 3 }, rim: { color: '#7d9cff', intensity: 0.8 }, warmth: -0.25,
    plate: ['laqueNoire', 'marbreNoir', 'acierBleui'], arms: ['argent', 'acierPoli'], arms2: ['acierBleui', 'laiton'], gears: ['laiton', 'argent'], pins: ['chrome'],
    body: '#cfe0ff', glass: '#05070b',
  },
  clinique: {
    label: 'Clinique', env: 'studio', envIntensity: 0.9, bg: '#d9d6d0', floor: '#cfccc6',
    key: { color: '#ffffff', intensity: 7 }, rim: { color: '#ffffff', intensity: 0.6 }, warmth: 0,
    plate: ['porcelaine'], arms: ['chrome', 'acierPoli'], arms2: ['porcelaine', 'chrome'], gears: ['chrome', 'laiton'], pins: ['chrome'],
    body: '#ffd9a8', glass: '#0c0d0f',
  },
};

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
    matters: { plate: rng.pick(M.plate), arms: rng.pick(M.arms), arms2: rng.pick(M.arms2), gears: rng.pick(M.gears), pins: rng.pick(M.pins), foot: rng.pick(M.arms) },
    bodies: { color: M.body, glow: r2(rng.range(0.85, 1.15)), flare: r2(rng.range(1.2, 2.2)), light: r2(rng.range(0.1, 0.16)) },
    trace: { show: true, cool: r2(rng.range(4.5, 7.5)), thick: r2(rng.range(0.8, 1.3)), glow: 1, glass: M.glass },
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
