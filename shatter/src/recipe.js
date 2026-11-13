// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien) ; le panneau la modifie en place. Le rendu
// ne lit que la recette et le temps.
//
// Une scène : un décor (l'humeur), et N pièces (2 à 4) qui se succèdent dans
// la boucle, chacune avec sa forme, son modelé, ses parties, son verre, son
// décor de filigrane et son déclencheur.
//
// Direction artistique (docs/concept.md, test/recipe.test.mjs) :
// - les humeurs sont des décors, pas des teintes : fond, sol, lumière, valeur
//   et cadrage changent ensemble (clair, sombre, plein soleil, pénombre…) ;
// - deux pièces qui se suivent n'ont jamais la même forme, le même verre ni le
//   même déclencheur ; jamais deux verres clairs de suite ; pas de cristal sur
//   fond clair (il y disparaîtrait) ;
// - les lampes sont presque blanches, sauf quand le décor justifie une couleur
//   (vitraux, lumière noire) ; la chaleur vient de l'incandescence.
import { createRng } from '../../shared/rng.js';
import { FINISHES, SETS } from './finishes.js';
import { FORMS, DECORS } from './gen/forms.js';
import { MECHS } from './gen/fracture.js';
import { GLASSES } from './glasses.js';

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

export const CLEAR = new Set(['cristal', 'fume', 'aigue']);
// (presque incolores : ils disparaissent sur un fond clair)
export const PALE = new Set(['cristal', 'dichroique']);

