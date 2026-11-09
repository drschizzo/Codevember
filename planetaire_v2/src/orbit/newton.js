// Newton–Krylov : trouve un point critique de l'action quel que soit son
// indice (minimum ou point selle), là où une descente ne trouve que des
// minima. Chaque pas résout H·δ = −∇A par MINRES (le hessien H est
// symétrique, indéfini, et singulier : décalage du temps et rotation laissent
// l'action invariante) ; les produits H·v sont des différences centrées du
// gradient exact. Préconditionnement diagonal en 1/k² (l'énergie cinétique
// domine la courbure des harmoniques hautes).
//
// Globalisation : recherche linéaire sur ½‖∇A‖² pondérée par le
// préconditionneur ; c'est une direction de descente pour cette mesure dès
// que H·δ ≈ −∇A.

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const maxAbs = (a) => { let s = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > s) s = v; } return s; };

// MINRES préconditionné (Paige–Saunders) : A·x = b, A symétrique (via op),
// Minv : inverse du préconditionneur diagonal (définie positive)
export function minres(op, b, Minv, { tol = 1e-8, maxIter = 300 } = {}) {
  const n = b.length;
  const x = new Float64Array(n), r1 = Float64Array.from(b), r2 = Float64Array.from(b);
  let y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = Minv[i] * r1[i];
  const beta1 = Math.sqrt(dot(r1, y));
  if (!(beta1 > 0)) return { x, iters: 0, rel: 0 };
  let beta = beta1, oldb = 0, dbar = 0, epsln = 0, phibar = beta1, cs = -1, sn = 0;
  let w = new Float64Array(n), w1 = new Float64Array(n), w2 = new Float64Array(n);
  const v = new Float64Array(n), Av = new Float64Array(n);
  let it = 0;
  for (it = 1; it <= maxIter; it++) {
    const s = 1 / beta;
    for (let i = 0; i < n; i++) v[i] = s * y[i];
    op(v, Av);
    y = Float64Array.from(Av);
    if (it >= 2) { const f = beta / oldb; for (let i = 0; i < n; i++) y[i] -= f * r1[i]; }
    const alfa = dot(v, y);
    { const f = alfa / beta; for (let i = 0; i < n; i++) y[i] -= f * r2[i]; }
    r1.set(r2); r2.set(y);
    for (let i = 0; i < n; i++) y[i] = Minv[i] * r2[i];
    oldb = beta;
    beta = Math.sqrt(Math.max(0, dot(r2, y)));
    const oldeps = epsln;
    const delta = cs * dbar + sn * alfa;
    const gbar = sn * dbar - cs * alfa;
    epsln = sn * beta;
    dbar = -cs * beta;
    const gamma = Math.max(Math.hypot(gbar, beta), 1e-300);
    cs = gbar / gamma; sn = beta / gamma;
    const phi = cs * phibar;
    phibar = sn * phibar;
    [w1, w2, w] = [w2, w, w1];
    for (let i = 0; i < n; i++) w[i] = (v[i] - oldeps * w1[i] - delta * w2[i]) / gamma;
    for (let i = 0; i < n; i++) x[i] += phi * w[i];
    if (phibar < tol * beta1 || beta === 0) break;
  }
  return { x, iters: it, rel: phibar / beta1 };
}

// Newton globalisé sur f (action : valeur et gradient), à partir de x0
export function newton(f, x0, precond, { gtol = 1e-9, maxIter = 30, krylov = 200, onIter = null } = {}) {
  const n = x0.length;
  let x = Float64Array.from(x0), g = new Float64Array(n);
  const gp = new Float64Array(n), gm = new Float64Array(n), xt = new Float64Array(n), gt = new Float64Array(n);
  const merit = (gg) => { let s = 0; for (let i = 0; i < n; i++) s += gg[i] * gg[i] * precond[i]; return 0.5 * s; };
  let fx = f(x, g), evals = 1, iters = 0, status = 'maxiter';
  if (!Number.isFinite(fx)) return { x, f: fx, gnorm: Infinity, iters, evals, status: 'collision' };
  let m = merit(g);
  const xnorm = () => Math.sqrt(dot(x, x) / n) || 1;
  // produit hessien–vecteur par différences centrées du gradient
  const op = (v, out) => {
    const vn = Math.sqrt(dot(v, v)) || 1, h = (1e-5 * xnorm()) / vn;
    for (let i = 0; i < n; i++) xt[i] = x[i] + h * v[i];
    const a = f(xt, gp);
    for (let i = 0; i < n; i++) xt[i] = x[i] - h * v[i];
    const b = f(xt, gm);
    evals += 2;
    if (!Number.isFinite(a) || !Number.isFinite(b)) { out.fill(NaN); return; }
    for (let i = 0; i < n; i++) out[i] = (gp[i] - gm[i]) / (2 * h);
  };
  for (; iters < maxIter; iters++) {
    const gn = maxAbs(g);
    if (onIter) onIter(iters, fx, gn, x);
    if (gn < gtol) { status = 'converged'; break; }
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) rhs[i] = -g[i];
    const { x: d } = minres(op, rhs, precond, { tol: 1e-6, maxIter: krylov });
    if (d.some((v) => !Number.isFinite(v))) { status = 'krylov'; break; }
    let step = 1, ok = false, ft = 0;
    for (let ls = 0; ls < 30; ls++) {
      for (let i = 0; i < n; i++) xt[i] = x[i] + step * d[i];
      ft = f(xt, gt); evals++;
      if (Number.isFinite(ft) && merit(gt) <= (1 - 1e-4 * step) * m) { ok = true; break; }
      step *= 0.5;
    }
    if (!ok) { status = 'linesearch'; break; }
    x = Float64Array.from(xt); g.set(gt); fx = ft; m = merit(g);
  }
  return { x, f: fx, gnorm: maxAbs(g), iters, evals, status };
}
