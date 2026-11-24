// Cotes de la pièce et de la tranche (module pur).
import { SLAB } from './gen/slab.js';

export const STAND = { baseH: 0.09, glass: 0.006, frameW: 0.05 };
// la tranche : posée sur son socle, face au spectateur (+z), centrée en x
export const SLAB_POS = { y: STAND.baseH, z: 0 };
export const SLAB_H = SLAB.HS + SLAB.AIR;
// l'étagère : M tranches différentes, espacées de L, qui se répètent ; la caméra
// avance de M·L par boucle
export const SHELF = { M: 3, L: 4.0 };
// âge d'une tranche selon sa place à l'écran (p : écart à la caméra, en pas) :
// neuve en entrant à droite, achevée en sortant à gauche
export const ageAt = (p) => Math.min(1, Math.max(0, (1.2 - p) / 2.4));
// les fenêtres (mur devant l'étagère, hors champ) : une par pas, z = Z
export const WINDOW = { Z: 3.6, x0: -1.85, x1: 1.85, y0: -6, y1: 40, bars: [1, 1], barW: 0.05 }; // (portes-fenêtres : seuls les trumeaux portent ombre, entre deux tranches)

export function sunDirAt(az, el) { return [-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]; }
