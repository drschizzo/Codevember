// Catalogue des membranes : aspect (rendu) et comportement (simulation).
//
// Aspect — modèle d'une couche mince diffusante :
//   absorb   : couleur transmise à travers l'épaisseur nominale (loi de
//              Beer-Lambert : T = absorb^(h·density), h = épaisseur relative,
//              qui vaut 1/J quand la membrane est étirée d'un facteur J en surface)
//   clarity  : part de la lumière transmise qui traverse sans être diffusée
//              (on voit net au travers) ; le reste ressort flou, teinté par scatter
//   scatter  : couleur de la lumière diffusée (albédo de la matière)
//   blur     : flou de ce qui est vu au travers (diffusion vers l'avant)
//   sss      : translucidité (lumière venue de derrière qui traverse la membrane)
//   vessels  : réseau de vaisseaux (absorption, relief), capillary : capillaires
//   wet      : film humide (vernis : reflets nets au-dessus d'une surface diffuse)
//   whiten   : blanchiment sous tension (craquelures du polymère, fibres
//              qui se séparent avant la rupture)
//   fibers   : fibres (vélin, soie), mottle : irrégularité de l'épaisseur,
//   wrinkles : plis de compression
//   irid     : interférences (film mince) ; l'épaisseur du film suit 1/J
//   metal    : feuille de métal battu (l'or transmet le vert)
//   bire     : photoélasticité — retard (nm) par unité d'écart des étirements
//              principaux, à l'épaisseur nominale ; visible en lumière
//              polarisée (gélatine et caoutchouc : très sensibles ; collagène
//              et soie : biréfringents ; film liquide et métal : rien)
// Comportement :
//   thick (épaisseur, en rayon), pre (précontrainte), stretch (souplesse en
//   étirement, XPBD), bend (souplesse en flexion), strength (allongement à la
//   rupture au-delà de l'état de repos), strengthVar (hétérogénéité), init
//   (amorce au pôle), curl (enroulement des lèvres), curlWidth, curlKick,
//   damping (viscosité), drag (air), flutter (frémissement des lambeaux), leak
//   (fuite de la pression après la première déchirure, s), friction, lip
//   (épaisseur des lèvres), fibrils (densité de filaments), fibPer, fibSnap
//   (allongement avant claquage), fibRadius, warp (irrégularité du tracé),
//   warpScale, branch (embranchements), sectors (épines : coupures autour de la pointe),
//   peel (retroussement des lambeaux vers l'arrière, après la première rupture),
//   fatigue (le seuil de rupture baisse au fil de l'éclosion : tout finit par céder),
//   relax (relaxation plastique des lambeaux : ils cessent de se rétracter),
//   unzip (dégrafage de l'avant : le front de déchirure passe partout, du pôle
//   vers l'arrière, unzipDelay après la première rupture ; 0 : désactivé)

export const MEMBRANE_DEFAULTS = {
  label: '—',
  scatter: '#f0d8c8', absorb: '#ffd8c4', density: 1, clarity: 0.35, blur: 0.5, refract: 0.006,
  rough: 0.35, spec: 0.5, wet: 0.8, wetRough: 0.03, wetWave: 0.5,
  sheen: 0, sheenColor: '#ffffff', sheenRough: 0.4, irid: 0, iridIOR: 1.35, iridNm: 380,
  metal: 0, metalColor: '#ffe29d',
  vessels: 0, vesselColor: '#5a0a12', vesselRelief: 0.6, capillary: 0,
  fibers: 0, fiberScale: 1, mottle: 0.35, mottleScale: 1, wrinkles: 0.25,
  whiten: 0.4, whitenColor: '#fff6ee', edgeWhite: 0.3,
  sss: 1, sssColor: '#ff8a66', sssPower: 3, sssDistort: 0.2,
  lipDensity: 3, lipColor: '#fff0e6', bire: 1400,
  // comportement
  thick: 0.012, pre: 0.04, stretch: 1.1e-5, bend: 3e-4, strength: 0.25, strengthVar: 0.3, init: 0.5,
  curl: 0.25, curlWidth: 0.06, curlKick: 0.3, curlSign: 1, damping: 1.5, drag: 8, flutter: 2, leak: 0.25, friction: 0.5,
  lip: 1.6, fibrils: 0.3, fibPer: 2, fibSnap: 0.06, fibRadius: 0.0025, fibMax: 260,
  warp: 0.12, warpScale: 2.5, branch: 0.5, sectors: 4, peel: 4.5, fatigue: 0.85, relax: 3, unzip: 1, unzipDelay: 0.12,
};

const M = (o) => ({ ...MEMBRANE_DEFAULTS, ...o });

