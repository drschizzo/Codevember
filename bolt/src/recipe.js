// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place. Le rendu
// ne lit QUE la recette et la phase : même recette, même phase → même image.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main (récipient, métal, support, thé) ;
// - une humeur est un décor (support, mur, lumière, valeur, cadrage), pas une
//   teinte ; les lampes sont presque blanches, l'éclair est bleuté ;
// - l'éclair lui-même n'est pas dans la recette : il est calculé (gen/dbm.js)
//   à partir de ce qu'elle en dit (R.bolt).
import { createRng } from '../../shared/rng.js';
import { FINISHES, FINISH_DEFAULTS } from '../../shared/finishes.js';
import { VARIANTS, FAMILIES } from './gen/vessels.js';
import { TIMES } from './film.js';

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

// une finition du catalogue commun, retouchée
const fin = (key, o = {}) => ({ ...FINISH_DEFAULTS, ...FINISHES[key], preset: key, ...o });
// ── Matières du thème ────────────────────────────────────────────────────────
const SILVER = fin('chrome', { label: 'Argent poli', color: '#fcfaf5', rough: 0.1, smudge: 0.3 });
const VERMEIL = fin('polishedGold', { label: 'Vermeil', rough: 0.12 });
const STEEL = fin('brushedSteel', { label: 'Inox brossé', rough: 0.3 });
const IRON = fin('bronzeDark', { label: 'Fonte', color: '#4a4b50', metal: 1, rough: 0.62, bump: 0.5, scale: 2.4 });
const IRON_IN = fin('whiteCeramic', { label: 'Émail de cuve', color: '#22242a', rough: 0.3 });
export const BODIES = {
  // [externe, interne, tranche (la lèvre)]
  porcelaineOr: { label: 'Porcelaine à filet d’or', outer: fin('whiteCeramic', { color: '#f3f0ea', rough: 0.16 }), inner: fin('whiteCeramic', { color: '#f3f0ea', rough: 0.16 }), edge: fin('polishedGold'), family: 'céramique' },
  porcelainePlatine: { label: 'Porcelaine à filet de platine', outer: fin('whiteCeramic', { color: '#eef1f2', rough: 0.14 }), inner: fin('whiteCeramic', { color: '#eef1f2' }), edge: fin('chrome', { color: '#f2f0ec', rough: 0.08 }), family: 'céramique' },
  biscuit: { label: 'Biscuit', outer: fin('bisque', { color: '#e9e4da', color2: '#d9d2c4' }), inner: fin('whiteCeramic', { color: '#f1eee8' }), edge: fin('bisque', { color: '#e9e4da' }), family: 'céramique' },
  celadon: { label: 'Céladon craquelé', outer: fin('glaze', { color: '#9cc3ad', color2: '#4d6257', scale: 1.4 }), inner: fin('glaze', { color: '#a9ccb8', color2: '#58705f', scale: 1.4 }), edge: fin('bisque', { color: '#b89a7a', color2: '#9a7c5e' }), family: 'grès' },
  tenmoku: { label: 'Tenmoku', outer: fin('glaze', { color: '#231a17', color2: '#6a3a1c', rough: 0.22, scale: 2 }), inner: fin('glaze', { color: '#2a1e1a', color2: '#7a4520', rough: 0.2, scale: 2 }), edge: fin('bisque', { color: '#6b4a34', color2: '#4d3626' }), family: 'grès' },
  bleuCeleste: { label: 'Bleu céleste et or', outer: fin('whiteCeramic', { color: '#6fc3c8', rough: 0.14 }), inner: fin('whiteCeramic', { color: '#f4f1ea', rough: 0.16 }), edge: fin('polishedGold'), family: 'céramique' },
  rosePompadour: { label: 'Rose Pompadour et or', outer: fin('whiteCeramic', { color: '#e9a3b4', rough: 0.14 }), inner: fin('whiteCeramic', { color: '#f6f1ec', rough: 0.16 }), edge: fin('polishedGold'), family: 'céramique' },
  emailBleu: { label: 'Tôle émaillée', outer: fin('whiteCeramic', { color: '#2f5fa8', rough: 0.2 }), inner: fin('whiteCeramic', { color: '#eef0f0', rough: 0.2 }), edge: fin('blackCeramic', { color: '#15171c' }), family: 'émail' },
  emailBlanc: { label: 'Tôle émaillée blanche', outer: fin('whiteCeramic', { color: '#eceeed', rough: 0.2 }), inner: fin('whiteCeramic', { color: '#eceeed', rough: 0.2 }), edge: fin('blackCeramic', { color: '#1b2c52' }), family: 'émail' },
  noirOr: { label: 'Céramique noire à filet d’or', outer: fin('blackCeramic', { color: '#121216', rough: 0.14 }), inner: fin('blackCeramic', { color: '#16161a', rough: 0.14 }), edge: fin('polishedGold'), family: 'céramique' },
  fonte: { label: 'Fonte', outer: IRON, inner: IRON_IN, edge: IRON, family: 'fonte' },
  vermillon: { label: 'Laque vermillon', outer: fin('whiteCeramic', { color: '#b8261a', rough: 0.12 }), inner: fin('blackCeramic', { color: '#141011' }), edge: fin('blackCeramic', { color: '#141011' }), family: 'laque' },
  verreOr: { label: 'Verre à filet d’or', outer: fin('crystal', { color2: '#f2f6f4', rough: 0.02, dispersion: 0.2, attDist: 3 }), inner: fin('crystal', { color2: '#f2f6f4', rough: 0.02, dispersion: 0.2, attDist: 3 }), edge: fin('polishedGold'), family: 'verre' },
  verreBleu: { label: 'Verre bleuté', outer: fin('crystal', { color2: '#b9d6e8', rough: 0.02, dispersion: 0.2, attDist: 1.2 }), inner: fin('crystal', { color2: '#b9d6e8', rough: 0.02, dispersion: 0.2, attDist: 1.2 }), edge: fin('chrome', { color: '#f2f0ec' }), family: 'verre' },
};
export const METALS = { argent: SILVER, vermeil: VERMEIL, inox: STEEL, fonte: IRON };
export const TABLES = {
  lin: { label: 'Nappe de lin', ...fin('carbonMatte', { color: '#bfbcb3', color2: '#a39e93', rough: 0.96, aniso: 0, bump: 0.5, scale: 2.2, sheen: 0.25, sheenColor: '#ffffff', sheenRough: 0.8 }), kind: 'cloth', family: 'textile' },
  linBleu: { label: 'Lin bleu', ...fin('carbonMatte', { color: '#8fa3b5', color2: '#74889b', rough: 0.96, aniso: 0, bump: 0.5, scale: 2.2, sheen: 0.25, sheenColor: '#e8f0ff', sheenRough: 0.8 }), kind: 'cloth', family: 'textile' },
  velours: { label: 'Velours noir', ...fin('velvetNight', { color: '#0d0d0f', color2: '#060607', sheenColor: '#9aa0b0', sheen: 0.7, scale: 3 }), kind: 'velvet', family: 'textile' },
  zinc: { label: 'Zinc', ...fin('brushedSteel', { color: '#70757b', rough: 0.5, aniso: 0.3, bump: 0.3, scale: 0.6, smudge: 0.15 }), kind: 'metal', family: 'métal' },
  natte: { label: 'Natte tressée', ...fin('carbonMatte', { color: '#c9c092', color2: '#a89c6a', rough: 0.9, aniso: 0, bump: 0.9, scale: 0.55 }), kind: 'mat', family: 'textile' },
  laque: { label: 'Plateau de laque', ...fin('whiteCeramic', { color: '#8e1a13', color2: '#ffe29d', rough: 0.3, clearcoat: 0.25, ccRough: 0.4, smudge: 0.2 }), kind: 'lacquer', family: 'laque' },
  laqueNoire: { label: 'Laque noire', ...fin('blackCeramic', { color: '#0e0c0d', color2: '#ffe29d', rough: 0.3, clearcoat: 0.25, ccRough: 0.4, smudge: 0.2 }), kind: 'lacquer', family: 'laque' },
  marbre: { label: 'Marbre de Carrare', ...fin('marble', { color: '#e4e1db', color2: '#53565e', rough: 0.18 }), kind: 'marble', family: 'pierre' },
  marbreNoir: { label: 'Marbre noir', ...fin('marbleNoir', { color: '#131316', color2: '#d9d2c4', rough: 0.16 }), kind: 'marble', family: 'pierre' },
  ardoise: { label: 'Ardoise', ...fin('basalt', { color: '#3a3f47', color2: '#565c66', rough: 0.8, bump: 0.5, scale: 1.6 }), kind: 'slate', family: 'pierre' },
};
// ce qui rougit sans être du métal : les pierres du bol, les braises et la cendre du brasero
export const ELEMENTS = {
  pierres: { outer: fin('basalt', { label: 'Galet', color: '#4b4c50', color2: '#6a6b70', rough: 0.72, bump: 0.35, scale: 2.2 }), inner: fin('basalt', { color: '#4b4c50', color2: '#6a6b70', rough: 0.72 }), edge: fin('basalt', { color: '#4b4c50', color2: '#6a6b70', rough: 0.72 }) },
  braise: { outer: fin('basalt', { label: 'Charbon', color: '#0d0c0c', color2: '#1c1a19', rough: 0.9, bump: 0.6, scale: 3 }), inner: fin('basalt', { label: 'Cendre', color: '#6c6862', color2: '#8a857c', rough: 1, bump: 0.5, scale: 3 }), edge: fin('basalt', { color: '#0d0c0c', color2: '#1c1a19', rough: 0.9 }) },
};
export const TEAS = { noir: '#3d1508', vert: '#5f6a1c', menthe: '#7a6a1e', rooibos: '#5a1408', lait: '#b08a62', matcha: '#6f8a2e' };

