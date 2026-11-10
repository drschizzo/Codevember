// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase.
//
// Règles (skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main (bâti, métal, accent, table, cordes) ;
// - les lampes sont presque blanches (≥ 4 700 K), sauf le soleil de Midi et la
//   lampe du Cabinet, que le décor justifie ; la chaleur vient des matières,
//   du fond et de l'étalonnage ;
// - les cycles font un nombre ENTIER de tours (le compte-tours fait un tour
//   par boucle).
import { createRng } from './rng.js';
import { FINISHES, SETS } from './finishes.js';
import { CATALOGUE } from './plan.js';

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

// ── Cordes : une gaine tressée (deux fils de couleur), une rayure de repère
// qui rend la torsion lisible ; la paire a deux brins de couleurs différentes.
// [fond, fil du tressage, rayure, nom]
export const CORDS = {
  ivoireRouge: ['#e6dfd0', '#cfc6b2', '#b3261e', 'Coton ivoire, rayure rouge'],
  cramoisiOr: ['#7d1420', '#5c0d17', '#d9a640', 'Soie cramoisie, rayure or'],
  marineBlanc: ['#1d2b4a', '#121c33', '#eae6dc', 'Nylon marine, rayure blanche'],
  chanvreBleu: ['#b49a6c', '#8f784f', '#2c4f9a', 'Chanvre, rayure bleue'],
  noirJaune: ['#18171a', '#0e0d10', '#e2b416', 'Nylon noir, rayure jaune'],
  vertCuivre: ['#2d5a45', '#1d3c2e', '#d9874a', 'Coton vert, rayure cuivre'],
  orangeNoir: ['#d0581c', '#a8420f', '#141212', 'Orange de sécurité, rayure noire'],
  blancNoir: ['#ece9e2', '#d4d0c6', '#121212', 'Coton blanc, rayure noire'],
};

