// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase.
//
// Une scène d'Echo : une pièce (humeur : murs, sol, fenêtre hors champ), une
// table, une nature morte, une ampoule à douille à tirette, et un réflecteur
// (famille : trumeau, psyché, miroir ardent, boule à facettes). La mise en
// place (src/gen/layout.js) est calculée pour que la caméra voie la lampe ET
// son reflet : l'écho doit être dans le cadre.
//
// Règles (skill codevember-scene, art-direction.md) : un flux de tirage par
// famille (rng.fork) ; des accords composés à la main par humeur ; lampes
// presque blanches sauf quand l'humeur la justifie (une ampoule à filament
// dans une pièce lambrissée) ; rien de « sépia » pour l'humeur d'ouverture.
import { createRng } from '../../shared/rng.js';
import { place } from './gen/layout.js';

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

// ── Familles : le réflecteur, qui fait l'écho ────────────────────────────────
export const FAMILIES = {
  trumeau: { label: 'Trumeau (miroir au mur)', gesture: 'une seconde sphère sort de la glace' },
  psyche: { label: 'Psyché (miroir sur pied)', gesture: 'une seconde sphère sort de la glace, de côté' },
  ardent: { label: 'Miroir ardent (concave)', gesture: "l'écho se referme sur un point" },
  facettes: { label: 'Boule à facettes', gesture: "l'écho éclaté en pinceaux" },
};

// ── Matières ─────────────────────────────────────────────────────────────────
// Une matière : { kind, color, color2, rough, metal, clearcoat, sheen, scale }.
// kind : plaster, paint, panel, wood, linen, marble, tile, velvet, lacquer,
// glaze, metal, bakelite.
const M = (kind, o) => ({ kind, color: '#888888', color2: '#555555', rough: 0.6, metal: 0, clearcoat: 0, sheen: 0, scale: 1, ...o });
export const MATS = {
  // murs
  greyPanel: M('panel', { label: 'Lambris gris perle', color: '#b9b6ad', color2: '#a29f96', rough: 0.55 }),
  greenPanel: M('panel', { label: 'Lambris vert-de-gris', color: '#55625a', color2: '#46524b', rough: 0.5 }),
  redLacquer: M('lacquer', { label: 'Laque sang-de-bœuf', color: '#6e0f0c', color2: '#3d0605', rough: 0.3, clearcoat: 1 }),
  blackVelvet: M('velvet', { label: 'Velours noir', color: '#0b0b0d', color2: '#050506', rough: 0.95, sheen: 0.6 }),
  whiteTile: M('tile', { label: 'Faïence blanche', color: '#e8e8e4', color2: '#9fa3a3', rough: 0.12, clearcoat: 1, scale: 0.15 }),
  whitePlaster: M('plaster', { label: 'Plâtre blanc', color: '#e2dfd8', color2: '#cfcac0', rough: 0.9 }),
  paleWall: M('paint', { label: 'Badigeon rose pâle', color: '#d8c3bb', color2: '#c4aca3', rough: 0.85 }),
  blueWall: M('paint', { label: 'Badigeon bleu de Prusse', color: '#2c3a52', color2: '#232f43', rough: 0.85 }),
  // sols
  oakFloor: M('wood', { label: 'Plancher de chêne gris', color: '#6b6359', color2: '#4f4840', rough: 0.6, scale: 0.18 }),
  darkFloor: M('wood', { label: 'Plancher sombre', color: '#2c2420', color2: '#1d1714', rough: 0.55, scale: 0.18 }),
  stoneFloor: M('tile', { label: 'Tomettes', color: '#8a5a44', color2: '#5a3a2c', rough: 0.7, scale: 0.2 }),
  concrete: M('plaster', { label: 'Ciment ciré', color: '#a6a39d', color2: '#8f8b84', rough: 0.55 }),
  // tables
  oak: M('wood', { label: 'Chêne clair', color: '#a58c6c', color2: '#7c6548', rough: 0.5, scale: 1 }),
  walnut: M('wood', { label: 'Noyer', color: '#5a3d2a', color2: '#3a2619', rough: 0.4, clearcoat: 0.4, scale: 1 }),
  pine: M('wood', { label: 'Pin brut', color: '#c9ad85', color2: '#a58660', rough: 0.7, scale: 1.3 }),
  blackLacquer: M('lacquer', { label: 'Laque noire', color: '#0c0b0b', color2: '#050505', rough: 0.25, clearcoat: 1 }),
  whiteMarble: M('marble', { label: 'Marbre blanc', color: '#e9e6e0', color2: '#8e8a84', rough: 0.2, clearcoat: 0.8 }),
  linen: M('linen', { label: 'Nappe de lin', color: '#d7d2c6', color2: '#bdb6a6', rough: 0.9, sheen: 0.3 }),
  zinc: M('metal', { label: 'Zinc', color: '#a9aeb0', color2: '#8d9294', rough: 0.4, metal: 1 }),
  // cadres et montures
  giltFrame: M('metal', { label: 'Bois doré', color: '#e4c78d', color2: '#a38250', rough: 0.32, metal: 1 }),
  blackFrame: M('lacquer', { label: 'Poirier noirci', color: '#141210', color2: '#0a0908', rough: 0.35, clearcoat: 0.6 }),
  walnutFrame: M('wood', { label: 'Noyer ciré', color: '#4a3020', color2: '#2e1c12', rough: 0.4, clearcoat: 0.5, scale: 2 }),
  silverFrame: M('metal', { label: 'Argent terni', color: '#cfccc6', color2: '#8f8a80', rough: 0.42, metal: 1 }),
  brass: M('metal', { label: 'Laiton', color: '#e8cf8e', color2: '#b29a5c', rough: 0.25, metal: 1 }),
  nickel: M('metal', { label: 'Nickel', color: '#d4cdc0', color2: '#a9a397', rough: 0.18, metal: 1 }),
  bakelite: M('bakelite', { label: 'Bakélite', color: '#1a120d', color2: '#0d0907', rough: 0.25, clearcoat: 0.8 }),
  porcelainSocket: M('glaze', { label: 'Porcelaine', color: '#eeebe4', color2: '#d8d2c6', rough: 0.25, clearcoat: 1 }),
};

