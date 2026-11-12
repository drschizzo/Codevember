// Banc de la mer : node kelp/tools/sea.mjs [boucles] — courbes du film
// (profondeur en quelques points, front de rive, écume), raccord, temps.
import { simulateSea, sampleField, makeProfile } from '../src/gen/sea.js';
const T = 32;
export const SPEC = {
  T, x0: -9, x1: 10,
  profile: { depth: 1.4, edgeX: -2.8, edgeW: 0.8, shelf: 0.05, slope: 0.06, riseX: 1.0, rise: 0.09 },
  waves: [
    { t: 5, A: 0.3, beta: 0.45, d: 2.6, tc: 1.2, tt: 1.7 },
    { t: 12.5, A: 0.45, beta: 0.55, d: 2.8, tc: 1.3, tt: 1.8 },
    { t: 20, A: 0.7, beta: 0.8, d: 3.1, tc: 1.5, tt: 2.0 },
  ],
  loops: Number(process.argv[2] ?? 2),
};
const t0 = performance.now();
const S = simulateSea(SPEC);
console.log(`nx ${S.nx}, nf ${S.nf}, steps ${S.stats.steps}, ${(performance.now() - t0).toFixed(0)} ms, résidus ${JSON.stringify(S.stats.residual)}`);
const prof = makeProfile(SPEC.profile);
const xs = [-4, -2.8, -2, -1.2, -0.6, 0, 1, 2, 3];
console.log('b(x)  ', xs.map((x) => `${x}:${prof(x).toFixed(2)}`).join(' '));
const front = (t) => { let xf = -9; for (let x = -4; x < 10; x += 0.05) { const e = sampleField(S, S.eta, x, t); if (e - prof(x) > 0.015) xf = x; else if (x > -2.5) break; } return xf; };
for (let t = 0; t < T; t += 0.5) {
  const row = xs.map((x) => { const d = sampleField(S, S.eta, x, t) - prof(x); return (d > 0.003 ? d.toFixed(2) : '  .').padStart(5); });
  const fo = xs.slice(1).map((x) => { const v = sampleField(S, S.foam, x, t); return v > 0.05 ? v.toFixed(1) : ' .'; }).join(' ');
  const u = xs.slice(1, 6).map((x) => sampleField(S, S.u, x, t).toFixed(1).padStart(5)).join('');
  console.log(`${t.toFixed(1).padStart(5)} |${row.join('')} | front ${front(t).toFixed(2).padStart(5)} | u${u} | écume ${fo}`);
}
