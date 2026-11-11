// Catalogue des finitions (une surface) et des jeux de matériaux (une
// coquille : face externe, face interne, tranche).
//
// Les métaux portent leur F0 mesuré (converti en sRGB) : c'est la rugosité,
// la micro-texture et l'environnement qui les différencient, pas une couleur
// assombrie. Les diélectriques ont un albédo plausible (pas de noir pur, pas
// de blanc pur).
//
// Motifs (calculés dans le shader, en coordonnées de la coquille) :
//   plain, brushed (brossé circulaire, anisotrope), hammered (martelé),
//   glaze (émail : peau d'orange + craquelure), weave (sergé de carbone),
//   rock (basalte), glitter (druse scintillante), nacre, oxide (titane
//   coloré au feu), velvet (velours), agate (bandes), patina (vert-de-gris),
//   guilloche (grain d'orge sous émail), damascus (acier damassé), marble
//   (marbre veiné), urushi (laque saupoudrée d'or), soap (film de savon)

export const PATTERNS = ['wood', 'plain', 'brushed', 'hammered', 'glaze', 'weave', 'rock', 'glitter', 'nacre', 'oxide', 'velvet', 'agate', 'patina',
  'guilloche', 'damascus', 'marble', 'urushi', 'soap'];

export const FINISH_DEFAULTS = {
  pattern: 'plain', color: '#888888', color2: '#444444', metal: 0, rough: 0.5,
  clearcoat: 0, ccRough: 0.05, sheen: 0, sheenColor: '#ffffff', sheenRough: 0.5,
  irid: 0, iridIOR: 1.8, iridMin: 250, iridMax: 650, aniso: 0, bump: 0, scale: 1, smudge: 0,
  glass: 0, ior: 1.5, dispersion: 0, attDist: 0.6,
  emit: 0, emitColor: '#36e0ff', // (phosphorescence : une lueur qui pulse depuis le cœur)
};

// F0 des métaux (sRGB)
export const METAL = {
  gold: '#ffe29d', brass: '#e8cf8e', copper: '#fad0c0', silver: '#fcfaf5', aluminium: '#f2f3f3',
  titanium: '#c2bbb3', chrome: '#c4c5c5', steel: '#c6c7c9', nickel: '#d4cdc0', bronze: '#d9b48c',
};

const F = (o) => ({ ...FINISH_DEFAULTS, ...o });

