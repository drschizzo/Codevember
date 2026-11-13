// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Chaque tirage a son propre flux (rng.fork('…')) : ajouter un tirage ne
// change pas les autres. Une humeur est un DÉCOR (support, lumière, valeur,
// cadrage) avant d'être une couleur ; les lampes sont presque blanches, sauf
// le soleil d'hiver (un peu chaud) et l'éclairage de Rheinberg (coloré : c'est
// le principe de cette microscopie).
import { createRng } from '../../shared/rng.js';
import { FAMILIES } from './families.js';

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

// ── Humeurs : un décor chacune ───────────────────────────────────────────────
// sub : le support (scene/substrate.js) et ses couleurs ; theta : angle de
// contact de l'eau sur ce support (rad) ; bg : fond et brume ; env : studio ;
// key : lumière froide (ciel, boîte à lumière) ; sun : le soleil de la fonte ;
// cam : cadrage (élévation en degrés, champ) ; grade : étalonnage.
export const MOODS = {
  laine: {
    label: 'Laine', sub: { kind: 'wool', color: '#1a2650', color2: '#2c3d70' }, theta: 1.85,
    bg: '#0a0d18', env: 'studio', envI: [0.35, 0.5],
    key: { K: 6800, I: 1.5, az: [-0.6, 0.6], el: 0.95, soft: 0.9 }, rim: { K: 5600, I: 1.3 },
    sun: { K: 4900, I: 2.4, el: [0.25, 0.45] },
    cam: { el: [36, 46], fov: 30 },
    sky: { ambient: [0.02, 0.025, 0.04], box: [2.4, 2.5, 2.7], boxW: 0.42, boxH: 0.28, strip: [3, 3.05, 3.2], stripOff: 1.25, stripEl: 0.55, floor: [0.008, 0.01, 0.018] },
    grade: { exposure: 1.7, contrast: 1.04, saturation: 1.02, shadows: [0.92, 0.97, 1.1], highlights: [1.03, 1.0, 0.96] },
  },
  verre: {
    // une vitre en hiver, à l'heure bleue : le flocon posé sur le verre, éclairé de face ; derrière, le ciel flou
    label: 'Verre', sub: { kind: 'glass', color: '#3c5476', color2: '#0c1626' }, theta: 0.55,
    bg: '#3c5476', env: 'cyclo', envI: [1.3, 1.6], fog: [40, 90], // (la brume ne voile pas la vitre)
    key: { K: 6500, I: 1.1, az: [-0.5, 0.5], el: 1.0, soft: 1 }, rim: { K: 6500, I: 0.6 },
    sun: { K: 5000, I: 1.6, el: [0.35, 0.6] },
    cam: { el: [50, 64], fov: 28 },
    sky: { ambient: [0.05, 0.06, 0.08], box: [2.6, 2.65, 2.75], boxW: 0.5, boxH: 0.32, strip: [3, 3, 3.1], stripOff: 1.3, stripEl: 0.6, floor: [0.02, 0.025, 0.03] },
    grade: { exposure: 1.0, contrast: 1.06, saturation: 0.95, shadows: [0.95, 0.98, 1.05], highlights: [1.02, 1, 0.98] },
  },
  velours: {
    label: 'Velours', sub: { kind: 'velvet', color: '#060607', color2: '#121216' }, theta: 1.9,
    bg: '#020203', env: 'night', envI: [0.25, 0.35],
    key: { K: 6000, I: 0.6, az: [2.6, 3.4], el: 0.35, soft: 0.25 }, rim: { K: 7000, I: 1.2 },
    sun: { K: 5200, I: 0.8, el: [0.2, 0.32] },
    cam: { el: [14, 22], fov: 26 },
    sky: { ambient: [0.003, 0.003, 0.004], box: [1.8, 1.85, 1.95], boxW: 0.3, boxH: 0.18, strip: [4, 4, 4.2], stripOff: 1.0, stripEl: 0.3, floor: [0.002, 0.002, 0.002] },
    grade: { exposure: 1.6, contrast: 1.12, saturation: 0.95, shadows: [0.94, 0.97, 1.06], highlights: [1.02, 1.0, 0.98] },
  },
  houx: {
    label: 'Houx', sub: { kind: 'leaf', color: '#0f2a17', color2: '#3a5a22' }, theta: 1.55,
    bg: '#0d1610', env: 'atelier', envI: [0.4, 0.6],
    key: { K: 6000, I: 0.6, az: [-1.0, 1.0], el: 1.1, soft: 1 }, rim: { K: 5600, I: 0.5 },
    sun: { K: 5000, I: 3.6, el: [0.7, 1.0] },
    cam: { el: [22, 32], fov: 30 },
    sky: { ambient: [0.035, 0.045, 0.05], box: [1.8, 1.85, 1.9], boxW: 0.45, boxH: 0.28, strip: [0.6, 0.6, 0.6], stripOff: -1.2, stripEl: 0.6, floor: [0.01, 0.02, 0.01] },
    grade: { exposure: 1.25, contrast: 1.05, saturation: 1.05, shadows: [0.95, 1.0, 1.04], highlights: [1.03, 1.01, 0.95] },
  },
  rheinberg: {
    label: 'Rheinberg', sub: { kind: 'sapphire', color: '#0d1a33', color2: '#ffcf7a' }, theta: 0.5,
    bg: '#05080f', env: 'night', envI: [0.15, 0.25],
    key: { K: 6500, I: 0.25, az: [-0.3, 0.3], el: 1.3, soft: 1 }, rim: { K: 6500, I: 0.15 },
    sun: { K: 5600, I: 0.5, el: [0.9, 1.2] },
    cam: { el: [58, 72], fov: 26 },
    sky: { ambient: [0.01, 0.012, 0.02], box: [0.7, 0.72, 0.8], boxW: 0.4, boxH: 0.4, strip: [1, 1, 1.1], stripOff: 1.2, stripEl: 0.9, floor: [0.01, 0.01, 0.02] },
    grade: { exposure: 1.0, contrast: 1.05, saturation: 1.1, shadows: [1, 1, 1], highlights: [1, 1, 1] },
  },
  ardoise: {
    label: 'Ardoise', sub: { kind: 'slate', color: '#26292e', color2: '#3a3e44' }, theta: 1.1,
    bg: '#2a2d31', env: 'cyclo', envI: [0.45, 0.6],
    key: { K: 6800, I: 0.8, az: [-0.3, 0.3], el: 1.35, soft: 1 }, rim: { K: 6500, I: 0.3 },
    sun: { K: 5400, I: 2.0, el: [0.32, 0.48] }, // (rasant : il sculpte le grain de l'ardoise)
    cam: { el: [50, 60], fov: 30 },
    sky: { ambient: [0.07, 0.072, 0.078], box: [2.4, 2.42, 2.48], boxW: 0.55, boxH: 0.35, strip: [1.5, 1.5, 1.55], stripOff: 1.5, stripEl: 0.7, floor: [0.03, 0.03, 0.033] },
    grade: { exposure: 1.4, contrast: 1.02, saturation: 0.85, shadows: [0.97, 0.99, 1.03], highlights: [1, 1, 1] },
  },
};
export const MOOD_KEYS = Object.keys(MOODS);

