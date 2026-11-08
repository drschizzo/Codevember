// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';
import { MEMBRANES, MEMBRANE_DEFAULTS, LOOK_KEYS, PHYS_KEYS } from './membranes.js';

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
export const VERSION = 1;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Armatures ────────────────────────────────────────────────────────────────
export const ARMATURES = {
  calyx: { label: 'Calice (sépales)' },
  iris: { label: 'Iris (lames vrillées)' },
  pod: { label: 'Gousse (mâchoires)' },
  ribs: { label: 'Ombrelle (baleines)' },
  crown: { label: 'Couronne d’épines' },
  cage: { label: 'Cage polyédrique' },
};
export const ORDERS = { 'Ensemble': 'none', 'En spirale': 'spiral', 'Alternées': 'alternate', 'Au hasard': 'random' };
export const POLYS = { 'Icosaèdre': 'ico', 'Dodécaèdre': 'dodeca', 'Octaèdre': 'octa' };

export function makeArmature(kind, rng) {
  const A = {
    kind, seed: rng.int(0, 1e6), n: 5, width: 0.88, tip: 0.3, hinge: 120, angle: 110, thick: 0.03, ridge: 1.2,
    // déploiement (fraction de l'éclosion) : assauts puis ouverture
    dur: r2(rng.range(0.62, 0.78)), struggle: rng.int(2, 4), strAmp: r2(rng.range(0.28, 0.42)), strFrac: r2(rng.range(0.5, 0.62)), stagger: r2(rng.range(0, 0.22)), order: rng.pick(['none', 'spiral', 'spiral', 'alternate', 'random']), jitter: r2(rng.range(0, 0.15)),
    twist: 0, tilt: 0, spread: 75, ext: 0.3, poly: 'ico', swell: 0, head: 1.4,
  };
  switch (kind) {
    case 'calyx': Object.assign(A, { n: rng.int(3, 8), width: r2(rng.range(0.78, 0.95)), tip: r2(rng.range(0.18, 0.45)), hinge: rng.int(112, 128), angle: rng.int(95, 132), thick: r3(rng.range(0.022, 0.04)), ridge: r2(rng.range(0, 1.8)) }); break;
    case 'iris': Object.assign(A, { n: rng.int(5, 9), width: r2(rng.range(0.84, 0.93)), tip: r2(rng.range(0.15, 0.3)), hinge: rng.int(112, 124), angle: rng.int(24, 28), thick: r3(rng.range(0.02, 0.032)), ridge: r2(rng.range(0, 1)), twist: r2(rng.sign() * rng.range(0.4, 1.0)), tilt: r2(rng.range(1.32, 1.45)), swell: r2(rng.range(0, 0.04)), stagger: 0 }); break; // (un diaphragme : toutes les lames ensemble)
    case 'pod': Object.assign(A, { n: rng.int(2, 3), width: r2(rng.range(0.9, 0.97)), tip: r2(rng.range(0.08, 0.2)), hinge: rng.int(118, 132), angle: rng.int(100, 125), thick: r3(rng.range(0.035, 0.05)), ridge: r2(rng.range(1, 2.2)), stagger: r2(rng.range(0, 0.08)) }); break;
    case 'ribs': Object.assign(A, { n: rng.int(8, 16), hinge: rng.int(112, 126), angle: rng.int(95, 125), thick: r3(rng.range(0.02, 0.03)) }); break;
    case 'crown': Object.assign(A, { n: rng.int(10, 22), spread: rng.int(50, 75), ext: r2(rng.range(0.12, 0.22)), angle: rng.int(45, 85), thick: r3(rng.range(0.022, 0.034)), hinge: rng.int(108, 120), head: r2(rng.range(1.3, 2)) }); break;
    case 'cage': Object.assign(A, { poly: rng.pick(['ico', 'ico', 'dodeca', 'octa']), inflate: r2(rng.range(1.5, 2.6)), thick: r3(rng.range(0.022, 0.036)), hinge: 180, dur: r2(rng.range(0.6, 0.75)), stagger: 0 }); break;
    default: break;
  }
  return A;
}

