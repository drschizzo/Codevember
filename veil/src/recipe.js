// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Ce qu'elle tire, chaque famille sur son propre flux (rng.fork) :
//   l'humeur (un décor : fond, sol, socle, lumière, étalonnage), la dentelle
//   (son dessin, son pas, son feston), ses fils (le réseau, choisi pour
//   trancher sur le fond, et parfois un second fil pour le cordonnet), la
//   suite des formes invisibles et leurs poses, le socle, les temps du geste,
//   la caméra.
import { createRng } from '../../shared/rng.js';
import { FINISHES } from '../../shared/finishes.js';
import { FABRICS } from './gen/cloth.js';
import { FORMS, PLINTHS, drawForm } from './gen/forms.js';
import { descDuration, riseDuration } from './timeline.js';

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

// luminance relative d'une couleur sRGB (#rrggbb)
export function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// ── Les fils de la dentelle (teintes de teinturier) ─────────────────────────
// Le voile est une dentelle ; seuls changent son dessin et ses fils.
export const VEIL_COLORS = {
  blanc: { label: 'Blanc', hex: '#f1eee8' },
  ivoire: { label: 'Ivoire', hex: '#ece1cc' },
  ecru: { label: 'Écru', hex: '#d8c7a4' },
  perle: { label: 'Gris perle', hex: '#c9c6c1' },
  the: { label: 'Rose thé', hex: '#e7bfae' },
  poudre: { label: 'Bleu poudre', hex: '#b7c8dc' },
  or: { label: 'Vieil or', hex: '#b8923f' },
  vermillon: { label: 'Vermillon', hex: '#c8321e' },
  ardoise: { label: 'Ardoise', hex: '#4f5964' },
  bordeaux: { label: 'Bordeaux', hex: '#5c1a22' },
  bouteille: { label: 'Vert bouteille', hex: '#1f3a30' },
  nuit: { label: 'Bleu nuit', hex: '#1c2742' },
  prune: { label: 'Prune', hex: '#3d2238' },
  noir: { label: 'Noir', hex: '#16161a' },
};
// (poids : le noir de Chantilly et les blancs dominent, les teintes vives sont rares)
const LACE_COLORS = [['noir', 5], ['ivoire', 4], ['blanc', 4], ['ecru', 2], ['perle', 1], ['the', 2], ['poudre', 1], ['or', 1], ['vermillon', 1], ['ardoise', 2], ['bordeaux', 2], ['bouteille', 2], ['nuit', 2], ['prune', 1]];
// fil du motif quand il diffère du réseau (accords posés à la main)
const SECOND = {
  noir: ['#c9a44c', '#e8e0cf'], nuit: ['#c9c6c1', '#c9a44c'], bordeaux: ['#c9a44c', '#e7bfae'], bouteille: ['#e8e0cf', '#c9a44c'], prune: ['#e7bfae'], ardoise: ['#f1eee8'],
  ivoire: ['#fbf8f1'], ecru: ['#f1eee8'], the: ['#f6efe6'], poudre: ['#f1eee8'], perle: ['#f4f2ee'],
};

// teintes des hologrammes : sur fond sombre, sur fond clair
const HOLO_PALE = ['#8fd6ff', '#9dffe0', '#ffc98a', '#ff9ec4', '#c9b0ff', '#fff3a6'];
const HOLO_DEEP = ['#2f9bff', '#12b89a', '#ff7a1a', '#f0387e', '#7d56f0', '#d9a400'];

// ── Les dessins de dentelle (aspect seul : la simulation les ignore) ────────
// scale : pas du dessin, en mètres (une fleur, un éventail, un rapport de filet)
export const LACES = {
  chantilly: { label: 'Chantilly', scale: [0.05, 0.065] },
  guipure: { label: 'Guipure', scale: [0.06, 0.08] },
  filet: { label: 'Filet brodé', scale: [0.075, 0.095] },
  plumetis: { label: 'Plumetis', scale: [0.022, 0.03] },
  cluny: { label: 'Cluny', scale: [0.045, 0.06] },
  ecailles: { label: 'Écailles', scale: [0.045, 0.06] },
  rinceaux: { label: 'Rinceaux', scale: [0.07, 0.09] },
};
const LACE_WEIGHTS = [['chantilly', 4], ['guipure', 3], ['filet', 2], ['plumetis', 2], ['cluny', 3], ['ecailles', 3], ['rinceaux', 3]];
function drawLace(colorKey, L, rng, forced, reads = () => true) {
  const kind = forced ?? rng.weighted(LACE_WEIGHTS);
  const base = VEIL_COLORS[colorKey].hex;
  // (un fil de motif distinct : une dentelle sur trois, quand la teinte en a un)
  // (le réseau est si léger que c'est le fil du motif qui donne sa valeur au
  // voile : lui aussi doit trancher sur le fond — un noir à cordonnet ivoire
  // devant un mur clair se lisait blanc)
  const two = rng.next() < 0.35, pick = rng.pick(SECOND[colorKey] ?? [base]);
  const color2 = two && reads(pick) ? pick : base;
  // (un nombre entier de festons par côté, de 3 à 5 cm chacun : les coins tombent sur un creux)
  const scallops = Math.round(L / rng.range(0.032, 0.05));
  return { kind, color2, scale: r3(rng.range(...LACES[kind].scale)), scallops };
}

