// L'horloge du film : une seule, lue par tout (règle 17). Module pur.
//
// La phase u ∈ [0, 1) parcourt :
//   0     – 0,03  repos : la perle gelée, dressée en pointe ; froid, givre
//   0,03  – 0,44  croissance (accéléré) : l'hexagone sort de la perle, les bras partent
//   0,44  – 0,52  l'étoile entière ; le soleil entre (0,45 – 0,52), le givre s'éteint
//   0,52  – 0,78  la fonte (temps réel), avec un ralenti au rassemblement
//   0,79  – 0,88  la goutte s'évapore (accéléré)
//   0,85  – 0,92  le soleil passe
//   0,88  – 0,97  la goutte gèle de bas en haut, sa pointe se soulève ; le givre revient
//   0,97  – 1     repos (= 0)
// Toutes les grandeurs sont égales à u = 0 et à u = 1 (raccord exact) et
// monotones à l'intérieur de chaque temps.

export const TL = {
  grow0: 0.03, grow1: 0.44,
  sun0: 0.45, sun1: 0.52,
  melt0: 0.52, melt1: 0.78,
  bead0: 0.52, bead1: 0.58,
  evap0: 0.79, evap1: 0.88,
  dusk0: 0.85, dusk1: 0.92,
  freeze0: 0.88, freeze1: 0.97,
};

export const sstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (u, a, b) => sstep((u - a) / (b - a));

// noyau de respiration (Hollow, Orrery) : K(x) = x − 3x³ + 3x⁵ − x⁷ sur [−1, 1] ;
// τ(x) = x − a·w·K((x − x₀)/w) ralentit (a > 0) autour de x₀ sans changer
// la durée totale, et τ(x₀) = x₀
export const K7 = (x) => (Math.abs(x) >= 1 ? 0 : x - 3 * x ** 3 + 3 * x ** 5 - x ** 7);
export const breathe = (x, x0, w, a) => x - a * w * K7((x - x0) / w);

// tau, tauMelt : largeur des rampes d'une cellule (voir gen/crystal.js)
// growInv : instant d'attachement où le cristal atteint la part ρ de son rayon
// (gen/crystal.js) — le rayon avance régulièrement à l'écran
export function growTime(x, growInv) {
  if (!growInv) return x;
  const n = growInv.length - 1, f = Math.min(n, Math.max(0, x * n)), i = Math.floor(f), j = Math.min(n, i + 1);
  return growInv[i] + (growInv[j] - growInv[i]) * (f - i);
}

export function clock(u, { tau = 0.02, tauMelt = 0.02, gather = 0.8, growInv = null } = {}) {
  u -= Math.floor(u);
  // croissance : le rayon avance d'un pas régulier, départ et fin adoucis (la
  // dernière ramification se pose)
  const xg = Math.min(1, Math.max(0, (u - TL.grow0) / (TL.grow1 - TL.grow0)));
  const eg = 0.55 * xg + 0.45 * sstep(xg);
  // (la rampe d'une cellule dure τ : la dernière s'achève en fin de croissance)
  const tg = u < TL.grow0 ? -0.05 : -0.05 + 0.05 * Math.min(1, eg * 20) + growTime(eg, growInv) + (tau + 0.05) * sstep((xg - 0.85) / 0.15);
  // fonte : ralenti au rassemblement (x₀ = gather)
  const xm = Math.min(1, Math.max(0, (u - TL.melt0) / (TL.melt1 - TL.melt0)));
  const em = Math.min(1, Math.max(0, breathe(xm, gather, 0.2, 0.45)));
  const sm = u < TL.melt0 ? -0.05 : u > TL.melt1 ? 1 + tauMelt + 0.05 : -0.05 + (1.1 + tauMelt) * em;
  // lumière : le soleil entre, puis passe
  const sun = ramp(u, TL.sun0, TL.sun1) - ramp(u, TL.dusk0, TL.dusk1);
  // la perle du centre : gelée au repos, fondue de la fonte au gel
  const frozen = 1 - ramp(u, TL.bead0, TL.bead1) + ramp(u, TL.freeze0, TL.freeze1);
  // l'évaporation ramène la goutte au volume de la perle
  const evap = ramp(u, TL.evap0, TL.evap1);
  // givre des fibres : pousse après le passage du soleil, tient tout le froid,
  // fond au premier soleil (il est plus fin que le cristal)
  let frost;
  if (u >= 0.9) frost = sstep((u - 0.9) / 0.18);
  else if (u < 0.08) frost = sstep((u + 0.1) / 0.18);
  else if (u < 0.45) frost = 1;
  else if (u < 0.5) frost = 1 - sstep((u - 0.45) / 0.05);
  else frost = 0;
  // l'air sursaturé (poussière de diamant, brume givrante) : pendant le froid
  const cold = 1 - sun;
  // eau sur la glace : la surface se mouille au début de la fonte
  const wet = ramp(u, TL.melt0 - 0.01, TL.melt0 + 0.03) * (1 - ramp(u, TL.melt1, TL.melt1 + 0.02));
  return { u, tg, sm, sun, cold, frozen, evap, frost, wet };
}
