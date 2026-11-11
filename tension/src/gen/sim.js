// Dynamique de tenségrité (XPBD à petits pas). Fonctions pures, sans three.js.
//
// - nœuds : les embouts (moteurs, bobines) portent la masse ;
// - barres : contrainte de longueur exacte (rigides) ;
// - câbles : unilatéraux (ne travaillent qu'en traction), raideur k (kg/s²) ;
// - sol (y = 0) : contact du rayon de l'embout, frottement de Coulomb,
//   anisotrope pour les patins à écailles (glissent vers l'avant, accrochent
//   vers l'arrière) ;
// - amortissement visqueux léger (air, frottements internes des câbles).
//
// Un « programme » (contrôleur) fixe à chaque pas la longueur au repos des
// câbles moteurs : c'est la bobine qui enroule ou déroule.

export const GRAV = 98.1; // u/s² (1 u = 10 cm)

export function createSim(T, opt = {}) {
  const N = T.nodes.length;
  const x = new Float64Array(N * 3), v = new Float64Array(N * 3), xp = new Float64Array(N * 3), w = new Float64Array(N), rad = new Float64Array(N);
  T.nodes.forEach((nd, i) => { x.set(nd.p, i * 3); w[i] = nd.m > 0 ? 1 / nd.m : 0; rad[i] = nd.r; });
  const bars = T.bars.map((b) => ({ i: b.i, j: b.j, L: b.L ?? dist(x, b.i, b.j) }));
  const cables = T.cables.map((c) => ({ i: c.i, j: c.j, L0: c.L0 ?? dist(x, c.i, c.j), rest: c.L0 ?? dist(x, c.i, c.j), k: c.stiff ?? opt.k ?? 2500, lam: 0 }));
  // frottement : μ statique, μ dynamique ; patins : direction avant par nœud
  const mu = opt.mu ?? 0.8, muK = opt.muK ?? 0.6;
  const skid = opt.skid ?? null; // { fwd: [x, z] unitaire, front: μ vers l'avant, back: μ vers l'arrière, side: μ latéral, nodes: Set }
  const S = {
    T, N, x, v, w, rad, bars, cables, t: 0,
    gravity: opt.gravity ?? GRAV, damp: opt.damp ?? 0.6, floor: opt.floor ?? true,
    iters: opt.iters ?? 2, h: opt.h ?? 1 / 4000, inner: opt.inner ?? 40, cdamp: opt.cdamp ?? 30, struct: opt.struct ?? 6,
    contact: new Uint8Array(N),
  };

  function solveDistance(i, j, L, alpha, unilateral, c) {
    const ax = x[i * 3] - x[j * 3], ay = x[i * 3 + 1] - x[j * 3 + 1], az = x[i * 3 + 2] - x[j * 3 + 2];
    const d = Math.hypot(ax, ay, az);
    if (d < 1e-9) return;
    const C = d - L;
    if (unilateral && C <= 0) { if (c) c.lam = 0; return; }
    const ws = w[i] + w[j];
    if (ws === 0) return;
    let dl;
    if (c) {
      const at = alpha / (S.h * S.h);
      dl = (-C - at * c.lam) / (ws + at);
      c.lam += dl;
    } else dl = -C / ws;
    const nx = ax / d, ny = ay / d, nz = az / d;
    x[i * 3] += w[i] * dl * nx; x[i * 3 + 1] += w[i] * dl * ny; x[i * 3 + 2] += w[i] * dl * nz;
    x[j * 3] -= w[j] * dl * nx; x[j * 3 + 1] -= w[j] * dl * ny; x[j * 3 + 2] -= w[j] * dl * nz;
  }

  function step() {
    const h = S.h, g = S.gravity, damp = Math.exp(-S.damp * h);
    for (let i = 0; i < N; i++) {
      if (!w[i]) continue;
      v[i * 3 + 1] -= g * h;
      for (let a = 0; a < 3; a++) { v[i * 3 + a] *= damp; xp[i * 3 + a] = x[i * 3 + a]; x[i * 3 + a] += v[i * 3 + a] * h; }
    }
    for (const c of cables) c.lam = 0;
    for (let it = 0; it < S.iters; it++) {
      for (const c of cables) solveDistance(c.i, c.j, c.rest, 1 / c.k, true, c);
      for (const b of bars) solveDistance(b.i, b.j, b.L, 0, false, null);
    }
    // barres exactes (passes de plus, rigides)
    for (let k = 0; k < 2; k++) for (const b of bars) solveDistance(b.i, b.j, b.L, 0, false, null);
    if (S.floor) {
      for (let i = 0; i < N; i++) {
        const y = x[i * 3 + 1], r = rad[i];
        S.contact[i] = 0;
        if (y >= r || !w[i]) continue;
        S.contact[i] = 1;
        const pen = r - y;
        x[i * 3 + 1] = r;
        // frottement (déplacement tangentiel pendant le pas)
        let dx = x[i * 3] - xp[i * 3], dz = x[i * 3 + 2] - xp[i * 3 + 2];
        if (skid && skid.nodes.has(i)) {
          const [fx, fz] = skid.fwd(i, x);
          const along = dx * fx + dz * fz, sx = dx - along * fx, sz = dz - along * fz;
          const muA = along > 0 ? skid.front : skid.back;
          const a2 = clampFric(along, muA * pen), s2x = clampFricV(sx, sz, skid.side * pen);
          x[i * 3] -= a2 * fx + s2x[0];
          x[i * 3 + 2] -= a2 * fz + s2x[1];
        } else {
          const t = Math.hypot(dx, dz);
          if (t < mu * pen) { x[i * 3] -= dx; x[i * 3 + 2] -= dz; }
          else if (t > 0) { const k = Math.min(1, (muK * pen) / t); x[i * 3] -= dx * k; x[i * 3 + 2] -= dz * k; }
        }
      }
    }
    for (let i = 0; i < 3 * N; i++) v[i] = (x[i] - xp[i]) / h;
    // amortissement structural : on freine la vitesse de DÉFORMATION (l'écart
    // au mouvement rigide le mieux ajusté), pas le mouvement d'ensemble — une
    // chute reste une chute, les modes mous de la tenségrité s'éteignent
    if (S.struct > 0) structDamp(Math.exp(-S.struct * h));
    // pertes au contact (embouts gainés : le sol ne rend presque rien)
    if (S.floor && S.cdamp > 0) {
      const f = Math.exp(-S.cdamp * h);
      for (let i = 0; i < N; i++) if (S.contact[i]) { v[i * 3] *= f; v[i * 3 + 1] *= f; v[i * 3 + 2] *= f; }
    }
    // amortissement interne des câbles tendus (frottement dans la tresse) :
    // la vitesse relative le long du câble est freinée, pas le mouvement d'ensemble
    if (S.inner > 0) {
      const f = Math.min(1, S.inner * h);
      for (const c of cables) {
        if (c.lam === 0) continue;
        const i = c.i, j = c.j, ws = w[i] + w[j];
        if (!ws) continue;
        let nx = x[j * 3] - x[i * 3], ny = x[j * 3 + 1] - x[i * 3 + 1], nz = x[j * 3 + 2] - x[i * 3 + 2];
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const rv = (v[j * 3] - v[i * 3]) * nx + (v[j * 3 + 1] - v[i * 3 + 1]) * ny + (v[j * 3 + 2] - v[i * 3 + 2]) * nz;
        const dv = rv * f / ws;
        v[i * 3] += w[i] * dv * nx; v[i * 3 + 1] += w[i] * dv * ny; v[i * 3 + 2] += w[i] * dv * nz;
        v[j * 3] -= w[j] * dv * nx; v[j * 3 + 1] -= w[j] * dv * ny; v[j * 3 + 2] -= w[j] * dv * nz;
      }
    }
    S.t += h;
  }
  function structDamp(f) {
    let m = 0; const c = [0, 0, 0], vc = [0, 0, 0];
    for (let i = 0; i < N; i++) { if (!w[i]) continue; const mi = 1 / w[i]; m += mi; for (let a = 0; a < 3; a++) { c[a] += mi * x[i * 3 + a]; vc[a] += mi * v[i * 3 + a]; } }
    for (let a = 0; a < 3; a++) { c[a] /= m; vc[a] /= m; }
    // moment cinétique et tenseur d'inertie autour du centre
    const L = [0, 0, 0], I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      if (!w[i]) continue;
      const mi = 1 / w[i], rx = x[i * 3] - c[0], ry = x[i * 3 + 1] - c[1], rz = x[i * 3 + 2] - c[2];
      const ux = v[i * 3] - vc[0], uy = v[i * 3 + 1] - vc[1], uz = v[i * 3 + 2] - vc[2];
      L[0] += mi * (ry * uz - rz * uy); L[1] += mi * (rz * ux - rx * uz); L[2] += mi * (rx * uy - ry * ux);
      const r2 = rx * rx + ry * ry + rz * rz;
      I[0] += mi * (r2 - rx * rx); I[4] += mi * (r2 - ry * ry); I[8] += mi * (r2 - rz * rz);
      I[1] -= mi * rx * ry; I[2] -= mi * rx * rz; I[5] -= mi * ry * rz;
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    const det = I[0] * (I[4] * I[8] - I[5] * I[7]) - I[1] * (I[3] * I[8] - I[5] * I[6]) + I[2] * (I[3] * I[7] - I[4] * I[6]);
    if (Math.abs(det) < 1e-12) return;
    const inv = [
      (I[4] * I[8] - I[5] * I[7]) / det, (I[2] * I[7] - I[1] * I[8]) / det, (I[1] * I[5] - I[2] * I[4]) / det,
      (I[5] * I[6] - I[3] * I[8]) / det, (I[0] * I[8] - I[2] * I[6]) / det, (I[2] * I[3] - I[0] * I[5]) / det,
      (I[3] * I[7] - I[4] * I[6]) / det, (I[1] * I[6] - I[0] * I[7]) / det, (I[0] * I[4] - I[1] * I[3]) / det,
    ];
    const om = [inv[0] * L[0] + inv[1] * L[1] + inv[2] * L[2], inv[3] * L[0] + inv[4] * L[1] + inv[5] * L[2], inv[6] * L[0] + inv[7] * L[1] + inv[8] * L[2]];
    for (let i = 0; i < N; i++) {
      if (!w[i]) continue;
      const rx = x[i * 3] - c[0], ry = x[i * 3 + 1] - c[1], rz = x[i * 3 + 2] - c[2];
      const rvx = vc[0] + om[1] * rz - om[2] * ry, rvy = vc[1] + om[2] * rx - om[0] * rz, rvz = vc[2] + om[0] * ry - om[1] * rx;
      v[i * 3] = rvx + (v[i * 3] - rvx) * f; v[i * 3 + 1] = rvy + (v[i * 3 + 1] - rvy) * f; v[i * 3 + 2] = rvz + (v[i * 3 + 2] - rvz) * f;
    }
  }
  // (frottement sur une composante : on retire au plus μ·pénétration du glissement ;
  //  s'il est plus petit, l'adhérence l'annule entièrement)
  const clampFric = (d, lim) => (Math.abs(d) <= lim ? d : Math.sign(d) * lim);
  const clampFricV = (dx, dz, lim) => { const t = Math.hypot(dx, dz); if (t <= lim || t === 0) return [dx, dz]; return [dx * lim / t, dz * lim / t]; };

  S.step = step;
  S.run = (dt, ctrl) => { const n = Math.round(dt / S.h); for (let s = 0; s < n; s++) { ctrl?.(S); step(); } };
  S.com = () => { let m = 0, cx = 0, cy = 0, cz = 0; for (let i = 0; i < N; i++) { const mi = w[i] ? 1 / w[i] : 0; m += mi; cx += x[i * 3] * mi; cy += x[i * 3 + 1] * mi; cz += x[i * 3 + 2] * mi; } return [cx / m, cy / m, cz / m]; };
  S.kinetic = () => { let e = 0; for (let i = 0; i < N; i++) if (w[i]) e += 0.5 / w[i] * (v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2); return e; };
  S.tension = (c) => Math.max(0, dist(x, c.i, c.j) - c.rest) * c.k;
  S.snapshot = () => ({ x: Float64Array.from(x), v: Float64Array.from(v), t: S.t, rest: cables.map((c) => c.rest) });
  S.restore = (s) => { x.set(s.x); v.set(s.v); S.t = s.t; s.rest.forEach((r, i) => (cables[i].rest = r)); };
  return S;
}

