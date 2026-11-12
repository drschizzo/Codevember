// Le découpage (module pur) : la boucle est filmée en six plans, montés cut,
// chacun calé sur ce qui se passe dans le bac.
//
//   ensemble  (0,955 → 0,11, à cheval sur la boucle) : l'appareil entier dans
//             son lieu, lent travelling avant ; l'eau arrive.
//   au ras    (0,11 → 0,30) : l'objectif dans le bac, à 3 cm du sable, en aval
//             de l'endroit où l'eau travaille, regard vers l'amont — la
//             miniature devient un paysage (courte focale, grande profondeur).
//   macro     (0,30 → 0,47) : une berge active de près, longue focale, faible
//             profondeur de champ — l'échelle vraie du laboratoire.
//   carte     (0,47 → 0,64) : plongée presque verticale, lente rotation — le
//             réseau entier se dessine pendant l'accéléré.
//   séchage   (0,64 → 0,812) : plan large en lumière rasante, panoramique lent ;
//             le portique traverse le cadre vers l'aval.
//   la lame   (0,812 → 0,955) : de profil, la caméra accompagne la lame à sa
//             vitesse, un peu en avant d'elle : le bourrelet vient vers nous,
//             le sable neuf reste derrière.
//
// Dans un plan, la caméra va d'une pose à l'autre à vitesse constante (pas
// d'à-coup) ; entre deux plans, un raccord (le rendu remet à zéro le flou de
// mouvement et l'historique de l'anticrénelage temporel). La pose à u = 1 est
// celle de u = 0 (même plan, le premier enjambe la boucle).
import { TABLE, longProfile, crossProfile } from './gen/table.js';
import { filmState, U } from './timeline.js';

const TAU = Math.PI * 2;
const HX = TABLE.Lx / 2;
// repère du monde : X le long du bac (aval +X), Z en travers, Y la hauteur
export const toWorld = (x, y, z = 0.07) => [x - TABLE.Lx / 2, z, y - TABLE.Ly / 2];

// les plans : début (phase), type
export const SHOTS = [
  { u0: 0.955, kind: 'ensemble' },
  { u0: 0.11, kind: 'ras' },
  { u0: 0.30, kind: 'macro' },
  { u0: 0.47, kind: 'carte' },
  { u0: 0.64, kind: 'sechage' },
  { u0: 0.812, kind: 'lame' }, // (après le roulement rapide du portique : il attend en aval, lame qui descend)
];

// indice du plan qui contient la phase u, et l'avancement t ∈ [0, 1) dans ce plan
export function shotAt(u) {
  u -= Math.floor(u);
  const n = SHOTS.length;
  for (let k = n - 1; k >= 0; k--) {
    const a = SHOTS[k].u0, b = SHOTS[(k + 1) % n].u0;
    const len = (b - a + 1) % 1 || 1;
    const t = (u - a + 1) % 1;
    if (t < len) return { index: k, t: t / len, kind: SHOTS[k].kind };
  }
  return { index: 0, t: 0, kind: SHOTS[0].kind };
}

// hauteur de la surface de départ (m), en coordonnées du bac
const b0 = (S, x, y) => longProfile(S.form, Math.min(TABLE.Lx, Math.max(0, x))) + crossProfile(S.form, Math.min(TABLE.Ly, Math.max(0, y)));
// le plus haut de la surface de départ (et du lac) autour d'un point : la caméra basse le survole
function clearance(S, x, y) {
  let h = 0;
  for (let dx = -0.08; dx <= 0.0801; dx += 0.02) for (let dy = -0.04; dy <= 0.0401; dy += 0.02) h = Math.max(h, b0(S, x + dx, y + dy));
  const lake = Math.max(...(S.base ?? [[0, 0]]).map((b) => b[1]));
  return Math.max(h, lake);
}

