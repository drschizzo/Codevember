// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';
import { randomNet, randomMoves, ROOT } from './math4.js';

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
// matériaux favoris ; kinds : poids des archétypes de cellule ; rim : teintes
// des contre-jours
export const MOODS = {
  atelier: {
    label: 'Atelier', env: 'atelier', bg: '#0b0907', keyK: 3400, rim: ['#ffb070', '#ffd9a8'], floor: ['concrete', 'oak'],
    frames: ['brassVelvet', 'bronze', 'blackSteel', 'damascus', 'goldLeaf'],
    panels: ['brassVelvet', 'verdigris', 'bronze', 'marble', 'urushi', 'guilloche', 'damascus'],
    contents: ['goldLeaf', 'nacre', 'marble', 'bronze', 'urushi'],
    kinds: { vitrine: 2, ecrin: 3, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1 },
  },
  studio: {
    label: 'Studio', env: 'studio', bg: '#07080a', keyK: 5600, rim: ['#9fc4ff', '#ffffff'], floor: ['gloss', 'concrete'],
    frames: ['carbon', 'anodizedDiamond', 'ceramicBlack', 'titanium', 'chrome', 'blackSteel'],
    panels: ['carbon', 'anodizedDiamond', 'ceramicBlack', 'guillocheSilver', 'titanium', 'ceramicWhite'],
    contents: ['chrome', 'ceramicWhite', 'titanium', 'nacre', 'ceramicBlack'],
    kinds: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 3, tissage: 1, squelette: 1 },
  },
  ecrin: {
    label: 'Écrin', env: 'atelier', bg: '#070405', keyK: 3000, rim: ['#ffc58a', '#ff8fa0'], floor: ['gloss', 'velvet'],
    frames: ['goldLeaf', 'brassVelvet', 'urushi', 'nero', 'guilloche'],
    panels: ['guilloche', 'guillocheRuby', 'urushi', 'nero', 'brassVelvet', 'kintsugi'],
    contents: ['goldLeaf', 'nacre', 'urushi', 'guilloche'],
    kinds: { vitrine: 3, ecrin: 4, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 1 }, gems: 0.55,
  },
  clinique: {
    label: 'Clinique', env: 'cyclo', bg: '#dedcd7', keyK: 6500, rim: ['#ffffff', '#e8f0ff'], floor: ['cyclo'], envIntensity: [0.32, 0.45], keyScale: 0.6,
    frames: ['ceramicWhite', 'chrome', 'guillocheSilver', 'anodizedDiamond'],
    panels: ['ceramicWhite', 'kintsugi', 'celadon', 'nacre', 'marble', 'chrome'],
    contents: ['chrome', 'nacre', 'kintsugi', 'ceramicBlack'],
    kinds: { vitrine: 3, ecrin: 2, moucharabieh: 3, persienne: 2, tissage: 2, squelette: 1 },
  },
  nuit: {
    label: 'Nuit', env: 'night', bg: '#030407', keyK: 7000, rim: ['#5b8cff', '#ff4fa0', '#46e0ff', '#a070ff'], floor: ['gloss'],
    frames: ['blackSteel', 'titanium', 'carbon', 'anodizedDiamond', 'ceramicBlack'],
    panels: ['titanium', 'anodizedDiamond', 'carbon', 'blackSteel', 'soap', 'obsidian'],
    contents: ['chrome', 'soap', 'titanium', 'obsidian'],
    kinds: { vitrine: 3, ecrin: 1, moucharabieh: 3, persienne: 3, tissage: 2, squelette: 1 },
  },
  dali: {
    label: 'Surréaliste', env: 'softbox', bg: '#120d09', keyK: 4300, rim: ['#ffcf8a', '#9fb8ff'], floor: ['checker'], envIntensity: [0.55, 0.75],
    frames: ['goldLeaf', 'brassVelvet', 'ceramicWhite', 'nero'],
    panels: ['marble', 'nero', 'kintsugi', 'celadon', 'guilloche', 'nacre'],
    contents: ['nacre', 'goldLeaf', 'marble', 'chrome'],
    kinds: { vitrine: 3, ecrin: 3, moucharabieh: 2, persienne: 1, tissage: 1, squelette: 2 },
  },
  irise: {
    label: 'Irisé', env: 'studio', bg: '#05060a', keyK: 6000, rim: ['#8fd0ff', '#ffa8e0'], floor: ['gloss'],
    frames: ['titanium', 'chrome', 'blackSteel'],
    panels: ['soap', 'nacre', 'titanium', 'chrome'],
    contents: ['soap', 'nacre', 'titanium', 'chrome'],
    kinds: { vitrine: 4, ecrin: 1, moucharabieh: 2, persienne: 2, tissage: 1, squelette: 1 }, gems: 0.4,
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
};
export const FACE_KINDS = { Ouvert: 'open', Plaque: 'plate', Verre: 'glass', 'Tôle perforée': 'perf', Persiennes: 'louvre', 'Grille tissée': 'grid' };
export const CONTENT_TYPES = { Rien: 'none', Perle: 'pearl', Pierre: 'gem', Gyroscope: 'rings', Cube: 'cube', Saturne: 'saturn', 'Mise en abyme': 'mini' };
export const FRAME_STYLES = { 'Carré chanfreiné': 'square', Rond: 'round', Tube: 'tube', Cornière: 'angle', 'Profilé rainuré': 'extrusion' };
export const NODE_STYLES = { Cube: 'cube', Sphère: 'sphere', Pommeau: 'knob', Aucun: 'none' };
export const HOLE_SHAPES = { Rond: 'circle', Carré: 'square', Losange: 'diamond', Étoile: 'cross' };
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