export function dist(x, i, j) {
  return Math.hypot(x[i * 3] - x[j * 3], x[i * 3 + 1] - x[j * 3 + 1], x[i * 3 + 2] - x[j * 3 + 2]);
}

// Recherche de forme : sans gravité ni sol, câbles raccourcis d'un facteur
// (précontrainte), forte viscosité, jusqu'au repos. Rend la topologie avec
// ses positions d'équilibre et les longueurs au repos des câbles.
export function formFind(T, { pre = 0.04, k = 2500, time = 3, h = 1 / 6000 } = {}) {
  const S = createSim(T, { gravity: 0, floor: false, damp: 12, k, h });
  S.cables.forEach((c, i) => (c.rest = c.L0 * (1 - (T.cables[i].pre ?? pre))));
  S.run(time);
  // les longueurs au repos des câbles valent (1 − pre) fois leur longueur initiale ;
  // la forme a bougé : on garde ces longueurs au repos et les nouvelles positions
  const out = { ...T, nodes: T.nodes.map((nd, i) => ({ ...nd, p: [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]] })) };
  out.bars = T.bars.map((b, i) => ({ ...b, L: S.bars[i].L }));
  out.cables = T.cables.map((c, i) => ({ ...c, L0: S.cables[i].rest, stiff: k }));
  out.residual = Math.sqrt(S.kinetic());
  return out;
}

