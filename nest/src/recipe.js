// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase.
//
// Règles (voir la skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les couleurs du papier ne sont pas tirées bande par bande : chaque humeur a
//   ses villages (palettes de sources composées à la main) ;
// - les lampes sont presque blanches, la chaleur vient du fond, des matières et
//   de l'étalonnage.
import { createRng } from '../../shared/rng.js';

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

// ── Villages : les sources de papier ─────────────────────────────────────────
// Couleur du papier sec (la pâte mâchée pâlit la peinture et la mêle au bois),
// et poids (combien de charges viennent de cette planche). paint : la couleur
// de la bande du temps fort (la peinture qui signe le village).
export const VILLAGES = {
  provence: { label: 'Provence', paint: 3, sources: [['#bdb5a5', 3], ['#dad1bd', 2], ['#776d60', 2.2], ['#6f86b8', 1.1], ['#93a289', 0.5], ['#c49b69', 0.8], ['#5a5047', 1.2]] },
  falun: { label: 'Falun', paint: 2, sources: [['#aeaaa3', 3], ['#e4ded2', 1.6], ['#a3463a', 1.4], ['#6d6a66', 1.5], ['#c9c2b3', 2], ['#4d4a47', 0.8]] },
  bois: { label: 'Bois seul', paint: 3, sources: [['#b4ada1', 3], ['#8d867b', 2.5], ['#d3c9b6', 2], ['#9a7a58', 1], ['#635d55', 1.5], ['#c2b49a', 1]] },
  rivage: { label: 'Rivage', paint: 2, sources: [['#bdbcb6', 3], ['#e8e6de', 1.6], ['#3f6fa8', 1.3], ['#8a9399', 2], ['#a39f92', 1.5], ['#585c60', 1]] },
  verger: { label: 'Verger', paint: 3, sources: [['#b7b19f', 3], ['#d9d2bc', 2], ['#7b7466', 2], ['#7d9a63', 1.2], ['#b28a5a', 0.6], ['#575247', 1]] },
};

// ── Familles ─────────────────────────────────────────────────────────────────
// boule : Vespula sous une poutre — sphère d'écailles en coquille, large attache ;
// lanterne : Dolichovespula sous un rameau — poire allongée, attache étroite,
// feuilles plus grandes et plus plates (des jupes), bandes plus larges.
export const FAMILIES = {
  boule: { label: 'Boule (guêpe commune)', a: [1.18, 1.32], b: [1.38, 1.52], spacing: [0.17, 0.2], liftK: 1, topK: 1, stripW: 1, scar: 0.5 },
  lanterne: { label: 'Lanterne (guêpe des buissons)', a: [0.9, 1.0], b: [1.65, 1.85], spacing: [0.22, 0.26], liftK: 0.55, topK: 0, stripW: 1.6, scar: 0.17 },
};

