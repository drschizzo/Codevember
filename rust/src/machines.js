// Les machines qui remettent la pièce à nu : leur trajectoire, et pour chaque
// point de la surface l'instant exact où l'outil l'atteint. Même formules dans
// le shader (scene/rust.js) ; ce module est pur (Node : tests).
//
//  - laser   : un portique roule devant la pièce ; la tête balaie une ligne
//              verticale de hauteur w (miroir galvanométrique) et parcourt la
//              pièce en rangées, de haut en bas, en boustrophédon. Les rangées
//              ne couvrent que la largeur de la pièce à leur hauteur.
//  - sablage : la pièce tourne sur un plateau (N tours entiers) pendant que la
//              buse descend : le front est une hélice.
//  - bain    : un palan descend la pièce dans une cuve d'électrolyse, la
//              garde, la remonte : le front est le niveau du liquide.
//
// Un point que l'outil n'atteint pas (masqué par une autre partie de la
// pièce, tourné à l'opposé) reste rouillé toute la boucle.
import { sstep } from './timeline.js';

const { PI, floor, ceil, max, min, abs, atan2, hypot, cos, sin } = Math;
export const TAU = 2 * PI;
const mod = (a, b) => a - b * floor(a / b);

export const MACHINES = {
  laser: { label: 'Laser (portique)' },
  sablage: { label: 'Sablage (plateau tournant)' },
  bain: { label: 'Bain d\'électrolyse (palan)' },
};

export function machineParams(kind, rng) {
  switch (kind) {
    case 'laser': return { kind, band: +rng.range(0.075, 0.1).toFixed(3), standoff: 0.2, startLeft: rng.chance(0.5), park: rng.sign() };
    case 'sablage': return { kind, turns: rng.int(6, 9), foot: +rng.range(0.15, 0.19).toFixed(3), tilt: +rng.range(0.22, 0.38).toFixed(2), dir: rng.sign(), side: +(rng.sign() * rng.range(1.6, 1.95)).toFixed(2) };
    case 'bain': return { kind, margin: 0.12, hold: +rng.range(0.32, 0.42).toFixed(2), swing: +rng.range(0.004, 0.009).toFixed(4) };
    default: throw new Error(`machine inconnue : ${kind}`);
  }
}

