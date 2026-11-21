// Recette d'une scène : tout ce qui découle de la graine (objet JSON
// partageable). Le rendu ne lit que la recette et la phase.
//
// Unités : mètres, secondes physiques ; radiance de scène 1 = 1 000 cd/m²
// (gen/planck.js) — le soleil, le ciel et la lave partagent cette échelle, et
// chaque humeur a son exposition fixe, réglée au posemètre.
import { createRng } from '../../shared/rng.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
const FIELD = 4.2; // demi-côté du champ (m)
const STEP = (2 * FIELD) / 256; // (pas commun du maillage et des cartes)
const qs = (x) => Math.round(Math.round(x / STEP) * STEP * 1e6) / 1e6 || 0;

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Humeurs : un ciel, un soleil, une exposition, un cadrage ─────────────────
// sky : radiance (unités de scène) au zénith, à l'horizon, du sol lointain ;
// sun : direction, éclairement (klux), couleur ; exposure : exposition fixe.
export const MOODS = {
  argent: {
    label: 'Argent', // ciel couvert clair : la peau vitreuse reflète un ciel blanc (Weston)
    sky: { overcast: true, zenith: [7.5, 7.6, 7.9], horizon: [4.2, 4.3, 4.5], ground: [0.12, 0.12, 0.12] },
    sun: { az: -2.2, el: 1.05, klux: 6, K: 6800, soft: 6 },
    exposure: 0.22, fumes: { dens: 0.12, vog: 0 }, fog: '#c9ccd0', frame: { pitch: [55, 64], dist: [2.7, 3.1], fov: 34 },
    grade: { contrast: 1.12, saturation: 1.0, shadows: [0.97, 1.0, 1.05], highlights: [1.02, 1.0, 0.98] },
  },
  rasant: {
    label: 'Rasant', // soleil bas et dur de côté, ombres longues des orteils
    sky: { zenith: [1.1, 1.6, 3.2], horizon: [3.6, 3.9, 4.4], ground: [0.1, 0.1, 0.1] },
    sun: { az: 0.35, el: 0.2, klux: 55, K: 4300, soft: 1.5, halo: 6, color: [1, 0.8, 0.55] },
    exposure: 0.5, fumes: { dens: 0.15, vog: 0.0 }, fog: '#a9b4c4', frame: { pitch: [38, 46], dist: [2.7, 3.1], fov: 34 }, haze: [3.5, 11],
    grade: { contrast: 1.12, saturation: 1.0, shadows: [0.94, 0.98, 1.08], highlights: [1.04, 1.0, 0.95] },
  },
  nuit: {
    label: 'Nuit', // la lave seule
    sky: { zenith: [0.002, 0.0025, 0.004], horizon: [0.004, 0.0038, 0.0042], ground: [0.0002, 0.0002, 0.0002] },
    sun: { az: 1.2, el: 0.7, klux: 0.0005, K: 7000, soft: 4 },
    exposure: 3.5, farGlow: { klux: 5, az: -0.6, el: 0.22 }, fumes: { dens: 0.5, vog: 0.0 }, fog: '#020203', frame: { pitch: [30, 36], dist: [2.7, 3.1], fov: 32 }, haze: [3, 9],
    grade: { contrast: 1.08, saturation: 1.0, shadows: [0.9, 0.96, 1.12], highlights: [1.02, 1.0, 0.97] },
  },
  bleue: {
    label: 'Heure bleue', // le crépuscule froid dans la peau vitreuse, la lueur chaude de la lave
    sky: { zenith: [0.04, 0.07, 0.19], horizon: [0.13, 0.12, 0.17], ground: [0.006, 0.006, 0.008] },
    sun: { az: 2.6, el: 0.05, klux: 0.002, K: 9000, soft: 6 },
    exposure: 3, farGlow: { klux: 1.2, az: -0.9, el: 0.2 }, fumes: { dens: 0.3, vog: 0.01 }, fog: '#1a2338', frame: { pitch: [34, 42], dist: [2.7, 3.1], fov: 33 }, haze: [3.5, 12],
    grade: { contrast: 1.05, saturation: 1.0, shadows: [0.9, 0.96, 1.14], highlights: [1.03, 1.0, 0.97] },
  },
  vog: {
    label: 'Vog', // brume volcanique épaisse, soleil voilé à contre-jour
    sky: { overcast: true, zenith: [9, 8.6, 7.8], horizon: [7.4, 7, 6.2], ground: [0.3, 0.28, 0.26] },
    sun: { az: -1.45, el: 0.45, klux: 22, K: 4800, soft: 5, halo: 9, color: [1, 0.86, 0.66] },
    exposure: 0.14, fumes: { dens: 0.2, vog: 0.03 }, fog: '#d4c9b8', frame: { pitch: [40, 48], dist: [2.7, 3.1], fov: 34 }, haze: [2.5, 8],
    grade: { contrast: 1.12, saturation: 1.0, shadows: [0.99, 0.98, 0.97], highlights: [1.02, 1.0, 0.97] },
  },
  soufre: {
    label: 'Soufre', // plein soleil vertical ; les vieilles croûtes poudrées de sulfates jaunes et blancs
    sky: { zenith: [1.0, 1.5, 2.9], horizon: [2.6, 2.8, 3.1], ground: [0.14, 0.13, 0.12] },
    sun: { az: 1.0, el: 1.3, klux: 45, K: 5600, soft: 2 },
    exposure: 0.17, fumes: { dens: 0.12, vog: 0 }, fog: '#b9c3cf', frame: { pitch: [64, 72], dist: [2.6, 3.0], fov: 34 },
    look: { sulfur: 1 },
    grade: { contrast: 1.08, saturation: 1.02, shadows: [0.97, 0.99, 1.04], highlights: [1.02, 1.0, 0.98] },
  },
};

