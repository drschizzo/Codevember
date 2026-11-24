// Recette d'une scène : tout ce qui découle de la graine (objet JSON
// partageable). Le rendu ne lit QUE la recette et la phase.
//
// Chaque tirage a son flux (rng.fork('…')). Les matières viennent d'accords
// composés à la main par humeur et par monture ; jamais pièce par pièce.
import { createRng } from '../../../shared/rng.js';
import { FINISHES } from '../../../shared/finishes.js';
import { FAMILIES, drawParams } from './gen/burrows.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
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

// ── Gels ─────────────────────────────────────────────────────────────────────
// sigma : absorption par unité (10 cm) en r, g, b ; le vide (de l'air) n'en a pas
export const GELS = {
  limpide: { label: 'Limpide', sigma: [0.09, 0.07, 0.06] },
  aigue: { label: 'Aigue-marine', sigma: [0.9, 0.28, 0.2] },
  eau: { label: 'Vert d’eau', sigma: [0.6, 0.16, 0.42] },
  fume: { label: 'Fumé', sigma: [0.45, 0.42, 0.38] },
};

// ── Montures (accords : platines et colonnes, accents, pied) ─────────────────
const fin = (o, i = o, e = o, wear = 0) => ({ outer: { ...FINISHES[o], preset: o }, inner: { ...FINISHES[i], preset: i }, edge: { ...FINISHES[e], preset: e }, wear });
export const MOUNTS = {
  laiton: { label: 'Laiton tourné', frame: ['polishedBrass', 'polishedBrass', 'brushedBrass'], accent: ['chrome'], stand: ['bronzeDark'] },
  fonte: { label: 'Fonte noire', frame: ['blackenedSteel'], accent: ['brushedBrass'], stand: ['blackenedSteel'] },
  acier: { label: 'Acier brossé', frame: ['brushedSteel'], accent: ['chrome'], stand: ['brushedSteel'] },
  laque: { label: 'Bois laqué noir', frame: ['urushi'], accent: ['polishedBrass'], stand: ['urushi'] },
};