// ── Humeurs : un décor chacune ───────────────────────────────────────────────
// bg : fond (cyclorama) ; floor, plinthFinish : matières ; light : le
// dispositif (voir scene/lights.js) ; env : studio HDR ; grade : étalonnage ;
// plinths : socles qui vont avec ; cam : cadrage (azimut, plongée) ;
// (la couleur du voile est choisie pour trancher sur le fond : voir generate)
export const MOODS = {
  galerie: {
    label: 'Galerie', bg: '#b4bec8', bg2: '#d5dbe0', env: 'overcast', envIntensity: 0.08,
    floor: { base: 'bisque', color: '#9ea3a6', color2: '#8d9295', rough: 0.55 },
    plinthFinish: { base: 'bisque', color: '#e6e3dd', color2: '#d8d4cc' },
    plinths: ['die', 'die', 'column', 'block'],
    light: { kind: 'skylight', K: 6200, key: 1.35, fill: 0.08, rim: 0.45, az: -1.45, el: 0.5 },
    cam: { az: [0.45, 0.8], el: [0.02, 0.12] },
    grade: { contrast: 1.02, saturation: 0.9, shadows: [0.96, 1.0, 1.05], highlights: [1.0, 1.0, 1.0] },
  },
  atelier: {
    label: 'Atelier', bg: '#62686d', bg2: '#80878c', env: 'softbox', envIntensity: 0.08,
    floor: { base: 'bisque', color: '#5c6063', color2: '#4d5154', rough: 0.72 },
    plinthFinish: { base: 'bisque', color: '#bdb5a9', color2: '#a69d90' },
    plinths: ['stand', 'stand', 'block'],
    light: { kind: 'window', K: 6800, key: 1.1, fill: 0.1, rim: 0.3, az: -1.55, el: 0.45 },
    cam: { az: [-0.15, 0.35], el: [0.08, 0.2] },
    grade: { contrast: 1.08, saturation: 0.88, shadows: [0.97, 0.99, 1.05], highlights: [1.0, 1.0, 1.0] },
  },
  nuit: {
    label: 'Nuit de musée', bg: '#07080b', bg2: '#101218', env: 'night', envIntensity: 0.06,
    // (veines éteintes : à pleine clarté, elles zébraient le socle d'éclairs)
    floor: { base: 'marbleNoir', color2: '#3a3733', rough: 0.35 },
    plinthFinish: { base: 'marbleNoir', color2: '#5a554d', rough: 0.2 },
    plinths: ['die', 'column', 'gueridon'],
    light: { kind: 'spot', K: 5600, key: 1.0, fill: 0.04, rim: 0.5, az: -0.4, el: 1.38 },
    cam: { az: [0.3, 0.7], el: [0.12, 0.24] },
    grade: { contrast: 1.12, saturation: 0.95, shadows: [0.92, 0.97, 1.1], highlights: [1.0, 1.0, 1.0] },
  },
  amants: {
    label: 'Les Amants', bg: '#6f8db0', bg2: '#c9d3d6', env: 'overcast', envIntensity: 0.11,
    floor: { base: 'bisque', color: '#8d8a84', color2: '#7d7a74', rough: 0.85 },
    plinthFinish: { base: 'bisque', color: '#a9a49c', color2: '#99948c' },
    plinths: ['die', 'block', 'column'],
    light: { kind: 'overcast', K: 6500, key: 1.0, fill: 0.22, rim: 0.25, az: -1.0, el: 0.6 },
    cam: { az: [-0.08, 0.08], el: [0.0, 0.06] },
    grade: { contrast: 0.98, saturation: 1.0, shadows: [0.97, 1.0, 1.03], highlights: [1.0, 1.0, 0.99] },
  },
  contrejour: {
    label: 'Contre-jour', bg: '#d9d6cf', bg2: '#f2efe8', env: 'fogwhite', envIntensity: 0.175,
    floor: { base: 'bisque', color: '#b9b5ae', color2: '#a9a59e', rough: 0.6 },
    plinthFinish: { base: 'bisque', color: '#9c968e', color2: '#8c867e' },
    plinths: ['block', 'die', 'gueridon'],
    light: { kind: 'backlight', K: 5900, key: 1.0, fill: 0.12, rim: 1.0, az: 2.6, el: 0.5 },
    cam: { az: [-0.5, 0.5], el: [-0.04, 0.06] },
    grade: { contrast: 1.04, saturation: 0.92, shadows: [0.98, 1.0, 1.03], highlights: [1.02, 1.0, 0.97] },
  },
  platre: {
    label: 'Plâtre', bg: '#e9e6e0', bg2: '#f4f2ee', env: 'cyclo', envIntensity: 0.06,
    floor: { base: 'bisque', color: '#dcd8d1', color2: '#cfcac2', rough: 0.85 },
    plinthFinish: { base: 'bisque', color: '#eeebe5', color2: '#e1ddd5' },
    plinths: ['die', 'block', 'gueridon', 'stand'],
    light: { kind: 'softbox', K: 6000, key: 0.9, fill: 0.1, rim: 0.3, az: -1.45, el: 0.55 },
    cam: { az: [0.2, 0.6], el: [0.06, 0.16] },
    grade: { contrast: 1.1, saturation: 0.98, shadows: [0.97, 0.99, 1.03], highlights: [1.0, 1.0, 1.0] },
  },
};

