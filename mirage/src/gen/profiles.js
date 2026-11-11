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

// Hauteur : l'image d'un point à la hauteur h flotte en f + h ; vue d'en haut
// (élévation ~40°), les points au-delà de ~14 mm ne s'y voient plus (leurs
// rayons manquent l'ouverture) — un vrai mirascope coupe aussi les objets trop
// hauts. Tous les objets restent sous 11,5 mm.
export const MAX_H = 0.0115;

// toupie trapue : pointe d'acier au sommet de la coupe (contact en un point),
// cône de bois, bourrelet, dôme, tige et bouton
export const TOP = [[0, 0], [0.0007, 0.0006], [0.0011, 0.0012], [0.0088, 0.0040], [0.0101, 0.0049], [0.0104, 0.0056], [0.0099, 0.0063], [0.0062, 0.0074], [0.0030, 0.0079], [0.0019, 0.0081], [0.0016, 0.0095], [0.0023, 0.0099], [0.0024, 0.0104], [0.0017, 0.0109], [0, 0.0110]];
export const TOP_TIP = 0.0012; // (fin de la pointe d'acier)

// montre de poche ouverte : boîtier bombé, lunette, cadran plat ; le boîtier
// repose sur l'arête de son fond (r = 11,8 mm)
export const WATCH_R = 0.0118;
export const WATCH_Y = up6(bowl(WATCH_R)); // (hauteur du fond du boîtier)
export const CASE = [[0, WATCH_Y], [WATCH_R, WATCH_Y], [0.0132, WATCH_Y + 0.0012], [0.0134, WATCH_Y + 0.0032], [0.0124, WATCH_Y + 0.0042], [0.0116, WATCH_Y + 0.0036], [0, WATCH_Y + 0.0036]];
export const DIAL_Y = WATCH_Y + 0.0036; // (le cadran)
export const CROWN = [0.0143, WATCH_Y + 0.0026, 0.0016]; // (la couronne : x, y, rayon)
// l'anneau (la bélière), couché à plat au bout de la couronne : centre x, y, rayon, épaisseur
export const BOW = [0.0185, WATCH_Y + 0.0026, 0.0027, 0.00055];

// bougie chauffe-plat : godet d'aluminium embouti, cire, mèche ; le godet
// repose sur l'arête de son fond (r = 9,3 mm)
export const TEA_R = 0.0093;
export const TEA_Y = up6(bowl(TEA_R));
export const CANDLE = [[0, TEA_Y], [TEA_R, TEA_Y], [0.0098, TEA_Y + 0.0005], [0.0098, TEA_Y + 0.0058], [0.0093, TEA_Y + 0.0058], [0.0093, TEA_Y + 0.005], [0, TEA_Y + 0.005]];
export const WAX_Y = TEA_Y + 0.005; // (la surface de la cire)
export const WICK = { r: 0.00035, y0: WAX_Y, y1: WAX_Y + 0.0013 };
export const FLAME_Y = WAX_Y + 0.0030; // (le cœur de la flamme ; son sommet reste sous MAX_H)

// boussole de poche : boîtier de laiton tourné, rose des vents creusée, pivot,
// aiguille losange ; posée sur l'arête de son fond (r = 10,5 mm)
export const COMP_R = 0.0105;
export const COMP_Y = up6(bowl(COMP_R));
export const COMPASS = [[0, COMP_Y], [COMP_R, COMP_Y], [0.0113, COMP_Y + 0.0008], [0.0115, COMP_Y + 0.0050], [0.0110, COMP_Y + 0.0056], [0.0101, COMP_Y + 0.0054], [0.0099, COMP_Y + 0.0030], [0, COMP_Y + 0.0030]];
export const CARD_Y = COMP_Y + 0.0030; // (la rose des vents)
export const PIVOT = { r: 0.00045, y1: CARD_Y + 0.0021 };
export const NEEDLE = { y: CARD_Y + 0.0016, len: 0.0086, w: 0.0011, th: 0.0002 };
export const COMP_RING = [0.0135, COMP_Y + 0.0030, 0.0018, 0.00045]; // (l'anneau de suspension, couché à plat : x, y, rayon, épaisseur)

// pile de pièces d'or, décalées : la première repose sur l'arête de son
// fond, chacune à plat sur la précédente
export const COIN = { r: 0.009, h: 0.0016 };
const C0 = up6(bowl(COIN.r));
export const COINS = [[0, 0, 0], [0.0013, 0.0007, 0.9], [-0.0006, 0.0017, 2.1], [0.0011, -0.0004, 3.3]].map(([x, z, rot], i) => ({ x, z, rot, y: C0 + i * COIN.h }));

// sphère qui contient tous les objets (le lancer de rayons n'y marche que là)
export const BOUND = { y: 0.006, r: 0.023 };
export { bowl };
