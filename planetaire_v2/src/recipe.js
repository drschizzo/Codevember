// Recette de la scène : tout ce qui découle de la graine (orbite demandée,
// humeur, matières, astres, trace, mise en scène, lumières). L'objet est
// sérialisable (« Copier le lien ») et entièrement modifiable depuis le
// panneau ; les réglages de rendu n'en font pas partie (app/settings.js).
//
// L'orbite elle-même n'est pas dans la recette : elle se recalcule, à
// l'identique, à partir de la graine et des contraintes demandées (nombre de
// corps, symétrie, rotation du plateau).
import { createRng } from './rng.js';

const r2 = (x) => Math.round(x * 100) / 100;

// Matières (modèle physique) : couleur linéaire, métal, rugosité, vernis ;
// irid : irisation (nacre), sheen : lustre (bois ciré)
export const MATTERS = {
  laiton: { label: 'Laiton', color: [0.86, 0.64, 0.33], metal: 1, rough: 0.26, coat: 0.4 },
  laitonBrosse: { label: 'Laiton brossé', color: [0.8, 0.6, 0.3], metal: 1, rough: 0.4, coat: 0 },
  bronze: { label: 'Bronze patiné', color: [0.2, 0.125, 0.07], metal: 1, rough: 0.5, coat: 0.3 },
  bronzeVert: { label: 'Bronze vert-de-gris', color: [0.16, 0.24, 0.19], metal: 0.6, rough: 0.6, coat: 0.2 },
  or: { label: 'Or', color: [1.0, 0.77, 0.34], metal: 1, rough: 0.18, coat: 0 },
  orRose: { label: 'Or rose', color: [0.98, 0.64, 0.52], metal: 1, rough: 0.2, coat: 0 },
  cuivre: { label: 'Cuivre', color: [0.95, 0.58, 0.42], metal: 1, rough: 0.3, coat: 0.2 },
  acierBleui: { label: 'Acier bleui', color: [0.1, 0.14, 0.32], metal: 1, rough: 0.2, coat: 0.6 },
  acierPoli: { label: 'Acier poli', color: [0.92, 0.92, 0.9], metal: 1, rough: 0.14, coat: 0 },
  acierBrosse: { label: 'Acier satiné', color: [0.62, 0.63, 0.64], metal: 1, rough: 0.42, coat: 0 },
  maillechort: { label: 'Maillechort', color: [0.78, 0.77, 0.71], metal: 1, rough: 0.3, coat: 0 },
  ruthenium: { label: 'Ruthénium (anthracite)', color: [0.2, 0.2, 0.22], metal: 1, rough: 0.3, coat: 0.2 },
  acierNoirci: { label: 'Acier noirci', color: [0.07, 0.07, 0.075], metal: 1, rough: 0.35, coat: 0.3 },
  chrome: { label: 'Chrome', color: [0.95, 0.95, 0.96], metal: 1, rough: 0.05, coat: 0 },
  argent: { label: 'Argent', color: [0.97, 0.96, 0.93], metal: 1, rough: 0.2, coat: 0 },
  titane: { label: 'Titane anodisé', color: [0.32, 0.18, 0.55], metal: 1, rough: 0.25, coat: 0.3, irid: 0.6 },
  fonte: { label: 'Fonte', color: [0.18, 0.18, 0.19], metal: 1, rough: 0.6, coat: 0 },
  porcelaine: { label: 'Porcelaine', color: [0.86, 0.85, 0.82], metal: 0, rough: 0.25, coat: 1 },
  emailBleu: { label: 'Émail bleu de Sèvres', color: [0.02, 0.05, 0.3], metal: 0, rough: 0.2, coat: 1 },
  emailRouge: { label: 'Émail rouge', color: [0.35, 0.02, 0.02], metal: 0, rough: 0.2, coat: 1 },
  laqueNoire: { label: 'Laque noire', color: [0.012, 0.012, 0.014], metal: 0, rough: 0.3, coat: 1 },
  marbreNoir: { label: 'Marbre noir', color: [0.02, 0.02, 0.022], metal: 0, rough: 0.12, coat: 0.6 },
  marbreBlanc: { label: 'Marbre blanc', color: [0.78, 0.77, 0.74], metal: 0, rough: 0.15, coat: 0.6 },
  ardoise: { label: 'Ardoise', color: [0.05, 0.055, 0.06], metal: 0, rough: 0.7, coat: 0 },
  ebene: { label: 'Ébène cirée', color: [0.025, 0.015, 0.01], metal: 0, rough: 0.35, coat: 0.8, sheen: 0.4 },
  noyer: { label: 'Noyer ciré', color: [0.11, 0.045, 0.02], metal: 0, rough: 0.45, coat: 0.5, sheen: 0.25 },
  nacre: { label: 'Nacre', color: [0.82, 0.8, 0.76], metal: 0, rough: 0.15, coat: 1, irid: 1 },
};

