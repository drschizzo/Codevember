// Catalogue des types de couche : tout ce qui distingue un type d'un autre
// (tirage de la forme, réglages exposés, jeux de matériaux imposés) est ici.
// Ajouter un type = ajouter une entrée (et, s'il a son propre maillage, un
// constructeur dans gen/worker.js).
//
// La forme d'une couche (`geo`) est une description sérialisable, envoyée
// telle quelle au worker de génération. `geo.type` y désigne le constructeur :
// un pavage percé (cells, voronoi, slots, girih → gen/shell.js), un champ
// implicite (tpms…) ou un assemblage de pièces (armillary…).
//
// Ce module ne dépend que du hasard : il est chargé par l'interface comme par
// la recette.

const r2 = (x) => Math.round(x * 1000) / 1000;

// constructeurs à champ implicite (surface nets) : pas de niveau d'ombre dédié,
// seuils de détail relevés, normale recalculée par pixel quand c'est possible
export const IMPLICIT = new Set(['tpms']);

// ── Réglages communs exposés dans le panneau : [clé, libellé, min, max, pas] ──
export const P = {
  common: [['thickness', 'Épaisseur', 0.01, 0.22, 0.001], ['bevel', 'Biseau', 0, 0.04, 0.0005], ['portal', 'Oculus', 0.18, 0.5, 0.005]],
  holes: [
    ['petals', 'Pétales / côtés', 3, 10, 1], ['depth', 'Creux des pétales', 0, 0.7, 0.01], ['aspect', 'Allongement', 0.1, 1, 0.01],
    ['holeScale', 'Taille de la forme', 0.3, 1, 0.01], ['orient', 'Orientation', 0, Math.PI, 0.01], ['swirl', 'Tourbillon', -3, 3, 0.01],
    ['orientJitter', 'Orientation au hasard', 0, 2, 0.01],
  ],
  machining: [
    ['pillow', 'Barreaux bombés', 0, 1.5, 0.01], ['step', 'Chambrage (largeur)', 0, 0.6, 0.01], ['stepDepth', 'Chambrage (profondeur)', 0.15, 0.8, 0.01],
    ['rivets', 'Rivets', 0, 1.5, 0.01],
  ],
  bars: [
    ['bar', 'Barreaux', 0.005, 0.3, 0.001], ['round', 'Arrondi des trous', 0, 1, 0.01], ['barVar', 'Variation', 0, 1, 0.01],
    ['barFreq', 'Échelle variation', 0.3, 4, 0.01], ['barGrad', 'Gradient', -1, 1, 0.01], ['closed', 'Cellules pleines', 0, 0.7, 0.01],
  ],
};

export const HOLE_SHAPES = { Polygone: 'poly', Ellipse: 'ellipse', Étoile: 'star', Diaphragme: 'iris' };

// forme des trous et détails usinés (pavages percés)
function holeDetails(rng, slots = false) {
  const shape = slots
    ? rng.weighted([['poly', 4], ['ellipse', 2.5], ['iris', 1]])
    : rng.weighted([['poly', 4], ['ellipse', 2], ['star', 1.3], ['iris', 1.6]]);
  return {
    shape,
    petals: shape === 'star' ? rng.int(4, 7) : rng.int(5, 8),
    depth: r2(rng.range(0.2, 0.42)), aspect: r2(rng.range(0.28, 0.62)),
    holeScale: r2(shape === 'poly' ? 1 : rng.range(0.78, 1)),
    orient: r2(rng.range(0, Math.PI)), swirl: rng.pick([0, 0, 0.6, 1.2, -0.8]), orientJitter: rng.pick([0, 0, 0, 0.7]),
    pillow: rng.chance(0.4) ? r2(rng.range(0.4, 1)) : 0,
    step: rng.chance(0.3) ? r2(rng.range(0.2, 0.45)) : 0, stepDepth: r2(rng.range(0.3, 0.6)),
    rivets: rng.chance(0.3) ? r2(rng.range(0.5, 0.9)) : 0,
  };
}

// diaphragme de l'oculus (tiré après tout le reste : les formes existantes ne changent pas)
function iris(rng, p = 0.35) {
  return rng.chance(p) ? { blades: rng.int(6, 12), curl: r2(rng.range(0.5, 1.3)), overlap: r2(rng.range(0.35, 0.6)) } : { blades: 0, curl: 0.9, overlap: 0.45 };
}
export const IRIS_PARAMS = [['blades', 'Lames (0 : aucun)', 0, 16, 1], ['curl', 'Courbure', 0, 2, 0.01], ['overlap', 'Recouvrement', 0.1, 1, 0.01]];

