// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Chaque tirage a son propre flux (rng.fork('…')). Les sables ne sont jamais
// tirés couche par couche : un sable est un accord composé à la main (quatre
// tons de strates, le ton des dépôts, celui des grains sombres, celui de
// l'eau chargée) ; la stratigraphie choisit l'ordre et les épaisseurs.
import { createRng } from './rng.js';
import { FAMILIES, familySpec, MAX_LAYERS } from './gen/table.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
const r4 = (x) => Math.round(x * 10000) / 10000 || 0;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Les sables (accords) ─────────────────────────────────────────────────────
// tones : quatre tons de strates (sRGB) ; deposit : le sable redéposé (un
// mélange trié, un peu plus clair) ; grain : les minéraux sombres ; mud :
// l'eau chargée de ce sable.
export const SANDS = {
  silice: { label: 'Silice et kaolin', tones: ['#d8cdb9', '#b3a690', '#ece3d2', '#8d8478'], deposit: '#d6cab4', grain: '#3b342c', mud: '#a2937a' },
  gres: { label: 'Grès rouge', tones: ['#b95d3a', '#d79c66', '#e9d4b4', '#8f4430'], deposit: '#c98a5e', grain: '#3a1d14', mud: '#8a5236' },
  basalte: { label: 'Basalte', tones: ['#3d3a37', '#6e6963', '#a49b8e', '#28292a'], deposit: '#5b5650', grain: '#141414', mud: '#4c4842' },
  ocres: { label: 'Ocres', tones: ['#d7a243', '#c46d2f', '#a3442d', '#7a4b58'], deposit: '#c98d48', grain: '#3a2516', mud: '#94602e' },
  limon: { label: 'Limon', tones: ['#a99a83', '#7d6c56', '#c9b796', '#5c5045'], deposit: '#a19279', grain: '#2b241d', mud: '#6f604c' },
  glauconie: { label: 'Glauconie et craie', tones: ['#6e7a5b', '#dad6c6', '#505b45', '#a9ad92'], deposit: '#8f9479', grain: '#1f2419', mud: '#626850' },
};

// ── Les stratigraphies ───────────────────────────────────────────────────────
// Une couche : { bottom (m sous la surface de départ), hard, tone (0–3) }
export const STRATA = {
  fines: { label: 'Lits fins réguliers' },
  corniches: { label: 'Bancs durs et tendres' },
  chapeau: { label: 'Chapeau dur' },
  uniforme: { label: 'Sable uniforme' },
};
function makeStrata(kind, rs) {
  const L = [];
  let z = 0;
  const push = (th, hard, tone) => { z += th; L.push({ bottom: r4(z), hard: r2(hard), tone }); };
  if (kind === 'fines') {
    const seq = [0, 1, 2, 1, 0, 3];
    for (let k = 0; L.length < MAX_LAYERS - 1; k++) push(rs.range(0.0035, 0.007), rs.range(0.05, 0.25), seq[k % seq.length]);
  } else if (kind === 'corniches') {
    for (let k = 0; L.length < MAX_LAYERS - 1; k++) {
      const hardBed = k % 2 === 1;
      push(hardBed ? rs.range(0.003, 0.005) : rs.range(0.008, 0.016), hardBed ? rs.range(0.6, 0.8) : rs.range(0.0, 0.15), hardBed ? 2 : k % 4 === 0 ? 0 : 1);
    }
  } else if (kind === 'chapeau') {
    push(rs.range(0.006, 0.01), 0.82, 2);
    for (let k = 0; L.length < MAX_LAYERS - 1; k++) push(rs.range(0.006, 0.012), rs.range(0.0, 0.2), [0, 1, 3][k % 3]);
  } else {
    push(0.5, 0.1, 0);
  }
  L.push({ bottom: 1, hard: 0.2, tone: 3 });
  return L;
}