// ── Décors ───────────────────────────────────────────────────────────────────
// bg : fond (cyclorama, brume) ; light : true si le fond est clair ; floor : jeu
// et teinte de la sole ; backdrop : lueur peinte derrière la pièce ; key : la
// lampe (K ou couleur, intensité, hauteur, azimut, pénombre, ouverture) ;
// rim : contre-jours ; cam : cadrage ; fog : brume ; env : studio HDR ;
// prop : une vraie source de lumière dans le fond (gueule de four, fenêtre
// à vitraux), face à la caméra. Les contre-jours suivent la caméra (derrière
// la pièce, de part et d'autre), comme sur un plateau de prise de vue.
export const MOODS = {
  atelier: {
    label: 'Atelier', bg: '#140c07', floor: { set: 'blackSteel', color: '#3e3a36' }, backdrop: { color: '#d07030', gain: 0.1 }, prop: 'four',
    key: { K: 4800, i: [700, 950], el: [1.05, 1.3], az: [-2.3, -1.8], pen: 0.6, angle: 0.5 }, rim: [['#ffb070', 250, 420], ['#8fa8ff', 60, 140]],
    cam: { dist: [6.3, 7.1], height: [0.9, 1.4], fov: [30, 34], orbit: [0], sway: [0.18, 0.3] }, fog: [10, 30], env: 'atelier', envI: [0.5, 0.75], heat: 1.25,
    glasses: ['ambre', 'cristal', 'emeraude', 'fume', 'rubis', 'cobalt'], mechs: { ball: 2, resonance: 1, tempered: 1, thermal: 3 },
    forms: ['vase', 'bouteille', 'carafe', 'cruche', 'fiole'],
    grade: { contrast: 1.06, saturation: 1.0, shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.93] },
  },
  stroboscope: {
    label: 'Stroboscope', bg: '#000000', floor: { set: 'ceramicBlack', color: '#18181a' }, backdrop: { color: '#000000', gain: 0 },
    key: { K: 6500, i: [1100, 1500], el: [0.3, 0.5], az: [-2.9, -2.5], pen: 0.06, angle: 0.42 }, rim: [['#d8e6ff', 600, 900], ['#ffffff', 0, 40]],
    cam: { dist: [4.8, 5.6], height: [0.6, 0.95], fov: [26, 30], orbit: [1, -1], sway: [0.1, 0.2] }, fog: [12, 40], env: 'studio', envI: [0.9, 1.2], heat: 1,
    glasses: ['cristal', 'cobalt', 'fume', 'aigue', 'obsidienne', 'ambre'], mechs: { ball: 4, resonance: 1, tempered: 2, thermal: 0.5 },
    forms: ['bulle', 'verre', 'flute', 'tulipe'],
    grade: { contrast: 1.16, saturation: 0.88, shadows: [0.96, 1.0, 1.06], highlights: [1, 1, 1] },
  },
  laboratoire: {
    label: 'Laboratoire', bg: '#ecebe7', light: true, floor: { set: 'ceramicWhite', color: '#f0efeb' }, backdrop: { color: '#ffffff', gain: 0 },
    key: { K: 6000, i: [300, 420], el: [1.35, 1.48], az: [-2, -1.2], pen: 1, angle: 0.9 }, rim: [['#ffffff', 90, 160], ['#eef3ff', 40, 90]],
    cam: { dist: [6.8, 7.6], height: [1.4, 2.1], fov: [30, 34], orbit: [1, -1], sway: [0.1, 0.2] }, fog: [14, 50], env: 'cyclo', envI: [0.3, 0.42], heat: 0.8,
    glasses: ['cobalt', 'emeraude', 'ambre', 'rubis', 'obsidienne', 'fume', 'uranium'], mechs: { ball: 2, resonance: 2, tempered: 2, thermal: 1 },
    forms: ['fiole', 'bol', 'cloche', 'dome', 'verre'],
    grade: { contrast: 1.02, saturation: 0.95, shadows: [0.97, 1.0, 1.04], highlights: [1, 1, 1] },
  },
  // (soleil : faisceau plus large que le champ, le bord du cône ne se voit jamais)
  soleil: {
    label: 'Plein soleil', bg: '#8fb6d8', light: true, floor: { set: 'biscuit', color: '#c9b088' }, backdrop: { color: '#ffffff', gain: 0.08 },
    key: { K: 5500, i: [1000, 1300], el: [0.85, 1.05], az: [-2.6, -1.6], pen: 0.04, angle: 1.0 }, rim: [['#a8c8ff', 120, 200], ['#ffd8a8', 40, 90]],
    cam: { dist: [7.4, 8.4], height: [2.6, 3.4], fov: [30, 34], orbit: [1, -1], sway: [0.1, 0.2] }, fog: [16, 60], env: 'softbox', envI: [0.45, 0.6], heat: 0.9,
    glasses: ['cristal', 'cobalt', 'emeraude', 'ambre', 'aigue', 'rubis', 'dichroique'], mechs: { ball: 2, resonance: 1.5, tempered: 2, thermal: 2 },
    forms: ['carafe', 'amphore', 'tazza', 'cruche', 'bol'],
    grade: { contrast: 1.04, saturation: 1.06, shadows: [0.96, 0.99, 1.05], highlights: [1.03, 1.01, 0.97] },
  },
  lumiereNoire: {
    label: 'Lumière noire', bg: '#07040e', floor: { set: 'ceramicBlack', color: '#24202c' }, backdrop: { color: '#5a3a9a', gain: 0.28 }, uv: 1,
    key: { color: '#b9a8ff', i: [600, 800], el: [1, 1.2], az: [-2.2, -1.6], pen: 0.5, angle: 0.5 }, rim: [['#6a4cff', 400, 600], ['#ff4fd8', 150, 260]],
    cam: { dist: [5.2, 6], height: [0.6, 1.1], fov: [28, 32], orbit: [1, -1], sway: [0.15, 0.3] }, fog: [9, 28], env: 'night', envI: [0.5, 0.75], heat: 1,
    glasses: ['uranium', 'uranium', 'dichroique', 'cristal', 'aigue'], mechs: { ball: 1.5, resonance: 1.5, tempered: 3, thermal: 1 },
    forms: ['bulle', 'amphore', 'fiole', 'tulipe', 'flute'],
    grade: { contrast: 1.1, saturation: 1.1, shadows: [0.92, 0.94, 1.12], highlights: [1.0, 1.0, 1.04] },
  },
  cathedrale: {
    label: 'Cathédrale', bg: '#17121c', floor: { set: 'obsidian', color: '#4a443d' }, backdrop: { color: '#6e5c80', gain: 0.42 }, prop: 'vitrail',
    key: { color: 'vitrail', i: [1700, 2300], el: [1.3, 1.42], az: [-2.4, -1.4], pen: 0.35, angle: 0.2 }, rim: [['#ff9a4a', 350, 520], ['#4a7aff', 220, 340]],
    cam: { dist: [7.4, 8.4], height: [0.5, 0.75], fov: [36, 42], orbit: [0], sway: [0.2, 0.35] }, fog: [7, 34], env: 'atelier', envI: [0.4, 0.6], heat: 1.1,
    glasses: ['rubis', 'cobalt', 'ambre', 'emeraude', 'dichroique'], mechs: { ball: 1.5, resonance: 3, tempered: 1, thermal: 1.5 },
    forms: ['cloche', 'amphore', 'tazza', 'verre', 'vase'],
    grade: { contrast: 1.08, saturation: 1.08, shadows: [0.98, 0.93, 1.06], highlights: [1.05, 1.0, 0.95] },
  },
  givre: {
    label: 'Givre', bg: '#cdd8e3', light: true, floor: { set: 'ceramicWhite', color: '#e4ebf1' }, backdrop: { color: '#ffffff', gain: 0.1 },
    key: { K: 9500, i: [1100, 1500], el: [0.16, 0.28], az: [-2.9, -2.3], pen: 0.25, angle: 0.5 }, rim: [['#ffe0c0', 60, 120], ['#c8dcff', 80, 160]],
    cam: { dist: [6.4, 7.2], height: [0.65, 1], fov: [30, 34], orbit: [0], sway: [0.2, 0.35] }, fog: [12, 40], env: 'studio', envI: [0.5, 0.7], heat: 0.95,
    glasses: ['cobalt', 'aigue', 'fume', 'dichroique', 'rubis', 'obsidienne'], mechs: { ball: 2, resonance: 2, tempered: 2.5, thermal: 1 },
    forms: ['dome', 'flute', 'verre', 'bulle', 'tulipe'],
    grade: { contrast: 1.05, saturation: 0.9, shadows: [0.92, 0.97, 1.1], highlights: [0.98, 1.0, 1.04] },
  },
};
const VITRAIL = ['#ff9a4a', '#ff5a7a', '#7a8aff', '#ffd060', '#5ad0a0'];