// ── Humeurs ──────────────────────────────────────────────────────────────────
// Un décor chacune : mur (bg), support, lumière (direction, dureté, dosage),
// valeur, cadrage. accords : [corps, métal, support, thé]. families : poids
// du tirage des familles de récipient. cam : { az, el, dist, fov } du plan de base.
export const MOODS = {
  cinqHeures: {
    label: 'Cinq heures', env: 'overcast', envIntensity: [0.3, 0.38], bg: '#8793a0', wall: 0.55, keyK: 6200, key: { az: -2.3, el: 0.7, power: 560, penumbra: 1, angle: 0.55 }, rim: ['#dfe9ff', 300],
    accords: [['porcelaineOr', 'argent', 'lin', 'noir'], ['porcelainePlatine', 'argent', 'linBleu', 'noir'], ['biscuit', 'vermeil', 'lin', 'rooibos'], ['verreOr', 'argent', 'lin', 'menthe']],
    families: [['tasse', 5], ['theiere', 2], ['verre', 2], ['bol', 1]],
    cloud: { tint: '#f4f6fa', shade: '#59626e', ambient: 0.55 },
    cam: { az: 0.5, el: 0.36, dist: 5.5, fov: 30 },
    grade: { contrast: 1.04, saturation: 0.92, shadows: [0.94, 0.98, 1.06], highlights: [1.0, 1.0, 0.98] },
  },
  plaque: {
    label: 'Plaque sensible', env: 'night', envIntensity: [0.5, 0.7], bg: '#050506', wall: 0.0, keyK: 6500, key: { az: 2.6, el: 0.9, power: 240, penumbra: 0.6, angle: 0.5 }, rim: ['#ffffff', 420],
    accords: [['porcelainePlatine', 'argent', 'velours', 'noir'], ['noirOr', 'argent', 'velours', 'noir'], ['verreBleu', 'argent', 'velours', 'noir']],
    families: [['tasse', 3], ['verre', 3], ['bol', 2], ['theiere', 1]],
    cloud: { tint: '#e9e9ec', shade: '#1b1b1f', ambient: 0.12 },
    cam: { az: 0.0, el: 0.3, dist: 5.3, fov: 30 },
    grade: { contrast: 1.14, saturation: 0.0, shadows: [1, 1, 1], highlights: [1, 1, 1], exposure: 1.1 },
    bw: true,
  },
  comptoir: {
    label: 'Comptoir', env: 'softbox', envIntensity: [0.16, 0.22], bg: '#23282d', wall: 0.2, keyK: 5600, key: { az: -0.6, el: 1.25, power: 300, penumbra: 0.5, angle: 0.5 }, rim: ['#cfe0ff', 160],
    accords: [['emailBleu', 'inox', 'zinc', 'noir'], ['emailBlanc', 'inox', 'zinc', 'lait'], ['fonte', 'fonte', 'zinc', 'vert'], ['verreBleu', 'inox', 'zinc', 'menthe']],
    families: [['tasse', 3], ['theiere', 3], ['bol', 2], ['verre', 2]],
    cloud: { tint: '#eef1f4', shade: '#2e3238', ambient: 0.3 },
    cam: { az: -0.7, el: 0.62, dist: 5.3, fov: 30 },
    grade: { contrast: 1.1, saturation: 0.95, shadows: [0.92, 0.98, 1.08], highlights: [1.02, 1.0, 0.97] },
  },
  celadon: {
    label: 'Céladon', env: 'fogwhite', envIntensity: [0.36, 0.44], bg: '#c9cfbd', wall: 0.7, keyK: 5800, key: { az: 0.4, el: 1.3, power: 260, penumbra: 1, angle: 0.6 }, rim: ['#f4ffe9', 120],
    accords: [['celadon', 'vermeil', 'natte', 'vert'], ['celadon', 'argent', 'lin', 'matcha'], ['biscuit', 'vermeil', 'natte', 'matcha'], ['tenmoku', 'vermeil', 'natte', 'vert']],
    families: [['bol', 5], ['tasse', 2], ['theiere', 2], ['verre', 1]],
    cloud: { tint: '#f6f8f1', shade: '#69725f', ambient: 0.6 },
    cam: { az: 0.9, el: 0.42, dist: 6.0, fov: 28 },
    grade: { contrast: 1.0, saturation: 0.9, shadows: [0.96, 1.02, 0.98], highlights: [1.0, 1.0, 0.97] },
  },
  laque: {
    label: 'Laque', env: 'studio', envIntensity: [0.3, 0.42], bg: '#120b0b', wall: 0.05, keyK: 5200, key: { az: 1.9, el: 0.42, power: 520, penumbra: 0.5, angle: 0.5 }, rim: ['#ffd9c8', 260],
    accords: [['fonte', 'fonte', 'laque', 'vert'], ['noirOr', 'vermeil', 'laque', 'noir'], ['vermillon', 'vermeil', 'laqueNoire', 'noir'], ['tenmoku', 'vermeil', 'laque', 'vert']],
    families: [['theiere', 5], ['bol', 3], ['tasse', 2], ['verre', 1]],
    cloud: { tint: '#f0e6e2', shade: '#2a1c1c', ambient: 0.16 },
    cam: { az: -0.35, el: 0.32, dist: 5.8, fov: 30 },
    grade: { contrast: 1.1, saturation: 1.08, shadows: [1.04, 0.96, 0.96], highlights: [1.02, 1.0, 0.96] },
  },
  heureBleue: {
    label: 'Heure bleue', env: 'nightsky', envIntensity: [3.2, 4.2], bg: '#172644', wall: 0.35, keyK: 9000, key: { az: -2.6, el: 0.55, power: 200, penumbra: 0.9, angle: 0.55 }, rim: ['#8fb4ff', 260],
    accords: [['verreOr', 'vermeil', 'marbre', 'menthe'], ['porcelaineOr', 'argent', 'marbreNoir', 'noir'], ['bleuCeleste', 'vermeil', 'marbre', 'noir'], ['verreBleu', 'argent', 'ardoise', 'menthe']],
    families: [['verre', 5], ['tasse', 3], ['theiere', 1], ['bol', 2]],
    cloud: { tint: '#c9d8f4', shade: '#141d33', ambient: 0.3 },
    cam: { az: 0.25, el: 0.34, dist: 5.9, fov: 30 },
    grade: { contrast: 1.08, saturation: 1.05, shadows: [0.9, 0.97, 1.14], highlights: [1.0, 1.0, 1.02] },
  },
  sevres: {
    label: 'Sèvres', env: 'cyclo', envIntensity: [0.2, 0.26], bg: '#cf9aa8', wall: 0.8, keyK: 6000, key: { az: -1.2, el: 1.0, power: 420, penumbra: 0.9, angle: 0.55 }, rim: ['#fff1f4', 140],
    accords: [['bleuCeleste', 'vermeil', 'marbre', 'noir'], ['porcelaineOr', 'vermeil', 'marbre', 'rooibos'], ['bleuCeleste', 'vermeil', 'marbre', 'lait']],
    families: [['tasse', 5], ['theiere', 3], ['bol', 1], ['verre', 1]],
    cloud: { tint: '#fbf3f5', shade: '#6d5f6c', ambient: 0.5 },
    cam: { az: -0.9, el: 0.4, dist: 5.5, fov: 30 },
    grade: { contrast: 1.0, saturation: 1.0, shadows: [0.98, 0.97, 1.03], highlights: [1.01, 1.0, 0.99] },
  },
};