// ── Les humeurs (décors) ─────────────────────────────────────────────────────
// env : studio HDR (scene/env.js) ; bg : fond et brume ; key : lampe
// principale (kind 'sun' : lointaine, ombres franches ; 'lamp' : proche,
// cône ; az / el en radians, autour du bac ; K : température ; lux :
// éclairement visé sur le sable, réglé au posemètre) ; fill : appoint ; rim :
// contre-jour ; floor : sol du lieu ; grade : étalonnage. Les azimuts sont
// donnés pour une caméra du côté +Z du bac (cos az < 0 : la lumière vient de
// l'autre côté, contre-jour ou de biais) ; ils sont réfléchis quand la
// caméra vole de l'autre côté. Le sujet est un relief de quelques mm : chaque
// humeur garde une lampe principale assez basse pour l'ombrer (au plus ~55°
// au-dessus du sable ; sous une lumière zénithale, le paysage disparaissait).
export const MOODS = {
  laboratoire: {
    label: 'Laboratoire', env: 'lab', bg: '#6d6f71', floor: '#5a5b5c',
    key: { kind: 'lamp', az: -2.2, el: 0.62, dist: 2.4, K: 5200, lux: 4.2, angle: 0.55, pen: 0.8 },
    fill: { az: 0.9, el: 0.9, K: 6000, lux: 0.5 }, rim: { az: 2.6, el: 0.45, K: 6500, lux: 0.5 },
    envI: [0.3, 0.4], grade: { contrast: 1.02, saturation: 0.95, shadows: [0.97, 1.0, 1.04], highlights: [1.02, 1.0, 0.98], exposure: 1 },
  },
  finDeJour: {
    label: 'Fin de jour', env: 'window', bg: '#1a1410', floor: '#2b231c',
    key: { kind: 'sun', az: -2.45, el: 0.24, dist: 6, K: 4300, lux: 7, angle: 0.18, pen: 0.25 },
    fill: { az: 2.4, el: 0.7, K: 7500, lux: 0.25 }, rim: { az: 2.8, el: 0.3, K: 5200, lux: 0.4 },
    envI: [0.25, 0.35], grade: { contrast: 1.08, saturation: 1.02, shadows: [0.92, 0.98, 1.08], highlights: [1.06, 1.0, 0.9], exposure: 1 },
  },
  rasante: {
    label: 'Lampe rasante', env: 'dark', bg: '#060606', floor: '#0e0d0c',
    key: { kind: 'lamp', az: 1.57, el: 0.16, dist: 2.2, K: 5000, lux: 14, angle: 0.5, pen: 0.6 },
    fill: { az: -1.6, el: 0.9, K: 6000, lux: 0.08 }, rim: { az: 3.0, el: 0.2, K: 6000, lux: 0.3 },
    envI: [0.12, 0.18], grade: { contrast: 1.12, saturation: 0.98, shadows: [0.96, 0.98, 1.04], highlights: [1.03, 1.0, 0.96], exposure: 1 },
  },
  cyclorama: {
    label: 'Cyclorama', env: 'cyclo', bg: '#e9e7e2', floor: '#dcdad5',
    key: { kind: 'lamp', az: -1.9, el: 0.6, dist: 2.6, K: 5600, lux: 3.3, angle: 0.7, pen: 0.65 },
    fill: { az: 1.2, el: 1.0, K: 6000, lux: 0.9 }, rim: { az: 3.0, el: 0.5, K: 6000, lux: 0.4 },
    envI: [0.32, 0.42], grade: { contrast: 0.98, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1], exposure: 1 },
  },
  verriere: {
    label: 'Verrière', env: 'overcast', bg: '#9aa3a8', floor: '#6e7275',
    key: { kind: 'lamp', az: 0.4, el: 0.7, dist: 3, K: 6800, lux: 2.4, angle: 0.8, pen: 0.8 },
    fill: { az: 2.8, el: 1.0, K: 7000, lux: 0.6 }, rim: { az: -2, el: 0.6, K: 6500, lux: 0.3 },
    envI: [0.7, 0.9], grade: { contrast: 1.0, saturation: 0.92, shadows: [0.95, 1.0, 1.06], highlights: [1.0, 1.0, 1.02], exposure: 1 },
  },
  contreJour: {
    label: 'Contre-jour', env: 'dark', bg: '#08090b', floor: '#101112',
    key: { kind: 'lamp', az: 3.0, el: 0.32, dist: 2.4, K: 5600, lux: 7, angle: 0.6, pen: 0.7 },
    fill: { az: 0.1, el: 0.8, K: 6000, lux: 0.35 }, rim: { az: 1.2, el: 0.3, K: 6000, lux: 0.4 },
    envI: [0.15, 0.2], grade: { contrast: 1.1, saturation: 0.96, shadows: [0.95, 0.99, 1.06], highlights: [1.04, 1.0, 0.96], exposure: 1 },
  },
  midi: {
    label: 'Midi', env: 'clearsky', bg: '#c9d3dc', floor: '#9b9286',
    key: { kind: 'sun', az: -2.6, el: 0.95, dist: 6, K: 5800, lux: 9.9, angle: 0.15, pen: 0.2 },
    fill: { az: 0.6, el: 1.0, K: 9000, lux: 0.8 }, rim: { az: 1.5, el: 0.4, K: 6000, lux: 0.2 },
    envI: [0.28, 0.36], grade: { contrast: 1.04, saturation: 1.0, shadows: [0.95, 0.99, 1.06], highlights: [1.02, 1.0, 0.97], exposure: 1 },
  },
};

