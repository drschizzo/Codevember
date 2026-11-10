// Pose d'une feuille de mousse, en forme fermée (module pur). La MÊME
// formule est écrite en TSL dans scene/moss.js (leafPose) ; les tests
// comparent les deux sur des points tirés au hasard, et vérifient avec
// celle-ci qu'aucune feuille n'en traverse une autre, à aucun instant.
//
// Repère de la tige au point d'insertion : X radial (vers la feuille), Y le
// long de la tige (vers le haut), Z tangentiel (X × Y). La feuille est
// d'abord posée dans le plan (X, Y), puis tournée autour de la tige.
import { widthAt } from './families.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// arc de cercle partant à l'angle a (depuis l'axe de la tige vers
// l'extérieur), de courbure k, de longueur l : déplacement (r, y)
function arc(a, k, l) {
  if (Math.abs(k * l) < 1e-4) return [l * Math.sin(a), l * Math.cos(a)];
  return [(Math.cos(a) - Math.cos(a + k * l)) / k, (Math.sin(a + k * l) - Math.sin(a)) / k];
}

// ouverture d'une feuille de rang ρ (0 : la plus basse, extérieure ; 1 : le
// bourgeon) quand la tige est ouverte à o : les feuilles extérieures
// s'ouvrent les premières et se ferment les dernières (une feuille intérieure
// est tenue par celles qui l'entourent) — c'est aussi ce qui les empêche de
// se traverser.
export const STAGGER = 0.45;
export function leafOpen(o, rho) {
  const a = rho * STAGGER;
  return sstep(a, a + 1 - STAGGER, o);
}

// paramètres de pose d'une feuille à l'ouverture f ; amp borne l'écartement
// (θ, courbure) d'une feuille serrée par ses voisines — elle se détord et
// s'aplatit quand même entièrement (kt, tw suivent f)
export function poseParams(fam, f, rho, amp = 1) {
  const D = fam.dry, W = fam.wet;
  const g = f * amp;
  // (le bourgeon reste plus serré, les vieilles feuilles s'écartent un peu plus)
  const bud = sstep(0.7, 1, rho);
  return {
    theta: lerp(D.theta, W.theta, g) * (1 - 0.55 * bud) + 0.12 * (1 - rho) * (1 - g),
    kl: lerp(D.kl, W.kl, g) * (1 - 0.6 * bud),
    kt: lerp(D.kt, W.kt, f),
    tw: lerp(D.tw, W.tw, f),
  };
}

// point de la feuille : s le long (0 base, 1 pointe), x en travers (−1…1),
// nu côté de l'épaisseur (+1 dessus, −1 dessous), lat bourrelet de la tranche
// (cos de l'angle de la tranche) ; P paramètres de pose ; G gabarit
// { L, W, h, stemR, twist (±1) } ; Lf : famille.leaf.
// Renvoie [x, y, z] dans le repère de la tige au point d'insertion.
export function leafPoint(s, x, nu, lat, P, G, Lf) {
  const L = G.L, sigma = s * L;
  const Ls = Lf.sheath * L, lh = Lf.hinge * L;
  const kh = (P.theta - Lf.a0) / lh;
  const l1 = Math.min(sigma, Ls), l2 = clamp(sigma - Ls, 0, lh), l3 = Math.max(sigma - Ls - lh, 0);
  const A1 = arc(Lf.a0, 0, l1), A2 = arc(Lf.a0, kh, l2), A3 = arc(P.theta, P.kl, l3);
  const r = A1[0] + A2[0] + A3[0], y = A1[1] + A2[1] + A3[1];
  const al = Lf.a0 + kh * l2 + P.kl * l3;
  // section roulée
  const w = widthAt(s, Lf) * G.W, c = x * w, kc = P.kt * c;
  const S = Math.abs(P.kt) > 1e-4 ? Math.sin(kc) / P.kt : c, C = Math.abs(P.kt) > 1e-4 ? (1 - Math.cos(kc)) / P.kt : 0;
  // n_ad (vers la face supérieure) = (−cos α, sin α) dans (r, y) ; e_t = Z
  const nr = -Math.cos(al), ny = Math.sin(al);
  // normale de la surface roulée et direction en travers
  const ck = Math.cos(kc), sk = Math.sin(kc);
  const half = G.h * 0.5 * (1 - 0.5 * sstep(0.6, 1, s));
  const sx = Math.sign(x) || 1;
  // point : nervure + section + épaisseur (dessus/dessous) + bourrelet (tranche)
  const px = G.stemR + r + nr * C + nr * ck * nu * half + nr * sk * sx * lat * half;
  const py = y + ny * C + ny * ck * nu * half + ny * sk * sx * lat * half;
  const pz = S - sk * nu * half + ck * sx * lat * half;
  // enroulement autour de la tige
  const psi = P.tw * s * G.twist;
  const cp = Math.cos(psi), sp = Math.sin(psi);
  return [px * cp - pz * sp, py, px * sp + pz * cp];
}

// nervure (x = 0, sans épaisseur) : point et tangente au bout, pour le poil
export function tipFrame(P, G, Lf) {
  const p1 = leafPoint(1, 0, 0, 0, P, G, Lf), p0 = leafPoint(0.995, 0, 0, 0, P, G, Lf);
  const t = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], l = Math.hypot(...t);
  return { p: p1, t: t.map((v) => v / l) };
}
