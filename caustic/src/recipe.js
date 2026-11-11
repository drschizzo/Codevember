// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Une scène = une famille (le geste : Foyer, Faraday, Kármán) dans une humeur
// (un décor : la cuve, son fond, la lumière, l'eau, le cadrage, l'étalonnage).
// Chaque tirage a son propre flux (rng.fork) ; les humeurs sont composées à la
// main, jamais tirées pièce par pièce. Longueurs en mètres.
import { createRng } from './rng.js';
import { SERIES } from './gen/motifs.js';

const r2 = (x) => Math.round(x * 100) / 100 || 0; // (|| 0 : jamais de −0, que JSON ne garde pas)
const r3 = (x) => Math.round(x * 1000) / 1000 || 0;
const r5 = (x) => Math.round(x * 1e7) / 1e7 || 0; // (amplitudes en m : au dixième de micron)

export const kelvinToHex = (K) => {
  const t = K / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * (t - 60) ** -0.1332047592; g = 288.1221695283 * (t - 60) ** -0.0755148492; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};

// ── Les familles (le geste) ─────────────────────────────────────────────────
export const FAMILIES = {
  foyer: { label: 'Foyer — les ondes convergent et dessinent', weight: 0.5 },
  faraday: { label: 'Faraday — un cristal de lumière', weight: 0.25 },
  karman: { label: 'Kármán — une allée de tourbillons', weight: 0.25 },
};

// ── Les fonds de cuve (le support : il donne l'échelle par son grain) ─────────
export const FLOORS = {
  sand: { label: 'Sable blanc', albedo: '#efe6d6', albedo2: '#d9cbb3', grain: 0.0004, rough: 0.95 },
  plaster: { label: 'Chaux', albedo: '#f1eee8', albedo2: '#ddd7cc', grain: 0.002, rough: 0.92 },
  tiles: { label: 'Faïence', albedo: '#e6eee9', albedo2: '#8fa79f', grain: 0.025, rough: 0.35 },
  travertine: { label: 'Travertin', albedo: '#e8dcc6', albedo2: '#c4ad8a', grain: 0.003, rough: 0.6 },
  slate: { label: 'Ardoise', albedo: '#5a6068', albedo2: '#3a3f46', grain: 0.0015, rough: 0.7 },
  enamel: { label: 'Émail blanc', albedo: '#f3f2ee', albedo2: '#e2e0da', grain: 0.001, rough: 0.25 },
  paper: { label: 'Papier', albedo: '#f4f1ea', albedo2: '#e4ded2', grain: 0.0003, rough: 0.9 },
};

// ── Les cuves ───────────────────────────────────────────────────────────────
// frame : cornières ; wall : parois intérieures (vues à travers la vitre)
export const TANKS = {
  steel: { label: 'Bâti d’acier noirci', frame: 'blackenedSteel', wall: '#5d6268', wallRough: 0.6 },
  brass: { label: 'Aquarium à bâti de laiton', frame: 'brushedBrass', wall: '#6f7d77', wallRough: 0.7 },
  stone: { label: 'Bassin de pierre', frame: 'bisque', wall: '#cbbfa8', wallRough: 0.85 },
  enamel: { label: 'Cuve émaillée', frame: 'brushedSteel', wall: '#e9e8e3', wallRough: 0.3 },
};

