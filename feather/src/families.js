// Catalogue : les familles (le geste) et les oiseaux (le plumage, le motif,
// la couleur). Module pur : recette, worker, tests.
//
// Une famille dit COMMENT la plume sort de sa gaine :
//   vexille — le tube s'ouvre en livre, puis les barbes s'agrafent ;
//   ocelle  — un long tuyau ; les fils libres du bas s'écartent en fontaine
//             et retombent, le disque de l'œil se déplie en haut ;
//   duvet   — sans rachis : la gaine éclate et les barbes s'épanouissent en
//             étoile tout autour, puis frisent en houppe ;
//   plume   — barbes très longues, sans crochets : elles ne s'agrafent jamais,
//             elles retombent sous leur poids en cascade et oscillent.
//
// Longueurs en cm. Angles en radians.

export const FAMILIES = {
  vexille: {
    label: 'Vexille', radial: false,
    L: [5.2, 6.8],            // longueur du rachis
    width: [0.3, 0.42],       // largeur totale du vexille / L
    asym: [0.0, 0.3],         // asymétrie (les rémiges et tectrices de l'aile)
    calamus: 0.11,            // part du rachis sans barbes (le tuyau)
    plum: [0.2, 0.3],         // part duveteuse à la base du vexille
    density: 21,              // barbes par cm de rachis et par côté
    alpha: [0.62, 0.8],       // angle des barbes au rachis (au milieu)
    curl: [0.12, 0.3],        // courbure des barbes (1/cm), vers la pointe
    tipPow: [3, 6],           // pointe : grand = arrondie
    bend: [0.03, 0.06],       // courbure du rachis (1/cm), en plus du dôme
    droop: 0, zip: 1, wave: 0.05,
    dome: 3.0,                // rayon du corps / L
    tile: { density: 10 },     // plumes voisines (gabarit grossier)
  },
  ocelle: {
    label: 'Ocelle', radial: false,
    L: [11.5, 13.5], width: [0.3, 0.34], asym: [0, 0.05], calamus: 0.06, plum: [0.06, 0.08],
    density: 9, alpha: [0.42, 0.55], curl: [0.02, 0.06], tipPow: [5, 7], bend: [0.012, 0.022],
    droop: 0.1, zip: 0, wave: 0.12,
    eyeStart: 0.72,           // au-dessus : le disque de l'œil, agrafé et dense
    dome: 2.8,
    tile: { density: 3.2 },
  },
  duvet: {
    label: 'Duvet', radial: true,
    L: [2.4, 3.0],            // longueur des barbes
    width: [1, 1], asym: [0, 0], calamus: 0.22, plum: [1, 1],
    count: [110, 140],        // barbes autour du calamus
    spread: [0.15, 2.6],      // ouverture des barbes (angle à l'axe)
    curl: [0.6, 1.1], tipPow: [1, 1], bend: [0, 0],
    droop: 0.04, zip: 0, wave: 0.045,
    dome: 2.6,
    tile: { count: 40 },
  },
  plume: {
    label: 'Plume', radial: false,
    L: [9.5, 11.5], width: [0.75, 0.9], asym: [0, 0.08], calamus: 0.08, plum: [0.08, 0.12],
    density: 11, alpha: [0.6, 0.75], curl: [0.03, 0.08], tipPow: [1.6, 2.4], bend: [0.03, 0.05],
    droop: 0.2, zip: 0, wave: 0.07,
    dome: 2.8,
    tile: { density: 3.6 },
  },
};

