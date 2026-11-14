// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase.
//
// Règles (skill codevember-scene, art-direction.md) :
// - chaque tirage a son flux (rng.fork('…')) ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a ses
//   accords d'appareil composés à la main, et ses fils ;
// - la lumière de la pièce est presque blanche ; la chaleur vient des lampes
//   des lanternes (des lampes à filament : une lueur que le thème justifie),
//   du fond et de l'étalonnage ;
// - une humeur est d'abord un décor (fond, sol, lumière, valeur, cadrage).
// Module pur (sans three) : tests Node.
import { createRng } from '../../shared/rng.js';
import { SHAPES } from './gen/profile.js';
import { FAMILIES } from './gen/winding.js';
import { fitDistance } from './timeline.js';

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

// ── Fils ─────────────────────────────────────────────────────────────────────
// color : teinte du fil (albédo) ; tau : transmission d'une épaisseur de fil
// (la lanterne luit à travers) ; spec : teinte du reflet (R) ; shift : décalage
// des lobes le long de la fibre (Marschner) ; rough : largeur des lobes ;
// glow : teinte de la lumière diffusée vers l'avant dans la fibre ; metal : fil
// de cuivre (reflet coloré, opaque).
export const THREADS = {
  grege:   { label: 'Soie grège',        color: '#ece2cc', tau: 0.42, spec: '#fff6e6', shift: 0.08, rough: 0.28, glow: '#fff0d8', metal: 0 },
  doree:   { label: 'Soie dorée',        color: '#e3b04c', tau: 0.36, spec: '#fff0c8', shift: 0.07, rough: 0.22, glow: '#ffe0a0', metal: 0 },
  tussah:  { label: 'Tussah',            color: '#b98a55', tau: 0.3,  spec: '#ffe9cf', shift: 0.09, rough: 0.34, glow: '#ffdcb0', metal: 0 },
  yamamai: { label: 'Yamamaï',           color: '#c8d6a2', tau: 0.4,  spec: '#f6ffe8', shift: 0.07, rough: 0.24, glow: '#e8ffb8', metal: 0 },
  noire:   { label: 'Soie noire',        color: '#1d1a19', tau: 0.12, spec: '#fff8f0', shift: 0.06, rough: 0.2,  glow: '#ff9a50', metal: 0 },
  lin:     { label: 'Lin écru',          color: '#c9bea6', tau: 0.26, spec: '#efe8da', shift: 0.12, rough: 0.55, glow: '#fff0dc', metal: 0 },
  cuivre:  { label: 'Fil de cuivre',     color: '#f3b89c', tau: 0.0,  spec: '#fad0c0', shift: 0.0,  rough: 0.18, glow: '#000000', metal: 1 },
  verre:   { label: 'Fibre de verre',    color: '#e8f0f2', tau: 0.72, spec: '#ffffff', shift: 0.02, rough: 0.1,  glow: '#fff4dc', metal: 0 },
};

// ── Appareils : accords de matières (structure, ferrures, cage, bois) ──────
// structure : colonne, fléau ; ferrures : paliers, poulies, ailettes ; cage :
// fil des côtes ; bois : socle et embouts. Une seule matière chaude par
// accord (l'or en accent, jamais sur deux rôles majeurs).
export const ACCORDS = {
  laitonNoyer: { label: 'Laiton et noyer', structure: 'walnut', fittings: 'brass', cage: 'brass', wood: 'walnut', eye: 'porcelain' },
  acierBuis:   { label: 'Acier bleui et buis', structure: 'blueSteel', fittings: 'nickel', cage: 'steel', wood: 'boxwood', eye: 'porcelain' },
  nickelEbene: { label: 'Nickel et ébène', structure: 'ebony', fittings: 'nickel', cage: 'nickel', wood: 'ebony', eye: 'agate' },
  fonteVerte:  { label: 'Fonte laquée et laiton', structure: 'greenEnamel', fittings: 'brass', cage: 'blackWire', wood: 'walnut', eye: 'porcelain' },
  noirLaiton:  { label: 'Fonte noire et laiton', structure: 'blackIron', fittings: 'brass', cage: 'brass', wood: 'ebony', eye: 'porcelain' },
};

