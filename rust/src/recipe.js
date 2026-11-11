// Recette d'une scène : tout ce qui découle de la graine. Un objet JSON
// (partageable par « Copier le lien »), modifié en place par le panneau. Le
// rendu ne lit QUE la recette et la phase.
//
// Une scène = une pièce (famille et proportions), une machine, une humeur
// (décor, lumière, valeur, cadrage), un climat (pluie et forme de la
// rouille), un découpage du film (averses).
//
// Règles : chaque tirage a son flux (rng.fork('…')) ; lampes presque
// blanches (≥ 4700 K) ; la chaleur vient de la rouille elle-même, du fond, des
// contre-jours et de l'étalonnage ; les humeurs se distinguent par le décor,
// la lumière, la valeur et le cadrage, pas par une teinte.
import { createRng } from './rng.js';
import { FAMILIES, pieceParams } from './gen/pieces.js';
import { MACHINES, machineParams } from './machines.js';
import { makeTiming } from './timeline.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0)
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

// ── Humeurs : un décor chacune ───────────────────────────────────────────────
// floor : nature du sol (scene/floor.js) ; bg : fond et brume ; key : lampe
// principale (azimut, élévation, ouverture, pénombre : dure ou douce) ; rim :
// contre-jours [couleur, intensité relative, azimut, élévation] ; cam :
// hauteur (élévation en degrés) et azimut de la caméra ; grade : étalonnage.
export const MOODS = {
  atelier: {
    label: 'Atelier', env: 'hall', bg: '#2c2a27', floor: 'beton', floorTone: '#8a867e', wall: 0.75,
    key: { K: 5200, az: [-0.9, -0.5], el: [1.15, 1.3], angle: 0.75, penumbra: 0.95, power: 1 }, keyShadow: 0.85,
    rim: [['#fff3e6', 0.45, 2.5, 0.45], ['#e8eeff', 0.25, -2.6, 0.3]],
    envIntensity: [0.5, 0.65], fog: [7, 22],
    cam: { el: [16, 24], az: [0.35, 0.6] },
    grade: { contrast: 1.04, saturation: 1.0, shadows: [0.96, 0.99, 1.05], highlights: [1.04, 1.0, 0.95] },
  },
  labo: {
    label: 'Laboratoire', env: 'cyclo', bg: '#e2e1dc', floor: 'epoxy', floorTone: '#d6d5d0', wall: 1,
    key: { K: 6000, az: [-0.5, -0.2], el: [1.05, 1.25], angle: 0.85, penumbra: 1, power: 0.36 }, keyShadow: 0.6,
    rim: [['#ffffff', 0.3, 2.2, 0.5], ['#f4f6ff', 0.2, -2.3, 0.4]],
    envIntensity: [0.2, 0.26], fog: [9, 30],
    cam: { el: [10, 16], az: [0.05, 0.3] },
    grade: { contrast: 0.98, saturation: 0.95, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1] },
  },
  cale: {
    label: 'Cale sèche', env: 'dock', bg: '#0e141b', floor: 'larmee', floorTone: '#4a4d50', wall: 0.35,
    key: { K: 6800, az: [0.5, 0.8], el: [0.6, 0.85], angle: 0.5, penumbra: 0.55, power: 1.8 }, keyShadow: 1,
    rim: [['#cfe0ff', 1.3, 2.75, 0.35], ['#ffffff', 0.4, -2.2, 0.6]],
    envIntensity: [0.55, 0.7], fog: [5, 16],
    cam: { el: [3, 9], az: [0.4, 0.7] },
    grade: { contrast: 1.1, saturation: 1.0, shadows: [0.9, 0.97, 1.1], highlights: [1.03, 1.0, 0.97] },
  },
  jour: {
    label: 'Plein jour', env: 'sun', bg: '#d8cfbf', floor: 'dalle', floorTone: '#b8ad9b', wall: 0.9,
    key: { K: 5600, az: [-0.75, -0.35], el: [0.95, 1.15], angle: 0.32, penumbra: 0.12, power: 1.1 }, keyShadow: 1,
    rim: [['#dfe9ff', 0.2, 2.0, 0.6], ['#fff6ea', 0.12, -2.6, 0.4]],
    envIntensity: [0.36, 0.46], fog: [10, 34],
    cam: { el: [14, 22], az: [-0.55, -0.3] },
    grade: { contrast: 1.08, saturation: 1.04, shadows: [0.94, 0.98, 1.06], highlights: [1.04, 1.01, 0.96] },
  },
  nuit: {
    label: 'Nuit d\'usine', env: 'factory', bg: '#060607', floor: 'tole', floorTone: '#26272a', wall: 0.2,
    key: { K: 5000, az: [-0.5, 0.5], el: [1.02, 1.18], angle: 0.4, penumbra: 0.5, power: 3.4 }, keyShadow: 1,
    rim: [['#ffe2c4', 0.7, 2.9, 0.25], ['#c9d8ff', 0.35, -2.8, 0.35]],
    envIntensity: [0.4, 0.5], fog: [4, 13],
    cam: { el: [6, 12], az: [0.25, 0.5] },
    grade: { contrast: 1.12, saturation: 1.02, shadows: [0.93, 0.95, 1.06], highlights: [1.05, 1.0, 0.94] },
  },
  brume: {
    label: 'Brume', env: 'overcast', bg: '#9ba3a7', floor: 'ardoise', floorTone: '#4f5357', wall: 0.6,
    key: { K: 7200, az: [-0.4, 0.4], el: [1.3, 1.45], angle: 0.9, penumbra: 1, power: 0.55 }, keyShadow: 0.45,
    rim: [['#eef3ff', 0.35, 2.6, 0.4], ['#ffffff', 0.2, -2.4, 0.5]],
    envIntensity: [0.75, 0.95], fog: [3.5, 12],
    cam: { el: [8, 14], az: [-0.15, 0.15] },
    grade: { contrast: 0.97, saturation: 0.92, shadows: [0.97, 1.0, 1.04], highlights: [0.99, 1.0, 1.02] },
  },
};

