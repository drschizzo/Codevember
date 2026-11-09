// Contre-épreuve : l'orbite trouvée par minimisation est intégrée pour de bon
// (équations de Newton, repère fixe, Dormand–Prince 5(4) à pas adaptatif) sur
// une période. Si c'est une chorégraphie, l'état final est l'état initial
// tourné de 2πω. On en déduit aussi la stabilité linéaire (multiplicateurs de
// Floquet) : rayon spectral de la matrice de monodromie.
//
// État : positions (N·D) puis vitesses (N·D) ; G = 1, masses 1.
import { curveAt } from './action.js';

const TAU = Math.PI * 2;

function accel(y, N, D, out) {
  const nd = N * D;
  out.fill(0, nd);
  for (let i = 0; i < nd; i++) out[i] = y[nd + i];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      let r2 = 0;
      for (let d = 0; d < D; d++) { const v = y[j * D + d] - y[i * D + d]; r2 += v * v; }
      const k = 1 / (r2 * Math.sqrt(r2));
      for (let d = 0; d < D; d++) {
        const f = (y[j * D + d] - y[i * D + d]) * k;
        out[nd + i * D + d] += f; out[nd + j * D + d] -= f;
      }
    }
  }
}

const A2 = [1 / 5], A3 = [3 / 40, 9 / 40], A4 = [44 / 45, -56 / 15, 32 / 9],
  A5 = [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  A6 = [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

// intègre y0 sur [0, T] ; renvoie l'état final et le nombre de pas
export function flow(y0, T, N, D, { rtol = 1e-11, atol = 1e-13, maxSteps = 2e5 } = {}) {
  const n = y0.length;
  const y = Float64Array.from(y0), yt = new Float64Array(n), yn = new Float64Array(n);
  const k = Array.from({ length: 7 }, () => new Float64Array(n));
  accel(y, N, D, k[0]);
  let t = 0, h = T / 2000, steps = 0, rejected = 0;
  const stage = (coef, dst, hh) => {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < coef.length; j++) s += coef[j] * k[j][i];
      yt[i] = y[i] + hh * s;
    }
    accel(yt, N, D, dst);
  };
  while (t < T) {
    if (steps > maxSteps) return { y, steps, ok: false };
    if (t + h > T) h = T - t;
    stage(A2, k[1], h); stage(A3, k[2], h); stage(A4, k[3], h); stage(A5, k[4], h); stage(A6, k[5], h);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < 6; j++) s += B[j] * k[j][i];
      yn[i] = y[i] + h * s;
    }
    accel(yn, N, D, k[6]);
    let err = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < 7; j++) s += E[j] * k[j][i];
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i]));
      err = Math.max(err, Math.abs(h * s) / sc);
    }
    if (err <= 1 || h < 1e-12) {
      t += h; y.set(yn); k[0].set(k[6]); steps++;
    } else rejected++;
    h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2)));
  }
  return { y, steps, rejected, ok: true };
}

// rotation de l'état autour de z
function rotate(y, N, D, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), out = Float64Array.from(y);
  for (let b = 0; b < 2 * N; b++) {
    const o = b * D, x = y[o], v = y[o + 1];
    out[o] = c * x - s * v; out[o + 1] = s * x + c * v;
  }
  return out;
}

// état des N corps à l'instant t, dans le repère fixe
export function stateAt(c, p, t) {
  const { N, D, omega } = p;
  const y = new Float64Array(2 * N * D), pos = new Float64Array(D), vel = new Float64Array(D);
  for (let j = 0; j < N; j++) {
    curveAt(c, p, t + (TAU * j) / N, pos, vel);
    vel[0] -= omega * pos[1]; vel[1] += omega * pos[0];
    for (let d = 0; d < D; d++) { y[j * D + d] = pos[d]; y[N * D + j * D + d] = vel[d]; }
  }
  return rotate(y, N, D, omega * t);
}
export const initialState = (c, p) => stateAt(c, p, 0);

