// Le film : la phase u ∈ [0, 1) → l'état de tout ce qui bouge (le cadre, le
// métal, le soleil). Module pur, sans three : la scène, les tests et les bancs
// le lisent. Une seule horloge (règle 17) : le soleil, la fonte, le débit et
// le retournement viennent tous d'ici.
//
// Deux jours par boucle. Jour 1 : le soleil fait fondre le lingot collé au
// plafond du bulbe ; le métal descend le col et remplit le terrier ; au
// crépuscule, la prise part du col ; la nuit, on retourne le sablier. Jour 2 :
// le soleil refond le moulage, le terrier se vide dans le bulbe (en bas) ; la
// flaque prend ; la nuit, on retourne le sablier encore (même sens) : un tour.

export const T = {
  // jour 1
  sunrise1: 0.035, ingotMelt: [0.112, 0.16], fillStart: 0.125, fillEnd: 0.335,
  freeze: [0.37, 0.43], flip1: [0.44, 0.495],
  // jour 2
  meltCast: [0.625, 0.67], drainStart: 0.645, drainEnd: 0.845,
  bulbFreeze: [0.86, 0.9], flip2: [0.925, 0.98],
};
// lever et coucher du soleil, en part de jour (un jour = une demi-boucle)
export const SUN = { rise: 0.06, set: 0.78 };

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = (a, b, x) => clamp01((x - a) / (b - a));

// geste humain du retournement : un léger élan en arrière, la rotation, un
// petit dépassement qui revient (somme nulle aux bornes : 0 → 1 exactement)
export function flipEase(t) {
  t = clamp01(t);
  const s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
  return s - 0.04 * Math.sin(2 * Math.PI * t); // (élan en arrière au départ, dépassement à l'arrivée)
}

// fraction fondue du lingot (jour 1) et débit borné par le col :
// F(u) = min(fondu, Q·(u − u0)) est la solution exacte d'un bulbe qui se vide
// à débit Q tant qu'il lui reste du liquide
const Q1 = 1 / (T.fillEnd - T.fillStart);
const Q2 = 1 / (T.drainEnd - T.drainStart);

export function state(u) {
  u -= Math.floor(u);
  const S = {};
  // le cadre : un demi-tour par nuit, toujours dans le même sens
  S.flip = flipEase(lin(T.flip1[0], T.flip1[1], u)) + flipEase(lin(T.flip2[0], T.flip2[1], u));
  S.theta = Math.PI * S.flip;
  S.day = u < 0.5 ? 1 : 2;
  const d = (u % 0.5) / 0.5; // part du jour
  S.dayFrac = d;
  // jour 1 ─ lingot, remplissage, prise
  const melted1 = sstep(T.ingotMelt[0], T.ingotMelt[1], u);
  S.F = Math.min(melted1, Math.max(0, Q1 * (u - T.fillStart)));
  if (u >= 0.5) S.F = 1;
  S.ingot = u < 0.5 ? 1 - melted1 : 0; // part du métal encore solide au plafond du bulbe
  S.G = u < 0.5 ? lin(T.freeze[0], T.freeze[1], u) : 1; // front de prise (fraction de la plus grande distance)
  // jour 2 ─ fonte du moulage, vidange, prise de la flaque
  S.M = u < 0.5 ? 0 : lin(T.meltCast[0], T.meltCast[1], u); // front de fonte (0 : tout solide, 1 : tout liquide)
  const melted2 = u < 0.5 ? 0 : sstep(T.meltCast[0], T.meltCast[1], u);
  S.D = u < 0.5 ? 0 : Math.min(melted2, Math.max(0, Q2 * (u - T.drainStart))); // fraction vidée
  S.bulbFrozen = u < 0.5 ? 1 - melted1 : lin(T.bulbFreeze[0], T.bulbFreeze[1], u); // flaque du bulbe : part prise
  // métal dans le bulbe (fraction du volume total) : liquide et solide
  if (u < 0.5) { S.bulb = 1 - S.F; S.bulbLiquid = melted1 - S.F; } else { S.bulb = S.D; S.bulbLiquid = S.D * (1 - S.bulbFrozen); }
  S.inNest = 1 - S.bulb;
  // le filet dans le col : il coule tant que du métal passe
  S.neck = u < 0.5 ? (S.F > 0 && S.F < 1 ? 1 : 0) : (S.D > 0 && S.D < 1 ? 1 : 0);
  S.filling = u < 0.5;
  // le soleil (deux jours identiques)
  S.sunUp = sstep(SUN.rise - 0.03, SUN.rise + 0.03, d) * (1 - sstep(SUN.set - 0.03, SUN.set + 0.03, d));
  S.sunT = clamp01((d - SUN.rise) / (SUN.set - SUN.rise)); // 0 au lever, 1 au coucher
  return S;
}
