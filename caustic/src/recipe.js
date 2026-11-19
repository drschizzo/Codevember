// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Une scène = une famille (le geste : Foyer, Faraday, Kármán) dans une humeur
// (un décor : la cuve, son fond, la lumière, l'eau, le cadrage, l'étalonnage).
// Chaque tirage a son propre flux (rng.fork) ; les humeurs sont composées à la
// main, jamais tirées pièce par pièce. Longueurs en mètres.
import { createRng } from '../../shared/rng.js';
import { SERIES } from './gen/motifs.js';
import { flatLanding } from './gen/lens.js';
import { nWater } from './optics.js';

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
  zellige: { label: 'Zellige', albedo: '#17a79b', albedo2: '#f1ede2', grain: 0.012, rough: 0.3 },
  mosaic: { label: 'Pâte de verre', albedo: '#22a9bd', albedo2: '#1560ad', grain: 0.02, rough: 0.3 },
  mosaicNoir: { label: 'Pâte de verre noire', albedo: '#2a3140', albedo2: '#0e1118', grain: 0.02, rough: 0.3 },
  mosaicNuit: { label: 'Pâte de verre nuit', albedo: '#24477f', albedo2: '#0b1838', grain: 0.02, rough: 0.3 },
};

// ── Les cuves ───────────────────────────────────────────────────────────────
// frame : cornières ; wall : parois intérieures (vues à travers la vitre)
export const TANKS = {
  steel: { label: 'Bâti d’acier noirci', frame: 'blackenedSteel', wall: '#5d6268', wallRough: 0.6 },
  brass: { label: 'Aquarium à bâti de laiton', frame: 'brushedBrass', wall: '#6f7d77', wallRough: 0.7 },
  stone: { label: 'Bassin de pierre', frame: 'bisque', wall: '#cbbfa8', wallRough: 0.85 },
  enamel: { label: 'Cuve émaillée', frame: 'brushedSteel', wall: '#e9e8e3', wallRough: 0.3 },
  // (un bassin creusé dans un sol au soleil : ni vitre, ni bâti, ni plongeurs)
  bassin: { label: 'Bassin de patio', frame: 'bisque', wall: '#49c2d0', wallRough: 0.4 },
};

// ── Les pierres du sol et de la margelle : teinte, teinte des nuages, veines et éclats, joints ──
export const STONES = {
  calcaire: { label: 'Calcaire', a: [0.62, 0.56, 0.47], b: [0.46, 0.4, 0.33], light: [0.84, 0.81, 0.74], joint: [0.2, 0.18, 0.16] },
  marbre: { label: 'Marbre blanc', a: [0.8, 0.8, 0.78], b: [0.68, 0.69, 0.7], light: [0.52, 0.54, 0.58], joint: [0.3, 0.3, 0.3] },
  travertin: { label: 'Travertin', a: [0.7, 0.6, 0.45], b: [0.56, 0.45, 0.31], light: [0.86, 0.8, 0.67], joint: [0.25, 0.2, 0.14] },
  ardoise: { label: 'Ardoise', a: [0.15, 0.16, 0.18], b: [0.08, 0.09, 0.11], light: [0.19, 0.2, 0.22], joint: [0.03, 0.03, 0.04] },
};

