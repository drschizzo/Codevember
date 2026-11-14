// L'horloge : tout ce qui bouge lit la phase du film u (0 → 1), par la saison
// simulée s(u) et le temps physique depuis le détachement τ(u). Fonctions
// pures (Node et navigateur).
//
// - s(u) : la phase de la simulation. Le film est un accéléré (une heure de
//   fonte en ~48 s), sauf autour du détachement, où il ralentit presque au
//   temps réel pour montrer la bascule (un plateau de ralenti, voir WARP) ;
//   s(0) = 0, s(1) = 1, et le détachement tombe au milieu du plateau.
// - τ(u) = (s(u) − s_d) · P_phys : le temps physique (s) depuis le
//   détachement, qui pilote le fuseau (gen/body.js).
import { bodyPose } from './gen/body.js';

export const COMPRESSION = 11.5; // temps physique / temps simulé à F = 20 (proto/p0 : 11,5)
// La vitesse du film v(u) = 1 − A·plateau(u) (plateau lisse de demi-largeur
// h, raccords de largeur r), normalisée pour que s(1) = 1 ; le centre c du
// plateau est cherché pour que s(c) = s_d (le détachement tombe au milieu du
// ralenti). Au plateau, une seconde de film ≈ 1,9 s physique.
export const WARP = { A: 0.982, h: 0.036, r: 0.03, n: 4096 };
const warps = new Map();
function makeWarp(sd) {
  const { A, h, r, n } = WARP;
  const table = (c) => {
    const v = new Float64Array(n + 1), cum = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) {
      let x = Math.abs(k / n - c); x = Math.min(x, 1 - x);
      const t = Math.max(0, Math.min(1, (x - h) / r)), plateau = 1 - t * t * (3 - 2 * t);
      v[k] = 1 - A * plateau;
    }
    for (let k = 1; k <= n; k++) cum[k] = cum[k - 1] + 0.5 * (v[k] + v[k - 1]) / n;
    for (let k = 0; k <= n; k++) cum[k] /= cum[n];
    return cum;
  };
  const at = (cum, u) => { const f = u * n, i = Math.min(n - 1, Math.floor(f)), a = f - i; return cum[i] * (1 - a) + cum[i + 1] * a; };
  let c = sd, cum = table(c);
  for (let it = 0; it < 30; it++) { const e = at(cum, c) - sd; if (Math.abs(e) < 1e-7) break; c -= e; cum = table(c); }
  return { c, s: (u) => at(cum, u) };
}
export function simPhase(u, sd) {
  const key = sd.toFixed(6);
  if (!warps.has(key)) warps.set(key, makeWarp(sd));
  const ph = u - Math.floor(u);
  return warps.get(key).s(ph);
}
export const detachFilmPhase = (sd) => { simPhase(0, sd); return warps.get(sd.toFixed(6)).c; };

const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// profil de la colonne à la phase simulée s : interpolé entre deux relevés,
// sans jamais mélanger les relevés de part et d'autre du détachement
export function columnRows(S, s, out = new Float32Array(S.nz)) {
  const n = S.samples, f = (((s % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n;
  let a = f - Math.floor(f);
  if (S.detach) {
    const kd = Math.ceil(S.detach.phase * n) % n;
    if (i1 === kd) a = s % 1 < S.detach.phase ? 0 : 1;
  }
  for (let j = 0; j < S.nz; j++) out[j] = S.prof[i0 * S.nz + j] * (1 - a) + S.prof[i1 * S.nz + j] * a;
  return out;
}
export function feedAt(S, s) {
  const n = S.samples, f = (((s % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n, a = f - Math.floor(f);
  const v0 = S.feedAt[i0], v1 = i0 + 1 < n ? S.feedAt[i0 + 1] : S.feedPeriod;
  return (v0 * (1 - a) + v1 * a) / 10; // cm
}

// L'état complet du film à la phase u
export function stateAt(R, S, B, u) {
  const ud = S.detach ? S.detach.phase : 0.62;
  const s = simPhase(u, ud);
  const summer = 0.5 - 0.5 * Math.cos(2 * Math.PI * s); // 0 l'hiver, 1 l'été
  const Pphys = S.P * COMPRESSION;
  let frag = null, ripple = { amp: 0, x: 0, z: 0, t: 0, lambda: 1.2 };
  if (S.detach && B) {
    const tau = (s - S.detach.phase) * Pphys;
    if (tau >= 0) {
      const p = bodyPose(B, tau);
      const az = R.body.azimuth, c = Math.cos(az), sn = Math.sin(az);
      const X = p.x * 100, Y = p.y * 100, D = -p.drift * 100 * R.body.driftDir; // cm
      const pos = [X * c - D * sn, Y, X * sn + D * c];
      if (Math.abs(D) < 45) {
        frag = { pos, th: p.th, az, L: B.L * 100, sG: B.sG * 100, n: S.detach.prof.length,
          matY: (S.Z - (S.detach.z0 + B.sG)) * -100 + feedAt(S, S.detach.phase) };
      }
      // rides : l'onde de la bascule, puis la brise de l'automne
      const breeze = sm(ud, ud + 0.05, s) * (1 - sm(0.86, 0.95, s));
      ripple = { amp: 0.006 * Math.exp(-tau / 2.5) + 0.0025 * breeze * R.body.breeze, x: pos[0], z: pos[2], t: Math.min(tau, 600), lambda: 1.2 };
    }
  }
  return { u, s, summer, Tlake: 0.5 * (R.lake.T0 + R.lake.T1) - 0.5 * (R.lake.T1 - R.lake.T0) * Math.cos(2 * Math.PI * s), frag, ripple, feed: feedAt(S, s) };
}