// ── Humeurs : des décors ─────────────────────────────────────────────────────
// room : murs et sol (couleur, rugosité), baie (lumière de fond), brume ;
// key : lumière de la pièce (nature, direction, dureté) ; lamp : température
// et puissance des lampes des lanternes ; threads / accords : ce que l'humeur
// accepte ; camera : cadrage ; grade : étalonnage.
export const MOODS = {
  magnanerie: {
    label: 'Magnanerie', value: 'claire',
    room: { wall: '#dcd6cb', floor: '#c9b8a3', wallRough: 0.92, floorRough: 0.8, tiles: 1, haze: 0.004, window: 0 },
    key: { kind: 'window', K: 5600, power: 1.0, az: -2.3, el: 0.62, soft: 0.85 },
    fill: 0.35, env: 'cyclo', envIntensity: 0.45,
    lamp: { K: 4000, power: 0.3, glow: 0.4 },
    threads: ['grege', 'doree', 'lin', 'yamamai'], accords: ['laitonNoyer', 'acierBuis', 'fonteVerte'],
    camera: { el: [0.1, 0.2], dist: [1.6, 1.85], az: [0.7, 0.95] },
    grade: { exposure: 1, contrast: 1.0, saturation: 0.92, shadows: [0.98, 0.99, 1.03], highlights: [1.03, 1.0, 0.95] },
  },
  chambreNoire: {
    label: 'Chambre noire', value: 'très sombre',
    room: { wall: '#403b37', floor: '#2f2b28', wallRough: 0.95, floorRough: 0.85, tiles: 0, haze: 0.035, window: 0 },
    key: { kind: 'none', K: 5000, power: 0, az: 0, el: 0.6, soft: 0.5 },
    fill: 0.02, env: 'night', envIntensity: 0.05,
    lamp: { K: 3700, power: 0.8, glow: 0.6 },
    threads: ['grege', 'doree', 'tussah', 'verre', 'cuivre'], accords: ['noirLaiton', 'nickelEbene', 'laitonNoyer'],
    camera: { el: [-0.06, 0.04], dist: [1.45, 1.7], az: [0.75, 1.0] },
    grade: { exposure: 1, contrast: 1.08, saturation: 1.0, shadows: [0.92, 0.96, 1.06], highlights: [1.04, 1.0, 0.94] },
  },
  heureBleue: {
    label: 'Heure bleue', value: 'sombre, froide',
    room: { wall: '#3b4250', floor: '#3a3c40', wallRough: 0.9, floorRough: 0.35, tiles: 0, haze: 0.012, window: 1, windowColor: '#6d8fd0', windowPower: 1.6 },
    key: { kind: 'sky', K: 9000, power: 0.55, az: 3.14, el: 0.35, soft: 0.9 },
    fill: 0.1, env: 'night', envIntensity: 0.18,
    lamp: { K: 3800, power: 0.8, glow: 0.55 },
    threads: ['grege', 'doree', 'yamamai', 'noire'], accords: ['acierBuis', 'nickelEbene', 'noirLaiton'],
    camera: { el: [0.0, 0.08], dist: [1.55, 1.8], az: [0.8, 1.05] },
    grade: { exposure: 1, contrast: 1.05, saturation: 0.95, shadows: [0.88, 0.95, 1.12], highlights: [1.05, 1.0, 0.92] },
  },
  filature: {
    label: 'Filature', value: 'moyenne',
    room: { wall: '#8d8a85', floor: '#76736e', wallRough: 0.85, floorRough: 0.7, tiles: 0, haze: 0.006, window: 0, concrete: 1 },
    key: { kind: 'skylight', K: 6000, power: 0.55, az: -1.2, el: 1.25, soft: 0.25 }, // (le haut du cocon fait face à la verrière : à 1,3, il brûlait)
    fill: 0.25, env: 'atelier', envIntensity: 0.3,
    lamp: { K: 4100, power: 0.4, glow: 0.55 },
    threads: ['grege', 'lin', 'tussah', 'cuivre', 'noire'], accords: ['fonteVerte', 'acierBuis', 'noirLaiton'],
    camera: { el: [0.32, 0.45], dist: [1.7, 1.95], az: [0.65, 0.9] },
    grade: { exposure: 0.95, contrast: 1.06, saturation: 0.88, shadows: [0.97, 0.99, 1.03], highlights: [1.02, 1.0, 0.97] },
  },
  shoji: {
    label: 'Shōji', value: 'claire derrière',
    room: { wall: '#efe8da', floor: '#4a3f36', wallRough: 0.95, floorRough: 0.6, tiles: 0, haze: 0.006, window: 2, windowColor: '#fff3df', windowPower: 2.2 },
    key: { kind: 'back', K: 5200, power: 0.5, az: 3.14, el: 0.3, soft: 0.95 },
    fill: 0.12, env: 'cyclo', envIntensity: 0.22,
    lamp: { K: 3800, power: 0.4, glow: 0.5 },
    threads: ['grege', 'noire', 'tussah', 'doree'], accords: ['nickelEbene', 'noirLaiton', 'laitonNoyer'],
    camera: { el: [0.02, 0.1], dist: [1.75, 2.0], az: [0.35, 0.5] },
    grade: { exposure: 1, contrast: 1.03, saturation: 0.9, shadows: [1.0, 0.98, 0.97], highlights: [1.02, 1.0, 0.96] },
  },
  laque: {
    label: 'Laque', value: 'sombre, chaude',
    room: { wall: '#4a1210', floor: '#0f0c0b', wallRough: 0.45, floorRough: 0.5, tiles: 0, haze: 0.012, window: 0 },
    key: { kind: 'top', K: 4800, power: 0.5, az: 0.6, el: 1.38, soft: 0.2 }, // (la douche tombe sur le cocon : à 1, il brûlait)
    fill: 0.06, env: 'night', envIntensity: 0.1,
    lamp: { K: 3400, power: 0.75, glow: 0.45 },
    threads: ['doree', 'grege', 'cuivre', 'noire'], accords: ['noirLaiton', 'nickelEbene'],
    camera: { el: [0.04, 0.12], dist: [1.15, 1.35], az: [0.85, 1.1], close: 1 },
    grade: { exposure: 1, contrast: 1.1, saturation: 1.02, shadows: [1.02, 0.95, 0.93], highlights: [1.04, 0.99, 0.92] },
  },
  brouillard: {
    label: 'Brouillard', value: 'moyenne, sans ombres',
    room: { wall: '#a9acab', floor: '#9a9c9a', wallRough: 0.95, floorRough: 0.9, tiles: 0, haze: 0.06, window: 0 },
    key: { kind: 'diffuse', K: 6500, power: 0.25, az: -0.8, el: 0.9, soft: 1.0 },
    fill: 0.3, env: 'cyclo', envIntensity: 0.3,
    lamp: { K: 3900, power: 0.5, glow: 0.45 },
    threads: ['grege', 'yamamai', 'verre', 'lin'], accords: ['acierBuis', 'laitonNoyer', 'nickelEbene'],
    camera: { el: [0.06, 0.16], dist: [2.0, 2.3], az: [0.7, 0.9] },
    grade: { exposure: 1, contrast: 0.96, saturation: 0.85, shadows: [0.98, 1.0, 1.02], highlights: [1.0, 1.0, 1.0] },
  },
};