// ── Laser ────────────────────────────────────────────────────────────────────
// front : carte de profondeur vue de face (gen/corrosion.js) ; lo, hi : boîte
// de la pièce. Les durées des rangées sont proportionnelles à leur largeur ;
// entre deux rangées, la tête descend (faisceau coupé).
export function laserPlan(R, front, lo, hi) {
  const M = R.machine, T = R.timing;
  const yTop = hi[1] + 0.004, yBot = lo[1] - 0.004;
  const n = max(3, Math.round((yTop - yBot) / M.band)), w = (yTop - yBot) / n;
  const rows = [];
  for (let k = 0; k < n; k++) {
    const y1 = yTop - k * w, y0 = y1 - w;
    let x0 = 1e9, x1 = -1e9;
    const j0 = max(0, floor((y0 - front.lo[1]) / front.cell)), j1 = min(front.h - 1, ceil((y1 - front.lo[1]) / front.cell));
    for (let j = j0; j <= j1; j++) for (let i = 0; i < front.w; i++) if (front.data[j * front.w + i] > -999) { const x = front.lo[0] + (i + 0.5) * front.cell; x0 = min(x0, x); x1 = max(x1, x); }
    if (x0 > x1) { x0 = -0.05; x1 = 0.05; }
    x0 -= 0.035; x1 += 0.035;
    const ltr = (k % 2 === 0) === !!M.startLeft;
    rows.push({ y0, y1, xs: ltr ? x0 : x1, xe: ltr ? x1 : x0, t0: 0, t1: 0 });
  }
  // durées (unités arbitraires puis ramenées à la fenêtre du décapage)
  const sweep = rows.map((r) => abs(r.xe - r.xs) + 0.12), step = rows.map((r, k) => (k ? 0.22 + abs(r.xs - rows[k - 1].xe) * 0.4 : 0));
  const total = sweep.reduce((a, b) => a + b, 0) + step.reduce((a, b) => a + b, 0);
  let t = T.clean0;
  const k = (T.clean1 - T.clean0) / total;
  rows.forEach((r, i) => { t += step[i] * k; r.t0 = t; t += sweep[i] * k; r.t1 = t; });
  let zMax = -1e9;
  for (const v of front.data) if (v > zMax) zMax = v;
  return { kind: 'laser', n, w, yTop, yBot, rows, zHead: zMax + M.standoff, xMid: (lo[0] + hi[0]) / 2 };
}
export function frontAt(front, x, y) {
  const i = min(front.w - 1, max(0, floor((x - front.lo[0]) / front.cell))), j = min(front.h - 1, max(0, floor((y - front.lo[1]) / front.cell)));
  return front.data[j * front.w + i];
}
// le faisceau atteint-il le point ? (face tournée vers la tête, ou rasante, et
// non masquée : la profondeur tolérée croît quand l'incidence devient rasante,
// la tête balayant aussi un peu de biais)
export const laserTol = (nz) => 0.012 + 0.16 * Math.max(0, Math.min(1, (0.6 - nz) / 0.6));
export function laserReach(front, p, n) { return n[2] > -0.12 && p[2] >= frontAt(front, p[0], p[1]) - laserTol(n[2]); }
// instant de décapage d'un point (p, n : position et normale dans le repère de la pièce)
export function laserCleanTime(plan, front, p, n) {
  if (!laserReach(front, p, n)) return Infinity;
  const k = floor((plan.yTop - p[1]) / plan.w);
  if (k < 0 || k >= plan.n) return Infinity;
  const r = plan.rows[k];
  const f = max(0, min(1, (p[0] - r.xs) / (r.xe - r.xs)));
  return r.t0 + f * (r.t1 - r.t0);
}
// position de la tête (x, y de la ligne de balayage) et faisceau
export function laserHead(plan, u) {
  const R = plan.rows, last = R[R.length - 1];
  const yc = (r) => (r.y0 + r.y1) / 2;
  if (u <= R[0].t0) return { x: R[0].xs, y: yc(R[0]), on: 0 };
  if (u >= last.t1) return { x: last.xe, y: yc(last), on: 0 };
  for (let k = 0; k < R.length; k++) {
    const r = R[k];
    if (u <= r.t1) {
      if (u >= r.t0) return { x: r.xs + (r.xe - r.xs) * ((u - r.t0) / (r.t1 - r.t0)), y: yc(r), on: 1 };
      const p = R[k - 1], s = sstep(p.t1, r.t0, u);
      return { x: p.xe + (r.xs - p.xe) * s, y: yc(p) + (yc(r) - yc(p)) * s, on: 0 };
    }
  }
  return { x: last.xe, y: yc(last), on: 0 };
}

// pose du portique : il arrive de derrière (tête relevée au-dessus de la
// pièce), la tête descend à la première rangée ; à la fin, l'inverse.
// zb : plan des colonnes ; renvoie { z (décalage du portique), x, y (tête), on }
export function laserRig(R, plan, u, hiY, zb) {
  const T = R.timing, e = (t) => { t = max(0, min(1, t)); return t * t * (3 - 2 * t); };
  const zPark = -3.0 - zb;
  const inA = (u - T.setup0) / (T.clean0 - T.setup0 - 0.004), out = (u - T.clean1 - 0.004) / (T.retract1 - T.clean1 - 0.004);
  const roll = 1 - e(min(1, inA / 0.72)) * (1 - e(max(0, out - 0.28) / 0.72));
  const lift = 1 - e((inA - 0.72) / 0.28) * (1 - e(out / 0.28));
  const h = laserHead(plan, u);
  return { z: zPark * roll, x: h.x, y: h.y + (hiY + 0.22 - h.y) * lift, scanY: h.y, on: h.on, lift };
}