// Humeurs : studio, lumières, accords de matières, natures préférées, couleur des astres.
//
// Les matières ne sont pas tirées rôle par rôle (on obtenait des machines
// entièrement dorées) : chaque humeur a ses accords, composés à la main comme
// une palette. Un accord donne, dans l'ordre, plateau, bâti, bras, bras
// alternés, roues, goupilles et montures (un tableau : des variantes). La règle :
// un fond (plateau et bâti, les grandes surfaces : sombre, pâle ou coloré), un
// métal de structure, et l'or, le bronze ou le cuivre en accent, sur moins de
// la moitié de la machine, jamais à la fois sur le plateau et sur les roues
// (les deux masses de l'image) ; au moins trois familles de matières par scène. Vérifié sur tous
// les accords par tools/accords.mjs.
// Les lampes sont presque blanches (à peine chaudes) : sous une lampe orangée,
// l'acier, l'argent et la fonte se lisaient tous comme de l'or ou du cuivre.
// La chaleur d'une humeur vient de son fond, de sa brume, de ses astres et de
// ses accents, pas d'un voile sur toute l'image.
export const ACCORD_ROLES = ['plate', 'foot', 'arms', 'arms2', 'gears', 'pins'];
export const MOODS = {
  atelier: {
    atmo: { dust: 1, beam: 0.8, haze: 0.35, embers: 0 },
    arch: [['horlogerie', 3], ['classique', 1]], label: 'Atelier d’horloger', env: 'atelier', envIntensity: 0.95, bg: '#0f0c09', floor: '#1a140f',
    key: { color: '#fff0dc', intensity: 11 }, rim: { color: '#bcd2ff', intensity: 0.8 }, warmth: 0.06,
    // (un mouvement d'horlogerie : ponts rhodiés ou maillechort, roues de laiton, vis bleuies)
    accords: [
      [['ruthenium', 'acierNoirci'], 'acierBrosse', ['argent', 'maillechort'], 'acierBleui', 'laiton', 'acierPoli'],
      ['emailBleu', ['acierNoirci', 'bronze'], 'laitonBrosse', 'acierPoli', ['acierPoli', 'maillechort'], 'acierBleui'],
      ['maillechort', 'acierNoirci', 'acierPoli', 'acierBleui', 'or', 'acierBleui'],
      [['ebene', 'laqueNoire'], 'ruthenium', ['acierPoli', 'argent'], 'acierBleui', 'laiton', 'acierPoli'],
      ['porcelaine', 'acierNoirci', 'acierBleui', 'acierPoli', ['orRose', 'laiton'], 'acierPoli'],
      ['bronze', 'acierNoirci', 'maillechort', 'laiton', 'acierBrosse', 'acierBleui'],
    ],
    finish: ['guilloche', 'soleil', 'perlage'], globes: [['cardan', 2], ['armillaire', 2], ['griffes', 1]], tints: ['clair', 'ambre'], trace: [['verre', 3], ['or', 1], ['gravure', 1]],
    body: '#ffc489', glass: '#07080a',
  },
  observatoire: {
    atmo: { dust: 0.6, beam: 1.1, haze: 0.55, embers: 0 },
    arch: [['astrolabe', 2], ['classique', 2]], label: 'Observatoire', env: 'night', envIntensity: 1.1, bg: '#0a1020', floor: '#0e1424',
    key: { color: '#b4c8ff', intensity: 8 }, rim: { color: '#8fa8ff', intensity: 1.2 }, warmth: -0.25,
    // (nuit froide : argent et acier sur émail ou pierre sombre, le laiton en une seule touche)
    accords: [
      ['emailBleu', 'acierNoirci', 'argent', 'acierBleui', 'laiton', 'chrome'],
      ['marbreNoir', ['argent', 'acierBrosse'], 'acierBleui', 'argent', 'acierPoli', 'laiton'],
      ['ardoise', 'ruthenium', 'acierPoli', 'titane', 'argent', 'chrome'],
      ['argent', 'acierBleui', 'acierNoirci', 'argent', 'laitonBrosse', 'acierPoli'],
      ['nacre', 'acierNoirci', 'acierBleui', 'chrome', 'argent', 'or'],
      ['acierBleui', 'ardoise', 'maillechort', 'acierNoirci', 'argent', 'chrome'],
    ],
    finish: ['lisse', 'soleil'], globes: [['armillaire', 2], ['verre', 2], ['cardan', 1]], tints: ['clair', 'bleute', 'fume'], trace: [['verre', 2], ['gravure', 1]],
    body: '#cfe0ff', glass: '#05070b',
  },
  clinique: {
    atmo: { dust: 0.25, beam: 0.25, haze: 0.15, embers: 0 },
    arch: [['horlogerie', 2], ['classique', 1], ['astrolabe', 1]], label: 'Clinique', env: 'studio', envIntensity: 0.9, bg: '#d9d6d0', floor: '#cfccc6',
    key: { color: '#ffffff', intensity: 7 }, rim: { color: '#ffffff', intensity: 0.6 }, warmth: 0,
    // (blanc sur blanc : porcelaine, marbre, chrome ; une seule touche de couleur ou d'or)
    accords: [
      ['porcelaine', 'chrome', 'acierPoli', 'porcelaine', 'chrome', 'laiton'],
      ['marbreBlanc', 'porcelaine', 'chrome', 'acierBleui', 'acierBrosse', 'chrome'],
      ['porcelaine', 'acierBrosse', 'porcelaine', 'chrome', 'orRose', 'chrome'],
      ['marbreBlanc', 'chrome', 'acierNoirci', 'chrome', 'acierPoli', 'chrome'],
      ['porcelaine', 'marbreBlanc', 'acierBrosse', 'titane', 'chrome', 'acierPoli'],
    ],
    finish: ['lisse', 'perlage'], globes: [['verre', 3], ['griffes', 1]], tints: ['clair'], trace: [['verre', 2], ['aucune', 1]],
    body: '#ffd9a8', glass: '#0c0d0f',
  },
  // cabinet de curiosités : bois cirés, nacre, or ; lumière de bougie
  cabinet: {
    atmo: { dust: 1.2, beam: 0.8, haze: 0.45, embers: 0 },
    arch: [['classique', 2], ['astrolabe', 1], ['horlogerie', 1]], label: 'Cabinet de curiosités', env: 'atelier', envIntensity: 0.85, bg: '#170e08', floor: '#22150c',
    key: { color: '#ffe6c8', intensity: 10 }, rim: { color: '#cfd9f0', intensity: 0.7 }, warmth: 0.12,
    // (bois cirés et nacre ; l'or en filets, jamais en masse)
    accords: [
      ['noyer', 'ebene', 'laiton', 'nacre', ['acierPoli', 'argent'], 'or'],
      ['ebene', 'noyer', 'nacre', 'orRose', 'or', 'acierNoirci'],
      ['nacre', 'ebene', 'acierBleui', 'or', 'laitonBrosse', 'acierPoli'],
      ['bronzeVert', 'ebene', 'argent', 'cuivre', 'acierPoli', 'laiton'],
      ['marbreNoir', 'noyer', 'or', 'ebene', 'argent', 'or'],
      ['noyer', 'ebene', 'argent', 'emailRouge', 'acierPoli', 'laiton'],
    ],
    finish: ['lisse', 'guilloche'], globes: [['lanterne', 2], ['griffes', 2], ['armillaire', 1]], tints: ['ambre', 'vert', 'clair'], trace: [['or', 2], ['verre', 1]],
    body: '#ffb45e', glass: '#0a0705',
  },
  // forge : fonte, cuivre et métal en fusion
  forge: {
    atmo: { dust: 0.5, beam: 0.6, haze: 0.9, embers: 1 },
    arch: [['atelier', 4], ['classique', 1]], label: 'Forge', env: 'atelier', envIntensity: 0.8, bg: '#120c09', floor: '#1c140f',
    key: { color: '#ffe2c6', intensity: 9 }, rim: { color: '#ff8a4a', intensity: 0.8 }, warmth: 0.12,
    // (fonte et acier noirci ; le cuivre est le feu de la scène, sur une ou deux pièces)
    accords: [
      ['fonte', 'acierNoirci', 'cuivre', ['fonte', 'acierNoirci'], 'acierBrosse', 'acierNoirci'],
      ['ardoise', 'fonte', 'acierNoirci', 'bronze', 'cuivre', 'acierPoli'],
      ['cuivre', 'fonte', 'acierNoirci', 'acierBrosse', 'fonte', 'cuivre'],
      ['bronze', 'fonte', 'acierNoirci', 'cuivre', 'acierBrosse', 'acierNoirci'],
      ['bronzeVert', 'acierNoirci', 'fonte', 'cuivre', 'bronze', 'acierBrosse'],
    ],
    finish: ['lisse', 'perlage'], globes: [['lanterne', 2], ['cardan', 2]], tints: ['fume', 'ambre'], trace: [['gravure', 2], ['verre', 2]],
    body: '#ff8a3a', glass: '#0a0503',
  },
  // sacré : or, émaux, pénombre d'une nef
  sacre: {
    atmo: { dust: 0.9, beam: 1.3, haze: 0.75, embers: 0 },
    arch: [['astrolabe', 2], ['horlogerie', 1], ['classique', 1]], label: 'Sacré', env: 'atelier', envIntensity: 0.85, bg: '#140e07', floor: '#1e150b',
    key: { color: '#ffecd0', intensity: 10 }, rim: { color: '#9ab4ff', intensity: 0.7 }, warmth: 0.1,
    // (l'or sur un fond : émail profond, marbre noir, nacre ; l'argent lui répond)
    accords: [
      ['emailBleu', 'marbreNoir', 'or', 'argent', ['argent', 'maillechort'], 'or'],
      ['emailRouge', ['marbreNoir', 'ebene'], 'argent', 'or', 'or', 'acierNoirci'],
      ['marbreNoir', 'argent', 'orRose', 'nacre', 'argent', 'or'],
      ['or', 'marbreNoir', 'acierBleui', 'argent', 'argent', 'acierBleui'],
      ['nacre', 'marbreNoir', 'or', 'emailBleu', 'argent', 'or'],
      ['marbreBlanc', 'laqueNoire', 'or', 'emailRouge', 'maillechort', 'or'],
    ],
    finish: ['soleil', 'guilloche'], globes: [['griffes', 2], ['armillaire', 2], ['lanterne', 1]], tints: ['ambre', 'clair'], trace: [['or', 2], ['verre', 1]],
    body: '#ffe0a0', glass: '#080604',
  },
};

