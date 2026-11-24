// Recette d'une scène : tout ce qui découle de la graine. Une recette est un
// objet JSON (partageable par lien, « Copier le lien ») ; le panneau la modifie
// en place. Le rendu ne lit QUE la recette et la phase : même recette, même
// phase → même image.
//
// Règles (voir la skill codevember-scene, references/art-direction.md) :
// - chaque tirage a son propre flux (rng.fork('…')) : ajouter un tirage ne
//   change pas les autres, une graine reste reconnaissable d'une version à
//   l'autre ;
// - les matières ne sont jamais tirées pièce par pièce : chaque humeur a des
//   accords composés à la main ;
// - les lampes sont presque blanches, la chaleur vient des matières, du fond,
//   des contre-jours et de l'étalonnage ;
// - tout mouvement fait un nombre ENTIER de tours (ou de périodes) par boucle.
import { createRng } from '../../shared/rng.js';
import { sunAt } from './gen/shadowart.js';
import { FINISHES, SETS, TINTS } from '../../shared/finishes.js';

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

// ── Humeurs ──────────────────────────────────────────────────────────────────
// Une humeur = un décor (le sol où tombe l'ombre, src/scene/ground.js), un ciel
// (studio HDR polaire, intensité, brume de l'horizon), un dosage du soleil et
// un étalonnage. La lumière reste celle du soleil de minuit : la variété passe
// par le sol, la valeur et la matière, pas par des lampes colorées.
// frost : givre sur le fer (là où il fait assez froid pour qu'il tienne).
// dec : la date (déclinaison du soleil, en degrés) : elle fixe la hauteur du
// soleil aux deux heures (≈ 6° à 14°), donc la longueur des ombres et la
// chaleur de la lumière ; plunge : plongée des tenues ; near : plongée de la
// ronde ; haze : brume (début, fin, en mètres).
// Regard d'auteur : André Kertész (Kertész, l'ouverture : la neige seule, l'ombre seul noir).
// Couleurs des peintures industrielles (accord « peint ») : minium, jaune de
// signalisation, bleu marine, vert wagon, blanc cassé, orange de sécurité.
export const PAINTS = ['#8e2a1c', '#c99a1a', '#1f3c6b', '#2f5a3a', '#d8d4ca', '#c4561e'];

export const MOODS = {
  kertesz: {
    accords: { rouille: 3, peint: 2, galva: 1, cuivre: 1, bois: 1 },
    dec: [19, 22], plunge: [72, 80], near: [40, 46], haze: [30, 80],
    label: 'Kertész (neige)', ground: 'snow', sun: 11.5, env: 0.4, fog: '#d6e2f2', frost: 0.5, rust: [0.3, 0.55],
    grade: { contrast: 1.02, saturation: 0.95, shadows: [0.97, 1.0, 1.05], highlights: [1, 1, 1] },
  },
  moraine: {
    accords: { rouille: 2, galva: 2, bois: 1, cuivre: 1, peint: 1 },
    dec: [14, 17], plunge: [54, 62], near: [34, 40], haze: [20, 60],
    label: 'Moraine (roche polie)', ground: 'rock', sun: 12, env: 0.3, fog: '#c9d3de', frost: 0.15, rust: [0.35, 0.6],
    grade: { exposure: 1.15, contrast: 1.06, saturation: 0.92, shadows: [0.97, 1.0, 1.04], highlights: [1.02, 1.0, 0.98] },
  },
  maree: {
    accords: { bois: 4, rouille: 2, peint: 1 },
    dec: [20, 23], plunge: [48, 55], near: [30, 36], haze: [9, 38],
    label: 'Marée (sable humide)', ground: 'sand', sun: 12.5, env: 0.5, fog: '#cdd5db', frost: 0, rust: [0.55, 0.85],
    grade: { contrast: 1.03, saturation: 0.98, shadows: [0.98, 1.0, 1.03], highlights: [1.02, 1.0, 0.97] },
  },
  quai: {
    accords: { peint: 3, galva: 2, rouille: 2, cuivre: 1 },
    dec: [21, 23.4], plunge: [76, 82], near: [44, 50], haze: [30, 90],
    label: 'Quai (béton)', ground: 'concrete', sun: 11, env: 0.5, fog: '#d3d8dc', frost: 0.1, rust: [0.4, 0.7],
    grade: { contrast: 1.08, saturation: 0.85, shadows: [1.0, 1.0, 1.02], highlights: [1, 1, 1] },
  },
  ponton: {
    accords: { bois: 2, peint: 2, cuivre: 1, rouille: 1 },
    dec: [15, 18], plunge: [60, 67], near: [36, 42], haze: [18, 55],
    label: 'Ponton (planches)', ground: 'planks', sun: 12, env: 0.42, fog: '#d0d4d8', frost: 0.2, rust: [0.4, 0.7],
    grade: { contrast: 1.04, saturation: 0.9, shadows: [0.98, 1.0, 1.03], highlights: [1.03, 1.0, 0.96] },
  },
  basalte: {
    accords: { cuivre: 3, galva: 2, rouille: 1, bois: 1 },
    dec: [15.5, 17.5], plunge: [52, 58], near: [32, 38], haze: [14, 50],
    label: 'Basalte (lave noire)', ground: 'basalt', sun: 13, env: 0.2, fog: '#b9c3cf', frost: 0, rust: [0.5, 0.8],
    // (sol noir : on expose pour la lave éclairée, le ciel s'éclaircit)
    grade: { exposure: 1.9, contrast: 1.1, saturation: 0.95, shadows: [0.97, 1.0, 1.05], highlights: [1.03, 1.0, 0.97] },
  },
};

