// Tiges de Cosserat discrètes, intégrées par XPBD à petits pas
// (Kugelstadt & Schömer 2016, « Position and Orientation Based Cosserat Rods » ;
// Macklin et al. 2019, « Small Steps in Physics Simulation »).
//
// Chaque brin : n + 1 sommets (positions) et n segments, chacun portant un
// repère matériel (quaternion : d1, d2 dans la section, d3 le long de l'axe).
// Contraintes :
//  - étirement-cisaillement : (p[i+1] − p[i]) / l = d3(q[i]) (inextensible) ;
//  - flexion-torsion : vecteur de Darboux Ω = (2/l)·Im(q̄[i] q[i+1]), énergie
//    ½·l·(B1 Ω1² + B2 Ω2² + C Ω3²) (souplesse XPBD) ;
//  - encastrement en haut dans le mandrin (position et repère imposés), en bas
//    dans le volant, qui a deux degrés de liberté : sa hauteur (il pend à la
//    corde, son axe coulisse dans un fourreau) et son angle (bloqué par la
//    barre, ou libre et freiné par ses ailettes) ;
//  - contacts entre segments (capsules), frottement de position.
//
// Unités SI (m, kg, s). Module pur : importable depuis Node (tests, bancs).
// Déterministe : même entrée, même sortie (aucun hasard, ordre fixe).

const G0 = 9.81;

// ── Quaternions (x, y, z, w) dans des Float64Array, à l'indice o ─────────────
// d3 = q e3 q̄ ; d1 = q e1 q̄ ; d2 = q e2 q̄
function axis(q, o, k, out) {
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
  if (k === 0) { out[0] = 1 - 2 * (y * y + z * z); out[1] = 2 * (x * y + w * z); out[2] = 2 * (x * z - w * y); }
  else if (k === 1) { out[0] = 2 * (x * y - w * z); out[1] = 1 - 2 * (x * x + z * z); out[2] = 2 * (y * z + w * x); }
  else { out[0] = 2 * (x * z + w * y); out[1] = 2 * (y * z - w * x); out[2] = 1 - 2 * (x * x + y * y); }
  return out;
}
// q ← normalise(q + ½·[θ, 0] ⊗ q) : petite rotation θ (repère du monde)
// (rotation bornée à 0,2 rad par appel : un repère ne tourne jamais d'un
// demi-tour en un pas, même quand une contrainte réclame une grande correction)
function rotate(q, o, tx, ty, tz) {
  const m = Math.hypot(tx, ty, tz);
  if (m > 0.2) { const f = 0.2 / m; tx *= f; ty *= f; tz *= f; }
  const x = q[o], y = q[o + 1], z = q[o + 2], w = q[o + 3];
  const nx = x + 0.5 * (tx * w + ty * z - tz * y);
  const ny = y + 0.5 * (ty * w + tz * x - tx * z);
  const nz = z + 0.5 * (tz * w + tx * y - ty * x);
  const nw = w - 0.5 * (tx * x + ty * y + tz * z);
  const s = 1 / Math.hypot(nx, ny, nz, nw);
  q[o] = nx * s; q[o + 1] = ny * s; q[o + 2] = nz * s; q[o + 3] = nw * s;
}
// rotation d'angle a autour de +y, composée à gauche : R_y(a) ⊗ q0
export function yRot(a, q0, out = new Float64Array(4)) {
  const s = Math.sin(a / 2), c = Math.cos(a / 2);
  const [x, y, z, w] = q0;
  out[0] = c * x + s * z; out[1] = c * y + s * w; out[2] = c * z - s * x; out[3] = c * w - s * y;
  return out;
}
// repère au repos d'un segment qui descend : d1 = x, d2 = z, d3 = −y
export const Q_DOWN = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

// ── Distance entre deux segments [a0,a1], [b0,b1] (points les plus proches) ──
function closest(P, a0, a1, b0, b1, out) {
  const ux = P[a1] - P[a0], uy = P[a1 + 1] - P[a0 + 1], uz = P[a1 + 2] - P[a0 + 2];
  const vx = P[b1] - P[b0], vy = P[b1 + 1] - P[b0 + 1], vz = P[b1 + 2] - P[b0 + 2];
  const wx = P[a0] - P[b0], wy = P[a0 + 1] - P[b0 + 1], wz = P[a0 + 2] - P[b0 + 2];
  const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let s, t;
  if (D < 1e-14) { s = 0; t = c > 1e-14 ? e / c : 0; }
  else { s = (b * e - c * d) / D; t = (a * e - b * d) / D; }
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  t = c > 1e-14 ? (b * s + e) / c : 0;
  if (t < 0) { t = 0; s = a > 1e-14 ? -d / a : 0; } else if (t > 1) { t = 1; s = a > 1e-14 ? (b - d) / a : 0; }
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  out[0] = s; out[1] = t;
  out[2] = wx + s * ux - t * vx; out[3] = wy + s * uy - t * vy; out[4] = wz + s * uz - t * vz;
  return out;
}