export const FINISHES = { lisse: 'Lisse', guilloche: 'Guilloché', soleil: 'Soleil (rayonnant)', perlage: 'Perlage' };
export const TRACE_KINDS = { verre: 'Verre filé', or: 'Fil d’or', gravure: 'Gravure rougeoyante', aucune: 'Aucune' };

// plans de caméra (voir scene/choreo.js)
export const SHOT_KINDS = { ensemble: 'Ensemble', rasant: 'Rasant', zenith: 'Zénith', astre: 'Astre', machine: 'Machine' };

// les matières d'une couche : un accord de son humeur, et ses variantes
// (tirage à part ; les six tirages d'avant sont consommés pour que les scènes
// déjà connues gardent leurs astres, leur caméra et leur rythme)
function drawMatters(rng, M) {
  for (let i = 0; i < 6; i++) rng.next();
  const r = rng.fork('accord'), acc = r.pick(M.accords);
  return Object.fromEntries(ACCORD_ROLES.map((role, i) => [role, Array.isArray(acc[i]) ? r.pick(acc[i]) : acc[i]]));
}

// Une couche : un monde complet (orbite demandée, humeur, matières, astres,
// trace, lumières, rythme, angle de vue)
export function generateLayer(rng, moodKey) {
  const M = MOODS[moodKey];
  return {
    mood: moodKey,
    // contraintes sur l'orbite (null : tirées de la graine)
    orbit: { N: null, sym: null, omega: null },
    stage: { archetype: rng.weighted(M.arch), finish: rng.pick(M.finish), finishScale: r2(rng.range(0.7, 1.4)) },
    matters: drawMatters(rng, M),
    bodies: { globe: rng.weighted(M.globes), tint: rng.pick(M.tints), irid: r2(rng.range(0, 0.6)), color: M.body, flare: r2(rng.range(1.2, 2.2)), light: r2(rng.range(0.1, 0.16)) },
    trace: { kind: rng.weighted(M.trace), show: true, cool: r2(rng.range(4.5, 7.5)), thick: r2(rng.range(0.8, 1.3)), glow: 1, glass: M.glass },
    motion: { slowmo: r2(rng.range(0.8, 1.15)), periodsPerLayer: r2(rng.range(0.8, 1.3)) },
    camera: { az: r2(rng.range(0, Math.PI * 2)), el: r2(rng.range(0.42, 0.72)), sweep: r2(rng.range(0.25, 0.6)) * rng.sign() },
    light: { env: M.env, envIntensity: M.envIntensity, bg: M.bg, floor: M.floor, warmth: M.warmth, key: { ...M.key }, rim: { ...M.rim } },
    // atmosphère (tirée en dernier : les tirages précédents ne changent pas)
    atmo: Object.fromEntries(Object.entries(M.atmo).map(([k, v]) => [k, r2(v * rng.range(0.8, 1.2))])),
  };
}