export function finishFrom(o) {
  const F = { ...FINISHES[o.base], preset: o.base };
  for (const k of ['color', 'color2', 'rough']) if (o[k] != null) F[k] = o[k];
  return { set: o.base, outer: F, inner: F, edge: F, wear: 0 };
}

// vent par étoffe : vitesse (m/s) — assez pour plaquer la plus légère, pas
// pour emporter la plus lourde
// humidité du linge par étoffe (0 sec, 1 trempé) : un linge humide se colle à
// ce qu'il couvre (capillarité) et y glisse — c'est lui qui dessine la statue
const WET = { dentelle: 0.75 };
// durée de la descente par étoffe (le satin tombe vite, la mousseline flotte)
const LOWER = { dentelle: [2.0, 2.3] }; // (le hamac ne descend que de 10 à 20 cm avant de se poser : plus long, le voile passait la moitié de la boucle en l'air)

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').weighted([['galerie', 3], ['atelier', 2], ['nuit', 2], ['amants', 2], ['contrejour', 2], ['platre', 2]]);
  const M = MOODS[mood];
  const fabric = 'dentelle'; // (le voile est une dentelle : ce qui varie, c'est son dessin et ses fils)

  // couleur : parmi celles de l'étoffe, celles qui tranchent sur le fond
  const rc = rng.fork('color');
  // (écart de luminance au fond ≥ 0,3 : un voile ajouré se lit par contraste de valeur)
  const Lb = lum(M.bg);
  const gap = (k) => Math.abs(lum(VEIL_COLORS[k].hex) - Lb);
  const color = overrides.color ?? rc.weighted(LACE_COLORS.filter(([k]) => gap(k) >= 0.3));

  // formes : 2 à 4, sans répétition ; la première est un visage le plus souvent
  const rf = rng.fork('forms');
  const nForms = rf.weighted([[2, 4], [3, 5]]);
  // (les formes qui se lisent sous une étoffe : ce qui dépasse — oreilles,
  // bec, anse, épaules — dessine la silhouette ; le cheval, les amants, la
  // muse, les mains et la nature morte, qui devenaient des tentes ou des
  // fantômes, restent au panneau)
  // (le torse et les trois sphères, qui ne donnaient qu'une boîte et une
  // cloche, restent au panneau ; la lyre entre. Une machine à coudre sur sa
  // table, essayée, a été retirée : trop massive et trop compliquée à côté des autres)
  const pool = ['bust', 'cat', 'teapot', 'amphora', 'chair', 'blocks', 'lyre'];
  const first = rf.weighted([['cat', 2], ['chair', 2], ['bust', 2], ['teapot', 1], ['amphora', 1], ['blocks', 1], ['lyre', 1]]);
  const kinds = [first];
  while (kinds.length < nForms) {
    const k = rf.pick(pool);
    if (!kinds.includes(k)) kinds.push(k);
  }
  const forms = (overrides.forms ?? kinds).map((k, i) => ({ ...drawForm(k, rng.fork(`form${i}:${k}`)) }));
  // l'hologramme de chaque statue a sa teinte, jamais deux fois la même dans
  // une scène ; devant un mur clair, des teintes plus soutenues (une lumière
  // pâle ne s'y verrait pas)
  {
    const rh = rng.fork('holo'), pal = [...(Lb > 0.35 ? HOLO_DEEP : HOLO_PALE)];
    for (const f of forms) f.holo = pal.splice(rh.int(0, pal.length - 1), 1)[0];
  }

  // socle
  const rp = rng.fork('plinth');
  const pk = overrides.plinth ?? rp.pick(M.plinths);
  const plinth = { kind: pk, height: r2(rp.range(0.92, 1.08)), half: r3(pk === 'gueridon' ? rp.range(0.34, 0.37) : pk === 'stand' ? rp.range(0.3, 0.33) : rp.range(0.29, 0.32)) };

  // le voile
  const rv = rng.fork('veil');
  const veil = { L: r2(rv.range(0.95, 1.0)), rot: r2(rv.range(0, Math.PI / 2)), color: VEIL_COLORS[color].hex, colorKey: color, sheen: r2(rv.range(0.7, 1)), holo: 1 }; // (holo : intensité de l'hologramme de la statue, 0 pour l'éteindre)
  veil.lace = drawLace(color, veil.L, rng.fork('lace'), overrides.lace, (hex) => Math.abs(lum(hex) - Lb) >= 0.25);

  // le vent (d'où il vient : de la caméra et un peu de côté, pour plaquer le
  // voile sur le visage que l'on regarde)
  const rw = rng.fork('wind');
  const wAz = r2(rw.range(0.25, 0.6) * rw.sign());
  // (le vent a été retiré : il faisait battre le voile sans cause visible ;
  // le réglage reste au panneau, à 0 par défaut)
  const wind = { az: wAz, speed: 0, breath: r2(rw.range(1.8, 2.6)), phase: r2(rw.range(0, 6.28)), wet: WET[fabric] };

  // temps du geste
  const rt = rng.fork('timing');
  const timing = {
    desc: { pre: 0.3, lower: r2(rt.range(...LOWER[fabric])), settle: r2(rt.range(3.6, 4.4)), fall: 1.8 }, // (fall : la statue s'évanouit, le linge s'effondre)
    rise: { tug: 0.45, lift: r2(rt.range(1.8, 2.1)), hang: r2(rt.range(1.0, 1.2)) },
  };

  // caméra : de trois quarts du côté où le vent plaque le voile
  const rk = rng.fork('camera');
  const camera = {
    az: r2(rk.range(...M.cam.az) * (mood === 'amants' ? 1 : Math.sign(wAz) || 1)),
    el: r2(rk.range(...M.cam.el)),
    dist: r2(rk.range(1.65, 1.9)),
    fov: r2(rk.range(30, 34)),
    sway: r2(rk.range(0.1, 0.18)),
  };

  // les objets qui se lisent de profil sont tournés vers la caméra : le bec
  // et l'anse de la théière, les anses de l'amphore en silhouette, le cheval
  // de trois quarts (sens des aiguilles : yaw = az montre la face +z)
  const YAW = { teapot: 0, amphora: 0, lyre: 0.1, horse: 1.1, cat: 0.12, chair: 0.6, organ: 0.15, blocks: 0.4 };
  for (const f of forms) if (YAW[f.kind] != null) f.yaw = r3(camera.az + YAW[f.kind]);

  const rl = rng.fork('light');
  const L = M.light;
  const light = {
    kind: L.kind, color: kelvinToHex(L.K + rl.range(-150, 150)),
    key: r2(L.key * rl.range(0.92, 1.08)), fill: r2(L.fill), rim: r2(L.rim),
    az: r2(L.az + rl.range(-0.15, 0.15)), el: r2(L.el + rl.range(-0.06, 0.06)),
  };

  return {
    v: 1, seed, mood, fabric,
    veil, forms, plinth, wind, timing, camera, light,
    sim: { n: 81, sub: 450, fps: 30 }, // (81 × 81 sur le GPU ; le chemin CPU se limite à 53 × 53)
    bg: { color: M.bg, color2: M.bg2 },
    env: { preset: M.env, intensity: M.envIntensity, rotation: r2(rl.range(0, 6.28)) },
    floor: { finish: finishFrom(M.floor) },
    plinthFinish: finishFrom(M.plinthFinish),
    grade: { ...M.grade },
    loop: { duration: r2(forms.length * (descDuration(timing.desc) + riseDuration(timing.rise))) }, // (somme des morceaux, voir timeline.js)
  };
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  // (lien d'avant la dentelle seule : l'étoffe devient dentelle, avec le dessin de sa graine)
  if (R.fabric !== 'dentelle') { R.fabric = 'dentelle'; R.wind.wet = D.wind.wet; }
  if (R.veil.holo == null) R.veil.holo = 1;
  R.forms.forEach((f, i) => { if (!f.holo) f.holo = D.forms[i]?.holo ?? '#5fb8ff'; });
  if (!R.veil.lace) { R.veil.lace = { ...D.veil.lace, color2: R.veil.color }; delete R.veil.motif; }
  return R;
}

export { FABRICS, FORMS, PLINTHS };
