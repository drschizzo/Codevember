// Minimisation sans contrainte : L-BFGS (mémoire courte), recherche linéaire
// par rebroussement d'Armijo. f(x, g) renvoie la valeur et écrit le gradient ;
// Infinity (collision) est traité comme un pas trop long.
//
// Préconditionnement : diag (facultatif) approche l'inverse de la diagonale
// du hessien ; il sert de matrice initiale, mise à l'échelle à chaque pas.

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const maxAbs = (a) => { let s = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > s) s = v; } return s; };

export function lbfgs(f, x0, { maxIter = 2000, memory = 10, gtol = 1e-9, onIter = null, iterStride = 25, diag = null } = {}) {
  const n = x0.length;
  let x = Float64Array.from(x0), g = new Float64Array(n);
  let xn = new Float64Array(n), gn = new Float64Array(n);
  const d = new Float64Array(n), q = new Float64Array(n);
  let fx = f(x, g), evals = 1;
  if (!Number.isFinite(fx)) return { x, f: fx, gnorm: Infinity, iters: 0, evals, status: 'collision' };
  const S = [], Y = [], R = [], alpha = new Float64Array(memory);
  let iters = 0, stall = 0, status = 'maxiter';

  for (; iters < maxIter; iters++) {
    const gnorm = maxAbs(g);
    if (gnorm < gtol) { status = 'converged'; break; }
    if (onIter && iters % iterStride === 0) onIter(iters, fx, gnorm, x);

    // direction : produit par l'inverse approché du hessien (double boucle)
    q.set(g);
    for (let i = S.length - 1; i >= 0; i--) {
      const a = R[i] * dot(S[i], q); alpha[i] = a;
      for (let j = 0; j < n; j++) q[j] -= a * Y[i][j];
    }
    const L = S.length;
    let gamma;
    if (!L) gamma = 1e-2 / Math.max(1, gnorm);
    else if (diag) {
      let yDy = 0; const y = Y[L - 1];
      for (let j = 0; j < n; j++) yDy += y[j] * y[j] * diag[j];
      gamma = dot(S[L - 1], y) / yDy;
    } else gamma = dot(S[L - 1], Y[L - 1]) / dot(Y[L - 1], Y[L - 1]);
    for (let j = 0; j < n; j++) q[j] *= diag ? gamma * diag[j] : gamma;
    for (let i = 0; i < L; i++) {
      const b = R[i] * dot(Y[i], q);
      for (let j = 0; j < n; j++) q[j] += S[i][j] * (alpha[i] - b);
    }
    for (let j = 0; j < n; j++) d[j] = -q[j];
    let dg = dot(d, g);
    if (!(dg < 0)) { // pas une direction de descente : on oublie la mémoire
      S.length = 0; Y.length = 0; R.length = 0;
      const s = 1e-2 / Math.max(1, gnorm);
      for (let j = 0; j < n; j++) d[j] = -g[j] * s;
      dg = dot(d, g);
    }

    let step = 1, fn = Infinity, ok = false;
    for (let ls = 0; ls < 50; ls++) {
      for (let j = 0; j < n; j++) xn[j] = x[j] + step * d[j];
      fn = f(xn, gn); evals++;
      if (fn <= fx + 1e-4 * step * dg) { ok = true; break; }
      step *= 0.5;
    }
    if (!ok) {
      if (S.length) { S.length = 0; Y.length = 0; R.length = 0; continue; }
      status = 'linesearch'; break;
    }

    const s = new Float64Array(n), y = new Float64Array(n);
    for (let j = 0; j < n; j++) { s[j] = xn[j] - x[j]; y[j] = gn[j] - g[j]; }
    const sy = dot(s, y);
    if (sy > 1e-16 * Math.sqrt(dot(s, s) * dot(y, y))) {
      S.push(s); Y.push(y); R.push(1 / sy);
      if (S.length > memory) { S.shift(); Y.shift(); R.shift(); }
    }
    const df = fx - fn;
    [x, xn] = [xn, x]; [g, gn] = [gn, g]; fx = fn;
    stall = df <= 1e-15 * Math.abs(fx) ? stall + 1 : 0;
    if (stall > 30) { status = 'stalled'; break; }
  }
  return { x, f: fx, gnorm: maxAbs(g), iters, evals, status };
}
