// Le cycle du bain de bismuth (fonctions pures, Node et navigateur). Une seule
// horloge, t ∈ [0, 1). Le métal ne quitte jamais la marmite : les cristaux ont
// poussé sur une grille d'acier posée au fond, que deux câbles sortent du bain
// puis y replongent.
//
// - 0 – T0 : le miroir ; la grille est au fond, la grappe a repoussé sous le
//   bain qui refroidit ;
// - T0 – T1 : la récolte. Les câbles lèvent la grille : les cristaux sortent du
//   bain, le haut d'abord, et s'oxydent dès qu'ils touchent l'air ;
// - T1 – T2 : la grappe suspendue au-dessus du bain, les couleurs mûrissent ;
//   le brûleur s'allume ;
// - T2 – T3 : la fonte, par paliers. Le cadre abaisse la grappe jusqu'à ce que
//   le bain la prenne d'un quart de sa hauteur, puis s'arrête : le bain ronge
//   les cristaux sur place (l'encoche de la ligne de flottaison, les parois
//   minces, les blocs qui basculent). Puis un cran de plus, et ainsi de suite.
//   La forme des cristaux vient de la simulation (melt/model.js,
//   scene/melt.js), relue ici par le tassement et par l'instant où il ne
//   reste plus rien au-dessus du bain ;
// - T3 – 1 : la grille vide regagne le fond ; les peaux d'oxyde des cristaux
//   engloutis flottent et se défont ; le brûleur s'éteint, le bain refroidit
//   et se couvre d'une peau d'oxyde irisée (cool), que la grille déchire en
//   ressortant.
//
// Deux repères : celui de la grappe (y = 0 : la grille) et le
// monde, où le bain est fixe, à LB. ℓ(t) est la ligne du bain vue de la
// grappe : LH au repos (tout est couvert), LOW suspendue (la grille est
// au-dessus du bain). La grappe est à la hauteur o(t) = LB − ℓ(t) dans le monde.
import { createRng } from '../../shared/rng.js';
import { PHYS, bathAt } from './melt/model.js';

export const CYCLE = { LH: 2.9, LB: 0.22, LOW: -0.3, T0: 0.01, T1: 0.2, T2: 0.32, T3: 0.94 };
// La boucle affichée commence pendant l'attente (les cristaux sortis, leurs
// couleurs qui mûrissent) : la première image, la vignette, montre le sujet
// et non un miroir vide. Le cycle garde son origine (le bain plein).
export const SHIFT = 0.26;
export const cycleT = (ph) => { const t = ph + SHIFT; return t - Math.floor(t); };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sm = (a, b, x) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

// le niveau du bain (monde) : il ne bouge pas
export const level = (t, C = CYCLE) => C.LB;
// le temps de la fonte : 0 au début de la descente, 1 à la fin
// (C.UM : la part du temps de la simulation que la fonte montre ; voir setMeltEnd)
export const meltU = (t, C = CYCLE) => (t - C.T2) / (C.T3 - C.T2) * (C.UM ?? 1);
// La fonte s'arrête quand le dernier cristal a disparu sous le bain : son temps
// est calé sur la simulation (le plus tardif de ses uGone). Sans cela, une grappe
// qui fond vite laissait un bain vide pendant les derniers paliers. Ensuite, la
// grille vide regagne le fond en SINK. La valeur, connue après la simulation,
// est rangée par graine pour que la caméra (camera.js) suive la même grille.
export const SINK = 0.035;
const ENDS = new Map();
export const setMeltEnd = (key, um) => { ENDS.set(key, um); };
export const meltEnd = (key) => ENDS.get(key) ?? 1;
export const meltEndOf = (crystals) => Math.min(1, Math.max(0.35, Math.max(...crystals.map((m) => m.uGone)) + 0.02));
// la ligne du bain vue de la grappe, sans le tassement propre à chaque cristal
export function line(t, C = CYCLE) {
  if (t < C.T0) return C.LH;
  if (t < C.T1) return C.LH + (C.LOW - C.LH) * (t - C.T0) / (C.T1 - C.T0); // (la levée, à vitesse constante)
  if (t < C.T2) return C.LOW;
  if (t < C.T3) return bathAt(meltU(t, C), C.LOW, C.LH - C.LOW);
  const l3 = bathAt(C.UM ?? 1, C.LOW, C.LH - C.LOW);
  return l3 + (C.LH - l3) * sm(C.T3, C.T3 + SINK, t); // (la grille vide regagne le fond)
}
// la hauteur de la grappe dans le monde
export const lift = (t, C = CYCLE) => C.LB - line(t, C);
// instant où le métal à la hauteur y (repère de la grappe) sort du bain
export const emerge = (y, C = CYCLE) => C.T0 + clamp01((C.LH - y) / (C.LH - C.LOW)) * (C.T1 - C.T0);
// instant où la ligne du bain atteint la hauteur y pendant la fonte (sans tassement)
export function reach(y, C = CYCLE) {
  if (y <= C.LOW) return C.T2;
  let lo = C.T2, hi = C.T3 + SINK;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (line(m, C) < y) lo = m; else hi = m; }
  return hi;
}
// la peau du bain qui refroidit : elle se forme après la fonte, couvre le
// bain au repos, et la grille qui sort la déchire du centre vers les bords
// (0 : bain nu ; 1 : peau entière ; tear : rayon de la déchirure, en part du bain)
export function cool(t, C = CYCLE) {
  if (t < C.T0) return { cover: 1, tear: 0 };
  if (t < C.T1) return { cover: 1, tear: Math.pow((t - C.T0) / (C.T1 - C.T0), 0.7) * 1.15 };
  return { cover: sm(C.T3 + 0.03, 0.99, t), tear: 0 };
}
// la chaleur de la fonte (0 hors de la fonte, 1 pendant)
export const rising = (t, C = CYCLE) => sm(C.T2, C.T2 + 0.03, t) * (1 - sm(C.T3, C.T3 + 0.04, t));