// ── Humeurs : chacune un décor (fond, sol, accessoires), une lumière, une
// valeur, un cadrage ─────────────────────────────────────────────────────────
// key : lampe principale (spot ou soleil) ; place : lumière du lieu
// (hémisphère, sans ombre) ; rims : contre-jours ; env : studio HDR ;
// accords : { frame, metal, accent, table } (jeux de finishes.js) ;
// cords : palettes permises ; cam : cadrage (distance, hauteur, champ).
export const MOODS = {
  corderie: {
    label: 'Corderie', decor: 'corderie', env: 'atelier', bg: '#1a120c', fogNear: 9, fogFar: 26,
    key: { kind: 'sun', K: 5200, lux: 3.6, az: -1.85, el: 0.42 }, place: { sky: '#8c97a8', ground: '#5a3f28', i: 0.55 },
    rims: [{ c: '#ffe0b8', i: 140, az: -0.6, el: 0.5 }, { c: '#c8d8ff', i: 40, az: 2.2, el: 0.3 }],
    envI: [0.35, 0.5], keyScale: 1,
    accords: [
      { frame: 'green', metal: 'brass', accent: 'copper', table: 'oak', arm: 'steel' },
      { frame: 'japan', metal: 'brass', accent: 'copper', table: 'oak', arm: 'brass' },
      { frame: 'oak', metal: 'brass', accent: 'japan', table: 'walnut', arm: 'steel' },
    ],
    cords: ['chanvreBleu', 'ivoireRouge', 'vertCuivre'],
    cam: { fov: [30, 36], dist: [1.0, 1.08], h: [0.05, 0.2] },
    grade: { contrast: 1.06, saturation: 1.02, shadows: [0.95, 0.98, 1.05], highlights: [1.06, 1.0, 0.92] },
  },
  cabinet: {
    label: 'Cabinet', decor: 'cabinet', env: 'night', bg: '#07060a', fogNear: 7, fogFar: 20,
    key: { kind: 'spot', K: 4300, cd: 520, az: -1.75, el: 0.3, angle: 0.6, pen: 0.55, dist: 6 }, place: { sky: '#2a3040', ground: '#1a1008', i: 0.14 },
    rims: [{ c: '#ffcf9a', i: 220, az: 0.9, el: 0.5 }, { c: '#9fb6ff', i: 60, az: 2.6, el: 0.25 }],
    envI: [0.28, 0.38], keyScale: 1,
    accords: [
      { frame: 'japan', metal: 'brass', accent: 'enamelDial', table: 'walnut', arm: 'brass' },
      { frame: 'walnut', metal: 'brass', accent: 'japan', table: 'walnut', arm: 'nickel' },
      { frame: 'oxblood', metal: 'brass', accent: 'japan', table: 'walnut', arm: 'brass' },
    ],
    cords: ['ivoireRouge', 'blancNoir', 'orangeNoir'],
    cam: { fov: [28, 34], dist: [0.95, 1.02], h: [0.25, 0.45] },
    grade: { contrast: 1.1, saturation: 0.98, shadows: [0.94, 0.96, 1.08], highlights: [1.06, 1.0, 0.9] },
  },
  epure: {
    label: 'Épure', decor: 'epure', env: 'cyclo', bg: '#d8d6d0', fogNear: 14, fogFar: 40,
    key: { kind: 'spot', K: 6000, cd: 520, az: -1.2, el: 1.25, angle: 0.75, pen: 1, dist: 9 }, place: { sky: '#f2f1ee', ground: '#cfcbc3', i: 0.55 },
    rims: [{ c: '#ffffff', i: 90, az: 0.9, el: 0.4 }, { c: '#eef2ff', i: 50, az: 2.6, el: 0.3 }],
    envI: [0.32, 0.42], keyScale: 0.75,
    accords: [
      { frame: 'japan', metal: 'nickel', accent: 'brass', table: 'ash', arm: 'nickel' },
      { frame: 'oxblood', metal: 'nickel', accent: 'japan', table: 'ash', arm: 'steel' },
      { frame: 'green', metal: 'steel', accent: 'brass', table: 'ash', arm: 'nickel' },
    ],
    cords: ['cramoisiOr', 'marineBlanc', 'noirJaune', 'orangeNoir'],
    cam: { fov: [30, 34], dist: [1.0, 1.1], h: [0.1, 0.25] },
    grade: { contrast: 1.0, saturation: 0.92, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1] },
  },
  muybridge: {
    label: 'Muybridge', decor: 'muybridge', env: 'studio', bg: '#040404', fogNear: 10, fogFar: 30,
    key: { kind: 'spot', K: 6500, cd: 900, az: 0.05, el: 0.12, angle: 0.32, pen: 0.35, dist: 8 }, place: { sky: '#0c0c0e', ground: '#050505', i: 0.03 },
    rims: [{ c: '#ffffff', i: 220, az: 2.7, el: 0.55 }, { c: '#ffffff', i: 60, az: -2.4, el: 0.4 }],
    envI: [0.22, 0.32], keyScale: 1,
    accords: [
      { frame: 'japan', metal: 'nickel', accent: 'enamelDial', table: 'ebonite', arm: 'nickel' },
      { frame: 'grey', metal: 'steel', accent: 'brass', table: 'ebonite', arm: 'steel' },
    ],
    cords: ['blancNoir', 'ivoireRouge', 'orangeNoir'],
    cam: { fov: [26, 30], dist: [0.95, 1.02], h: [0.0, 0.1] },
    grade: { contrast: 1.16, saturation: 0.8, shadows: [1, 1, 1.02], highlights: [1, 1, 0.99] },
  },
  mercerie: {
    label: 'Mercerie', decor: 'mercerie', env: 'softbox', bg: '#24170f', fogNear: 8, fogFar: 22,
    key: { kind: 'spot', K: 5000, cd: 420, az: -0.5, el: 0.55, angle: 0.8, pen: 1, dist: 8 }, place: { sky: '#d8c6a8', ground: '#4a2c1a', i: 0.32 },
    rims: [{ c: '#ffe2c4', i: 100, az: 2.4, el: 0.5 }, { c: '#ffd0e0', i: 40, az: -2.6, el: 0.3 }],
    envI: [0.35, 0.5], keyScale: 0.9,
    accords: [
      { frame: 'cream', metal: 'brass', accent: 'oxblood', table: 'walnut', arm: 'brass' },
      { frame: 'walnut', metal: 'brass', accent: 'cream', table: 'oak', arm: 'brass' },
      { frame: 'oxblood', metal: 'nickel', accent: 'brass', table: 'walnut', arm: 'nickel' },
    ],
    cords: ['marineBlanc', 'cramoisiOr', 'vertCuivre', 'chanvreBleu'],
    cam: { fov: [24, 28], dist: [1.0, 1.08], h: [0.15, 0.3] },
    grade: { contrast: 1.04, saturation: 1.1, shadows: [0.98, 0.96, 1.02], highlights: [1.04, 1.0, 0.96] },
  },
  essais: {
    label: "Salle d'essais", decor: 'essais', env: 'softbox', bg: '#11161a', fogNear: 9, fogFar: 28,
    key: { kind: 'spot', K: 7000, cd: 480, az: 0.4, el: 1.38, angle: 0.9, pen: 1, dist: 8 }, place: { sky: '#a8b8c4', ground: '#3c4246', i: 0.3 },
    rims: [{ c: '#d8ecff', i: 120, az: 2.9, el: 0.35 }, { c: '#ffffff', i: 40, az: -1.9, el: 0.6 }],
    envI: [0.3, 0.42], keyScale: 1,
    accords: [
      { frame: 'grey', metal: 'steel', accent: 'oxblood', table: 'japan', arm: 'steel' },
      { frame: 'green', metal: 'steel', accent: 'cream', table: 'japan', arm: 'nickel' },
    ],
    cords: ['orangeNoir', 'noirJaune', 'blancNoir'],
    cam: { fov: [32, 38], dist: [0.95, 1.02], h: [-0.35, -0.2] },
    grade: { contrast: 1.06, saturation: 0.9, shadows: [0.94, 1.0, 1.08], highlights: [0.98, 1.0, 1.04] },
  },
  midi: {
    label: 'Midi', decor: 'midi', env: 'cyclo', bg: '#b8c6d6', fogNear: 14, fogFar: 40,
    key: { kind: 'sun', K: 5600, lux: 4.5, az: 0.55, el: 0.62 }, place: { sky: '#9cb8de', ground: '#cdbfa4', i: 0.75 },
    rims: [{ c: '#ffffff', i: 40, az: 2.4, el: 0.4 }, { c: '#dde8ff', i: 20, az: -2.6, el: 0.3 }],
    envI: [0.28, 0.36], keyScale: 0.75,
    accords: [
      { frame: 'japan', metal: 'brass', accent: 'copper', table: 'oak', arm: 'brass' },
      { frame: 'green', metal: 'brass', accent: 'cream', table: 'oak', arm: 'steel' },
      { frame: 'oxblood', metal: 'nickel', accent: 'brass', table: 'ash', arm: 'nickel' },
    ],
    cords: ['marineBlanc', 'cramoisiOr', 'noirJaune'],
    cam: { fov: [32, 38], dist: [1.05, 1.15], h: [0.05, 0.2] },
    grade: { contrast: 1.04, saturation: 1.0, shadows: [0.94, 0.98, 1.06], highlights: [1.03, 1.0, 0.97] },
  },
};

