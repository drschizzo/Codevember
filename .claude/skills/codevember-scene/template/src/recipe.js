// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Règles (voir la skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) : ajouter un tirage ne
//   change pas les autres, une graine reste reconnaissable d'une version à
//   l'autre ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main ;
// - les lampes sont presque blanches, la chaleur vient des matières, du fond,
//   des contre-jours et de l'étalonnage ;
// - tout mouvement fait un nombre ENTIER de tours (ou de périodes) par boucle.
import { createRng } from './rng.js';
import { FINISHES, SETS, TINTS } from './finishes.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)

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
// env : studio HDR (scene/env.js) ; bg : fond et brume ; keyK : température
// de la lampe (≥ 4700 K : presque blanche) ; rim : contre-jours ; grade :
// étalonnage (contraste, saturation, teinte des ombres et des hautes
// lumières) ; keyScale, envIntensity : dosage des lampes et du studio
// (une humeur claire en demande bien moins) ; accords : [structure, pièce principale, accent, [riches]].
// (À REMPLACER par les humeurs du thème : 6 à 8, contrastées, dont au moins une
// claire et une froide.)
export const MOODS = {
  atelier: {
    label: 'Atelier', env: 'atelier', bg: '#0b0907', keyK: 4800, rim: ['#ffd2a0', '#c4d4ff'],
    accords: [['blackSteel', 'guilloche', 'bronze', ['marble', 'verdigris']], ['damascus', 'urushi', 'goldLeaf', ['marble', 'celadon']]],
    grade: { contrast: 1.04, saturation: 0.97, shadows: [0.94, 0.99, 1.07], highlights: [1.05, 1.0, 0.93] },
  },
  studio: {
    label: 'Studio', env: 'studio', bg: '#07080a', keyK: 5600, rim: ['#9fc4ff', '#ffffff'],
    accords: [['chrome', 'ceramicBlack', 'anodizedDiamond', ['guillocheSilver', 'marble']], ['carbon', 'ceramicWhite', 'titanium', ['damascus', 'chrome']]],
    grade: { contrast: 1.06, saturation: 0.92, shadows: [0.96, 1.0, 1.06], highlights: [1, 1, 1] },
  },
  clinique: {
    label: 'Clinique', env: 'cyclo', bg: '#d9d8d4', keyK: 6200, rim: ['#ffffff', '#dfe8ff'], keyScale: 0.6, envIntensity: [0.32, 0.45],
    accords: [['chrome', 'ceramicWhite', 'nacre', ['marble', 'celadon']], ['ceramicWhite', 'chrome', 'kintsugi', ['nacre', 'marble']]],
    grade: { contrast: 0.98, saturation: 0.85, shadows: [0.97, 1.0, 1.04], highlights: [1, 1, 1] },
  },
  nuit: {
    label: 'Nuit', env: 'night', bg: '#04050a', keyK: 7000, rim: ['#5a7dff', '#ff6fb0'],
    accords: [['blackSteel', 'titanium', 'soap', ['obsidian', 'nero']], ['carbon', 'obsidian', 'anodizedDiamond', ['damascus', 'blackSteel']]],
    grade: { contrast: 1.1, saturation: 1.05, shadows: [0.9, 0.96, 1.12], highlights: [1, 1, 1.02] },
  },
};

// Finitions complètes d'un jeu de matériaux (face externe, interne, tranche),
// teinte d'accent éventuelle (une seule par scène)
export function finishOf(setKey, tint = null) {
  const S = SETS[setKey];
  const fin = (k) => {
    const F = { ...FINISHES[k], preset: k };
    if (tint && ['anodized', 'anodizedMatte', 'lacquer', 'lacquerMatte', 'glaze'].includes(k)) F.color = tint;
    return F;
  };
  return { set: setKey, outer: fin(S.outer), inner: fin(S.inner), edge: fin(S.edge), wear: S.wear ?? 0 };
}

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const ra = rng.fork('accord');
  const [frame, hero, accent, rich] = ra.pick(M.accords);
  const tint = ra.pick(TINTS.anodized);
  const rc = rng.fork('camera'), rl = rng.fork('light'), rm = rng.fork('motion');

  // pièces de démonstration (À REMPLACER par la génération du thème)
  const count = rm.int(5, 9);
  const pieces = Array.from({ length: count }, (_, i) => ({
    kind: i === 0 ? 'hero' : 'satellite',
    size: i === 0 ? r2(rm.range(0.55, 0.75)) : r2(rm.range(0.12, 0.22)),
    round: r2(rm.range(0.04, 0.12)),
    finish: finishOf(i === 0 ? hero : i % 3 === 0 ? accent : frame, tint),
  }));

  return {
    v: 1, seed, mood,
    loop: { duration: rm.pick([16, 20, 24]) },
    camera: { fov: r2(rc.range(30, 38)), dist: r2(rc.range(5.2, 6.4)), height: r2(rc.range(0.6, 1.6)), orbit: rc.pick([0, 1, -1]), sway: r2(rc.range(0.02, 0.06)) },
    motion: { spin: rm.pick([1, -1, 2]), orbit: rm.pick([1, -1]), bob: rm.pick([2, 3]), bobAmp: r2(rm.range(0.04, 0.1)) },
    light: {
      key: { color: kelvinToHex(M.keyK + rl.range(-200, 200)), intensity: r2(rl.range(550, 850) * (M.keyScale ?? 1)), az: r2(rl.range(-2.4, -1.6)), el: r2(rl.range(0.8, 1.1)), angle: 0.5, penumbra: 0.7 },
      rim: M.rim.map((c, i) => ({ color: c, intensity: r2((i ? rl.range(60, 200) : rl.range(300, 500)) * (M.keyScale ?? 1)), az: r2(i ? 2.3 : 0.8), el: r2(rl.range(0.25, 0.5)) })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...(M.envIntensity ?? [0.5, 0.85]))), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: 7, far: 22 },
    floor: { finish: finishOf(rich[0]) },
    grade: { ...M.grade },
    pieces,
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
