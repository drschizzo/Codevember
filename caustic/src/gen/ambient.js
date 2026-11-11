// La ride de fond : un champ aléatoire de petites ondes capillaires (un
// souffle d'air, les vibrations de la pièce), anneau de nombres d'onde autour
// de k0, étalé autour d'une direction — fonctions pures.
//
// Le GPU en fait des ondes progressives : ½[a(k)e^{−iωt} + conj(a(−k))e^{iωt}],
// réelles, aux fréquences arrondies à des multiples de 2π/T (boucle exacte).
// On normalise a pour que la hauteur ait un écart type de 1 (m) à t = 0 :
// l'amplitude de la recette est alors l'écart type en mètres.
import { createRng } from '../rng.js';
import { fft2 } from './fft.js';

export function ambientSpectrum({ seed, N, L, k0 = 200, spread = 1, dir = 0 }) {
  const rng = createRng(`${seed}:ambient`);
  const NN = N * N;
  const a = new Float32Array(NN * 2);
  const dk = (2 * Math.PI) / L;
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
    const kx = (p <= N / 2 ? p : p - N) * dk, kz = (q <= N / 2 ? q : q - N) * dk;
    const k = Math.hypot(kx, kz);
    if (k < 1e-9) continue;
    // anneau log-normal autour de k0, étalement angulaire cos^(2s)
    const lr = Math.log(k / k0);
    let amp = Math.exp(-(lr * lr) / (2 * 0.35 * 0.35)) / k;
    const th = Math.atan2(kz, kx) - dir;
    amp *= 0.25 + Math.pow(Math.abs(Math.cos(th / 2)), 2 * spread);
    const g1 = rng.gauss(), g2 = rng.gauss();
    a[2 * (q * N + p)] = amp * g1;
    a[2 * (q * N + p) + 1] = amp * g2;
  }
  // écart type à t = 0 du champ réel correspondant
  const re = new Float64Array(NN), im = new Float64Array(NN);
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
    const c = q * N + p, cn = ((N - q) % N) * N + ((N - p) % N);
    re[c] = 0.5 * (a[2 * c] + a[2 * cn]);
    im[c] = 0.5 * (a[2 * c + 1] - a[2 * cn + 1]);
  }
  fft2(re, im, N, true);
  let s = 0;
  for (let i = 0; i < NN; i++) s += re[i] * re[i];
  const rms = Math.sqrt(s / NN) || 1;
  // (fft2 inverse et le GPU divisent tous deux par N² : même échelle)
  const scale = 1 / rms;
  for (let i = 0; i < NN * 2; i++) a[i] *= scale;
  return a;
}
