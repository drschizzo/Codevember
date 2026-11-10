// Cinématique des déclencheurs, en JS pur (testée dans Node) : la cause et
// l'effet doivent coïncider à l'image près. Le contact est calculé sur la
// vraie géométrie (rayon de la bille, demi-largeur de la tête du marteau,
// longueur de la flamme) : la surface de l'outil touche le point d'impact O
// exactement à l'instant du choc (τ_p = 0), et jamais avant.
//
// Repère du monde ; O : point d'impact, nh : normale horizontale sortante au
// point d'impact ; tp : temps physique depuis le choc (cycle.js, physTime).
import { GRAV, PH } from './cycle.js';

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export const PENDULUM = { L: 4.5, th0: 0.62, rb: 0.09 };
export const HAMMER = { L: 0.84, head: 0.055, ts: 0.09, raise: 1.1 };

// pendule : angle (positif : écarté vers l'extérieur) et centre de la bille
export function pendulum(O, nh, tp, l, Ts) {
  const { L, th0, rb } = PENDULUM, w = Math.sqrt(GRAV / L);
  let th;
  if (tp < -Math.PI / (2 * w)) th = th0;                 // tenue par l'électro-aimant
  else if (tp < 0) th = th0 * Math.sin(-w * tp);         // lâchée un quart de période avant le choc
  else th = -th0 * 0.5 * Math.sin(w * tp) * Math.exp(-0.45 * tp); // elle traverse, amortie
  th += (th0 - th) * ease((l - PH.melt * Ts) / (0.06 * Ts)); // (le bras de rappel la ramène)
  const B0 = add(O, nh, rb);                             // au bas de sa course, elle touche O
  const piv = add(B0, [0, L, 0]);
  const c = add(add(piv, nh, L * Math.sin(th)), [0, -L * Math.cos(th), 0]);
  return { th, center: c, pivot: piv, gap: Math.hypot(c[0] - O[0], c[1] - O[1], c[2] - O[2]) - rb };
}

// marteau : angle du bras (levé vers le haut) et centre de la tête ; le pivot est
// placé pour que la face de la tête touche O quand le bras est à l'horizontale
export function hammer(O, nh, tp, l, Ts) {
  const { L, head, ts, raise } = HAMMER;
  let ph = raise * ease((l - PH.spinStop[1] * Ts) / (0.05 * Ts));
  if (tp > -ts && tp <= 0) ph = raise * (tp / -ts) ** 2;            // la frappe, accélérée
  else if (tp > 0) ph = 0.25 * Math.sin(Math.min(Math.PI, tp * 9)) + 0.8 * ease((l - (PH.rupture + 0.08) * Ts) / (0.06 * Ts)); // rebond, puis il se relève
  const piv = add(O, nh, L + head);
  // tête : à L du pivot, vers −nh, relevée de ph dans le plan vertical
  const c = add(add(piv, nh, -L * Math.cos(ph)), [0, L * Math.sin(ph), 0]);
  return { ph, center: c, pivot: piv, gap: Math.hypot(c[0] - O[0], c[1] - O[1], c[2] - O[2]) - head };
}

// haut-parleur : amplitude de la membrane et du mode (2,0) du verre, qui
// montent ensemble jusqu'à la rupture (la membrane pousse quand le bord s'écarte)
export const resonanceAmp = (l, Ts) => Math.min(1, Math.exp((l - PH.rupture * Ts) * 0.9)) * (l <= PH.rupture * Ts ? 1 : Math.exp(-(l - PH.rupture * Ts) * 4));
export const RES_FREQ = 3.2; // Hz apparents (caméra rapide)

// chalumeau : la flamme touche le verre ; allumée avant le choc thermique,
// éteinte quand le verre se fend
export const TORCH = { dist: 0.62 };
export const torchOn = (l, Ts) => ease((l - (PH.rupture - 0.16) * Ts) / 0.4) * (1 - ease((l - (PH.rupture + 0.01) * Ts) / 0.3));
