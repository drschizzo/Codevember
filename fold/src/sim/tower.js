// Fold · la dynamique d'une tour d'unités bistables (fpori.js).
//
// Chaque unité n'a qu'un degré de liberté, sa position σ le long de son chemin
// de moindre énergie : sa hauteur h, sa rotation θ et son énergie de barres U
// en dépendent (tables). Les plateaux sont des masses qui montent de Σ h et
// tournent de Σ ±θ (chiralités alternées). Le dessus est mené par une course
// (un ressort raide vers une hauteur imposée, libre en rotation) : il descend,
// attend, remonte. Les unités tournent ensemble, se bloquent, puis claquent à
// plat une à une dans l'ordre de leurs petites imperfections ; à la remontée,
// elles se redéploient de même.
//
// Lagrangien exact : la hauteur d'un plateau est une somme de fonctions d'une
// seule variable, les termes de Coriolis se réduisent à h''·σ̇². Euler
// symplectique, pas fixe ; deux cycles, on garde le second (il commence là où
// le premier finit : la boucle raccorde). La simulation est faite à l'échelle
// l = 9 cm ; la scène la met à la taille voulue (géométrie seule, même temps).

import { unitParams, energyPath, sampler } from './fpori.js';

export const DEFAULTS = {
  n: 6, alpha: Math.PI / 3, l: 0.09, units: 4,
  K: 900,          // raideur d'une barre de pli (N/m)
  kc: 0.02,        // raideur des plis à la torsion (N·m/rad), état de repos déployé
  spread: [1.0, 0.9, 1.08, 0.95], // imperfections : facteur de raideur par unité (du bas au haut)
  m: 0.012,        // masse d'un plateau et de sa part de papier (kg)
  Ipress: 4e-5,    // inertie de la presse en rotation (kg·m²), portée par le plateau du haut
  kp: 6000, cp: 6, // liaison presse–plateau du haut
  cth: 0.01,       // amortissement des plis (N·m·s/rad) : ~⅓ du critique au claquement
  hMin: 0.006,     // épaisseur du papier à plat : butée (m)
  g: 9.81,
  loop: 12, fps: 60, dt: 1 / 24000,
  cycles: 2,       // on ne garde que le dernier cycle : il commence là où le précédent finit
};

// Course de la presse : en haut, descente, palier, remontée, palier.
export function pressY(t, top, bottom, L) {
  const ease = (u) => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
  // (dans Fold, la tour est le sujet : elle ne reste pas longtemps à plat, le centre de la scène serait vide)
  const t1 = 0.05 * L, t2 = 0.32 * L, t3 = 0.4 * L, t4 = 0.78 * L;
  if (t < t1) return top;
  if (t < t2) return top + (bottom - top) * ease((t - t1) / (t2 - t1));
  if (t < t3) return bottom;
  if (t < t4) return bottom + (top - bottom) * ease((t - t3) / (t4 - t3));
  return top;
}

// Le chemin d'une unité reparamétré par son abscisse curviligne σ (en l),
// ds² = dh² + R² dθ² : dh/dσ et dθ/dσ restent bornés jusqu'à plat (dh/dθ,
// lui, diverge). Tables uniformes en σ de h, θ, U et de leurs dérivées.
export function pathTables(o, samples = 1024) {
  const P1 = unitParams(o.n, o.alpha, 1), E = energyPath(P1, 900);
  const m = E.th.length, S = new Float64Array(m);
  for (let i = 1; i < m; i++) S[i] = S[i - 1] + Math.hypot(E.h[i] - E.h[i - 1], P1.R * (E.th[i] - E.th[i - 1]));
  const sEnd = S[m - 1], H = new Float64Array(samples), TH = new Float64Array(samples), UU = new Float64Array(samples);
  let j = 0;
  for (let i = 0; i < samples; i++) {
    const s = (sEnd * i) / (samples - 1);
    while (j < m - 2 && S[j + 1] < s) j++;
    const f = (s - S[j]) / (S[j + 1] - S[j] || 1);
    H[i] = E.h[j] + (E.h[j + 1] - E.h[j]) * f; TH[i] = E.th[j] + (E.th[j + 1] - E.th[j]) * f; UU[i] = E.U[j] + (E.U[j + 1] - E.U[j]) * f;
  }
  const d1 = (y) => sampler(sEnd, y), Hs = d1(H), Ts = d1(TH), Us = d1(UU);
  // dérivées secondes : tables des dérivées premières, dérivées à leur tour
  const ds = sEnd / (samples - 1), Hp = new Float64Array(samples), Tp = new Float64Array(samples);
  for (let i = 0; i < samples; i++) { Hp[i] = Hs.d(i * ds); Tp[i] = Ts.d(i * ds); }
  const Hps = sampler(sEnd, Hp), Tps = sampler(sEnd, Tp);
  return { P1, E, sEnd, H: Hs, TH: Ts, U: Us, H2: Hps, T2: Tps };
}

