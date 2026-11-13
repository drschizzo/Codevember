// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place. Le rendu
// ne lit QUE la recette, les données qu'elle produit (gen/worker.js) et la phase.
//
// Une humeur est un décor complet : une roche, une lumière (soleil, ciel), une
// eau, une valeur, un cadrage — pas une teinte. Une famille est une plante qui
// fait le geste à sa façon (gen/kelp.js).
import { createRng } from './rng.js';
import { FAMILIES } from './gen/kelp.js';

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

// ── Humeurs ──────────────────────────────────────────────────────────────────
// rock : la roche du platier (gen/rock.js) et ses teintes ; sun : élévation,
// azimut par rapport à l'axe de visée (0 : dans le dos de la caméra, π : en
// face), température, éclairement ; sky : zénith, horizon, brume (couleurs
// linéaires relatives) ; water : extinction (1/m, par canal), diffusion, teinte
// de l'eau diffusée ; cam : cadrage préféré ; grade : étalonnage.
export const MOODS = {
  // d'après Hiroshi Sugimoto (« Seascapes ») : une mer et un ciel gris de
  // même valeur, l'horizon au milieu exact de l'image, aucun soleil, presque
  // pas de couleur. Le hublot-dôme coupe le cadre en deux à la même hauteur :
  // au-dessus, la marine immobile ; au-dessous, la forêt qui bouge. Tirée à
  // part (une graine sur cinq, sur son propre flux), les autres graines
  // gardent leur décor.
  sugimoto: {
    label: 'Marine', rock: 'slate', extra: true,
    rockColor: { base: '#55595b', dark: '#2e3133', light: '#73787a', crust: '#6f6266', lichen: '#8a8a78' },
    sun: { el: [1.1, 1.25], az: [-0.4, 0.4], K: 6800, lux: 0.35 }, sky: { zenith: [0.5, 0.52, 0.54], horizon: [0.62, 0.63, 0.64], haze: 1.0, cloud: 1.0, intensity: 1.05 },
    water: { ext: [0.55, 0.2, 0.2], scat: 0.55, tint: [0.18, 0.24, 0.24] },
    cam: { lens: [0.24, 0.3], yaw: [0.02, 0.08], pitch: [-0.02, 0.0], fov: [60, 64] },
    grade: { contrast: 1.04, saturation: 0.3, shadows: [0.99, 1.0, 1.02], highlights: [1, 1, 1], exposure: 1.1 },
  },
  ploumanach: {
    label: "Ploumanac'h", rock: 'granite',
    rockColor: { base: '#b98f80', dark: '#7d5d55', light: '#d9b8a6', crust: '#c77b86', lichen: '#d7b14a' },
    sun: { el: [0.32, 0.45], az: [-2.0, -1.4], K: 5400, lux: 3.2 }, sky: { zenith: [0.16, 0.32, 0.72], horizon: [0.72, 0.8, 0.9], haze: 0.35, cloud: 0.3, intensity: 1.0 },
    water: { ext: [0.62, 0.2, 0.28], scat: 0.35, tint: [0.12, 0.32, 0.26] },
    cam: { lens: [0.22, 0.3], yaw: [0.2, 0.35], pitch: [-0.12, -0.07], fov: [64, 70] },
    grade: { contrast: 1.04, saturation: 1.02, shadows: [0.96, 1.0, 1.04], highlights: [1.03, 1.0, 0.96] },
  },
  couchant: {
    label: 'Couchant', rock: 'basalt',
    rockColor: { base: '#2d2b2a', dark: '#161515', light: '#47423d', crust: '#9a5568', lichen: '#b8a24a' },
    sun: { el: [0.07, 0.12], az: [2.65, 2.95], K: 3400, lux: 2.6 }, sky: { zenith: [0.1, 0.16, 0.36], horizon: [1.1, 0.55, 0.26], haze: 0.6, cloud: 0.38, intensity: 0.85 },
    water: { ext: [0.6, 0.24, 0.2], scat: 0.25, tint: [0.1, 0.22, 0.25] },
    cam: { lens: [0.18, 0.24], yaw: [0.42, 0.6], pitch: [-0.07, -0.03], fov: [66, 72] },
    grade: { contrast: 1.08, saturation: 1.05, shadows: [0.92, 0.97, 1.08], highlights: [1.06, 1.0, 0.92] },
  },
  etretat: {
    label: 'Étretat', rock: 'chalk',
    rockColor: { base: '#ddd8cc', dark: '#b3ad9e', light: '#f1ede4', crust: '#cfa1a6', lichen: '#c4bd8c' },
    sun: { el: [0.7, 0.9], az: [-2.6, -1.8], K: 6500, lux: 0.7 }, sky: { zenith: [0.62, 0.66, 0.7], horizon: [0.9, 0.92, 0.93], haze: 0.8, cloud: 1.0, intensity: 1.15 },
    water: { ext: [0.5, 0.13, 0.15], scat: 0.6, tint: [0.2, 0.42, 0.38] },
    cam: { lens: [0.3, 0.38], yaw: [0.25, 0.4], pitch: [-0.18, -0.12], fov: [60, 66] },
    grade: { contrast: 0.98, saturation: 0.9, shadows: [0.98, 1.0, 1.02], highlights: [1.0, 1.0, 1.0], exposure: 0.85 },
  },
  ardoise: {
    label: 'Ardoise', rock: 'slate',
    rockColor: { base: '#4a5157', dark: '#2a2f33', light: '#69727a', crust: '#8e5e70', lichen: '#a59c62' },
    sun: { el: [-0.08, -0.04], az: [2.2, 2.6], K: 9000, lux: 0.0 }, sky: { zenith: [0.06, 0.1, 0.26], horizon: [0.42, 0.36, 0.48], haze: 0.5, cloud: 0.3, intensity: 0.7 },
    water: { ext: [0.66, 0.3, 0.24], scat: 0.3, tint: [0.08, 0.16, 0.22] },
    cam: { lens: [0.2, 0.26], yaw: [0.15, 0.3], pitch: [-0.1, -0.05], fov: [62, 68] },
    grade: { contrast: 1.06, saturation: 0.95, shadows: [0.92, 0.98, 1.1], highlights: [1.0, 0.98, 1.04], exposure: 1.4 },
  },
  midi: {
    label: 'Midi', rock: 'sandstone',
    rockColor: { base: '#a2563c', dark: '#6b3423', light: '#c98a62', crust: '#d08890', lichen: '#d9c060' },
    sun: { el: [1.05, 1.2], az: [-1.2, -0.6], K: 5800, lux: 3.6 }, sky: { zenith: [0.1, 0.28, 0.75], horizon: [0.62, 0.76, 0.92], haze: 0.25, cloud: 0.05, intensity: 1.0 },
    water: { ext: [0.55, 0.12, 0.2], scat: 0.25, tint: [0.1, 0.36, 0.3] },
    cam: { lens: [0.26, 0.34], yaw: [0.2, 0.32], pitch: [-0.14, -0.08], fov: [62, 68] },
    grade: { contrast: 1.07, saturation: 1.04, shadows: [0.97, 1.0, 1.03], highlights: [1.02, 1.0, 0.97], exposure: 0.9 },
  },
  noctiluque: {
    label: 'Noctiluque', rock: 'granite',
    rockColor: { base: '#5b5856', dark: '#2c2a29', light: '#7b7672', crust: '#7a4e5a', lichen: '#8c8452' },
    sun: { el: [0.45, 0.6], az: [2.0, 2.5], K: 8000, lux: 0.06, moon: true }, sky: { zenith: [0.006, 0.01, 0.025], horizon: [0.02, 0.03, 0.05], haze: 0.4, cloud: 0.2, intensity: 1.0 },
    water: { ext: [0.7, 0.3, 0.22], scat: 0.25, tint: [0.03, 0.06, 0.1], glow: 1 },
    cam: { lens: [0.2, 0.26], yaw: [0.3, 0.45], pitch: [-0.08, -0.04], fov: [64, 70] },
    grade: { contrast: 1.1, saturation: 1.1, shadows: [0.9, 0.96, 1.12], highlights: [0.95, 1.0, 1.06], exposure: 3.2 },
  },
};

