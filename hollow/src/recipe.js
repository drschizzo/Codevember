// Recette de la scène : tout ce qui découle de la graine (couches, formes,
// matériaux, mouvements, lumières, humeur). L'objet est sérialisable et
// entièrement modifiable depuis l'interface ; les réglages de rendu (post-
// traitement, qualité) n'en font pas partie et survivent aux changements de
// graine.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS, FINISH_DEFAULTS } from './finishes.js';
import { TYPES, geometryFor, randomType } from './types.js';

export { geometryFor, randomType } from './types.js';

const r2 = (x) => Math.round(x * 1000) / 1000;

// pavages percés classiques, et pièces d'exception (une au moins par scène)
const CLASSIC = ['cells', 'voronoi', 'slots', 'girih'];
const FEATURED = ['armillary', 'scales', 'weave', 'shards', 'radiolarian', 'coral', 'vitrail', 'tpms', 'geode'];

// Humeurs : environnement de studio, couleur du cœur (température, ou teintes),
// fond, poussière, brouillard, phosphorescence des tranches, pièces d'exception préférées
export const MOODS = {
  atelier: { label: 'Atelier', env: 'atelier', coreK: [2300, 3000], keyK: 3600, bg: '#070605' },
  studio: { label: 'Studio', env: 'studio', coreK: [4200, 5600], keyK: 5600, bg: '#050608', dust: '#dfe3ea' },
  luxe: { label: 'Écrin', env: 'atelier', coreK: [2000, 2600], keyK: 3200, bg: '#060405' },
  nuit: { label: 'Nuit', env: 'night', coreK: [7000, 12000], keyK: 6500, bg: '#020307', dust: '#c9d6ff' },
  pastel: { label: 'Pastel', env: 'softbox', coreK: [3800, 5000], keyK: 5000, bg: '#09080a' },
  'irisé': { label: 'Irisé', env: 'studio', coreK: [5000, 8000], keyK: 6000, bg: '#040507' },
  // porcelaine, céramique et chrome sur fond blanc : la profondeur se perd dans le blanc
  clinique: {
    label: 'Clinique', env: 'cyclo', coreK: [6000, 7500], keyK: 6500, bg: '#e8e6e1', dust: '#ffffff',
    envIntensity: [0.9, 1.1], fog: { near: 1.3, far: 3.6 }, featured: ['shards', 'scales', 'armillary', 'radiolarian', 'coral', 'tpms'],
  },
  // nuit marine : un cœur cyan, des tranches phosphorescentes qui pulsent
  abysses: {
    label: 'Abysses', env: 'abyss', coreK: [9000, 12000], coreColor: ['#3fd8ff', '#46ffd0', '#5aa8ff'], keyK: 9000, bg: '#010609', dust: '#8ff0ff',
    emit: [0.5, 1], emitColor: ['#36e0ff', '#3dffc0', '#7a7dff'], featured: ['radiolarian', 'coral', 'scales', 'tpms', 'weave'],
  },
  // or, émail et vitraux dans la pénombre d'une nef ; la poussière flotte dans les rayons
  'sacré': {
    label: 'Sacré', env: 'atelier', coreK: [1900, 2400], keyK: 2900, bg: '#0a0603', dust: '#ffd27a', dustAmount: [0.7, 1],
    fog: { near: 1.2, far: 2.6 }, featured: ['vitrail', 'armillary', 'geode', 'girih'],
  },
};

// Pierres serties : teinte (absorption), indice, dispersion
export const GEMS = {
  diamond: { label: 'Diamant', color: '#fbfcff', ior: 2.42, dispersion: 1, depth: 2 },
  sapphire: { label: 'Saphir', color: '#1f4fd8', ior: 1.77, dispersion: 0.45, depth: 0.25 },
  ruby: { label: 'Rubis', color: '#d01838', ior: 1.77, dispersion: 0.45, depth: 0.25 },
  emerald: { label: 'Émeraude', color: '#1aa05a', ior: 1.58, dispersion: 0.3, depth: 0.3 },
  amethyst: { label: 'Améthyste', color: '#8a3fd0', ior: 1.55, dispersion: 0.3, depth: 0.35 },
  citrine: { label: 'Citrine', color: '#f0a020', ior: 1.55, dispersion: 0.3, depth: 0.35 },
};

// finitions d'une couche à partir d'un jeu (copie profonde, teintes tirées)
export function finishesFor(setKey, rng) {
  const set = SETS[setKey];
  const pick = (k) => ({ ...FINISHES[k], preset: k });
  const out = {
    outer: pick(set.outer), inner: pick(set.inner), edge: pick(set.edge), wear: set.wear,
    // gravure qui suit le contour des trous (sauf verre et pierre)
    groove: set.groove !== false && rng.chance(0.35) ? r2(rng.range(0.5, 1)) : 0,
    grooveAt: r2(rng.range(0.35, 0.75)),
  };
  // une même teinte d'anodisation ou d'émail pour les faces d'une couche
  if (set.outer === 'anodized') {
    const tint = rng.pick(TINTS.anodized);
    out.outer.color = tint; out.inner.color = tint;
  }
  if (set.outer === 'glaze') out.outer.color = rng.pick(TINTS.glaze);
  return out;
}