export const MEMBRANES = {
  chorion: M({
    bire: 1600,
    label: 'Chorion (amnios)', scatter: '#f3dccd', absorb: '#ffd2bd', density: 1.1, clarity: 0.32, blur: 0.55,
    wet: 1, wetRough: 0.025, wetWave: 0.7, vessels: 1, vesselColor: '#7c0e18', capillary: 0.6, mottle: 0.45,
    sss: 1.4, sssColor: '#ff7356', whiten: 0.35, lipColor: '#ffe6d8',
    fibrils: 0.35, fibSnap: 0.09, fibRadius: 0.003,
  }),
  wax: M({
    bire: 500,
    label: 'Cire (pétale)', scatter: '#f7efe2', absorb: '#ffd59c', density: 1.9, clarity: 0.12, blur: 0.9,
    rough: 0.42, wet: 0.25, wetRough: 0.06, sss: 2.2, sssColor: '#ff9a48', sssPower: 2.2, mottle: 0.5, mottleScale: 0.6,
    whiten: 0.5, thick: 0.02, stretch: 9e-6, bend: 2e-4, strength: 0.16, curl: 0.12, fibrils: 0.2, fibSnap: 0.04,
  }),
  latex: M({
    bire: 2600,
    label: 'Latex rouge', scatter: '#9c0f19', absorb: '#c8121c', density: 1.7, clarity: 0.12, blur: 0.35,
    rough: 0.22, spec: 0.6, wet: 0.55, wetRough: 0.06, wetWave: 0.2, mottle: 0.15, wrinkles: 0.8,
    sss: 1, sssColor: '#ff2414', sssPower: 2.5, whiten: 0.6, whitenColor: '#ffb8b0', lipColor: '#ff6f5f',
    pre: 0.08, stretch: 2.2e-5, strength: 0.32, curl: 0.45, curlKick: 0.6, damping: 1.4, leak: 0.08, fibrils: 0.05, warp: 0.06, branch: 0.2,
  }),
  // (fumé plutôt qu'opaque : de face, la lumière du cœur le traverse en
  // grenat ; tendu, il s'éclaircit ; de biais, il reste noir)
  latexBlack: M({
    bire: 2600,
    label: 'Latex noir', scatter: '#141116', absorb: '#6a4452', density: 1.6, clarity: 0.04, blur: 0.3,
    rough: 0.1, spec: 0.7, wet: 0.9, wetRough: 0.015, wetWave: 0.15, mottle: 0.1, wrinkles: 0.9,
    sss: 0.5, sssColor: '#ff3a52', whiten: 0.5, whitenColor: '#8f7f88', lipColor: '#3a3036',
    pre: 0.08, stretch: 2.2e-5, strength: 0.32, curl: 0.45, curlKick: 0.6, damping: 1.4, leak: 0.08, fibrils: 0.04, warp: 0.06, branch: 0.2,
  }),
  vellum: M({
    bire: 900,
    label: 'Vélin (parchemin)', scatter: '#ecdfc4', absorb: '#e2b874', density: 1.5, clarity: 0.04, blur: 0.85,
    rough: 0.62, spec: 0.35, wet: 0, fibers: 1, fiberScale: 1, mottle: 0.6, mottleScale: 1.4, wrinkles: 0.3,
    sss: 1.3, sssColor: '#ffaf52', sssPower: 2, whiten: 0.2, lipColor: '#fff4dd',
    pre: 0.02, stretch: 5e-6, bend: 4e-5, strength: 0.08, strengthVar: 0.45, curl: 0.05, curlKick: 0.1, damping: 2.2, drag: 12,
    fibrils: 0.85, fibPer: 3, fibSnap: 0.028, fibRadius: 0.0011, warp: 0.22, warpScale: 3.5, branch: 1,
  }),
  gel: M({
    bire: 3400,
    label: 'Gel (agar)', scatter: '#d3eaf2', absorb: '#dcf5ff', density: 0.45, clarity: 0.82, blur: 0.12, refract: 0.03,
    rough: 0.05, spec: 0.5, wet: 1, wetRough: 0.008, wetWave: 0.35, mottle: 0.25, wrinkles: 0.2,
    sss: 0.7, sssColor: '#a6e8ff', sssPower: 4, whiten: 0.25, whitenColor: '#f2fbff', lipColor: '#eafaff', lipDensity: 1.5,
    thick: 0.03, stretch: 1.6e-5, bend: 3e-4, strength: 0.3, curl: 0.1, curlKick: 0.15, damping: 3, leak: 0.4,
    lip: 2, fibrils: 0.4, fibSnap: 0.07, fibRadius: 0.005, warp: 0.08,
  }),
  // (l'or battu transmet un peu de vert, mais faiblement et diffusé par le
  // froissé : transmission saturée et nette, le cœur apparaissait en taches fluo)
  goldLeaf: M({
    bire: 0,
    label: 'Feuille d’or', scatter: '#000000', absorb: '#66786a', density: 3.4, clarity: 0.05, blur: 0.6,
    metal: 1, metalColor: '#ffe29d', rough: 0.17, spec: 1, wet: 0, mottle: 0.2, wrinkles: 1.6,
    sss: 0, whiten: 0, edgeWhite: 0, lipColor: '#ffd98a', lipDensity: 6,
    thick: 0.006, pre: 0.01, stretch: 4e-6, bend: 2e-5, strength: 0.06, strengthVar: 0.5, curl: 0.15, curlKick: 0.25, damping: 1.2,
    fibrils: 0, warp: 0.25, warpScale: 3, branch: 1.2, flutter: 4,
  }),
  bubble: M({
    bire: 0,
    label: 'Bulle (film lipidique)', scatter: '#ffffff', absorb: '#ffffff', density: 0.04, clarity: 1, blur: 0, refract: 0.002,
    rough: 0.02, spec: 1, wet: 0.35, wetRough: 0.01, wetWave: 0.2, irid: 1, iridIOR: 1.33, iridNm: 430, mottle: 0.6, mottleScale: 0.7, wrinkles: 0,
    sss: 0, whiten: 0, edgeWhite: 0, lipColor: '#ffffff', lipDensity: 0.4,
    thick: 0.004, pre: 0.05, stretch: 1.3e-5, strength: 0.15, curl: 0.6, curlKick: 0.2, damping: 0.6, leak: 0.05, flutter: 3,
    fibrils: 0, branch: 0, warp: 0.05,
  }),
  // (la matière des modèles de photoélasticité : claire, épaisse, très
  // sensible ; elle s'étire beaucoup avant de céder, les franges ont le temps
  // de se multiplier)
  gelatin: M({
    bire: 4200,
    label: 'Gélatine photoélastique', scatter: '#c9d2da', absorb: '#f2f7ff', density: 0.25, clarity: 0.92, blur: 0.08, refract: 0.02,
    rough: 0.04, spec: 0.6, wet: 0.6, wetRough: 0.006, wetWave: 0.25, mottle: 0.15, wrinkles: 0.15,
    sss: 0.35, sssColor: '#ffffff', sssPower: 4, whiten: 0.08, whitenColor: '#ffffff', edgeWhite: 0.1, lipColor: '#ffffff', lipDensity: 1.2,
    thick: 0.02, stretch: 1.8e-5, bend: 2.5e-4, strength: 0.38, curl: 0.15, curlKick: 0.2, damping: 2.5, leak: 0.3,
    lip: 1.8, fibrils: 0.25, fibSnap: 0.08, fibRadius: 0.004, warp: 0.08,
  }),
  silk: M({
    bire: 1800,
    label: 'Organza de soie', scatter: '#ece6ff', absorb: '#dcd4ff', density: 0.65, clarity: 0.55, blur: 0.25,
    rough: 0.5, spec: 0.4, wet: 0, sheen: 1, sheenColor: '#ffffff', sheenRough: 0.3, irid: 0.25, iridNm: 520,
    fibers: 1, fiberScale: 2.2, mottle: 0.2, wrinkles: 0.6, sss: 0.6, sssColor: '#d6c8ff', whiten: 0.2,
    stretch: 7e-6, bend: 6e-5, strength: 0.12, curl: 0, curlKick: 0, damping: 2, drag: 14, flutter: 4,
    fibrils: 1, fibPer: 3, fibSnap: 0.04, fibRadius: 0.0009, warp: 0.15, branch: 0.6,
  }),
};

