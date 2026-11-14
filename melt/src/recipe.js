// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette, la simulation qu'elle demande et la
// phase : même recette, même phase → même image.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est une eau et une lumière (décor, valeur, cadrage), pas une
//   teinte ;
// - la colonne et le lac sont des réglages éprouvés (docs/concept.md, proto/p8,
//   et le balayage de la reconstruction) : chacun donne un détachement par
//   période et moins de 20 % de boucle sans sujet.
import { createRng } from '../../shared/rng.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;

// ── Humeurs : une eau et une lumière ─────────────────────────────────────────
// absorb, sigS en cm⁻¹ ; couleurs en luminance linéaire ; sun : soleil dans
// l'air ; sunW : sa direction dans l'eau (réfractée) ; lb : boîte à lumière ;
// cam : cadrage (position, cible, champ) ; grade : étalonnage de la chaîne d'image
export const MOODS = {
  nuit: {
    label: 'Nuit', absorb: [0.004, 0.0015, 0.001], sigS: 0.004,
    deep: [0, 0, 0], shallow: [0.006, 0.008, 0.011],
    sky: [0.01, 0.012, 0.02], horizon: [0.02, 0.022, 0.03], skyI: 1, sun: [0, 1, 0], sunI: 0,
    lb: [-0.85, 0.12, 0.5], lbI: 9, amb: [0.03, 0.033, 0.038], sunW: [0, 1, 0], glow: 0,
    cam: { pos: [0, -3.4, 23], tgt: [-0.4, -3.4, 0], fov: 32 },
    grade: { exposure: 1.5, contrast: 1.05, saturation: 0.9 },
  },
  snell: {
    label: 'Fenêtre de Snell', absorb: [0.006, 0.0018, 0.0012], sigS: 0.01,
    deep: [0, 0.012, 0.03], shallow: [0.04, 0.2, 0.3],
    sky: [0.35, 0.6, 1.2], horizon: [1.4, 1.5, 1.6], skyI: 1, sun: [0.35, 0.8, -0.45], sunI: 300,
    lb: [0, 0, 1], lbI: 0, amb: [0.18, 0.32, 0.42], sunW: [0.26, 0.9, -0.34], glow: 2,
    cam: { pos: [1, -16, 16], tgt: [-1.5, -2, 0], fov: 42 },
    grade: { exposure: 0.55, contrast: 1.02, saturation: 0.95 },
  },
  ombre: {
    label: 'Ombre', absorb: [0.004, 0.0012, 0.001], sigS: 0.004,
    deep: [0.03, 0.08, 0.1], shallow: [0.2, 0.38, 0.45],
    sky: [0.8, 0.9, 1.1], horizon: [1, 1, 1], skyI: 1, sun: [0.3, 0.6, 0.75], sunI: 90,
    lb: [0, 0, 1], lbI: 0, amb: [0.12, 0.15, 0.17], sunW: [0.25, 0.7, 0.65], glow: 0.4, floorY: -17,
    cam: { pos: [3, -1.5, 15], tgt: [-1.5, -13, -6], fov: 50 },
    grade: { exposure: 0.7, contrast: 1.04, saturation: 0.9 },
  },
  lait: {
    label: 'Lait glaciaire', absorb: [0.012, 0.004, 0.006], sigS: 0.018,
    deep: [0.005, 0.035, 0.04], shallow: [0.28, 0.62, 0.58],
    sky: [1, 1.05, 1.1], horizon: [0.9, 0.95, 1], skyI: 1, sun: [0.2, 0.9, 0.3], sunI: 0,
    lb: [0, 0, 1], lbI: 0, amb: [0.3, 0.55, 0.52], sunW: [0, 1, 0], glow: 1,
    cam: { pos: [0, -4, 16], tgt: [0, -5.2, 0], fov: 38 },
    grade: { exposure: 1, contrast: 1.06, saturation: 0.95 },
  },
  tourbe: {
    label: 'Tourbe', absorb: [0.008, 0.024, 0.07], sigS: 0.011,
    deep: [0.004, 0.002, 0], shallow: [0.4, 0.2, 0.06],
    sky: [1.2, 0.9, 0.6], horizon: [1.4, 1, 0.6], skyI: 1, sun: [-0.7, 0.35, -0.6], sunI: 120,
    lb: [0, 0, 1], lbI: 0, amb: [0.16, 0.09, 0.035], sunW: [-0.55, 0.62, -0.55], glow: 3,
    cam: { pos: [6, -6.5, 32], tgt: [0, -5, 0], fov: 30 },
    grade: { exposure: 1.4, contrast: 1.04, saturation: 0.9 },
  },
  pierre: {
    label: 'Bassin de pierre', absorb: [0.004, 0.0012, 0.001], sigS: 0.008,
    deep: [0.03, 0.07, 0.08], shallow: [0.25, 0.4, 0.45],
    sky: [0.8, 0.9, 1.1], horizon: [1, 1, 1], skyI: 1, sun: [0.3, 0.9, 0.3], sunI: 80,
    lb: [0, 0, 1], lbI: 0, amb: [0.32, 0.38, 0.4], sunW: [0.22, 0.95, 0.22], glow: 0.5, wallZ: -9,
    cam: { pos: [5, -5.5, 30], tgt: [0, -5, 0], fov: 30 },
    grade: { exposure: 0.9, contrast: 1.03, saturation: 0.92 },
  },
};

