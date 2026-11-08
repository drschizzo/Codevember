// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';
import { randomNet, randomMoves, ROOT, voyageSeconds } from './math4.js';

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
// env : studio HDR ; floor : sol ; frames / panels / contents : jeux de
// matériaux favoris ; plain : jeux unis (cellules à motif) ; kinds : poids des archétypes de cellule ; objects :
// objets exposés favoris (multiplient leur poids) ; rim : teintes des
// contre-jours
export const MOODS = {
  atelier: {
    label: 'Atelier', practical: '#ffc890', env: 'atelier', bg: '#0b0907', keyK: 3400, rim: ['#ffb070', '#ffd9a8'], floor: ['concrete', 'oak'],
    frames: ['brassVelvet', 'bronze', 'blackSteel', 'damascus', 'goldLeaf'],
    panels: ['brassVelvet', 'verdigris', 'bronze', 'marble', 'urushi', 'guilloche', 'damascus'],
    contents: ['goldLeaf', 'nacre', 'marble', 'bronze', 'urushi'],
    kinds: { vitrine: 2, ecrin: 3, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1, cage: 2, vitrail: 1.5, cloute: 2, industriel: 2.5, cible: 1.5, mixte: 3, origami: 1.5, rosace: 2, onde: 1, ecailles: 2.5, ruche: 2, cinetique: 1.5 }, plain: ['brassVelvet', 'blackSteel', 'obsidian'], objects: { ammonite: 2.5, egg: 1.5, hyper: 1 },
  },
  studio: {
    label: 'Studio', practical: '#fff1e0', env: 'studio', bg: '#07080a', keyK: 5600, rim: ['#9fc4ff', '#ffffff'], floor: ['gloss', 'concrete'],
    frames: ['carbon', 'anodizedDiamond', 'ceramicBlack', 'titanium', 'chrome', 'blackSteel'],
    panels: ['carbon', 'anodizedDiamond', 'ceramicBlack', 'guillocheSilver', 'titanium', 'ceramicWhite'],
    contents: ['chrome', 'ceramicWhite', 'titanium', 'nacre', 'ceramicBlack'],
    kinds: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 3, tissage: 1, squelette: 1, cage: 2, vitrail: 1, cloute: 2, industriel: 2.5, cible: 2, mixte: 3, origami: 2.5, rosace: 1, onde: 2, ecailles: 1.5, ruche: 2.5, cinetique: 3 }, plain: ['ceramicBlack', 'anodizedDiamond', 'carbon'], objects: { hyper: 2.5, mobius: 2 },
  },
  ecrin: {
    label: 'Écrin', practical: '#ffb878', env: 'atelier', bg: '#070405', keyK: 3000, rim: ['#ffc58a', '#ff8fa0'], floor: ['gloss', 'velvet'],
    frames: ['goldLeaf', 'brassVelvet', 'urushi', 'nero', 'guilloche'],
    panels: ['guilloche', 'guillocheRuby', 'urushi', 'nero', 'brassVelvet', 'kintsugi'],
    contents: ['goldLeaf', 'nacre', 'urushi', 'guilloche'],
    kinds: { vitrine: 3, ecrin: 4, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 1, cage: 1.5, vitrail: 2.5, cloute: 3, industriel: 0.5, cible: 2, mixte: 3, origami: 1, rosace: 3, onde: 2.5, ecailles: 3, ruche: 1.5, cinetique: 0.5 }, plain: ['brassVelvet', 'obsidian', 'ceramicBlack'], objects: { egg: 3, urchin: 2 }, gems: 0.55,
  },
  clinique: {
    label: 'Clinique', practical: '#ffffff', env: 'cyclo', bg: '#dedcd7', keyK: 6500, rim: ['#ffffff', '#e8f0ff'], floor: ['cyclo'], envIntensity: [0.32, 0.45], keyScale: 0.6,
    frames: ['ceramicWhite', 'chrome', 'guillocheSilver', 'anodizedDiamond'],
    panels: ['ceramicWhite', 'kintsugi', 'celadon', 'nacre', 'marble', 'chrome'],
    contents: ['chrome', 'nacre', 'kintsugi', 'ceramicBlack'],
    kinds: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1, cage: 1.5, vitrail: 1.5, cloute: 2, industriel: 1, cible: 2.5, mixte: 3, origami: 3, rosace: 1.5, onde: 3, ecailles: 1.5, ruche: 2.5, cinetique: 2 }, plain: ['ceramicWhite', 'nacre', 'titanium'], objects: { mobius: 2.5, egg: 2 },
  },
  nuit: {
    label: 'Nuit', practical: '#9fd0ff', env: 'night', bg: '#030407', keyK: 7000, rim: ['#5b8cff', '#ff4fa0', '#46e0ff', '#a070ff'], floor: ['gloss'],
    frames: ['blackSteel', 'titanium', 'carbon', 'anodizedDiamond', 'ceramicBlack'],
    panels: ['titanium', 'anodizedDiamond', 'carbon', 'blackSteel', 'soap', 'obsidian'],
    contents: ['chrome', 'soap', 'titanium', 'obsidian'],
    kinds: { vitrine: 3, ecrin: 1, moucharabieh: 3, persienne: 3, tissage: 2, squelette: 1, cage: 2, vitrail: 1.5, cloute: 1.5, industriel: 2, cible: 2, mixte: 3, origami: 1.5, rosace: 1.5, onde: 2, ecailles: 2, ruche: 3, cinetique: 3 }, plain: ['blackSteel', 'obsidian', 'carbon'], objects: { hyper: 2.5, urchin: 2 },
  },
  dali: {
    label: 'Surréaliste', practical: '#ffd59a', env: 'softbox', bg: '#120d09', keyK: 4300, rim: ['#ffcf8a', '#9fb8ff'], floor: ['checker'], envIntensity: [0.55, 0.75],
    frames: ['goldLeaf', 'brassVelvet', 'ceramicWhite', 'nero'],
    panels: ['marble', 'nero', 'kintsugi', 'celadon', 'guilloche', 'nacre'],
    contents: ['nacre', 'goldLeaf', 'marble', 'chrome'],
    kinds: { vitrine: 3, ecrin: 3, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 2, cage: 2, vitrail: 3, cloute: 1.5, industriel: 0.5, cible: 2, mixte: 3, origami: 2, rosace: 3, onde: 2, ecailles: 1.5, ruche: 1, cinetique: 1 }, plain: ['nacre', 'ceramicWhite', 'brassVelvet'], objects: { egg: 2.5, ammonite: 2, mobius: 1.5 },
  },
  irise: {
    label: 'Irisé', practical: '#e8d8ff', env: 'studio', bg: '#05060a', keyK: 6000, rim: ['#8fd0ff', '#ffa8e0'], floor: ['gloss'],
    frames: ['titanium', 'chrome', 'blackSteel'],
    panels: ['soap', 'nacre', 'titanium', 'chrome'],
    contents: ['soap', 'nacre', 'titanium', 'chrome'],
    kinds: { vitrine: 4, ecrin: 1, moucharabieh: 2, persienne: 2, tissage: 1, squelette: 1, cage: 1.5, vitrail: 2.5, cloute: 1.5, industriel: 1, cible: 2, mixte: 3, origami: 2, rosace: 2, onde: 3, ecailles: 2, ruche: 1.5, cinetique: 2 }, plain: ['nacre', 'titanium', 'soap'], objects: { urchin: 2.5, mobius: 2 }, gems: 0.4,
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

// finitions d'une pièce à partir d'un jeu (copie profonde, teintes tirées)
export function finishesFor(setKey, rng) {
  const set = SETS[setKey];
  const pick = (k) => ({ ...FINISHES[k], preset: k });
  const out = { outer: pick(set.outer), inner: pick(set.inner), edge: pick(set.edge), wear: set.wear || 0 };
  if (set.outer === 'anodized') { const t = rng.pick(TINTS.anodized); out.outer.color = t; out.inner.color = t; }
  if (set.outer === 'glaze') out.outer.color = rng.pick(TINTS.glaze);
  return out;
}
// verre teinté (les trois faces)
export function glassFinish(rng, frosted = false) {
  const base = frosted ? FINISHES.frostedGlass : FINISHES.smokedGlass;
  const g = { ...base, preset: frosted ? 'frostedGlass' : 'smokedGlass', color2: rng.pick(GLASS_TINTS), attDist: r2(rng.range(0.5, 1.4)), dispersion: r2(rng.range(0.15, 0.4)), smudge: r2(rng.range(0, 0.25)) };
  const edge = { ...g, rough: Math.max(g.rough, 0.25) };
  return { outer: g, inner: { ...g }, edge, wear: 0 };
}

// Paramètres des motifs ajoutés (pli Miura, onde, lames vrillées, écailles,
// nid d'abeille, rosace) ; des plages resserrées : un motif trop fin se lit
// comme un grain, trop gros comme un accident
function motifs(rng) {
  return {
    miura: { n: rng.int(4, 8), rows: 2 * rng.int(2, 4), h: r2(rng.range(0.35, 0.8)), s: r2(rng.range(0.25, 0.6)) },
    ripple: { n: rng.int(3, 6), amp: r2(rng.range(0.35, 0.75)), src: rng.weighted([['center', 3], ['corner', 1.5], ['pair', 2]]) },
    twist: { n: rng.int(10, 15), twist: r2(rng.range(0.8, 2.6) * rng.sign()), ramp: r2(rng.range(-1.2, 1.2)), base: r2(rng.range(0, 0.6)) },
    scales: { n: rng.int(5, 8), tilt: r2(rng.range(0.2, 0.35)), dome: r2(rng.range(0.12, 0.22)) },
    comb: { n: rng.int(3, 6), depth: r2(rng.range(0.5, 1)), rot: rng.chance(0.5) },
    oculus: { r: r2(rng.range(0.62, 0.82)), spokes: rng.pick([0, 4, 6, 8, 8, 12]), ring: rng.chance(0.55) },
  };
}
export const MOTIF_DEFAULTS = motifs(createRng('motifs'));

// ── Sobriété ─────────────────────────────────────────────────────────────────
// Une cellule a une hiérarchie : quatre faces à motif au plus (deux axes) et
// une doublure unie sur le troisième, deux motifs différents au plus. Vue de
// l'intérieur, une pièce ornée de toutes parts ne se lit plus.
const ornate = (k) => k !== 'plate' && k !== 'glass' && k !== 'open';
// motifs de matière qui dessinent (veines, coups de marteau, guillochis…)
const BUSY = new Set(['hammered', 'glaze', 'rock', 'glitter', 'patina', 'guilloche', 'damascus', 'marble', 'urushi', 'agate']);
// (un miroir aussi : des parois de chrome se reflètent à l'infini)
const busySet = (k) => BUSY.has(FINISHES[SETS[k].outer].pattern) || SETS[k].outer === 'chrome';
function calmFaces(faces, kind, rng) {
  // deux motifs différents au plus (le plus fréquent d'abord)
  const count = {};
  for (const k of faces) if (ornate(k)) count[k] = (count[k] || 0) + 1;
  const keep = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 2);
  faces.forEach((k, i) => { if (ornate(k) && !keep.includes(k)) faces[i] = 'plate'; });
  // quatre faces à motif au plus : un axe passe en doublure unie
  if (faces.filter(ornate).length > 4) {
    const axes = [0, 1, 2].filter((a) => ornate(faces[2 * a]) && ornate(faces[2 * a + 1]));
    const a = rng.pick(axes);
    faces[2 * a] = faces[2 * a + 1] = 'plate';
  }
  // (le cabinet composite garde deux faces qui laissent voir)
  if (kind === 'mixte') {
    const see = (k) => k === 'glass' || k === 'open' || ['bars', 'leaded', 'target', 'grid', 'comb', 'oculus'].includes(k);
    for (let i = 0; faces.filter(see).length < 2 && i < 6; i++) if (faces[i] === 'plate') faces[i] = 'glass';
  }
}

