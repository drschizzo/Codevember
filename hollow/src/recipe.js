// Recette de la scène : tout ce qui découle de la graine (couches, formes,
// matériaux, mouvements, lumières, humeur). L'objet est sérialisable et
// entièrement modifiable depuis l'interface ; les réglages de rendu (post-
// traitement, qualité) n'en font pas partie et survivent aux changements de
// graine.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';

// Humeurs : environnement de studio, couleur du cœur, fond, jeux préférés
export const MOODS = {
  atelier: { label: 'Atelier', env: 'atelier', coreK: [2300, 3000], keyK: 3600, bg: '#070605' },
  studio: { label: 'Studio', env: 'studio', coreK: [4200, 5600], keyK: 5600, bg: '#050608' },
  luxe: { label: 'Écrin', env: 'atelier', coreK: [2000, 2600], keyK: 3200, bg: '#060405' },
  nuit: { label: 'Nuit', env: 'night', coreK: [7000, 12000], keyK: 6500, bg: '#020307' },
  pastel: { label: 'Pastel', env: 'softbox', coreK: [3800, 5000], keyK: 5000, bg: '#09080a' },
  'irisé': { label: 'Irisé', env: 'studio', coreK: [5000, 8000], keyK: 6000, bg: '#040507' },
};

export const LAYER_TYPES = { cells: 'Alvéoles', voronoi: 'Voronoï', slots: 'Fentes', tpms: 'Surface minimale', geode: 'Géode' };

const r2 = (x) => Math.round(x * 1000) / 1000;

// forme des trous et détails usinés (alvéoles, Voronoï, fentes)
function holeDetails(rng, type) {
  const shape = type === 'slots'
    ? rng.weighted([['poly', 4], ['ellipse', 2.5], ['iris', 1]])
    : rng.weighted([['poly', 4], ['ellipse', 2], ['star', 1.3], ['iris', 1.6]]);
  const d = {
    shape,
    petals: shape === 'star' ? rng.int(4, 7) : rng.int(5, 8),
    depth: r2(rng.range(0.2, 0.42)), aspect: r2(rng.range(0.28, 0.62)),
    holeScale: r2(shape === 'poly' ? 1 : rng.range(0.78, 1)),
    orient: r2(rng.range(0, Math.PI)), swirl: rng.pick([0, 0, 0.6, 1.2, -0.8]), orientJitter: rng.pick([0, 0, 0, 0.7]),
    pillow: rng.chance(0.4) ? r2(rng.range(0.4, 1)) : 0,
    step: rng.chance(0.3) ? r2(rng.range(0.2, 0.45)) : 0, stepDepth: r2(rng.range(0.3, 0.6)),
    rivets: rng.chance(0.3) ? r2(rng.range(0.5, 0.9)) : 0,
  };
  return d;
}

// géométrie d'une couche (la graine de la couche fixe les détails aléatoires)
export function geometryFor(type, rng, seed) {
  const base = { seed, type: type === 'geode' ? 'cells' : type, portal: r2(rng.range(0.27, 0.34)), portalRim: 0.03, minHole: 0.012 };
  if (type === 'cells') {
    const freq = rng.int(4, 9), spacing = 1.1 / freq;
    const thickness = rng.range(0.035, 0.075);
    return {
      ...base, freq, jitter: rng.pick([0, 0, 0.12, 0.25, 0.38]),
      bar: r2(spacing * rng.range(0.16, 0.42)), round: r2(rng.pick([0, 0.35, 0.7, 1, 1])),
      barVar: r2(rng.range(0, 0.45)), barFreq: r2(rng.range(0.8, 2.5)), barGrad: r2(rng.range(-0.5, 0.5)),
      closed: r2(rng.pick([0, 0, 0.04, 0.12])), thickness: r2(thickness), bevel: r2(thickness * rng.range(0.15, 0.35)), chamfer: false,
      ...holeDetails(rng, type),
    };
  }
  if (type === 'voronoi') {
    const count = rng.int(60, 420), spacing = Math.sqrt((4 * Math.PI) / count);
    const thickness = rng.range(0.035, 0.075);
    return {
      ...base, count, distribution: rng.weighted([['fibonacci', 3], ['random', 2], ['gradient', 1.5]]),
      spiral: r2(rng.range(-1, 1)), jitter: rng.pick([0, 0, 0.15, 0.3]),
      bar: r2(spacing * rng.range(0.14, 0.38)), round: r2(rng.pick([0.35, 0.7, 1, 1])),
      barVar: r2(rng.range(0, 0.4)), barFreq: r2(rng.range(0.8, 2.5)), barGrad: r2(rng.range(-0.5, 0.5)),
      closed: r2(rng.pick([0, 0, 0.05, 0.15])), thickness: r2(thickness), bevel: r2(thickness * rng.range(0.15, 0.35)), chamfer: false,
      ...holeDetails(rng, type),
    };
  }
  if (type === 'slots') {
    const thickness = rng.range(0.035, 0.07);
    return {
      ...base, rows: rng.int(4, 9), cols: rng.int(9, 22), twist: rng.pick([0, 0, 0.5, 1, 0.25, -0.5]),
      bottom: r2(rng.range(0.18, 0.32)), bar: r2(rng.range(0.018, 0.045)),
      barLat: r2(rng.pick([1, 1.5, 2.5, 4])), barLon: r2(rng.pick([1, 1.5, 2.5])), round: r2(rng.range(0.3, 1)),
      barVar: r2(rng.range(0, 0.3)), barFreq: 1.5, barGrad: r2(rng.range(-0.3, 0.3)), closed: 0,
      thickness: r2(thickness), bevel: r2(thickness * rng.range(0.15, 0.35)), chamfer: false,
      ...holeDetails(rng, type),
    };
  }
  if (type === 'tpms') {
    const sheet = rng.chance(0.65);
    return {
      ...base, surface: rng.weighted([['gyroid', 3], ['schwarz', 1.2], ['diamond', 1.2], ['neovius', 1], ['iwp', 1], ['fischer', 0.8]]),
      freq: r2(rng.range(2.4, 4.2)),
      // (feuille assez épaisse pour la grille : sinon elle se froisse)
      thickness: r2(rng.range(0.1, 0.17)), wall: r2(sheet ? rng.range(0.26, 0.42) : rng.range(-0.25, 0.25)), sheet,
      bevel: r2(rng.range(0.006, 0.014)), chamfer: false,
    };
  }
  // géode : peu d'ouvertures, larges et irrégulières ; cristaux à l'intérieur
  const freq = rng.int(2, 3), spacing = 1.1 / freq;
  const thickness = rng.range(0.07, 0.1);
  return {
    ...base, freq, jitter: 0.4, bar: r2(spacing * rng.range(0.55, 0.8)), round: 0.9, barVar: 0.5, barFreq: 1.2, barGrad: 0,
    closed: r2(rng.range(0.25, 0.45)), thickness: r2(thickness), bevel: r2(thickness * 0.3), chamfer: false,
    crystals: rng.int(1300, 2300), crystalSize: r2(rng.range(0.11, 0.19)), crystalTilt: 0.55,
  };
}

