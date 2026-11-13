// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place.
import { createRng } from '../../shared/rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';
import { randomNet, randomMoves, ROOT, voyageSeconds, twinFace, stepOrientations, innerCell } from './math4.js';

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Humeurs ──────────────────────────────────────────────────────────────────
// grade : étalonnage (contraste, saturation, teinte des ombres et des hautes
// lumières : chaque humeur a sa signature de couleur, voir render/post.js) ;
// env : studio HDR ; floor : sol ; kinds : poids des archétypes de cellule ;
// objects : objets exposés favoris (multiplient leur poids) ; rim : teintes
// des contre-jours ; tints : couleurs d'accent (anodisation, laque : une seule
// par scène) ; glass : teintes du verre (une seule par scène).
//
// accords : les matières ne sont pas tirées pièce par pièce (on obtenait huit
// cellules de nacre, ou sept de laiton autour d'objets dorés). Chaque humeur a
// ses accords, composés à la main comme une palette :
//   [ossature, motif, contrepoint, [matières riches], [objets]]
// - motif : le jeu uni qui porte le motif signature de la scène ;
// - contrepoint : celui du second motif, d'une autre valeur (clair contre
//   sombre, mat contre brillant) ;
// - matières riches : marbres, émaux, laques, damas… pour les pièces sans
//   motif, dedans comme dehors ;
// - objets : ce qu'on expose, choisi dans chaque pièce pour trancher sur ses murs.
// La règle : au moins trois familles de matières par scène, l'or (laiton,
// bronze, cuivre) en accent, jamais à la fois sur l'ossature et sur le motif.
// Vérifié sur tous les accords et sur des centaines de graines par
// test/accords.test.mjs.
// Les lampes sont à peine chaudes : sous une lampe orangée, l'acier et la
// porcelaine se lisaient comme du laiton. La chaleur d'une humeur vient de
// ses matières, de son sol et de ses contre-jours.
const KINDS_W = {
  atelier: { vitrine: 2, ecrin: 3, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1, cage: 2, vitrail: 1.5, cloute: 2, industriel: 2.5, cible: 1.5, mixte: 3, origami: 1.5, rosace: 2, onde: 1, ecailles: 2.5, ruche: 2, cinetique: 1.5 },
  studio: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 3, tissage: 1, squelette: 1, cage: 2, vitrail: 1, cloute: 2, industriel: 2.5, cible: 2, mixte: 3, origami: 2.5, rosace: 1, onde: 2, ecailles: 1.5, ruche: 2.5, cinetique: 3 },
  ecrin: { vitrine: 3, ecrin: 4, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 1, cage: 1.5, vitrail: 2.5, cloute: 3, industriel: 0.5, cible: 2, mixte: 3, origami: 1, rosace: 3, onde: 2.5, ecailles: 3, ruche: 1.5, cinetique: 0.5 },
  clinique: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1, cage: 1.5, vitrail: 1.5, cloute: 2, industriel: 1, cible: 2.5, mixte: 3, origami: 3, rosace: 1.5, onde: 3, ecailles: 1.5, ruche: 2.5, cinetique: 2 },
  nuit: { vitrine: 3, ecrin: 1, moucharabieh: 3, persienne: 3, tissage: 2, squelette: 1, cage: 2, vitrail: 1.5, cloute: 1.5, industriel: 2, cible: 2, mixte: 3, origami: 1.5, rosace: 1.5, onde: 2, ecailles: 2, ruche: 3, cinetique: 3 },
  dali: { vitrine: 3, ecrin: 3, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 2, cage: 2, vitrail: 3, cloute: 1.5, industriel: 0.5, cible: 2, mixte: 3, origami: 2, rosace: 3, onde: 2, ecailles: 1.5, ruche: 1, cinetique: 1 },
  irise: { vitrine: 4, ecrin: 1, moucharabieh: 2, persienne: 2, tissage: 1, squelette: 1, cage: 1.5, vitrail: 2.5, cloute: 1.5, industriel: 1, cible: 2, mixte: 3, origami: 2, rosace: 2, onde: 3, ecailles: 2, ruche: 1.5, cinetique: 2 },
};
export const MOODS = {
  atelier: {
    label: 'Atelier', practical: '#ffe6c8', env: 'atelier', bg: '#0b0907', keyK: 4700, rim: ['#ffd2a0', '#c4d4ff'], floor: ['concrete', 'oak'],
    // (patines et pierre : acier noirci, biscuit, vert-de-gris ; le laiton en une voix)
    accords: [
      ['blackSteel', 'brassVelvet', 'biscuit', ['marble', 'verdigris'], ['nacre', 'bronze', 'urushi']],
      ['bronze', 'acier', 'laque', ['damascus', 'urushi'], ['goldLeaf', 'nacre', 'marble']],
      ['brassVelvet', 'blackSteel', 'biscuit', ['verdigris', 'guilloche'], ['goldLeaf', 'marble', 'bronze']],
      ['damascus', 'laque', 'acier', ['marble', 'bronze'], ['nacre', 'goldLeaf', 'urushi']],
      ['blackSteel', 'biscuit', 'laque', ['bronze', 'celadon'], ['goldLeaf', 'urushi', 'nacre']],
    ],
    tints: ['#17402f', '#152c5a', '#6e1712', '#8a5a1e'], glass: ['#b7a796', '#c9b07a', '#a8c2b0', '#d17a1e'],
    grade: { contrast: 1.04, saturation: 0.97, shadows: [0.94, 0.99, 1.07], highlights: [1.05, 1.0, 0.93] },
    kinds: KINDS_W.atelier, objects: { ammonite: 2.5, egg: 1.5, hyper: 1 },
  },
  studio: {
    label: 'Studio', practical: '#fff1e0', env: 'studio', bg: '#07080a', keyK: 5600, rim: ['#9fc4ff', '#ffffff'], floor: ['gloss', 'concrete'],
    // (noir, blanc, acier ; une couleur anodisée, une matière d'art)
    accords: [
      ['chrome', 'ceramicBlack', 'anodizedDiamond', ['guillocheSilver', 'marble'], ['chrome', 'ceramicWhite', 'nacre']],
      ['carbon', 'ceramicWhite', 'acier', ['titanium', 'anodizedDiamond'], ['ceramicBlack', 'chrome', 'titanium']],
      ['titanium', 'acier', 'ceramicWhite', ['carbon', 'anodizedDiamond'], ['nacre', 'chrome', 'ceramicWhite']],
      ['blackSteel', 'anodizedDiamond', 'ceramicWhite', ['guillocheSilver', 'damascus'], ['chrome', 'titanium', 'ceramicWhite']],
      ['chrome', 'carbon', 'biscuit', ['titanium', 'marble'], ['nacre', 'chrome', 'ceramicBlack']],
    ],
    tints: ['#3a64b0', '#b03a4a', '#c07a2a', '#2f8a72'], glass: ['#9fb3c4', '#e6e2da', '#7d93b8'],
    grade: { contrast: 1.06, saturation: 0.92, shadows: [0.96, 1.0, 1.06], highlights: [1.0, 1.0, 1.0] },
    kinds: KINDS_W.studio, objects: { hyper: 2.5, mobius: 2 },
  },
  ecrin: {
    label: 'Écrin', practical: '#ffe0c0', env: 'atelier', bg: '#070405', keyK: 4400, rim: ['#ffd0a0', '#ff9fb0', '#c8d4ff'], floor: ['gloss', 'velvet'],
    // (laques profondes, émaux, marbre noir ; l'or sur un fond, jamais partout)
    accords: [
      ['goldLeaf', 'laque', 'ceramicBlack', ['nero', 'urushi'], ['nacre', 'goldLeaf', 'guilloche']],
      ['nero', 'brassVelvet', 'laque', ['guilloche', 'urushi'], ['nacre', 'goldLeaf', 'kintsugi']],
      ['urushi', 'ceramicBlack', 'brassVelvet', ['guillocheRuby', 'nero'], ['goldLeaf', 'nacre', 'kintsugi']],
      ['brassVelvet', 'nacre', 'laque', ['urushi', 'guilloche'], ['goldLeaf', 'urushi', 'guillocheRuby']],
      ['guilloche', 'biscuit', 'blackSteel', ['kintsugi', 'guillocheRuby'], ['goldLeaf', 'nacre', 'urushi']],
    ],
    tints: ['#5c0f1c', '#0f2a5c', '#0e3b2e', '#2e1238'], glass: ['#b7a796', '#c9b07a', '#c4a3b8', '#d17a1e'],
    grade: { contrast: 1.07, saturation: 1.07, shadows: [1.04, 0.95, 1.03], highlights: [1.05, 1.0, 0.94] },
    kinds: KINDS_W.ecrin, objects: { egg: 3, urchin: 2 }, gems: 0.55,
  },
  clinique: {
    label: 'Clinique', practical: '#ffffff', env: 'cyclo', bg: '#dedcd7', keyK: 6500, rim: ['#ffffff', '#e8f0ff'], floor: ['cyclo'], envIntensity: [0.32, 0.45], keyScale: 0.6,
    // (blanc sur blanc : céramique, biscuit, marbre ; une teinte pastel ou un filet d'or)
    accords: [
      ['chrome', 'ceramicWhite', 'acier', ['celadon', 'kintsugi'], ['chrome', 'ceramicBlack', 'kintsugi']],
      ['ceramicWhite', 'acier', 'nacre', ['marble', 'anodizedDiamond'], ['chrome', 'nacre', 'ceramicBlack']],
      ['guillocheSilver', 'biscuit', 'anodizedDiamond', ['marble', 'nacre'], ['chrome', 'kintsugi', 'ceramicBlack']],
      ['anodizedDiamond', 'nacre', 'acier', ['kintsugi', 'guillocheSilver'], ['chrome', 'ceramicBlack', 'nacre']],
      ['chrome', 'biscuit', 'ceramicBlack', ['marble', 'celadon'], ['kintsugi', 'chrome', 'nacre']],
    ],
    tints: ['#a9c4d6', '#d8a8a0', '#9fb8a0', '#c9b98a'], glass: ['#e6e2da', '#9fb3c4', '#a8c2b0'],
    grade: { contrast: 0.98, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1.0, 1.0, 1.0] },
    kinds: KINDS_W.clinique, objects: { mobius: 2.5, egg: 2 },
  },
  nuit: {
    label: 'Nuit', practical: '#9fd0ff', env: 'night', bg: '#030407', keyK: 7000, rim: ['#5b8cff', '#ff4fa0', '#46e0ff', '#a070ff'], floor: ['gloss'],
    // (aciers sombres et titane au feu ; une couleur, une irisation, et une
    // matière qui prend la lumière, nacre ou émail bleu : la bulle de savon,
    // noire, est la seule doublure qui ne renvoie presque rien dans les pièces)
    accords: [
      ['blackSteel', 'acier', 'anodizedDiamond', ['obsidian', 'guilloche'], ['chrome', 'nacre', 'titanium']],
      ['titanium', 'anodizedDiamond', 'acier', ['soap', 'nacre'], ['chrome', 'titanium', 'nacre']],
      ['carbon', 'acier', 'blackSteel', ['obsidian', 'anodizedDiamond'], ['chrome', 'soap', 'nacre']],
      ['anodizedDiamond', 'ceramicBlack', 'titanium', ['nero', 'nacre'], ['chrome', 'titanium', 'soap']],
      ['ceramicBlack', 'acier', 'soap', ['damascus', 'guilloche'], ['chrome', 'titanium', 'nacre']],
    ],
    tints: ['#3a64b0', '#7a4ab0', '#b03a4a', '#2f8a72'], glass: ['#7d93b8', '#9fb3c4', '#c4a3b8'],
    grade: { contrast: 1.05, saturation: 1.05, shadows: [0.88, 0.98, 1.16], highlights: [0.99, 1.0, 1.04] },
    kinds: KINDS_W.nuit, objects: { hyper: 2.5, urchin: 2 },
  },
  dali: {
    label: 'Surréaliste', practical: '#ffecd4', env: 'softbox', bg: '#120d09', keyK: 5000, rim: ['#ffcf8a', '#9fb8ff'], floor: ['checker'], envIntensity: [0.55, 0.75],
    // (pierre et biscuit sur le damier ; l'or en trait, une laque franche)
    accords: [
      ['goldLeaf', 'biscuit', 'laque', ['marble', 'nero'], ['nacre', 'goldLeaf', 'chrome']],
      ['brassVelvet', 'ceramicWhite', 'blackSteel', ['marble', 'celadon'], ['goldLeaf', 'nacre', 'marble']],
      ['nero', 'nacre', 'brassVelvet', ['celadon', 'guilloche'], ['goldLeaf', 'chrome', 'marble']],
      ['ceramicWhite', 'laque', 'biscuit', ['nero', 'kintsugi'], ['goldLeaf', 'nacre', 'chrome']],
      ['goldLeaf', 'ceramicBlack', 'biscuit', ['celadon', 'marble'], ['nacre', 'chrome', 'goldLeaf']],
    ],
    tints: ['#a8402a', '#1d4a7a', '#2f5d4a', '#c9a13a'], glass: ['#e6e2da', '#c9b07a', '#a8c2b0', '#b7a796'],
    grade: { contrast: 1.03, saturation: 1.0, shadows: [0.97, 0.97, 1.07], highlights: [1.06, 1.01, 0.92] },
    kinds: KINDS_W.dali, objects: { egg: 2.5, ammonite: 2, mobius: 1.5 },
  },
  irise: {
    label: 'Irisé', practical: '#e8d8ff', env: 'studio', bg: '#05060a', keyK: 6000, rim: ['#8fd0ff', '#ffa8e0'], floor: ['gloss'],
    // (nacre, bulle et titane ; un noir ou un blanc mat pour les faire chanter)
    accords: [
      ['chrome', 'nacre', 'blackSteel', ['soap', 'titanium'], ['soap', 'chrome', 'titanium']],
      ['titanium', 'ceramicBlack', 'nacre', ['soap', 'guillocheSilver'], ['nacre', 'soap', 'chrome']],
      ['blackSteel', 'titanium', 'ceramicWhite', ['nacre', 'soap'], ['chrome', 'soap', 'nacre']],
      ['chrome', 'soap', 'biscuit', ['titanium', 'nacre'], ['chrome', 'titanium', 'soap']],
      ['titanium', 'acier', 'soap', ['nacre', 'anodizedDiamond'], ['nacre', 'chrome', 'soap']],
    ],
    tints: ['#7a4ab0', '#3a64b0', '#2f8a72'], glass: ['#e6e2da', '#c4a3b8', '#9fb3c4'],
    grade: { contrast: 1.03, saturation: 1.1, shadows: [0.98, 0.94, 1.09], highlights: [0.98, 1.03, 1.02] },
    kinds: KINDS_W.irise, objects: { urchin: 2.5, mobius: 2 }, gems: 0.4,
  },
};