// Finitions complètes d'un jeu de matériaux (face externe, interne, tranche),
// teinte d'accent éventuelle (une seule par scène)
export function finishOf(setKey, tint = null) {
  const S = SETS[setKey];
  const fin = (k) => {
    const F = { ...FINISHES[k], preset: k };
    if (tint && ['anodized', 'anodizedMatte', 'lacquer', 'lacquerMatte', 'glaze'].includes(k)) F.color = tint;
    return F;
  };
  return { set: setKey, outer: fin(S.outer), inner: fin(S.inner), edge: fin(S.edge), wear: S.wear ?? 0 };
}

export function generate(seed, overrides = {}) {
  const rng = createRng(seed);
  const mood = overrides.mood ?? rng.fork('mood').pick(Object.keys(MOODS));
  const M = MOODS[mood];
  const rc = rng.fork('camera'), rl = rng.fork('light'), rm = rng.fork('motion');

  // ── L'objet et ses deux figures (docs/concept.md, révisions 1 et 2) ──
  // Deux heures symétriques autour de minuit (soleil bas, ~11°), dont les
  // ombres font un angle droit. Chaque figure est debout pour SA vue : la
  // caméra, dos au soleil, regarde dans l'axe de l'ombre à cette heure-là.
  const ro = rng.fork('object');
  const pair = ro.pick([['lievre', 'renard'], ['renard', 'macareux'], ['macareux', 'lievre'], ['renard', 'lievre'], ['lievre', 'macareux'], ['macareux', 'renard']]);
  const side = ro.sign();
  const dH = 0.8; // ±46° d'angle horaire ≈ ±45° d'azimut à cette latitude
  const sun = { lat: 78, dec: r2(ro.range(...M.dec)) };
  const figs = pair.map((name, k) => ({ name, H: r2(Math.PI + (k ? 1 : -1) * dH), camAz: 0 }));
  refreshFigures({ sun, object: { figs } });
  void side;
  // l'accord de matières de l'objet, pondéré par l'humeur (le bois flotté sur la grève…)
  const rm2 = rng.fork('matiere');
  const accord = rm2.weighted(Object.entries(M.accords));
  const paint = rm2.pick(PAINTS);

  return {
    v: 1, seed, mood,
    loop: { duration: 48, u1: 0.36, a0: 0.07, a1: 0.28, fly: 0.05 },
    sun,
    object: { family: 'fer', accord, paint, height: 0.8, figs, rust: r2(ro.range(...M.rust)), frost: M.frost },
    // caméra : au nord de l'objet, elle regarde vers le sud (az 180°) en plongée
    // caméra : tenue en plongée sur chaque figure, ronde rapprochée entre les deux
    camera: { fov: r2(rc.range(30, 34)), plunge: r2(rc.range(...M.plunge)), hold: 0.05, drift: 3, nearPlunge: r2(rc.range(...M.near)), nearDist: r2(rc.range(7, 8.5)) },
    motion: { spin: 1, orbit: 1, bob: 2, bobAmp: 0 },
    light: { sun: M.sun, sky: 0.0 },
    env: { preset: 'polar', intensity: M.env, rotation: 0 },
    fog: { color: M.fog, near: M.haze[0], far: M.haze[1] },
    floor: { ground: M.ground },
    grade: { ...M.grade },
    pieces: [],
  };
}

// La vue d'où chaque figure se lit : dans l'axe de son ombre (l'ombre part à
// l'opposé du soleil). À refaire quand la latitude ou la date changent.
export function refreshFigures(R) {
  for (const f of R.object.figs) {
    const az = sunAt(R.sun.lat, R.sun.dec, f.H).az * 180 / Math.PI;
    f.camAz = r2((az + 540) % 360);
  }
}

// Recette ancienne (lien partagé) → recette courante : compléter les champs
// ajoutés depuis, sans rien tirer de nouveau.
export function upgrade(R) {
  const D = generate(R.seed, { mood: R.mood });
  for (const k of Object.keys(D)) if (R[k] === undefined) R[k] = D[k];
  return R;
}