// finitions complètes d'un jeu
export function finishOf(setKey) {
  const S = SETS[setKey];
  const fin = (k) => ({ ...FINISHES[k], preset: k });
  return { set: setKey, outer: fin(S.outer), inner: fin(S.inner), edge: fin(S.edge), wear: S.wear ?? 0 };
}
// sol : uni (un marbre veiné sème des taches qu'on prend pour des éclats), mat
// (un sol vernis reflète les boîtes à lumière du studio), de la teinte du décor
export function floorFinish(setKey, color = null) {
  const f = finishOf(setKey);
  for (const k of ['outer', 'inner', 'edge']) {
    // (ni irisation ni anisotropie : vu en incidence rasante sous la lampe et la
    // gueule du four, un acier brossé irisé devenait une nappe claire, plus
    // lumineuse que la pièce)
    f[k].rough = Math.max(f[k].rough, 0.82); f[k].clearcoat = 0; f[k].smudge = 0; f[k].metal = 0; f[k].irid = 0; f[k].aniso = 0;
    if (color) { f[k].color = color; if (!(k === 'outer' && ['blackSteel', 'biscuit'].includes(setKey))) f[k].pattern = 'plain'; f[k].bump = Math.min(f[k].bump, 0.15); }
  }
  return f;
}

// paramètres de fracture propres au déclencheur
function mechParams(mech, r) {
  if (mech === 'ball') return { rays: r.int(9, 13), aspect: r3(r.range(0.5, 0.7)), ringStep: r3(r.range(0.42, 0.6)), crush: r3(r.range(0.03, 0.045)), branchAt: r.int(2, 4), impactAt: [0.3, 0.72] };
  if (mech === 'resonance') return { strips: r.int(8, 14), elong: r3(r.range(0.18, 0.28)) };
  if (mech === 'tempered') return { dice: r.int(130, 210) };
  return { pieces: r.int(7, 13) };
}
const MECH_KEYS = ['rays', 'aspect', 'ringStep', 'crush', 'branchAt', 'impactAt', 'strips', 'elong', 'dice', 'pieces'];
export function setMech(P, mech, r) {
  for (const k of MECH_KEYS) delete P[k];
  P.mech = mech;
  Object.assign(P, mechParams(mech, r));
}

