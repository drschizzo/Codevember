// La propagation (module pur) : un tapis de mousse qui s'étend et se
// rétracte sur sa pierre au fil d'une année, filmée en accéléré.
//
// Deux champs sur une grille posée sur le dessus de la pierre :
//   W  l'eau de la roche et de la mousse (0 sec, 1 trempé)
//   B  la mousse (0 roche nue, 1 tapis épais)
// et une carte d'habitat fixe, tirée de la graine :
//   R  la rétention : les fissures, les creux et le côté à l'ombre gardent
//      l'eau ; les bosses exposées au soleil la perdent.
//
//   dW/dt = pluie(t, x)·(1 − W) − évap(t)·(1,2 − R)·W
//   dB/dt = D∇²B + r·W·B·(1 − B/K) − m·(1 − W)·(1 − R)²·B,   B ≥ b₀·refuge(R)
//
// C'est l'équation de Fisher-KPP : à la saison des pluies, un front avance
// à la vitesse 2√(rD) depuis les îlots où la mousse a survécu (un voile vert
// de protonéma, puis des tiges qui sortent) ; à la sécheresse, la mousse
// meurt d'abord là où elle sèche le plus vite, et se retire dans ses refuges
// (b₀ : des fragments survivent dans les fissures). Les averses passent en
// bandes : on voit la roche foncer sous la pluie, puis sécher.
//
// Le système est dissipatif : sous un forçage de période P (un an), il
// converge vers une orbite périodique, qu'on intègre jusqu'à ce que l'état
// à t + P égale l'état à t, puis qu'on enregistre — la boucle se referme
// par construction.
import { createRng, createNoise3, smoothstep as sst } from './rng.js';

export const FIELD_N = 64;      // grille FIELD_N × FIELD_N
export const YEAR = 365;        // période physique (jours)
export const REC = 30;          // états enregistrés par seconde de film

// saison des pluies (0…1) à la phase u : sèche au début, les pluies reviennent
// vers 0,15, pleine saison de 0,26 à 0,58, sécheresse à partir de 0,68
export const SEASON = { rain0: 0.13, rain1: 0.25, dry0: 0.58, dry1: 0.7 };
export const wetSeason = (u) => { u -= Math.floor(u); return sst(SEASON.rain0, SEASON.rain1, u) * (1 - sst(SEASON.dry0, SEASON.dry1, u)); };

// averses : bandes de pluie qui traversent la pierre (u0 : début, du : durée
// en part de boucle, dir : direction de passage) ; elles annoncent la saison
// des pluies. (Pas d'averse pendant la sécheresse : le retrait est continu.)
export function showers(seed) {
  const rng = createRng(`showers:${seed}`);
  const L = [];
  for (const u0 of [0.105, 0.15, 0.19]) {
    const a = rng.range(0, Math.PI * 2);
    L.push({ u0: u0 + rng.range(-0.008, 0.008), du: rng.range(0.022, 0.032), dir: [Math.cos(a), Math.sin(a)], k: rng.range(0.7, 1) });
  }
  return L;
}
// intensité de la pluie (0…1) au point (x, z) à la phase u ; E : demi-largeur
export function rainAt(u, x, z, SH, E) {
  u -= Math.floor(u);
  let r = 0.55 * sst(SEASON.rain1 - 0.02, SEASON.rain1 + 0.03, u) * (1 - sst(SEASON.dry0 - 0.06, SEASON.dry0, u));
  for (const s of SH) {
    const t = (u - s.u0) / s.du;
    if (t < -0.2 || t > 1.4) continue;
    // la bande avance de −1,6 E à +1,6 E le long de dir
    const front = -1.6 * E + 3.2 * E * t, p = x * s.dir[0] + z * s.dir[1];
    const band = sst(front - 1.6 * E, front - 0.9 * E, p) * (1 - sst(front - 0.1 * E, front + 0.15 * E, p));
    r = Math.max(r, s.k * band);
  }
  return r;
}
// pluie qui tombe quelque part dans le champ (pour le ciel, les stries)
export function rainNow(u, SH, E) {
  let r = 0;
  for (const [x, z] of [[0, 0], [E * 0.6, 0], [-E * 0.6, 0], [0, E * 0.6], [0, -E * 0.6]]) r = Math.max(r, rainAt(u, x, z, SH, E));
  return r;
}

// habitat : fissures (bords de cellules de Worley), creux, côté à l'ombre
export function makeHabitat(seed, E, sunDir, rock = null) {
  const N = FIELD_N, rng = createRng(`habitat:${seed}`), nz = createNoise3(`habitat:${seed}`);
  // germes des cellules de la roche (fissures entre elles)
  const G = Array.from({ length: 14 }, () => [rng.range(-E, E), rng.range(-E, E)]);
  const R = new Float32Array(N * N), M = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -E + (2 * E * (i + 0.5)) / N, z = -E + (2 * E * (j + 0.5)) / N;
    let f1 = 1e9, f2 = 1e9;
    for (const g of G) { const d = Math.hypot(x - g[0] + 0.3 * nz.noise(x, z, 1), z - g[1] + 0.3 * nz.noise(x, z, 2)); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d; }
    // (la vraie roche : la mousse survit le long de ses fissures, à quelques mm)
    const crack = rock ? Math.exp(-((rock.sample(x, z).edge / (rock.K.refuge ?? 0.75)) ** 2)) * (rock.K.refuge ? 0.75 : 1) : 1 - sst(0.0, 0.32, f2 - f1);
    const hollow = sst(-0.2, 0.5, nz.fbm(x * 0.35, 0.5, z * 0.35, 3));
    const shade = 0.5 - 0.5 * ((x * sunDir[0] + z * sunDir[2]) / E);
    const r = Math.hypot(x, z) / E;
    M[j * N + i] = 1 - sst(0.86, 0.98, r);
    R[j * N + i] = Math.min(1, 0.7 * crack + 0.35 * hollow + 0.3 * shade - 0.1);
  }
  return { R, M, E, N };
}

