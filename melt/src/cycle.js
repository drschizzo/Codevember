// Le cycle du bain de bismuth (fonctions pures, Node et navigateur). Une seule
// horloge, t ∈ [0, 1) :
//
// - 0 – T0 : le miroir ; sous lui, les cristaux ont poussé pendant que le métal
//   refroidissait ;
// - T0 – T1 : on vide le bain (c'est ainsi qu'on récolte le bismuth) : les
//   cristaux sortent, le haut d'abord, et s'oxydent dès qu'ils touchent l'air ;
// - T1 – T2 : le bain bas, les couleurs mûrissent ;
// - T2 – T3 : la fonte. Le creuset chauffe par le bas, la croûte du fond fond
//   sous la grappe, et la grappe descend dans son bain, qui ne bouge pas. Le
//   métal chaud fond les cristaux par leur ligne de flottaison ; un cristal
//   dont la taille a fondu se tasse. La forme des cristaux vient de la
//   simulation (melt/model.js, scene/melt.js), relue ici par le tassement et
//   par l'instant où il ne reste plus rien au-dessus du bain ;
// - T3 – T4 : les peaux d'oxyde des cristaux engloutis flottent et se défont ;
// - T4 – T5 : le bain se remplit (le miroir monte, rien ne dépasse) ; à t = 1,
//   la grappe a repoussé sous lui : l'état est celui de t = 0.
import { createRng } from '../../shared/rng.js';
import { PHYS, bathAt } from './melt/model.js';

export const CYCLE = { LH: 2.9, LL: 0.22, T0: 0.03, T1: 0.27, T2: 0.47, T3: 0.83, T4: 0.88, T5: 0.96 };
// La boucle affichée commence au milieu du cycle (les cristaux sortis, leurs
// couleurs qui mûrissent) : la première image, la vignette, montre le sujet
// et non un miroir vide. Le cycle garde son origine (le bain plein).
export const SHIFT = 0.4;
export const cycleT = (ph) => { const t = ph + SHIFT; return t - Math.floor(t); };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sm = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

// le niveau du bain (repère du monde)
export function level(t, C = CYCLE) {
  if (t < C.T0) return C.LH;
  if (t < C.T1) return C.LH + (C.LL - C.LH) * (t - C.T0) / (C.T1 - C.T0);
  if (t < C.T4) return C.LL;
  return C.LL + (C.LH - C.LL) * sm(C.T4, C.T5, t);
}
// le temps de la fonte : 0 au début de la descente, 1 à la fin
export const meltU = (t, C = CYCLE) => (t - C.T2) / (C.T3 - C.T2);
// la descente commune de la grappe (la croûte qui fond), sans le tassement propre à chaque cristal
export const descent = (t, C = CYCLE) => (C.LH - C.LL) * Math.pow(clamp01(meltU(t, C)), PHYS.rise);
// instant où le métal à la hauteur y (repère du cristal) sort du bain qu'on vide
export const emerge = (y, C = CYCLE) => C.T0 + clamp01((C.LH - y) / (C.LH - C.LL)) * (C.T1 - C.T0);
// instant où la ligne du bain atteint la hauteur y du cristal pendant la descente (sans tassement)
export const reach = (y, C = CYCLE) => C.T2 + Math.pow(clamp01((y - C.LL) / (C.LH - C.LL)), 1 / PHYS.rise) * (C.T3 - C.T2);
// la chaleur de la fonte (0 hors de la fonte, 1 pendant)
export const rising = (t, C = CYCLE) => sm(C.T2, C.T2 + 0.03, t) * (1 - sm(C.T3, C.T3 + 0.04, t));

// ── La grappe : des trémies posées sur la croûte du fond, sans s'interpénétrer
// trop (une trémie peut en pénétrer une autre : ce sont des cristaux maclés) ──
export function buildCluster(seed, { count = 9, scale = 1, spread = 1 } = {}) {
  const rng = createRng(seed).fork('cluster');
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < 400) {
    const big = out.length === 0;
    const s = (big ? rng.range(0.85, 1.05) : rng.range(0.25, 0.75)) * scale;
    const r = big ? 0 : rng.range(0.9, 2.9) * spread * scale;
    const a = rng.range(0, Math.PI * 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < (c.s + s) * 0.95)) continue;
    out.push({
      x, z, s, y: s * rng.range(0.55, 0.98), // centre : posé, plus ou moins enfoncé dans la croûte (jamais au-dessus)
      ang: rng.range(0, Math.PI), tilt: rng.range(-0.3, 0.3), ox: rng.range(0, 1), seed: rng.range(0, 50),
      lean: rng.pick([-1, 1]), corner: [rng.pick([-1, 1]), rng.pick([-1, 1])],
    });
  }
  return out;
}

// La marée de la grappe : on vide le bain depuis juste au-dessus du plus haut
// cristal, et la fonte fait descendre la grappe d'autant (D = LH − LL)
export function topOf(c) { const a = Math.abs(c.tilt); return c.y + c.s * (Math.cos(a) + Math.sin(a)); }
export function tideFor(cluster, C = CYCLE) {
  const top = Math.max(...cluster.map(topOf));
  return { ...C, LH: Math.max(top + 0.14, C.LL + 0.8) };
}

