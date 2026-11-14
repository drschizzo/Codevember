// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Une scène = une famille (le geste), un oiseau (le plumage, le motif), une
// humeur (le décor, la lumière, la valeur, le cadrage), une forme tirée.
// Les lampes sont presque blanches ; la chaleur vient du fond, des contre-jours
// et de l'étalonnage (sauf la lanterne, une flamme : justifiée).
import { createRng } from '../../shared/rng.js';
import { FAMILIES, BIRDS, birdsOf } from './families.js';
import { shapeOf } from './gen/feather.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
// luminance relative d'une couleur sRGB
export const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Humeurs : des décors, pas des teintes ────────────────────────────────────
// bg : fond [haut, bas] ; glow : lueur du fond à l'opposé de la caméra (un
// soleil voilé, une fenêtre) ; env : studio HDR ; key / rim / fill : lampes
// (az : azimut par rapport à la caméra — 0 de face, π à contre-jour ; el :
// hauteur ; soft : taille de la source) ; cam : cadrage (el : plongée, d :
// distance en longueurs de plume, az : de trois quarts…) ; grade : étalonnage.
export const MOODS = {
  cabinet: {
    label: 'Cabinet', value: 'très claire', bg: ['#ece7dd', '#d3ccc0'], glow: [0.0, '#ffffff'], env: 'cyclo', envI: 0.42,
    key: { az: 0.55, el: 1.15, K: 5600, I: 2.4, soft: 0.85 }, rim: { az: 2.7, el: 0.6, K: 6000, I: 0.9 }, fill: { az: -1.2, el: 0.3, K: 6200, I: 0.35 },
    cam: { el: 0.5, d: 1.2, az: 0.35, fov: 30 }, fog: 0.0,
    grade: { contrast: 0.98, saturation: 0.95, shadows: [0.98, 1.0, 1.03], highlights: [1.0, 1.0, 0.99], exposure: 0.95 },
  },
  contrejour: {
    label: 'Contre-jour', value: 'sombre', bg: ['#2b1e14', '#0b0806'], glow: [0.9, '#ffcf96'], env: 'dusk', envI: 0.25,
    key: { az: 3.0, el: 0.32, K: 4800, I: 4.2, soft: 0.2 }, rim: { az: 0.4, el: 0.4, K: 5200, I: 0.25 }, fill: { az: -1.0, el: 0.6, K: 5000, I: 0.12 },
    cam: { el: 0.22, d: 1.1, az: 0.3, fov: 32 }, fog: 0.15,
    grade: { contrast: 1.08, saturation: 1.05, shadows: [0.98, 0.96, 0.98], highlights: [1.05, 1.0, 0.92], exposure: 1.15 },
  },
  nord: {
    label: 'Fenêtre nord', value: 'moyenne et froide', bg: ['#a3adb5', '#6c7680'], glow: [0.35, '#e4ecf4'], env: 'overcast', envI: 0.5,
    key: { az: 1.55, el: 0.45, K: 7200, I: 2.2, soft: 1.0 }, rim: { az: 2.9, el: 0.3, K: 7500, I: 0.6 }, fill: { az: -1.4, el: 0.4, K: 6800, I: 0.3 },
    cam: { el: 0.35, d: 1.25, az: 0.5, fov: 30 }, fog: 0.1,
    grade: { contrast: 1.02, saturation: 0.9, shadows: [0.94, 0.99, 1.07], highlights: [0.99, 1.0, 1.03], exposure: 1.05 },
  },
  soleil: {
    label: 'Plein soleil', value: 'claire et contrastée', bg: ['#cfe0ee', '#a9bccb'], glow: [0.2, '#ffffff'], env: 'clearsky', envI: 0.45,
    key: { az: 0.95, el: 1.25, K: 5700, I: 5.0, soft: 0.05 }, rim: { az: 2.5, el: 0.7, K: 9000, I: 0.4 }, fill: { az: -1.6, el: 0.5, K: 8000, I: 0.25 },
    cam: { el: 0.45, d: 1.3, az: 0.25, fov: 28 }, fog: 0.05,
    grade: { contrast: 1.08, saturation: 1.05, shadows: [0.94, 0.98, 1.08], highlights: [1.03, 1.01, 0.97], exposure: 0.9 },
  },
  brume: {
    label: 'Brume', value: 'claire, faible contraste', bg: ['#cdcecb', '#a9aba8'], glow: [0.5, '#f4f4f0'], env: 'fogwhite', envI: 0.6,
    key: { az: 0.3, el: 0.9, K: 6400, I: 1.2, soft: 1.0 }, rim: { az: 2.8, el: 0.4, K: 6600, I: 0.7 }, fill: { az: -1.5, el: 0.2, K: 6500, I: 0.4 },
    cam: { el: 0.4, d: 1.35, az: 0.45, fov: 32 }, fog: 0.55,
    grade: { contrast: 0.92, saturation: 0.82, shadows: [0.99, 1.0, 1.01], highlights: [1.0, 1.0, 1.0], exposure: 1.05 },
  },
  lanterne: {
    label: 'Lanterne', value: 'très sombre', bg: ['#120c08', '#040302'], glow: [0.0, '#000000'], env: 'night', envI: 0.15,
    key: { az: 1.75, el: 0.18, K: 4100, I: 6.5, soft: 0.15 }, rim: { az: 3.0, el: 0.6, K: 8500, I: 1.2 }, fill: { az: -0.6, el: 0.2, K: 4500, I: 0.06 },
    cam: { el: 0.28, d: 1.0, az: 0.4, fov: 34 }, fog: 0.2,
    grade: { contrast: 1.06, saturation: 1.0, shadows: [1.0, 0.97, 1.02], highlights: [1.04, 1.0, 0.94], exposure: 1.7 },
  },
  studio: {
    label: 'Studio noir', value: 'sombre, irisée', bg: ['#0b0b0d', '#030304'], glow: [0.15, '#8090a8'], env: 'studio', envI: 0.6,
    key: { az: 1.0, el: 1.05, K: 5800, I: 3.0, soft: 0.6 }, rim: { az: 2.75, el: 0.35, K: 6500, I: 1.8 }, fill: { az: -0.3, el: 1.0, K: 6000, I: 0.15 },
    cam: { el: 0.32, d: 1.05, az: 0.55, fov: 30 }, fog: 0.1,
    grade: { contrast: 1.08, saturation: 1.08, shadows: [0.96, 0.98, 1.04], highlights: [1.0, 1.0, 1.0], exposure: 1.1 },
  },
};

