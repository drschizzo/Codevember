// La chronologie du film : une seule horloge, la phase u ∈ [0, 1).
// Module pur (sans three.js) : le rendu, la caméra, les appareils, le
// panneau et les tests lisent tous ces fonctions.
//
//   0      – U.sim0   le sable neuf (sec, régalé), la machine garée en amont
//   U.sim0 – U.sim1   l'expérience : la simulation relue, temps hydraulique T ∈ [0, S.T]
//                     (l'eau coule à sa vitesse, le relief change en accéléré : MORFAC)
//   U.dry0 – U.dry1   le séchage (accéléré) : le paysage entier se révèle
//   U.roll0 – U.drop  le portique roule vers l'aval, lame levée, et la descend
//   U.cut0 – U.cut1   le gabarit : la lame descend, le portique remonte vers l'amont en
//                     poussant le sable ; derrière elle, la surface de départ
//   U.cut1 – 1        le sable neuf, la machine garée
// À u = 0 et u → 1 : la surface b₀, sans eau, la lame levée au garage amont.
import { TABLE, inflowAt, rainAt, baseAt } from './gen/table.js';

export const U = { sim0: 0.05, sim1: 0.68, dry0: 0.66, dry1: 0.78, roll0: 0.775, roll1: 0.81, drop: 0.822, cut0: 0.83, cut1: 0.95, lift: 0.962, home: 0.99 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// mouvement à accélération bornée (profil en S du cinquième degré)
export const ease5 = (t) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };

export const PARK = -0.13;           // le portique au garage (m) : au-dessus de la boîte d'alimentation, hors du sable
export const EDGE = -0.03;           // fin du passage : la lame a quitté le sable
export const BLADE_UP = 0.1;         // levée de la lame (m) : elle passe au-dessus de la boîte d'alimentation

// temps hydraulique à la phase u (0 avant l'expérience, S.T après)
export function simTime(u, S) { return clamp01((u - U.sim0) / (U.sim1 - U.sim0)) * S.T; }

// Avancement du relief (0–1) pour un avancement k de l'expérience : le même,
// sauf sur la fin, où le relief accélère un peu puis s'arrête en douceur
// (f(1) = 1, f'(1) = 0) — sans cela l'érosion se figeait d'un coup, en pleine
// course, à la fin de la simulation.
export const RELIEF_EASE = 0.12;
export function reliefK(k) {
  const a = 1 - RELIEF_EASE, d = RELIEF_EASE;
  if (k <= a) return Math.max(0, k);
  const x = Math.min(d, k - a);
  return a + x + (x * x) / d - (x * x * x) / (d * d);
}

// État complet du film à la phase u (fraction de la boucle, [0, 1))
export function filmState(u, S) {
  u -= Math.floor(u);
  const T = simTime(u, S);
  const k = T / S.T;
  // séchage : de l'humide au sec, sur la fin de la vidange et après
  const dry = sstep(U.dry0, U.dry1, u);
  // portique : garé en amont (au-dessus de la boîte), roule vers l'aval lame levée, la descend,
  // pousse vers l'amont, la lève au bout du sable, rentre au garage
  const XD = TABLE.Lx + 0.02;
  let x = PARK, lift = 1;
  if (u >= U.roll0 && u < U.roll1) x = PARK + (XD - PARK) * ease5((u - U.roll0) / (U.roll1 - U.roll0));
  else if (u >= U.roll1 && u < U.cut0) { x = XD; lift = 1 - ease5((u - U.roll1 - 0.004) / (U.drop - U.roll1 - 0.004)); }
  else if (u >= U.cut0 && u < U.cut1) { x = XD + (EDGE - XD) * ease5((u - U.cut0) / (U.cut1 - U.cut0)); lift = 0; }
  else if (u >= U.cut1 && u < U.lift) { x = EDGE; lift = ease5((u - U.cut1) / (U.lift - U.cut1)); }
  else if (u >= U.lift && u < U.home) x = EDGE + (PARK - EDGE) * ease5((u - U.lift) / (U.home - U.lift));
  // la lame n'efface que pendant son passage ; après, tout le bac est b₀
  const screed = u >= U.cut0 && u < U.cut1 ? x : u >= U.cut1 ? -1 : -2;
  return {
    u, T, k,
    terrainFrame: k,              // (0–1 ; multiplier par FT − 1)
    water: u >= U.sim0 && u < U.sim1 + 0.02 ? 1 : 0,
    dry,
    // l'eau restante s'infiltre dans le sable, de la fin de l'expérience à la disparition de l'eau
    drain: sstep(U.sim1 - 0.055, U.sim1 + 0.018, u),
    gantryX: x, bladeLift: lift * BLADE_UP,
    screed,                       // −2 : pas de gabarit ; −1 : bac entier régalé ; sinon position de la lame (m)
    inflow: inflowAt(S, T) * (u < U.sim1 ? 1 : 0),
    rain: rainAt(S, T) * (u < U.sim1 ? 1 : 0),
    base: baseAt(S, T),
  };
}