// Palettes de la nature morte (Morandi : couleurs poudrées, une seule plus
// franche) ; [couleur, rugosité, émaillé ?]
const PAL = {
  morandi: [['#d9d1c3', 0.75, 0], ['#b7aa96', 0.8, 0], ['#8e9a94', 0.7, 0], ['#c9b8a0', 0.75, 0], ['#6f7a80', 0.6, 1], ['#e8e3d8', 0.4, 1]],
  green: [['#d7d3c4', 0.5, 1], ['#9aa58f', 0.55, 1], ['#4f5c4a', 0.4, 1], ['#c4b79d', 0.75, 0], ['#e9e4d6', 0.35, 1]],
  black: [['#eeeae2', 0.3, 1], ['#d9d4ca', 0.35, 1], ['#f3f1ec', 0.25, 1], ['#bdb8ae', 0.5, 0], ['#1b1a19', 0.25, 1]],
  red: [['#e9e1d3', 0.35, 1], ['#151312', 0.3, 1], ['#c8b28c', 0.4, 1], ['#efe9df', 0.3, 1], ['#2b3a4e', 0.35, 1]],
  white: [['#f2f0ea', 0.35, 1], ['#dfe5e4', 0.3, 1], ['#9fb8bf', 0.35, 1], ['#e7e0d2', 0.6, 0], ['#3f5f70', 0.3, 1]],
  blue: [['#e4e0d6', 0.45, 1], ['#b9c3c9', 0.5, 1], ['#7d93a6', 0.45, 1], ['#cdbfa6', 0.7, 0], ['#d9d6cf', 0.55, 0]],
  dawn: [['#efe7dc', 0.5, 1], ['#d9c0b2', 0.6, 0], ['#a9b4ad', 0.55, 1], ['#e6d6b8', 0.7, 0], ['#7d6a72', 0.45, 1]],
};