// ── Humeurs : une humeur = un décor ─────────────────────────────────────────
// light : soleil { el, az } (degrés : élévation, azimut d'où il vient) ou lampe
// { pos } (m, au-dessus de l'eau) ; angular : taille angulaire de la source
// (rad) ; lux : éclairement horizontal de la surface ; K : température.
export const MOODS = {
  lagon: {
    label: 'Lagon', families: ['foyer', 'karman'],
    floor: 'sand', tank: 'enamel', camera: 'plongee',
    light: { kind: 'sun', el: [64, 72], az: [150, 210], angular: 0.0047, K: 5600, lux: 3.2 },
    water: { turbid: 0.03, ambient: 0.000009, tint: [0.97, 1, 1] },
    env: 'cyclo', envIntensity: 0.45, bg: ['#c9d4d8', '#8c9aa0'],
    grade: { exposure: 0.5, contrast: 1.02, saturation: 0.95, shadows: [0.96, 1.0, 1.04], highlights: [1.02, 1.0, 0.97] },
  },
  chambre: {
    label: 'Chambre noire', families: ['foyer', 'faraday'],
    floor: 'plaster', tank: 'steel', camera: 'rasant',
    light: { kind: 'lamp', pos: [0.04, 0.85, -0.08], angular: 0.004, K: 5200, lux: 4.2 },
    water: { turbid: 0.06, ambient: 0.000006, tint: [1, 1, 1] },
    env: 'studio', envIntensity: 0.12, bg: ['#060607', '#020203'],
    grade: { exposure: 1.6, contrast: 1.12, saturation: 0.9, shadows: [0.94, 0.98, 1.08], highlights: [1.03, 1.0, 0.96] },
  },
  thermes: {
    label: 'Thermes', families: ['foyer', 'karman'],
    floor: 'tiles', tank: 'stone', camera: 'troisquarts',
    light: { kind: 'sun', el: [54, 62], az: [120, 160], angular: 0.009, K: 5400, lux: 2.6 },
    water: { turbid: 0.06, ambient: 0.000009, tint: [0.96, 1, 0.99] },
    env: 'softbox', envIntensity: 0.4, bg: ['#a89d8c', '#5f564b'],
    grade: { exposure: 1.3, contrast: 1.0, saturation: 0.95, shadows: [0.97, 0.99, 1.02], highlights: [1.04, 1.0, 0.95] },
  },
  doree: {
    label: 'Heure dorée', families: ['foyer', 'karman'],
    floor: 'travertine', tank: 'brass', camera: 'rasant',
    light: { kind: 'sun', el: [54, 60], az: [235, 260], angular: 0.0047, K: 4300, lux: 3.6 },
    water: { turbid: 0.035, ambient: 0.000008, tint: [1, 0.99, 0.96] },
    env: 'atelier', envIntensity: 0.3, bg: ['#3a2a1c', '#140d08'],
    grade: { exposure: 2.8, contrast: 1.06, saturation: 1.02, shadows: [0.93, 0.97, 1.06], highlights: [1.06, 1.0, 0.9] },
  },
  nocturne: {
    label: 'Nocturne', families: ['foyer', 'faraday', 'karman'],
    floor: 'slate', tank: 'steel', camera: 'plongee',
    light: { kind: 'sun', el: [50, 58], az: [190, 230], angular: 0.0047, K: 7600, lux: 9 },
    water: { turbid: 0.05, ambient: 0.000007, tint: [0.98, 1, 1] },
    env: 'night', envIntensity: 0.25, bg: ['#0b1320', '#03060c'],
    grade: { exposure: 0.8, contrast: 1.08, saturation: 0.9, shadows: [0.9, 0.96, 1.12], highlights: [0.97, 1.0, 1.04] },
  },
  atelier: {
    label: 'Atelier', families: ['foyer', 'faraday', 'karman'],
    floor: 'enamel', tank: 'enamel', camera: 'troisquarts',
    light: { kind: 'lamp', pos: [-0.12, 1.1, -0.05], angular: 0.006, K: 5000, lux: 3.4 },
    water: { turbid: 0.06, ambient: 0.000007, tint: [1, 1, 1] },
    env: 'atelier', envIntensity: 0.35, bg: ['#4b4743', '#22201e'],
    grade: { exposure: 0.45, contrast: 1.04, saturation: 0.92, shadows: [0.95, 0.99, 1.05], highlights: [1.04, 1.0, 0.95] },
  },
  stroboscope: {
    label: 'Stroboscope', families: ['faraday'],
    floor: 'paper', tank: 'steel', camera: 'plongee',
    light: { kind: 'lamp', pos: [0.0, 0.7, 0.0], angular: 0.006, K: 6500, lux: 4.6 },
    water: { turbid: 0.06, ambient: 0.000006, tint: [1, 1, 1] },
    env: 'studio', envIntensity: 0.1, bg: ['#0a0b0e', '#030304'],
    grade: { exposure: 0.38, contrast: 1.1, saturation: 0.85, shadows: [0.93, 0.97, 1.08], highlights: [1, 1, 1] },
  },
};

// Les cadrages (caméra hors de la cuve, devant la vitre ; unités : m)
const CAMERAS = {
  plongee: { el: [0.6, 0.68], az: [-0.1, 0.1], dist: [0.88, 0.95], fov: [40, 43], ty: -0.3, hi: -0.1 },
  rasant: { el: [0.3, 0.36], az: [-0.16, 0.16], dist: [0.9, 0.98], fov: [38, 41], ty: -0.32, hi: -0.12 },
  troisquarts: { el: [0.46, 0.54], az: [0.36, 0.46], dist: [0.9, 0.98], fov: [39, 42], ty: -0.3, hi: -0.1 },
};

