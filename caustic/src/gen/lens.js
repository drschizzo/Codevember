// La lentille d'eau : du transport optimal à la forme de la surface, puis au
// spectre des ondes — fonctions pures.
//
// 1. Le transport T (carré unité) dit où chaque point de la lentille doit
//    envoyer sa lumière au fond. 2. La loi de Snell donne la normale qui fait
//    cette déviation : n ∥ n₁·i − n₂·t. 3. Les pentes s'intègrent en hauteur
//    (Poisson, moindres carrés). 4. La hauteur est posée sur la grille du
//    domaine des ondes et transformée (FFT) : c'est l'état initial Ĥ(k) de
//    l'onde, qui convergera et divergera par sa propre dispersion.

import { fft2, poissonNeumann } from './fft.js';
import { solveTransport } from './transport.js';
import { target } from './motifs.js';
import { nWater, refract, snellNormal, vnorm } from '../optics.js';

// Géométrie de la lumière : soleil (direction) ou lampe (point)
//   light = { kind: 'sun', dir: [x, y, z] } (direction de propagation, y < 0)
//         | { kind: 'lamp', pos: [x, y, z] }
export function incident(light, P) {
  if (light.kind === 'sun') return vnorm(light.dir);
  return vnorm([P[0] - light.pos[0], P[1] - light.pos[1], P[2] - light.pos[2]]);
}

// Point d'arrivée au fond (y = −H) d'un rayon réfracté par une surface plane
export function flatLanding(light, P, H, n2) {
  const i = incident(light, P);
  const t = refract(i, [0, 1, 0], 1 / n2);
  const s = (-H - P[1]) / t[1];
  return [P[0] + t[0] * s, -H, P[2] + t[2] * s];
}

// Lentille pour une cible : renvoie la hauteur sur une grille m×m (pas
// `side/m`, centrée en `center`), les pentes et des mesures.
//   o = { nu, nt, side, center: [x, z], H, light, lambda, ot }
export function designLens({ nu, nt, side, center, H, light, lambda = 545, m = 256, ot = {}, taper = [0.84, 0.94] }) {
  const n2 = nWater(lambda);
  const T = solveTransport(nu, nt, { m: m - 1, ...ot });
  const { Tx, Ty, M } = T; // M = m + 1 nœuds par côté
  // repère du fond : l'image plane de la lentille par la surface au repos
  const c3 = [center[0], 0, center[1]];
  const L0 = flatLanding(light, c3, H, n2);
  // grandissement moyen (1 au soleil ; > 1 sous une lampe proche)
  const e3 = [center[0] + side / 2, 0, center[1]];
  const L1 = flatLanding(light, e3, H, n2);
  const mag = Math.hypot(L1[0] - L0[0], L1[2] - L0[2]) / (side / 2);
  const hx = new Float64Array(m * m), hz = new Float64Array(m * m);
  let maxSlope = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * M + i;
    const px = i / (M - 1), pz = j / (M - 1);
    const P = [center[0] + (px - 0.5) * side, 0, center[1] + (pz - 0.5) * side];
    const X = [L0[0] + (Tx[k] - 0.5) * side * mag, -H, L0[2] + (Ty[k] - 0.5) * side * mag];
    const t = vnorm([X[0] - P[0], X[1] - P[1], X[2] - P[2]]);
    const n = snellNormal(incident(light, P), t, 1, n2);
    const a = -n[0] / n[1], b = -n[2] / n[1];
    // (la surface plane dévie déjà les rayons d'une lampe : on retire la
    // pente qui reproduirait ce que la surface au repos fait seule)
    const t0 = vnorm([flatLanding(light, P, H, n2)[0] - P[0], -H, flatLanding(light, P, H, n2)[2] - P[2]]);
    const n0 = snellNormal(incident(light, P), t0, 1, n2);
    hx[j * m + i] = a + n0[0] / n0[1];
    hz[j * m + i] = b + n0[2] / n0[1];
    maxSlope = Math.max(maxSlope, Math.hypot(hx[j * m + i], hz[j * m + i]));
  }
  // Hors du disque du dessin, la lumière ne doit pas bouger : pentes nulles
  // (raccord adouci entre r1 et r2, en part du demi-côté). On intègre sur une
  // grille deux fois plus grande, de même pas : ses bords, où la fenêtre
  // ramène la hauteur à zéro, tombent hors de la cuve.
  const G = 2 * m, off = (G - m) >> 1;
  const d = side / (M - 1);
  const [r1, r2] = taper;
  const gx = new Float64Array(G * G), gz = new Float64Array(G * G);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const r = Math.hypot(i / (m - 1) - 0.5, j / (m - 1) - 0.5) * 2;
    const t = Math.min(1, Math.max(0, (r2 - r) / (r2 - r1)));
    const w = t * t * (3 - 2 * t);
    gx[(j + off) * G + i + off] = hx[j * m + i] * w;
    gz[(j + off) * G + i + off] = hz[j * m + i] * w;
  }
  // ∇²h = ∂x hx + ∂z hz (différences centrées), Neumann
  const div = new Float64Array(G * G);
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    const k = j * G + i;
    div[k] = (gx[k + 1] - gx[k - 1] + gz[k + G] - gz[k - G]) / (2 * d);
  }
  const h = poissonNeumann(div, G, d);
  // hauteur nulle hors du dessin (moyenne de la couronne extérieure)
  let edge = 0, ne = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const r = Math.hypot((i - off) / (m - 1) - 0.5, (j - off) / (m - 1) - 0.5) * 2;
    if (r > r2 * 1.05 && r < r2 * 1.5) { edge += h[j * G + i]; ne++; }
  }
  edge /= ne;
  let maxH = 0;
  for (let k = 0; k < G * G; k++) { h[k] -= edge; maxH = Math.max(maxH, Math.abs(h[k])); }
  // contrôle : pentes résiduelles hors du dessin
  let leak = 0;
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    const r = Math.hypot((i - off) / (m - 1) - 0.5, (j - off) / (m - 1) - 0.5) * 2;
    if (r > r2 * 1.05) leak = Math.max(leak, Math.hypot(h[j * G + i + 1] - h[j * G + i - 1], h[(j + 1) * G + i] - h[(j - 1) * G + i]) / (2 * d));
  }
  return { h, m: G, side: d * (G - 1), center, maxSlope, maxH, leak, residual: T.residual, iterations: T.history.length, mag };
}