// ── Humeurs : des décors, pas des teintes ────────────────────────────────────
// wall, floor, table : matières ; window : lumière d'une fenêtre hors champ
// (couleur, intensité, azimut et élévation d'où elle vient ; 0 : pas de
// fenêtre) ; lampK : température de l'ampoule ; lamp : intensité (cd, avant
// dosage) ; frames : montures ; framing : cadrages permis ; env : studio HDR
// (une pièce) ; bg : ce que voit le miroir derrière la caméra ; grade :
// étalonnage (contraste, saturation, virage) ; families : réflecteurs permis.
export const MOODS = {
  strandgade: {
    label: 'Strandgade', author: 'Hammershøi',
    wall: 'greyPanel', floor: 'oakFloor', table: ['oak', 'linen'], pal: 'morandi', frames: ['blackFrame', 'walnutFrame'], metal: ['brass', 'nickel'],
    window: { color: '#8ea6d4', intensity: 0.22, az: -2.2, el: 0.42 }, lampK: 4300, lamp: 1.9,
    env: 'echoDusk', bg: '#121722', framing: ['assis', 'trois'], families: ['trumeau', 'psyche', 'ardent', 'facettes'],
    grade: { contrast: 1.02, saturation: 0.82, shadows: [0.95, 1.0, 1.06], highlights: [1.02, 1.0, 0.97] },
  },
  lambris: {
    label: 'Lambris', author: 'Hammershøi',
    wall: 'greenPanel', floor: 'darkFloor', table: ['walnut', 'linen'], pal: 'green', frames: ['giltFrame', 'walnutFrame'], metal: ['brass'],
    window: { color: '#9fb2a4', intensity: 0.128, az: -2.4, el: 0.5 }, lampK: 3300, lamp: 2.1,
    env: 'echoDusk', bg: '#0c110e', framing: ['trois', 'plongee'], families: ['trumeau', 'psyche', 'ardent'],
    grade: { contrast: 1.06, saturation: 0.86, shadows: [0.94, 1.0, 1.0], highlights: [1.03, 1.0, 0.95] },
  },
  laque: {
    label: 'Laque',
    wall: 'redLacquer', floor: 'darkFloor', table: ['blackLacquer'], pal: 'red', frames: ['giltFrame', 'blackFrame'], metal: ['brass', 'nickel'],
    window: { color: '#4a5c8c', intensity: 0.05, az: -2.0, el: 0.6 }, lampK: 5200, lamp: 2.0,
    env: 'echoNight', bg: '#080404', framing: ['bas', 'assis'], families: ['trumeau', 'ardent', 'facettes'],
    grade: { contrast: 1.08, saturation: 1.0, shadows: [0.92, 0.96, 1.08], highlights: [1.0, 0.99, 0.98] },
  },
  cabinet: {
    label: 'Cabinet noir',
    wall: 'blackVelvet', floor: 'darkFloor', table: ['whiteMarble'], pal: 'black', frames: ['silverFrame', 'blackFrame'], metal: ['nickel'],
    window: { color: '#6a7cb0', intensity: 0.12, az: -2.0, el: 0.6 }, lampK: 6000, lamp: 1.7,
    env: 'echoDark', bg: '#020203', framing: ['assis', 'trois'], families: ['psyche', 'ardent', 'facettes'],
    grade: { contrast: 1.1, saturation: 0.85, shadows: [0.96, 0.98, 1.06], highlights: [1, 1, 1.01] },
  },
  carrelage: {
    label: 'Carrelage',
    wall: 'whiteTile', floor: 'concrete', table: ['zinc', 'whiteMarble'], pal: 'white', frames: ['nickel', 'silverFrame'], metal: ['nickel'],
    window: { color: '#b6c4d6', intensity: 0.28, az: -2.3, el: 0.55 }, lampK: 5600, lamp: 1.6,
    env: 'echoDawn', bg: '#1a1e24', framing: ['assis', 'plongee'], families: ['trumeau', 'ardent', 'facettes'],
    grade: { contrast: 1.0, saturation: 0.85, shadows: [0.96, 1.0, 1.05], highlights: [1, 1, 1] },
  },
  atelier: {
    label: 'Atelier blanc',
    wall: 'whitePlaster', floor: 'concrete', table: ['pine'], pal: 'blue', frames: ['blackFrame', 'silverFrame'], metal: ['nickel'],
    window: { color: '#c9d6e6', intensity: 0.42, az: -2.5, el: 0.7 }, lampK: 6500, lamp: 2.6,
    env: 'echoDay', bg: '#2a2d31', framing: ['trois', 'plongee'], families: ['trumeau', 'psyche', 'facettes'],
    grade: { contrast: 1.04, saturation: 0.8, shadows: [0.97, 1.0, 1.04], highlights: [1, 1, 1], exposure: 0.9 },
  },
  prusse: {
    label: 'Bleu de Prusse',
    wall: 'blueWall', floor: 'oakFloor', table: ['pine', 'linen'], pal: 'dawn', frames: ['giltFrame', 'silverFrame'], metal: ['brass'],
    window: { color: '#f0b98f', intensity: 0.2, az: 2.4, el: 0.18 }, lampK: 5000, lamp: 2.0,
    env: 'echoDawn', bg: '#0e1420', framing: ['assis', 'bas'], families: ['trumeau', 'psyche', 'ardent', 'facettes'],
    grade: { contrast: 1.04, saturation: 0.95, shadows: [0.94, 0.98, 1.08], highlights: [1.03, 1.0, 0.96] },
  },
};
export const DEFAULT_MOOD = 'strandgade';