export const FINISHES = {
  // métaux
  brushedBrass: F({ label: 'Laiton brossé', pattern: 'brushed', color: METAL.brass, metal: 1, rough: 0.3, aniso: 0.75, bump: 0.25, scale: 1, smudge: 0.25 }),
  polishedBrass: F({ label: 'Laiton poli', pattern: 'plain', color: METAL.brass, metal: 1, rough: 0.1, smudge: 0.35 }),
  hammeredGold: F({ label: 'Or martelé', pattern: 'hammered', color: METAL.gold, metal: 1, rough: 0.2, bump: 0.6, scale: 1 }),
  polishedGold: F({ label: 'Or poli', pattern: 'plain', color: METAL.gold, metal: 1, rough: 0.07, smudge: 0.3 }),
  brushedSteel: F({ label: 'Acier brossé', pattern: 'brushed', color: METAL.steel, metal: 1, rough: 0.28, aniso: 0.85, bump: 0.25 }),
  chrome: F({ label: 'Chrome', pattern: 'plain', color: METAL.chrome, metal: 1, rough: 0.04, smudge: 0.5 }),
  diamondCut: F({ label: 'Aluminium diamanté', pattern: 'brushed', color: METAL.aluminium, metal: 1, rough: 0.09, aniso: 0.5, bump: 0.08, scale: 2 }),
  anodized: F({ label: 'Aluminium anodisé', pattern: 'brushed', color: '#3a64b0', metal: 1, rough: 0.34, aniso: 0.35, bump: 0.12, scale: 0.6 }),
  anodizedMatte: F({ label: 'Anodisé mat', pattern: 'plain', color: '#3a64b0', metal: 1, rough: 0.55 }),
  oxideTitanium: F({ label: 'Titane bleui au feu', pattern: 'oxide', color: METAL.titanium, metal: 1, rough: 0.22, irid: 1, iridIOR: 2.2, iridMin: 180, iridMax: 720, scale: 1 }),
  rawTitanium: F({ label: 'Titane brut', pattern: 'brushed', color: METAL.titanium, metal: 1, rough: 0.38, aniso: 0.6, bump: 0.2 }),
  polishedCopper: F({ label: 'Cuivre poli', pattern: 'plain', color: METAL.copper, metal: 1, rough: 0.12, smudge: 0.3 }),
  verdigris: F({ label: 'Vert-de-gris', pattern: 'patina', color: '#5c9c88', color2: '#2f5e55', metal: 0, rough: 0.78, bump: 0.35, scale: 1 }),
  bronzeDark: F({ label: 'Bronze patiné', pattern: 'hammered', color: '#8f6a45', metal: 1, rough: 0.42, bump: 0.35, scale: 1.6 }),
  blackenedSteel: F({ label: 'Acier noirci', pattern: 'brushed', color: '#3b3d42', metal: 1, rough: 0.33, aniso: 0.6, bump: 0.2, irid: 0.35, iridIOR: 1.6, iridMin: 300, iridMax: 450 }),
  // diélectriques
  glaze: F({ label: 'Émail craquelé', pattern: 'glaze', color: '#8fb8a6', color2: '#3d4a44', rough: 0.4, clearcoat: 1, ccRough: 0.03, bump: 0.15, scale: 1 }),
  porcelain: F({ label: 'Porcelaine', pattern: 'glaze', color: '#f1ede4', color2: '#c9bfae', rough: 0.35, clearcoat: 1, ccRough: 0.02, bump: 0.05, scale: 0.6 }),
  bisque: F({ label: 'Biscuit mat', pattern: 'rock', color: '#e2d8c8', color2: '#cfc2ae', rough: 0.92, bump: 0.06, scale: 3 }),
  velvet: F({ label: 'Velours', pattern: 'velvet', color: '#3a0714', color2: '#22040b', rough: 0.95, sheen: 1, sheenColor: '#ff5a72', sheenRough: 0.35 }),
  velvetNight: F({ label: 'Velours nuit', pattern: 'velvet', color: '#0a1230', color2: '#050a1c', rough: 0.95, sheen: 1, sheenColor: '#6f8cff', sheenRough: 0.35 }),
  carbon: F({ label: 'Carbone sergé', pattern: 'weave', color: '#121214', color2: '#08080a', rough: 0.32, clearcoat: 1, ccRough: 0.02, aniso: 0.7, bump: 0.2, scale: 1 }),
  carbonMatte: F({ label: 'Carbone mat', pattern: 'weave', color: '#141416', color2: '#0b0b0d', rough: 0.55, aniso: 0.6, bump: 0.25, scale: 1 }),
  nacre: F({ label: 'Nacre', pattern: 'nacre', color: '#efe6dc', color2: '#d6cfe6', rough: 0.28, clearcoat: 0.7, ccRough: 0.08, sheen: 0.4, sheenColor: '#f3d9ff', irid: 1, iridIOR: 1.55, iridMin: 280, iridMax: 640, bump: 0.12, scale: 1 }),
  obsidian: F({ label: 'Obsidienne polie', pattern: 'plain', color: '#0c0b0d', rough: 0.06, clearcoat: 1, ccRough: 0.01, smudge: 0.5 }),
  basalt: F({ label: 'Basalte', pattern: 'rock', color: '#4a443d', color2: '#7a6e60', rough: 0.86, bump: 2.2, scale: 1 }),
  druse: F({ label: 'Druse', pattern: 'glitter', color: '#4a1f6e', color2: '#d9b8ff', rough: 0.3, bump: 0.6, scale: 1 }),
  agate: F({ label: 'Agate', pattern: 'agate', color: '#e2d7cc', color2: '#5d4b70', rough: 0.12, clearcoat: 0.6, ccRough: 0.03, scale: 1 }),
  smokedGlass: F({ label: 'Verre fumé', pattern: 'plain', color: '#ffffff', color2: '#b7a796', rough: 0.02, glass: 1, ior: 1.5, dispersion: 0.25, attDist: 0.9, smudge: 0.2 }),
  frostedGlass: F({ label: 'Verre dépoli', pattern: 'plain', color: '#ffffff', color2: '#9aa6b0', rough: 0.42, glass: 1, ior: 1.5, attDist: 0.6 }),
  // métiers d'art
  guillocheEnamel: F({ label: 'Émail grand feu guilloché', pattern: 'guilloche', color: '#1d3f96', rough: 0.3, clearcoat: 1, ccRough: 0.015, bump: 0.7, scale: 1 }),
  guillocheRuby: F({ label: 'Émail rubis guilloché', pattern: 'guilloche', color: '#8e1020', rough: 0.3, clearcoat: 1, ccRough: 0.015, bump: 0.7, scale: 1.3 }),
  guillocheSilver: F({ label: 'Argent guilloché', pattern: 'guilloche', color: METAL.silver, metal: 1, rough: 0.16, bump: 0.55, scale: 0.8 }),
  damascus: F({ label: 'Acier damassé', pattern: 'damascus', color: '#c9cbd0', color2: '#4d5056', metal: 1, rough: 0.28, bump: 0.3, scale: 1 }),
  marble: F({ label: 'Marbre de Carrare', pattern: 'marble', color: '#eeeae4', color2: '#7a7670', rough: 0.14, clearcoat: 0.8, ccRough: 0.02, scale: 1 }),
  marbleNoir: F({ label: 'Marbre Nero Marquina', pattern: 'marble', color: '#121214', color2: '#d8cfc0', rough: 0.12, clearcoat: 0.9, ccRough: 0.015, scale: 1.2 }),
  urushi: F({ label: 'Laque urushi et or', pattern: 'urushi', color: '#090807', color2: METAL.gold, rough: 0.32, clearcoat: 1, ccRough: 0.012, bump: 1, scale: 1 }),
  urushiRed: F({ label: 'Laque vermillon', pattern: 'urushi', color: '#6a0c0a', color2: METAL.gold, rough: 0.34, clearcoat: 1, ccRough: 0.015, bump: 1, scale: 0.7 }),
  blackCeramic: F({ label: 'Céramique noire', pattern: 'plain', color: '#0d0d0f', rough: 0.1, clearcoat: 1, ccRough: 0.01, smudge: 0.25 }),
  whiteCeramic: F({ label: 'Céramique blanche', pattern: 'plain', color: '#f1f0ec', rough: 0.2, clearcoat: 1, ccRough: 0.015 }),
  soapFilm: F({ label: 'Film de savon', pattern: 'soap', color: '#09090b', rough: 0.04, clearcoat: 0.6, ccRough: 0.01, irid: 1, iridIOR: 1.33, iridMin: 120, iridMax: 900, scale: 1 }),
  // Labyrinth : bois, pierres, laques, textiles du thème
  walnut: F({ label: 'Noyer verni', pattern: 'wood', color: '#6a4630', color2: '#2e1b10', rough: 0.42, clearcoat: 0.85, ccRough: 0.06, bump: 0.6, scale: 1 }),
  walnutEnd: F({ label: 'Noyer (chant)', pattern: 'wood', color: '#56382a', color2: '#26160d', rough: 0.5, clearcoat: 0.6, ccRough: 0.08, bump: 0.5, scale: 1.4 }),
  oak: F({ label: 'Chêne huilé', pattern: 'wood', color: '#b08a5e', color2: '#6e5034', rough: 0.55, bump: 0.8, scale: 0.8 }),
  oakTable: F({ label: 'Plateau de chêne', pattern: 'wood', color: '#a98559', color2: '#735536', rough: 0.58, bump: 0.7, scale: 2.4 }),
  ash: F({ label: 'Frêne blond', pattern: 'wood', color: '#d8c3a0', color2: '#a68a64', rough: 0.5, clearcoat: 0.3, ccRough: 0.12, bump: 0.6, scale: 0.9 }),
  ebony: F({ label: 'Ébène', pattern: 'wood', color: '#2a211c', color2: '#0e0a08', rough: 0.3, clearcoat: 0.9, ccRough: 0.04, bump: 0.3, scale: 1.6 }),
  feltGreen: F({ label: 'Feutre vert', pattern: 'velvet', color: '#1d3a26', color2: '#12261a', rough: 0.95, sheen: 0.8, sheenColor: '#5d8a6a', sheenRough: 0.5, scale: 0.5 }),
  feltBlack: F({ label: 'Feutre noir', pattern: 'velvet', color: '#151413', color2: '#0b0a0a', rough: 0.95, sheen: 0.6, sheenColor: '#6a6460', sheenRough: 0.5, scale: 0.5 }),
  leather: F({ label: 'Cuir', pattern: 'hammered', color: '#3a2216', rough: 0.55, clearcoat: 0.25, ccRough: 0.2, bump: 0.25, scale: 6 }),
  linen: F({ label: 'Lin', pattern: 'velvet', color: '#cfc4b0', color2: '#b6aa94', rough: 0.9, sheen: 0.3, sheenColor: '#fff4e0', sheenRough: 0.6, scale: 1.4 }),
  concrete: F({ label: 'Béton banché', pattern: 'rock', color: '#8d8a85', color2: '#a6a29b', rough: 0.88, bump: 0.35, scale: 4 }),
  slate: F({ label: 'Ardoise', pattern: 'marble', color: '#41474b', color2: '#2f3437', rough: 0.62, clearcoat: 0, scale: 2.2 }),
  slateHoned: F({ label: 'Ardoise adoucie', pattern: 'marble', color: '#383d41', color2: '#2a2e31', rough: 0.4, clearcoat: 0.2, ccRough: 0.15, scale: 2.6 }),
  lacquerBlack: F({ label: 'Laque noire', pattern: 'plain', color: '#0b0a0a', rough: 0.25, clearcoat: 1, ccRough: 0.02, smudge: 0.3 }),
  lacquerRed: F({ label: 'Laque vermillon', pattern: 'plain', color: '#8a1a10', rough: 0.3, clearcoat: 1, ccRough: 0.025 }),
  celadon: F({ label: 'Céladon craquelé', pattern: 'glaze', color: '#a9c2ae', color2: '#57685c', rough: 0.35, clearcoat: 1, ccRough: 0.03, bump: 0.12, scale: 1.4 }),
  bone: F({ label: 'Os', pattern: 'rock', color: '#e6dccb', color2: '#d6c9b2', rough: 0.45, clearcoat: 0.3, ccRough: 0.1, bump: 0.05, scale: 6 }),
  plaster: F({ label: 'Plâtre', pattern: 'rock', color: '#e9e6e0', color2: '#dedad2', rough: 0.95, bump: 0.08, scale: 3 }),
  steelBall: F({ label: 'Acier poli', pattern: 'plain', color: METAL.steel, metal: 1, rough: 0.035 }),
  nickel: F({ label: 'Nickel', pattern: 'brushed', color: METAL.nickel, metal: 1, rough: 0.22, aniso: 0.5, bump: 0.15, smudge: 0.2 }),
  rawSteel: F({ label: 'Acier brut', pattern: 'brushed', color: '#9fa1a3', metal: 1, rough: 0.45, aniso: 0.4, bump: 0.3 }),
  // cristaux massifs (objets exposés) : ils réfractent l'intérieur de la cellule
  crystal: F({ label: 'Cristal', pattern: 'plain', color: '#ffffff', color2: '#f4f7fb', rough: 0.008, glass: 1, ior: 1.62, dispersion: 0.9, attDist: 4 }),
  crystalBlue: F({ label: 'Cristal saphir', pattern: 'plain', color: '#ffffff', color2: '#3d6fd8', rough: 0.01, glass: 1, ior: 1.7, dispersion: 0.6, attDist: 0.5 }),
  crystalSmoke: F({ label: 'Quartz fumé', pattern: 'plain', color: '#ffffff', color2: '#7a6250', rough: 0.01, glass: 1, ior: 1.55, dispersion: 0.5, attDist: 0.45 }),
  crystalFrost: F({ label: 'Cristal satiné', pattern: 'plain', color: '#ffffff', color2: '#dfe7ee', rough: 0.2, glass: 1, ior: 1.55, dispersion: 0.3, attDist: 2 }),
  amberGlass: F({ label: 'Verre ambré', pattern: 'plain', color: '#ffffff', color2: '#d17a1e', rough: 0.03, glass: 1, ior: 1.52, dispersion: 0.3, attDist: 0.25 }),
};