// humeurs préférées par oiseau (le blanc tranche sur le sombre, le noir sur le clair)
const PREFER = {
  cygne: ['nord', 'contrejour', 'lanterne', 'studio', 'brume'],
  aigrette: ['contrejour', 'lanterne', 'studio', 'nord'],
  autruche: ['cabinet', 'brume', 'soleil', 'nord', 'contrejour'],
  corbeau: ['cabinet', 'brume', 'soleil', 'nord', 'studio'],
  paon: ['studio', 'lanterne', 'contrejour', 'cabinet', 'nord'],
  geai: ['cabinet', 'soleil', 'brume', 'lanterne', 'studio', 'contrejour'],
  martin: ['cabinet', 'soleil', 'brume', 'lanterne', 'studio', 'contrejour'],
};

const FAMILY_WEIGHTS = [['vexille', 0.46], ['ocelle', 0.18], ['duvet', 0.16], ['plume', 0.2]];

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const rf = rng.fork('family'), rb = rng.fork('bird'), rs = rng.fork('shape'), rc = rng.fork('camera'), rl = rng.fork('light');
  const family = overrides.family ?? rf.weighted(FAMILY_WEIGHTS);
  const bird = overrides.bird && BIRDS[overrides.bird]?.family === family ? overrides.bird : rb.pick(birdsOf(family));
  const B = BIRDS[bird];
  // (l'objet tranche sur son fond : on écarte les humeurs dont le fond a la
  // valeur du plumage — le pigeon gris devant la fenêtre nord grise)
  const contrast = (m) => { const f = lum(B.base), b = (lum(MOODS[m].bg[0]) + lum(MOODS[m].bg[1])) / 2; return Math.max(f, b) / Math.max(1e-3, Math.min(f, b)); };
  let pool = (PREFER[bird] ?? Object.keys(MOODS)).filter((m) => contrast(m) > 1.6 || B.irid[0] > 0.5 || family === 'ocelle');
  if (!pool.length) pool = Object.keys(MOODS);
  const mood = overrides.mood ?? rng.fork('mood').pick(pool);
  const M = MOODS[mood];
  const shape = shapeOf(family, rs, bird);
  for (const k of Object.keys(shape)) if (typeof shape[k] === 'number') shape[k] = r3(shape[k]);
  const kelvin = (K) => kelvinToHex(K + rl.range(-150, 150));
  const light = (o) => ({ az: r2(o.az + rl.range(-0.12, 0.12)), el: r2(o.el + rl.range(-0.06, 0.06)), color: kelvin(o.K), intensity: r2(o.I * rl.range(0.92, 1.08)), soft: r2(o.soft ?? 0.5) });
  return {
    v: 1, seed, family, bird, mood,
    loop: { duration: 36 },
    shape,
    pattern: { ...B.pattern, seed: `${seed}` },
    look: {
      base: B.base, mark: B.mark, down: B.down, rachis: B.rachis, sheath: B.sheath, eye: B.eye ?? null,
      irid: B.irid[0], iridLo: B.irid[1], iridHi: B.irid[2], bragg: B.bragg ?? 0, iridMark: B.iridMark ?? 0, blue: B.blue, sheen: family === 'duvet' ? 0.9 : 0.5, translucency: 1,
    },
    camera: { fov: M.cam.fov, el: r2(M.cam.el + rc.range(-0.06, 0.06)), az: r2((M.cam.az + rc.range(-0.1, 0.1)) * (rc.range(0, 1) < 0.5 ? -1 : 1)), d: r2(M.cam.d * rc.range(0.95, 1.08)), drift: r2(rc.range(0.18, 0.32)) },
    light: { key: light(M.key), rim: light(M.rim), fill: light(M.fill) },
    env: { preset: M.env, intensity: r2(M.envI * rl.range(0.9, 1.1)), rotation: r2(rl.range(0, Math.PI * 2)) },
    bg: { top: M.bg[0], bottom: M.bg[1], glow: M.glow[0], glowColor: M.glow[1] },
    fog: { color: M.bg[1], density: M.fog },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family, bird: R.bird });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
export { FAMILIES, BIRDS };