// Finitions complètes d'un jeu de matériaux (face externe, interne, tranche)
export function finishOf(setKey) {
  const S = SETS[setKey];
  const fin = (k) => ({ ...FINISHES[k], preset: k });
  return { set: setKey, outer: fin(S.outer), inner: fin(S.inner), edge: fin(S.edge), wear: S.wear ?? 0 };
}

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const moodKeys = Object.keys(MOODS);
  const mood = overrides.mood ?? rng.fork('mood').pick(moodKeys);
  const M = MOODS[mood];
  const ra = rng.fork('accord'), rf = rng.fork('family'), rc = rng.fork('camera'), rl = rng.fork('light'), rm = rng.fork('motion');
  const A = ra.pick(M.accords);
  const family = overrides.family ?? rf.pick(Object.keys(CATALOGUE));
  const fam = CATALOGUE[family];
  const cordKey = ra.pick(M.cords);
  const cord2Key = ra.pick(M.cords.filter((k) => k !== cordKey));
  const rate = r2(rm.range(0.85, 1.15));
  const cycles = fam.cycles.map((K, i) => ({ K, rate: r2(rate * (i === 0 ? 1.1 : 1)), settle: fam.settle[i] }));

  const key = M.key.kind === 'sun'
    ? { kind: 'sun', color: kelvinToHex(M.key.K + rl.range(-150, 150)), intensity: r2(M.key.lux * rl.range(0.92, 1.08)), az: r2(M.key.az + rl.range(-0.12, 0.12)), el: r2(M.key.el + rl.range(-0.05, 0.05)) }
    : { kind: 'spot', color: kelvinToHex(M.key.K + rl.range(-150, 150)), intensity: r2(M.key.cd * rl.range(0.92, 1.08)), az: r2(M.key.az + rl.range(-0.12, 0.12)), el: r2(M.key.el + rl.range(-0.04, 0.04)), angle: M.key.angle, penumbra: M.key.pen, dist: M.key.dist };

  return {
    v: 1, seed, mood, family,
    loop: { duration: 0 }, // (fixée par la simulation : le temps du film)
    sim: { dashpot: 15, imperfection: r2(rm.range(0, 6.28)) },
    cycles,
    cord: { palette: cordKey, palette2: cord2Key, sheen: r2(ra.range(0.2, 0.5)), stripes: ra.pick([1, 1, 2]) },
    bench: {
      frame: finishOf(A.frame), metal: finishOf(A.metal), accent: finishOf(A.accent), arm: finishOf(A.arm), table: finishOf(A.table),
      dial: finishOf('enamelDial'), copper: finishOf('copper'), belt: finishOf('leather'),
    },
    camera: {
      fov: r2(rc.range(...M.cam.fov)), dist: r2(rc.range(...M.cam.dist)), height: r2(rc.range(...M.cam.h)),
      side: r2(rc.range(0.35, 0.75) * rc.pick([1, -1])), sway: r2(rc.range(0.15, 0.3)),
    },
    light: {
      key,
      place: { ...M.place, i: r2(M.place.i * rl.range(0.9, 1.1)) },
      rim: M.rims.map((r) => ({ color: r.c, intensity: r2(r.i * rl.range(0.85, 1.15) * (M.keyScale ?? 1)), az: r.az, el: r.el })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envI)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: M.fogNear, far: M.fogFar },
    decor: { kind: M.decor, variant: rng.fork('decor').int(0, 2) },
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