// ── Création ─────────────────────────────────────────────────────────────────
// spec : {
//   strands: [{ top: [x, y, z] (dans le repère du mandrin), bottom: [x, y, z]
//              (dans le repère du volant), n }],
//   L (longueur d'un brin), r (rayon de contact), mu (masse linéique),
//   B1, B2, C (raideurs de flexion et de torsion, N·m²),
//   fly: { M (masse), I (inertie), drag (couple c·ω|ω|), friction (b·ω), y0 (hauteur au repos du point d'attache, calculée), yMin },
//   topY (hauteur du mandrin), damp (amortissement de l'air, 1/s), dampW (angulaire, 1/s),
//   friction (frottement de contact), substeps (par seconde)
// }
export function createRod(spec) {
  const S = spec.strands.length;
  const nSeg = spec.strands.map((s) => s.n);
  const vOff = [], sOff = [];
  let nv = 0, ns = 0;
  for (let k = 0; k < S; k++) { vOff.push(nv); sOff.push(ns); nv += nSeg[k] + 1; ns += nSeg[k]; }
  const L = spec.L, l = nSeg.map((n) => L / n);
  const P = new Float64Array(nv * 3), Pp = new Float64Array(nv * 3), V = new Float64Array(nv * 3), W = new Float64Array(nv);
  const Q = new Float64Array(ns * 4), Qp = new Float64Array(ns * 4), Om = new Float64Array(ns * 3), WQ = new Float64Array(ns);
  const segStrand = new Int32Array(ns), segIdx = new Int32Array(ns), segV = new Int32Array(ns);
  // courbure naturelle (le pli que garde une corde sortie de sa bobine) :
  // petite, lisse, déterministe ; c'est elle qui choisit où la boucle naît
  const O0 = new Float64Array(ns * 2);
  for (let k = 0; k < S; k++) for (let i = 0; i < nSeg[k]; i++) {
    const s = i / nSeg[k], ph = (spec.imperfection?.phase ?? 0) + k * 1.7;
    const a = (spec.imperfection?.kappa ?? 0.6) * (0.6 + 0.4 * Math.sin(2 * Math.PI * (1.3 * s + 0.21 * ph)));
    O0[(sOff[k] + i) * 2] = a * Math.cos(ph + 2.1 * s);
    O0[(sOff[k] + i) * 2 + 1] = a * Math.sin(ph + 2.1 * s);
  }
  const fly = { y: 0, vy: 0, yp: 0, phi: 0, w: 0, phip: 0, locked: true, lockPhi: 0, detent: 0, ...spec.fly };
  const topY = spec.topY, G = spec.g ?? G0;

  // pose au repos : brins verticaux, de leur point d'attache en haut à celui du bas
  for (let k = 0; k < S; k++) {
    const st = spec.strands[k], n = nSeg[k], m = spec.mu * l[k];
    for (let i = 0; i <= n; i++) {
      const t = i / n, j = (vOff[k] + i) * 3;
      P[j] = st.top[0] + (st.bottom[0] - st.top[0]) * t;
      P[j + 2] = st.top[2] + (st.bottom[2] - st.top[2]) * t;
      P[j + 1] = topY + st.top[1] - L * t; // (tendu : la longueur du brin)
      W[vOff[k] + i] = i <= 1 ? 0 : 1 / (m * (i >= n - 1 ? 0.5 : 1)); // (sommets 0 et 1 : dans les mors du mandrin ; n − 1 et n : dans la pince du volant)
    }
    const I = m * (l[k] * l[k] / 12 + spec.r * spec.r / 4) * (spec.inertiaScale ?? 1);
    for (let i = 0; i < n; i++) {
      const j = sOff[k] + i;
      Q.set(Q_DOWN, j * 4);
      WQ[j] = 1 / I;
      segStrand[j] = k; segIdx[j] = i; segV[j] = vOff[k] + i;
    }
  }
  // hauteur du volant : attache du bas (repère du volant) sous le dernier sommet
  fly.attachY = spec.strands[0].bottom[1];
  fly.y = topY + spec.strands[0].top[1] - L - fly.attachY;
  fly.yp = fly.y;

  const state = { P, Q, fly, t: 0, theta: 0, contacts: 0, railAngle: 0 };
  const tmp = new Float64Array(8), d3 = new Float64Array(3), ax = new Float64Array(3);
  const qTop = new Float64Array(4), qFly = new Float64Array(4), om = new Float64Array(3), stiff = [spec.B1, spec.B2, spec.C];
  const exclude = Math.ceil((2 * spec.r) / Math.min(...l)) + 1;
  // grille de contacts
  const cell = Math.max(...l) + 2 * spec.r + 0.006;
  let pairs = new Int32Array(4096), npairs = 0, pairAge = 99;

  function buildPairs() {
    const map = new Map();
    for (let j = 0; j < ns; j++) {
      const a = segV[j] * 3;
      const cx = Math.floor((P[a] + P[a + 3]) / 2 / cell), cy = Math.floor((P[a + 1] + P[a + 4]) / 2 / cell), cz = Math.floor((P[a + 2] + P[a + 5]) / 2 / cell);
      const key = (cx + 512) * 1048576 + (cy + 512) * 1024 + (cz + 512);
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(j);
    }
    npairs = 0;
    for (let j = 0; j < ns; j++) {
      const a = segV[j] * 3;
      const cx = Math.floor((P[a] + P[a + 3]) / 2 / cell), cy = Math.floor((P[a + 1] + P[a + 4]) / 2 / cell), cz = Math.floor((P[a + 2] + P[a + 5]) / 2 / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const list = map.get((cx + dx + 512) * 1048576 + (cy + dy + 512) * 1024 + (cz + dz + 512));
        if (!list) continue;
        for (const k of list) {
          if (k <= j) continue;
          if (segStrand[k] === segStrand[j] && k - j < exclude) continue;
          if (npairs * 2 + 2 > pairs.length) { const np = new Int32Array(pairs.length * 2); np.set(pairs); pairs = np; }
          pairs[npairs * 2] = j; pairs[npairs * 2 + 1] = k; npairs++;
        }
      }
    }
  }

  // attache du haut d'un brin (repère du mandrin tourné de θ)
  const topAnchor = (k, out) => {
    const [x, y, z] = spec.strands[k].top, c = Math.cos(state.theta), s = Math.sin(state.theta);
    out[0] = c * x + s * z; out[1] = topY + y; out[2] = -s * x + c * z;
    return out;
  };

  // flexion-torsion entre le repère qa (indice oa dans A, inverse d'inertie wa,
  // ou 0 : imposé) et qb ; flyB : qb est le volant (seule la rotation autour
  // de y lui est permise, inverse d'inertie wb)
  function bendTwist(A, oa, wa, Bq, ob, wb, flyB, len, dt2, rest = -1) {
    const x1 = A[oa], y1 = A[oa + 1], z1 = A[oa + 2], w1 = A[oa + 3];
    const x2 = Bq[ob], y2 = Bq[ob + 1], z2 = Bq[ob + 2], w2 = Bq[ob + 3];
    // r = q̄1 ⊗ q2
    let rx = w1 * x2 - x1 * w2 - y1 * z2 + z1 * y2;
    let ry = w1 * y2 + x1 * z2 - y1 * w2 - z1 * x2;
    let rz = w1 * z2 - x1 * y2 + y1 * x2 - z1 * w2;
    // (pas de choix d'hémisphère : les quaternions évoluent continûment, leur
    // produit aussi ; au-delà d'un demi-tour de torsion entre deux voisins, la
    // contrainte tire encore dans le bon sens au lieu de « sauter » d'un tour)
    // vecteur de Darboux par le logarithme exact de la rotation relative
    // (axe × angle) : le rappel croît avec l'angle jusqu'au tour complet
    const rw = w1 * w2 + x1 * x2 + y1 * y2 + z1 * z2, im = Math.hypot(rx, ry, rz);
    const sc = im > 1e-9 ? 2 * Math.atan2(im, rw) / im : 2;
    om[0] = sc * rx / len; om[1] = sc * ry / len; om[2] = sc * rz / len;
    if (rest >= 0) { om[0] -= O0[rest * 2]; om[1] -= O0[rest * 2 + 1]; }
    let gx = 0, gy = 0, gz = 0; // correction (repère de A), Δλ
    for (let k = 0; k < 3; k++) {
      axis(A, oa, k, ax);
      let K = wa;
      if (flyB) K += wb * ax[1] * ax[1]; else K += wb;
      K /= len * len;
      const alpha = 1 / (stiff[k] * len * dt2);
      const dl = -om[k] / (K + alpha);
      gx += ax[0] * dl; gy += ax[1] * dl; gz += ax[2] * dl;
    }
    // Δθ_a = −wa·g/len ; Δθ_b = +wb·g/len (g : vecteur du monde)
    if (wa > 0) rotate(A, oa, -wa * gx / len, -wa * gy / len, -wa * gz / len);
    if (wb > 0) {
      if (flyB) { const d = wb * gy / len; fly.phi += d; yRot(fly.phi, Q_DOWN, qFly); }
      else rotate(Bq, ob, wb * gx / len, wb * gy / len, wb * gz / len);
    }
  }

  function solve(dt) {
    const dt2 = dt * dt;
    // ── flexion-torsion ──
    yRot(state.theta, Q_DOWN, qTop);
    yRot(fly.phi, Q_DOWN, qFly);
    for (let k = 0; k < S; k++) {
      const n = nSeg[k], len = l[k], o = sOff[k];
      // (le premier et le dernier segment sont pris dans les mors : rigides,
      // solidaires du mandrin et du volant)
      bendTwist(qTop, 0, 0, Q, (o + 1) * 4, WQ[o + 1], false, len, dt2, o);
      for (let i = 1; i < n - 2; i++) bendTwist(Q, (o + i) * 4, WQ[o + i], Q, (o + i + 1) * 4, WQ[o + i + 1], false, len, dt2, o + i);
      bendTwist(Q, (o + n - 2) * 4, WQ[o + n - 2], qFly, 0, fly.locked ? 0 : 1 / fly.I, true, len, dt2, o + n - 2);
    }
    // ── étirement-cisaillement (de haut en bas) ──
    for (let k = 0; k < S; k++) {
      const n = nSeg[k], len = l[k];
      for (let i = 1; i < n - 1; i++) { // (le premier et le dernier segment sont rigides)
        const j = sOff[k] + i, a = (vOff[k] + i) * 3, b = a + 3;
        const wa = W[vOff[k] + i], wb = W[vOff[k] + i + 1], wq = WQ[j];
        if (wa + wb === 0) continue;
        axis(Q, j * 4, 2, d3);
        const cx = (P[b] - P[a]) / len - d3[0], cy = (P[b + 1] - P[a + 1]) / len - d3[1], cz = (P[b + 2] - P[a + 2]) / len - d3[2];
        const A = (wa + wb) / (len * len), Bv = A + wq;
        const par = cx * d3[0] + cy * d3[1] + cz * d3[2];
        // μ = K⁻¹ C = par/A·d3 + (C − par·d3)/(A + wq)
        const mx = par / A * d3[0] + (cx - par * d3[0]) / Bv;
        const my = par / A * d3[1] + (cy - par * d3[1]) / Bv;
        const mz = par / A * d3[2] + (cz - par * d3[2]) / Bv;
        if (wa) { P[a] += wa / len * mx; P[a + 1] += wa / len * my; P[a + 2] += wa / len * mz; }
        if (wb) { P[b] -= wb / len * mx; P[b + 1] -= wb / len * my; P[b + 2] -= wb / len * mz; }
        // Δθ = wq·(d3 × μ)
        rotate(Q, j * 4, wq * (d3[1] * mz - d3[2] * my), wq * (d3[2] * mx - d3[0] * mz), wq * (d3[0] * my - d3[1] * mx));
      }
    }
    curvatureLimit();
    contacts();
    // ── inextensibilité : projection directe le long de chaque brin ──
    // (le volant pèse des centaines de fois plus qu'un segment : un seul
    // passage de Gauss-Seidel laisserait la corde s'allonger ; on résout le
    // système tridiagonal des longueurs, le volant au bout, par Thomas)
    for (let k = 0; k < S; k++) inextensible(k);
    // ── attache du bas au volant ──
    const c = Math.cos(fly.phi), s = Math.sin(fly.phi);
    for (let k = 0; k < S; k++) for (let e = 0; e < 2; e++) {
      const v = vOff[k] + nSeg[k] - e, o = v * 3, [bx, by, bz] = spec.strands[k].bottom;
      const rx = c * bx + s * bz, rz = -s * bx + c * bz;
      const Cx = P[o] - rx, Cy = P[o + 1] - (fly.y + by + e * l[k]), Cz = P[o + 2] - rz;
      // t = ∂a/∂φ = ŷ × r = (rz, 0, −rx)
      const tx = rz, tz = -rx;
      const wp = W[v], wy = 1 / fly.M, wf = fly.locked ? 0 : 1 / fly.I;
      // K = wp·I + wy·ŷŷᵀ + wf·t tᵀ (t dans le plan xz) → bloc xz 2×2, y à part
      const kxx = wp + wf * tx * tx, kxz = wf * tx * tz, kzz = wp + wf * tz * tz, kyy = wp + wy;
      const det = kxx * kzz - kxz * kxz;
      const mx = (kzz * Cx - kxz * Cz) / det, mz = (kxx * Cz - kxz * Cx) / det, my = Cy / kyy;
      P[o] -= wp * mx; P[o + 1] -= wp * my; P[o + 2] -= wp * mz;
      fly.y += wy * my;
      if (wf) fly.phi += wf * (tx * mx + tz * mz);
    }
    curvatureLimit();
    contacts(); // (en dernier aussi : l'inextensibilité ne doit pas faire passer un brin au travers d'un autre)
    // ── obstacles : sous le mandrin, au-dessus du volant ──
    // (et la pince du volant, le nez du mandrin : des cylindres autour de
    // l'axe, d'où la corde est repoussée ; sans eux, une boucle pourrait passer
    // par-dessus l'extrémité de la corde, ce qu'aucune vraie corde ne fait)
    const ceil = topY - spec.clearTop, floorY = fly.y + spec.clearFly;
    const nose = spec.nose ?? { R: 0.011, h: 0.75 * l[0] }, clip = spec.clip ?? { R: 0.009, h: fly.attachY + 0.75 * l[0] };
    for (let v = 0; v < nv; v++) {
      if (!W[v] || isEnd(v)) continue;
      const o = v * 3;
      if (P[o + 1] > ceil) P[o + 1] = ceil;
      if (P[o + 1] < floorY) P[o + 1] = floorY;
      const cyl = P[o + 1] < fly.y + clip.h ? clip : P[o + 1] > topY - nose.h ? nose : null;
      if (!cyl) continue;
      // centre du cylindre : l'axe (brin unique) ou le point d'attache de ce brin
      const rr = Math.hypot(P[o], P[o + 2]), Rm = cyl.R + spec.r;
      if (rr < Rm && S === 1) {
        // vers la surface la plus proche : le flanc, ou le dessus de la pince / le dessous du nez
        const dv = cyl === clip ? fly.y + clip.h + spec.r - P[o + 1] : P[o + 1] - (topY - nose.h - spec.r);
        if (dv < Rm - rr) P[o + 1] += cyl === clip ? dv : -dv;
        else { const f = rr > 1e-9 ? Rm / rr : 0; if (f) { P[o] *= f; P[o + 2] *= f; } else P[o] = Rm; }
      }
    }
    if (fly.y < fly.yMin) fly.y = fly.yMin;
    posts();
    alignFrames();
    rigidEnds();
  }
  // segments pris dans les mors : position et repère imposés
  function rigidEnds() {
    yRot(state.theta, Q_DOWN, qTop);
    yRot(fly.phi, Q_DOWN, qFly);
    const c = Math.cos(fly.phi), s = Math.sin(fly.phi);
    for (let k = 0; k < S; k++) {
      const n = nSeg[k], v0 = vOff[k], len = l[k], [bx, by, bz] = spec.strands[k].bottom;
      topAnchor(k, tmp);
      P[v0 * 3] = tmp[0]; P[v0 * 3 + 1] = tmp[1]; P[v0 * 3 + 2] = tmp[2];
      P[(v0 + 1) * 3] = tmp[0]; P[(v0 + 1) * 3 + 1] = tmp[1] - len; P[(v0 + 1) * 3 + 2] = tmp[2];
      const ax = c * bx + s * bz, az = -s * bx + c * bz, ay = fly.y + by;
      P[(v0 + n) * 3] = ax; P[(v0 + n) * 3 + 1] = ay; P[(v0 + n) * 3 + 2] = az;
      P[(v0 + n - 1) * 3] = ax; P[(v0 + n - 1) * 3 + 1] = ay + len; P[(v0 + n - 1) * 3 + 2] = az;
      Q.set(qTop, sOff[k] * 4);
      Q.set(qFly, (sOff[k] + n - 1) * 4);
    }
  }
  // Tige presque de Kirchhoff : le cisaillement (angle entre d3 et l'arête)
  // est le ressort par lequel la flexion des repères pousse l'axe ; borné à
  // quelques degrés (au-delà, dans un claquement, les repères décrocheraient de
  // l'axe et la torsion ne serait plus mesurable), par la rotation minimale.
  const maxShear = spec.maxShear ?? 0.12;
  function alignFrames() {
    for (let k = 0; k < S; k++) for (let i = 1; i < nSeg[k] - 1; i++) { // (les segments encastrés suivent leur mors)
      const j = sOff[k] + i, a = (vOff[k] + i) * 3;
      let ex = P[a + 3] - P[a], ey = P[a + 4] - P[a + 1], ez = P[a + 5] - P[a + 2];
      const le = Math.hypot(ex, ey, ez);
      if (le < 1e-12) continue;
      ex /= le; ey /= le; ez /= le;
      axis(Q, j * 4, 2, d3);
      const c = d3[0] * ex + d3[1] * ey + d3[2] * ez;
      const ang = Math.acos(Math.min(1, c));
      if (ang <= maxShear) continue;
      // rotation d'axe d3 × e, d'angle (ang − maxShear) ; q ← r ⊗ q
      let rx = d3[1] * ez - d3[2] * ey, ry = d3[2] * ex - d3[0] * ez, rz = d3[0] * ey - d3[1] * ex;
      const sn = Math.hypot(rx, ry, rz);
      if (sn < 1e-12) continue;
      const h = Math.min(0.2, ang - maxShear) / 2, f = Math.sin(h) / sn;
      const ax = rx * f, ay = ry * f, az = rz * f, aw = Math.cos(h), o = j * 4;
      const x = Q[o], y = Q[o + 1], z = Q[o + 2], w = Q[o + 3];
      Q[o] = aw * x + ax * w + ay * z - az * y;
      Q[o + 1] = aw * y - ax * z + ay * w + az * x;
      Q[o + 2] = aw * z + ax * y - ay * x + az * w;
      Q[o + 3] = aw * w - ax * x - ay * y - az * z;
    }
  }

  // Rayon de courbure minimal (≈ 1,5 rayon de corde) : une vraie corde ne se
  // plie pas sur elle-même en un point ; sans cette limite, un coude trop serré
  // pourrait passer au travers de lui-même entre segments voisins (que les
  // contacts ne testent pas). Contrainte unilatérale |p[i+1] − p[i−1]| ≥ dmin.
  function curvatureLimit() {
    for (let k = 0; k < S; k++) {
      const n = nSeg[k], len = l[k], dmin = 2 * len * Math.cos(Math.min(1.4, len / (spec.rMinBend ?? 1.5 * spec.r)) / 2);
      for (let i = 1; i < n; i++) {
        const va = vOff[k] + i - 1, vb = vOff[k] + i + 1, a = va * 3, b = vb * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.hypot(dx, dy, dz);
        if (d >= dmin || d < 1e-12) continue;
        const wa = W[va], wb = W[vb], ws = wa + wb;
        if (!ws) continue;
        const c = (dmin - d) / (d * ws);
        P[a] -= wa * c * dx; P[a + 1] -= wa * c * dy; P[a + 2] -= wa * c * dz;
        P[b] += wb * c * dx; P[b + 1] += wb * c * dy; P[b + 2] += wb * c * dz;
      }
    }
  }

  // Contacts entre capsules de rayon r. Une corde ne se traverse jamais : si
  // deux segments se sont croisés pendant ce pas (le vecteur entre leurs points
  // les plus proches s'est retourné depuis le pas précédent), on les ramène du
  // bon côté, d'après la normale du pas précédent.
  function contacts() {
    const r2 = 2 * spec.r;
    let nc = 0;
    for (let p = 0; p < npairs; p++) {
      const ja = pairs[p * 2], jb = pairs[p * 2 + 1];
      const a0 = segV[ja] * 3, a1 = a0 + 3, b0 = segV[jb] * 3, b1 = b0 + 3;
      closest(P, a0, a1, b0, b1, tmp);
      let dx = tmp[2], dy = tmp[3], dz = tmp[4], d = Math.hypot(dx, dy, dz);
      if (d >= r2) continue;
      const s0 = tmp[0], t0 = tmp[1];
      // même paire de points au pas précédent
      const qx = Pp[a0] + (Pp[a1] - Pp[a0]) * s0 - Pp[b0] - (Pp[b1] - Pp[b0]) * t0;
      const qy = Pp[a0 + 1] + (Pp[a1 + 1] - Pp[a0 + 1]) * s0 - Pp[b0 + 1] - (Pp[b1 + 1] - Pp[b0 + 1]) * t0;
      const qz = Pp[a0 + 2] + (Pp[a1 + 2] - Pp[a0 + 2]) * s0 - Pp[b0 + 2] - (Pp[b1 + 2] - Pp[b0 + 2]) * t0;
      const dq = Math.hypot(qx, qy, qz);
      let nx, ny, nz, depth;
      if (d < 0.5 * r2 && dx * qx + dy * qy + dz * qz < 0 && dq > 0.5 * r2) {
        nx = qx / dq; ny = qy / dq; nz = qz / dq;
        depth = r2 - (dx * nx + dy * ny + dz * nz); // (franchi : on revient du bon côté)
      } else if (d > 1e-12) { nx = dx / d; ny = dy / d; nz = dz / d; depth = r2 - d; }
      else continue;
      nc++;
      const wa0 = W[segV[ja]] * (1 - s0), wa1 = W[segV[ja] + 1] * s0, wb0 = W[segV[jb]] * (1 - t0), wb1 = W[segV[jb] + 1] * t0;
      const wsum = wa0 * (1 - s0) + wa1 * s0 + wb0 * (1 - t0) + wb1 * t0;
      if (wsum <= 0) continue;
      const pen = depth / wsum;
      // frottement : déplacement tangentiel relatif depuis le pas précédent
      const rvx = dx - qx, rvy = dy - qy, rvz = dz - qz;
      const rn = rvx * nx + rvy * ny + rvz * nz;
      let fx = rvx - rn * nx, fy = rvy - rn * ny, fz = rvz - rn * nz;
      const ft = Math.hypot(fx, fy, fz), lim = spec.friction * depth;
      const kf = ft > 1e-12 ? Math.min(1, lim / ft) / wsum : 0;
      fx *= kf; fy *= kf; fz *= kf;
      const ex = nx * pen, ey = ny * pen, ez = nz * pen;
      P[a0] += wa0 * (ex - fx); P[a0 + 1] += wa0 * (ey - fy); P[a0 + 2] += wa0 * (ez - fz);
      P[a1] += wa1 * (ex - fx); P[a1 + 1] += wa1 * (ey - fy); P[a1 + 2] += wa1 * (ez - fz);
      P[b0] -= wb0 * (ex - fx); P[b0 + 1] -= wb0 * (ey - fy); P[b0 + 2] -= wb0 * (ez - fz);
      P[b1] -= wb1 * (ex - fx); P[b1 + 1] -= wb1 * (ey - fy); P[b1 + 2] -= wb1 * (ez - fz);
    }
    state.contacts = nc;
  }
  // poteaux : la glissière (qui pivote en haut) et les colonnes, cylindres
  // verticaux d'où la corde est repoussée (spec.rail, spec.cols ; state.railAngle)
  function posts() {
    const rl = spec.rail, cols = spec.cols ?? [];
    for (let v = 0; v < nv; v++) {
      if (!W[v]) continue;
      const o = v * 3, y = P[o + 1];
      const push = (cx, cz, R) => {
        const dx = P[o] - cx, dz = P[o + 2] - cz, d = Math.hypot(dx, dz), m = R + spec.r;
        if (d < m && d > 1e-9) { P[o] = cx + dx / d * m; P[o + 2] = cz + dz / d * m; }
      };
      if (rl && y < rl.pivotY) push(rl.x + Math.sin(state.railAngle) * (rl.pivotY - y), rl.z, rl.R);
      for (const c of cols) push(c[0], c[1], c[2]);
    }
  }
  const NMAX = Math.max(...nSeg) + 1;
  const tn = new Float64Array(NMAX * 3), tc = new Float64Array(NMAX), ta = new Float64Array(NMAX), tb = new Float64Array(NMAX), tcc = new Float64Array(NMAX), tl = new Float64Array(NMAX);
  function inextensible(k) {
    // segments 1 … n − 2 (le premier et le dernier sont rigides) : sommets
    // 1 (dans les mors, immobile) … n − 1 (dans la pince du volant : son poids
    // et sa part du volant, vertical seulement)
    const n = nSeg[k], v0 = vOff[k], len = l[k], m = n - 2;
    const wyEnd = 1 / (1 / W[v0 + n - 1] + fly.M / S);
    const wOf = (i, c) => (i >= n - 1 ? (c === 1 ? wyEnd : 0) : W[v0 + i]); // (i : indice de sommet)
    for (let j = 0; j < m; j++) {
      const a = (v0 + j + 1) * 3;
      const ex = P[a + 3] - P[a], ey = P[a + 4] - P[a + 1], ez = P[a + 5] - P[a + 2], d = Math.hypot(ex, ey, ez);
      tn[j * 3] = ex / d; tn[j * 3 + 1] = ey / d; tn[j * 3 + 2] = ez / d;
      tc[j] = d - len;
    }
    // A λ = C ; A[j][j] = nⱼᵀ(W + W')nⱼ, A[j][j+1] = −nⱼᵀ W' nⱼ₊₁ (contrainte j : sommets j + 1 et j + 2)
    const wn = (i, j, v) => { let s = 0; for (let c = 0; c < 3; c++) s += tn[i * 3 + c] * wOf(v, c) * tn[j * 3 + c]; return s; };
    for (let j = 0; j < m; j++) { tb[j] = wn(j, j, j + 1) + wn(j, j, j + 2); ta[j] = j > 0 ? -wn(j, j - 1, j + 1) : 0; tcc[j] = j < m - 1 ? -wn(j, j + 1, j + 2) : 0; }
    for (let j = 1; j < m; j++) { const f = ta[j] / tb[j - 1]; tb[j] -= f * tcc[j - 1]; tc[j] -= f * tc[j - 1]; }
    tl[m - 1] = tc[m - 1] / tb[m - 1];
    for (let j = m - 2; j >= 0; j--) tl[j] = (tc[j] - tcc[j] * tl[j + 1]) / tb[j];
    // Δp(sommet j + 1) = W (nⱼ λⱼ − nⱼ₋₁ λⱼ₋₁)
    for (let j = 1; j <= m; j++) {
      const v = j + 1, a = (v0 + v) * 3;
      for (let c = 0; c < 3; c++) {
        const d = wOf(v, c) * ((j < m ? tn[j * 3 + c] * tl[j] : 0) - tn[(j - 1) * 3 + c] * tl[j - 1]);
        P[a + c] += d;
        if (v === n - 1 && c === 1) { fly.y += d / S; P[a + 3 + c] += d; }
      }
    }
  }

  const ends = new Set();
  for (let k = 0; k < S; k++) { ends.add(vOff[k]); ends.add(vOff[k] + 1); ends.add(vOff[k] + nSeg[k]); ends.add(vOff[k] + nSeg[k] - 1); }
  const isEnd = (v) => ends.has(v);

  // un pas de dt ; drive = { theta, locked, lockPhi, detent }
  function step(dt, drive) {
    state.theta = drive.theta;
    state.railAngle = (spec.rail?.maxAngle ?? 0) * (drive.bar ?? 0);
    const wasLocked = fly.locked;
    fly.locked = drive.locked;
    if (fly.locked) { fly.phi = drive.lockPhi; fly.w = 0; }
    else if (wasLocked) fly.w = 0;
    const damp = Math.exp(-spec.damp * dt), dampW = Math.exp(-spec.dampW * dt);
    for (let v = 0; v < nv; v++) {
      const o = v * 3;
      Pp[o] = P[o]; Pp[o + 1] = P[o + 1]; Pp[o + 2] = P[o + 2];
      if (!W[v]) continue;
      V[o + 1] -= G * dt;
      V[o] *= damp; V[o + 1] *= damp; V[o + 2] *= damp;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
    }
    for (let j = 0; j < ns; j++) {
      const o = j * 4;
      Qp[o] = Q[o]; Qp[o + 1] = Q[o + 1]; Qp[o + 2] = Q[o + 2]; Qp[o + 3] = Q[o + 3];
      const a = j * 3;
      Om[a] *= dampW; Om[a + 1] *= dampW; Om[a + 2] *= dampW;
      rotate(Q, o, Om[a] * dt, Om[a + 1] * dt, Om[a + 2] * dt);
    }
    fly.yp = fly.y; fly.phip = fly.phi;
    fly.vy -= G * dt;
    fly.vy *= Math.exp(-fly.vdamp * dt);
    fly.y += fly.vy * dt;
    if (!fly.locked) {
      // ailettes (c·ω|ω|), frottement du pivot (b·ω), cran de la barre qui revient
      const w0 = fly.w;
      fly.w = w0 / (1 + dt * (fly.drag * Math.abs(w0) + fly.friction) / fly.I);
      fly.phi += fly.w * dt;
      // butée en V de la barre qui revient : l'écart permis autour de l'angle
      // de blocage se referme avec elle (gap → 0 quand la barre est fermée)
      if (drive.gap !== undefined) {
        const lo = drive.lockPhi - drive.gap, hi = drive.lockPhi + drive.gap;
        if (fly.phi > hi) { fly.phi = hi; if (fly.w > 0) fly.w = 0; }
        if (fly.phi < lo) { fly.phi = lo; if (fly.w < 0) fly.w = 0; }
      }
    }
    // sommets du haut : imposés par le mandrin
    for (let k = 0; k < S; k++) { topAnchor(k, tmp); P.set([tmp[0], tmp[1], tmp[2]], vOff[k] * 3); }

    if (++pairAge >= spec.pairEvery) { buildPairs(); pairAge = 0; }
    for (let it = 0; it < spec.iterations; it++) solve(dt);

    const inv = 1 / dt;
    for (let v = 0; v < nv; v++) {
      if (!W[v]) continue;
      const o = v * 3;
      V[o] = (P[o] - Pp[o]) * inv; V[o + 1] = (P[o + 1] - Pp[o + 1]) * inv; V[o + 2] = (P[o + 2] - Pp[o + 2]) * inv;
    }
    for (let j = 0; j < ns; j++) {
      const o = j * 4;
      // ω = 2·Im(q ⊗ q̄p)/dt
      const x = Q[o], y = Q[o + 1], z = Q[o + 2], w = Q[o + 3];
      const px = -Qp[o], py = -Qp[o + 1], pz = -Qp[o + 2], pw = Qp[o + 3];
      let rx = w * px + x * pw + y * pz - z * py;
      let ry = w * py - x * pz + y * pw + z * px;
      let rz = w * pz + x * py - y * px + z * pw;
      const rw = w * pw - x * px - y * py - z * pz;
      if (rw < 0) { rx = -rx; ry = -ry; rz = -rz; }
      Om[j * 3] = 2 * rx * inv; Om[j * 3 + 1] = 2 * ry * inv; Om[j * 3 + 2] = 2 * rz * inv;
    }
    fly.vy = (fly.y - fly.yp) * inv;
    if (!fly.locked) fly.w = (fly.phi - fly.phip) * inv;
    state.t += dt;
  }

  return { state, step, spec, nSeg, vOff, sOff, l, S, nv, ns };
}