// accords compatibles avec une famille de récipient (un verre ne se fait pas en fonte)
const fits = (body, family, variant) => {
  const f = BODIES[body].family;
  if (VARIANTS[variant].glass) return f === 'verre';
  if (VARIANTS[variant].cast) return f === 'fonte';
  if (f === 'verre' || f === 'fonte') return false;
  if (f === 'émail') return family !== 'bol' || variant === 'creux';
  return true;
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rv = rng.fork('vessel'), ra = rng.fork('accord'), rc = rng.fork('camera'), rl = rng.fork('light'), rb = rng.fork('bolt'), rk = rng.fork('cloud'), rf = rng.fork('film');

  // ── récipient : famille, variante, puis un accord qui lui convient ──
  let family = overrides.family ?? rv.weighted(M.families);
  let variant = overrides.variant ?? rv.pick(FAMILIES[family].variants);
  let accords = M.accords.filter((a) => fits(a[0], family, variant));
  if (!accords.length) {
    // (aucun accord de l'humeur pour cette variante : une autre variante, puis une autre famille)
    const all = Object.keys(VARIANTS).filter((v) => M.accords.some((a) => fits(a[0], VARIANTS[v].family, v)));
    const same = all.filter((v) => VARIANTS[v].family === family);
    variant = rv.pick(same.length ? same : all);
    family = VARIANTS[variant].family;
    accords = M.accords.filter((a) => fits(a[0], family, variant));
  }
  const [bodyKey, metalKey, tableKey, teaKey] = ra.pick(accords);
  const V = VARIANTS[variant];
  const vessel = {
    family, variant, flare: r2(rv.range(0, 1)),
    flutes: !V.glass && !V.cast && family !== 'bol' && rv.chance(0.4) ? rv.pick([16, 20, 24, 32]) : 0,
    mastAz: r2(rv.range(2.0, 2.9) * rv.sign()), // (la machine : son mât, ses pierres — vus de trois quarts)
    turn: r2(rv.range(-0.5, 0.5)),               // (l'anse ou le bec, tournés par rapport à la caméra)
    body: bodyKey, metal: metalKey, tea: TEAS[teaKey],
    heater: V.heater, mast: rng.fork('heater').int(0, 1),
  };

  // ── nuage ──
  const kind = rk.pick(['bourgeonnant', 'tour', 'enclume', 'nappe']);
  const K = { bourgeonnant: [1.0, 0.72, 0.5], tour: [0.8, 1.0, 0.35], enclume: [0.95, 0.9, 1.0], nappe: [1.2, 0.55, 0.7] }[kind];
  const cloud = {
    kind, radius: r2(K[0] * rk.range(0.92, 1.08)), height: r2(K[1] * rk.range(0.92, 1.08)), anvil: r2(K[2]),
    gap: r2(rk.range(0.8, 1.05)),        // de la pointe la plus haute à la base du nuage
    off: [r2(rk.range(-0.12, 0.12)), r2(rk.range(-0.08, 0.08))],
    seed: r2(rk.range(0, 4)), density: r2(rk.range(0.9, 1.1)), drift: rk.pick([1, -1]), puffs: rk.int(6, 10),
    ...M.cloud,
  };

  // ── éclair ──
  const kindB = FAMILIES[family].bolt;
  const bolt = {
    family: kindB, seed: `${seed}`,
    eta: r2({ strike: rb.range(2.6, 4.2), fork: rb.range(2.4, 3.2), upward: rb.range(2.6, 3.4), spider: rb.range(3.0, 4.2) }[kindB]),
    active: rb.int(26, 40), rough: r2(rb.range(0.1, 0.17)),
    forks: kindB === 'fork' ? rb.pick([1, 2, 2, 3]) : 0,
    root: [r2(rb.range(-0.3, 0.3)), r2(rb.range(-0.25, 0.25))], // (départ, sous la base du nuage, en parts de son rayon)
    color: '#bcd0ff', core: '#ffffff', power: r2(rb.range(0.9, 1.15)),
  };
  // ── film : les arcs (réamorçages) et les lueurs de la charge ──
  const nStrokes = kindB === 'fork' ? 1 + bolt.forks : rf.int(3, 5);
  const strokes = [];
  let t = 0;
  for (let j = 0; j < nStrokes; j++) {
    strokes.push({ t: r3(t), amp: r2(j === 0 ? 1 : rf.range(0.45, 0.8) * (1 - 0.08 * j)), path: kindB === 'fork' ? j : 0 });
    t += rf.range(0.24, 0.42);
  }
  const nFl = rf.int(3, 4);
  const flickers = Array.from({ length: nFl }, (_, i) => ({
    u: r3(TIMES.flicker[0] + ((TIMES.flicker[1] - TIMES.flicker[0]) * (i + rf.range(0.1, 0.6))) / nFl),
    amp: r2(rf.range(0.5, 1) * (0.5 + (0.5 * i) / nFl)), p: [r2(rf.range(-0.5, 0.5)), r2(rf.range(0.25, 0.6)), r2(rf.range(-0.4, 0.4))],
  }));
  vessel.stones = 1 + bolt.forks; // (bol : une pierre par arc)
  const film = { duration: overrides.duration ?? 24, strokes, flickers, drop: 0.022 };

  // ── caméra : le plan de base de l'humeur, retouché ──
  const camera = {
    az: r2(M.cam.az + rc.range(-0.25, 0.25)), el: r2(M.cam.el + rc.range(-0.03, 0.05)), dist: r2(M.cam.dist * rc.range(0.96, 1.06)), fov: M.cam.fov,
    push: r2(rc.range(0.05, 0.09)), arc: r2(rc.range(0.06, 0.14) * rc.sign()), tilt: r2(rc.range(-0.02, 0.03)), rise: r2(rc.range(0.02, 0.08)), sway: r2(rc.range(0.015, 0.035)),
    dip: r2(rc.range(0.2, 0.28)), dipEl: r2(rc.range(0.05, 0.09)), dipIn: r2(rc.range(0.1, 0.14)), // (après la jonction : la caméra descend vers la machine)
    target: [0, 1, 0], // (réglée sur le récipient et son nuage au chargement : voir layout())
  };

  return {
    v: 1, seed, mood,
    loop: { duration: film.duration },
    vessel, cloud, bolt, film, camera,
    light: {
      key: { color: kelvinToHex(M.keyK + rl.range(-200, 200)), intensity: r2(M.key.power * rl.range(0.92, 1.08)), az: r2(M.key.az + rl.range(-0.15, 0.15)), el: r2(M.key.el + rl.range(-0.05, 0.05)), angle: M.key.angle, penumbra: M.key.penumbra },
      rim: { color: M.rim[0], intensity: r2(M.rim[1] * rl.range(0.9, 1.1)), az: r2(M.key.az + Math.PI + rl.range(-0.4, 0.4)), el: r2(rl.range(0.35, 0.6)) },
      flash: r2(rl.range(0.9, 1.1)), // (dosage de la lumière de l'éclair sur la scène)
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envIntensity)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, wall: M.wall },
    table: { key: tableKey, finish: { ...TABLES[tableKey] } },
    finish: { body: structuredClone(BODIES[bodyKey]), metal: { ...METALS[metalKey] } },
    grade: { ...M.grade },
  };
}

