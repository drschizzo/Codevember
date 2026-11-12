// Transition entre deux équilibres : un problème aux deux bouts, résolu par
// tir multiple et SQP (module pur).
//
// Inconnues : la commande u = s̈, affine par morceaux sur N intervalles
// (u₀ = u_N = 0 : le moteur part et s'arrête sans à-coup d'accélération), et
// l'état au début de chacun des S segments de tir (sauf le premier, imposé).
// Contraintes : chaque segment, intégré en RK4 (K pas par intervalle), doit
// arriver sur l'état du suivant ; le dernier, sur l'équilibre visé, au repos,
// la machine revenue à sa position. Coût : ½∫u² + ½β∫(s − s_réf)², qui garde
// la machine près de son point milieu (le rail est borné).
//
// Pas de Newton sur les contraintes, quadratique sur le coût (KKT dense : 150
// à 300 inconnues), jacobienne par différences finies segment par segment
// (une commande ne touche qu'un ou deux segments, un état un seul), recherche
// linéaire sur un mérite ℓ1. Le tir multiple dompte l'instabilité : un
// pendule debout diverge en e^{λt} (λ ≈ 6,5 s⁻¹ pour une barre de 35 cm,
// davantage pour une chaîne) ; intégrer d'un bout à l'autre multiplierait une
// erreur par 10⁸ au moins en 3 s, un segment de 0,25 s par 5 environ.
import { rk4Step, rkWork, solveInPlace } from './dynamics.js';