// ── Mesures : torsion, vrille (Călugăreanu-White : Lk = Tw + Wr) ──────────
// Tw : somme, de l'encastrement du haut à celui du bas, des angles entre le
// repère d'un segment et celui du précédent transporté parallèlement (rotation
// minimale qui amène un axe sur l'autre), en tours.
function frameOf(q, o) {
  const a = new Float64Array(3), c = new Float64Array(3);
  axis(q, o, 0, a); axis(q, o, 2, c);
  return [a, c];
}
function ptAngle([a1, t1], [a2, t2]) {
  // transport de a1 de t1 vers t2 (formule de Rodrigues, rotation minimale)
  const cx = t1[1] * t2[2] - t1[2] * t2[1], cy = t1[2] * t2[0] - t1[0] * t2[2], cz = t1[0] * t2[1] - t1[1] * t2[0];
  const c = t1[0] * t2[0] + t1[1] * t2[1] + t1[2] * t2[2];
  const k = 1 / (1 + c);
  const dot = cx * a1[0] + cy * a1[1] + cz * a1[2];
  const px = a1[0] * c + (cy * a1[2] - cz * a1[1]) + cx * dot * k;
  const py = a1[1] * c + (cz * a1[0] - cx * a1[2]) + cy * dot * k;
  const pz = a1[2] * c + (cx * a1[1] - cy * a1[0]) + cz * dot * k;
  // angle signé de p à a2 autour de t2
  const sx = py * a2[2] - pz * a2[1], sy = pz * a2[0] - px * a2[2], sz = px * a2[1] - py * a2[0];
  return Math.atan2(sx * t2[0] + sy * t2[1] + sz * t2[2], px * a2[0] + py * a2[1] + pz * a2[2]);
}
export function twist(rod, k = 0) {
  const { state: { Q, theta, fly }, sOff, nSeg } = rod;
  const frames = [frameOf(yRot(theta, Q_DOWN), 0)];
  for (let i = 0; i < nSeg[k]; i++) frames.push(frameOf(Q, (sOff[k] + i) * 4));
  frames.push(frameOf(yRot(fly.phi, Q_DOWN), 0));
  const quats = [yRot(theta, Q_DOWN)];
  for (let i = 0; i < nSeg[k]; i++) quats.push(Q.slice((sOff[k] + i) * 4, (sOff[k] + i) * 4 + 4));
  quats.push(yRot(fly.phi, Q_DOWN));
  let tw = 0;
  for (let i = 0; i + 1 < frames.length; i++) {
    // angle transporté (exact), déroulé d'après l'angle de torsion du quaternion relatif (continu, ±2π)
    const pt = ptAngle(frames[i], frames[i + 1]);
    const [x1, y1, z1, w1] = quats[i], [x2, y2, z2, w2] = quats[i + 1];
    const qt = 2 * Math.atan2(w1 * z2 - x1 * y2 + y1 * x2 - z1 * w2, w1 * w2 + x1 * x2 + y1 * y2 + z1 * z2);
    tw += pt + 2 * Math.PI * Math.round((qt - pt) / (2 * Math.PI));
  }
  return tw / (2 * Math.PI);
}