// ── Recalage rigide dans le plan (Kabsch 2D sur x, z) ───────────────────────
// Trouve le lacet θ et la translation (tx, tz) qui envoient B sur A au mieux.
export function alignPlanar(A, B, N) {
  let ax = 0, az = 0, bx = 0, bz = 0;
  for (let i = 0; i < N; i++) { ax += A[i * 3]; az += A[i * 3 + 2]; bx += B[i * 3]; bz += B[i * 3 + 2]; }
  ax /= N; az /= N; bx /= N; bz /= N;
  let sxx = 0, sxz = 0;
  for (let i = 0; i < N; i++) {
    const px = B[i * 3] - bx, pz = B[i * 3 + 2] - bz, qx = A[i * 3] - ax, qz = A[i * 3 + 2] - az;
    sxx += px * qx + pz * qz; sxz += px * qz - pz * qx;
  }
  const th = Math.atan2(sxz, sxx), c = Math.cos(th), s = Math.sin(th);
  // B → A : rotation de θ autour de y (dans le plan x, z : (x, z) → (c x − s z, s x + c z)), puis translation
  const tx = ax - (c * bx - s * bz), tz = az - (s * bx + c * bz);
  return { th, tx, tz, c, s };
}
export function applyPlanar(P, N, { c, s, tx, tz }, out = new Float64Array(N * 3)) {
  for (let i = 0; i < N; i++) {
    const px = P[i * 3], pz = P[i * 3 + 2];
    out[i * 3] = c * px - s * pz + tx; out[i * 3 + 1] = P[i * 3 + 1]; out[i * 3 + 2] = s * px + c * pz + tz;
  }
  return out;
}
export function rms(A, B, N) {
  let e = 0;
  for (let i = 0; i < 3 * N; i++) e += (A[i] - B[i]) ** 2;
  return Math.sqrt(e / N);
}

