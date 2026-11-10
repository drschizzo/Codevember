// Les familles de mousse : chacune accomplit la reviviscence par un geste
// propre (module pur : importé par la recette, les workers et les tests).
//
// Unités : le centimètre. Une feuille de mousse mesure 2 à 6 mm, une tige
// 0,5 à 4 cm ; le coussin quelques centimètres.
//
// Pose d'une feuille (voir pose.js) : la nervure part de la tige, d'abord
// engainante (angle a0 sur une part `sheath` de la longueur), puis une
// charnière courte la porte à l'angle d'insertion θ, puis le limbe se courbe
// (kl, 1/cm : positif = recourbé vers l'extérieur). La section est roulée
// (kt, 1/cm : marges relevées vers la face supérieure), et toute la feuille
// s'enroule autour de la tige d'un angle tw (radians, de la base à la pointe).
// Chaque grandeur passe de sa valeur « sec » à sa valeur « mouillé » avec
// l'ouverture f de la feuille.
//
// Les dernières feuilles (le bourgeon, au sommet) sont plus petites et
// restent plus serrées ; les plus basses (vieilles, brunes) bougent moins.

export const FAMILIES = {
  // Syntrichia ruralis : au sec, feuilles tordues en vis autour de la tige,
  // pointes hyalines argentées ; mouillée, chaque tige se dévisse et s'étale
  // en étoile recourbée.
  tortule: {
    label: 'Tortule', gesture: 'se dévisse : les feuilles tordues en vis autour de la tige se détordent et s\'étalent en étoile',
    shoot: { height: [0.75, 1.15], spacing: 0.2, leaves: [15, 20], div: 0.4, stemR: 0.012, leafy: 0.62, lean: 0.18, turf: 0.56, dome: 0.85 },
    leaf: { L: [0.17, 0.22], W: 0.03, base: 0.55, apex: 0.62, sheath: 0.16, hinge: 0.1, a0: 0.06, thick: 0.0032, hair: 0.42, hairR: 0.0028, teeth: 0.3, costa: 0.9, recurved: 1 },
    dry: { theta: 0.2, kl: -3.5, kt: 52, tw: 2.3 },
    wet: { theta: 0.95, kl: 8.5, kt: 9, tw: 0 },
    tau: { open: 5, close: 700 },
    spor: { kind: 'tortula', frac: 0.22, seta: [0.9, 1.35], cap: [0.22, 0.034], teeth: 32, lid: 0.35 },
    color: { dry: '#7d7046', wet: '#4f9a1a', young: '#a6d03a', old: '#4b3a22', hair: '#e9ece4', seta: '#7d2c17', capsule: '#5e3414', trans: '#c0f040' },
  },
  // Polytrichum : feuilles raides à lamelles, base engainante ; au sec,
  // plaquées vers le haut contre la tige ; mouillée, elles pivotent d'un
  // coup à la charnière et s'ouvrent en ombrelle.
  polytric: {
    label: 'Polytric', gesture: 's\'ouvre en ombrelle : les feuilles raides plaquées contre la tige pivotent à leur charnière',
    shoot: { height: [1.4, 2.1], spacing: 0.3, leaves: [17, 23], div: 0.375, stemR: 0.018, leafy: 0.72, lean: 0.12, turf: 0.6, dome: 1.05 },
    leaf: { L: [0.36, 0.48], W: 0.026, base: 1.25, apex: 0.25, sheath: 0.17, hinge: 0.06, a0: 0.04, thick: 0.0055, hair: 0, hairR: 0, teeth: 1, costa: 1.6, recurved: 0 },
    dry: { theta: 0.13, kl: -0.6, kt: 40, tw: 0.35 },
    wet: { theta: 1.3, kl: 1.4, kt: 14, tw: 0 },
    tau: { open: 3, close: 500 },
    spor: { kind: 'polytrichum', frac: 0.3, seta: [1.6, 2.4], cap: [0.32, 0.06], teeth: 64, lid: 0.25 },
    color: { dry: '#6a6436', wet: '#3c8420', young: '#7ab830', old: '#3b2c1c', hair: '#d6d2b8', seta: '#8a3a1a', capsule: '#9a6a2c', trans: '#78b83a', calyptra: '#d8b878' },
  },
  // Funaria hygrometrica : petites rosettes, longues soies ; quand l'humidité
  // change, la soie se tord et la capsule penchée tourne de plusieurs tours.
  funaire: {
    label: 'Funaire', gesture: 'ses capsules tournent : la soie se détord à l\'eau, se retord au sec',
    shoot: { height: [0.28, 0.45], spacing: 0.22, leaves: [11, 15], div: 0.4, stemR: 0.011, leafy: 0.8, lean: 0.2, turf: 0.42, dome: 0.32 },
    leaf: { L: [0.2, 0.28], W: 0.06, base: 0.35, apex: 0.55, sheath: 0.08, hinge: 0.12, a0: 0.1, thick: 0.003, hair: 0.08, hairR: 0.0016, teeth: 0.1, costa: 0.6, recurved: 0 },
    dry: { theta: 0.32, kl: -9, kt: 46, tw: 0.9 },
    wet: { theta: 0.85, kl: -2.5, kt: 16, tw: 0 },
    tau: { open: 4, close: 600 },
    spor: { kind: 'funaria', frac: 0.28, seta: [1.1, 1.7], cap: [0.24, 0.07], teeth: 16, lid: 0.0, turns: [1.5, 2.5] },
    color: { dry: '#857e44', wet: '#5aa024', young: '#b4d84a', old: '#5a4a28', hair: '#d8dcc8', seta: '#b25a22', capsule: '#6a3a16', trans: '#b8e04a' },
  },
  // Sphagnum : capitules de rameaux serrés ; au sec, les cellules hyalines se
  // vident d'eau et la sphaigne blanchit, ses rameaux se resserrent ; mouillée,
  // elle s'étale et prend sa couleur (vert ou grenat).
  sphaigne: {
    label: 'Sphaigne', gesture: 'blanchit et se resserre au sec, s\'étale et rougit mouillée ; ses capsules sautent',
    shoot: { height: [1.0, 1.5], spacing: 0.4, leaves: [40, 50], div: 0.382, stemR: 0.02, leafy: 0.3, lean: 0.1, capitulum: true, turf: 0.66, dome: 1.2 },
    leaf: { L: [0.26, 0.36], W: 0.022, base: 0.8, apex: 0.4, sheath: 0.04, hinge: 0.14, a0: 0.18, thick: 0.02, hair: 0, hairR: 0, teeth: 0, costa: 0, recurved: 0, branch: true },
    dry: { theta: 0.68, kl: -3, kt: 120, tw: 0.1 },
    wet: { theta: 0.98, kl: 2.5, kt: 120, tw: 0 },
    tau: { open: 8, close: 800 },
    spor: { kind: 'sphagnum', frac: 0.2, seta: [0.25, 0.4], cap: [0.075, 0.075], teeth: 0, lid: 1 },
    color: { dry: '#d9d6c4', wet: '#8a2a34', young: '#b84a50', old: '#7a6a4a', hair: '#e8e6dc', seta: '#ecebe2', capsule: '#2a1a12', trans: '#e05a5a' },
    palettes: [{ wet: '#8a2a34', young: '#b84a50', trans: '#e05a5a' }, { wet: '#5f8a2a', young: '#9cc04a', trans: '#b8e050' }, { wet: '#9a6a2a', young: '#c8963a', trans: '#e8b050' }],
  },
};

export const FAMILY_KEYS = Object.keys(FAMILIES);

// gabarit de largeur d'une feuille (demi-largeur, en fraction de W) le long de
// s ∈ [0, 1] : base engainante (base), maximum vers `apex`, pointe effilée.
// (même formule dans le shader : scene/moss.js, leafWidth)
export function widthAt(s, Lf) {
  const sm = Math.min(1, Math.max(0, s));
  const body = Math.sin(Math.PI * Math.pow(sm, Lf.apex > 0 ? Math.log(0.5) / Math.log(Lf.apex) : 1)) ** 0.75;
  const sheath = Lf.base * (1 - smooth(Lf.sheath * 0.6, Lf.sheath + 0.12, sm));
  return Math.max(body, sheath) * (1 - smooth(0.82, 1, sm) * 0.9);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