// Pose la lentille sur la grille du domaine des ondes (N×N, côté L, centré en
// 0), avec une fenêtre douce sur la dernière part `fade` de chaque bord.
export function embedLens(lens, N, L, fade = 0.06) {
  const { h, m, side, center } = lens;
  const out = new Float64Array(N * N);
  const dx = L / N;
  for (let j = 0; j < N; j++) {
    const z = -L / 2 + (j + 0.5) * dx;
    const v = (z - center[1]) / side + 0.5;
    if (v <= 0 || v >= 1) continue;
    for (let i = 0; i < N; i++) {
      const x = -L / 2 + (i + 0.5) * dx;
      const u = (x - center[0]) / side + 0.5;
      if (u <= 0 || u >= 1) continue;
      const fx = u * (m - 1), fz = v * (m - 1);
      const a = Math.min(m - 2, Math.floor(fx)), b = Math.min(m - 2, Math.floor(fz));
      const s = fx - a, t = fz - b, k = b * m + a;
      const val = (1 - t) * ((1 - s) * h[k] + s * h[k + 1]) + t * ((1 - s) * h[k + m] + s * h[k + m + 1]);
      const e = Math.min(u, 1 - u, v, 1 - v) / fade;
      const w = e >= 1 ? 1 : e * e * (3 - 2 * e);
      out[j * N + i] = val * w;
    }
  }
  return out;
}

// Spectre d'un champ réel N×N (FFT), filtré au-delà de `cut` × Nyquist pour
// que la grille ne crénelle pas ; renvoie re, im en Float32Array.
export function spectrum(field, N, cut = 0.72) {
  const re = new Float64Array(field), im = new Float64Array(N * N);
  fft2(re, im, N);
  const R = new Float32Array(N * N), I = new Float32Array(N * N);
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
    const kp = (p <= N / 2 ? p : p - N) / (N / 2), kq = (q <= N / 2 ? q : q - N) / (N / 2);
    const r = Math.hypot(kp, kq) / cut;
    const g = r < 1 ? 1 : Math.exp(-((r - 1) * (r - 1)) * 40);
    R[q * N + p] = re[q * N + p] * g;
    I[q * N + p] = im[q * N + p] * g;
  }
  return { re: R, im: I };
}

// Tout le calcul d'un dessin : cible → transport → lentille → spectre
export function buildEvent({ series, level, seed, N, L, H, light, side, imageCenter = [0, 0], rotation = 0, nt = 256, m = 256, ot = {}, onStep }) {
  const nu = target(series, level, seed, nt, { rotation });
  // centre de la lentille : là où la surface au repos envoie le centre du dessin
  const n2 = nWater(545);
  let center = [imageCenter[0], imageCenter[1]];
  for (let it = 0; it < 4; it++) {
    const L0 = flatLanding(light, [center[0], 0, center[1]], H, n2);
    center = [center[0] + imageCenter[0] - L0[0], center[1] + imageCenter[1] - L0[2]];
  }
  const lens = designLens({ nu, nt, side, center, H, light, m, ot: { ...ot, onStep } });
  const field = embedLens(lens, N, L);
  const spec = spectrum(field, N);
  return { spec, lens: { maxSlope: lens.maxSlope, maxH: lens.maxH, leak: lens.leak, residual: lens.residual, iterations: lens.iterations, mag: lens.mag, center, side }, nu };
}
