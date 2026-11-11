// Propagation des ondes et caustique de référence, sur le processeur —
// fonctions pures (le GPU fait la même chose à chaque image ; ce module sert
// aux tests et aux bancs d'essai).
//
// Une onde linéaire de capillarité-gravité dont l'état à τ = 0 est h₀ (vitesse
// nulle) s'écrit mode par mode : Ĥ(k, τ) = Ĥ₀(k)·cos(ω(k)τ)·e^{−2νk²|τ|}.
// cos est pair : l'onde qui converge (τ < 0) est celle qui diverge (τ > 0)
// lue à l'envers — le retournement temporel.

import { fft2 } from './fft.js';
import { omega, damping, nWater, refract, vnorm } from '../optics.js';

// nombre d'onde du mode (p, q) d'un domaine périodique de côté L
export const waveNumber = (p, q, N, L) => {
  const kp = ((p <= N / 2 ? p : p - N) * 2 * Math.PI) / L;
  const kq = ((q <= N / 2 ? q : q - N) * 2 * Math.PI) / L;
  return [kp, kq];
};

// champ (h, ∂h/∂x, ∂h/∂z) au temps physique τ
export function evolve(spec, N, L, H, tau) {
  const hr = new Float64Array(N * N), hi = new Float64Array(N * N);
  const sr = new Float64Array(N * N), si = new Float64Array(N * N);
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
    const [kx, kz] = waveNumber(p, q, N, L);
    const k = Math.hypot(kx, kz);
    const g = Math.cos(omega(k, H) * tau) * Math.exp(-damping(k) * Math.abs(tau));
    const i = q * N + p, a = spec.re[i] * g, b = spec.im[i] * g;
    hr[i] = a; hi[i] = b;
    // pentes : i·kx·Ĥ + i·(i·kz·Ĥ) → partie réelle hx, imaginaire hz
    // i·kx·(a + ib) = −kx·b + i·kx·a ; i·(i·kz·(a + ib)) = −kz·a − i·kz·b
    sr[i] = -kx * b - kz * a;
    si[i] = kx * a - kz * b;
  }
  fft2(hr, hi, N, true);
  fft2(sr, si, N, true);
  return { h: hr, hx: sr, hz: si };
}

// Caustique au fond (y = −H) : chaque cellule de la surface envoie sa lumière
// à travers l'eau ; on accumule le flux par cellule du fond (n×n sur le carré
// [x0, x0 + S]²), avec un dépôt bilinéaire. Renvoie l'éclairement relatif
// (1 = surface plane, soleil).
export function causticCPU(field, N, L, H, light, region, n = 256, lambda = 545) {
  const { h, hx, hz } = field;
  const [x0, z0, S] = region;
  const eta = 1 / nWater(lambda);
  const out = new Float64Array(n * n);
  const dx = L / N;
  const cell = S / n;
  for (let j = 0; j < N; j++) {
    const z = -L / 2 + (j + 0.5) * dx;
    if (z < z0 - 0.1 * S || z > z0 + 1.1 * S) continue;
    for (let i = 0; i < N; i++) {
      const x = -L / 2 + (i + 0.5) * dx;
      if (x < x0 - 0.1 * S || x > x0 + 1.1 * S) continue;
      const k = j * N + i;
      const P = [x, h[k], z];
      const nn = vnorm([-hx[k], 1, -hz[k]]);
      const inc = light.kind === 'sun' ? vnorm(light.dir) : vnorm([P[0] - light.pos[0], P[1] - light.pos[1], P[2] - light.pos[2]]);
      const t = refract(inc, nn, eta);
      if (!t) continue;
      // flux intercepté par la facette (projetée sur l'horizontale : dx²)
      const flux = Math.max(0, -(inc[0] * -hx[k] + inc[1] * 1 + inc[2] * -hz[k])) * dx * dx;
      const s = (-H - P[1]) / t[1];
      const fx = (P[0] + t[0] * s - x0) / cell - 0.5, fz = (P[2] + t[2] * s - z0) / cell - 0.5;
      const a = Math.floor(fx), b = Math.floor(fz), u = fx - a, v = fz - b;
      const dep = (ii, jj, w) => { if (ii >= 0 && jj >= 0 && ii < n && jj < n) out[jj * n + ii] += w; };
      dep(a, b, flux * (1 - u) * (1 - v)); dep(a + 1, b, flux * u * (1 - v));
      dep(a, b + 1, flux * (1 - u) * v); dep(a + 1, b + 1, flux * u * v);
    }
  }
  const inc0 = light.kind === 'sun' ? -vnorm(light.dir)[1] : 1;
  for (let k = 0; k < n * n; k++) out[k] /= cell * cell * inc0;
  return out;
}