// grandeurs d'aspect (uniformes : retouche sans nouvelle simulation)
export const LOOK_KEYS = ['scatter', 'absorb', 'density', 'clarity', 'blur', 'refract', 'rough', 'spec', 'wet', 'wetRough', 'wetWave',
  'sheen', 'sheenColor', 'sheenRough', 'irid', 'iridIOR', 'iridNm', 'metal', 'metalColor', 'vessels', 'vesselColor', 'vesselRelief', 'capillary',
  'fibers', 'fiberScale', 'mottle', 'mottleScale', 'wrinkles', 'whiten', 'whitenColor', 'edgeWhite', 'sss', 'sssColor', 'sssPower', 'sssDistort',
  'lipDensity', 'lipColor', 'bire'];
// grandeurs de comportement (nouvelle simulation)
export const PHYS_KEYS = ['thick', 'pre', 'stretch', 'bend', 'strength', 'strengthVar', 'init', 'curl', 'curlWidth', 'curlKick', 'curlSign',
  'damping', 'drag', 'flutter', 'leak', 'friction', 'lip', 'fibrils', 'fibPer', 'fibSnap', 'fibRadius', 'fibMax', 'warp', 'warpScale', 'branch', 'sectors', 'peel', 'fatigue', 'relax', 'unzip', 'unzipDelay'];