// ── Humeurs : une humeur = un décor ─────────────────────────────────────────
// light : soleil { el, az } (degrés : élévation, azimut d'où il vient) ou lampe
// { pos } (m, au-dessus de l'eau) ; angular : taille angulaire de la source
// (rad) ; lux : éclairement horizontal de la surface ; K : température.
export const MOODS = {
  patio: {
    label: 'Patio', families: ['foyer', 'karman', 'faraday'],
    floor: 'mosaic', stone: 'calcaire', tank: 'bassin', camera: 'bassin',
    light: { kind: 'sun', el: [77, 82], az: [25, 50], angular: 0.0047, K: 5600, lux: 5 },
    water: { turbid: 0.02, ambient: 0.000009, tint: [0.6, 0.98, 1], shafts: 1.1, deep: 1.6 },
    env: 'clearsky', envIntensity: 0.6, bg: ['#9fc4e6', '#d8c9b2'],
    decor: { air: 'poussiere', shade: 1, ground: 'tomette', wall: '#d39a5f', leaves: 'petale', prop: 'serviette', spout: 1 },
    grade: { exposure: 0.36, contrast: 1.12, saturation: 1.15, shadows: [0.97, 1.0, 1.04], highlights: [1.03, 1.0, 0.96] },
  },
  lagon: {
    label: 'Lagon', families: ['foyer', 'karman'],
    floor: 'plaster', stone: 'marbre', tank: 'bassin', camera: 'bassin',
    light: { kind: 'sun', el: [70, 78], az: [20, 45], angular: 0.0047, K: 5600, lux: 4.6 },
    water: { turbid: 0.02, ambient: 0.000009, tint: [0.42, 0.95, 1], shafts: 1.1, deep: 4 },
    env: 'clearsky', envIntensity: 0.6, bg: ['#9fc4e6', '#d8d2c4'],
    decor: { air: 'poussiere', shade: 1, ground: 'pierre', wall: '#ece5d6', leaves: 'feuille', prop: 'serviette' },
    grade: { exposure: 0.3, contrast: 1.14, saturation: 1.2, shadows: [0.96, 1.0, 1.04], highlights: [1.02, 1.0, 0.97] },
  },
  thermes: {
    label: 'Thermes', families: ['foyer', 'karman'],
    floor: 'travertine', stone: 'travertin', tank: 'bassin', camera: 'bassin',
    light: { kind: 'sun', el: [58, 66], az: [30, 55], angular: 0.009, K: 5000, lux: 4.2 },
    water: { turbid: 0.03, ambient: 0.000009, tint: [0.6, 1, 0.82], shafts: 1.1, deep: 3 },
    env: 'softbox', envIntensity: 0.4, bg: ['#a89d8c', '#5f564b'],
    decor: { air: 'vapeur', shade: 0, ground: 'pierre', wall: '#c2a57c', leaves: null, prop: 'serviette', spout: 1 },
    grade: { exposure: 0.38, contrast: 1.12, saturation: 1.1, shadows: [0.97, 0.99, 1.02], highlights: [1.04, 1.0, 0.95] },
  },
  doree: {
    label: 'Heure dorée', families: ['foyer', 'karman'],
    floor: 'slate', stone: 'calcaire', tank: 'bassin', camera: 'bassin',
    light: { kind: 'sun', el: [50, 57], az: [40, 70], angular: 0.0047, K: 3700, lux: 5 },
    water: { turbid: 0.03, ambient: 0.000008, tint: [0.9, 0.98, 0.9], shafts: 1.1 },
    env: 'dusk', envIntensity: 0.5, bg: ['#3a2a1c', '#140d08'],
    decor: { air: 'poussiere', shade: 1, ground: 'teck', wall: '#c07f52', leaves: 'feuille', prop: 'lanterne' },
    grade: { exposure: 0.55, contrast: 1.08, saturation: 1.08, shadows: [0.93, 0.97, 1.06], highlights: [1.06, 1.0, 0.9] },
  },
  nocturne: {
    label: 'Nocturne', families: ['foyer', 'faraday', 'karman'],
    floor: 'mosaicNuit', stone: 'ardoise', tank: 'bassin', camera: 'bassin',
    light: { kind: 'sun', el: [62, 70], az: [20, 50], angular: 0.0047, K: 7600, lux: 9 },
    water: { turbid: 0.03, ambient: 0.000007, tint: [0.8, 0.95, 1], shafts: 1.1 },
    env: 'night', envIntensity: 0.25, bg: ['#0b1320', '#03060c'],
    decor: { air: 'brume', shade: 0, ground: 'pierre', wall: '#272c38', leaves: null, prop: 'lanterne' },
    grade: { exposure: 0.5, contrast: 1.12, saturation: 0.9, shadows: [0.9, 0.96, 1.12], highlights: [0.97, 1.0, 1.04] },
  },
  chambre: {
    // (un bassin de chaux blanche dans un sol d'ardoise, sous une seule lampe : la figure s'écrit en clair sur clair, le reste est nuit)
    label: 'Chambre noire', families: ['foyer', 'faraday'],
    floor: 'plaster', stone: 'ardoise', tank: 'bassin', camera: 'bassin',
    light: { kind: 'lamp', pos: [0.04, 0.85, -0.08], angular: 0.004, K: 5200, lux: 4.2 },
    water: { turbid: 0.04, ambient: 0.000006, tint: [0.8, 1, 0.95], shafts: 1.1, deep: 2 },
    env: 'studio', envIntensity: 0.08, bg: ['#060607', '#020203'],
    decor: { air: 'brume', shade: 0, ground: 'pierre', wall: '#1c1d21', leaves: null, prop: 'lanterne' },
    grade: { exposure: 0.42, contrast: 1.14, saturation: 1.0, shadows: [0.94, 0.98, 1.08], highlights: [1.04, 1.0, 0.94] },
  },
  atelier: {
    label: 'Atelier', families: ['foyer', 'faraday', 'karman'],
    floor: 'tiles', stone: 'marbre', tank: 'bassin', camera: 'bassin',
    light: { kind: 'lamp', pos: [-0.12, 1.1, -0.05], angular: 0.006, K: 5000, lux: 3.4 },
    water: { turbid: 0.03, ambient: 0.000007, tint: [0.75, 1, 0.98], shafts: 1.1 },
    env: 'atelier', envIntensity: 0.35, bg: ['#4b4743', '#22201e'],
    decor: { shade: 0, ground: 'pierre', wall: '#e6e1d6', leaves: null, prop: 'serviette' },
    grade: { exposure: 0.5, contrast: 1.06, saturation: 1.0, shadows: [0.95, 0.99, 1.05], highlights: [1.04, 1.0, 0.95] },
  },
  stroboscope: {
    // (verre noir et ardoise, lampe froide : le réseau de lumière est seul à briller)
    label: 'Stroboscope', families: ['faraday'],
    floor: 'mosaicNoir', stone: 'ardoise', tank: 'bassin', camera: 'bassin',
    // (un faisceau parallèle, comme celui d'un projecteur lointain : sous une lampe proche, le réseau restait pâle)
    light: { kind: 'sun', el: [78, 84], az: [20, 50], angular: 0.004, K: 7200, lux: 9 },
    water: { turbid: 0.04, ambient: 0.000006, tint: [0.9, 0.97, 1], shafts: 1.1 },
    env: 'night', envIntensity: 0.12, bg: ['#0a0b0e', '#030304'],
    decor: { shade: 0, ground: 'pierre', wall: '#1a1c22', leaves: null },
    grade: { exposure: 0.6, contrast: 1.14, saturation: 0.95, shadows: [0.92, 0.97, 1.1], highlights: [0.98, 1, 1.03] },
  },
};