// teintes des familles (lanière, stipe, lumière transmise), en sRGB : une
// laminaire mouillée est brun olive presque noir (albédo linéaire 0,02 à 0,05)
// et se lit par ses reflets ; claires, elles faisaient des rubans caramel
export const KELP_COLORS = {
  // (olive, pas caramel : au soleil rasant, des bruns orangés se lisaient en
  // rubans de cuir ; la lumière transmise reste ambrée, plus verte)
  digitata: { blade: '#2f2c14', stipe: '#2a2510', light: '#97862a' },
  durvillaea: { blade: '#34331a', stipe: '#2b2a12', light: '#8f8628' },
  postelsia: { blade: '#3b3818', stipe: '#332e14', light: '#a59330' },
  egregia: { blade: '#2f2a12', stipe: '#28220e', light: '#8e7c26' },
};

const FAMILY_KEYS = Object.keys(FAMILIES);

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? (rng.fork('regard').chance(0.2) ? 'sugimoto' : rng.fork('mood').pick(Object.keys(MOODS).filter((k) => !MOODS[k].extra)));
  const family = overrides.family ?? rng.fork('family').weighted([['digitata', 4], ['durvillaea', 3], ['postelsia', 2.5], ['egregia', 2.5]]);
  const M = MOODS[mood];
  const rs = rng.fork('sea'), rc = rng.fork('camera'), rl = rng.fork('light'), rr = rng.fork('rock');
  const range = (r, [a, b]) => r.range(a, b);

  // la série : trois vagues en crescendo, la plus grande en dernier ; la boucle
  // finit au calme (la grande vague a le temps de se retirer)
  const T = 32;
  const t1 = r2(rs.range(3.8, 5.0)), t2 = r2(t1 + rs.range(6.8, 7.8)), t3 = r2(t2 + rs.range(8.6, 9.6));
  const A3 = r2(rs.range(0.66, 0.76));
  const waves = [
    { t: t1, A: r2(A3 * rs.range(0.38, 0.46)), beta: r2(rs.range(0.4, 0.5)), d: 2.6, tc: 1.2, tt: 1.7 },
    { t: t2, A: r2(A3 * rs.range(0.6, 0.68)), beta: r2(rs.range(0.5, 0.6)), d: 2.8, tc: 1.3, tt: 1.8 },
    { t: t3, A: A3, beta: r2(rs.range(0.75, 0.85)), d: 3.1, tc: 1.5, tt: 2.0 },
  ];
  const profile = {
    depth: 1.4, edgeX: -2.8, edgeW: r2(rs.range(0.7, 0.95)), shelf: r3(rs.range(0.04, 0.07)), slope: r3(rs.range(0.075, 0.095)),
    riseX: 1.0, rise: 0.09, cap: 1.3, steps: M.rock === 'sandstone' ? 0.03 : 0, stepW: 0.6,
  };

  return {
    v: 1, seed, mood, family,
    loop: { duration: T },
    sea: { profile, waves, obliq: r3(rs.range(0.04, 0.08) * rs.sign()), manning: 0.035 },
    rock: { type: M.rock, seed: `${seed}`, amp: r2(rr.range(0.85, 1.15)), dip: r2(rr.range(0.3, 1.2)), pools: rr.int(3, 6), color: { ...M.rockColor } },
    kelp: { density: r2(rng.fork('kelp').range(0.95, 1.1)), color: { ...KELP_COLORS[family] } },
    camera: {
      lens: r3(range(rc, M.cam.lens)), yaw: r3(range(rc, M.cam.yaw)), pitch: r3(range(rc, M.cam.pitch)), fov: r2(range(rc, M.cam.fov)),
      dome: 0.09, sway: r3(rc.range(0.015, 0.03)), push: r3(rc.range(0.04, 0.1)), z: 0.8,
    },
    sun: { el: r3(range(rl, M.sun.el)), az: r3(range(rl, M.sun.az)), color: kelvinToHex(M.sun.K + rl.range(-200, 200)), lux: r2(M.sun.lux * rl.range(0.92, 1.08)), moon: !!M.sun.moon },
    sky: { ...M.sky, rot: 0 },
    water: { glow: 0, ...M.water, ext: [...M.water.ext] },
    env: { intensity: r2(rl.range(0.9, 1.1)) },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

export { FAMILIES, FAMILY_KEYS };