// ── Humeurs : un décor, une lumière, une valeur, un cadrage ──────────────────
// table / mur : couleur et rugosité ; env : studio de la pièce ; sun : course
// (az : demi-amplitude d'azimut ; el : hauteurs) ; day/night : intensités ;
// cam : cadrage (hauteur de l'œil, distance, azimut)
export const MOODS = {
  rebord: {
    label: 'Rebord', table: ['#d9d5cc', 0.55], wall: ['#b9b7b1', 0.9], env: 'roomPale', sunK: 5600, sun: 8.0,
    sky: ['#c9d3e0', '#8a857c'], hemi: 0.23, night: ['#26324a', 0.16], mounts: ['laiton', 'acier', 'fonte'], gels: ['limpide', 'aigue', 'eau'],
    cam: { h: [1.3, 1.7], dist: [7.6, 8.2], az: [0.32, 0.5] },
    grade: { contrast: 1.02, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1.02, 1.0, 0.98] },
  },
  hiver: {
    label: 'Hiver', table: ['#3c4046', 0.75], wall: ['#7d8794', 0.92], env: 'roomWinter', sunK: 6500, sun: 7.0,
    sky: ['#a9c1e6', '#3a3f48'], hemi: 0.2, night: ['#1c2a4a', 0.2], mounts: ['acier', 'fonte', 'laque'], gels: ['limpide', 'aigue'],
    cam: { h: [0.6, 0.9], dist: [7.4, 8.0], az: [0.42, 0.6] },
    grade: { contrast: 1.06, saturation: 0.88, shadows: [0.94, 0.99, 1.08], highlights: [1.0, 1.0, 1.02] },
  },
  verriere: {
    label: 'Verrière', table: ['#8e9692', 0.42], wall: ['#a7b3ab', 0.9], env: 'roomGreen', sunK: 5800, sun: 4.8,
    sky: ['#d8e6dc', '#6f766f'], hemi: 0.38, night: ['#22343a', 0.2], mounts: ['laiton', 'acier', 'laque'], gels: ['limpide', 'eau', 'fume'],
    cam: { h: [3.4, 3.9], dist: [7.6, 8.2], az: [0.25, 0.45] },
    grade: { contrast: 0.98, saturation: 0.92, shadows: [0.97, 1.0, 1.0], highlights: [1.0, 1.01, 0.99] },
  },
  cabinet: {
    label: 'Cabinet', table: ['#121112', 0.3], wall: ['#141315', 0.95], env: 'roomDark', sunK: 4900, sun: 8.5,
    sky: ['#3a3a44', '#100f10'], hemi: 0.08, night: ['#1a2238', 0.12], mounts: ['laiton', 'laque', 'acier'], gels: ['limpide', 'aigue', 'fume'],
    cam: { h: [1.4, 1.8], dist: [6.6, 7.2], az: [0.35, 0.55] },
    grade: { contrast: 1.08, saturation: 0.95, shadows: [0.96, 0.98, 1.06], highlights: [1.03, 1.0, 0.96] },
  },
  midi: {
    label: 'Midi', table: ['#e8e6e1', 0.5], wall: ['#ecebe8', 0.95], env: 'roomWhite', sunK: 6000, sun: 9.0,
    sky: ['#e8eef6', '#b8b4ac'], hemi: 0.25, night: ['#2a3550', 0.2], mounts: ['fonte', 'laque', 'acier'], gels: ['aigue', 'eau', 'fume'],
    cam: { h: [2.4, 2.9], dist: [7.8, 8.4], az: [0.55, 0.75] },
    grade: { contrast: 1.1, saturation: 0.95, shadows: [1.0, 1.0, 1.02], highlights: [1.0, 1.0, 1.0] },
  },
  nord: {
    label: 'Nord', table: ['#6b6760', 0.7], wall: ['#8a8378', 0.95], env: 'roomSlate', sunK: 7200, sun: 4.0,
    sky: ['#b8c2cf', '#4a4640'], hemi: 0.27, night: ['#202838', 0.16], mounts: ['fonte', 'acier', 'laque'], gels: ['limpide', 'fume', 'eau'],
    cam: { h: [1.5, 1.8], dist: [7.8, 8.3], az: [0.05, 0.15] },
    grade: { contrast: 0.96, saturation: 0.8, shadows: [0.98, 1.0, 1.04], highlights: [1.0, 0.99, 0.97] },
  },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const family = overrides.family ?? rng.fork('family').pick(Object.keys(FAMILIES));
  const M = MOODS[mood];
  const ra = rng.fork('accord'), rc = rng.fork('camera'), rl = rng.fork('light');
  const mount = overrides.mount ?? ra.pick(M.mounts);
  const gel = overrides.gel ?? ra.pick(M.gels);
  const Mo = MOUNTS[mount];
  return {
    v: 1, seed, mood, family, mount, gel,
    params: overrides.params ?? drawParams(family, rng.fork('params')),
    loop: { duration: 48 },
    camera: { fov: r2(rc.range(26, 30)), dist: r2(rc.range(...M.cam.dist)), height: r2(rc.range(...M.cam.h)), az: r2(rc.range(...M.cam.az)), sway: r3(rc.range(0.02, 0.05)) },
    sun: { az: r2(rl.range(0.42, 0.5)), elMin: r2(rl.range(0.08, 0.12)), elMax: r2(rl.range(0.34, 0.4)), color: kelvinToHex(M.sunK + rl.range(-200, 200)), intensity: r2(M.sun * rl.range(0.92, 1.08)) },
    env: { preset: M.env, intensity: 1, rotation: 0 },
    room: { table: M.table, wall: M.wall, sky: M.sky, hemi: M.hemi, night: M.night },
    gelSigma: GELS[gel].sigma,
    finishes: { frame: fin(...Mo.frame), accent: fin(...Mo.accent), stand: fin(...Mo.stand) },
    fog: { color: M.wall[0], near: 30, far: 60 },
    grade: { ...M.grade },
  };
}

export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