// ── Recalage rigide 3D (Horn : quaternion propre de la matrice de covariance) ──
// rend { q: [w, x, y, z], R (3×3, lignes), t } qui envoie B (permuté par perm) sur A.
export function align3D(A, B, N, perm = null) {
  let ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < N; i++) { const j = perm ? perm[i] : i; for (let a = 0; a < 3; a++) { ca[a] += A[i * 3 + a] / N; cb[a] += B[j * 3 + a] / N; } }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < N; i++) {
    const j = perm ? perm[i] : i;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += (B[j * 3 + a] - cb[a]) * (A[i * 3 + b] - ca[b]);
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const K = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  // plus grande valeur propre : itération de la puissance sur K + c·I
  const c = Math.abs(xx) + Math.abs(yy) + Math.abs(zz) + Math.abs(xy) + Math.abs(xz) + Math.abs(yx) + Math.abs(yz) + Math.abs(zx) + Math.abs(zy) + 1e-9;
  let q = [1, 0.1, 0.2, 0.3];
  for (let it = 0; it < 200; it++) {
    const r = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { r[a] = c * q[a]; for (let b = 0; b < 4; b++) r[a] += K[a][b] * q[b]; }
    const l = Math.hypot(...r); q = r.map((v) => v / l);
  }
  const [w, x, y, z] = q;
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const t = [0, 1, 2].map((a) => ca[a] - (R[a][0] * cb[0] + R[a][1] * cb[1] + R[a][2] * cb[2]));
  let e = 0;
  for (let i = 0; i < N; i++) {
    const j = perm ? perm[i] : i;
    for (let a = 0; a < 3; a++) { const p = R[a][0] * B[j * 3] + R[a][1] * B[j * 3 + 1] + R[a][2] * B[j * 3 + 2] + t[a]; e += (p - A[i * 3 + a]) ** 2; }
  }
  return { q, R, t, rms: Math.sqrt(e / N) };
}