// L'endroit où l'eau travaille, propre à chaque famille (coordonnées du bac)
function focusOf(R, S) {
  const F = S.form, t = R.form ?? {};
  const Ly = TABLE.Ly;
  switch (R.family) {
    case 'delta': {
      const y0 = t.srcY ?? Ly / 2;
      return { y0, ras: { cam: [F.xs + 0.03, y0 + 0.03], tgt: [F.xs * 0.5, y0], push: 0.07 }, macro: [F.xs * 0.62, y0], carte: [F.xs * 0.75, y0] };
    }
    case 'recul': {
      const y0 = t.srcY ?? Ly / 2;
      return { y0, ras: { cam: [F.xs + 0.02, y0 + 0.03], tgt: [F.xs - 0.32, y0], push: 0.06 }, macro: [F.xs - 0.14, y0], carte: [F.xs - 0.2, y0] };
    }
    case 'ravines': {
      const xm = F.xs + F.ws / 2;
      return { y0: Ly / 2, ras: { cam: [Math.min(TABLE.Lx - 0.05, xm + 0.42), Ly * 0.55], tgt: [xm - 0.02, Ly * 0.42], push: 0.08 }, macro: [xm, Ly * 0.42], carte: [xm, Ly / 2] };
    }
    default: { // brèche
      const y0 = t.notchY ?? Ly / 2;
      return { y0, ras: { cam: [F.xd + 0.36, y0 + 0.04], tgt: [F.xd + 0.01, y0], push: 0.07 }, macro: [F.xd + 0.03, y0], carte: [F.xd + 0.08, y0] };
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export function buildCamera(R, S) {
  const side = R.camera.side, hk = R.camera.height, fov = R.camera.fov;
  const Fc = focusOf(R, S);
  // position sphérique autour d'une cible (a : azimut, 0 = depuis le côté +Z, π/2 = depuis l'aval)
  const sph = (T, a, el, r) => [T[0] + r * Math.cos(el) * Math.sin(a), T[1] + r * Math.sin(el), T[2] + side * r * Math.cos(el) * Math.cos(a)];
  // (dans le bac, l'écart en travers suit le côté de la caméra : le cadre est en miroir)
  const mirror = (P, T) => [P[0], P[1], T[2] + side * (P[2] - T[2])];
  const mid = toWorld(TABLE.Lx / 2, TABLE.Ly / 2, 0.07);

  // au ras : deux poses de caméra (travelling avant) au-dessus du sable et du lac
  const ras = (() => {
    const { cam, tgt, push } = Fc.ras;
    const c0 = [cam[0], cam[1]], c1 = [cam[0] - push, cam[1] - 0.01];
    const yc = (c) => clearance(S, c[0], c[1]) + 0.032;
    const tg = toWorld(tgt[0], tgt[1], b0(S, tgt[0], tgt[1]) + 0.012);
    const P0 = mirror(toWorld(c0[0], c0[1], yc(c0)), tg), P1 = mirror(toWorld(c1[0], c1[1], yc(c1)), tg);
    const T1 = toWorld(tgt[0] - push * 0.4, tgt[1], b0(S, tgt[0] - push * 0.4, tgt[1]) + 0.012);
    return { P0, P1, T0: tg, T1 };
  })();
  // (hauteur moyenne de la surface de départ : la caméra qui suit la lame reste à niveau)
  let bladeZ = 0;
  for (let k = 0; k <= 40; k++) bladeZ += longProfile(S.form, (k / 40) * TABLE.Lx) / 41;
  const at = (xy, dz = 0) => toWorld(xy[0], xy[1], b0(S, xy[0], xy[1]) + dz);

  function pose(u) {
    const sh = shotAt(u), t = sh.t;
    let position, target, f = fov, dof = 1, near = 0.05;
    switch (sh.kind) {
      case 'ensemble': {
        target = mid;
        position = sph(mid, lerp(0.8, 0.68, t), 0.55 * hk, lerp(1.95, 1.62, t));
        break;
      }
      case 'ras': {
        position = lerp3(ras.P0, ras.P1, t); target = lerp3(ras.T0, ras.T1, t);
        f = 44; dof = 3; near = 0.01;
        break;
      }
      case 'macro': {
        target = at(Fc.macro, -0.004);
        position = sph(target, lerp(0.95, 1.2, t), 0.72, 0.42);
        f = 24; dof = 0.55;
        break;
      }
      case 'carte': {
        target = at(Fc.carte, 0);
        position = sph(target, lerp(0.55, 0.85, t), 1.18, lerp(1.0, 0.9, t));
        break;
      }
      case 'sechage': {
        target = toWorld(TABLE.Lx * 0.55, TABLE.Ly / 2, 0.07);
        position = sph(target, lerp(0.42, 0.72, t), 0.5 * hk, 1.35); // (assez haut pour que le rail passe sous le regard)
        break;
      }
      default: { // la lame : la cible suit le portique
        const F = filmState(u, S);
        // (pas de borne sur x : une borne casserait la vitesse quand la lame quitte le
        // sable ; hauteur constante : le profil a des ruptures de pente, la grue reste à niveau)
        const gx = F.gantryX, hz = bladeZ;
        target = toWorld(gx - 0.03, TABLE.Ly / 2, hz + 0.02);
        // (au-dessus de la ligne du rail : il passe au bas du cadre, pas en travers)
        // (avec le simulateur de pluie, la caméra passe en dedans de ses montants : de
        // l'extérieur, un montant traversait le cadre en gros plan ; elle se tient en
        // avant de la lame, en plongée, et regarde venir le bourrelet)
        if (S.rain) {
          target = toWorld(gx - 0.08, TABLE.Ly / 2, hz + 0.01);
          position = sph(target, -0.6, 0.95, 0.5);
        } else position = sph(target, -0.5, 0.5, 0.85);
        f = fov - 2;
        break;
      }
    }
    return { position, target, fov: f, shot: sh.index, kind: sh.kind, dof, near };
  }
  return pose;
}
export { TAU, HX, U };