// ── Humeurs ──────────────────────────────────────────────────────────────────
// Chacune un décor (support, fond), une lumière, une valeur, un cadrage.
// key.gobo : la fenêtre hors champ (croisillons projetés) ; sans elle, le soleil
// ou une lampe. cam : position de la caméra (échelle du nid plein).
export const MOODS = {
  comble: {
    label: 'Comble', env: 'overcast', keyK: 6200, villages: ['provence', 'rivage'], families: [['boule', 1]],
    decor: { support: 'beam', wood: '#9a948a', woodDark: '#6a645b', wash: 0.45, washColor: '#dcd9d2', lime: '#b9b7b1', wall: 7 },
    bg: '#a9a8a4',
    key: { az: -1.2, el: 0.3, dist: 16, intensity: 2200, angle: 0.5, gobo: 1, pen: 0.15 },
    rim: { color: '#e4eaff', intensity: 260, az: 2.6, el: 0.35 },
    envIntensity: 0.3, cam: [0.8, -0.3, 9.1],
    grade: { contrast: 1.02, saturation: 0.92, shadows: [0.96, 0.99, 1.05], highlights: [1.0, 1.0, 0.99] },
  },
  midi: {
    label: 'Midi', env: 'clearsky', keyK: 5800, villages: ['rivage', 'provence'], families: [['boule', 1]],
    decor: { support: 'beam', wood: '#e8e4dc', woodDark: '#b9b2a6', wash: 0.95, washColor: '#f1eee8', lime: '#dcc9a6', wall: 3.2 },
    bg: '#d9c9a8',
    key: { az: -0.55, el: 1.08, dist: 18, intensity: 8500, angle: 0.32, gobo: 0, pen: 0.04 },
    rim: { color: '#a9c4ff', intensity: 320, az: 2.4, el: -0.2 },
    envIntensity: 0.42, cam: [1.4, -2.4, 8.6],
    grade: { contrast: 1.1, saturation: 1.02, shadows: [0.94, 0.98, 1.08], highlights: [1.02, 1.0, 0.96] },
  },
  haie: {
    label: 'Haie', env: 'fogwhite', keyK: 6800, villages: ['verger', 'bois'], families: [['lanterne', 3], ['boule', 1]],
    decor: { support: 'branch', outdoor: 1, sky: ['#8f9b91', '#c8d0cb'], wood: '#8a8478', woodDark: '#5a544b', wash: 0, washColor: '#ccc', lime: '#999', wall: 14 },
    bg: '#a8b2aa',
    key: { az: -0.4, el: 0.85, dist: 16, intensity: 1500, angle: 0.9, gobo: 0, pen: 1 },
    rim: { color: '#f3f6ff', intensity: 240, az: 2.8, el: 0.5 },
    envIntensity: 0.62, cam: [3.2, -0.6, 8.4],
    grade: { contrast: 0.98, saturation: 0.9, shadows: [0.95, 1.0, 1.04], highlights: [1.0, 1.0, 1.0] },
  },
  contrejour: {
    label: 'Contre-jour', env: 'dusk', keyK: 5200, villages: ['provence', 'falun'], families: [['boule', 2], ['lanterne', 1]],
    decor: { support: 'beam', wood: '#5d564d', woodDark: '#2f2a25', wash: 0.1, washColor: '#a9a49a', lime: '#3c3f46', wall: 6 },
    bg: '#2b2e35',
    key: { az: 2.75, el: 0.32, dist: 16, intensity: 5200, angle: 0.5, gobo: 1, pen: 0.15 },
    rim: { color: '#c9d6ff', intensity: 160, az: -0.6, el: 0.2 },
    envIntensity: 0.18, cam: [0.6, -0.5, 9.0],
    grade: { contrast: 1.12, saturation: 0.95, shadows: [0.92, 0.96, 1.1], highlights: [1.04, 1.0, 0.94] },
  },
  nuit: {
    label: 'Nuit', env: 'nightsky', keyK: 3600, villages: ['bois', 'verger'], families: [['boule', 1]],
    decor: { support: 'beam', wood: '#6e655a', woodDark: '#3a332c', wash: 0.05, washColor: '#999', lime: '#262b35', wall: 5 },
    bg: '#141922',
    key: { az: 0.9, el: 0.55, dist: 9, intensity: 1100, angle: 0.75, gobo: 0, pen: 0.7 },
    rim: { color: '#7f9cff', intensity: 380, az: -2.4, el: 0.6 },
    envIntensity: 0.5, cam: [-1.2, -0.9, 7.6],
    grade: { contrast: 1.1, saturation: 0.95, shadows: [0.9, 0.95, 1.14], highlights: [1.03, 1.0, 0.95] },
  },
  givre: {
    label: 'Givre', env: 'fogwhite', keyK: 7200, villages: ['falun'], families: [['boule', 2], ['lanterne', 1]],
    decor: { support: 'beam', wood: '#8a3a2f', woodDark: '#5a2019', wash: 0.85, washColor: '#93362a', lime: '#e7e4de', wall: 6 },
    bg: '#dcdcd8',
    key: { az: -1.0, el: 0.42, dist: 16, intensity: 2400, angle: 0.55, gobo: 1, pen: 0.3 },
    rim: { color: '#ffffff', intensity: 200, az: 2.5, el: 0.4 },
    envIntensity: 0.5, cam: [0.4, -1.1, 9.3],
    grade: { contrast: 1.0, saturation: 0.9, shadows: [0.97, 1.0, 1.04], highlights: [1.0, 1.0, 1.0] },
  },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rv = rng.fork('village'), rn = rng.fork('nest'), rc = rng.fork('camera'), rl = rng.fork('light'), rf = rng.fork('family');
  const village = overrides.village ?? rv.pick(M.villages);
  const family = overrides.family ?? rf.weighted(M.families);
  const V = VILLAGES[village], F = FAMILIES[family];
  const yBeam = 1.25;
  const cj = (x, k) => r2(x + rc.range(-k, k));
  // le centre du nid plein et sa taille : la caméra cadre le nid de la famille
  const nb = r2(rn.range(...F.b)), na = r2(rn.range(...F.a));
  const yTopF = nb * (0.985 - (0.985 - yBeam / nb) * F.topK), cy = yBeam - yTopF, k = nb / 1.45;
  const tgt = [0, r2(cy + 0.15 * k), 0];
  return {
    v: 1, seed, mood, village, family,
    loop: { duration: 64 },
    nest: {
      family,
      paint: V.paint ?? 3, // (la couleur du temps fort : la peinture du village)
      palette: V.sources.map(([c]) => c),
      spec: {
        seed: `${seed}`, a: na, b: nb, lump: r3(rn.range(0.04, 0.07)), yBeam,
        hole: 0.09, spacing: r3(rn.range(...F.spacing)), persist: r2(rn.range(0.3, 0.45)), sources: V.sources.map(([, w]) => w),
        liftK: F.liftK, topK: F.topK, stripW: F.stripW,
      },
      scar: F.scar,
    },
    decor: { yBeam, ...M.decor },
    camera: { fov: 30, pos: [cj(M.cam[0] * k, 0.4), cj(tgt[1] + (M.cam[1] - 0.15) * k, 0.2), cj(M.cam[2] * k, 0.3)], target: tgt },
    light: {
      key: { ...M.key, color: kelvinToHex(M.keyK + rl.range(-150, 150)), intensity: r2(M.key.intensity * rl.range(0.92, 1.08)) },
      rim: { ...M.rim },
    },
    env: { preset: M.env, intensity: M.envIntensity, rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: 30, far: 80 },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
