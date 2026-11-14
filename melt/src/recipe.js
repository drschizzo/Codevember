// Recette d'une scène : tout ce qui découle de la graine (JSON partageable).
// Le rendu ne lit que la recette et la phase : même recette, même phase →
// même image.
//
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est un studio (boîtes de lumière, fond, lueur), pas une teinte ;
// - les couleurs du bismuth ne sont jamais peintes : elles viennent de
//   l'épaisseur de l'oxyde (vitesse d'oxydation) et de l'optique des couches minces.
import { createRng } from '../../shared/rng.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0;

// ── Humeurs : le studio que le métal reflète ─────────────────────────────────
// boîtes : direction (vers la boîte), intensité, couleur, demi-largeur et
// demi-hauteur angulaires ; lo / hi : fond bas et haut ; forge : lueur sous l'horizon
const WHITE = [1, 0.98, 0.95], COOL = [0.92, 0.95, 1], WARM = [1, 0.86, 0.7];
export const MOODS = {
  studio: {
    label: 'Studio', lo: [0.012, 0.012, 0.014], hi: [0.13, 0.13, 0.14], forge: { color: [0, 0, 0], strength: 0 },
    boxes: [
      { dir: [-0.7, 0.6, 0.4], I: 4, color: WHITE, hw: 0.35, hh: 0.5 },
      { dir: [0.75, 0.55, 0.25], I: 3, color: COOL, hw: 0.25, hh: 0.45 },
      { dir: [0.05, 0.98, 0.15], I: 3.5, color: WHITE, hw: 0.6, hh: 0.3, up: [0, 0, 1] },
      { dir: [0.2, 0.8, -1], I: 1.4, color: WARM, hw: 0.6, hh: 0.14 },
      { dir: [-0.3, 0.25, 1], I: 2.5, color: COOL, hw: 0.5, hh: 0.2 },
      { dir: [0.1, 0.3, 1], I: 0.7, color: [0.8, 0.82, 0.86], hw: 0.7, hh: 0.2 },
    ],
    grade: { exposure: 1, contrast: 1.04, saturation: 1 },
  },
  forge: {
    label: 'Forge', lo: [0.02, 0.008, 0.004], hi: [0.17, 0.12, 0.09], forge: { color: [1.6, 0.45, 0.08], strength: 0.45 },
    boxes: [
      { dir: [-0.8, 0.45, 0.3], I: 3.2, color: WARM, hw: 0.3, hh: 0.5 },
      { dir: [0.05, 0.98, 0.15], I: 2.5, color: [1, 0.9, 0.8], hw: 0.5, hh: 0.3, up: [0, 0, 1] },
      { dir: [0.7, 0.4, -0.6], I: 1.5, color: [1, 0.7, 0.45], hw: 0.4, hh: 0.14 },
      { dir: [0.2, 0.3, 1], I: 0.7, color: [1, 0.6, 0.3], hw: 0.8, hh: 0.16 },
    ],
    grade: { exposure: 1.05, contrast: 1.06, saturation: 1 },
  },
  tente: {
    label: 'Tente claire', lo: [0.06, 0.06, 0.07], hi: [0.8, 0.8, 0.82], forge: { color: [0, 0, 0], strength: 0 },
    boxes: [
      { dir: [-0.75, 0.55, 0.35], I: 2.5, color: WHITE, hw: 0.45, hh: 0.6 },
      { dir: [0.8, 0.5, 0.2], I: 2, color: COOL, hw: 0.3, hh: 0.55 },
      { dir: [0.1, 0.3, -1], I: 1, color: WARM, hw: 0.5, hh: 0.18 },
    ],
    grade: { exposure: 0.75, contrast: 1.02, saturation: 0.95 },
  },
  aube: {
    label: 'Heure bleue', lo: [0.006, 0.008, 0.016], hi: [0.12, 0.16, 0.26], forge: { color: [0, 0, 0], strength: 0 },
    boxes: [
      { dir: [0.0, 0.4, -1], I: 1.7, color: [0.55, 0.72, 1.15], hw: 1.1, hh: 0.24 },
      { dir: [-0.85, 0.35, 0.3], I: 2.2, color: [0.75, 0.85, 1.1], hw: 0.2, hh: 0.6 },
      { dir: [0.05, 0.98, 0.15], I: 1.2, color: [0.8, 0.85, 1], hw: 0.5, hh: 0.3, up: [0, 0, 1] },
      { dir: [0.9, 0.2, 0.3], I: 1.4, color: WARM, hw: 0.12, hh: 0.3 },
    ],
    grade: { exposure: 1.1, contrast: 1.05, saturation: 1 },
  },
};

