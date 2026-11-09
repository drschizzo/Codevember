// L'action de Newton d'une chorégraphie, et son gradient exact.
//
// Une chorégraphie : N corps de masse 1 (G = 1) sur une même courbe fermée,
// décalés d'un N-ième de période. Dans un repère qui tourne à la vitesse ω
// autour de z, la courbe est une série de Fourier de période 2π :
//
//   x(t) = Σₖ Aₖ cos kt + Bₖ sin kt          (Aₖ, Bₖ ∈ ℝᴰ, D = 2 ou 3)
//
// et le corps j est en qⱼ(t) = R(ωt) · x(t + 2πj/N) dans le repère fixe.
// Le centre de masse est à l'origine si et seulement si les harmoniques
// multiples de N sont nulles : elles sont retirées une fois pour toutes.
//
// Par symétrie, l'action totale vaut N fois celle d'un seul corps :
//
//   A = ∫₀^2π ½ |ẋ + ω e_z × x|² + ½ Σⱼ 1 / |x(t) − x(t + 2πj/N)|  dt
//
// Ses points critiques sont exactement les chorégraphies (à la troncature de
// la série près). L'intégrale est évaluée sur Q points équidistants (Q multiple
// de N : le décalage d'un corps est un décalage d'indice), exacte pour
// l'énergie cinétique dès que Q > 2K.
//
// Force forte (Moore, 1993) : pendant la descente, un terme ε/r² rend toute
// collision infiniment coûteuse ; la courbe ne peut plus traverser un autre
// corps et reste dans la classe topologique (la tresse) de son départ. On le
// ramène ensuite à zéro : le point critique final est newtonien.
//
// Disposition des coefficients : c[(k − 1)·2D + s·D + d], s = 0 (cos) ou 1 (sin).

import { project } from './symmetry.js';

const TAU = Math.PI * 2;

export const quadratureFor = (N, K, perMode = 6) => N * Math.ceil((perMode * K) / N);

export function createAction({ N, D, omega, K, Q = quadratureFor(N, K), strong = 0, sym = null }) {
  if (Q % N) throw new Error('Q doit être un multiple de N');
  const nv = K * 2 * D;
  const C = new Float64Array(Q * K), S = new Float64Array(Q * K);
  for (let m = 0; m < Q; m++) {
    for (let k = 1; k <= K; k++) {
      const a = (TAU * m * k) / Q;
      C[m * K + k - 1] = Math.cos(a);
      S[m * K + k - 1] = Math.sin(a);
    }
  }
  const allowed = new Uint8Array(K + 1);
  for (let k = 1; k <= K; k++) allowed[k] = k % N !== 0 ? 1 : 0;

  const X = new Float64Array(Q * D), V = new Float64Array(Q * D);
  const GX = new Float64Array(Q * D), GV = new Float64Array(Q * D);
  const shift = Q / N, w = TAU / Q;
  const out = { A: 0, T: 0, P: 0, rmin: 0 };

  function synth(c) {
    X.fill(0); V.fill(0);
    for (let k = 1; k <= K; k++) {
      if (!allowed[k]) continue;
      const base = (k - 1) * 2 * D;
      for (let d = 0; d < D; d++) {
        const a = c[base + d], b = c[base + D + d];
        if (a === 0 && b === 0) continue;
        for (let m = 0, i = k - 1; m < Q; m++, i += K) {
          const cs = C[i], sn = S[i];
          X[m * D + d] += a * cs + b * sn;
          V[m * D + d] += k * (b * cs - a * sn);
        }
      }
    }
  }

  // action (renvoyée) et gradient (écrit dans g, si fourni) ; Infinity en cas de collision
  function evaluate(c, g) {
    synth(c);
    let T = 0, P = 0, rmin2 = Infinity;
    GX.fill(0); GV.fill(0);
    for (let m = 0; m < Q; m++) {
      const o = m * D;
      const ux = V[o] - omega * X[o + 1], uy = V[o + 1] + omega * X[o];
      const uz = D === 3 ? V[o + 2] : 0;
      T += 0.5 * (ux * ux + uy * uy + uz * uz);
      GV[o] = w * ux; GV[o + 1] = w * uy;
      if (D === 3) GV[o + 2] = w * uz;
      GX[o] += w * omega * uy; GX[o + 1] -= w * omega * ux;
      for (let j = 1; j < N; j++) {
        const o2 = ((m + j * shift) % Q) * D;
        const dx = X[o] - X[o2], dy = X[o + 1] - X[o2 + 1], dz = D === 3 ? X[o + 2] - X[o2 + 2] : 0;
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-14) { out.A = Infinity; return Infinity; }
        if (r2 < rmin2) rmin2 = r2;
        const r = Math.sqrt(r2), k3 = w * (1 / (r2 * r) + (2 * strong) / (r2 * r2));
        P += 1 / r + strong / r2;
        GX[o] -= dx * k3; GX[o + 1] -= dy * k3;
        if (D === 3) GX[o + 2] -= dz * k3;
      }
    }
    T *= w; P *= w / 2;
    out.T = T; out.P = P; out.A = T + P; out.rmin = Math.sqrt(rmin2);
    if (g) {
      g.fill(0);
      for (let k = 1; k <= K; k++) {
        if (!allowed[k]) continue;
        const base = (k - 1) * 2 * D;
        for (let d = 0; d < D; d++) {
          let sa = 0, sb = 0;
          for (let m = 0, i = k - 1; m < Q; m++, i += K) {
            const gx = GX[m * D + d], gv = GV[m * D + d] * k;
            sa += gx * C[i] - gv * S[i];
            sb += gx * S[i] + gv * C[i];
          }
          g[base + d] = sa; g[base + D + d] = sb;
        }
      }
      // classe de symétrie : le gradient reste dans le sous-espace
      if (sym) project(g, { N, D, K, sym });
    }
    return T + P;
  }

  // préconditionnement : la courbure de l'action sur l'harmonique k est
  // dominée par l'énergie cinétique, en (k + ω)²
  const precond = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = Math.floor(i / (2 * D)) + 1;
    precond[i] = 1 / Math.max(1, k * k);
  }

  return { N, D, omega, K, Q, nv, allowed, evaluate, out, precond };
}

// position et vitesse (repère tournant) de la courbe à l'instant t
export function curveAt(c, { D, K }, t, pos, vel) {
  for (let d = 0; d < D; d++) { pos[d] = 0; if (vel) vel[d] = 0; }
  for (let k = 1; k <= K; k++) {
    const base = (k - 1) * 2 * D;
    const cs = Math.cos(k * t), sn = Math.sin(k * t);
    for (let d = 0; d < D; d++) {
      const a = c[base + d], b = c[base + D + d];
      if (a === 0 && b === 0) continue;
      pos[d] += a * cs + b * sn;
      if (vel) vel[d] += k * (b * cs - a * sn);
    }
  }
}