// sertissage : les rivets deviennent des chatons garnis de pierres (tiré en dernier)
function setting(geo, rng) {
  if (!geo.rivets && rng.chance(0.18)) geo.rivets = r2(rng.range(0.6, 1));
  geo.setting = geo.rivets > 0 && rng.chance(0.55) ? 'gem' : 'rivet';
  return geo;
}
export const SETTINGS = { Rivets: 'rivet', 'Pierres serties': 'gem' };

// barreaux d'un pavage percé (spacing : distance typique entre cellules)
function bars(rng, spacing, lo = 0.16, hi = 0.42) {
  const thickness = rng.range(0.035, 0.075);
  return {
    bar: r2(spacing * rng.range(lo, hi)), round: r2(rng.pick([0, 0.35, 0.7, 1, 1])),
    barVar: r2(rng.range(0, 0.45)), barFreq: r2(rng.range(0.8, 2.5)), barGrad: r2(rng.range(-0.5, 0.5)),
    closed: r2(rng.pick([0, 0, 0.04, 0.12])), thickness: r2(thickness), bevel: r2(thickness * rng.range(0.15, 0.35)), chamfer: false,
  };
}

// ── Les types ────────────────────────────────────────────────────────────────
// label, weight (fréquence du tirage), set (jeu de matériaux imposé), max
// (nombre maximal par scène), geometry(rng) → geo (sans la base commune),
// params (réglages de forme), selects / toggles (listes, cases), holes (forme
// des trous et usinage), noGroove (pas de gravure), noChamfer (pas de chanfrein)
export const TYPES = {
  cells: {
    label: 'Alvéoles', weight: 3, holes: true,
    params: [['freq', 'Fréquence', 2, 12, 1], ['jitter', 'Désordre', 0, 0.5, 0.01], ...P.bars],
    geometry(rng) {
      const freq = rng.int(4, 9);
      return setting({ type: 'cells', freq, jitter: rng.pick([0, 0, 0.12, 0.25, 0.38]), ...bars(rng, 1.1 / freq), ...holeDetails(rng), iris: iris(rng) }, rng);
    },
  },
  voronoi: {
    label: 'Voronoï', weight: 3, holes: true,
    params: [['count', 'Nombre de cellules', 20, 800, 1], ['spiral', 'Spirale des germes', -2, 2, 0.01], ['jitter', 'Désordre', 0, 0.6, 0.01], ...P.bars],
    selects: [['distribution', 'Germes', { 'Spirale de Fibonacci': 'fibonacci', 'Bruit bleu': 'random', 'Densité graduée': 'gradient' }]],
    geometry(rng) {
      const count = rng.int(60, 420);
      const b = bars(rng, Math.sqrt((4 * Math.PI) / count), 0.14, 0.38);
      b.round = r2(rng.pick([0.35, 0.7, 1, 1]));
      b.closed = r2(rng.pick([0, 0, 0.05, 0.15]));
      return setting({
        type: 'voronoi', count, distribution: rng.weighted([['fibonacci', 3], ['random', 2], ['gradient', 1.5]]),
        spiral: r2(rng.range(-1, 1)), jitter: rng.pick([0, 0, 0.15, 0.3]), ...b, ...holeDetails(rng), iris: iris(rng),
      }, rng);
    },
  },
  slots: {
    label: 'Fentes', weight: 2.5, holes: true,
    params: [
      ['rows', 'Rangs', 3, 14, 1], ['cols', 'Secteurs', 6, 32, 1], ['twist', 'Torsion', -1, 1, 0.05], ['bottom', 'Calotte basse', 0.1, 0.5, 0.01],
      ['bar', 'Barreaux', 0.005, 0.1, 0.001], ['barLat', 'Barreaux horizontaux', 0.5, 6, 0.05], ['barLon', 'Barreaux verticaux', 0.5, 6, 0.05],
      ['round', 'Arrondi des trous', 0, 1, 0.01], ['barVar', 'Variation', 0, 1, 0.01], ['barGrad', 'Gradient', -1, 1, 0.01],
    ],
    geometry(rng) {
      const thickness = rng.range(0.035, 0.07);
      return setting({
        type: 'slots', rows: rng.int(4, 9), cols: rng.int(9, 22), twist: rng.pick([0, 0, 0.5, 1, 0.25, -0.5]),
        bottom: r2(rng.range(0.18, 0.32)), bar: r2(rng.range(0.018, 0.045)),
        barLat: r2(rng.pick([1, 1.5, 2.5, 4])), barLon: r2(rng.pick([1, 1.5, 2.5])), round: r2(rng.range(0.3, 1)),
        barVar: r2(rng.range(0, 0.3)), barFreq: 1.5, barGrad: r2(rng.range(-0.3, 0.3)), closed: 0,
        thickness: r2(thickness), bevel: r2(thickness * rng.range(0.15, 0.35)), chamfer: false,
        ...holeDetails(rng, true), iris: iris(rng),
      }, rng);
    },
  },
  girih: {
    label: 'Moucharabieh', weight: 2.4, holes: true,
    params: [
      ['freq', 'Fréquence', 2, 8, 1], ['theta', 'Angle de contact', 0.3, 1.4, 0.01], ['frame', 'Barreaux du cadre', 0.3, 3, 0.01],
      ['star', 'Barreaux de l’étoile', 0.3, 3, 0.01], ...P.bars,
    ],
    toggles: [['solidStar', 'Cœur des étoiles plein']],
    geometry(rng) {
      const freq = rng.int(3, 5);
      const b = bars(rng, 1.1 / freq / 3.2, 0.15, 0.3);
      b.round = r2(rng.pick([0.15, 0.3, 0.5, 0.7]));
      b.closed = r2(rng.pick([0, 0, 0, 0.06]));
      const h = holeDetails(rng);
      return setting({
        type: 'girih', freq, jitter: 0, theta: r2(rng.range(0.55, 1.25)), frame: rng.pick([1, 1.4, 2]), star: rng.pick([0.7, 1, 1.3]),
        solidStar: rng.chance(0.2), ...b, ...h, shape: 'poly', holeScale: 1, iris: iris(rng),
      }, rng);
    },
  },
  tpms: {
    label: 'Surface minimale', weight: 1.8, max: 1, noGroove: true, noChamfer: true,
    params: [['freq', 'Fréquence', 1.5, 7, 0.05], ['wall', 'Paroi', -0.5, 0.5, 0.01]],
    selects: [['surface', 'Surface', { Gyroïde: 'gyroid', 'Schwarz P': 'schwarz', Diamant: 'diamond', Neovius: 'neovius', 'I-WP': 'iwp', 'Fischer–Koch': 'fischer' }]],
    toggles: [['sheet', 'Feuille (sinon réseau)']],
    geometry(rng) {
      const sheet = rng.chance(0.65);
      return {
        type: 'tpms', surface: rng.weighted([['gyroid', 3], ['schwarz', 1.2], ['diamond', 1.2], ['neovius', 1], ['iwp', 1], ['fischer', 0.8]]),
        freq: r2(rng.range(2.4, 4.2)),
        // (feuille assez épaisse pour la grille : sinon elle se froisse)
        thickness: r2(rng.range(0.1, 0.17)), wall: r2(sheet ? rng.range(0.26, 0.42) : rng.range(-0.25, 0.25)), sheet,
        bevel: r2(rng.range(0.006, 0.014)), chamfer: false,
      };
    },
  },
  geode: {
    label: 'Géode', weight: 1, set: 'geode', max: 1, noGroove: true,
    params: [
      ['freq', 'Fréquence', 2, 12, 1], ['jitter', 'Désordre', 0, 0.5, 0.01], ...P.bars,
      ['crystals', 'Cristaux', 0, 2500, 10], ['crystalSize', 'Taille des cristaux', 0.03, 0.3, 0.005], ['crystalTilt', 'Dispersion', 0, 1.2, 0.01],
    ],
    // peu d'ouvertures, larges et irrégulières ; cristaux à l'intérieur
    geometry(rng) {
      const freq = rng.int(2, 3), spacing = 1.1 / freq;
      const thickness = rng.range(0.07, 0.1);
      return {
        type: 'cells', freq, jitter: 0.4, bar: r2(spacing * rng.range(0.55, 0.8)), round: 0.9, barVar: 0.5, barFreq: 1.2, barGrad: 0,
        closed: r2(rng.range(0.25, 0.45)), thickness: r2(thickness), bevel: r2(thickness * 0.3), chamfer: false,
        crystals: rng.int(1300, 2300), crystalSize: r2(rng.range(0.11, 0.19)), crystalTilt: 0.55,
      };
    },
  },
};

// forme complète d'une couche (la graine de la couche fixe les détails aléatoires)
export function geometryFor(type, rng, seed) {
  const T = TYPES[type] ?? TYPES.cells;
  const base = { seed, portal: r2(rng.range(0.27, 0.34)), portalRim: 0.03, minHole: 0.012 };
  return { ...base, ...T.geometry(rng) };
}

// tirage d'un type ; `count` : nombre de couches déjà tirées par type (pour `max`)
export function randomType(rng, count = {}) {
  const pool = Object.entries(TYPES).filter(([k, T]) => !(T.max && (count[k] || 0) >= T.max));
  return rng.weighted(pool.map(([k, T]) => [k, T.weight]));
}
