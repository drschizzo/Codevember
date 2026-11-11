// Transport optimal : l'application qui envoie la lumière uniforme de la
// lentille sur le dessin — fonctions pures.
//
// On cherche u convexe sur le carré unité tel que T = ∇u transporte la
// densité source μ sur la densité cible ν : μ(x) = ν(∇u(x))·det D²u(x)
// (équation de Monge-Ampère). Méthode de Benamou, Froese et Oberman (2010) :
// comme (Δu)² = (u_xx − u_yy)² + 4u_xy² + 4 det D²u, on itère
//   Δu⁽ⁿ⁺¹⁾ = √[(u_xx − u_yy)² + 4u_xy² + 4 f(x, ∇u⁽ⁿ⁾)],   f = μ/ν(∇u),
// une équation de Poisson par itération (FFT). La cible vaut 1 près du bord
// (la lumière n'y bouge pas) : on impose u = |x|²/2 au bord (T = identité).

import { poissonDirichlet } from './fft.js';

// échantillonnage bilinéaire d'une grille n×n de cellules centrées sur [0, 1]²
export function sampler(a, n) {
  return (x, y) => {
    const fx = Math.min(n - 1, Math.max(0, x * n - 0.5)), fy = Math.min(n - 1, Math.max(0, y * n - 0.5));
    const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fy));
    const u = fx - i, v = fy - j;
    const k = j * n + i;
    return (1 - v) * ((1 - u) * a[k] + u * a[k + 1]) + v * ((1 - u) * a[k + n] + u * a[k + n + 1]);
  };
}

// Résout le transport : renvoie u et l'application T = ∇u sur la grille des
// nœuds (m + 2)² (bord compris), pas h = 1/(m + 1).
//   nu : cible (grille nt×nt de cellules, moyenne 1)
//   mu : source (fonction (x, y) → densité, moyenne 1), uniforme par défaut
export function solveTransport(nu, nt, { m = 255, iters = 80, mu = null, relax = 0.9, tol = 2e-3, onStep = null } = {}) {
  const h = 1 / (m + 1), M = m + 2;
  const nuAt = sampler(nu, nt);
  const u = new Float64Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const x = i * h, y = j * h; u[j * M + i] = 0.5 * (x * x + y * y); }
  const rhs = new Float64Array(m * m);
  const hist = [];
  for (let it = 0; it < iters; it++) {
    let res = 0;
    for (let j = 1; j <= m; j++) for (let i = 1; i <= m; i++) {
      const k = j * M + i;
      const uxx = (u[k + 1] - 2 * u[k] + u[k - 1]) / (h * h);
      const uyy = (u[k + M] - 2 * u[k] + u[k - M]) / (h * h);
      const uxy = (u[k + M + 1] - u[k + M - 1] - u[k - M + 1] + u[k - M - 1]) / (4 * h * h);
      const gx = (u[k + 1] - u[k - 1]) / (2 * h), gy = (u[k + M] - u[k - M]) / (2 * h);
      const f = (mu ? mu(i * h, j * h) : 1) / Math.max(nuAt(gx, gy), 1e-3);
      const det = uxx * uyy - uxy * uxy;
      res += Math.abs(det - f) / f;
      const d = uxx - uyy;
      rhs[(j - 1) * m + (i - 1)] = Math.sqrt(Math.max(0, d * d + 4 * uxy * uxy + 4 * f)) - 2;
    }
    res /= m * m;
    hist.push(res);
    onStep?.(it, res, u, M);
    if (res < tol) break;
    const phi = poissonDirichlet(rhs, m, h);
    for (let j = 1; j <= m; j++) for (let i = 1; i <= m; i++) {
      const k = j * M + i, x = i * h, y = j * h;
      u[k] = (1 - relax) * u[k] + relax * (0.5 * (x * x + y * y) + phi[(j - 1) * m + (i - 1)]);
    }
  }
  // application T = ∇u aux nœuds (différences centrées, décentrées au bord)
  const Tx = new Float64Array(M * M), Ty = new Float64Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    Tx[k] = i === 0 ? (u[k + 1] - u[k]) / h : i === M - 1 ? (u[k] - u[k - 1]) / h : (u[k + 1] - u[k - 1]) / (2 * h);
    Ty[k] = j === 0 ? (u[k + M] - u[k]) / h : j === M - 1 ? (u[k] - u[k - M]) / h : (u[k + M] - u[k - M]) / (2 * h);
  }
  // au bord, l'application est l'identité (u = |x|²/2) : on l'impose exactement
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    if (i === 0 || j === 0 || i === M - 1 || j === M - 1) { const k = j * M + i; Tx[k] = i * h; Ty[k] = j * h; }
  }
  return { u, Tx, Ty, M, h, residual: hist[hist.length - 1], history: hist };
}

// Densité obtenue par l'application T (contrôle) : chaque cellule de la
// grille source reçoit sa lumière μ·h², étalée sur l'aire de son image ;
// on la projette (au centre de la cellule image) sur une grille n×n.
export function pushForward(T, n, mu = null) {
  const { Tx, Ty, M, h } = T;
  const acc = new Float64Array(n * n), area = new Float64Array(n * n);
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, c = a + M + 1, d = a + M;
    const A = 0.5 * Math.abs((Tx[c] - Tx[a]) * (Ty[d] - Ty[b]) - (Tx[d] - Tx[b]) * (Ty[c] - Ty[a]));
    const cx = 0.25 * (Tx[a] + Tx[b] + Tx[c] + Tx[d]), cy = 0.25 * (Ty[a] + Ty[b] + Ty[c] + Ty[d]);
    const ix = Math.min(n - 1, Math.max(0, Math.floor(cx * n))), iy = Math.min(n - 1, Math.max(0, Math.floor(cy * n)));
    const w = (mu ? mu((i + 0.5) * h, (j + 0.5) * h) : 1) * h * h;
    acc[iy * n + ix] += w;
    area[iy * n + ix] += A;
  }
  const out = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = acc[k] * n * n; // densité (moyenne 1)
  return out;
}