// ── Humeurs ──────────────────────────────────────────────────────────────────
export const MOODS = {
  organique: {
    label: 'Organique', env: 'atelier', bg: '#0a0504', keyK: 3300, back: ['#ff8a5c', '#ffb07a'], core: '#ffb27a',
    membranes: { chorion: 5, wax: 2, latex: 1 }, sets: ['brassVelvet', 'goldLeaf', 'bronze', 'kintsugi', 'nacre', 'urushi'],
    arms: { calyx: 4, iris: 2, pod: 2, ribs: 2, crown: 1.5, cage: 1 },
  },
  clinique: {
    label: 'Clinique', env: 'cyclo', bg: '#d8d5cf', keyK: 6500, back: ['#ffffff', '#eef4ff'], core: '#ffffff', envIntensity: [0.25, 0.4], light: 0.7,
    membranes: { wax: 3, gel: 2, silk: 2, chorion: 1 }, sets: ['ceramicWhite', 'chrome', 'kintsugi', 'guillocheSilver'],
    arms: { calyx: 2, iris: 2, pod: 1, ribs: 2, crown: 2, cage: 3 },
  },
  abysses: {
    label: 'Abysses', env: 'abyss', bg: '#010508', keyK: 8000, back: ['#3fd8ff', '#2a8cff'], core: '#5ff0ff',
    membranes: { gel: 4, bubble: 2, chorion: 1 }, sets: ['titanium', 'carbon', 'blackSteel', 'chrome', 'obsidian'],
    arms: { calyx: 1, iris: 3, pod: 1, ribs: 2, crown: 3, cage: 2 },
  },
  joaillerie: {
    label: 'Joaillerie', env: 'studio', bg: '#060505', keyK: 4200, back: ['#ffd9a0', '#ffffff'], core: '#ffd28a',
    membranes: { goldLeaf: 4, latexBlack: 2, wax: 1 }, sets: ['nero', 'guilloche', 'urushi', 'ceramicBlack', 'guillocheRuby', 'goldLeaf'],
    arms: { calyx: 3, iris: 3, pod: 2, ribs: 1, crown: 1, cage: 2 },
  },
  atelier: {
    label: 'Atelier', env: 'atelier', bg: '#0b0907', keyK: 3600, back: ['#ffc070', '#ffe0b0'], core: '#ffc88a',
    membranes: { vellum: 4, silk: 2, wax: 1 }, sets: ['brassVelvet', 'marble', 'damascus', 'verdigris', 'bronze'],
    arms: { calyx: 2, iris: 1, pod: 2, ribs: 3, crown: 1, cage: 3 },
  },
  irise: {
    label: 'Irisé', env: 'night', bg: '#04050a', keyK: 7000, back: ['#9fd0ff', '#ff9fe0', '#a0ffd8'], core: '#e0d0ff',
    membranes: { bubble: 4, silk: 2, gel: 2 }, sets: ['titanium', 'nacre', 'soap', 'anodizedDiamond', 'chrome'],
    arms: { calyx: 2, iris: 3, pod: 1, ribs: 2, crown: 2, cage: 2 },
  },
  rouge: {
    label: 'Rouge', env: 'studio', bg: '#070303', keyK: 5200, back: ['#ff4030', '#ffd0b0'], core: '#ff7050',
    membranes: { latex: 4, latexBlack: 2, chorion: 2 }, sets: ['obsidian', 'blackSteel', 'guillocheRuby', 'chrome', 'ceramicBlack'],
    arms: { calyx: 3, iris: 2, pod: 3, ribs: 1, crown: 2, cage: 1 },
  },
};

export function finishesFor(setKey, rng) {
  const set = SETS[setKey];
  const pick = (k) => ({ ...FINISHES[k], preset: k });
  const out = { outer: pick(set.outer), inner: pick(set.inner), edge: pick(set.edge), wear: set.wear || 0 };
  if (set.outer === 'anodized') { const t = rng.pick(TINTS.anodized); out.outer.color = t; out.inner.color = t; }
  if (set.outer === 'glaze') out.outer.color = rng.pick(TINTS.glaze);
  return out;
}

// une membrane tirée d'un modèle du catalogue, avec un peu de variation
export function makeMembrane(key, rng) {
  const base = { ...MEMBRANE_DEFAULTS, ...MEMBRANES[key] };
  const look = {}, phys = {};
  for (const k of LOOK_KEYS) look[k] = base[k];
  for (const k of PHYS_KEYS) phys[k] = base[k];
  const v = (x, a) => r3(x * (1 + (rng.next() * 2 - 1) * a));
  look.density = v(look.density, 0.2);
  look.blur = r2(Math.min(1, v(look.blur, 0.2)));
  look.mottleScale = v(look.mottleScale, 0.3);
  phys.strength = v(phys.strength, 0.25);
  phys.curl = v(phys.curl, 0.3);
  phys.warp = v(phys.warp, 0.3);
  phys.curlSign = rng.chance(0.75) ? 1 : -1;
  return { key, look, phys };
}