export function solveTransition(sys, opt) {
  const { T, X0, X1, N = 60, S = 12, K = 6, alpha = 1, beta = 40, maxIt = 70, tol = 1e-10, onIter = null, u0 = null, rng = null, warm = null } = opt;
  const nx = sys.nx, np = sys.np, h = T / N, hs = h / K, per = N / S;
  if (N % S) throw new Error('N doit être un multiple de S');
  const nu = N - 1, nz = nu + (S - 1) * nx, nc = S * nx, nK = nz + nc;
  const z = new Float64Array(nz);
  if (u0) for (let j = 0; j < nu; j++) z[j] = u0[j] ?? 0;
  // états initiaux : interpolation des équilibres (le tir multiple n'exige
  // pas qu'elle soit physique), vitesses de la pente, un peu de bruit
  for (let i = 1; i < S; i++) {
    const t = i / S, o = nu + (i - 1) * nx;
    for (let k = 0; k < nx; k++) z[o + k] = X0[k] + (X1[k] - X0[k]) * t;
    for (let k = 0; k < np; k++) z[o + np + k] = (X1[k] - X0[k]) / T + (rng ? (rng() - 0.5) * 2 : 0);
  }
  // départ à chaud : la solution d'un essai voisin (même découpage), remise à
  // l'échelle de la nouvelle durée (u ∝ 1/T², vitesses ∝ 1/T)
  if (warm && warm.z.length === nz) {
    const a = warm.T / T;
    for (let j = 0; j < nz; j++) z[j] = warm.z[j];
    for (let j = 0; j < nu; j++) z[j] *= a * a;
    for (let i = 1; i < S; i++) { const o = nu + (i - 1) * nx; for (let k = 0; k < np; k++) z[o + np + k] *= a; z[o + 2 * np + 1] *= a; }
  }
  const uAt = (zz, k) => (k <= 0 || k >= N ? 0 : zz[k - 1]);
  const w = rkWork(nx);
  const segOut = Array.from({ length: S }, () => new Float64Array(nx));
  // (onStep : appelé à la fin de chaque intervalle de commande — l'écran de chargement)
  function seg(i, zz, x, onStep = null) {
    x.set(i === 0 ? X0 : zz.subarray(nu + (i - 1) * nx, nu + i * nx));
    if (onStep && i === 0) onStep(x);
    for (let k = i * per; k < (i + 1) * per; k++) {
      const ua = uAt(zz, k), ub = uAt(zz, k + 1);
      for (let s = 0; s < K; s++) rk4Step(sys, x, ua + (ub - ua) * (s / K), ua + (ub - ua) * ((s + 1) / K), hs, w);
      onStep?.(x);
    }
    return x;
  }
  function cons(zz, c) {
    for (let i = 0; i < S; i++) {
      const y = seg(i, zz, segOut[i]);
      const tgt = i === S - 1 ? X1 : zz.subarray(nu + i * nx, nu + (i + 1) * nx);
      for (let k = 0; k < nx; k++) c[i * nx + k] = y[k] - tgt[k];
    }
    return c;
  }
  // s aux nœuds = s₀ + L·u (intégration exacte d'une accélération affine)
  const L = new Float64Array((N + 1) * nu);
  for (let j = 0; j < nu; j++) {
    let s = 0, sd = 0;
    for (let k = 0; k < N; k++) {
      const ua = k === j + 1 ? 1 : 0, ub = k === j ? 1 : 0;
      s += h * sd + (h * h * (2 * ua + ub)) / 6;
      sd += (h * (ua + ub)) / 2;
      L[(k + 1) * nu + j] = s;
    }
  }
  const s0 = X0[2 * np], s1 = X1[2 * np];
  const sref = (k) => s0 + (s1 - s0) * smooth(k / N);
  const Q = new Float64Array(nu * nu), gq = new Float64Array(nu);
  for (let a = 0; a < nu; a++) {
    for (let bb = 0; bb < nu; bb++) {
      let s = 0;
      for (let k = 0; k <= N; k++) s += L[k * nu + a] * L[k * nu + bb];
      Q[a * nu + bb] = beta * h * s + (a === bb ? alpha * h : 0);
    }
    let s = 0;
    for (let k = 0; k <= N; k++) s += L[k * nu + a] * (s0 - sref(k));
    gq[a] = beta * h * s;
  }
  const fval = (zz) => {
    let f = 0;
    for (let a = 0; a < nu; a++) { let t = 0; for (let bb = 0; bb < nu; bb++) t += Q[a * nu + bb] * zz[bb]; f += zz[a] * (0.5 * t + gq[a]); }
    return f;
  };
  const norm = (v) => { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s); };
  const c = new Float64Array(nc), cp = new Float64Array(nc), J = new Float64Array(nc * nz);
  const KK = new Float64Array(nK * nK), rhs = new Float64Array(nK), d = new Float64Array(nK);
  const y = new Float64Array(nx), zt = new Float64Array(nz);
  const segOf = (k) => Math.min(S - 1, Math.floor(k / per));
  let it = 0, cn = Infinity, fPrev = Infinity, calm = 0, polish = 0;
  for (; it < maxIt + 10; it++) {
    cons(z, c);
    cn = norm(c);
    const f0 = fval(z);
    onIter?.({ it, cn, cost: f0, z, S, seg: (i, out, onStep) => seg(i, z, out, onStep) });
    if (!Number.isFinite(cn)) break;
    if (cn < tol && Math.abs(f0 - fPrev) < 1e-7 * (1 + Math.abs(f0))) { if (++calm >= 2) break; } else calm = 0;
    fPrev = f0;
    // polissage : au-delà de maxIt (ou presque convergé mais lent), pas de
    // Newton de norme minimale sur les seules contraintes, sans recherche
    // linéaire (convergence quadratique près de la solution)
    if (it >= maxIt) { if (cn > 1e-2 || cn < tol) break; polish = 1; }
    // jacobienne (différences finies, par blocs)
    J.fill(0);
    for (let j = 0; j < nz; j++) {
      const old = z[j], eps = 1e-6 * (1 + Math.abs(old));
      z[j] = old + eps;
      const a = j < nu ? segOf(j) : Math.floor((j - nu) / nx) + 1, bseg = j < nu ? segOf(j + 1) : a;
      for (let i = a; i <= bseg; i++) {
        seg(i, z, y);
        for (let k = 0; k < nx; k++) J[(i * nx + k) * nz + j] += (y[k] - segOut[i][k]) / eps;
      }
      z[j] = old;
      if (j >= nu) { const i = Math.floor((j - nu) / nx), k = (j - nu) % nx; J[(i * nx + k) * nz + j] -= 1; }
    }
    // KKT : [W Jᵀ ; J 0] [dz ; λ] = [−∇f ; −c]
    KK.fill(0);
    for (let a = 0; a < nz; a++) {
      let gr = 0;
      if (polish) KK[a * nK + a] = a < nu ? 1 : 1e-2;
      else if (a < nu) { for (let bb = 0; bb < nu; bb++) { KK[a * nK + bb] = Q[a * nu + bb]; gr += Q[a * nu + bb] * z[bb]; } gr += gq[a]; }
      else KK[a * nK + a] = 1e-8;
      rhs[a] = -gr;
    }
    for (let r = 0; r < nc; r++) {
      for (let a = 0; a < nz; a++) { const v = J[r * nz + a]; if (v) { KK[(nz + r) * nK + a] = v; KK[a * nK + nz + r] = v; } }
      rhs[nz + r] = -c[r];
    }
    solveInPlace(KK, rhs, d, nK);
    // mérite ℓ1 (le poids suit la taille des multiplicateurs)
    let lam = 0;
    for (let r = 0; r < nc; r++) lam = Math.max(lam, Math.abs(d[nz + r]));
    const rho = 2 * lam + 1, m0 = f0 + rho * norm1(c);
    let step = 1;
    for (let j = 0; j < nz; j++) zt[j] = z[j] + d[j];
    for (let ls = 0; ls < (polish ? 0 : 14); ls++) {
      for (let j = 0; j < nz; j++) zt[j] = z[j] + step * d[j];
      cons(zt, cp);
      const m1 = fval(zt) + rho * norm1(cp);
      if (Number.isFinite(m1) && (m1 <= m0 - 1e-4 * step * rho * norm1(c) || norm(cp) < 0.5 * cn)) break;
      step *= 0.5;
    }
    z.set(zt);
  }
  cons(z, c);
  cn = norm(c);
  const sNodes = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) { let s = s0; for (let j = 0; j < nu; j++) s += L[k * nu + j] * z[j]; sNodes[k] = s; }
  const u = Float64Array.from({ length: N + 1 }, (_, k) => uAt(z, k));
  return {
    ok: cn < 1e-7, cn, it, cost: fval(z), z, u, sNodes, uMax: Math.max(...u.map(Math.abs)),
    sMin: Math.min(...sNodes), sMax: Math.max(...sNodes),
    T, N, S, K, nx, np,
    // relecture : intégration segment par segment (jamais d'un bout à l'autre)
    record: () => record(sys, { X0, z, nu, N, S, K, T }),
  };
}

