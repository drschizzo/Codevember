// L'horloge d'un site (module pur, sans three.js : importé par la scène, le
// worker, les tests et la page « défis techniques »).
//
// Le bois est périodique de période L le long du vent (x). Le site j vit son
// cycle à la phase locale s = u − j :
//   s < 0      : bois nu (les spores n'y sont pas encore arrivées) ;
//   0 → 1      : le cycle — germination, réseau, condensation, forêt,
//                maturation, dissémination ;
//   1 → 2      : l'usure des sporanges vides ;
//   s ≥ 2      : plus rien.
// La caméra avance de L par boucle (camera.js) : le monde à u + 1 est le monde
// à u translaté de L. La boucle est parfaite par construction.
//
// Une seule horloge : la lumière (le jour), le vent, la croissance et la
// caméra lisent toutes ces bornes. À l'intérieur d'un temps, chaque grandeur
// est monotone (test/timeline.test.mjs).

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const sstep5 = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };

// Les temps du film, en phase du site (durée par défaut de la boucle : 40 s)
export const T = {
  land: [-0.12, 0.05],     // les spores du site précédent se posent (vues du site j : s < 0)
  germ: [0.04, 0.2],       // gouttelettes jaunes dans la poussière, qui gonflent et fusionnent
  net: [0.1, 0.42],        // la nappe s'étend ; derrière son front, le réseau
  dawn: [0.38, 0.47],      // la lumière monte
  condense: [0.42, 0.52],  // les veines se vident dans les perles
  rise: [0.48, 0.62],      // la forêt se lève (+ retards propres à chaque sporange)
  mature: [0.58, 0.74],    // couleur, séchage
  wind: [0.72, 0.95],      // le souffle (rafales)
  open: [0.74, 0.86],      // déhiscence (+ retards)
  release: [0.75, 0.93],   // les spores partent
  travel: [0.84, 1.04],    // la caméra suit le nuage jusqu'au site suivant
  dusk: [0.86, 1.0],       // la lumière baisse
  wear: [1.05, 1.9],       // les sporanges vides s'affaissent et s'effritent
};

const W = (k, s) => sstep(T[k][0], T[k][1], s);

// le jour : intensité relative de la lumière principale (0 nuit, 1 jour)
// (périodique : la nuit de la germination est celle qui suit le crépuscule)
export function daylight(s) {
  const p = s - Math.floor(s);
  return W('dawn', p) * (1 - sstep(T.dusk[0], T.dusk[1], p));
}

// le vent moyen (cm/s le long de +x) : calme, puis des rafales, puis la brise
// qui retombe. g : rafales (0 régulière … 1 très rafaleuse)
export function windSpeed(s, gust = 0.5, strength = 1) {
  if (s < T.wind[0] || s > T.wind[1] + 0.02) return 0;
  const on = sstep(T.wind[0], T.wind[0] + 0.03, s) * (1 - sstep(T.wind[1] - 0.04, T.wind[1], s));
  const t = (s - T.wind[0]) / (T.wind[1] - T.wind[0]);
  // rafales : bosses lisses dont le nombre et la hauteur dépendent de gust
  const g = 1 + gust * 0.9 * Math.sin(Math.PI * t * 5) ** 2 * Math.sin(Math.PI * t);
  return strength * 1.1 * on * g;
}

// avancement d'une étape propre à un sporange (retard d ∈ [0, 1] tiré à la
// génération, étendue « spread » en part de boucle)
export const stage = (k, s, d = 0, spread = 0) => sstep(T[k][0] + d * spread, T[k][1] + d * spread, s);

// germination : rayon relatif d'une gouttelette née à s0
export const droplet = (s, s0) => sstep(s0, s0 + 0.05, s);

// la pose de toute la scène à la phase u (lue par la scène et les tests) :
// les deux sites montrés — le présent (décalage 0, phase u) et le passé
// (décalage −L, phase u + 1)
export function sites(u) {
  const ph = u - Math.floor(u);
  return [{ off: 0, s: ph }, { off: -1, s: ph + 1 }];
}