// ── Archétypes de cellule ────────────────────────────────────────────────────
export const KINDS = {
  vitrine: { label: 'Vitrine' },
  ecrin: { label: 'Écrin' },
  moucharabieh: { label: 'Moucharabieh' },
  persienne: { label: 'Persiennes' },
  tissage: { label: 'Grille tissée' },
  squelette: { label: 'Squelette' },
  cage: { label: 'Cage à barreaux' },
  vitrail: { label: 'Vitrail' },
  cloute: { label: 'Pointes de diamant' },
  industriel: { label: 'Tôle ondulée' },
  cible: { label: 'Cible' },
  mixte: { label: 'Cabinet composite' },
  origami: { label: 'Origami (pli Miura)' },
  rosace: { label: 'Chapelle (rosaces)' },
  onde: { label: 'Onde' },
  ecailles: { label: 'Écailles' },
  ruche: { label: 'Ruche' },
  cinetique: { label: 'Façade cinétique' },
};
// motifs de face propres à chaque archétype (le cabinet composite d'une scène
// ne pioche que dans ceux de son vocabulaire)
const KIND_FACES = {
  vitrine: ['glass'], ecrin: ['plate'], moucharabieh: ['perf'], persienne: ['louvre'], tissage: ['grid'], squelette: ['open'],
  cage: ['bars'], vitrail: ['leaded'], cloute: ['stud'], industriel: ['corrugated', 'perf'], cible: ['target'],
  origami: ['miura'], rosace: ['oculus'], onde: ['ripple'], ecailles: ['scales'], ruche: ['comb'], cinetique: ['twist'],
};
export const FACE_KINDS = {
  Ouvert: 'open', Plaque: 'plate', Verre: 'glass', 'Tôle perforée': 'perf', Persiennes: 'louvre', 'Grille tissée': 'grid',
  'Pointes / caissons': 'stud', 'Tôle ondulée': 'corrugated', Vitrail: 'leaded', Barreaux: 'bars', Cible: 'target',
  'Pli Miura': 'miura', Onde: 'ripple', Rosace: 'oculus', Écailles: 'scales', "Nid d'abeille": 'comb', 'Lames vrillées': 'twist',
};
export const CONTENT_TYPES = {
  Rien: 'none', Perle: 'pearl', Pierre: 'gem', Gyroscope: 'rings', Cube: 'cube', Saturne: 'saturn', 'Mise en abyme': 'mini',
  'Nœud de trèfle': 'knot', Icosaèdre: 'ico', Dodécaèdre: 'dodeca', 'Pile de jetons': 'stack',
  'Ruban de Möbius': 'mobius', Hypercube: 'hyper', Ammonite: 'ammonite', 'Œuf résille': 'egg', Oursin: 'urchin',
};
export const RIPPLE_SOURCES = { Centre: 'center', Coin: 'corner', 'Deux sources': 'pair' };
export const FRAME_STYLES = { 'Carré chanfreiné': 'square', Rond: 'round', Tube: 'tube', Cornière: 'angle', 'Profilé rainuré': 'extrusion' };
export const NODE_STYLES = { Cube: 'cube', Sphère: 'sphere', Pommeau: 'knob', Aucun: 'none' };
export const HOLE_SHAPES = { Rond: 'circle', Carré: 'square', Losange: 'diamond', Étoile: 'cross', Hexagone: 'hex', Fente: 'slot' };
export const STUD_MODES = { 'Pointes de diamant': 'pyramid', Clous: 'dome', Caissons: 'coffer' };
export const LEAD_PATTERNS = { Losanges: 'diamond', Carreaux: 'grid' };
export const HOLE_GRADS = { Uniforme: 'uniform', Centre: 'radial', Bord: 'edge', Diagonale: 'diagonal', Vague: 'wave', Hasard: 'random' };
export const NET_SHAPES = { 'Croix de Dalí': 'dali', Croix: 'cross', Serpent: 'chain', Libre: 'random' };
export const FLOORS = { Aucun: 'none', 'Laque noire': 'gloss', 'Béton ciré': 'concrete', 'Damier de marbre': 'checker', Cyclorama: 'cyclo', Chêne: 'oak', Velours: 'velvet' };

