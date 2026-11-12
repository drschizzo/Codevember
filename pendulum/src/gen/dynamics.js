// Dynamique exacte d'une chaîne plane de n maillons dont UNE coordonnée est
// imposée par la machine (module pur, sans three.js : importé par le worker,
// les tests et les démos de la page « défis techniques »).
//
// Les maillons sont des pendules composés (masse m, centre de gravité à c du
// pivot, inertie J autour du centre de gravité, longueur l d'un pivot au
// suivant). Les angles absolus θ sont comptés depuis la verticale descendante
// (θ = 0 : pend ; θ = ±π : debout), dans le sens direct vu de face.
//
// Chaque machine impose une coordonnée s(t), dont elle choisit l'accélération
// u = s̈ (la commande) :
//   cart   : position horizontale du pivot (le chariot sur son rail) ;
//   rotary : angle d'un bras horizontal qui porte la chaîne à son extrémité
//            (pendule de Furuta) : le pivot va à r·φ̇, et la rotation ajoute
//            un terme centrifuge ½ φ̇² ∂W/∂θ, W = ∫ w² dm (w : distance de la
//            matière au plan vertical du bras) ;
//   elbow  : angle relatif à l'articulation `joint` (Acrobot : le moteur au
//            coude, l'épaule libre) ;
//   wheel  : angle d'un volant d'inertie Iw porté par le dernier maillon,
//            relatif à lui (pendule à roue d'inertie) ;
//   vert   : hauteur du pivot (Kapitza).
//
// Les angles absolus s'écrivent θ = A·q + b·s, q les coordonnées libres. Les
// équations de Lagrange de la chaîne, ligne j :
//   Σ_k h_jk cos(θ_j − θ_k) θ̈_k + Σ_k h_jk sin(θ_j − θ_k) θ̇_k²
//     + (g + ÿ) μ_j sin θ_j + μ_j cos θ_j ẍ  (+ rotor, + centrifuge) = Q_j,
// avec μ_k = m_k c_k + l_k Σ_{i>k} m_i (premier moment de tout ce qui pend
// au-delà du pivot k), h_kk = J_k + m_k c_k² + l_k² Σ_{i>k} m_i,
// h_jk = l_j μ_k (j < k). Le moteur ne travaille que le long de b : projetées
// par Aᵀ, ses forces disparaissent, il reste
//   (Aᵀ M A) q̈ = −Aᵀ (M b u + reste).
export const G0 = 9.81;