// ── Cellule ──────────────────────────────────────────────────────────────────
export function makeCell(kind, rng, mood, seed) {
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
    default: break;
  }
  const panelSet = rng.pick(M.panels);
  const contentType = kind === 'squelette' || kind === 'vitrine' || rng.chance(0.6)
    ? rng.weighted([['pearl', 3], ['gem', 2 * (M.gems ?? 0.25) * 4], ['rings', 2], ['cube', 1.5], ['saturn', 1.5], ['mini', 1.5]])
    : 'none';
  const contentSet = rng.pick(M.contents);
  const gemKey = rng.pick(Object.keys(GEMS));
  return {
    kind, seed, faces,
    panelT: r3(rng.range(0.018, 0.032)), glassT: r3(rng.range(0.012, 0.022)),
    perf: { n: rng.int(5, 9), shape: rng.weighted([['circle', 4], ['square', 2], ['diamond', 2], ['cross', 1.2]]), grad: rng.weighted([['radial', 3], ['edge', 2], ['diagonal', 2], ['wave', 2], ['uniform', 1.5], ['random', 1]]), min: r2(rng.range(0, 0.3)), max: r2(rng.range(0.7, 0.95)), twist: rng.chance(0.3) ? r2(rng.range(0, Math.PI / 2)) : 0 },
    louvre: { n: rng.int(6, 12), angle: r2(rng.range(0.35, 0.95) * rng.sign()) },
    grid: { n: rng.int(6, 12) },
    panelSet, panel: finishesFor(panelSet, rng),
    glass: glassFinish(rng, rng.chance(0.2)),
    content: {
      type: contentType, size: r2(rng.range(0.32, 0.5)), set: contentSet, finish: finishesFor(contentSet, rng),
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
  const moveMode = rng.weighted([['same', 1], ['mixed', 3]]);
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

  // huit cellules : archétypes tirés selon l'humeur, sans trop de répétitions
  const kindsW = Object.entries(M.kinds);
  const used = {};
  const cells = [];
  for (let c = 0; c < 8; c++) {
    const kind = rng.weighted(kindsW.map(([k, w]) => [k, w / (1 + 1.4 * (used[k] || 0))]));
    used[kind] = (used[kind] || 0) + 1;
    cells.push(makeCell(kind, rng.fork(`cell${c}`), moodKey, rng.int(0, 1e6)));
  }
  capPerforated(cells);

  const steps = moves.length;
  return {
    v: 1, seed: String(seed), mood: moodKey,
    loop: { duration: Math.round(steps * rng.range(6.5, 9)) },
    net: { shape: netShape, parent },
    moveMode, moves,
    chor: {
      open: r2(rng.range(0.7, 1.4)), fold: r2(rng.range(1.4, 2.2)), hold: r2(rng.range(0.4, 0.9)), turn: r2(rng.range(1.6, 2.6)),
      rest: r2(rng.range(0.4, 0.9)), unfold: r2(rng.range(1.4, 2.2)), stagger: r2(rng.range(0.35, 0.7)), antic: r2(rng.range(0.15, 0.45)), turnAntic: r2(rng.range(0.1, 0.35)),
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
    fog: { near: 9, far: 26 },
  };
}

export const rootCell = ROOT;