// Jeux de matériaux : [externe, interne, tranche], usure (la face externe
// s'use jusqu'à la tranche près des bords), chanfrein plat ou biseau rond,
// humeurs auxquelles le jeu appartient ; groove: false (pas de gravure),
// only (jeu réservé à un type, jamais tiré au hasard).
export const SETS = {
  brassVelvet: { label: 'Laiton & velours', outer: 'brushedBrass', inner: 'velvet', edge: 'polishedBrass', wear: 0, chamfer: false, moods: ['sacré', 'atelier', 'luxe'] },
  anodizedDiamond: { label: 'Anodisé diamanté', outer: 'anodized', inner: 'anodizedMatte', edge: 'diamondCut', wear: 0.08, chamfer: true, moods: ['studio', 'nuit'] },
  celadon: { label: 'Céladon craquelé', outer: 'glaze', inner: 'bisque', edge: 'bisque', wear: 0, chamfer: false, moods: ['clinique', 'atelier', 'pastel'] },
  kintsugi: { label: 'Porcelaine & or', outer: 'porcelain', inner: 'hammeredGold', edge: 'polishedGold', wear: 0, chamfer: false, moods: ['clinique', 'sacré', 'luxe', 'pastel'] },
  titanium: { label: 'Titane au feu', outer: 'oxideTitanium', inner: 'rawTitanium', edge: 'diamondCut', wear: 0.1, chamfer: true, moods: ['abysses', 'studio', 'irisé'] },
  goldLeaf: { label: 'Or martelé', outer: 'hammeredGold', inner: 'polishedGold', edge: 'polishedGold', wear: 0, chamfer: false, moods: ['sacré', 'luxe', 'atelier'] },
  carbon: { label: 'Carbone', outer: 'carbon', inner: 'carbonMatte', edge: 'brushedSteel', wear: 0.05, chamfer: true, moods: ['abysses', 'studio', 'nuit'] },
  smoked: { label: 'Verre fumé', groove: false, outer: 'smokedGlass', inner: 'smokedGlass', edge: 'frostedGlass', wear: 0, chamfer: false, moods: ['abysses', 'studio', 'nuit', 'pastel'] },
  amber: { label: 'Verre ambré', groove: false, outer: 'amberGlass', inner: 'amberGlass', edge: 'frostedGlass', wear: 0, chamfer: false, moods: ['sacré', 'atelier', 'luxe'] },
  nacre: { label: 'Nacre', outer: 'nacre', inner: 'nacre', edge: 'nacre', wear: 0, chamfer: false, moods: ['clinique', 'irisé', 'pastel'] },
  geode: { label: 'Géode', only: true, groove: false, outer: 'basalt', inner: 'druse', edge: 'agate', wear: 0, chamfer: false, moods: ['atelier', 'luxe', 'nuit', 'irisé'] },
  verdigris: { label: 'Cuivre vert-de-gris', outer: 'verdigris', inner: 'polishedCopper', edge: 'polishedCopper', wear: 0.45, chamfer: false, moods: ['atelier'] },
  obsidian: { label: 'Obsidienne', outer: 'obsidian', inner: 'basalt', edge: 'obsidian', wear: 0, chamfer: true, moods: ['abysses', 'nuit', 'luxe'] },
  chrome: { label: 'Chrome', outer: 'chrome', inner: 'brushedSteel', edge: 'chrome', wear: 0, chamfer: false, moods: ['clinique', 'abysses', 'studio'] },
  blackSteel: { label: 'Acier noirci', outer: 'blackenedSteel', inner: 'velvetNight', edge: 'brushedSteel', wear: 0.12, chamfer: true, moods: ['abysses', 'nuit', 'luxe'] },
  guilloche: { label: 'Émail guilloché', outer: 'guillocheEnamel', inner: 'polishedGold', edge: 'polishedGold', wear: 0, chamfer: false, moods: ['luxe', 'atelier', 'sacré'] },
  guillocheRuby: { label: 'Émail rubis', outer: 'guillocheRuby', inner: 'hammeredGold', edge: 'polishedGold', wear: 0, chamfer: false, moods: ['luxe', 'sacré'] },
  guillocheSilver: { label: 'Argent guilloché', outer: 'guillocheSilver', inner: 'blackCeramic', edge: 'chrome', wear: 0, chamfer: true, moods: ['studio', 'luxe', 'clinique'] },
  damascus: { label: 'Damas', outer: 'damascus', inner: 'blackenedSteel', edge: 'brushedSteel', wear: 0.1, chamfer: true, moods: ['nuit', 'atelier', 'abysses'] },
  marble: { label: 'Marbre & laiton', outer: 'marble', inner: 'polishedBrass', edge: 'polishedBrass', wear: 0, chamfer: true, moods: ['pastel', 'clinique', 'atelier'] },
  nero: { label: 'Nero Marquina & or', outer: 'marbleNoir', inner: 'polishedGold', edge: 'polishedGold', wear: 0, chamfer: true, moods: ['luxe', 'nuit'] },
  urushi: { label: 'Urushi', outer: 'urushi', inner: 'urushiRed', edge: 'polishedGold', wear: 0, chamfer: false, moods: ['luxe', 'atelier', 'sacré'] },
  crystal: { label: 'Cristal', only: true, groove: false, outer: 'crystal', inner: 'crystal', edge: 'crystalFrost', wear: 0, chamfer: false, moods: [] },
  crystalBlue: { label: 'Cristal saphir', only: true, groove: false, outer: 'crystalBlue', inner: 'crystalBlue', edge: 'crystal', wear: 0, chamfer: false, moods: [] },
  crystalSmoke: { label: 'Quartz fumé', only: true, groove: false, outer: 'crystalSmoke', inner: 'crystalSmoke', edge: 'crystalFrost', wear: 0, chamfer: false, moods: [] },
  ceramicBlack: { label: 'Céramique noire', outer: 'blackCeramic', inner: 'brushedSteel', edge: 'diamondCut', wear: 0, chamfer: true, moods: ['studio', 'nuit', 'abysses'] },
  ceramicWhite: { label: 'Céramique blanche', outer: 'whiteCeramic', inner: 'porcelain', edge: 'chrome', wear: 0, chamfer: true, moods: ['clinique', 'pastel', 'studio'] },
  soap: { label: 'Bulle', outer: 'soapFilm', inner: 'soapFilm', edge: 'chrome', wear: 0, chamfer: false, moods: ['irisé', 'nuit', 'abysses'] },
  bronze: { label: 'Bronze & cuivre', outer: 'bronzeDark', inner: 'polishedCopper', edge: 'polishedBrass', wear: 0.3, chamfer: false, moods: ['sacré', 'atelier'] },
};

// teintes d'anodisation et d'émail tirées selon l'humeur
export const TINTS = {
  anodized: ['#3a64b0', '#b03a4a', '#2f8a72', '#7a4ab0', '#c07a2a', '#2a2e36', '#a8a39a'],
  glaze: ['#8fb8a6', '#a9c4d6', '#e0b8a8', '#d8cfa0', '#6f8fa8', '#c9a6c4', '#9fb07a'],
};

// grandeurs à ne pas interpoler / exposer comme curseurs
export const FINISH_KEYS = Object.keys(FINISH_DEFAULTS).filter((k) => k !== 'pattern');