// ── Ports du cristal ──
export const HABITS = { tremie: { label: 'Trémie', id: 0 }, spirale: { label: 'Trémie en spirale', id: 1 }, allongee: { label: 'Allongée', id: 2 } };
// ── Gammes d'oxyde : la vitesse d'oxydation (l'air plus ou moins chaud) ──
export const OXIDES = {
  or: { label: 'Or et magenta (oxyde mince)', rate: 0.65 },
  arcenciel: { label: 'Arc-en-ciel', rate: 1 },
  bleus: { label: 'Bleus et verts (oxyde épais)', rate: 1.45 },
  argent: { label: 'Presque argent', rate: 0.25 },
};
// ── Grappes ──
export const CLUSTERS = {
  grappe: { label: 'Grappe', count: 9, scale: 1, spread: 1 },
  dense: { label: 'Druse dense', count: 12, scale: 0.6, spread: 0.85 },
  solitaire: { label: 'Un grand cristal et ses satellites', count: 5, scale: 1.25, spread: 1.4 },
};
// ── Cadrages ──
// (aperture : rayon de la lentille, en cm ; le point est fait sur la grappe)
// atelier : la marmite entière sur son brûleur, vue du dehors
export const FRAMINGS = {
  large: { label: 'Plan large', pos: [0.5, 3.4, 8.2], tgt: [0, 0.7, 0], fov: 34, aperture: 0.05 },
  rasant: { label: 'Au ras du bain', pos: [0.8, 1.3, 8.6], tgt: [0, 0.9, 0], fov: 30, aperture: 0.05 },
  macro: { label: 'Gros plan', pos: [0.3, 2.4, 4.6], tgt: [0, 0.8, 0], fov: 32, aperture: 0.06 },
  plongee: { label: 'Plongée', pos: [0.2, 6.2, 6.4], tgt: [0, 0.4, 0], fov: 34, aperture: 0.045 },
  atelier: { label: 'Le creuset sur le feu', pos: [0.35, 0.62, 0.78], tgt: [0, 0.2, 0], fov: 38, aperture: 0.1 },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const pick = (k, o) => overrides[k] ?? rng.fork(k).pick(Object.keys(o));
  const mood = pick('mood', MOODS), habit = pick('habit', HABITS), oxide = pick('oxide', OXIDES);
  const cluster = pick('cluster', CLUSTERS), framing = overrides.framing ?? (rng.fork('flamme').range(0, 1) < 0.14 ? 'atelier' : rng.fork('framing').pick(['large', 'large', 'large', 'rasant', 'macro', 'macro', 'plongee']));
  const rc = rng.fork('camera');
  return {
    v: 2, seed: String(seed), mood, habit, oxide, cluster, framing,
    oxRate: OXIDES[oxide].rate,
    camera: { sway: r2(rc.range(0.05, 0.12)), lift: r2(rc.range(-0.2, 0.2)), dolly: r2(rc.range(0.95, 1.05)) },
    loop: { duration: 40 },
    grade: { ...MOODS[mood].grade },
  };
}
export function upgrade(R) { return R?.v === 2 ? R : generate(R?.seed ?? 'b1'); }
