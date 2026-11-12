// Le découpage (module pur) : la boucle est filmée en plans, montés cut.
//
// Un plan par manœuvre : il commence un quart de seconde après que la machine
// s'est mise en route (raccord dans le mouvement) et dure jusqu'au même
// instant de la manœuvre suivante — la manœuvre, puis la tenue qui la suit.
//
//   large   : la machine entière, sur l'axe de la recette ; c'est le plan de la
//             dernière manœuvre (le retour à la chaîne pendante), qui enjambe
//             le raccord de la boucle : u = 0 et u = 1 sont le même plan.
//   moyen   : avant le temps fort, la chaîne et son support, vus de l'autre
//             côté, un peu plus bas ;
//   héros   : le temps fort (la manœuvre qui arrive au tout-debout, au ralenti)
//             en légère contre-plongée, focale un peu plus longue ; pendant
//             la tenue au sommet, la caméra s'avance sur la chaîne debout ;
//   contre  : après le temps fort, le contrechamp du plan moyen.
//
// Chaque plan cadre ce que la chaîne balaie réellement pendant sa durée (les
// poses du film, échantillonnées), et glisse lentement (azimut, distance) :
// pas deux plans fixes de suite. La caméra ne dépend que de la recette, du
// film et de la phase : la boucle reste parfaite, l'export image par image
// aussi. Sans montage (camera.cuts = false) : un seul plan large qui se
// balance, comme avant.
import { poseOf, layoutOf } from './gen/pose.js';

const { sin, cos, tan, PI, abs, max, min, asin } = Math;
export const LEAD = 0.25; // (s : le plan change après que le mouvement a commencé)
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const MIN_Y = 0.28; // (hauteur minimale de l'objectif : jamais au ras du sol)

// boîte (demi-tailles) de la chaîne entre les instants t0 et t1 du film
function chainBox(R, film, t0, t1, Lay, pad) {
  const M = R.machine, D = film.duration, st = {};
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const extra = M.family === 'wheel' ? M.wheel.r : 0;
  const n = 60;
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    film.at(t / D, st);
    for (const p of poseOf(M, st.theta, st.s, Lay).joints) for (let a = 0; a < 3; a++) { lo[a] = min(lo[a], p[a]); hi[a] = max(hi[a], p[a]); }
  }
  // (le volant déborde du bout de la chaîne)
  for (let a = 0; a < 2; a++) { lo[a] -= extra; hi[a] += extra; }
  return { c: lo.map((v, a) => (v + hi[a]) / 2), h: lo.map((v, a) => (hi[a] - v) / 2 + pad) };
}