// Tirs multiples : la période est coupée en S segments, chacun intégré depuis
// l'état exact de la courbe. Écart de raccord le plus fort (relatif), et
// matrice de monodromie comme produit des jacobiennes des segments.
const segmentsFor = (N) => N * Math.ceil(24 / N);

export function closure(c, p, size, opts) {
  const { N, D } = p, S = segmentsFor(N), h = TAU / S, nd = N * D;
  let ep = 0, ev = 0, vmax = 0, steps = 0;
  for (let s = 0; s < S; s++) {
    const y0 = stateAt(c, p, s * h), y1 = stateAt(c, p, (s + 1) * h);
    const r = flow(y0, h, N, D, opts);
    if (!r.ok) return { error: Infinity, steps };
    steps += r.steps;
    for (let i = 0; i < nd; i++) {
      ep = Math.max(ep, Math.abs(r.y[i] - y1[i]));
      ev = Math.max(ev, Math.abs(r.y[nd + i] - y1[nd + i]));
      vmax = Math.max(vmax, Math.abs(y0[nd + i]));
    }
  }
  return { error: Math.max(ep / size, ev / vmax), steps };
}

// rayon spectral de la monodromie (puissance itérée avec normalisation ; la
// pente entre deux horizons écarte la croissance polynomiale due aux
// symétries, dont les valeurs propres 1 sont multiples). Renvoie aussi le
// logarithme de la croissance (exposant de Floquet le plus fort).
export function monodromyRadius(c, p, size) {
  const { N, D, omega } = p, S = segmentsFor(N), h = TAU / S;
  const n = 2 * N * D;
  let M = null;
  for (let s = 0; s < S; s++) {
    const y0 = stateAt(c, p, s * h);
    let vmax = 0; for (let i = N * D; i < n; i++) vmax = Math.max(vmax, Math.abs(y0[i]));
    const J = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      const eps = 1e-6 * (i < N * D ? size : vmax);
      const yp = Float64Array.from(y0), ym = Float64Array.from(y0);
      yp[i] += eps; ym[i] -= eps;
      const fp = flow(yp, h, N, D, { rtol: 1e-12, atol: 1e-14 }).y;
      const fm = flow(ym, h, N, D, { rtol: 1e-12, atol: 1e-14 }).y;
      for (let r = 0; r < n; r++) J[r * n + i] = (fp[r] - fm[r]) / (2 * eps);
    }
    M = M ? matmul(J, M, n) : J;
  }
  // ramené au repère de départ : rotation de −2πω (positions et vitesses)
  const R = new Float64Array(n * n);
  const cs = Math.cos(-TAU * omega), sn = Math.sin(-TAU * omega);
  for (let b = 0; b < 2 * N; b++) {
    const o = b * D;
    for (let d = 0; d < D; d++) R[(o + d) * n + o + d] = 1;
    R[o * n + o] = cs; R[o * n + o + 1] = -sn; R[(o + 1) * n + o] = sn; R[(o + 1) * n + o + 1] = cs;
  }
  M = matmul(R, M, n);
  let v = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.sin(i * 12.9898 + 1.3);
  let logn = 0, log200 = 0;
  for (let it = 1; it <= 400; it++) {
    for (let r = 0; r < n; r++) { let s = 0; for (let i = 0; i < n; i++) s += M[r * n + i] * v[i]; w[r] = s; }
    let nn = 0; for (let r = 0; r < n; r++) nn += w[r] * w[r];
    nn = Math.sqrt(nn); logn += Math.log(nn);
    for (let r = 0; r < n; r++) v[r] = w[r] / nn;
    if (it === 200) log200 = logn;
  }
  return Math.exp((logn - log200) / 200);
}

function matmul(A, B, n) {
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i * n + j] += a * B[k * n + j];
    }
  }
  return C;
}