export function simulate(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const P = unitParams(o.n, o.alpha, o.l), tb = o.tables || pathTables(o);
  const l = o.l;
  // fonctions de σ (en mètres : σ_m = l σ)
  const h = (s) => l * tb.H.v(s), th = (s) => tb.TH.v(s);
  const h1 = (s) => tb.H.d(s), t1 = (s) => tb.TH.d(s) / l;          // d/dσ_m
  const h2 = (s) => tb.H2.d(s) / l, t2 = (s) => tb.T2.d(s) / (l * l);
  const dU = (s) => o.K * l * tb.U.d(s);                              // dE/dσ_m
  // butée : là où h = hMin
  let sStop = tb.sEnd; for (let i = 2000; i >= 0; i--) { const s = (tb.sEnd * i) / 2000; if (h(s) >= o.hMin) { sStop = s; break; } }

  const N = o.units, sgn = (i) => (i % 2 ? -1 : 1);
  const top = N * P.H0, bottom = N * o.hMin + 0.002;
  const q = new Float64Array(N), v = new Float64Array(N);   // σ_j en unités de l, vitesse en m/s
  const per = Math.round(o.loop / o.dt), steps = per * o.cycles, every = Math.round(1 / (o.fps * o.dt));
  const frames = [];
  const M = new Float64Array(N * N), Q = new Float64Array(N), a1 = new Float64Array(N), b1 = new Float64Array(N), a2 = new Float64Array(N), b2 = new Float64Array(N);
  const I = o.m * P.R * P.R * 0.5;
  for (let st = 0; st <= steps; st++) {
    const t = (st % per) * o.dt;
    if (o.onStep && st % 4000 === 0) o.onStep(st / steps);
    if (st >= per * (o.cycles - 1) && st % every === 0 && frames.length < o.loop * o.fps) frames.push({ t, th: Array.from(q, th), h: Array.from(q, h), press: pressY(t, top, bottom, o.loop) });
    for (let i = 0; i < N; i++) { a1[i] = h1(q[i]); b1[i] = sgn(i) * t1(q[i]); a2[i] = h2(q[i]); b2[i] = sgn(i) * t2(q[i]); }
    // M = Σ_plateaux m y'y'ᵀ + I ψ'ψ'ᵀ ; plateau j (1..N) porté par les unités i < j
    M.fill(0); Q.fill(0);
    let cy = 0, cp = 0; // accélérations « centripètes » cumulées Σ_{i<j} h_i'' ṡ_i², idem ψ
    for (let j = 1; j <= N; j++) {
      const Ij = I + (j === N ? o.Ipress : 0), i = j - 1;
      cy += a2[i] * v[i] * v[i]; cp += b2[i] * v[i] * v[i];
      for (let a = 0; a < j; a++) {
        for (let b = 0; b < j; b++) M[a * N + b] += o.m * a1[a] * a1[b] + Ij * b1[a] * b1[b];
        Q[a] -= o.m * a1[a] * cy + Ij * b1[a] * cp;
      }
    }
    for (let a = 0; a < N; a++) M[a * N + a] += 1e-6 * o.m;
    let yTop = 0, vTop = 0; for (let i = 0; i < N; i++) { yTop += h(q[i]); vTop += a1[i] * v[i]; }
    const yp = pressY(t, top, bottom, o.loop);
    const Fp = -o.kp * (yTop - yp) - o.cp * vTop;
    for (let a = 0; a < N; a++) {
      const thr = th(q[a]), w = t1(q[a]) * v[a]; // vitesse de rotation relative de l'unité
      let f = -dU(q[a]) * o.spread[a % o.spread.length] - (o.kc * thr + o.cth * w) * t1(q[a]);
      f -= (N - a) * o.m * o.g * a1[a];
      f += Fp * a1[a];
      if (q[a] < 0) f += -3e4 * l * q[a] - 0.5 * v[a];
      if (q[a] > sStop) f += -3e4 * l * (q[a] - sStop) - 0.5 * v[a];
      Q[a] += f;
    }
    const acc = solve(M, Q, N);
    for (let a = 0; a < N; a++) { v[a] += acc[a] * o.dt; q[a] += (v[a] * o.dt) / l; }
  }
  return { o, P, tb, frames, sStop, top, bottom };
}

function solve(A0, b0, n) {
  const A = Float64Array.from(A0), b = Float64Array.from(b0);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (p !== c) { for (let k = 0; k < n; k++) [A[c * n + k], A[p * n + k]] = [A[p * n + k], A[c * n + k]]; [b[c], b[p]] = [b[p], b[c]]; }
    for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]; x[r] = s / A[r * n + r]; }
  return x;
}

// Le film d'une tour, pour le worker : θ et h (à l'échelle de la simulation)
// de chaque unité, image par image.
export function towerFilm({ units = 4, loop = 14, fps = 60, spread } = {}, onStep = null) {
  const S = simulate({ units, loop, fps, ...(spread ? { spread } : {}), onStep });
  const F = S.frames.length, th = new Float32Array(F * units), h = new Float32Array(F * units);
  S.frames.forEach((f, i) => { th.set(f.th, i * units); h.set(f.h, i * units); });
  return { F, units, fps, loop, l: S.o.l, th, h, top: S.top };
}