const weighted = (r, w) => r.weighted(Object.entries(w));

// prev, next : pièces voisines dans la boucle
export function makePiece(r, mood, prev, k, next = null, used = []) {
  const M = MOODS[mood];
  const near = [prev, next].filter(Boolean);
  // (une forme déjà vue dans la boucle ne revient que rarement)
  const fw = Object.fromEntries(Object.keys(FORMS).map((f) => [f, (M.forms.includes(f) ? 3 : 1) * (near.some((q) => q.form === f) ? 0 : used.some((q) => q.form === f) ? 0.05 : 1)]));
  const form = weighted(r, fw);
  const mech = weighted(r, Object.fromEntries(Object.entries(M.mechs).map(([m, w]) => [m, near.some((q) => q.mech === m) ? 0 : w])));
  let choices = M.glasses.filter((g) => near.every((q) => g !== q.glass && !(CLEAR.has(q.glass) && CLEAR.has(g))) && !(M.light && PALE.has(g)));
  if (!choices.length) choices = M.glasses.filter((g) => near.every((q) => g !== q.glass) && !(M.light && PALE.has(g)));
  const glass = r.pick(choices);
  // modelé, parties, filigrane
  const footed = ['verre', 'flute', 'tazza'].includes(form);
  const decor = r.weighted([['lisse', 1.2], ['cotes', 2], ['torse', 2], ['lobes', 1], ['feston', footed || form === 'bol' || form === 'tulipe' ? 2 : 0.6], ['godrons', 1]]);
  const decorN = decor === 'lobes' ? r.int(3, 6) : decor === 'feston' ? r.int(6, 12) : decor === 'godrons' ? r.int(10, 18) : r.int(10, 24);
  const avail = FORMS[form].parts ?? [];
  const parts = avail.filter((p) => (p === 'anse' || p === 'anses2' ? true : p === 'bouchon' ? r.chance(0.75) : r.chance(0.4)));
  const opaque = GLASSES[glass]?.opaque;
  return {
    form, glass, mech, decor, decorN, decorAmp: r3(r.range(0.025, 0.055)), twist: r3(r.sign() * r.range(0.3, 0.9)),
    parts, handleAngle: r3(r.range(0, Math.PI * 2)), threadTurns: r.int(4, 9), threadFrom: r3(r.range(0.5, 0.62)), threadTo: r3(r.range(0.8, 0.93)),
    fil: !opaque && r.chance(0.28) ? 1 : 0, filN: r.int(10, 24), filTwist: r3(r.sign() * r.range(0.4, 1.6)),
    seed: `${k}:${r.int(0, 1e6)}`,
    stretch: r3(r.range(0.9, 1.1)), wide: r3(r.range(0.9, 1.1)), bulge: r3(r.range(-0.06, 0.1)), waist: r3(r.range(-0.04, 0.04)),
    thickness: r3(r.range(0.014, 0.022)), warp: r3(r.range(0.014, 0.03)), force: r2(r.range(0.85, 1.2)), fire: r2(r.range(0.8, 1.2)),
    spin: r3(r.sign() * r.range(0.5, 1.1)), angle0: r3(r.range(0, Math.PI * 2)), side: r.sign(),
    ...mechParams(mech, r),
  };
}

// spécification envoyée au worker (tout ce qui change la géométrie)
export function pieceSpec(R, k) {
  const P = R.pieces[k];
  // (le ralenti fixe l'instant où chaque éclat est libéré : la simulation en dépend)
  const spec = { seed: `${R.seed}/${P.seed}`, size: R.size, Ts: R.loop.stage, slow: R.loop.slow };
  for (const key of ['form', 'mech', 'stretch', 'wide', 'bulge', 'waist', 'thickness', 'warp', 'force', 'decor', 'decorN', 'decorAmp', 'twist', 'parts', 'handleAngle', 'threadTurns', 'threadFrom', 'threadTo', ...MECH_KEYS]) if (P[key] !== undefined) spec[key] = P[key];
  return spec;
}