// Vrille (writhe) de l'axe d'un brin, fermé par deux demi-droites verticales
// (au-dessus du mandrin, sous le volant) : formule exacte de Klenin et
// Langowski pour chaque paire de segments (angle solide de Gauss / 4π).
// Avec Tw, elle vérifie Lk = Tw + Wr (Călugăreanu-White), où Lk est la
// différence des tours du mandrin et du volant : tant que la corde ne se
// traverse pas, Lk est conservé.
export function writhe(rod, k = 0, ext = 3) {
  const { state: { P }, vOff, nSeg } = rod;
  const n = nSeg[k], v0 = vOff[k];
  const pts = [[P[v0 * 3], P[v0 * 3 + 1] + ext, P[v0 * 3 + 2]]];
  for (let i = 0; i <= n; i++) pts.push([P[(v0 + i) * 3], P[(v0 + i) * 3 + 1], P[(v0 + i) * 3 + 2]]);
  const e = pts[pts.length - 1];
  pts.push([e[0], e[1] - ext, e[2]]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // (une normale presque nulle : quadrilatère dégénéré, plan ; son angle solide est nul)
  const norm = (a, sc) => { const l = Math.hypot(...a); return l > 1e-9 * sc ? [a[0] / l, a[1] / l, a[2] / l] : null; };
  let wr = 0;
  const m = pts.length - 1;
  for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
    const p1 = pts[i], p2 = pts[i + 1], p3 = pts[j], p4 = pts[j + 1];
    const r13 = sub(p3, p1), r14 = sub(p4, p1), r23 = sub(p3, p2), r24 = sub(p4, p2), r34 = sub(p4, p3), r12 = sub(p2, p1);
    const sc = Math.hypot(...r13) * Math.hypot(...r24) + 1e-30;
    const n1 = norm(cross(r13, r14), sc), n2 = norm(cross(r14, r24), sc), n3 = norm(cross(r24, r23), sc), n4 = norm(cross(r23, r13), sc);
    if (!n1 || !n2 || !n3 || !n4) continue;
    const as = (x) => Math.asin(Math.max(-1, Math.min(1, x)));
    const om = as(dot(n1, n2)) + as(dot(n2, n3)) + as(dot(n3, n4)) + as(dot(n4, n1));
    const s = dot(cross(r34, r12), r13);
    wr += Math.sign(s) * om;
  }
  return (2 * wr) / (4 * Math.PI);
}