// Les oiseaux : couleurs (sRGB), motif (programme du collier, voir
// gen/pattern.js), couleur structurale. Toutes les plumes d'une scène sont du
// même oiseau (le plumage autour, la plume qui pousse).
//   base : fond du vexille ; mark : couleur du motif ; down : partie duveteuse ;
//   rachis : couleur du rachis ; sheath : gaine ; irid : [force, épaisseur nm
//   min, max] (irisation : film mince équivalent de la kératine à mélanine) ;
//   blue : bleu structural (geai, martin-pêcheur), mêlé à la base ;
//   eye : couleurs de l'ocelle, du centre vers le bord.
export const BIRDS = {
  pigeon: {
    label: 'Pigeon', family: 'vexille', base: '#8d929a', mark: '#2a2a30', down: '#c9c8c6', rachis: '#e3ded6', sheath: '#6f7c8c',
    pattern: { program: 'bars', cover: 0.3 }, irid: [0.35, 380, 520], blue: 0,
  },
  effraie: {
    label: 'Effraie', family: 'vexille', base: '#d5a66b', mark: '#6c645c', down: '#f1ede4', rachis: '#efe6d6', sheath: '#8b8f98',
    pattern: { program: 'spots', cover: 0.16 }, irid: [0, 0, 0], blue: 0,
  },
  geai: {
    label: 'Geai', family: 'vexille', base: '#2f78d0', mark: '#101216', down: '#dcdde0', rachis: '#30343a', sheath: '#4f6070',
    pattern: { program: 'bars', cover: 0.42, white: [0.12, 0.3] }, irid: [0, 0, 0], blue: 1,
  },
  faisan: {
    label: 'Faisan', family: 'vexille', base: '#b8682c', mark: '#141012', down: '#b8a796', rachis: '#d6b48c', sheath: '#6c6a72',
    pattern: { program: 'chevrons', cover: 0.36 }, irid: [0.7, 420, 620], blue: 0,
  },
  perdrix: {
    label: 'Perdrix', family: 'vexille', base: '#9a7a52', mark: '#2c2118', down: '#cdc3b4', rachis: '#e8dcc6', sheath: '#7b7f88',
    pattern: { program: 'chevrons', cover: 0.3 }, irid: [0, 0, 0], blue: 0,
  },
  corbeau: {
    label: 'Corbeau', family: 'vexille', base: '#17171b', mark: '#0d0d10', down: '#3a3a40', rachis: '#141416', sheath: '#3c4450',
    pattern: { program: 'plain' }, irid: [0.9, 330, 470], blue: 0,
  },
  martin: {
    label: 'Martin-pêcheur', family: 'vexille', base: '#17a2c4', mark: '#0d3c63', down: '#5a5f66', rachis: '#2b3a46', sheath: '#4c5a66',
    pattern: { program: 'shaft', cover: 0.18 }, irid: [0.25, 300, 420], blue: 1,
  },
  paon: {
    label: 'Paon', family: 'ocelle', base: '#4f7a2a', mark: '#2f2a14', down: '#6f6a50', rachis: '#cfc39a', sheath: '#5d6a5a',
    pattern: { program: 'plain', eye: [0.86, 0.95, 0.12] }, irid: [0.95, 300, 560], blue: 0,
    eye: ['#0d0f3a', '#153f8f', '#1fa59a', '#9c7a32', '#3f6d22'],
  },
  eider: {
    label: 'Eider', family: 'duvet', base: '#9b8f80', mark: '#6a6056', down: '#bdb3a6', rachis: '#cfc5b8', sheath: '#7f8790',
    pattern: { program: 'plain' }, irid: [0, 0, 0], blue: 0, tilePattern: { program: 'bars', cover: 0.3 }, tileBase: '#7b6650', tileMark: '#2e241c',
  },
  cygne: {
    label: 'Cygne', family: 'duvet', base: '#e9e6e0', mark: '#cfcac2', down: '#f4f2ee', rachis: '#e6e2da', sheath: '#9aa3ad',
    pattern: { program: 'plain' }, irid: [0, 0, 0], blue: 0, tilePattern: { program: 'plain' }, tileBase: '#8d8a86', tileMark: '#6d6a66',
  },
  autruche: {
    label: 'Autruche', family: 'plume', base: '#1a1919', mark: '#121111', down: '#2c2a29', rachis: '#e8e3da', sheath: '#565e68',
    pattern: { program: 'plain', white: [0.1, 0.25] }, irid: [0.2, 300, 380], blue: 0,
  },
  aigrette: {
    label: 'Aigrette', family: 'plume', base: '#f1eee7', mark: '#e3ded4', down: '#f6f4f0', rachis: '#f3efe6', sheath: '#a3acb6',
    pattern: { program: 'plain' }, irid: [0, 0, 0], blue: 0,
  },
};

export const birdsOf = (family) => Object.keys(BIRDS).filter((k) => BIRDS[k].family === family);