const pickRange = (r, [a, b]) => r2(r.range(a, b));

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rr = rng.fork('rythme'), rp = rng.fork('pieces'), rc = rng.fork('camera'), rl = rng.fork('light');
  const N = overrides.count ?? rr.weighted([[2, 1], [3, 3], [4, 1.5]]);
  const sway = pickRange(rc, M.cam.sway);
  // (le four ou la fenêtre de côté, au tiers de l'image, jamais derrière la
  // pièce : décalé d'au moins le balancement de la caméra, plus une marge)
  const propOff = rc.sign() * (sway + rc.range(0.12, 0.22));
  const pieces = [];
  for (let k = 0; k < N; k++) pieces.push(makePiece(rp, mood, pieces[k - 1], k, k === N - 1 && N > 2 ? pieces[0] : null, pieces));
  const K = M.key;
  const keyColor = K.color === 'vitrail' ? rl.pick(VITRAIL) : K.color ?? kelvinToHex(K.K + rl.range(-200, 200));
  const propAz = r2(rl.range(0, Math.PI * 2));
  return {
    v: 2, seed, mood, size: 2,
    // étape : durée ; caméra rapide autour de la rupture : ralenti k, durées
    loop: { stage: r2(rr.range(11, 13)), slow: { k: rr.int(12, 20), pre: -0.09, plat: r2(rr.range(1.8, 2.4)), post: r2(rr.range(0.8, 1.2)) } },
    pieces,
    camera: {
      fov: pickRange(rc, M.cam.fov), dist: pickRange(rc, M.cam.dist), height: pickRange(rc, M.cam.height), orbit: rc.pick(M.cam.orbit), sway,
      // (face au four ou à la fenêtre)
      az: M.prop ? r2(-propAz - Math.PI / 2 + propOff) : r2(rc.range(0, Math.PI * 2)), push: r2(rc.range(0.06, 0.12)), // (la caméra est en (sin az, cos az), le décor en (cos a, sin a))
    },
    light: {
      key: { color: keyColor, intensity: r2(rl.range(...K.i)), az: r2(rl.range(...K.az)), el: r2(rl.range(...K.el)), angle: K.angle, penumbra: K.pen },
      // (az : décalage par rapport à l'axe caméra → pièce, derrière la pièce)
      rim: M.rim.map(([c, a, b], i) => ({ color: c, intensity: r2(rl.range(a, b)), az: r2((i ? -1 : 1) * rl.range(0.45, 0.9)), el: r2(rl.range(0.2, 0.45) + (mood === 'cathedrale' ? 0.8 : 0)) })),
      heat: r2(M.heat * rl.range(0.9, 1.1)), uv: M.uv ?? 0, prop: M.prop ? { kind: M.prop, az: propAz, intensity: r2(rl.range(0.8, 1.2)), seed: rl.int(0, 999) } : null,
    },
    env: { preset: M.env, intensity: pickRange(rl, M.envI), rotation: r2(rl.range(0, Math.PI * 2)) },
    fog: { color: M.bg, near: M.fog[0], far: M.fog[1] },
    backdrop: { color: M.backdrop.color, gain: r2(M.backdrop.gain * rl.range(0.85, 1.15)) },
    floor: { finish: floorFinish(M.floor.set, M.floor.color) },
    grade: { ...M.grade },
  };
}

export const loopDuration = (R) => R.loop.stage * R.pieces.length;

// Recette ancienne (lien partagé) → recette courante
export function upgrade(R) {
  if (R.v !== 2) return generate(R.seed ?? 'calcin', MOODS[R.mood] ? { mood: R.mood } : {});
  const D = generate(R.seed, { mood: R.mood, count: R.pieces?.length });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}

export { MECHS, FORMS, DECORS };