export const LAYERS = 3;
const COOL = ['observatoire', 'clinique'];

// La recette : trois mondes différents emboîtés (les astres du premier
// contiennent le deuxième, ceux du deuxième le troisième, ceux du troisième le
// premier : la plongée traverse les trois puis boucle), et le rythme de la
// plongée
export function generate(seed, { moods } = {}) {
  const rng = createRng(`recipe:${seed}`);
  // humeurs toutes différentes d'une couche à l'autre
  const pool = Object.keys(MOODS).filter((k) => !moods?.includes(k));
  const draw = (r) => pool.splice(Math.floor(r.next() * pool.length), 1)[0];
  const order = [moods?.[0] ?? draw(rng)];
  const motion = { segment: Math.round(rng.range(12, 16)), hold: r2(rng.range(0.4, 0.55)), free: false };
  // (les couches suivantes : tirage à part, la première reste celle de la graine)
  const next = rng.fork('suite');
  for (let m = 1; m < LAYERS; m++) order.push(moods?.[m] ?? draw(next));
  // chaque plongée doit changer d'air : quatre humeurs sur six sont chaudes et
  // sombres, il faut au moins un monde froid ou clair parmi les trois
  if (!moods && !order.some((k) => COOL.includes(k))) order[1 + Math.floor(next.next() * (LAYERS - 1))] = next.pick(COOL);
  return {
    v: 2, seed: String(seed),
    layers: order.map((k, m) => generateLayer(rng.fork(`layer${m}`), k)),
    motion,
  };
}