// finitions d'une couche à partir d'un jeu (copie profonde, teintes tirées)
export function finishesFor(setKey, rng) {
  const set = SETS[setKey];
  const pick = (k) => ({ ...FINISHES[k], preset: k });
  const out = {
    outer: pick(set.outer), inner: pick(set.inner), edge: pick(set.edge), wear: set.wear,
    // gravure qui suit le contour des trous (sauf verre et pierre)
    groove: !['smoked', 'amber', 'geode'].includes(setKey) && rng.chance(0.35) ? r2(rng.range(0.5, 1)) : 0,
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
  let set = 'geode';
  if (type !== 'geode') {
    const pool = Object.keys(SETS).filter((k) => k !== 'geode' && SETS[k].moods.includes(moodKey));
    const others = Object.keys(SETS).filter((k) => k !== 'geode' && !pool.includes(k));
    do set = rng.chance(0.82) && pool.length ? rng.pick(pool) : rng.pick(others); while (set === avoidSet);
  }
  const geo = geometryFor(type, rng.fork(`geo:${seedTag}`), seedTag);
  geo.chamfer = SETS[set].chamfer;
  const finish = finishesFor(set, rng);
  if (type === 'tpms' || type === 'geode') finish.groove = 0; // (pas de contour de trou à suivre)
  return {
    type, set, geo, finish,
    crystal: { tip: rng.pick(['#8a4fd6', '#c27be6', '#e0a24a', '#7fb8e8', '#e8e2f0']), base: '#efe9f2', rough: 0.03, dispersion: 0.45, ior: 1.55 },
    motion: { spin: rng.pick([-2, -1, 1, 2]), tumble: rng.pick([-1, 1, 1, 2]), axis: rng.dir().map(r2), phase: r2(rng.range(0, Math.PI * 2)) },
  };
}

export function randomType(rng) { return rng.weighted([['cells', 3], ['voronoi', 3], ['slots', 2.5], ['tpms', 1.8], ['geode', 1]]); }

// force : { mood } pour imposer une humeur (le reste du tirage est inchangé)
export function generate(seed, force = {}) {
  const rng = createRng(seed);
  const picked = rng.pick(Object.keys(MOODS));
  const moodKey = force.mood && MOODS[force.mood] ? force.mood : picked;
  const mood = MOODS[moodKey];
  const N = rng.int(4, 6);

  // types : variété garantie, au plus une géode et une surface minimale
  const bag = [rng.pick(['cells', 'voronoi']), 'voronoi', 'slots'];
  if (rng.chance(0.8)) bag.push('tpms');
  if (rng.chance(0.5)) bag.push('geode');
  while (bag.length < N) bag.push(rng.pick(['cells', 'voronoi', 'slots', 'tpms']));
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  const types = bag.slice(0, N);

  let prevSet = null;
  const layers = types.map((type, i) => {
    const L = makeLayer(type, rng, `${seed}:${i}`, moodKey, prevSet);
    prevSet = L.set;
    return L;
  });

  const coreK = Math.round(rng.range(...mood.coreK) / 50) * 50;
  // (l'ancien tirage de l'intensité de la lampe est conservé, pour que chaque
  // graine garde le reste de son éclairage ; l'intensité est fixée à 40)
  return {
    seed: String(seed), mood: moodKey,
    nest: { ratio: r2(rng.range(0.58, 0.66)), core: r2(rng.range(0.035, 0.06)) },
    loop: { duration: 24, dive: true, depth: 0.35 },
    camera: { fov: Math.round(rng.range(36, 48)), sway: r2(rng.range(0.015, 0.05)), roll: r2(rng.range(0, 0.06)) },
    core: { color: kelvinToHex(coreK), intensity: r2(rng.range(28, 55)), glow: r2(rng.range(6, 13)), halo: r2(rng.range(2.0, 2.8)), decay: 2, pulse: r2(rng.range(0, 0.15)), shadowSoft: 2 },
    key: { color: kelvinToHex(mood.keyK), intensity: (rng.next(), 40), x: r2(rng.range(-0.45, -0.2)), y: r2(rng.range(0.2, 0.45)), angle: 0.85, penumbra: 0.9 },
    env: { preset: mood.env, intensity: r2(rng.range(0.9, 1.25)), rotation: r2(rng.range(0, Math.PI * 2)) },
    fog: { color: mood.bg, near: 1.5, far: 3.1 },
    layers,
  };
}
