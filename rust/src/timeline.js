// L'horloge unique du film. Tout ce qui varie (pluie, ciel, humidité de la
// pièce, rouille, machines, caméra) lit ces fonctions de la phase u ∈ [0, 1).
//
//  0 ──── rain0 ═══ averses ═══ rain1 ── setup0 ── clean0 ═══ décapage ═══ clean1 ── retract1 ── 1
//   métal nu        (accéléré)            mise en place        (temps réel)            retrait
//
// τ(u), le temps d'humectation cumulé, n'avance que pendant les averses et le
// séchage qui les suit (la rouille éclair paraît en séchant) : 0 avant la
// première, 1 après la dernière, constant ensuite. La rouille ne recule
// jamais pendant les averses ; elle ne part que sous l'outil.
import { createRng } from './rng.js';

export const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const s5 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (6 * t - 15) + 10); };

// découpage par défaut (part de boucle)
export const PHASES = { rain0: 0.04, rain1: 0.36, setup0: 0.36, clean0: 0.44, clean1: 0.86, retract1: 0.95 };

// averses : n intervalles [s, e] dans [rain0, rain1], le dernier finit avant
// rain1 − dry (le séchage de la dernière tient dans les averses)
export function makeShowers(T, n, rng) {
  const span = T.rain1 - T.rain0, slot = span / n, out = [];
  for (let k = 0; k < n; k++) {
    const d = slot * rng.range(0.32, 0.42);
    const s = T.rain0 + k * slot + slot * rng.range(0.04, 0.12);
    out.push([+s.toFixed(4), +(s + d).toFixed(4)]);
  }
  return out;
}

// part de l'humectation apportée par chaque averse (la première pèse plus :
// la rouille éclair sur l'acier nu)
export const showerWeights = (n) => { const w = Array.from({ length: n }, (_, k) => 1 / (1 + 0.25 * k)); const s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); };

// temps d'humectation cumulé (0 → 1), monotone
export function tauAt(R, u) {
  const S = R.timing.showers, W = showerWeights(S.length), dry = R.timing.dry;
  let t = 0;
  for (let k = 0; k < S.length; k++) { const [s, e] = S[k]; t += W[k] * s5((u - s) / (e - s + dry)); }
  return Math.min(1, t);
}
// intensité de la pluie (0 → 1)
export function rainAt(R, u) {
  let r = 0;
  for (const [s, e] of R.timing.showers) { const d = e - s; r = Math.max(r, sstep(s, s + d * 0.2, u) * (1 - sstep(e - d * 0.25, e, u))); }
  return r;
}
// eau sur la pièce (mouillée sous l'averse, sèche ensuite) ; pendant le bain,
// la pièce ressort ruisselante (voir machines.js)
export function wetAt(R, u) {
  let w = 0;
  const dry = R.timing.dry;
  for (const [s, e] of R.timing.showers) {
    const up = sstep(s, s + (e - s) * 0.3, u);
    const down = u > e ? Math.exp(-(u - e) / (dry * 0.45)) : 1;
    w = Math.max(w, up * down * (u < s ? 0 : 1));
  }
  return w;
}
// ciel couvert (la lumière baisse un peu avant l'averse, revient après)
export function overcastAt(R, u) {
  let c = 0;
  for (const [s, e] of R.timing.showers) { const d = e - s; c = Math.max(c, sstep(s - d * 0.35, s + d * 0.15, u) * (1 - sstep(e, e + d * 0.6, u))); }
  return c;
}

// les courbes du film (pour les tests et tools/curves.mjs)
export function curves(R, n = 400) {
  const out = [];
  for (let i = 0; i <= n; i++) { const u = i / n; out.push({ u, tau: tauAt(R, u), rain: rainAt(R, u), wet: wetAt(R, u), sky: overcastAt(R, u) }); }
  return out;
}

export function makeTiming(rng, machine) {
  const T = { ...PHASES };
  if (machine === 'bain') { T.clean0 = 0.45; T.clean1 = 0.87; }
  const n = rng.pick([3, 4, 4, 5]);
  const showers = makeShowers(T, n, rng);
  const dry = +((T.rain1 - T.rain0) / n * 0.45).toFixed(4);
  return { ...T, showers, dry };
}

export { createRng };
