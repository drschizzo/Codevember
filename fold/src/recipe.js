// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Règles (voir la skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) ;
// - une humeur est un DÉCOR (fond, table, accessoires, lumière, valeur,
//   cadrage), pas une teinte ; les matières y sont composées à la main ;
// - les lampes sont presque blanches (≥ 4700 K) ;
// - la boucle : des événements à intervalles fixes de temps physique, une
//   durée de film fixe (voir physio.js, plan.js).
import { createRng } from './rng.js';
import { FINISHES, SETS } from './finishes.js';
import { PLANTS } from './gen/plant.js';
import { CONTAINERS } from './container.js';

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

// ── Décors (humeurs) ─────────────────────────────────────────────────────────
// backdrop : fond peint (scene/decor.js) ; table : jeu de matériaux ;
// containers : montures possibles ; key : lampe principale (az relatif à la
// caméra, élévation, ouverture, pénombre, intensité) ; rim : contre-jours ;
// env : studio HDR ; bg : fond et brume ; grade : étalonnage ; plants :
// préférences d'archétypes ; view : cadrage (élévation de la caméra,
// distances des plans rapproché et large, focale).
export const MOODS = {
  serre: {
    sky: ['#eef3ff', '#b7ad98', 1.0],
    label: 'Serre', backdrop: 'serre', table: ['weathered', 'oak'], containers: [['ward', 2], ['cloche', 2], ['terracotta', 2]],
    key: { K: 5800, az: [2.5, 3.6], el: [0.75, 1.0], angle: 0.42, pen: 0.55, I: [760, 1000] }, rim: [['#fff4e6', 260], ['#dfeaff', 120]],
    env: 'softbox', envI: [0.55, 0.8], bg: '#d8dccf', wall: 1.25,
    grade: { contrast: 1.02, saturation: 1.02, shadows: [0.97, 1.0, 1.0], highlights: [1.03, 1.02, 0.96] },
    plants: [['bush', 3], ['flowering', 3], ['trailing', 2], ['bijuga', 1], ['fruiting', 1]], view: { el: [0.05, 0.22], close: [1.1, 1.43], wide: [4.6, 5.6], fov: [30, 36] },
    leafLight: 1.0,
  },
  cabinet: {
    sky: ['#ffe8cc', '#3a2a1c', 0.05],
    label: 'Cabinet', backdrop: 'cabinet', table: ['walnut'], containers: [['ward', 3], ['cloche', 3]],
    key: { K: 4800, az: [1.2, 1.9], el: [0.32, 0.5], angle: 0.36, pen: 0.35, I: [700, 950] }, rim: [['#ffe2c0', 180], ['#9fb6ff', 40]],
    env: 'atelier', envI: [0.08, 0.16], bg: '#0d0906', wall: 0.06,
    grade: { contrast: 1.08, saturation: 0.95, shadows: [0.94, 0.98, 1.08], highlights: [1.06, 1.0, 0.92] },
    plants: [['bush', 3], ['fruiting', 2], ['flowering', 2], ['bijuga', 2]], view: { el: [0.22, 0.4], close: [1.21, 1.54], wide: [5.0, 6.0], fov: [30, 35] },
    leafLight: 0.9,
  },
  planche: {
    sky: ['#ffffff', '#d8d6d0', 0.35],
    label: 'Planche', backdrop: 'cyclo', table: ['paperWhite'], containers: [['cachepot', 3], ['terracotta', 2], ['bonsai', 2]],
    key: { K: 6000, az: [-0.6, 0.6], el: [1.15, 1.35], angle: 0.75, pen: 1.0, I: [400, 500] }, rim: [['#ffffff', 90], ['#eef2ff', 60]],
    env: 'cyclo', envI: [0.26, 0.34], bg: '#e9e8e4', wall: 0.62,
    grade: { contrast: 0.98, saturation: 0.92, shadows: [0.98, 1.0, 1.03], highlights: [1, 1, 1] },
    plants: [['flowering', 3], ['fruiting', 3], ['bush', 2], ['seedling', 2], ['biophytum', 1]], view: { el: [0.08, 0.25], close: [1.32, 1.65], wide: [5.4, 6.4], fov: [28, 34] },
    leafLight: 1.05,
  },
  labo: {
    sky: ['#eef4ff', '#5a5f5c', 0.35],
    label: 'Laboratoire', backdrop: 'tiles', table: ['epoxy'], containers: [['terracotta', 3], ['cachepot', 2]],
    key: { K: 6500, az: [-1.2, -0.5], el: [1.0, 1.25], angle: 0.6, pen: 0.8, I: [650, 850] }, rim: [['#e8f2ff', 220], ['#fff1dc', 90]],
    env: 'studio', envI: [0.35, 0.5], bg: '#5d6a64', wall: 0.6,
    grade: { contrast: 1.04, saturation: 0.88, shadows: [0.95, 1.0, 1.04], highlights: [0.98, 1.0, 1.02] },
    plants: [['bush', 3], ['seedling', 2], ['bijuga', 2], ['fruiting', 1]], view: { el: [0.0, 0.12], close: [1.16, 1.43], wide: [4.8, 5.6], fov: [32, 38] },
    leafLight: 1.0,
  },
  shoji: {
    sky: ['#fff6e8', '#b59f80', 0.45],
    label: 'Shōji', backdrop: 'shoji', table: ['hinoki'], containers: [['bonsai', 3], ['cachepot', 1]],
    key: { K: 5600, az: [1.3, 1.8], el: [0.22, 0.4], angle: 0.9, pen: 1.0, I: [700, 900] }, rim: [['#fff6ea', 120], ['#e6eeff', 40]],
    env: 'softbox', envI: [0.3, 0.45], bg: '#b9ad98', wall: 0.9,
    grade: { contrast: 0.99, saturation: 0.9, shadows: [0.99, 0.99, 1.02], highlights: [1.02, 1.0, 0.97] },
    plants: [['biophytum', 3], ['seedling', 2], ['bijuga', 2], ['bush', 1]], view: { el: [0.02, 0.14], close: [1.1, 1.38], wide: [4.4, 5.2], fov: [30, 36] },
    leafLight: 1.0,
  },
  nuit: {
    sky: ['#6f86c0', '#0a0c12', 0.06],
    label: 'Nuit', backdrop: 'night', table: ['ebony', 'walnut'], containers: [['cloche', 3], ['ward', 2], ['terracotta', 1]],
    key: { K: 7600, az: [2.2, 2.9], el: [0.5, 0.75], angle: 0.32, pen: 0.25, I: [520, 720] }, rim: [['#ffdcb0', 60], ['#7f9cff', 160]],
    env: 'night', envI: [0.08, 0.14], bg: '#05070d', wall: 0.08,
    grade: { contrast: 1.1, saturation: 0.9, shadows: [0.9, 0.96, 1.14], highlights: [0.98, 1.0, 1.04] },
    plants: [['bush', 2], ['trailing', 2], ['flowering', 1], ['bijuga', 2]], view: { el: [-0.06, 0.06], close: [1.16, 1.49], wide: [4.6, 5.6], fov: [32, 38] },
    leafLight: 0.85,
  },
  velours: {
    sky: ['#ffffff', '#000000', 0.0],
    label: 'Velours', backdrop: 'velvet', table: ['velvetBlack'], containers: [['cloche', 2], ['cachepot', 2], ['bonsai', 1]],
    key: { K: 5600, az: [-0.5, 0.5], el: [0.9, 1.15], angle: 0.24, pen: 0.4, I: [800, 1000] }, rim: [['#ffffff', 280], ['#cfe0ff', 180]],
    env: 'studio', envI: [0.05, 0.1], bg: '#020202', wall: 0.0,
    grade: { contrast: 1.12, saturation: 0.98, shadows: [0.97, 0.98, 1.04], highlights: [1, 1, 1] },
    plants: [['flowering', 2], ['bush', 2], ['biophytum', 1], ['fruiting', 2]], view: { el: [0.1, 0.3], close: [0.99, 1.26], wide: [4.2, 5.0], fov: [28, 34] },
    leafLight: 1.0,
  },
};

