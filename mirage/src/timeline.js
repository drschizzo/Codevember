// La chorégraphie : une seule horloge, la phase u ∈ [0, 1). Module pur.
//
// Un seul mouvement : la caméra plonge dans l'image qui
// flotte au-dessus de l'ouverture. Au début, le couvercle est entier : un
// petit mirascope flotte dans l'ouverture. Puis une coupe s'ouvre dans le
// couvercle, face à la caméra, en éventail, jusqu'au quart (une coupe de
// maquette de musée, tranches peintes en rouge) : par l'entaille, on voit le
// vrai petit posé au fond, et au-dessus de l'ouverture son image — le même
// objet, deux fois, l'un là, l'autre pas. La coupe reste ouverte pendant que
// la caméra s'approche, puis se referme. À la fin, l'image du petit (sa coupe
// s'est ouverte et refermée avec celle du grand : chaque niveau est coupé de
// même) emplit l'écran comme le grand au début : c'est le début, un niveau
// plus bas. La lumière ne change pas.
//
// Le niveau λ de la spirale avance lentement au début, plus vite ensuite ; sa
// vitesse (en échelle logarithmique) est la même des deux côtés du raccord. Chaque petit est posé tourné
// d'un demi-tour : son image a l'orientation du grand, et la caméra n'a pas à
// tourner — l'entaille de chaque niveau lui fait face, et l'image, formée par
// les coupes du côté opposé, reste entière.
//
// La caméra du début (P) et celle qui regarde l'image du petit (C1) voient la
// même chose (ajusté pixel à pixel par tools/seamfit.mjs, salle allumée :
// l'image n'est pas une copie exacte du petit — elle se montre sous un angle
// plus plongeant et un peu étirée). Juste après le raccord, un morphing (chaque
// pixel vise d'abord le point que montrait l'autre vue) efface ce qui reste
// d'écart, sans double image.
import { CUT_HALF } from './gen/abyme.js';

export const CHORE = { morph: 0.045 }; // morphing du raccord, juste après u = 0 (≈ 1 s)

// Les deux poses du raccord (NOCUT=1 FIX_AX=1 MODE=jour tools/seamfit.mjs 50
// 0.011 18 1.7778 0.03, K = 0,05, couvercle fermé : 6,9 % de pixels en
// désaccord, 1,0 mm d'écart moyen à l'échelle du grand, 0,7° sur les reflets de
// la salle) : C1 regarde l'image du petit (repère du grand) ; P regarde le grand,
// assez large pour voir, la coupe ouverte, l'image (en haut) et le petit au
// fond (en bas).
export const SEAM = {
  C1: { el: 50, dist: 0.011, ty: 0.053163, fov: 18 },
  P: { el: 46.536, dist: 0.17807, ty: 0.02964, fov: 20.704 },
};

const s5 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };
const frac = (u) => u - Math.floor(u);
const lerp = (a, b, t) => a + (b - a) * t;

// le niveau de la spirale : 0 au gros plan sur le grand, 1 sur l'image du petit
// Le niveau : vite au raccord (le passage d'un niveau à l'autre se fait en
// mouvement), puis la caméra ralentit et s'attarde pendant que la coupe
// s'ouvre et qu'on compare l'objet et son image, puis plonge. Une courbe de
// Hermite monotone par des clés (u, λ, vitesse) ; la vitesse au raccord est la
// même des deux côtés.
export const DIVE = [[0, 0, 1.6], [0.12, 0.1, 0.3], [0.42, 0.19, 0.3], [0.8, 0.68, 1.6], [1, 1, 1.6]];
export const levelAt = (R, u) => {
  const v = frac(u);
  let k = 0;
  while (k < DIVE.length - 2 && v > DIVE[k + 1][0]) k++;
  const [u0, l0, m0] = DIVE[k], [u1, l1, m1] = DIVE[k + 1], h = u1 - u0, t = (v - u0) / h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * l0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * l1 + (t3 - t2) * h * m1;
};

// pose sur la spirale au niveau λ : la distance est géométrique (C1/P par
// niveau), la visée converge au même rythme vers le point limite de la
// chaîne ; l'élévation et le champ passent de P à C1 en douceur (dérivée nulle
// aux deux bouts : au raccord, l'un se change en l'autre sans à-coup). L'azimut
// se balance de « sway » degrés, une fois par niveau (nul au raccord).
export function spiralAt(R, λ) {
  const { C1, P } = SEAM, r = C1.dist / P.dist, rl = r ** λ;
  const g = (1 - rl) / (1 - r), q = s5(0, 1, λ);
  return {
    dist: P.dist * rl, az: R.camera.az + R.camera.sway * Math.sin(2 * Math.PI * λ),
    ty: P.ty + (C1.ty - P.ty) * g, el: lerp(P.el, C1.el, q), fov: lerp(P.fov, C1.fov, q),
  };
}

export function cameraAt(R, u, λ = levelAt(R, u)) {
  const S = spiralAt(R, λ);
  const az = (S.az * Math.PI) / 180, el = (S.el * Math.PI) / 180;
  const tgt = [0, S.ty, 0];
  const pos = [Math.sin(az) * Math.cos(el) * S.dist, S.ty + Math.sin(el) * S.dist, Math.cos(az) * Math.cos(el) * S.dist];
  return { pos, tgt, fov: S.fov, level: λ };
}

// Le morphing du raccord : juste après u = 0, la vue courante (le grand, λ)
// emprunte d'abord ses directions à la vue du même instant comptée depuis le
// niveau d'avant (l'image du petit, λ + 1), puis les rend (poids w de 1 à 0).
export function seamAt(R, u) {
  const v = frac(u);
  if (v >= CHORE.morph) return null;
  return { w: 1 - s5(0, CHORE.morph, v), alt: levelAt(R, u) + 1 };
}

// La compensation de l'argent : l'image du petit a perdu deux réflexions
// (ρ² par canal) ; on la relève de ρ^(−2λ) à mesure qu'elle emplit l'écran,
// pour qu'au raccord elle ait l'éclat du grand. (La vue du fondu prise avant
// le raccord a λ − 1 < 0 : elle est assombrie d'autant — même éclat affiché.)
export const compExp = (λ) => λ;

// La coupe du couvercle : son demi-angle, de 0 (entier) à CUT_HALF (un quart
// ôté). Elle s'ouvre tôt (la caméra voit encore le grand presque entier),
// reste ouverte, et se referme bien avant le raccord.
export const CUT = { open: [0.06, 0.16], close: [0.44, 0.6] };
export function cutAt(R, u) {
  const v = frac(u);
  return CUT_HALF * s5(...CUT.open, v) * (1 - s5(...CUT.close, v));
}