// ── Sablage (plateau tournant) ───────────────────────────────────────────────
// progression s(u) : vitesse constante, montée et descente douces aux bouts
const RAMP = 0.06;
const Iramp = (x) => { const t = x / RAMP; return RAMP * (t * t * t - (t * t * t * t) / 2); };
export function turnS(R, u) {
  const T = R.timing, x = (u - T.clean0) / (T.clean1 - T.clean0);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const tot = 1 - RAMP;
  if (x < RAMP) return Iramp(x) / tot;
  if (x > 1 - RAMP) return 1 - Iramp(1 - x) / tot;
  return (Iramp(RAMP) + (x - RAMP)) / tot;
}
export function turnPlan(R, radial, lo, hi) {
  const M = R.machine;
  let rMax = 0;
  for (const v of radial.data) if (v > rMax) rMax = v;
  const yTop = hi[1] + M.foot * 0.5, yBot = lo[1] - M.foot * 0.25;
  let N = M.turns;
  while ((yTop - yBot) / N > M.foot * 0.75) N++;
  // la colonne se place de côté par rapport à la caméra : on voit le jet de profil
  const az = Math.PI / 2 - R.camera.az + (M.side ?? 1.75);
  return { kind: 'sablage', N, yTop, yBot, rMax, foot: M.foot, tilt: M.tilt, dir: M.dir, az };
}
// angle de la pièce (radians, sens trigonométrique vu de dessus) et hauteur de la buse
export const turnAngle = (plan, s) => plan.dir * TAU * plan.N * s;
export const nozzleY = (plan, s) => plan.yTop - (plan.yTop - plan.yBot) * s;
export function radialAt(radial, phi, y) {
  const a = floor(mod(phi / TAU, 1) * radial.w) % radial.w, j = min(radial.h - 1, max(0, floor((y - radial.y0) / radial.cell)));
  return radial.data[j * radial.w + a];
}
// la face « se tourne vers la buse » : azimut de sa normale horizontale (la
// position pour une face presque horizontale, que le jet incliné touche d'en haut)
export function faceAzimuth(p, n) {
  const nh = hypot(n[0], n[2]), w = sstep(0.12, 0.45, nh), r = hypot(p[0], p[2]) || 1;
  const vx = (n[0] / (nh || 1)) * w + (p[0] / r) * (1 - w), vz = (n[2] / (nh || 1)) * w + (p[2] / r) * (1 - w);
  return atan2(vz, vx);
}
// accès : la face regarde dehors (ou vers le haut, jet incliné) et n'est pas
// masquée dans la direction d'où elle voit la buse (32 cartes de profondeur)
export function turnReach(plan, dirs, p, n) {
  const ph = faceAzimuth(p, n);
  const face = Math.cos(plan.tilt) * hypot(n[0], n[2]) + Math.sin(plan.tilt) * n[1];
  if (face < 0.05) return false;
  const k = ((Math.round((ph / TAU) * dirs.K) % dirs.K) + dirs.K) % dirs.K, a = (k / dirs.K) * TAU;
  const dx = cos(a), dz = sin(a), dep = p[0] * dx + p[2] * dz, lat = -p[0] * dz + p[2] * dx;
  const ci = min(dirs.tw - 1, max(0, floor((lat + dirs.r) / dirs.cell) + 1)), cj = min(dirs.th - 1, max(0, floor((p[1] - dirs.y0) / dirs.cell) + 1));
  return dep >= dirs.data[(floor(k / 8) * dirs.th + cj) * dirs.w + (k % 8) * dirs.tw + ci] - 0.02;
}
// progression s* à laquelle la buse atteint le point (Infinity : jamais) :
// quand la buse est à sa hauteur et que la face se tourne vers elle
export function turnCleanS(plan, dirs, p, n) {
  if (!turnReach(plan, dirs, p, n)) return Infinity;
  const phi = faceAzimuth(p, n);
  const s1 = max(0, (plan.yTop - p[1] - plan.foot / 2) / (plan.yTop - plan.yBot));
  return s1 + mod(plan.dir * (plan.az - phi) - TAU * plan.N * s1, TAU) / (TAU * plan.N);
}