// le rayon des fils de la grille (cm) : les cristaux reposent dessus
export const GRID_WIRE = 0.02;

// ── La grappe : des trémies posées sur la grille du fond, sans s'interpénétrer
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
    // (les tirages gardent leur ordre : une graine donne la même grappe qu'avant,
    // à la hauteur près)
    rng.range(0.55, 0.98);
    const ang = rng.range(0, Math.PI), tilt = 0.5 * rng.range(-0.3, 0.3);
    // posé SUR la grille : son point le plus bas (le cube incliné) repose sur les
    // fils, sans les traverser ; l'inclinaison reste faible, un cristal ne la
    // touche pas que d'une arête en équilibre
    const at = Math.abs(tilt), y = s * (Math.cos(at) + Math.sin(at)) + GRID_WIRE;
    out.push({
      x, z, s, y, ang, tilt, ox: rng.range(0, 1), seed: rng.range(0, 50),
      lean: rng.pick([-1, 1]), corner: [rng.pick([-1, 1]), rng.pick([-1, 1])],
    });
  }
  return out;
}

// La marée de la grappe : au repos, le bain couvre son plus haut cristal de 0,14 cm
export function topOf(c) { const a = Math.abs(c.tilt); return c.y + c.s * (Math.cos(a) + Math.sin(a)); }
export function tideFor(cluster, C = CYCLE) {
  const top = Math.max(...cluster.map(topOf));
  return { ...C, LH: Math.max(top + 0.14, 1) };
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
// peine, s'enfonce jusqu'à n'en laisser dépasser que des bribes (le bismuth solide flotte à
// peine sur le liquide : 9,8 contre 10,05 g/cm³), et y fond tout entière avant
// la fin de la fonte. Le pied reste sur la grille et fond avec le bain.
export function toppleOf(c, m, u, C = CYCLE) {
  if (!m || !(m.uSettle > 0) || u <= m.uSettle) return null;
  const uS = m.uSettle, x = (u - uS) / 0.06;
  const r = (k) => { const v = Math.sin(c.seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  const amax = 0.5 + 0.35 * r(1);
  const fall = x < 1 ? x * x : 1 + 0.08 * Math.exp(-2.5 * (x - 1)) * Math.sin(5 * (x - 1));
  let dx = c.x, dz = c.z; const l = Math.hypot(dx, dz);
  if (l < 0.2) { dx = Math.cos(c.seed); dz = Math.sin(c.seed); } else { dx /= l; dz /= l; }
  const dur = Math.max(0.12, Math.min(0.28, 1.08 - uS - 0.05));
  return {
    dir: [dx, dz], angle: amax * fall,
    neck: bathAt(uS, C.LOW, C.LH - C.LOW) + dropOf(m, uS),
    pivot: -0.85 * c.s, sink: 1.1 * c.s * sm(0.6, 2.2, x),
    shrink: 1.9 * c.s * Math.pow(Math.min(Math.max((u - uS - 0.05) / dur, 0), 1), 1.3),
  };
}

// L'appareillage, ce qui cause chaque temps du cycle : le cadre de levage
// (sa hauteur est celle de la grappe), et le brûleur, allumé pendant
// l'attente, avant que la grappe ne redescende, éteint après la fonte.
export function apparatusAt(t, C = CYCLE) {
  return {
    lift: lift(t, C),
    flame: sm(C.T2 - 0.06, C.T2 - 0.03, t) * (1 - sm(C.T3, C.T3 + 0.03, t)),
  };
}

function skinOf(t, tGone) {
  const life = Math.min(0.11, 0.995 - tGone);
  if (life < 0.02) return -1;
  const a = (t - tGone) / life;
  return a > 0 && a < 1 ? a * 0.11 : -1;
}

// État de chaque cristal à l'instant t : sa hauteur (celle de la grille, moins
// son tassement), l'âge de sa peau d'oxyde sur le bain, la ride de son tassement.
// melt : les résultats de la simulation (un par cristal), ou rien (tests).
export function crystalsAt(cluster, t, C = CYCLE, melt = null) {
  const u = meltU(t, C), o = lift(t, C);
  return cluster.map((c, i) => {
    const m = melt?.[i];
    // (desc : de combien le repère de la grappe est sous le monde, tassement compris)
    const desc = dropOf(m, u) - o;
    // la peau : quand il ne reste plus rien du cristal au-dessus du bain
    const toT = (uu) => C.T2 + uu / (C.UM ?? 1) * (C.T3 - C.T2);
    const tGone = m ? toT(m.uGone) : reach(topOf(c) + 0.05, C);
    const skinAge = t - tGone;
    // la ride : quand les restes s'effondrent dans le bain (ou, à défaut, quand le bloc se tasse)
    const uR = m ? (m.uPlunge > 0 ? m.uPlunge : m.uSettle) : -1;
    const tSet = uR > 0 ? toT(uR) : -1;
    const rip = tSet > 0 ? t - tSet : -1;
    return {
      x: c.x, y: c.y, z: c.z, s: c.s, ang: c.ang, tilt: c.tilt, ox: c.ox, seed: c.seed, desc,
      topple: toppleOf(c, m, u, C),
      // (la peau vit 0,11 boucle, moins si le cristal disparaît tard : elle doit
      // être défaite avant la fin de la boucle, sinon elle sauterait au raccord ;
      // son âge est ramené sur 0,11 pour qu'elle se défasse en entier)
      skin: skinOf(t, tGone),
      ripple: rip > 0 && rip < 0.07 ? { x: c.x, z: c.z, dt: rip } : null,
    };
  });
}