// Cuve propre à chaque famille (m) ; L : côté du domaine des ondes
const GEOMETRY = {
  foyer: { W: 0.6, D: 0.6, H: 0.45, rim: 0.05, L: 1.2 },
  faraday: { W: 0.5, D: 0.5, H: 0.36, rim: 0.05, L: 1.0 },
  karman: { W: 0.8, D: 0.44, H: 0.3, rim: 0.05, L: 1.2 },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const family = overrides.family ?? rng.fork('family').weighted(Object.entries(FAMILIES).map(([k, f]) => [k, f.weight]));
  const moods = Object.keys(MOODS).filter((k) => MOODS[k].families.includes(family));
  const mood = overrides.mood && MOODS[overrides.mood] ? overrides.mood : rng.fork('mood').pick(moods);
  const M = MOODS[mood];
  const rl = rng.fork('light'), rc = rng.fork('camera'), rw = rng.fork('water'), rf = rng.fork('gesture'); // (pas « family » : ce flux tire déjà la famille)
  const geo = { ...GEOMETRY[family] };

  // lumière
  const Lm = M.light;
  const light = { kind: Lm.kind, angular: Lm.angular, K: Lm.K, lux: Lm.lux };
  if (Lm.kind === 'sun') {
    const el = (rl.range(...Lm.el) * Math.PI) / 180, az = (rl.range(...Lm.az) * Math.PI) / 180;
    // direction de propagation (du soleil vers la cuve) ; az = 180° : le soleil
    // est derrière la cuve, face à la caméra
    light.dir = [r3(-Math.cos(el) * Math.sin(az)), r3(-Math.sin(el)), r3(-Math.cos(el) * Math.cos(az))];
  } else {
    light.pos = Lm.pos.map((v, i) => r3(v + (i === 1 ? 0 : rl.range(-0.03, 0.03))));
  }

  // caméra
  const Cs = CAMERAS[M.camera];
  const camera = {
    style: M.camera, el: r3(rc.range(...Cs.el)), az: r3(rc.range(...Cs.az) * rc.sign()), dist: r3(rc.range(...Cs.dist)), fov: r2(rc.range(...Cs.fov)),
    target: [0, r3(Cs.ty * geo.H / 0.45), r3(-geo.D * 0.08)],
    // la cible remonte vers la surface et les plongeurs entre deux dessins
    // (la cause), et redescend sur le fond quand les ondes convergent (l'effet)
    rise: family === 'foyer' ? r3((Cs.hi - Cs.ty) * geo.H / 0.45) : 0,
    sway: r3(rc.range(0.025, 0.045)), swayPhase: r2(rc.range(0, Math.PI * 2)), bob: r3(rc.range(0.006, 0.012)),
    push: r3(rc.range(0.08, 0.12)), pushWidth: 3,
  };

  // eau
  const water = {
    turbid: r3(M.water.turbid * rw.range(0.8, 1.2)), tint: M.water.tint,
    ambient: r5(M.water.ambient * rw.range(0.8, 1.25)), ambientK: r2(rw.range(160, 260)), ambientDir: r2(rw.range(0, Math.PI * 2)), ambientSpread: r2(rw.range(0.6, 1.4)),
  };

  const R = {
    v: 1, seed, family, mood,
    loop: { duration: family === 'foyer' ? 36 : family === 'faraday' ? 30 : 24 },
    tank: { ...geo, style: M.tank, floor: M.floor },
    light, camera, water,
    env: { preset: M.env, intensity: M.envIntensity, rotation: r2(rl.range(0, Math.PI * 2)) },
    bg: M.bg,
    grade: { ...M.grade },
  };

  if (family === 'foyer') {
    const series = overrides.series ?? rf.pick(Object.keys(SERIES));
    const rot0 = rf.range(0, Math.PI * 2);
    R.foyer = {
      series,
      events: [0, 1, 2].map((level) => ({ level, rotation: r2(rot0 + level * rf.range(0.2, 0.6)) })),
      slow: { vn: 0.4, vmin: 0.006, w: 3 },
      fade: [0.62, 0.95],
      side: 0.52,
      plungers: 10,
      gain: 1.6,
    };
  } else if (family === 'faraday') {
    // réseau : carrés (4 modes), hexagones (3), quasi-cristal (n = 8, 10, 12 → n/2 modes)
    const lattices = [['square', 'hex'], ['square', 'quasi8'], ['hex', 'quasi12'], ['square', 'quasi10']];
    const [first, second] = rf.pick(lattices);
    R.faraday = {
      first, second, k: r2(rf.range(240, 300)), amp: r5(rf.range(0.00022, 0.0003)),
      ramp: [0.03, 0.12, 0.8, 0.95], grow: [0.08, 0.36],
      invade: [0.42, 0.7], reach: r2(geo.W * 0.9), beats: rf.pick([5, 6, 7]), beatPhase: r2(rf.range(0, Math.PI * 2)),
      angle: r2(rf.range(0, Math.PI)), origin2: [r3(rf.range(-0.15, 0.15)), r3(-geo.D * 0.42)],
    };
  } else {
    const n = rf.pick([10, 12]);
    R.karman = {
      post: [r3(-geo.W * 0.3), 0], radius: r3(rf.range(0.011, 0.015)), emissions: n,
      speed: r3(rf.range(0.03, 0.038)), life: 19, spread: r3(rf.range(0.07, 0.085)),
      depth: r5(rf.range(0.0045, 0.0055)), core: r3(rf.range(0.014, 0.017)), diffuse: r5(rf.range(3e-6, 6e-6)),
      xEnd: r3(geo.W / 2),
    };
  }
  return R;
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