// formes de cage préférées par famille (toutes possibles au panneau)
const FAMILY_SHAPES = {
  losange: ['ovoid', 'spindle', 'peanut', 'sphere', 'bicone'],
  cerclage: ['capsule', 'sphere', 'ovoid', 'pear'],
  huit: ['peanut', 'ovoid', 'pear', 'sphere'],
  meridien: ['sphere', 'pear', 'ovoid', 'bicone'],
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rf = rng.fork('family'), rc = rng.fork('cage'), rt = rng.fork('thread'), ra = rng.fork('accord');
  const rk = rng.fork('camera'), rl = rng.fork('light'), rw = rng.fork('wind'), rm = rng.fork('tempo');
  const family = overrides.family ?? rf.pick(Object.keys(FAMILIES));
  const shape = rc.pick(FAMILY_SHAPES[family]);
  const thread = overrides.thread ?? rt.pick(M.threads);
  const accord = ra.pick(M.accords);
  // ruban : fils jointifs ; le huit a un ruban étroit (la « bave »)
  const nb = family === 'huit' ? rw.int(4, 6) : rw.int(9, 14);
  const d = r3(thread === 'cuivre' ? rw.range(0.0011, 0.0014) : rw.range(0.0014, 0.0019));
  const R = r3(rc.range(0.12, 0.14));
  const camD = rk.range(...M.camera.dist);
  // (la caméra est du côté de la lanterne qui s'enroule : elle s'en approche pendant le transfert)
  const fov = r2(rk.range(28, 34)), camEl = r2(rk.range(...M.camera.el)), camAz = r2(rk.range(...M.camera.az));
  const bias = r2(M.camera.close ? 0.36 : rk.range(0.12, 0.2));
  // (un gros plan peut couper la lanterne lointaine ; les autres la gardent)
  const dist = M.camera.close ? camD : Math.max(camD, fitDistance(camAz, camEl, fov, bias) * 0.97);
  return {
    v: 1, seed, mood, family,
    loop: { duration: rm.pick([56, 60, 64]) },
    cage: { shape, R, hub: r3(family === 'meridien' ? 0.016 : rc.range(0.02, 0.026)), ribs: rc.pick([12, 16, 18, 24]), wire: 0.0016 },
    band: { threads: nb, thread: d, gap: 1.05, width: r3(nb * d * 1.05) },
    wind: {
      c1: r2(rw.range(0.5, 0.62)), n1: rw.pick([7, 8, 9]), c2: r2(rw.range(0.24, 0.34)),
      ribs: rw.pick([4, 5, 6]), mu: r2(rw.range(0.75, 0.9)),
      amp: r3(rw.range(0.032, 0.045)), k: r2(rw.range(1.05, 1.25)), passes: 2,
    },
    thread: (({ label, ...T }) => ({ kind: thread, ...T }))(THREADS[thread]),
    accord,
    tempo: {
      // parts de la boucle : repos, transfert, rangement, relève (demi-tour du fléau)
      t0: 0.03, t1: 0.79, s0: 0.82, s1: 0.97,
      // vitesse relative de chaque régime (armature lente, fermeture accélérée, finition lente)
      speeds: [1, r2(rm.range(1.9, 2.5)), 1.1],
      overshoot: r2(rm.range(0.03, 0.07)), // dépassement du fléau à la relève (rad)
    },
    camera: {
      fov, dist: r2(dist), el: camEl, az: camAz, sway: r2(rk.range(0.02, 0.04)), bias, close: r2(rk.range(0.75, 0.95)), closeDist: r2(rk.range(0.85, 1.05)),
    },
    light: {
      key: { ...M.key, color: kelvinToHex(M.key.K), power: r2(M.key.power * rl.range(0.9, 1.1)), az: r2(M.key.az + rl.range(-0.25, 0.25)) },
      // thread : part de la lampe reçue en direct par les fils (threads.js,
      // lampThread) ; glow : la lueur à travers la paroi. Dosés au posemètre
      // (cocoon.meter) : la soie, sous ses deux lampes, à une médiane de 1 à
      // 1,5 en scène linéaire (le dessin du ruban se lit sous l'épaule d'AgX)
      fill: r2(M.fill), lamp: { K: M.lamp.K, color: kelvinToHex(M.lamp.K), power: r2(M.lamp.power * rl.range(0.9, 1.1)), size: 0.004, thread: 0.15, glow: r3(0.019 * (M.lamp.glow ?? 1) / Math.max(0.15, THREADS[thread].tau / 0.4)) },
    },
    room: { ...M.room },
    env: { preset: M.env, intensity: r2(M.envIntensity), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.room.wall, near: 6, far: 30 },
    grade: { ...M.grade },
  };
}

// Recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

// Spécification du bobinage (ce que le worker calcule) tirée de la recette
export function windSpec(R, lite = false) {
  return {
    family: R.family, cage: R.cage, band: R.band, wind: R.wind,
    grid: lite ? { ns: 512, np: 1024 } : { ns: 1024, np: 2048 }, step: lite ? 0.004 : 0.003,
  };
}

export { SHAPES, FAMILIES };