// ── Climats : la pluie et la forme de la rouille ─────────────────────────────
// pits : densité des germes (piqûres) ; spread : vitesse d'extension des
// taches ; streak : coulures ; blister : cloques ; flake : écailles ;
// hue : rouille plus orangée (chlorures) ou plus brune ; rain : densité,
// longueur des gouttes, vent
export const CLIMATES = {
  bruine: { label: 'Bruine', pits: 26, spread: 0.32, streak: 1.25, blister: 0.5, flake: 0.6, hue: 0, rain: { density: 1.0, len: 0.06, wind: 0.08, size: 0.6 } },
  averses: { label: 'Averses', pits: 16, spread: 0.42, streak: 1.0, blister: 0.7, flake: 1.0, hue: -0.1, rain: { density: 0.75, len: 0.13, wind: 0.04, size: 1 } },
  embruns: { label: 'Embruns', pits: 34, spread: 0.36, streak: 0.85, blister: 1.0, flake: 0.8, hue: 0.35, rain: { density: 0.9, len: 0.09, wind: 0.35, size: 0.8 } },
  brouillard: { label: 'Brouillard', pits: 22, spread: 0.5, streak: 0.55, blister: 0.4, flake: 0.5, hue: 0.1, rain: { density: 1.2, len: 0.035, wind: 0.12, size: 0.45 } },
};

export const MACHINE_KEYS = Object.keys(MACHINES);
export const FAMILY_KEYS = Object.keys(FAMILIES);

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const family = overrides.family ?? rng.fork('family').pick(FAMILY_KEYS);
  const machine = overrides.machine ?? rng.fork('machine').pick(MACHINE_KEYS);
  const climate = overrides.climate ?? rng.fork('climate').pick(Object.keys(CLIMATES));
  const C = CLIMATES[climate];
  const rp = rng.fork('piece'), rc = rng.fork('camera'), rl = rng.fork('light'), rr = rng.fork('rust');

  const timing = makeTiming(rng.fork('timing'), machine);
  const keyAz = rl.range(...M.key.az), keyEl = rl.range(...M.key.el);
  return {
    v: 1, seed, mood, family, machine, climate,
    loop: { duration: rng.fork('loop').pick([44, 48, 52]) },
    piece: { family, params: pieceParams(family, rp) },
    machine: machineParams(machine, rng.fork('machine-params')),
    timing,
    rust: {
      pits: C.pits * r2(rr.range(0.85, 1.2)), spread: r2(C.spread * rr.range(0.85, 1.15)), streak: r2(C.streak * rr.range(0.8, 1.2)),
      blister: r2(C.blister * rr.range(0.8, 1.2)), flake: r2(C.flake * rr.range(0.8, 1.2)), hue: r2(C.hue + rr.range(-0.08, 0.08)),
      depth: r2(rr.range(0.85, 1.1)), // épaisseur finale (croûte)
      offset: [r2(rr.range(0, 50)), r2(rr.range(0, 50)), r2(rr.range(0, 50))], // (germes propres à la graine)
    },
    rain: { ...C.rain, density: r2(C.rain.density * rr.range(0.85, 1.15)) },
    camera: {
      fov: r2(rc.range(26, 32)), el: r2(rc.range(...M.cam.el)), az: r2(rc.range(...M.cam.az) * (machine === 'laser' ? 1 : 1)),
      fit: r2(rc.range(1.1, 1.25)), close: r2(rc.range(0.74, 0.84)), sway: r2(rc.range(0.04, 0.08)), side: r2(rc.range(0.3, 0.45)),
    },
    light: {
      key: { color: kelvinToHex(M.key.K + rl.range(-150, 150)), power: r2(M.key.power * rl.range(0.9, 1.1)), az: r2(keyAz), el: r2(keyEl), angle: M.key.angle, penumbra: M.key.penumbra },
      rim: M.rim.map(([c, p, az, el]) => ({ color: c, power: r2(p * rl.range(0.85, 1.15)), az: r2(az + rl.range(-0.15, 0.15)), el: r2(el) })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envIntensity)), rotation: r2(rl.range(-0.3, 0.3)) },
    fog: { color: M.bg, near: M.fog[0], far: M.fog[1] },
    floor: { kind: M.floor, tone: M.floorTone, wall: M.wall },
    grade: { ...M.grade },
  };
}

// recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, machine: R.machine?.kind ?? R.machine, climate: R.climate });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
export { FAMILIES, MACHINES, r3 };