// bilinéaire sur une grille FIELD_N² (valeurs à l'index c*N*N + j*N + i)
export function bilerp(A, N, E, x, z, off = 0) {
  const fx = Math.min(N - 1.001, Math.max(0, ((x + E) / (2 * E)) * N - 0.5)), fz = Math.min(N - 1.001, Math.max(0, ((z + E) / (2 * E)) * N - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  const g = (ii, jj) => A[off + jj * N + ii];
  return (g(i, j) * (1 - a) + g(i + 1, j) * a) * (1 - b) + (g(i, j + 1) * (1 - a) + g(i + 1, j + 1) * a) * b;
}

// T : durée du film (s) ; H : habitat ; SH : averses ; P : paramètres
export function simulateField(T, H, SH, P = {}) {
  const N = FIELD_N, E = H.E, dx = (2 * E) / N;
  const r = P.r ?? 0.034, D = P.D ?? 0.0011, m = P.m ?? 0.022, b0 = P.b0 ?? 0.5, ev = P.ev ?? 0.35;
  const B = new Float64Array(N * N), W = new Float64Array(N * N), L = new Float64Array(N * N);
  for (let k = 0; k < N * N; k++) B[k] = H.M[k] * Math.max(0, H.R[k]) * 0.5;
  const K = Float64Array.from(H.R, (v, k) => H.M[k] * (0.55 + 0.45 * Math.max(0, v)));
  const F = Math.round(T * REC), dtDay = YEAR / F; // (un pas par image : ~0,3 jour)
  const sub = Math.max(1, Math.ceil(dtDay / 0.5)), dt = dtDay / sub;
  const rainGrid = new Float64Array(N * N);
  const rec = { F, N, E, B: new Uint8Array(F * N * N), W: new Uint8Array(F * N * N) };
  function step(u) {
    // pluie de cet instant
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) rainGrid[j * N + i] = rainAt(u, -E + dx * (i + 0.5), -E + dx * (j + 0.5), SH, E);
    // évaporation : forte au soleil de la sécheresse, faible sous la pluie
    const e = ev * (0.15 + 0.85 * (1 - wetSeason(u)));
    // (la mousse ne pousse qu'à la saison des pluies : une rosée n'y suffit pas)
    const season = Math.max(0.15, wetSeason(u));
    for (let s = 0; s < sub; s++) {
      for (let k = 0; k < N * N; k++) {
        const rr = rainGrid[k];
        W[k] += dt * (rr * 3 * (1 - W[k]) - e * (rr > 0.05 ? 0.1 : 1) * (1.2 - H.R[k]) * W[k]);
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (!H.M[k]) { L[k] = 0; continue; }
        const c = B[k], lap = (B[j * N + Math.max(0, i - 1)] + B[j * N + Math.min(N - 1, i + 1)] + B[Math.max(0, j - 1) * N + i] + B[Math.min(N - 1, j + 1) * N + i] - 4 * c) / (dx * dx);
        L[k] = D * lap + r * season * W[k] * c * (1 - c / Math.max(1e-3, K[k])) - m * (1 - W[k]) * (1 - Math.max(0, H.R[k])) ** 2 * c;
      }
      for (let k = 0; k < N * N; k++) B[k] = Math.max(H.M[k] * b0 * sst(0.45, 0.9, H.R[k]), Math.min(1, B[k] + dt * L[k]));
    }
  }
  const period = (record) => {
    for (let f = 0; f < F; f++) {
      if (record) for (let k = 0; k < N * N; k++) { rec.B[f * N * N + k] = Math.round(B[k] * 255); rec.W[f * N * N + k] = Math.round(Math.min(1, W[k]) * 255); }
      step(f / F);
    }
  };
  let prev = [...B, ...W], residual = 1, periods = 0;
  for (; periods < 10; periods++) {
    period(false);
    const cur = [...B, ...W];
    residual = Math.max(...cur.map((v, i) => Math.abs(v - prev[i])));
    prev = cur;
    if (residual < 2e-4) break;
  }
  period(true);
  rec.residual = residual; rec.periods = periods + 1;
  return rec;
}

// lecture d'un enregistrement à la phase u (linéaire, périodique) → Float32Array 2·N² (B, W)
export function sampleField(rec, u, out) {
  const NN = rec.N * rec.N, F = rec.F, f = (((u % 1) + 1) % 1) * F, i = Math.floor(f) % F, j = (i + 1) % F, a = f - Math.floor(f);
  for (let k = 0; k < NN; k++) {
    out[k] = (rec.B[i * NN + k] * (1 - a) + rec.B[j * NN + k] * a) / 255;
    out[NN + k] = (rec.W[i * NN + k] * (1 - a) + rec.W[j * NN + k] * a) / 255;
  }
  return out;
}