// ── Familles : trois façons pour la nappe d'avancer (concept.md, « Familles ») ──
// orteils : bourgeonnement en arbre, petits lobes ; cordée : une nappe large dont
// la peau, freinée au front, se plisse en cordes parallèles au front ; dalles :
// une nappe dont la croûte, étirée, se rompt en plaques séparées de rifts.
export const FAMILIES = {
  orteils: { label: 'Orteils', L: [0.42, 0.62], aspect: [0.62, 0.8], spread: [0.5, 0.75], buds: 1, ropes: 0, plates: 0 },
  cordee: { label: 'Cordée', L: [0.75, 1.05], aspect: [0.95, 1.15], spread: [0.3, 0.45], buds: 0.6, ropes: 1, plates: 0 },
  dalles: { label: 'Dalles', L: [0.8, 1.2], aspect: [0.95, 1.2], spread: [0.3, 0.45], buds: 0.6, ropes: 0, plates: 1 },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const family = overrides.family ?? rng.fork('family').weighted([['orteils', 2], ['cordee', 1.4], ['dalles', 1.2]]);
  const M = MOODS[mood], Fa = FAMILIES[family];
  const rt = rng.fork('toes'), rc = rng.fork('camera'), rl = rng.fork('light');
  // la caméra regarde vers l'amont (−z) : les orteils viennent vers elle ;
  // la percée est dans le tiers haut de l'image
  const dir = Math.PI / 2 + rt.range(-0.25, 0.25); // (pente vers +z : vers la caméra)
  const L = r2(rt.range(...Fa.L));
  const hT = r3(rt.range(0.07, 0.095));
  const toes = {
    delta: [0, 0], // (plus de glissement : la nappe refroidie redessine le motif de départ)
    F: FIELD, L, aspect: r2(rt.range(...Fa.aspect)), hT, buds: Fa.buds, h: r3(hT * 1.15),
    speed: r3(rt.range(0.008, 0.012)), delay: [r2(rt.range(0.2, 1)), r2(rt.range(2, 4))], corr: r2(rt.range(0.6, 1)), spread: r2(rt.range(...Fa.spread)),
    slope: { dir: r2(dir), grade: r3(rt.range(0.02, 0.05)), bias: r2(rt.range(0.9, 1.4)) },
    // deux percées dans le cadre : la première en haut, la seconde plus près, un
    // peu plus tard (la lave est à l'image pendant toute la coulée)
    sources: (() => {
      const x1 = r2(rt.range(-0.35, 0.35)), side = rt.pick([-1, 1]);
      return [
        { x: x1, z: r2(rt.range(-1.5, -1.35)), heading: r2(dir + rt.range(-0.3, 0.3)), t: 0, fan: [r2(-rt.range(0.7, 1.1)), r2(rt.range(0.7, 1.1))] },
        { x: r2(x1 + side * rt.range(0.85, 1.15)), z: r2(rt.range(-0.55, -0.25)), heading: r2(dir - side * rt.range(0.3, 0.6)), t: r2(rt.range(110, 160)), fan: [r2(side * rt.range(0.8, 1.2))] },
      ];
    })(),
  };
  return {
    v: 1, seed, mood, family,
    loop: { duration: 32, P: 3600, u0: 0.04, u1: 0.86 },
    toes,
    camera: {
      fov: M.frame.fov, pitch: r2(rc.range(...M.frame.pitch)), dist: r2(rc.range(...M.frame.dist)),
      yaw: r2(rc.range(-0.25, 0.25)), target: [r2(rc.range(-0.15, 0.15)), r2(rc.range(-0.65, -0.45))], sway: r3(rc.range(0.01, 0.025)),
    },
    sky: { ...M.sky, sun: M.sun.halo ? { az: M.sun.az, el: M.sun.el, halo: M.sun.halo, color: M.sun.color } : null },
    sun: { az: r2(M.sun.az + rl.range(-0.2, 0.2)), el: M.sun.el, klux: M.sun.klux, color: kelvinToHex(M.sun.K), soft: M.sun.soft },
    fog: { color: M.fog, near: (M.haze ?? [6, 20])[0], far: (M.haze ?? [6, 20])[1] },
    fumes: { ...M.fumes },
    farGlow: M.farGlow ? { ...M.farGlow } : null,
    look: { wet: 0, sulfur: 0, ...(M.look ?? {}), ropes: Fa.ropes, plates: Fa.plates },
    grade: { ...M.grade, exposure: M.exposure },
  };
}

export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