// matières des montures (jamais tirées au hasard ailleurs)
const POT = { terracotta: 'terracotta', cachepot: 'porcelainPot', bonsai: 'celadonPot', cloche: 'terracotta', ward: 'terracotta' };
const BASE = { cloche: ['walnut', 'ebony', 'oak'], ward: ['castIron', 'whiteIron'] };

export function finishOf(setKey) {
  const S = SETS[setKey];
  const fin = (k) => ({ ...FINISHES[k], preset: k });
  return { set: setKey, outer: fin(S.outer), inner: fin(S.inner), edge: fin(S.edge), wear: S.wear ?? 0 };
}

// motifs à l'échelle d'un pot (une dizaine de centimètres)
const scaled = (f, k) => { for (const s of ['outer', 'inner', 'edge']) f[s].scale = r2(f[s].scale * k); return f; };

export const CAUSES = { drop: 'Goutte', tap: 'Marteau' };

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rp = rng.fork('plant'), rc = rng.fork('camera'), rl = rng.fork('light'), re = rng.fork('events'), rd = rng.fork('decor');
  // la famille d'abord (quatre manières de plier), puis le port de la sensitive
  const family = overrides.family ?? rp.pick(['sensitive', 'biophytum', 'oxalis', 'dionaea']);
  const kind = family === 'sensitive' ? rp.weighted(M.plants.filter(([k]) => PLANTS[k].family === 'sensitive')) : family;
  // la dionée vit sous verre (l'humidité d'un terrarium) : ses gouttes sont
  // de condensation, sur des pièges différents
  const container = family === 'dionaea' ? 'cloche' : rd.weighted(M.containers);
  const roof = container === 'cloche' || container === 'ward';
  // le scénario : des gouttes, chacune sur une autre feuille (sous verre) ou
  // une seule (la burette goutte toujours au même endroit) ; puis le marteau,
  // qui ferme toute la plante d'un coup — le temps fort, à la fin
  const drops = family === 'dionaea' ? 3 : roof ? re.int(1, 3) : 1;
  const events = Array.from({ length: drops }, () => ({ cause: 'drop', source: roof ? 'roof' : 'burette' }));
  if (family !== 'dionaea') events.push({ cause: 'tap' });
  const K = events.length;
  const spacing = family === 'dionaea' ? 640 : 560;
  const purple = rp.chance(0.5);
  const key = M.key;
  const baseAz = rc.range(-0.5, 0.5);
  return {
    v: 1, seed, mood,
    plant: { kind, seed: `${seed}` },
    container,
    events,
    loop: { duration: Math.round(K * re.range(17, 19) + 4), spacing }, // (le pli au ralenti prend du temps de film)
    camera: {
      fov: r2(rc.range(...M.view.fov)), az: r2(baseAz), el: r2(rc.range(...M.view.el)), close: r2(rc.range(...M.view.close)), wide: r2(rc.range(...M.view.wide)),
      orbit: 0, rot: rc.pick([1, -1]), sway: r2(rc.range(0.01, 0.025)),
    },
    light: {
      key: { color: kelvinToHex(key.K + rl.range(-150, 150)), intensity: r2(rl.range(...key.I)), az: r2(baseAz + rl.range(...key.az)), el: r2(rl.range(...key.el)), angle: key.angle, penumbra: key.pen },
      sky: { color: M.sky[0], ground: M.sky[1], intensity: r2(M.sky[2] * rl.range(0.9, 1.1)) },
      rim: M.rim.map(([c, I], i) => ({ color: c, intensity: r2(I * rl.range(0.85, 1.15)), az: r2(baseAz + (i ? -2.3 : 2.5) + rl.range(-0.2, 0.2)), el: r2(rl.range(0.3, 0.55)) })),
    },
    env: { preset: M.env, intensity: r2(rl.range(...M.envI)), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: 12, far: 46 },
    decor: {
      backdrop: M.backdrop, wall: M.wall,
      table: finishOf(rd.pick(M.table)),
      // paillage : sphaigne pour la dionée (sa tourbière), akadama ou gravier
      mulch: family === 'dionaea' ? 'perlite' : rd.pick(['akadama', 'gravel']),
      pot: scaled(finishOf(POT[container]), container === 'terracotta' || container === 'cloche' || container === 'ward' ? 3 : 7),
      base: BASE[container] ? finishOf(rd.pick(BASE[container])) : null,
      stand: finishOf('castIron'), brass: finishOf('hammerArm'), coil: finishOf('coil'),
    },
    leaf: {
      family,
      // trèfle : pourpre (Oxalis triangularis) une fois sur deux
      hue: r2(family === 'oxalis' && purple ? rp.range(282, 296) : rp.range(92, 108)), sat: r2(family === 'oxalis' && purple ? rp.range(0.35, 0.5) : rp.range(0.42, 0.58)),
      light: r2((family === 'oxalis' && purple ? rp.range(0.22, 0.27) : rp.range(0.3, 0.36)) * M.leafLight), translucency: r2(rp.range(0.8, 1.2)),
      flower: kind === 'biophytum' ? '#f2d24a' : rp.pick(['#f4a6cf', '#ef8fc0', '#f7b9d8', '#e98ab9']),
      inner: family === 'dionaea' ? rp.pick(['#a3201c', '#8c1a2a', '#b8401c']) : '#9c1f1a', eye: family === 'oxalis' && purple ? 0.8 : 0,
    },
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
export { PLANTS, CONTAINERS };