// ── Nature morte : les vases tournés ────────────────────────────────────────
// h : hauteur, r : rayon du ventre (m) ; chaque forme a son profil (gen/build.js)
export const VESSELS = {
  bottle: { label: 'Bouteille', h: [0.24, 0.34], r: [0.034, 0.046] },
  jug: { label: 'Cruche', h: [0.17, 0.24], r: [0.055, 0.07] },
  jar: { label: 'Pot à couvercle', h: [0.11, 0.16], r: [0.05, 0.068] },
  bowl: { label: 'Bol', h: [0.055, 0.075], r: [0.075, 0.095] },
  beaker: { label: 'Gobelet', h: [0.09, 0.12], r: [0.034, 0.044] },
  vase: { label: 'Vase', h: [0.16, 0.24], r: [0.045, 0.06] },
  flask: { label: 'Flacon', h: [0.13, 0.18], r: [0.04, 0.05] },
};

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').weighted(Object.keys(MOODS).map((k) => [k, k === 'strandgade' || k === 'prusse' ? 1.4 : 1]));
  const Md = MOODS[mood];
  const rf = rng.fork('family'), rc = rng.fork('camera'), rl = rng.fork('light'), rm = rng.fork('mats'), ro = rng.fork('objects'), rt = rng.fork('film');
  // (les glaces d'abord : c'est là que l'écho se lit le mieux)
  const family = overrides.family ?? rf.weighted(Md.families.map((f) => [f, { trumeau: 1.6, psyche: 1.3, ardent: 0.7, facettes: 0.9 }[f]]));

  const tableMat = rm.pick(Md.table);
  const palette = PAL[Md.pal];
  const camera = (() => {
    const fr = rc.pick(Md.framing);
    const F = {
      assis: { el: rc.range(0.06, 0.14), dist: rc.range(1.55, 1.8), fov: rc.range(30, 34) },
      trois: { el: rc.range(0.16, 0.26), dist: rc.range(1.6, 1.85), fov: rc.range(30, 34) },
      plongee: { el: rc.range(0.3, 0.4), dist: rc.range(1.7, 1.95), fov: rc.range(30, 33) },
      bas: { el: rc.range(0.02, 0.06), dist: rc.range(1.45, 1.65), fov: rc.range(33, 37) },
    }[fr];
    return {
      framing: fr, az: r3(rc.range(-0.32, 0.32) + (family === 'psyche' ? 0.12 : 0)), el: r3(F.el), dist: r2(F.dist), fov: r2(F.fov),
      sway: r3(rc.range(0.025, 0.05)), swayPhase: r2(rc.range(0, 6.28)), push: r3(rc.range(0.03, 0.06)),
    };
  })();

  const lampKind = rl.pick(['poire', 'globe', 'tube', 'flamme']);
  const R = {
    v: 1, seed, mood, family,
    film: { duration: rt.pick([28, 30, 32]) },
    camera,
    room: {
      wall: Md.wall, floor: Md.floor, wallGap: r2(family === 'trumeau' ? rl.range(0.06, 0.16) : family === 'psyche' ? rl.range(0.5, 0.6) : rl.range(0.25, 0.55)),
    },
    table: { mat: tableMat, width: r2(rm.range(1.15, 1.4)), depth: r2(rm.range(0.62, 0.74)), legs: rm.pick(['tournés', 'fuselés', 'tréteaux']) },
    lamp: {
      kind: lampKind, socket: rm.pick(Md.metal.concat(['porcelainSocket', 'bakelite'])),
      color: kelvinToHex(Md.lampK + rl.range(-150, 150)), intensity: r2(Md.lamp * rl.range(0.92, 1.08)),
      x: r3(rl.range(-0.44, -0.24)), y: r3(rl.range(0.44, 0.54)), z: r3(rl.range(-0.08, 0.1)),
      cord: { length: r3(rl.range(0.2, 0.27)), swing: r3(rl.range(0.04, 0.08)), dir: r2(rl.range(0, 6.28)), damping: r2(rl.range(1.3, 2.0)) },
    },
    window: { ...Md.window, intensity: r2(Md.window.intensity * rl.range(0.9, 1.1)) },
    reflector: {
      frame: rm.pick(Md.frames), shape: rf.pick(['rect', 'oval', 'arch']),
      w: r2(rf.range(0.55, 0.8)), h: r2(rf.range(0.7, 0.95)),
      // (psyché : glace haute et étroite ; ardent : calotte ; facettes : boule)
      cap: r3(rf.range(0.15, 0.19)), ball: { r: r3(rf.range(0.075, 0.1)), rows: rf.pick([14, 16, 18]) },
      jx: r2(rf.range(-0.3, 0.3)), jy: r2(rf.range(-0.25, 0.25)),
    },
    objects: [],
    grade: { ...Md.grade },
  };
  // nature morte : 4 à 7 vases ; une forme au plus deux fois ; une couleur
  // franche au plus (la dernière de la palette)
  const n = ro.int(4, 7);
  const kinds = [];
  const pool = Object.keys(VESSELS);
  while (kinds.length < n) {
    const k = ro.pick(pool);
    if (kinds.filter((x) => x === k).length < (k === 'bottle' ? 2 : 1)) kinds.push(k);
  }
  const strong = ro.next() < 0.6;
  R.objects = kinds.map((k, i) => {
    const V = VESSELS[k];
    const ci = strong && i === 0 ? palette.length - 1 : ro.int(0, palette.length - 2);
    const [color, rough, glazed] = palette[ci];
    return { kind: k, h: r3(ro.range(...V.h)), r: r3(ro.range(...V.r)), color, rough, glazed, var: r2(ro.range(0, 1)) };
  });
  place(R, rng.fork('place'));
  return R;
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood, family: R.family });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
