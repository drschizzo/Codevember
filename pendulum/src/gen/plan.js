// Résolution d'une transition de la recette (module pur, exécuté dans un
// worker) : essais successifs, déterministes, jusqu'au premier qui converge
// en respectant les limites de la machine (course du rail, accélération du
// moteur, vitesse du volant). L'ordre des essais est fixé : même recette,
// même trajectoire, quel que soit le nombre de workers.
import { systemOf, physicsOf, FAMILIES } from './machines.js';
import { makeSystem } from './dynamics.js';
import { solveTransition } from './shoot.js';
import { LIBRARY } from './library.js';
import { REF3 } from './reference.js';
import { movesOf } from '../film.js';

export function limitsOf(M) {
  switch (M.family) {
    case 'cart': return { s: M.rail.half - 0.06, u: 45 };
    case 'rotary': return { s: 2.6, u: 400 };
    case 'acrobat': return { s: 7.5, u: 120 };
    case 'wheel': return { s: 1e9, u: 2500, sd: 160 };
    default: return { s: 1e9, u: 1e9 };
  }
}

// essais : [multiplicateur de durée, sens inversés ?, β ×]
// (un essai qui converge hors des limites, ou presque, sert de départ à chaud
// au suivant de même sens : continuation en durée et en poids de la course)
const TRIES = [[1, 0, 1], [1.15, 0, 1], [1.3, 0, 3], [1, 1, 1], [1.15, 1, 2], [1.5, 0, 4], [1.3, 1, 4], [1.7, 0, 6], [1.5, 1, 6], [0.9, 0, 1], [1.9, 0, 8], [1.9, 1, 8]];

// Chaîne triple : départ depuis la bibliothèque (machine de référence), puis
// continuation : les masses et longueurs glissent de la référence vers
// celles de la graine en quelques pas, chaque pas partant du précédent.
function fromLibrary(R, mv, onProgress, onIter) {
  const lib = LIBRARY[`${mv.from}-${mv.to}`];
  if (!lib?.length) return null;
  const M = R.machine, P1 = physicsOf(M), P0 = physicsOf(REF3), lim = limitsOf(M);
  // (le sens de la recette d'abord, puis les autres, des moins coûteux aux plus coûteux)
  const order = [...lib].sort((a, b) => (b.signs.join() === mv.signs.join()) - (a.signs.join() === mv.signs.join()) || a.cost - b.cost);
  const steps = [0.25, 0.5, 0.75, 1];
  for (let e = 0; e < order.length; e++) {
    const E = order[e];
    let warm = { z: Float64Array.from(E.z), T: E.T }, r = null, sys = null;
    for (let k = 0; k < steps.length; k++) {
      const lam = steps[k];
      const links = P0.links.map((a, j) => { const b = P1.links[j]; return { l: a.l + (b.l - a.l) * lam, c: a.c + (b.c - a.c) * lam, m: a.m + (b.m - a.m) * lam, J: a.J + (b.J - a.J) * lam }; });
      sys = makeSystem({ kind: 'cart', links });
      const th1 = mv.th0.map((t, j) => t + E.signs[j] * Math.PI);
      r = solveTransition(sys, { T: E.T, X0: sys.restState(mv.th0), X1: sys.restState(th1), N: 80, S: 16, alpha: 1, beta: 60, warm, onIter: onIter ? (it) => onIter({ ...it, k: e, T: E.T, sys }) : null });
      onProgress?.((e + (k + 1) / steps.length) / order.length);
      if (!r.ok) break;
      warm = { z: r.z, T: E.T };
    }
    if (!r?.ok) continue;
    const tab = r.record();
    const sMax = Math.max(-r.sMin, r.sMax);
    if (sMax > lim.s || r.uMax > lim.u) continue;
    return { ok: true, tab, T: E.T, signs: E.signs, attempt: 100 + e, cn: r.cn, cost: r.cost, it: r.it, sMax, sdMax: 0, uMax: r.uMax };
  }
  return null;
}

export function solveMove(R, i, onProgress = null, onIter = null) {
  const M = R.machine, sys = systemOf(M), F = FAMILIES[M.family], lim = limitsOf(M);
  const mv = movesOf(R)[i];
  const n = M.links.length;
  if (n === 3 && M.family === 'cart') {
    const r = fromLibrary(R, mv, onProgress, onIter);
    if (r) return r;
  }
  const N = n >= 3 || M.family === 'acrobat' ? 80 : 60, S = n >= 3 || M.family === 'acrobat' ? 16 : 12;
  let last = null;
  const warmOf = [null, null];
  for (let k = 0; k < TRIES.length; k++) {
    const [tm, flip, bm] = TRIES[k];
    const signs = flip ? mv.signs.map((s) => -s) : mv.signs;
    const th1 = mv.th0.map((t, j) => (mv.turn ? t + signs[j] * 2 * Math.PI : mv.from[j] === mv.to[j] ? t : t + signs[j] * Math.PI));
    const X0 = sys.restState(mv.th0), X1 = sys.restState(th1);
    let seed = 1 + i * 7919 + k * 104729;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const T = mv.T * tm;
    const r = solveTransition(sys, {
      T, X0, X1, N, S, K: 6, alpha: F.weights.alpha, beta: F.weights.beta * bm, rng,
      onIter: onIter ? (it) => onIter({ ...it, k, T, sys }) : null, warm: warmOf[flip],
    });
    onProgress?.((k + 1) / TRIES.length);
    if (r.ok || (r.cn < 0.05 && (!warmOf[flip] || r.cn < warmOf[flip].cn))) warmOf[flip] = { z: r.z, T, cn: r.cn };
    if (!r.ok) { last = r; continue; }
    const tab = r.record();
    // limites (sur la table : tous les pas d'intégration)
    let sMax = 0, sdMax = 0, uMax = 0;
    const np = sys.np;
    for (let m = 0; m < tab.M; m++) {
      const o = m * tab.nx;
      sMax = Math.max(sMax, Math.abs(tab.X[o + 2 * np] - (X0[2 * np] + X1[2 * np]) / 2) - Math.abs(X1[2 * np] - X0[2 * np]) / 2);
      sdMax = Math.max(sdMax, Math.abs(tab.X[o + 2 * np + 1]));
      uMax = Math.max(uMax, Math.abs(tab.U[m]));
    }
    const ok = sMax <= lim.s && uMax <= lim.u && sdMax <= (lim.sd ?? Infinity);
    if (!ok) { last = { ...r, why: { sMax, sdMax, uMax } }; continue; }
    return { ok: true, tab, T, signs, attempt: k, cn: r.cn, cost: r.cost, it: r.it, sMax, sdMax, uMax };
  }
  return { ok: false, why: last?.why ?? { cn: last?.cn } };
}