export const GEMS = {
  diamond: { label: 'Diamant', color: '#fbfcff', ior: 2.42, dispersion: 1, depth: 2 },
  sapphire: { label: 'Saphir', color: '#1f4fd8', ior: 1.77, dispersion: 0.45, depth: 0.25 },
  ruby: { label: 'Rubis', color: '#d01838', ior: 1.77, dispersion: 0.45, depth: 0.25 },
  emerald: { label: 'Émeraude', color: '#1aa05a', ior: 1.58, dispersion: 0.3, depth: 0.3 },
  amethyst: { label: 'Améthyste', color: '#8a3fd0', ior: 1.55, dispersion: 0.3, depth: 0.35 },
  citrine: { label: 'Citrine', color: '#f0a020', ior: 1.55, dispersion: 0.3, depth: 0.35 },
};

export const GLASS_TINTS = ['#b7a796', '#9fb3c4', '#c9b07a', '#a8c2b0', '#c4a3b8', '#d17a1e', '#7d93b8', '#e6e2da'];

// finitions d'une pièce à partir d'un jeu (copie profonde). Les jeux teintés
// (anodisé, laque, émail) prennent la couleur d'accent de la palette de la
// scène ; sans palette (retouche au panneau), une teinte au hasard.
export function finishesFor(setKey, rng, pal = null) {
  const set = SETS[setKey];
  const pick = (k) => ({ ...FINISHES[k], preset: k });
  const out = { outer: pick(set.outer), inner: pick(set.inner), edge: pick(set.edge), wear: set.wear || 0 };
  if (set.outer === 'anodized') { const t = pal?.tint ?? rng.pick(TINTS.anodized); out.outer.color = t; out.inner.color = t; }
  if (set.outer === 'lacquer') { const t = pal?.tint ?? rng.pick(TINTS.lacquer); out.outer.color = t; out.inner.color = t; }
  if (set.outer === 'glaze') out.outer.color = pal?.glaze ?? rng.pick(TINTS.glaze);
  return out;
}
// verre teinté (les trois faces)
export function glassFinish(rng, frosted = false, tint = null) {
  const base = frosted ? FINISHES.frostedGlass : FINISHES.smokedGlass;
  const g = { ...base, preset: frosted ? 'frostedGlass' : 'smokedGlass', color2: tint ?? rng.pick(GLASS_TINTS), attDist: r2(rng.range(0.5, 1.4)), dispersion: r2(rng.range(0.15, 0.4)), smudge: r2(rng.range(0, 0.1)) }; // (peu de traces : elles dépolissent le verre par plaques)
  const edge = { ...g, rough: Math.max(g.rough, 0.25) };
  return { outer: g, inner: { ...g }, edge, wear: 0 };
}