export function makeLevel(rng, mood, opts = {}) {
  const M = MOODS[mood];
  const kind = opts.kind ?? rng.weighted(Object.entries(M.arms));
  const memKey = opts.membrane ?? rng.weighted(Object.entries(M.membranes));
  const set = rng.pick(M.sets);
  const mem = makeMembrane(memKey, rng);
  return {
    seed: `${rng.int(0, 1e9)}`,
    arm: makeArmature(kind, rng),
    armSet: set, armFinish: finishesFor(set, rng),
    membrane: memKey, look: mem.look, phys: mem.phys,
    motion: { roll: r3(rng.range(0, Math.PI * 2)) },
  };
}

export const SIM_DEFAULTS = { res: 44, frames: 160, substeps: 16, duration: 3.6, settle: 50, iters: 6 };

// ── Scène ────────────────────────────────────────────────────────────────────
export function generate(seed, opts = {}) {
  const rng = createRng(seed);
  const mood = opts.mood && MOODS[opts.mood] ? opts.mood : rng.weighted([['organique', 4], ['clinique', 1.5], ['abysses', 2], ['joaillerie', 2], ['atelier', 2], ['irise', 1.5], ['rouge', 2]]);
  const M = MOODS[mood];
  const N = opts.levels ?? rng.weighted([[2, 1], [3, 4], [4, 1.5]]);
  const levels = [];
  // des armatures différentes d'une couche à l'autre
  const used = new Set();
  // une matière dominante (palette cohérente), parfois une seconde
  const main = rng.weighted(Object.entries(M.membranes)), second = rng.weighted(Object.entries(M.membranes));
  for (let i = 0; i < N; i++) {
    let kind;
    for (let k = 0; k < 6; k++) { kind = rng.weighted(Object.entries(M.arms)); if (!used.has(kind)) break; }
    used.add(kind);
    levels.push(makeLevel(rng, mood, { kind, membrane: i > 0 && rng.chance(0.35) ? second : main }));
  }
  const light = M.light ?? 1;
  const R = {
    v: VERSION, seed, mood,
    loop: { beat: r2(rng.range(6.5, 9)) }, // secondes par couche
    nest: { ratio: r2(rng.range(0.42, 0.5)), open: r2(rng.range(2.25, 2.5)), end: -0.35, spin: r2(rng.sign() * rng.range(0.15, 0.45)), fade: [-0.95, -0.2] },
    chor: { slow: r2(rng.range(0.35, 0.75)), width: r2(rng.range(0.3, 0.45)), at: 1.45 },
    camera: { fov: r2(rng.range(34, 44)), sway: r2(rng.range(0.1, 0.5)), roll: r2(rng.range(-0.2, 0.2)), rollTurns: rng.pick([0, 0, 1, -1]) },
    sim: { ...SIM_DEFAULTS },
    levels,
    key: { color: kelvinToHex(M.keyK), intensity: r2(rng.range(0.8, 1.4) * light), x: r2(rng.range(-0.9, -0.3)), y: r2(rng.range(0.4, 0.9)), angle: 0.7, penumbra: 0.8, soft: 4 },
    back: { color: rng.pick(M.back), intensity: r2(rng.range(0.5, 1.1) * light), x: r2(rng.range(-0.3, 0.3)), y: r2(rng.range(-0.2, 0.4)), angle: 0.5, soft: 5 },
    core: { color: M.core, intensity: r2(rng.range(0.04, 0.1)), decay: 0.5, glow: r2(rng.range(3, 7)) },
    env: { preset: M.env, intensity: r2(rng.range(...(M.envIntensity ?? [0.5, 0.9]))), rotation: r2(rng.range(0, Math.PI * 2)) },
    bg: M.bg,
    fog: { near: 2.2, far: 7 },
  };
  // le ralenti tombe sur la rupture (fin des assauts, en moyenne)
  const tTear = levels.reduce((s, l) => s + l.arm.dur * (l.arm.strFrac ?? 0) + 0.05, 0) / levels.length;
  R.chor.at = r2(R.nest.open - (R.nest.open - R.nest.end) * tTear);
  return R;
}

// une recette d'une version antérieure (lien partagé)
export function upgrade(R) {
  R.sim = { ...SIM_DEFAULTS, ...R.sim };
  for (const lv of R.levels) {
    lv.look = { ...MEMBRANE_DEFAULTS, ...MEMBRANES[lv.membrane], ...lv.look };
    lv.phys = { ...MEMBRANE_DEFAULTS, ...MEMBRANES[lv.membrane], ...lv.phys };
  }
  return R;
}
export { MEMBRANES };