// recette d'une version antérieure : complétée par les valeurs par défaut
export function upgrade(R) {
  if (R.v !== 2) return generate(R.seed ?? 'x');
  const base = generate(R.seed ?? 'x', { moods: (R.layers || []).map((l) => (MOODS[l.mood] ? l.mood : undefined)) });
  const merge = (a, b) => {
    for (const [k, v] of Object.entries(b)) {
      if (a[k] === undefined) a[k] = v;
      else if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') merge(a[k], v);
    }
    return a;
  };
  merge(R, base);
  // (recette d'avant les trois mondes : les couches manquantes sont tirées de la graine)
  for (let m = R.layers.length; m < base.layers.length; m++) R.layers.push(base.layers[m]);
  return R;
}

// contraintes de la recette → paramètres imposés au solveur
export function orbitOverrides(L) {
  const o = {};
  if (L.orbit.N) o.N = L.orbit.N;
  if (L.orbit.sym !== null && L.orbit.sym !== undefined) o.sym = L.orbit.sym === 'none' ? null : L.orbit.sym;
  if (L.orbit.omega) o.omegaFrac = L.orbit.omega;
  return o;
}

// partage : recette compressée dans l'ancre (#r=…)
export async function packRecipe(R) {
  const s = new Blob([JSON.stringify(R)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackRecipe(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(s).text());
}