// Paramètres des motifs : des plages resserrées (un motif trop fin se lit
// comme un grain, trop gros comme un accident)
function motifs(rng) {
  return {
    perf: { n: rng.int(5, 9), shape: rng.weighted([['circle', 4], ['square', 2], ['diamond', 2], ['cross', 1.2], ['hex', 2.5], ['slot', 2]]), grad: rng.weighted([['radial', 3], ['edge', 2], ['diagonal', 2], ['wave', 2], ['uniform', 1.5], ['random', 1]]), min: r2(rng.range(0, 0.3)), max: r2(rng.range(0.7, 0.95)), twist: rng.chance(0.3) ? r2(rng.range(0, Math.PI / 2)) : 0 },
    louvre: { n: rng.int(6, 12), angle: r2(rng.range(0.35, 0.95) * rng.sign()) },
    grid: { n: rng.int(6, 12) },
    stud: { n: rng.int(4, 9), mode: rng.weighted([['pyramid', 3], ['dome', 2], ['coffer', 2]]), height: r2(rng.range(0.35, 0.8)) },
    corr: { n: rng.int(3, 8), amp: r2(rng.range(0.2, 0.45)) },
    leaded: { n: rng.int(2, 5), pattern: rng.weighted([['diamond', 3], ['grid', 2]]) },
    bars: { n: rng.int(6, 13), cross: rng.chance(0.6) },
    target: { n: rng.int(3, 8), fill: r2(rng.range(0.35, 0.75)) },
    miura: { n: rng.int(4, 8), rows: 2 * rng.int(2, 4), h: r2(rng.range(0.35, 0.8)), s: r2(rng.range(0.25, 0.6)) },
    ripple: { n: rng.int(3, 6), amp: r2(rng.range(0.35, 0.75)), src: rng.weighted([['center', 3], ['corner', 1.5], ['pair', 2]]) },
    twist: { n: rng.int(10, 15), twist: r2(rng.range(0.8, 2.6) * rng.sign()), ramp: r2(rng.range(-1.2, 1.2)), base: r2(rng.range(0, 0.6)) },
    scales: { n: rng.int(5, 8), tilt: r2(rng.range(0.2, 0.35)), dome: r2(rng.range(0.12, 0.22)) },
    comb: { n: rng.int(3, 6), depth: r2(rng.range(0.5, 1)), rot: rng.chance(0.5) },
    oculus: { r: r2(rng.range(0.62, 0.82)), spokes: rng.pick([0, 4, 6, 8, 8, 12]), ring: rng.chance(0.55) },
  };
}
export const MOTIF_DEFAULTS = motifs(createRng('motifs'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const shuffled = (arr, rng) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ── Direction artistique ─────────────────────────────────────────────────────
// Une image ne montre qu'une chose à la fois, et aucune pièce n'est vide.
// - Une scène a un motif signature, parfois un contrepoint de nature opposée
//   (un écran qui laisse voir contre un relief plein), et pas d'autre : tous
//   les panneaux d'un motif ont le même dessin (mêmes trous, même pas).
// - Une pièce porte une seule idée. Soit un motif, sur un axe (deux parois
//   qui se répondent) ou deux (une ceinture), dans un jeu uni, le reste en
//   doublure. Soit une matière riche (marbre, émail, laque, damas…), sans
//   motif, visible dedans comme dehors. Jamais les deux, jamais ni l'un ni
//   l'autre.
// - Une paroi partagée par deux pièces ne porte qu'un motif : deux panneaux
//   ornés dos à dos (des barreaux devant une tôle perforée devant une cible)
//   faisaient un moiré illisible.
// - Environ une pièce sur deux a un motif ; le voyage les fait alterner avec
//   les pièces de matière.
export const ornate = (k) => k !== 'plate' && k !== 'glass' && k !== 'open';
// motifs qui laissent voir la pièce voisine (les autres sont des reliefs pleins)
export const SEE = new Set(['perf', 'louvre', 'grid', 'bars', 'leaded', 'target', 'oculus', 'comb', 'twist']);
// motifs de matière qui dessinent (veines, coups de marteau, guillochis…)
const BUSY = new Set(['hammered', 'glaze', 'glitter', 'patina', 'guilloche', 'damascus', 'marble', 'urushi', 'agate']);
const busyFinish = (k) => { const f = FINISHES[k]; return BUSY.has(f.pattern) || (f.pattern === 'rock' && f.bump > 0.5) || k === 'chrome' || k === 'polishedGold'; };
// jeu uni : rien n'y dessine, ni dehors ni dedans (il peut porter un motif)
export const calmSet = (k) => !busyFinish(SETS[k].outer) && !busyFinish(SETS[k].inner);
// jeux dont la face interne est déjà la matière à montrer (les autres pièces
// sans motif sont doublées de leur matière externe : un écrin de marbre
// tapissé de laiton poli était, vu du dedans, une pièce vide et un miroir)
export const OWN_LINING = new Set(['kintsugi', 'urushi', 'obsidian', 'nacre', 'soap', 'carbon', 'anodizedDiamond']);

// Famille d'une finition, pour juger d'un accord (trois familles au moins)
// et faire trancher l'objet sur les murs de sa pièce
const rgbOf = (f) => [1, 3, 5].map((i) => parseInt(f.color.slice(i, i + 2), 16) / 255);
const lumaOf = (f) => { const c = rgbOf(f); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export function familyOf(f) {
  if (f.glass) return 'verre';
  const c = rgbOf(f), max = Math.max(...c), min = Math.min(...c), L = lumaOf(f);
  const sat = max > 0 ? (max - min) / max : 0;
  let hue = 0;
  if (max > min) {
    hue = max === c[0] ? ((c[1] - c[2]) / (max - min)) % 6 : max === c[1] ? (c[2] - c[0]) / (max - min) + 2 : (c[0] - c[1]) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;
  }
  if (f.irid >= 1) return L > 0.6 && !f.metal ? 'blanc' : 'irisé'; // (la nacre est un blanc)
  if (f.metal) {
    if (sat > 0.1 && hue >= 10 && hue <= 60) return 'or';
    if (sat > 0.3) return 'couleur';
    return L < 0.3 ? 'noir' : 'acier';
  }
  if (sat > 0.35 && max > 0.12) return 'couleur';
  if (L < 0.3) return 'noir';
  return L > 0.6 ? 'blanc' : 'couleur';
}

// Palette d'une scène : un accord de son humeur, sa couleur d'accent, sa
// teinte de verre
export function drawPalette(rng, moodKey) {
  const M = MOODS[moodKey], [frame, motif, counter, rich, objects] = rng.pick(M.accords);
  return { frame, motif, counter, rich: shuffled(rich, rng), objects, tint: rng.pick(M.tints), glaze: rng.pick(TINTS.glaze), glass: rng.pick(M.glass), sig: null, solo: false };
}

// Distribution des archétypes : un motif signature (deux à quatre pièces), un
// contrepoint de nature opposée (une ou deux, trois fois sur quatre), parfois
// un cabinet composite ; le reste en pièces de matière (écrins), une vitrine,
// rarement un squelette. Les pièces que visite le voyage alternent motif et
// matière.
const CALM_KINDS = ['vitrine', 'ecrin', 'squelette', 'mixte'];
function castScene(rng, M, moves) {
  const pool = Object.keys(KIND_FACES).filter((k) => !CALM_KINDS.includes(k)).map((k) => [k, M.kinds[k] ?? 1]);
  const S = rng.weighted(pool), see = SEE.has(KIND_FACES[S][0]);
  const C = rng.chance(0.75) ? rng.weighted(pool.filter(([k]) => SEE.has(KIND_FACES[k][0]) !== see)) : null;
  const withMotif = [...new Array(C ? rng.pick([2, 3, 3]) : rng.pick([3, 3, 4])).fill(S)];
  if (C) withMotif.splice(1, 0, ...new Array(rng.pick([1, 1, 2])).fill(C));
  if (rng.chance(0.45) && withMotif.length < 5) withMotif.push('mixte');
  const plain = ['ecrin', rng.chance(0.8) ? 'vitrine' : 'ecrin', 'ecrin', rng.weighted([['ecrin', 2], ['vitrine', 1], ['squelette', 1]]), 'ecrin'].slice(0, 8 - withMotif.length);
  // les pièces visitées, dans l'ordre du voyage
  const visited = [...new Set(stepOrientations(moves).slice(0, -1).map(innerCell))].slice(0, 4);
  const rest = shuffled([0, 1, 2, 3, 4, 5, 6, 7].filter((c) => !visited.includes(c)), rng);
  const first = rng.chance(0.5) ? [withMotif, plain] : [plain, withMotif];
  const kinds = new Array(8);
  visited.forEach((c, i) => { kinds[c] = first[i % 2].shift() ?? first[(i + 1) % 2].shift(); });
  const left = shuffled([...withMotif, ...plain], rng);
  rest.forEach((c) => { kinds[c] = left.shift() ?? 'ecrin'; });
  for (let c = 0; c < 8; c++) kinds[c] ??= left.shift() ?? 'ecrin';
  return { kinds, S, C };
}

// Faces d'une cellule (ctx.motifs : les motifs de la scène, pour le cabinet composite)
function shapeFaces(kind, rng, ctx) {
  const faces = new Array(6).fill('plate');
  const order = shuffled([0, 1, 2, 3, 4, 5], rng);
  const motif = KIND_FACES[kind]?.[0];
  if (kind === 'vitrine') {
    // tout en verre, sur un socle de matière ; parfois une face ouverte
    faces.fill('glass');
    faces[order[0]] = 'plate';
    if (rng.chance(0.4)) faces[order[1]] = 'open';
  } else if (kind === 'ecrin') {
    // la matière sur tous les murs, deux ou trois ouvertures (dont parfois une vitre)
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) faces[order[i]] = 'open';
    if (rng.chance(0.4)) faces[order[0]] = 'glass';
  } else if (kind === 'squelette') {
    faces.fill('open');
    if (rng.chance(0.4)) faces[order[0]] = 'glass';
  } else if (kind === 'mixte') {
    // cabinet composite : un des motifs de la scène, sur une à trois faces
    // posées librement ; au moins une face qui laisse voir
    const m = rng.pick(ctx.motifs?.length ? ctx.motifs : Object.values(KIND_FACES).filter((v) => ornate(v[0])).map((v) => v[0]));
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) faces[order[i]] = m;
    faces[order[3]] = rng.chance(0.6) ? 'glass' : 'open';
    if (rng.chance(0.5)) faces[order[4]] = 'glass';
  } else if (motif) {
    // le motif sur un axe (deux parois qui se répondent) ou deux (une
    // ceinture), le reste en doublure ; la doublure laisse voir par une vitre
    // ou une ouverture (toujours, si le motif est plein)
    const axes = shuffled([0, 1, 2], rng);
    const wide = rng.chance(0.65);
    for (const a of axes.slice(0, wide ? 2 : 1)) faces[2 * a] = faces[2 * a + 1] = motif;
    const lining = order.filter((f) => faces[f] === 'plate');
    const n = SEE.has(motif) ? (rng.chance(0.35) ? 1 : 0) : (wide ? 1 : rng.int(1, 2));
    for (let i = 0; i < n; i++) faces[lining[i]] = rng.chance(0.6) ? 'glass' : 'open';
  }
  return faces;
}

// Une paroi, un motif : quand deux panneaux ornés se font dos, la pièce la
// plus ornée cède le sien (ouvert derrière un écran qui laisse voir, plein
// derrière un relief)
export function resolveWalls(cells, rng) {
  const count = (c) => cells[c].faces.filter(ornate).length;
  for (let c = 0; c < 8; c++) for (let f = 0; f < 6; f++) {
    const [b, g] = twinFace(c, f);
    if (b < c || !ornate(cells[c].faces[f]) || !ornate(cells[b].faces[g])) continue;
    const nc = count(c), nb = count(b);
    const loseC = nc === nb ? rng.chance(0.5) : nc > nb;
    const [lose, lf, keep] = loseC ? [cells[c], f, cells[b].faces[g]] : [cells[b], g, cells[c].faces[f]];
    lose.faces[lf] = SEE.has(keep) ? 'open' : 'plate';
  }
}

// ── Cellule ──────────────────────────────────────────────────────────────────
// ctx (facultatif) : palette, la palette de la scène ; motifs, ses motifs ;
// usedContent et usedObjects, objets et matières déjà exposés (on évite les
// redites) ; plainIndex, rang de la pièce parmi celles sans motif
export function shapeCell(kind, rng, seed, ctx = {}) {
  return {
    kind, seed, faces: shapeFaces(kind, rng.fork('faces'), ctx),
    panelT: r3(rng.range(0.018, 0.032)), glassT: r3(rng.range(0.012, 0.022)),
    ...motifs(rng.fork('motifs')),
  };
}
// matières et objet d'une cellule dont les faces sont arrêtées
export function dressCell(cell, rng, mood, ctx = {}) {
  const M = MOODS[mood], pal = ctx.palette ?? drawPalette(rng.fork('accord'), mood);
  // la forme ou la matière : une pièce à motif prend un jeu uni (le dessin
  // est celui de sa forme) ; une pièce sans motif, une matière riche, dont
  // elle est aussi doublée
  const m = cell.faces.find(ornate);
  if (m) {
    // (sans contrepoint dans la scène, le cabinet composite en prend le jeu :
    // une matière de plus, et jamais plus de quatre pièces dans la même)
    cell.panelSet = (!pal.sig || m === pal.sig) && !(pal.solo && cell.kind === 'mixte') ? pal.motif : pal.counter;
    cell.panel = finishesFor(cell.panelSet, rng, pal);
  } else {
    cell.panelSet = pal.rich[(ctx.plainIndex ?? rng.int(0, 7)) % pal.rich.length];
    cell.panel = finishesFor(cell.panelSet, rng, pal);
    if (!OWN_LINING.has(cell.panelSet)) cell.panel.inner = { ...cell.panel.outer };
  }
  // (plus de verre dépoli : autour d'une vitrine ou d'un vitrail, il noyait
  // toutes les pièces voisines dans un flou ; un tirage est consommé comme avant)
  rng.next();
  cell.glass = glassFinish(rng, false, pal.glass);
  // l'objet : un par pièce (le voyage s'y arrête), jamais deux fois le même
  const used = ctx.usedContent ?? {}, usedSets = ctx.usedObjects ?? {};
  const type = rng.weighted([['pearl', 3], ['gem', 2 * (M.gems ?? 0.25) * 4], ['rings', 2], ['cube', 1.2], ['saturn', 1.5], ['mini', 1.5], ['knot', 2], ['ico', 1.2], ['dodeca', 1.2], ['stack', 1.2],
    ['mobius', 1.6], ['hyper', 1.6], ['ammonite', 1.6], ['egg', 1.4], ['urchin', 1.4]]
    .map(([k, w]) => [k, w * (M.objects?.[k] ?? 1) * (used[k] ? 0.04 : 1)]));
  // sa matière tranche sur les murs de la pièce (pas de nacre dans la nacre,
  // d'or devant le laiton, ni de noir dans le noir) ; un objet sur trois est un cristal massif
  const wall = familyOf(cell.panel.inner), dark = (f) => !f.metal && lumaOf(f) < 0.12;
  const apart = pal.objects.filter((k) => { const o = FINISHES[SETS[k].outer]; return familyOf(o) !== wall && !(dark(o) && dark(cell.panel.inner)); });
  const picked = rng.weighted((apart.length ? apart : pal.objects).map((k) => [k, 1 / (1 + 2 * (usedSets[k] || 0))]));
  const set = type !== 'gem' && rng.chance(M.crystal ?? 0.3) ? rng.weighted([['crystal', 3], ['crystalBlue', 1], ['crystalSmoke', 1]]) : picked;
  const gemKey = rng.pick(Object.keys(GEMS));
  cell.content = {
    type, size: r2(rng.range(0.38, 0.55)), set, finish: finishesFor(set, rng, pal),
    gem: { ...GEMS[gemKey], key: gemKey }, axis: rng.dir().map(r3), turns: rng.pick([1, 1, 2, -1, -2]), tilt: rng.dir().map(r3),
  };
  return cell;
}
export function makeCell(kind, rng, mood, seed, ctx = {}) {
  return dressCell(shapeCell(kind, rng, seed, ctx), rng.fork('dress'), mood, ctx);
}

// Plafonne la tôle perforée (la plus coûteuse en sommets)
function capPerforated(cells, max = 18) {
  let n = 0;
  for (const c of cells) c.faces.forEach((k, i) => { if (k === 'perf' && ++n > max) c.faces[i] = 'plate'; });
}

// ── Scène ────────────────────────────────────────────────────────────────────
export function generate(seed, opts = {}) {
  const rng = createRng(seed);
  const moodKey = opts.mood ?? rng.weighted(Object.keys(MOODS).map((k) => [k, k === 'dali' ? 0.8 : 1]));
  const M = MOODS[moodKey];
  const look = rng.fork('look');

  const netShape = rng.weighted([['dali', 2.5], ['cross', 1.5], ['chain', 1], ['random', 2]]);
  const parent = randomNet(rng.fork('net'), netShape);
  // boucle courte : le voyage visite quatre pièces, une fois chacune (le tour
  // des huit est au panneau ; un tirage est consommé comme autrefois, pour
  // que chaque graine garde le reste de sa scène)
  rng.next();
  const moveMode = 'short';
  const moves = randomMoves(rng.fork('moves'), moveMode, rng.chance(0.6));

  // la palette et la distribution (tirages à part : chaque graine garde son
  // patron, son voyage, sa caméra et sa lumière)
  const palette = drawPalette(rng.fork('accord'), moodKey);
  const cast = castScene(rng.fork('cast'), M, moves);
  palette.sig = KIND_FACES[cast.S][0];
  palette.solo = !cast.C;

  const frameStyle = rng.weighted([['square', 3], ['round', 1.5], ['tube', 1.5], ['angle', 1.5], ['extrusion', 1.5]]);
  rng.next(); // (le jeu de l'ossature vient de l'accord)
  const frame = {
    seed: rng.int(0, 1e6), style: frameStyle, w: r3(rng.range(0.05, 0.085)), chamfer: r2(rng.range(0.15, 0.35)), fillet: rng.chance(0.35),
    node: frameStyle === 'tube' ? rng.pick(['sphere', 'sphere', 'knob']) : frameStyle === 'angle' ? rng.pick(['none', 'cube']) : rng.weighted([['cube', 3], ['sphere', 1.5], ['knob', 1], ['none', 1.5]]),
    nodeScale: r2(rng.range(0.95, 1.2)), set: palette.frame, finish: finishesFor(palette.frame, rng.fork('frame'), palette),
  };
  // (barres plus étroites que des panneaux : motifs plus fins)
  for (const k of ['outer', 'inner', 'edge']) frame.finish[k].scale = r2(frame.finish[k].scale * 1.8);

  // huit cellules : les formes d'abord, puis une paroi, un motif ; les
  // matières et les objets ensuite, quand les faces sont arrêtées
  const ctx = { palette, motifs: [cast.S, cast.C].filter(Boolean).map((k) => KIND_FACES[k][0]), usedContent: {}, usedObjects: {}, plainIndex: 0 };
  const cells = [];
  for (let c = 0; c < 8; c++) {
    rng.next();
    cells.push(shapeCell(cast.kinds[c], rng.fork(`cell${c}`), rng.int(0, 1e6), ctx));
  }
  resolveWalls(cells, rng.fork('walls'));
  capPerforated(cells);
  // (un motif, un dessin : tous ses panneaux ont les mêmes paramètres)
  for (const k of Object.keys(MOTIF_DEFAULTS)) cells.forEach((cell) => { cell[k] = clone(cells[0][k]); });
  cells.forEach((cell, c) => {
    dressCell(cell, rng.fork(`dress${c}`), moodKey, ctx);
    if (!cell.faces.some(ornate)) ctx.plainIndex++;
    ctx.usedContent[cell.content.type] = (ctx.usedContent[cell.content.type] || 0) + 1;
    ctx.usedObjects[cell.content.set] = (ctx.usedObjects[cell.content.set] || 0) + 1;
  });

  const steps = moves.length;
  const R = {
    v: 1, seed: String(seed), mood: moodKey, palette, grade: M.grade,
    loop: { duration: Math.round(steps * rng.range(6.5, 9)) },
    net: { shape: netShape, parent },
    moveMode, moves,
    chor: {
      open: r2(rng.range(0.7, 1.4)), fold: r2(rng.range(2.1, 3.2)), hold: r2(rng.range(0.4, 0.9)), turn: r2(rng.range(1.6, 2.6)),
      rest: r2(rng.range(0.4, 0.9)), unfold: r2(rng.range(2.1, 3.2)), stagger: r2(rng.range(0.35, 0.7)), antic: r2(rng.range(0.15, 0.45)), turnAntic: r2(rng.range(0.1, 0.35)),
    },
    proj: {
      d: r2(rng.range(2.6, 3.6)), inflate: rng.chance(0.3) ? r2(rng.range(0.4, 1)) : 0, inset: r3(rng.range(0.9, 0.96)),
      framing: r2(rng.range(0.55, 0.8)), size: 1, reveal: 1, revealLo: -0.5, revealHi: 0.85, tiltX: r2(rng.range(-0.35, 0.1)), tiltZ: r2(rng.range(-0.25, 0.25)), spin: rng.pick([0, 0, 1, -1]),
    },
    frame, cells,
    camera: {
      fov: r2(rng.range(24, 34)), dist: r2(rng.range(1, 1.2)), elev: r2(rng.range(0.12, 0.34)), orbit: rng.pick([0, 0, 1, -1]),
      sway: r2(rng.range(0.15, 0.4)), az: r2(rng.range(-0.6, 0.6)), focus: 1,
    },
    key: { color: kelvinToHex(M.keyK), intensity: r2(rng.range(550, 850) * (M.keyScale ?? 1)), az: r2(rng.range(0.5, 1.2) * rng.sign()), el: r2(rng.range(0.8, 1.1)), angle: 0.5, penumbra: 0.75, soft: r2(rng.range(2, 5)) },
    rim: { color: look.pick(M.rim), intensity: r2(rng.range(300, 550) * (M.keyScale ?? 1)), az: r2(rng.range(2.4, 3.6)), el: r2(rng.range(0.3, 0.6)) },
    rim2: { color: look.pick(M.rim), intensity: r2(rng.range(60, 260)), az: r2(rng.range(-2.2, -1.4)), el: r2(rng.range(0.1, 0.4)) },
    env: { preset: M.env, intensity: r2(M.envIntensity ? rng.range(...M.envIntensity) : rng.range(0.5, 0.85)), rotation: r2(rng.range(0, Math.PI * 2)) },
    floor: { kind: rng.pick(M.floor), level: r2(rng.range(1.25, 1.45)), reflect: r2(rng.range(0.4, 0.8)) },
    bg: M.bg,
    view: { ...VIEW_DEFAULTS, practicalColor: M.practical ?? VIEW_DEFAULTS.practicalColor },
    fog: { near: 9, far: 26 },
    voyage: { ...VOYAGE_DEFAULTS },
  };
  // (le voyage a sa propre durée : une halte par pièce, une traversée par mouvement)
  if (R.voyage.on) R.loop.duration = Math.round(voyageSeconds(R));
  return R;
}

export const rootCell = ROOT;

// Lisibilité et vue sur l'intérieur (réglages par défaut)
//   ghost : silhouette du tesseract plié (destination) ; seams : liserés des
//   faces appariées ; depth : profondeur 4D en couleur ; cutaway : panneaux
//   ajourés côté caméra ; practical : lumières d'écrin ; hero : lumière de
//   vedette de chaque objet exposé (× la lumière d'écrin) ; dolly : la caméra
//   s'approche pendant les pauses
export const VIEW_DEFAULTS = { ghost: 0, seams: 1, depth: 0.6, cutaway: 0.55, practical: 6, practicalColor: '#ffd9a8', hero: 0.9, dolly: 0.35 };

// Le voyage intérieur (voir math4.js et scene/voyage.js) : durées (plongée,
// halte dans une pièce, traversée, remontée), écart de la caméra à l'axe de
// la traversée et rayon de son tour autour de l'objet, champ, lampe,
// brouillard, ajourage des parois vues de l'intérieur, taille des objets
export const VOYAGE_DEFAULTS = {
  on: true, plunge: 4.2, dwell: 3.4, travel: 3.6, surface: 4,
  radius: 0.42, orbitR: 0.62, fov: 68, lamp: 1, fogNear: 1.4, fogFar: 6.5, see: 0.9, objScale: 0.27,
};

// Recette ancienne (lien partagé) : on complète ce qui manque
export function upgrade(R) {
  const D = MOTIF_DEFAULTS;
  for (const c of R.cells) for (const [k, v] of Object.entries(D)) c[k] ??= { ...v };
  R.view = { ...VIEW_DEFAULTS, ...R.view };
  R.voyage ??= { ...VOYAGE_DEFAULTS, on: false }; // (scène partagée avant le voyage : telle quelle)
  return R;
}