// Kabsch dans le plan avec correspondances : Rot(θ)·A[i] + t ≈ B[perm[i]]
// (rotation autour de y : (x, z) → (c x − s z, s x + c z)) ; rend aussi l'écart quadratique
export function planarFit(A, B, N, perm = null) {
  const P = (i) => (perm ? perm[i] : i);
  let ax = 0, az = 0, bx = 0, bz = 0;
  for (let i = 0; i < N; i++) { const j = P(i); ax += A[i * 3]; az += A[i * 3 + 2]; bx += B[j * 3]; bz += B[j * 3 + 2]; }
  ax /= N; az /= N; bx /= N; bz /= N;
  let sc = 0, ss = 0;
  for (let i = 0; i < N; i++) {
    const j = P(i), px = A[i * 3] - ax, pz = A[i * 3 + 2] - az, qx = B[j * 3] - bx, qz = B[j * 3 + 2] - bz;
    sc += px * qx + pz * qz; ss += px * qz - pz * qx;
  }
  const th = Math.atan2(ss, sc), c = Math.cos(th), s = Math.sin(th);
  const t = [bx - (c * ax - s * az), bz - (s * ax + c * az)];
  let e = 0;
  for (let i = 0; i < N; i++) {
    const j = P(i), x = c * A[i * 3] - s * A[i * 3 + 2] + t[0], z = s * A[i * 3] + c * A[i * 3 + 2] + t[1];
    e += (x - B[j * 3]) ** 2 + (A[i * 3 + 1] - B[j * 3 + 1]) ** 2 + (z - B[j * 3 + 2]) ** 2;
  }
  return { th, c, s, t, rms: Math.sqrt(e / N) };
}