// ── Colonnes et lacs : réglages éprouvés (un détachement par période) ─────────
// a : rayon de la colonne (m) ; v : avance (m/s simulés) ; feedOff : phases
// d'arrêt de l'avance (l'été) ; T0 → T1 : température du lac (°C)
export const COLUMNS = {
  moyenne: { label: 'Moyenne, lac tempéré', a: 0.014, v: 5e-4, feedOff: [0.38, 0.6], T0: 1.5, T1: 9 },
  fine: { label: 'Fine, lac tempéré', a: 0.010, v: 5e-4, feedOff: [0.38, 0.55], T0: 1.5, T1: 9 },
  large: { label: 'Large, lac tempéré', a: 0.020, v: 4e-4, feedOff: [0.36, 0.58], T0: 2, T1: 10 },
  chaude: { label: 'Moyenne, lac chaud', a: 0.014, v: 5e-4, feedOff: [0.34, 0.5], T0: 3, T1: 11 },
};

// ── Glaces ──
export const ICES = {
  fine: { label: 'Bulleuse fine', sigma: 0.5, bubbles: 0.55, blue: 0.01 },
  chapelets: { label: 'À chapelets', sigma: 0.32, bubbles: 0.95, blue: 0.015 },
  glacier: { label: 'Bleue de glacier', sigma: 0.22, bubbles: 0.3, blue: 0.07 },
  neve: { label: 'Blanche de névé', sigma: 0.9, bubbles: 0.4, blue: 0.005 },
};
export const SECTIONS = { ronde: 0, carree: 1, hexagonale: 2 };

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const column = overrides.column ?? rng.fork('column').pick(Object.keys(COLUMNS));
  const ice = overrides.ice ?? rng.fork('ice').pick(Object.keys(ICES));
  const section = overrides.section ?? rng.fork('section').pick(['ronde', 'ronde', 'carree', 'hexagonale']);
  const rb = rng.fork('body');
  const rc = rng.fork('camera');
  const C = COLUMNS[column], M = MOODS[mood];
  return {
    v: 1, seed: String(seed), mood, column, ice, section,
    lake: { T0: C.T0, T1: C.T1 },
    sim: { T0: C.T0, T1: C.T1, P: 400, v: C.v, feedOff: [...C.feedOff], a: C.a, periods: 2, dx: 1e-3, samples: 200 },
    body: {
      tilt0: r3(rb.range(0.06, 0.16)), azimuth: rb.pick([0, Math.PI]), driftDir: 1, breeze: r2(rb.range(0.6, 1.2)),
    },
    camera: { sway: r3(rc.range(0.05, 0.12)), dolly: r2(rc.range(0.94, 1.06)), lift: r2(rc.range(-0.6, 0.6)) },
    loop: { duration: 48 },
    grade: { ...M.grade },
  };
}

export function upgrade(R) { return R?.v === 1 ? R : generate(R?.seed ?? 'a1'); }
