// L'eau et les causes, en fonctions fermées du temps physique (module pur,
// partagé par la scène et les tests).
//
// Pour chaque goutte : elle grossit à sa source (accéléré pour la
// condensation, temps réel au bec de la burette), se détache, tombe en chute
// libre, touche (instant exact du plan), s'écrase et éclate en perles qui
// volent (balistique) puis se posent : sur la terre (tache humide), la lèvre,
// la soucoupe ou la table (perle qui s'évapore). La foliole frappée reste
// mouillée un moment.
import { evap, hammerAngle, G } from './physio.js';

const { sin, cos, exp, max, min, sqrt, PI } = Math;

// Δ ramené dans (−P/2, P/2]
export const rel = (tau, t0, P) => { let d = (tau - t0) % P; if (d < 0) d += P; if (d > P / 2) d -= P; return d; };

// eau visible à l'instant τ : liste de sphères { p, s: [sx, sy, sz] }
// (une par goutte, une par perle d'éclaboussure, dans un ordre fixe)
export function waterAt(tau, plan, out = []) {
  let k = 0;
  const put = (x, y, z, sx, sy, sz) => {
    const o = out[k] || (out[k] = { p: [0, 0, 0], s: [0, 0, 0] });
    o.p[0] = x; o.p[1] = y; o.p[2] = z; o.s[0] = sx; o.s[1] = sy; o.s[2] = sz; k++;
  };
  const NONE = 1e-6;
  for (const E of plan.events) {
    if (E.cause !== 'drop') continue;
    const d = rel(tau, E.tc, plan.P);
    // la goutte
    {
      const r = E.r;
      let x = E.axis[0], z = E.axis[1], y, sx = r, sy = r, sz = r;
      if (d < -E.fall) {
        const gr = dropGrowthRel(d, E);
        const re = r * gr;
        // pendue sous la vitre ou le bec : le sommet reste accroché
        y = E.srcY + r - re;
        // elle s'étire juste avant de se détacher
        const st = 1 + 0.16 * max(0, 1 - (-E.fall - d) / 0.25);
        sx = sz = re / sqrt(st); sy = re * st;
        if (re < 1e-4) { sx = sy = sz = NONE; }
      } else if (d <= 0) {
        y = E.yc + 0.5 * G * d * d;
      } else {
        // écrasement : la goutte se vide dans ses perles en quelques ms
        const f = max(0, 1 - d / 0.006);
        y = E.yc - r * (1 - f) * 0.5;
        sx = sz = r * (1 + 0.5 * (1 - f)) * f + NONE; sy = r * f * f + NONE;
      }
      put(x, y, z, sx, sy, sz);
    }
    // les perles
    for (const S of E.splash) {
      if (d < 0 || d > plan.P / 2) { put(S.land[0], S.land[1], S.land[2], NONE, NONE, NONE); continue; }
      if (d < S.t) {
        const g = min(1, d / 0.004); // (elles naissent dans l'écrasement)
        put(S.p0[0] + S.v[0] * d, S.p0[1] + S.v[1] * d - 0.5 * G * d * d, S.p0[2] + S.v[2] * d, S.r * g + NONE, S.r * g + NONE, S.r * g + NONE);
      } else if (S.kind === 'soil') {
        // bue par la terre (la tache reste : voir soilWet)
        const f = max(0, 1 - (d - S.t) / 0.05);
        put(S.land[0], S.land[1] - S.r * (1 - f), S.land[2], S.r * f + NONE, S.r * f * 0.6 + NONE, S.r * f + NONE);
      } else {
        // perle posée, qui s'aplatit puis s'évapore
        const sq = min(1, (d - S.t) / 0.02), e = evap(d - S.t, 260);
        const rr = S.r * e;
        put(S.land[0], S.land[1] - S.r * 0.6 + rr * 0.6, S.land[2], rr * (1 + 0.3 * sq) + NONE, rr * (1 - 0.35 * sq) + NONE, rr * (1 + 0.3 * sq) + NONE);
      }
    }
  }
  out.length = k;
  return out;
}
// part du rayon de la goutte pendue, d = τ − τc (d < −fall)
function dropGrowthRel(d, E) {
  const before = -E.fall - d; // temps avant le détachement
  if (before <= 0) return 1;
  return max(0, 1 - before / E.grow) ** (1 / 3);
}
export const waterCount = (plan) => plan.events.reduce((n, E) => n + (E.cause === 'drop' ? 1 + E.splash.length : 0), 0);

// taches humides sur la terre : [x, z, rayon, intensité]
export function soilWet(tau, plan, out = []) {
  out.length = 0;
  for (const E of plan.events) if (E.cause === 'drop') {
    const d = rel(tau, E.tc, plan.P);
    for (const S of E.splash) if (S.kind === 'soil' && d > S.t && d < S.t + 400) {
      const g = min(1, (d - S.t) / 0.04), e = evap(d - S.t, 380);
      out.push([S.land[0], S.land[2], S.r * (2.2 + 1.2 * g) * (0.6 + 0.4 * e), g * e]);
    }
  }
  return out;
}
// mouillure de la foliole frappée
export function leafletWet(tau, plan) {
  const m = new Map();
  for (const E of plan.events) if (E.cause === 'drop') {
    const d = rel(tau, E.tc, plan.P);
    if (d >= 0 && d < 300) m.set(`${E.pair}:${E.sideObj}`, max(m.get(`${E.pair}:${E.sideObj}`) ?? 0, evap(d, 300)));
  }
  return m;
}

// marteau : angle du bras à l'instant τ (le premier coup de la scène fait foi ;
// plusieurs coups : celui dont l'instant est le plus proche)
export function hammerAt(tau, plan) {
  let best = null, bd = Infinity;
  for (const E of plan.events) if (E.cause === 'tap') {
    const d = rel(tau, E.tc, plan.P);
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = { E, d }; }
  }
  if (!best) return null;
  return { E: best.E, angle: hammerAngle(best.E.tc + best.d, best.E.hammer), d: best.d };
}
// secousse du pot après un coup : rotation amortie autour d'un axe horizontal
export function shakeAt(tau, plan) {
  let ang = 0, axis = [0, 0, 1];
  for (const E of plan.events) if (E.cause === 'tap') {
    const d = rel(tau, E.tc, plan.P);
    if (d < 0 || d > 3) continue;
    const { A, f, zeta } = E.shake, w = 2 * PI * f, wd = w * sqrt(1 - zeta * zeta);
    ang += A * exp(-zeta * w * d) * sin(wd * d);
    axis = [-E.dir[2], 0, E.dir[0]];
  }
  return { ang, axis };
}