// sables favoris par humeur (une scène se lit d'abord par son décor)
const SAND_PREFS = {
  laboratoire: ['limon', 'gres', 'ocres', 'glauconie'],
  finDeJour: ['gres', 'ocres', 'silice'],
  rasante: ['gres', 'silice', 'glauconie', 'ocres'],
  cyclorama: ['basalte', 'glauconie', 'gres'],
  verriere: ['limon', 'glauconie', 'ocres'],
  contreJour: ['silice', 'limon', 'gres'],
  midi: ['ocres', 'gres', 'silice'],
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const family = overrides.family ?? rng.fork('family').pick(Object.keys(FAMILIES));
  const rs = rng.fork('sand');
  const sandKey = overrides.sand ?? rs.pick(SAND_PREFS[mood]);
  const strataKind = overrides.strata ?? rs.pick(['fines', 'corniches', 'chapeau', 'fines', 'corniches']);
  const rf = rng.fork('form');
  const t = {
    srcY: r2(rf.range(0.24, 0.4)), notchY: r2(rf.range(0.22, 0.42)), tilt: r4(rf.range(-0.006, 0.006)),
    vee: r4(rf.range(0.005, 0.011)), steps: rf.pick([2, 2, 3]),
  };
  const rl = rng.fork('light');
  const light = {
    key: { ...M.key, az: r2(M.key.az + rl.range(-0.25, 0.25)), el: r2(M.key.el * rl.range(0.9, 1.1)) },
    fill: { ...M.fill }, rim: { ...M.rim },
  };
  const rc = rng.fork('camera');
  return {
    v: 1, seed, mood, family,
    loop: { duration: rng.fork('loop').pick([44, 48, 52]) },
    sand: { key: sandKey, ...SANDS[sandKey] },
    strataKind,
    strata: makeStrata(strataKind, rng.fork('strata')),
    form: t,
    seedN: (rng.fork('n').int(1, 99999)),
    light,
    env: { preset: M.env, intensity: r2(rl.range(...M.envI)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg },
    floor: M.floor,
    grade: { ...M.grade },
    camera: { fov: r2(rc.range(26, 34)), side: rc.pick([1, -1]), height: r2(rc.range(0.85, 1.15)) },
  };
}

// La spécification de la simulation (gen/table.js) d'une recette
export function specOf(R) {
  const S = familySpec(R.family, R.form);
  S.seed = R.seedN;
  return S;
}

// Recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