export function makeSystem(spec) {
  const { kind } = spec;
  const n = spec.links.length, g = spec.g ?? G0;
  const l = spec.links.map((L) => L.l), c = spec.links.map((L) => L.c), m = spec.links.map((L) => L.m), J = spec.links.map((L) => L.J);
  const mu = new Float64Array(n), h = new Float64Array(n * n), mc = new Float64Array(n), Ip = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let beyond = 0;
    for (let i = k + 1; i < n; i++) beyond += m[i];
    mu[k] = m[k] * c[k] + l[k] * beyond;
    h[k * n + k] = J[k] + m[k] * c[k] * c[k] + l[k] * l[k] * beyond;
    mc[k] = m[k] * c[k];
    Ip[k] = J[k] + m[k] * c[k] * c[k];
  }
  for (let j = 0; j < n; j++) for (let k = j + 1; k < n; k++) h[j * n + k] = h[k * n + j] = l[j] * mu[k];

  // θ = A q + b s
  let np = n;
  const A = [], b = new Float64Array(n);
  if (kind === 'elbow') {
    const jt = spec.joint ?? 1; // (articulation menée : entre le maillon jt−1 et jt)
    np = n - 1;
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(np);
      if (i < jt) row[i] = 1;
      else if (i === jt) row[jt - 1] = 1;
      else row[i - 1] = 1;
      A.push(row);
    }
    b[jt] = 1;
  } else {
    for (let i = 0; i < n; i++) { const row = new Float64Array(n); row[i] = 1; A.push(row); }
  }
  const Iw = kind === 'wheel' ? spec.Iw : 0, radius = kind === 'rotary' ? spec.radius : 0;
  const nx = 2 * np + 2;

  const th = new Float64Array(n), thd = new Float64Array(n), Mt = new Float64Array(n * n), rest = new Float64Array(n);
  const Mq = new Float64Array(np * np), rq = new Float64Array(np), qdd = new Float64Array(np);
  const sn = new Float64Array(n), cs = new Float64Array(n), aa = new Float64Array(n);

  function angles(x, outTh = th, outThd = thd) {
    const s = x[2 * np], sd = x[2 * np + 1];
    for (let i = 0; i < n; i++) {
      let a = b[i] * s, ad = b[i] * sd;
      const row = A[i];
      for (let k = 0; k < np; k++) { a += row[k] * x[k]; ad += row[k] * x[np + k]; }
      outTh[i] = a; outThd[i] = ad;
    }
    return outTh;
  }

  // dérivée de l'état x = [q, q̇, s, ṡ] sous la commande u = s̈
  function f(x, u, out) {
    angles(x);
    const ax = kind === 'cart' ? u : kind === 'rotary' ? radius * u : 0;
    const ay = kind === 'vert' ? u : 0;
    for (let j = 0; j < n; j++) { sn[j] = Math.sin(th[j]); cs[j] = Math.cos(th[j]); }
    for (let j = 0; j < n; j++) {
      let r = 0;
      for (let k = 0; k < n; k++) {
        const hj = h[j * n + k];
        // cos(θj − θk), sin(θj − θk) sans appel trigonométrique
        const cd = cs[j] * cs[k] + sn[j] * sn[k], sd = sn[j] * cs[k] - cs[j] * sn[k];
        Mt[j * n + k] = hj * cd;
        r += hj * sd * thd[k] * thd[k];
      }
      rest[j] = r + (g + ay) * mu[j] * sn[j] + mu[j] * cs[j] * ax;
    }
    if (kind === 'wheel') { Mt[(n - 1) * n + n - 1] += Iw; rest[n - 1] += Iw * u; }
    if (kind === 'rotary') {
      // − ½ φ̇² ∂W/∂θ_j ; W = Σ_i m_i a_i² + 2 a_i s_i m_i c_i + I_i s_i²
      const pd2 = x[2 * np + 1] * x[2 * np + 1];
      let a = 0;
      for (let i = 0; i < n; i++) { aa[i] = a; a += l[i] * sn[i]; }
      for (let j = 0; j < n; j++) {
        let d = 0;
        for (let i = 0; i < n; i++) {
          const da = j < i ? l[j] * cs[j] : 0, ds = j === i ? cs[j] : 0;
          d += 2 * m[i] * aa[i] * da + 2 * mc[i] * (da * sn[i] + aa[i] * ds) + 2 * Ip[i] * sn[i] * ds;
        }
        rest[j] -= 0.5 * pd2 * d;
      }
    }
    // + M b u (la part imposée de l'accélération)
    for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += Mt[j * n + k] * b[k]; rest[j] += s * u; }
    for (let p = 0; p < np; p++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += A[j][p] * rest[j];
      rq[p] = -s;
      for (let q = 0; q < np; q++) {
        let t = 0;
        for (let j = 0; j < n; j++) { const Ajp = A[j][p]; if (!Ajp) continue; for (let k = 0; k < n; k++) t += Ajp * Mt[j * n + k] * A[k][q]; }
        Mq[p * np + q] = t;
      }
    }
    solveInPlace(Mq, rq, qdd, np);
    for (let k = 0; k < np; k++) { out[k] = x[np + k]; out[np + k] = qdd[k]; }
    out[2 * np] = x[2 * np + 1];
    out[2 * np + 1] = u;
    return out;
  }

  // énergie mécanique de la chaîne (pivot immobile) : contrôle de l'intégrateur
  function energy(x) {
    angles(x);
    let T = 0, V = 0;
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) T += 0.5 * h[j * n + k] * Math.cos(th[j] - th[k]) * thd[j] * thd[k];
      V -= g * mu[j] * Math.cos(th[j]);
    }
    if (kind === 'wheel') T += 0.5 * Iw * (thd[n - 1] + x[2 * np + 1]) ** 2;
    return T + V;
  }

  // état au repos d'un équilibre (angles absolus des maillons, s)
  function restState(thetaAbs, s = 0) {
    const x = new Float64Array(nx);
    if (kind === 'elbow') {
      const jt = spec.joint ?? 1;
      for (let i = 0, k = 0; i < n; i++) { if (i === jt) continue; x[k++] = thetaAbs[i]; }
      // (θ_jt = θ_{jt−1} + s : s est fixé par l'équilibre)
      x[2 * np] = thetaAbs[jt] - thetaAbs[jt - 1];
    } else {
      for (let i = 0; i < n; i++) x[i] = thetaAbs[i];
      x[2 * np] = s;
    }
    return x;
  }

  return { kind, n, np, nx, f, energy, angles, restState, A, b, mu, h, spec };
}

// Gauss avec pivot partiel, sur place (matrice n×n en ligne)
export function solveInPlace(M, r, x, n) {
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k * n + i]) > Math.abs(M[p * n + i])) p = k;
    if (p !== i) {
      for (let k = 0; k < n; k++) { const t = M[i * n + k]; M[i * n + k] = M[p * n + k]; M[p * n + k] = t; }
      const t = r[i]; r[i] = r[p]; r[p] = t;
    }
    const d = M[i * n + i];
    for (let k = i + 1; k < n; k++) {
      const fk = M[k * n + i] / d;
      if (!fk) continue;
      for (let j = i; j < n; j++) M[k * n + j] -= fk * M[i * n + j];
      r[k] -= fk * r[i];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = r[i];
    for (let k = i + 1; k < n; k++) s -= M[i * n + k] * x[k];
    x[i] = s / M[i * n + i];
  }
  return x;
}

// Un pas de Runge-Kutta 4 sous une commande affine sur le pas (ua → ub)
export function rk4Step(sys, x, ua, ub, hs, w) {
  const { nx } = sys, um = 0.5 * (ua + ub);
  const { k1, k2, k3, k4, t } = w;
  sys.f(x, ua, k1);
  for (let j = 0; j < nx; j++) t[j] = x[j] + 0.5 * hs * k1[j];
  sys.f(t, um, k2);
  for (let j = 0; j < nx; j++) t[j] = x[j] + 0.5 * hs * k2[j];
  sys.f(t, um, k3);
  for (let j = 0; j < nx; j++) t[j] = x[j] + hs * k3[j];
  sys.f(t, ub, k4);
  for (let j = 0; j < nx; j++) x[j] += (hs / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
  return x;
}
export const rkWork = (nx) => ({ k1: new Float64Array(nx), k2: new Float64Array(nx), k3: new Float64Array(nx), k4: new Float64Array(nx), t: new Float64Array(nx) });