// ── Cellule ──────────────────────────────────────────────────────────────────
// ctx (facultatif) : vocab, archétypes de la scène ; usedContent, objets
// déjà exposés (on évite d'en montrer deux fois le même)
export function makeCell(kind, rng, mood, seed, ctx = {}) {
  const M = MOODS[mood];
  const faces = new Array(6).fill('plate');
  const side = () => rng.int(0, 5);
  switch (kind) {
    case 'vitrine': faces.fill('glass'); if (rng.chance(0.5)) faces[side()] = 'open'; break;
    case 'ecrin': faces.fill('plate'); for (let i = 0, n = rng.int(2, 3); i < n; i++) faces[side()] = 'open'; break;
    case 'moucharabieh': faces.fill('perf'); if (rng.chance(0.35)) faces[side()] = 'open'; break;
    case 'persienne': for (let f = 0; f < 6; f++) faces[f] = f >> 1 === 1 ? 'plate' : 'louvre'; break;
    case 'tissage': faces.fill('grid'); if (rng.chance(0.4)) faces[side()] = 'glass'; break;
    case 'squelette': faces.fill('open'); if (rng.chance(0.4)) faces[side()] = 'glass'; break;
    case 'cage': faces.fill('bars'); faces[2] = 'plate'; faces[3] = rng.chance(0.5) ? 'plate' : 'perf'; break;
    case 'vitrail': faces.fill('leaded'); if (rng.chance(0.4)) faces[side()] = 'open'; break;
    case 'cloute': faces.fill('stud'); for (let i = 0, n = rng.int(1, 2); i < n; i++) faces[side()] = rng.chance(0.5) ? 'open' : 'glass'; break;
    case 'industriel': for (let f = 0; f < 6; f++) faces[f] = f >> 1 === 1 ? 'perf' : 'corrugated'; faces[side()] = 'open'; break;
    case 'cible': for (let f = 0; f < 6; f++) faces[f] = f >> 1 === 2 ? 'glass' : 'target'; break;
    // (archétypes ajoutés)
    case 'origami': faces.fill('miura'); faces[side()] = rng.chance(0.5) ? 'open' : 'glass'; break;
    case 'rosace': for (let f = 0; f < 6; f++) faces[f] = f >> 1 === 1 ? 'plate' : 'oculus'; break;
    case 'onde': faces.fill('ripple'); for (let i = 0, n = rng.int(1, 2); i < n; i++) faces[side()] = rng.chance(0.6) ? 'glass' : 'open'; break;
    case 'ecailles': faces.fill('scales'); for (let i = 0, n = rng.int(1, 2); i < n; i++) faces[side()] = rng.chance(0.6) ? 'glass' : 'open'; break;
    case 'ruche': faces.fill('comb'); if (rng.chance(0.5)) faces[side()] = 'glass'; break;
    case 'cinetique': for (let f = 0; f < 6; f++) faces[f] = f >> 1 === 1 ? (rng.chance(0.5) ? 'plate' : 'perf') : 'twist'; break;
    case 'mixte': { // chaque face tirée à part, au moins deux faces qui laissent voir
      let pool = [['plate', 2], ['glass', 2], ['perf', 2], ['louvre', 1.5], ['grid', 1], ['stud', 1.5], ['corrugated', 1], ['leaded', 1.5], ['bars', 1.5], ['target', 1], ['open', 1],
        ['miura', 1.5], ['ripple', 1.5], ['oculus', 1.5], ['scales', 1.5], ['comb', 1.5], ['twist', 1.5]];
      // (le vocabulaire de la scène, plus les faces neutres : un cabinet qui
      // mêlerait tous les motifs n'en montrerait aucun)
      if (ctx.vocab) {
        const ok = new Set(['plate', 'glass', 'open', ...[...ctx.vocab].flatMap((k) => KIND_FACES[k] ?? [])]);
        pool = pool.filter(([k]) => ok.has(k));
      }
      for (let f = 0; f < 6; f++) faces[f] = rng.weighted(pool);
      const see = ['glass', 'open', 'bars', 'leaded', 'target', 'grid', 'comb', 'oculus'];
      while (faces.filter((x) => see.includes(x)).length < 2) faces[side()] = rng.pick(see);
      break;
    }
    default: break;
  }
  calmFaces(faces, kind, rng.fork('calm'));
  // la forme ou la matière, pas les deux : une cellule à motif prend un jeu
  // uni (sans veines, martelé, guilloché ni miroir), le dessin est celui de
  // sa forme ; les cellules unies gardent les matières riches
  let panelSet = rng.pick(M.panels);
  if (faces.some(ornate) && busySet(panelSet)) {
    const calm = M.panels.filter((k) => !busySet(k));
    panelSet = rng.fork('calmSet').pick(calm.length >= 2 ? calm : [...calm, ...M.plain]);
  }
  // (chaque pièce a son objet : le voyage intérieur s'y arrête ; tirage à
  // part pour celles qui n'en avaient pas, le reste de la scène est inchangé)
  const used = ctx.usedContent ?? {};
  const CONTENTS = [['pearl', 3], ['gem', 2 * (M.gems ?? 0.25) * 4], ['rings', 2], ['cube', 1.2], ['saturn', 1.5], ['mini', 1.5], ['knot', 2], ['ico', 1.2], ['dodeca', 1.2], ['stack', 1.2],
    ['mobius', 1.6], ['hyper', 1.6], ['ammonite', 1.6], ['egg', 1.4], ['urchin', 1.4]]
    .map(([k, w]) => [k, (w * (M.objects?.[k] ?? 1)) / (1 + 3 * (used[k] || 0))]);
  const contentType = kind === 'squelette' || kind === 'vitrine' || rng.chance(0.6)
    ? rng.weighted(CONTENTS) : rng.fork('content').weighted(CONTENTS);
  // (tirage indépendant : les graines existantes gardent le reste de leur scène)
  const cx = rng.fork('crystal'), picked = rng.pick(M.contents);
  const contentSet = contentType !== 'gem' && cx.chance(M.crystal ?? 0.3)
    ? cx.weighted([['crystal', 3], ['crystalBlue', 1], ['crystalSmoke', 1]]) : picked;
  // paramètres des motifs ajoutés (tirage à part : les graines existantes
  // gardent ceux de leurs autres panneaux)
  const mo = rng.fork('motifs');
  const gemKey = rng.pick(Object.keys(GEMS));
  return {
    kind, seed, faces,
    panelT: r3(rng.range(0.018, 0.032)), glassT: r3(rng.range(0.012, 0.022)),
    perf: { n: rng.int(5, 9), shape: rng.weighted([['circle', 4], ['square', 2], ['diamond', 2], ['cross', 1.2], ['hex', 2.5], ['slot', 2]]), grad: rng.weighted([['radial', 3], ['edge', 2], ['diagonal', 2], ['wave', 2], ['uniform', 1.5], ['random', 1]]), min: r2(rng.range(0, 0.3)), max: r2(rng.range(0.7, 0.95)), twist: rng.chance(0.3) ? r2(rng.range(0, Math.PI / 2)) : 0 },
    louvre: { n: rng.int(6, 12), angle: r2(rng.range(0.35, 0.95) * rng.sign()) },
    grid: { n: rng.int(6, 12) },
    stud: { n: rng.int(4, 9), mode: rng.weighted([['pyramid', 3], ['dome', 2], ['coffer', 2]]), height: r2(rng.range(0.35, 0.8)) },
    corr: { n: rng.int(3, 8), amp: r2(rng.range(0.2, 0.45)) },
    leaded: { n: rng.int(2, 5), pattern: rng.weighted([['diamond', 3], ['grid', 2]]) },
    bars: { n: rng.int(6, 13), cross: rng.chance(0.6) },
    target: { n: rng.int(3, 8), fill: r2(rng.range(0.35, 0.75)) },
    ...motifs(mo),
    panelSet, panel: finishesFor(panelSet, rng),
    glass: glassFinish(rng, rng.chance(0.2)),
    content: {
      type: contentType, size: r2(rng.range(0.38, 0.55)), set: contentSet, finish: finishesFor(contentSet, rng),
      gem: { ...GEMS[gemKey], key: gemKey }, axis: rng.dir().map(r3), turns: rng.pick([1, 1, 2, -1, -2]), tilt: rng.dir().map(r3),
    },
  };
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

  const frameStyle = rng.weighted([['square', 3], ['round', 1.5], ['tube', 1.5], ['angle', 1.5], ['extrusion', 1.5]]);
  const frameSet = rng.pick(M.frames);
  const frame = {
    seed: rng.int(0, 1e6), style: frameStyle, w: r3(rng.range(0.05, 0.085)), chamfer: r2(rng.range(0.15, 0.35)), fillet: rng.chance(0.35),
    node: frameStyle === 'tube' ? rng.pick(['sphere', 'sphere', 'knob']) : frameStyle === 'angle' ? rng.pick(['none', 'cube']) : rng.weighted([['cube', 3], ['sphere', 1.5], ['knob', 1], ['none', 1.5]]),
    nodeScale: r2(rng.range(0.95, 1.2)), set: frameSet, finish: finishesFor(frameSet, rng),
  };
  // (barres plus étroites que des panneaux : motifs plus fins)
  for (const k of ['outer', 'inner', 'edge']) frame.finish[k].scale = r2(frame.finish[k].scale * 1.8);

  // huit cellules : archétypes tirés selon l'humeur, sans trop de répétitions,
  // dans le vocabulaire de la scène : trois ou quatre archétypes seulement (tirés
  // à part), pour que chaque scène ait son style et que l'image reste lisible
  const kindsW = Object.entries(M.kinds);
  const voc = rng.fork('vocab'), vocab = new Set(), pool = kindsW.slice();
  for (let n = voc.int(3, 4); vocab.size < n && pool.length;) {
    const k = voc.weighted(pool);
    vocab.add(k);
    pool.splice(pool.findIndex(([x]) => x === k), 1);
  }
  const used = {}, usedContent = {};
  const cells = [];
  for (let c = 0; c < 8; c++) {
    const kind = rng.weighted(kindsW.filter(([k]) => vocab.has(k)).map(([k, w]) => [k, w / (1 + 1.4 * (used[k] || 0))]));
    used[kind] = (used[kind] || 0) + 1;
    const cell = makeCell(kind, rng.fork(`cell${c}`), moodKey, rng.int(0, 1e6), { vocab, usedContent });
    usedContent[cell.content.type] = (usedContent[cell.content.type] || 0) + 1;
    cells.push(cell);
  }
  capPerforated(cells);

  const steps = moves.length;
  const R = {
    v: 1, seed: String(seed), mood: moodKey,
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
  on: true, plunge: 4.2, dwell: 2.8, travel: 3.6, surface: 4,
  radius: 0.42, orbitR: 0.62, fov: 68, lamp: 1, fogNear: 1.4, fogFar: 6.5, see: 0.9, objScale: 0.27,
};

// Recette ancienne (lien partagé) : on complète ce qui manque
export function upgrade(R) {
  const D = { stud: { n: 6, mode: 'pyramid', height: 0.5 }, corr: { n: 5, amp: 0.3 }, leaded: { n: 3, pattern: 'diamond' }, bars: { n: 9, cross: true }, target: { n: 5, fill: 0.5 } };
  Object.assign(D, MOTIF_DEFAULTS);
  for (const c of R.cells) for (const [k, v] of Object.entries(D)) c[k] ??= { ...v };
  R.view = { ...VIEW_DEFAULTS, ...R.view };
  R.voyage ??= { ...VOYAGE_DEFAULTS, on: false }; // (scène partagée avant le voyage : telle quelle)
  return R;
}