// ── Bain d'électrolyse ───────────────────────────────────────────────────────
export function bathPlan(R, lo, hi, lifts, hookPt = null) {
  const M = R.machine, T = R.timing;
  // fosse d'électrolyse : le rebord affleure le sol, le liquide est juste dessous
  const tank = { hx: (hi[0] - lo[0]) / 2 + M.margin, hz: (hi[2] - lo[2]) / 2 + M.margin, cx: (lo[0] + hi[0]) / 2, cz: (lo[2] + hi[2]) / 2 };
  tank.depth = hi[1] - lo[1] + 0.32;
  const L = -0.09; // niveau du liquide
  const rest = 0.13 - lo[1]; // décalage vertical de la pièce au repos (au-dessus du sol)
  const down = L - 0.07 - hi[1];
  const w = T.clean1 - T.clean0;
  const u = { down0: T.clean0, down1: T.clean0 + w * 0.2, up0: T.clean0 + w * (0.2 + M.hold), up1: T.clean1 };
  const hook = hookPt ?? [(lifts[0][0] + lifts[1][0]) / 2, Math.max(lifts[0][1], lifts[1][1]) + 0.32, (lifts[0][2] + lifts[1][2]) / 2];
  return { kind: 'bain', tank, L, rest, down, u, hook, lid: [T.setup0, T.setup0 + (T.clean0 - T.setup0) * 0.8, T.clean1 + 0.004, T.retract1] };
}
// décalage vertical de la pièce (descente douce, remontée lente et régulière)
export function bathOffset(plan, u) {
  const U = plan.u;
  if (u <= U.down0 || u >= U.up1) return plan.rest;
  if (u < U.down1) return plan.rest + (plan.down - plan.rest) * sstep(U.down0, U.down1, u);
  if (u < U.up0) return plan.down;
  // remontée : vitesse constante, adoucie aux bouts
  const x = (u - U.up0) / (U.up1 - U.up0), a = 0.12;
  const I = (t) => (t < a ? (a * ((t / a) ** 3 - (t / a) ** 4 / 2)) : t > 1 - a ? (1 - a) - a * (((1 - t) / a) ** 3 - ((1 - t) / a) ** 4 / 2) : a / 2 + (t - a));
  return plan.down + (plan.rest - plan.down) * (I(x) / (1 - a));
}
// décapé : remonté au-dessus du niveau pendant la remontée (ou après)
export const bathClean = (plan, p, u) => u >= plan.u.up0 && p[1] + bathOffset(plan, u) > plan.L;

// ── Accès commun ─────────────────────────────────────────────────────────────
// rouille visible à l'instant u, relative à son épaisseur « h(τ(u)) » :
// 1 = intacte, 0 = décapée ; points jamais atteints : toujours 1
export function cleanState(plan, maps, p, n, u, R) {
  if (plan.kind === 'laser') { const t = laserCleanTime(plan, maps.front, p, n); return t === Infinity ? { reached: false, rust: 1 } : { reached: true, rust: u < t ? 1 : 0, t }; }
  if (plan.kind === 'sablage') { const s = turnCleanS(plan, maps.dirs, p, n); if (s === Infinity) return { reached: false, rust: 1 }; const su = turnS(R, u); return { reached: true, rust: 1 - sstep(s, s + 0.35 / (TAU * plan.N), su), s }; }
  return { reached: true, rust: bathClean(plan, p, u) ? 0 : 1 };
}