export function planShots(R, film, E) {
  const D = film.duration, C = R.camera, M = R.machine, Lay = layoutOf(M);
  const seq = R.film.seq, k = seq.length;
  const top = seq.findLastIndex((c) => !c.includes('D'));
  const moves = film.steps.filter((s) => s.kind === 'move');
  const climax = moves.findIndex((m) => (m.i + 1) % k === top);
  const topHold = film.steps.find((s) => s.kind === 'hold' && s.i === top);
  const side = C.az >= 0 ? 1 : -1;
  const pad = 0.08;
  // le plan large : la machine entière (comme le cadrage d'origine)
  const wide = { c: [0, E.h * 0.5, 0.1], h: [E.w * 0.56, E.h * 0.6, E.w * 0.2] };
  const topBox = topHold ? chainBox(R, film, topHold.t0, topHold.t0 + topHold.dur, Lay, pad + 0.05) : null;

  let shots;
  if (C.cuts === false || moves.length < 2) {
    shots = [{ type: 'wide', t0: 0, t1: D, box: wide }];
  } else {
    shots = moves.map((m, j) => {
      const type = j === climax ? 'hero' : j === moves.length - 1 ? 'wide' : j < climax ? 'medium' : 'reverse';
      const t0 = m.t0 + LEAD, t1 = (j + 1 < moves.length ? moves[j + 1].t0 : moves[0].t0 + D) + LEAD;
      return { type, t0, t1 };
    });
    // (deux plans de même type qui se suivent n'en font qu'un : pas de faux raccord)
    shots = shots.reduce((acc, s) => { const p = acc[acc.length - 1]; if (p && p.type === s.type) p.t1 = s.t1; else acc.push(s); return acc; }, []);
    for (const s of shots) {
      if (s.type === 'wide') { s.box = wide; continue; }
      const b = chainBox(R, film, s.t0, s.t1, Lay, pad);
      // (le moyen garde le haut du bâti, pour situer la chaîne sur sa machine)
      if (s.type !== 'hero') { const yLo = min(b.c[1] - b.h[1], E.H - 0.12); const yHi = b.c[1] + b.h[1]; b.c[1] = (yLo + yHi) / 2; b.h[1] = (yHi - yLo) / 2; }
      s.box = b;
    }
  }
  // (axes : au moins 30° entre deux plans qui se suivent — large, moyen d'un
  // côté, héros de l'autre, contrechamp de nouveau du premier côté —, sans
  // quoi le raccord est un saut sur place)
  shots.forEach((s, j) => {
    s.dir = j % 2 ? -1 : 1; // (sens du glissement : alterné d'un plan à l'autre)
    if (s.type === 'wide') { s.az = C.az; s.el = C.el; s.fov = C.fov; s.dist = C.dist; }
    else if (s.type === 'medium') { s.az = C.az + side * 0.5; s.el = C.el * 0.5 + 0.02; s.fov = C.fov; s.dist = 1.08; }
    else if (s.type === 'reverse') { s.az = C.az + side * 0.62; s.el = C.el * 0.6 + 0.03; s.fov = C.fov; s.dist = 1.08; }
    else { s.az = C.az - side * 0.55; s.el = -0.07; s.fov = C.fov * 0.88; s.dist = 1.04; }
  });

  // 0 → 1 → 0 autour de la tenue au sommet (périodique)
  function topBump(tf) {
    if (!topHold) return 0;
    // (montée en 3,5 s, qui finit peu après l'arrivée ; retour en 2 s)
    const a = topHold.t0 - 2.8, b = topHold.t0 + topHold.dur + 1.8;
    return sm((tf - a) / 3.5) * (1 - sm((tf - (b - 2)) / 2));
  }
  const find = (tf) => {
    for (let j = 0; j < shots.length; j++) {
      const s = shots[j];
      for (const t of [tf, tf + D, tf - D]) if (t >= s.t0 && t < s.t1) return { j, s, x: (t - s.t0) / (s.t1 - s.t0) };
    }
    return { j: 0, s: shots[0], x: 0 };
  };

  function at(ph, aspect, out) {
    const tf = (ph - Math.floor(ph)) * D;
    const { s, x } = find(tf);
    const single = shots.length === 1;
    // avancée au sommet : vers la chaîne debout (plan large unique ou plan héros)
    // (plan héros : la moitié du chemin seulement — il cadre déjà la chaîne,
    // une avancée entière serait un travelling de plusieurs mètres)
    const kTop = (single || s.type === 'hero') && topBox ? topBump(tf) * min(1, C.push / 0.25) * (single ? 1 : 0.55) : 0;
    const B = kTop > 0 ? { c: s.box.c.map((v, a) => v + (topBox.c[a] - v) * kTop), h: s.box.h.map((v, a) => v + (topBox.h[a] - v) * kTop) } : s.box;
    const fov = (s.fov * PI) / 180, t = tan(fov / 2);
    const az = single ? s.az + C.sway * sin(2 * PI * ph) : s.az + s.dir * C.sway * 1.6 * (x - 0.5);
    const hw = abs(B.h[0] * cos(az)) + abs(B.h[2] * sin(az));
    // (la distance de la recette ne resserre que le plan large ; au sommet, la chaîne entière)
    const dk = s.type === 'wide' ? s.dist + (1 - s.dist) * kTop : s.dist * (1.03 - 0.06 * x);
    const d = max(B.h[1] / t, hw / (t * aspect)) * dk + B.h[2];
    let el = s.el;
    if (B.c[1] + sin(el) * d < MIN_Y) el = asin((MIN_Y - B.c[1]) / d);
    out.position.set(B.c[0] + sin(az) * cos(el) * d, B.c[1] + sin(el) * d, B.c[2] + cos(az) * cos(el) * d);
    out.target.set(B.c[0], B.c[1], B.c[2]);
    out.fov = s.fov;
    out.shot = shots.indexOf(s);
    // (distance du plan large : la brume, réelle, ne dépend pas du plan)
    const tw = tan((C.fov * PI) / 360);
    out.ref = max(wide.h[1] / tw, (abs(wide.h[0] * cos(C.az)) + abs(wide.h[2] * sin(C.az))) / (tw * aspect)) * C.dist + wide.h[2];
    return out;
  }
  return { shots, at, index: (ph) => find((ph - Math.floor(ph)) * D).j, topBump };
}