// Disposition : où sont le nuage, la racine et la pointe de l'éclair, la cible
// de la caméra — à partir de ce que le récipient construit dit de lui (meta).
// Fonction pure de la recette et de meta : le worker, la scène et les tests
// trouvent les mêmes nombres.
export function layout(R, meta) {
  const topMost = Math.max(meta.top, meta.strike ? meta.strike[1] : 0);
  // (le récipient tourne sur lui-même de vessel.turn : la pointe aussi)
  const ca = Math.cos(R.vessel.turn), sa = Math.sin(R.vessel.turn);
  const rot = (p) => [p[0] * ca + p[2] * sa, p[1], -p[0] * sa + p[2] * ca];
  const strike = meta.strike ? rot(meta.strike) : null;
  const base = topMost + R.cloud.gap;
  const c = [R.cloud.off[0], base, R.cloud.off[1]];
  const steam = { p: rot(meta.steam.p), r: meta.steam.r };
  const up = R.bolt.family === 'upward';
  const pins = meta.heater?.pins?.map(rot) ?? null; // (bol : les pierres, une par arc)
  const h = (base - (strike ? strike[1] : pins ? pins[0][1] : meta.liquid.y)) / 17;
  const root = up ? strike : [c[0] + R.bolt.root[0] * R.cloud.radius * 0.6, base + 0.06, c[2] + R.bolt.root[1] * R.cloud.radius * 0.6];
  const obstacles = meta.obstacles.map((o) => (o.type === 'ellipsoid' ? { ...o, c: rot(o.c) } : o));
  const spec = {
    family: R.bolt.family, seed: R.bolt.seed, h, eta: R.bolt.eta, active: R.bolt.active, beta: 0.5,
    root, obstacles,
    ...(R.bolt.family === 'strike' ? { targets: [strike], field: 'down', box: { r: 1.3, y0: strike[1] - h * 1.2, y1: base + 0.1 } } : {}),
    ...(R.bolt.family === 'spider' ? { targets: [strike], field: 'down', slab: { y0: base - 0.01, y1: base + 0.1, count: 130, r: R.cloud.radius * 0.8 }, box: { r: Math.max(R.cloud.radius * 0.8, Math.hypot(strike[0], strike[2]) + 0.25), y0: strike[1] - h * 1.2, y1: base + 0.12 } } : {}),
    ...(R.bolt.family === 'fork' ? { targets: [pins[0]], pins, bowl: meta.liquid.r * 0.9, forks: pins.length - 1, field: 'down', beta: 0.5, box: { r: 1.3, y0: pins[0][1] - h * 1.2, y1: base + 0.1 } } : {}),
    ...(R.bolt.family === 'upward' ? { targets: [[c[0], base + 0.3, c[2]]], stopAt: 300, field: 'up', beta: 0.42, box: { r: Math.max(R.cloud.radius * 0.75, Math.hypot(strike[0], strike[2]) + 0.3), y0: strike[1], y1: base + 0.32 } } : {}),
  };
  const mid = (base + R.cloud.height) * 0.5;
  // la simulation du panache : unité = hauteur de la source au niveau de condensation
  const span = Math.max(0.3, base - steam.p[1]);
  const plume = { r0: r2(Math.min(0.24, Math.max(0.13, (steam.r / span) * 0.7))), top: r2(Math.min(2.15, Math.max(1.4, 1 + R.cloud.height / span))), puffs: R.cloud.puffs ?? 8, gamma: 22, heat: 5, mix: 0.2 };
  return { base, center: c, strike, pins, steam, spec, plume, span, h, topMost, target: [0, mid, 0], frame: base + R.cloud.height };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.vessel?.family, variant: R.vessel?.variant });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  // (liens d'avant les machines : la cuillère est devenue un mât)
  for (const k of ['heater', 'mast', 'stones', 'mastAz']) if (R.vessel[k] === undefined) R.vessel[k] = k === 'mastAz' ? (R.vessel.spoonAz ?? D.vessel.mastAz) : D.vessel[k];
  for (const k of ['dip', 'dipEl', 'dipIn']) if (R.camera[k] === undefined) R.camera[k] = D.camera[k];
  if (R.table && !R.table.finish.kind) R.table.finish.kind = TABLES[R.table.key]?.kind ?? 'cloth';
  return R;
}
