// Les objets du fond, en profils de révolution (r, y) en mètres, repère de la
// coupe du bas (sommet à l'origine). Module pur : le lancer de rayons
// (scene/raytrace.js) en fait des SDF ; les tests vérifient qu'ils reposent
// exactement sur le fond courbe y = r²/4f.
//
// Un objet à fond plat posé dans une coupe concave ne touche pas le fond au
// centre : il repose sur l'arête de son pied, à la hauteur du fond à ce rayon.
import { PARAB } from './mirascope.js';

const bowl = (r, f = PARAB.f) => (r * r) / (4 * f);
const up6 = (x) => Math.ceil(x * 1e6) / 1e6; // (arrondi vers le haut : jamais sous le fond)

// toupie : la pointe d'acier au sommet de la coupe (contact en un point)
export const TOP = [[0, 0], [0.0012, 0.0012], [0.0105, 0.0065], [0.0112, 0.0078], [0.0085, 0.0098], [0.0032, 0.0112], [0.0018, 0.0118], [0.0016, 0.019], [0.0022, 0.0198], [0, 0.0202]];

// montre de poche ouverte : boîtier bombé, lunette, cadran plat ; le boîtier
// repose sur l'arête de son fond (r = 11,8 mm)
export const WATCH_R = 0.0118;
export const WATCH_Y = up6(bowl(WATCH_R)); // (hauteur du fond du boîtier)
export const CASE = [[0, WATCH_Y], [WATCH_R, WATCH_Y], [0.0132, WATCH_Y + 0.0012], [0.0134, WATCH_Y + 0.0032], [0.0124, WATCH_Y + 0.0042], [0.0116, WATCH_Y + 0.0036], [0, WATCH_Y + 0.0036]];
export const DIAL_Y = WATCH_Y + 0.0036; // (le cadran)
export const CROWN = [0.0143, WATCH_Y + 0.0026, 0.0016]; // (la couronne : x, y, rayon)

// bougie chauffe-plat : godet d'aluminium embouti, cire, mèche ; le godet
// repose sur l'arête de son fond (r = 9,3 mm)
export const TEA_R = 0.0093;
export const TEA_Y = up6(bowl(TEA_R));
export const CANDLE = [[0, TEA_Y], [TEA_R, TEA_Y], [0.0098, TEA_Y + 0.0005], [0.0098, TEA_Y + 0.0058], [0.0093, TEA_Y + 0.0058], [0.0093, TEA_Y + 0.005], [0, TEA_Y + 0.005]];
export const WAX_Y = TEA_Y + 0.005; // (la surface de la cire)
export const WICK = { r: 0.00035, y0: WAX_Y, y1: WAX_Y + 0.0021 };
export const FLAME_Y = WAX_Y + 0.0046; // (le cœur de la flamme)

// sphère qui contient tous les objets (le lancer de rayons n'y marche que là)
export const BOUND = { y: 0.011, r: 0.0185 };
export { bowl };