const norm1 = (v) => { let s = 0; for (const x of v) s += Math.abs(x); return s; };
export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Table d'une transition : l'état et sa dérivée à chaque pas d'intégration
// (N·K + 1 instants), pour une relecture en Hermite cubique C¹.
export function record(sys, { X0, z, nu, N, S, K, T }) {
  const nx = sys.nx, per = N / S, hs = T / N / K, M = N * K + 1;
  const X = new Float32Array(M * nx), D = new Float32Array(M * nx), U = new Float32Array(M);
  const uAt = (k) => (k <= 0 || k >= N ? 0 : z[k - 1]);
  const w = rkWork(nx), x = new Float64Array(nx), dx = new Float64Array(nx);
  let m = 0;
  const put = (uu) => { sys.f(x, uu, dx); X.set(x, m * nx); D.set(dx, m * nx); U[m] = uu; m++; };
  for (let i = 0; i < S; i++) {
    x.set(i === 0 ? X0 : z.subarray(nu + (i - 1) * nx, nu + i * nx));
    for (let k = i * per; k < (i + 1) * per; k++) {
      const ua = uAt(k), ub = uAt(k + 1);
      // (l'état avant chaque pas ; au début d'un segment, son état de tir
      // remplace la fin du précédent : l'écart est le résidu du solveur)
      for (let s = 0; s < K; s++) {
        put(ua + (ub - ua) * (s / K));
        rk4Step(sys, x, ua + (ub - ua) * (s / K), ua + (ub - ua) * ((s + 1) / K), hs, w);
      }
    }
  }
  put(0);
  return { X, D, U, M, nx, dt: hs, T };
}

// Relecture d'une table au temps physique t ∈ [0, T] : Hermite cubique
export function sampleTable(tab, t, out) {
  const { X, D, M, nx, dt } = tab;
  const f = Math.min(Math.max(t / dt, 0), M - 1 - 1e-9), i = Math.floor(f), a = f - i;
  const a2 = a * a, a3 = a2 * a;
  const h00 = 2 * a3 - 3 * a2 + 1, h10 = a3 - 2 * a2 + a, h01 = -2 * a3 + 3 * a2, h11 = a3 - a2;
  const o0 = i * nx, o1 = (i + 1) * nx;
  for (let k = 0; k < nx; k++) out[k] = h00 * X[o0 + k] + h10 * dt * D[o0 + k] + h01 * X[o1 + k] + h11 * dt * D[o1 + k];
  return out;
}