// le tassement d'un cristal à l'instant u de la fonte (données de la simulation)
function dropOf(m, u) {
  if (!m || u <= 0) return 0;
  const x = Math.min(u / m.dt, m.steps), i = Math.floor(x), f = x - i;
  return i >= m.steps ? m.drop[m.steps] : m.drop[i] * (1 - f) + m.drop[i + 1] * f;
}

// La bascule : quand la section au ras du bain a fondu (l'encoche de la
// ligne de flottaison), la partie haute n'est plus portée que d'un côté, celui
// qui regarde le centre de la grappe. Elle pivote sur ce bord : son côté
// extérieur tombe dans le bain, en accélérant (son centre de gravité descend :
// pivoter sur le bord extérieur le ferait monter, comme un levier), rebondit à
// peine, s'enfonce presque à fleur (le bismuth solide flotte à
// peine sur le liquide : 9,8 contre 10,05 g/cm³), et y fond tout entière avant
// la fin de la fonte. Le pied reste sur la croûte et fond avec le bain.
export function toppleOf(c, m, u, C = CYCLE) {
  if (!m || !(m.uSettle > 0) || u <= m.uSettle) return null;
  const uS = m.uSettle, x = (u - uS) / 0.06;
  const r = (k) => { const v = Math.sin(c.seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  const amax = 0.5 + 0.35 * r(1);
  const fall = x < 1 ? x * x : 1 + 0.08 * Math.exp(-2.5 * (x - 1)) * Math.sin(5 * (x - 1));
  let dx = c.x, dz = c.z; const l = Math.hypot(dx, dz);
  if (l < 0.2) { dx = Math.cos(c.seed); dz = Math.sin(c.seed); } else { dx /= l; dz /= l; }
  const dur = Math.max(0.15, Math.min(0.45, 1.08 - uS - 0.05));
  return {
    dir: [dx, dz], angle: amax * fall,
    neck: bathAt(uS, C.LL, C.LH - C.LL) + dropOf(m, uS),
    pivot: -0.85 * c.s, sink: 0.6 * c.s * sm(0.8, 2.5, x),
    shrink: 1.9 * c.s * Math.pow(Math.min(Math.max((u - uS - 0.05) / dur, 0), 1), 1.3),
  };
}

// L'appareillage, ce qui cause chaque temps du cycle (cm, repère du creuset) :
// - on vide le bain par le fond : la quenouille, la tige qui bouche le trou
//   de coulée, se lève ; un tourbillon se creuse autour d'elle ;
// - le brûleur s'allume sous le creuset avant la fonte, s'éteint après ;
// - on remplit : un filet de métal tombe d'une louche, hors champ, en haut.
// stream : head, le bas du filet (son front qui tombe) ; tail, son haut.
export function apparatusAt(t, C = CYCLE, duration = 40) {
  const drain = sm(C.T0 - 0.005, C.T0 + 0.015, t) * (1 - sm(C.T1 - 0.015, C.T1 + 0.005, t));
  const top = 60, g = 981 / 2; // (cm, cm/s² : la chute libre du filet)
  const tS = C.T4 - 0.012, tE = C.T5;
  let head = 1e4, tail = -1e4, r = 0;
  if (t > tS && t < tE + 0.02) {
    const a = (t - tS) * duration, b = (t - tE) * duration;
    head = Math.max(top - g * a * a, -5); // (le front du filet ; une fois au bain, le filet le rejoint)
    tail = b > 0 ? top - g * b * b : top; // (le haut du filet : la louche, puis sa queue qui tombe)
    r = tail < C.LL - 0.5 ? 0 : 0.13;
  }
  return {
    drain, lift: 0.3 * drain,
    stream: { head, tail, r },
    flame: sm(C.T2 - 0.035, C.T2 - 0.012, t) * (1 - sm(C.T3, C.T3 + 0.03, t)),
  };
}

// État de chaque cristal à l'instant t : sa descente (la croûte + son
// tassement), l'âge de sa peau d'oxyde sur le bain, la ride de son tassement.
// melt : les résultats de la simulation (un par cristal), ou rien (tests).
export function crystalsAt(cluster, t, C = CYCLE, melt = null) {
  const u = meltU(t, C), base = descent(t, C);
  return cluster.map((c, i) => {
    const m = melt?.[i];
    const desc = base + dropOf(m, u);
    // la peau : quand il ne reste plus rien du cristal au-dessus du bain
    const tGone = m ? C.T2 + m.uGone * (C.T3 - C.T2) : reach(topOf(c) + 0.05, C);
    const skinAge = t - tGone;
    // la ride : quand les restes s'effondrent dans le bain (ou, à défaut, quand le bloc se tasse)
    const uR = m ? (m.uPlunge > 0 ? m.uPlunge : m.uSettle) : -1;
    const tSet = uR > 0 ? C.T2 + uR * (C.T3 - C.T2) : -1;
    const rip = tSet > 0 ? t - tSet : -1;
    return {
      x: c.x, y: c.y, z: c.z, s: c.s, ang: c.ang, tilt: c.tilt, ox: c.ox, seed: c.seed, desc,
      topple: toppleOf(c, m, u, C),
      skin: skinAge > 0 && skinAge < 0.14 ? skinAge : -1,
      ripple: rip > 0 && rip < 0.07 ? { x: c.x, z: c.z, dt: rip } : null,
    };
  });
}