// Les cadrages (caméra hors de la cuve, devant la vitre ; unités : m)
const CAMERAS = {
  // (au-dessus du bassin, debout au bord : on regarde le fond à travers la surface)
  bassin: { el: [0.5, 0.58], az: [0.4, 0.55], dist: [1.62, 1.74], fov: [30, 32], ty: -0.34, hi: -0.28 },
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
  // (bassin : large et peu profond — de biais on voit tout le fond, et les rayons qui y descendent)
  const WIDE = { foyer: { W: 1.1, D: 1.1 }, faraday: { W: 0.9, D: 0.9 }, karman: { W: 1.1, D: 0.7 } };
  const geo = { ...GEOMETRY[family], ...(M.tank === 'bassin' ? WIDE[family] : {}) };

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
    style: M.camera, el: r3(rc.range(...Cs.el)), az: r3(rc.range(...Cs.az) * rc.sign()),
    // (bassin : la distance suit sa taille, il tient la même place dans le cadre pour les trois familles)
    dist: r3(rc.range(...Cs.dist) * (M.camera === 'bassin' ? (Math.max(geo.W, geo.D) + 0.25) / 1.35 : 1)), fov: r2(rc.range(...Cs.fov)),
    target: [0, r3(Cs.ty * geo.H / 0.45), r3(-geo.D * 0.08)], // (Foyer en bassin : recentrée sur la figure, plus bas)
    // la cible remonte vers la surface et les plongeurs entre deux dessins
    // (la cause), et redescend sur le fond quand les ondes convergent (l'effet)
    rise: family === 'foyer' ? r3((Cs.hi - Cs.ty) * geo.H / 0.45) : 0,
    sway: r3(rc.range(0.025, 0.045)), swayPhase: r2(rc.range(0, Math.PI * 2)), bob: r3(rc.range(0.006, 0.012)),
    push: r3(M.camera === 'bassin' ? rc.range(0.13, 0.16) : rc.range(0.08, 0.12)), pushWidth: 3,
  };

  // Bassin : la caméra vise ce qu'on regarde au fond, là où on le voit. Deux corrections :
  // - le dessin du Foyer ne se forme pas au centre du bassin (la lumière arrive de biais : la lentille est d'un
  //   côté, son image de l'autre) ;
  // - le regard se casse en entrant dans l'eau : pour que l'axe de la caméra tombe sur un point du fond, il faut
  //   viser, à la surface, un point plus proche de soi de H·tan(θ réfracté).
  if (M.camera === 'bassin') {
    let fx = 0, fz = 0;
    if (family === 'foyer') { const L0 = flatLanding(light, [0, 0, 0], geo.H, nWater(545)); fx = L0[0] / 2; fz = L0[2] / 2; }
    const tw = Math.asin(Math.cos(camera.el) / nWater(545)), back = geo.H * Math.tan(tw);
    camera.target = [r3(fx + Math.sin(camera.az) * back), 0, r3(fz + Math.cos(camera.az) * back)];
    camera.rise = family === 'foyer' ? 0.03 : 0;
  }

  // eau
  const water = {
    turbid: r3(M.water.turbid * rw.range(0.8, 1.2)), tint: M.water.tint, shafts: M.water.shafts ?? 0, deep: M.water.deep ?? 1,
    ambient: r5(M.water.ambient * rw.range(0.8, 1.25)), ambientK: r2(rw.range(160, 260)), ambientDir: r2(rw.range(0, Math.PI * 2)), ambientSpread: r2(rw.range(0.6, 1.4)),
  };

  // quelques feuilles (ou pétales) posées sur l'eau, loin du dessin : [x, z, angle, longueur]
  const leafList = [];
  if (M.decor?.leaves) {
    const rd = rng.fork('decor'), n = rd.int(4, 6);
    for (let k = 0; k < 200 && leafList.length < n; k++) {
      const x = rd.range(-geo.W / 2 + 0.07, geo.W / 2 - 0.07), z = rd.range(-geo.D / 2 + 0.07, geo.D / 2 - 0.07);
      if (Math.hypot(x - camera.target[0], z - camera.target[2]) < 0.36) continue;
      if (leafList.some((l) => Math.hypot(x - l[0], z - l[1]) < 0.12)) continue;
      leafList.push([r3(x), r3(z), r2(rd.range(0, Math.PI * 2)), r3(rd.range(0.016, 0.024))]);
    }
  }

  const R = {
    v: 1, seed, family, mood,
    loop: { duration: family === 'foyer' ? 36 : family === 'faraday' ? 30 : 24 },
    tank: { ...geo, style: M.tank, floor: M.floor, stone: M.stone ?? 'calcaire' },
    decor: { air: null, shade: 0, ground: 'pierre', wall: null, leaves: null, prop: null, spout: 0, ...(M.decor ?? {}), side: -Math.sign(camera.az) || 1, turn: r2(rl.range(0, Math.PI * 2)), leafList },
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
      // (un léger ralentissement quand le dessin se forme, pas un arrêt : l'eau ne se fige jamais)
      slow: { vn: 0.4, vmin: 0.15, w: 2.5 },
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