// palettes de Rheinberg : [champ (lumière directe), anneau (lumière déviée)].
// Un champ sombre et une lumière déviée chaude et claire : l'image se lit
// comme de la lumière dans la pénombre (pas de couleurs complémentaires
// saturées, qui font « fausse couleur »)
export const RHEINBERG = [['#0d1a33', '#ffcf7a'], ['#08121c', '#fff1d6'], ['#10203a', '#f6d9a0'], ['#0a1626', '#ffd9a8']];

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(MOOD_KEYS);
  const M = MOODS[mood];
  const rf = rng.fork('family');
  const family = overrides.family ?? rf.weighted([['star', 5], ['plate', 3], ['column', 2]]);
  const F = FAMILIES[family];
  const form = overrides.form ?? rf.pick(Object.keys(F.forms));
  const rc = rng.fork('camera'), rl = rng.fork('light'), rs = rng.fork('crystal'), rm = rng.fork('decor');

  const sunAz = rl.range(-Math.PI, Math.PI);
  const sub = { ...M.sub };
  if (sub.kind === 'sapphire') [sub.color, sub.color2] = rm.pick(RHEINBERG);
  // (verre : la table lumineuse en dégradé, deux teintes pour les pentes)
  // (verre : le ciel derrière la vitre, du clair au soutenu)
  if (sub.kind === 'glass') [sub.color, sub.color2] = rm.pick([['#3c5476', '#0c1626'], ['#544a48', '#16141c'], ['#2f5258', '#0a1a1e'], ['#48466a', '#131226']]);
  if (sub.kind === 'wool') sub.color = rm.pick(['#26387a', '#6a1c24', '#3a3d44', '#2f4a32', '#7a6a58']);

  return {
    v: 1, seed, mood, family, form,
    loop: { duration: rc.pick([36, 40, 44]) },
    crystal: {
      size: r2(rs.range(...F.size)),
      seed: rs.int(1, 1e6),
      sigma: r3(rs.range(2, 8) * 1e-5),
      spin: r2(rs.range(0, Math.PI / 3)), // (orientation du cristal sur le support)
    },
    water: { theta: r2(M.theta * rm.range(0.95, 1.05)), thetaIce: r2(rm.range(0.75, 0.95)), bead: r2(rm.range(0.09, 0.13)) },
    camera: {
      el: r2(rc.range(...M.cam.el)), az: r2(rc.range(-Math.PI, Math.PI)), fov: M.cam.fov,
      sway: r2(rc.range(6, 12)), // (amplitude du balancement, degrés)
      fill: r2(rc.range(0.6, 0.7)), // (part de la largeur du cadre qu'occupe le sujet)
    },
    light: {
      key: { color: kelvinToHex(M.key.K), intensity: r2(M.key.I), az: r2(rl.range(...M.key.az)), el: M.key.el, soft: M.key.soft },
      rim: { color: kelvinToHex(M.rim.K), intensity: r2(M.rim.I) },
      sun: { color: kelvinToHex(M.sun.K), intensity: r2(M.sun.I), az: r2(sunAz), el: r2(rl.range(...M.sun.el)) },
    },
    sub,
    env: { intensity: r2(rl.range(...M.envI)) },
    sky: JSON.parse(JSON.stringify(M.sky)),
    fog: { color: M.bg, near: M.fog?.[0] ?? 10, far: M.fog?.[1] ?? 24 },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, form: R.form });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

// spécification du cristal pour le worker (gen/crystal.js)
export function crystalSpec(R, lite = false) {
  const F = FAMILIES[R.family], fo = F.forms[R.form];
  const a = R.light.sun.az - R.crystal.spin; // (soleil dans le repère du cristal)
  return {
    family: R.family, form: R.form, growth: fo.growth, then: fo.then, column: fo.column,
    R: lite ? 76 : 104, size: R.crystal.size, thick: F.thick ?? 0.03, seed: R.crystal.seed, sigma: R.crystal.sigma,
    sun: [r3(Math.cos(a)), r3(Math.sin(a))], thetaIce: R.water.thetaIce,
  };
}