export const kelvinToHex = (K) => {
  // approximation de Tanner Helland (rayonnement du corps noir → sRGB)
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// une couche complète (type, forme, matériaux, mouvement)
export function makeLayer(type, rng, seedTag, moodKey, avoidSet = null) {
  const T = TYPES[type];
  let set = T.set;
  if (!set && T.sets) set = rng.pick(T.sets.filter((k) => k !== avoidSet));
  if (!set) {
    const free = (k) => !SETS[k].only;
    const pool = Object.keys(SETS).filter((k) => free(k) && SETS[k].moods.includes(moodKey));
    const others = Object.keys(SETS).filter((k) => free(k) && !pool.includes(k));
    do set = rng.chance(0.82) && pool.length ? rng.pick(pool) : rng.pick(others); while (set === avoidSet);
  }
  const geo = geometryFor(type, rng.fork(`geo:${seedTag}`), seedTag);
  geo.chamfer = SETS[set].chamfer;
  const finish = finishesFor(set, rng);
  if (T.noGroove) finish.groove = 0; // (pas de contour de trou à suivre)
  if (geo.burst) finish.seam = 0.07; // (kintsugi : un filet d'or le long des cassures)
  return {
    type, set, geo, finish,
    crystal: { tip: rng.pick(['#8a4fd6', '#c27be6', '#e0a24a', '#7fb8e8', '#e8e2f0']), base: '#efe9f2', rough: 0.03, dispersion: 0.45, ior: 1.55 },
    motion: { spin: rng.pick([-2, -1, 1, 2]), tumble: rng.pick([-1, 1, 1, 2]), axis: rng.dir().map(r2), phase: r2(rng.range(0, Math.PI * 2)) },
    gem: { ...rng.fork(`gem:${seedTag}`).pick(Object.values(GEMS)) },
    pane: { rough: 0.12, glow: 0.6 },
  };
}

// force : { mood } pour imposer une humeur (le reste du tirage est inchangé)
export function generate(seed, force = {}) {
  const rng = createRng(seed);
  const picked = rng.pick(Object.keys(MOODS));
  const moodKey = force.mood && MOODS[force.mood] ? force.mood : picked;
  const mood = MOODS[moodKey];
  const N = rng.int(4, 6);

  // types : une coquille percée classique, une pièce d'exception, puis un
  // tirage pondéré (chaque type rare au plus une fois), dans le désordre
  const count = {};
  const take = (t) => { count[t] = (count[t] || 0) + 1; return t; };
  const types = [take(rng.pick(CLASSIC)), take(rng.pick(mood.featured ?? FEATURED))];
  while (types.length < N) types.push(take(randomType(rng, count)));
  for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }

  let prevSet = null;
  const layers = types.map((type, i) => {
    const L = makeLayer(type, rng, `${seed}:${i}`, moodKey, prevSet);
    prevSet = L.set;
    return L;
  });

  const coreK = Math.round(rng.range(...mood.coreK) / 50) * 50;
  const look = rng.fork('look'); // (tirages propres aux humeurs : le reste ne change pas)
  if (mood.emit) {
    const emit = r2(look.range(...mood.emit)), color = look.pick(mood.emitColor);
    for (const L of layers) Object.assign(L.finish.edge, { emit, emitColor: color });
  }
  // (l'ancien tirage de l'intensité de la lampe est conservé, pour que chaque
  // graine garde le reste de son éclairage ; l'intensité est fixée à 40)
  return {
    seed: String(seed), mood: moodKey,
    nest: { ratio: r2(rng.range(0.58, 0.66)), core: r2(rng.range(0.035, 0.06)) },
    loop: { duration: 24, dive: true, depth: 0.35 },
    camera: { fov: Math.round(rng.range(36, 48)), sway: r2(rng.range(0.015, 0.05)), roll: r2(rng.range(0, 0.06)) },
    core: { color: mood.coreColor ? look.pick(mood.coreColor) : kelvinToHex(coreK), intensity: r2(rng.range(28, 55)), glow: r2(rng.range(6, 13)), halo: r2(rng.range(2.0, 2.8)), decay: 2, pulse: r2(rng.range(0, 0.15)), shadowSoft: 2 },
    key: { color: kelvinToHex(mood.keyK), intensity: (rng.next(), 40), x: r2(rng.range(-0.45, -0.2)), y: r2(rng.range(0.2, 0.45)), angle: 0.85, penumbra: 0.9 },
    env: { preset: mood.env, intensity: (() => { const v = rng.range(0.9, 1.25); return r2(mood.envIntensity ? look.range(...mood.envIntensity) : v); })(), rotation: r2(rng.range(0, Math.PI * 2)) },
    fog: { color: mood.bg, near: mood.fog?.near ?? 1.5, far: mood.fog?.far ?? 3.1 },
    dust: dustFor(rng.fork('dust'), mood),
    layers,
  };
}

// poussière en suspension (tirage à part : le reste de la scène ne change pas)
function dustFor(rng, mood) {
  return { amount: r2(rng.range(...(mood.dustAmount ?? [0.3, 0.75]))), size: r2(rng.range(0.8, 1.3)), color: mood.dust ?? '#e8c27a' };
}

// recette partagée par une version antérieure : champs ajoutés depuis
export function upgrade(R) {
  for (const L of R.layers) for (const k of ['outer', 'inner', 'edge']) L.finish[k] = { ...FINISH_DEFAULTS, ...L.finish[k] };
  R.dust ??= dustFor(createRng(`${R.seed}:dust`), MOODS[R.mood] ?? MOODS.atelier);
  for (const L of R.layers) { L.gem ??= { ...GEMS.diamond }; L.pane ??= { rough: 0.12, glow: 0.6 }; }
  return R;
}
