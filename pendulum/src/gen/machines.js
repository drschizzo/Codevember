// Les familles de machines : ce qu'elles imposent, leurs maillons (masses
// calculées d'après les pièces), leurs équilibres, leurs limites et les
// réglages de leur solveur (module pur).
//
// Unités : mètres, kilogrammes, secondes, radians.
import { makeSystem } from './dynamics.js';

// le pivot du tourniquet est à r + ARM_HEAD de l'axe (devant le palier de tête)
export const ARM_HEAD = 0.038;
export const DENSITY = { steel: 7850, alu: 2700, brass: 8500, wood: 700 };

// Masse, centre de gravité et inertie d'un maillon, d'après ses pièces : la
// barre (pleine, ajourée ou tube, dans la matière de l'accord), les deux
// chapes à roulement (au pivot et à l'extrémité) et la lentille éventuelle.
// Composé par le théorème de Huygens.
export function linkMass(L) {
  const parts = [];
  const rho = DENSITY[L.metal ?? 'alu'];
  const bar = L.l * L.w * L.t * rho * (L.fill ?? 1);
  parts.push({ m: bar, x: L.l / 2, J: (bar * L.l * L.l) / 12 });
  // chapes : boîtier d'acier autour d'un roulement (≈ 60 g à 120 g)
  const hub = L.hub ?? 0.08;
  parts.push({ m: hub, x: 0, J: 0 }, { m: L.last ? hub * 0.5 : hub, x: L.l, J: 0 });
  if (L.bob) parts.push({ m: L.bob.m, x: L.bob.at * L.l, J: 0.25 * L.bob.m * L.bob.r * L.bob.r });
  if (L.extra) parts.push(...L.extra);
  const m = parts.reduce((s, p) => s + p.m, 0);
  const c = parts.reduce((s, p) => s + p.m * p.x, 0) / m;
  const J = parts.reduce((s, p) => s + p.J + p.m * (p.x - c) ** 2, 0);
  return { l: L.l, c, m, J };
}

// Familles. `drive` : nature de la coordonnée imposée ; `limit` : course
// permise (rail, angle) ; `weights` : α (effort) et β (écart au point
// milieu) du coût ; `T` : durée nominale d'une transition selon le nombre de
// maillons qui changent d'état.
export const FAMILIES = {
  cart: { label: 'Chariot', drive: 'cart', links: [2, 3], weights: { alpha: 1, beta: 60 }, T: [1.9, 2.4, 3.0] },
  rotary: { label: 'Tourniquet', drive: 'rotary', links: [1, 2], weights: { alpha: 0.02, beta: 1 }, T: [1.6, 2.4, 2.8] },
  acrobat: { label: 'Acrobate', drive: 'elbow', links: [2], weights: { alpha: 0.01, beta: 0.4 }, T: [3, 4.2, 4.6] },
  wheel: { label: 'Roue', drive: 'wheel', links: [1], weights: { alpha: 0.0004, beta: 0.002 }, T: [2.4, 3, 3.4] },
};

// Spécification physique d'une machine (ce que lit le solveur) à partir de
// la recette : maillons, masses, inertie du volant, rayon du bras.
export function physicsOf(M) {
  const n = M.links.length;
  const links = M.links.map((L, i) => linkMass({ ...L, last: i === n - 1 }));
  const spec = { kind: FAMILIES[M.family].drive, links };
  if (M.family === 'acrobat') {
    // moteur sur le premier maillon, près de l'épaule
    const L0 = M.links[0];
    links[0] = linkMass({ ...L0, extra: [{ m: M.motor.m, x: M.motor.at * L0.l, J: 0.5 * M.motor.m * 0.03 ** 2 }] });
    spec.joint = 1;
  }
  if (M.family === 'wheel') {
    // volant au bout du dernier maillon : sa masse compte dans le maillon,
    // son inertie propre tourne à part (ψ relatif au maillon)
    const W = M.wheel, Ln = M.links[n - 1];
    const mw = W.m, Iw = W.m * W.r * W.r * W.rim + 0.5 * W.m * W.r * W.r * (1 - W.rim) * 0.5;
    links[n - 1] = linkMass({ ...Ln, last: true, extra: [{ m: mw + W.motor, x: Ln.l, J: 0 }] });
    spec.Iw = Iw;
  }
  if (M.family === 'rotary') spec.radius = M.arm.r + ARM_HEAD; // (le premier maillon pend devant la tête du bras)
  return spec;
}

export const systemOf = (M) => makeSystem(physicsOf(M));

// Équilibres : une lettre par maillon, D (pend) ou U (debout). Angles absolus
// cibles déroulés depuis l'état précédent (± π pour un maillon qui bascule).
export const allEquilibria = (n) => Array.from({ length: 1 << n }, (_, k) => Array.from({ length: n }, (_, i) => ((k >> (n - 1 - i)) & 1 ? 'U' : 'D')).join(''));

export function targetAngles(prev, code, signs) {
  // prev : angles absolus courants (déroulés) ; signs[i] = ±1 sens de bascule
  return prev.map((a, i) => {
    const want = code[i] === 'U' ? Math.PI : 0;
    const cur = ((Math.round(a / Math.PI) % 2) + 2) % 2 ? Math.PI : 0;
    return want === cur ? a : a + signs[i] * Math.PI;
  });
}
