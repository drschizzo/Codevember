// Banc d'essai du solveur : quelques transitions par famille, temps et coûts.
//   node tools/try.mjs [famille] [n]
import { systemOf, targetAngles, FAMILIES } from '../src/gen/machines.js';
import { solveTransition } from '../src/gen/shoot.js';

const fam = process.argv[2] ?? 'cart', nl = Number(process.argv[3] ?? 2);
const bar = (l, metal = 'alu') => ({ l, w: 0.03, t: 0.008, metal, fill: 0.7 });
const M = {
  cart: { family: 'cart', links: Array.from({ length: nl }, (_, i) => bar(0.42 - 0.06 * i)) },
  rotary: { family: 'rotary', links: Array.from({ length: nl }, (_, i) => bar(0.36 - 0.05 * i)), arm: { r: 0.26 } },
  acrobat: { family: 'acrobat', links: [bar(0.36), bar(0.44)], motor: { m: 0.5, at: 0.12 } },
  wheel: { family: 'wheel', links: Array.from({ length: nl }, (_, i) => bar(0.4 - 0.05 * i)), wheel: { m: 0.6, r: 0.1, rim: 0.8, motor: 0.25 } },
}[fam];
const sys = systemOf(M);
const F = FAMILIES[fam];
const n = M.links.length;
const seqs = n === 1 ? [['D', 'U'], ['U', 'D']] : n === 2 ? [['DD', 'DU'], ['DU', 'UU'], ['UU', 'UD'], ['UD', 'DD'], ['DD', 'UU']] : [['DDD', 'UUU'], ['DDD', 'DUD'], ['UUU', 'UDU'], ['UDU', 'DDD']];
const codeAngles = (c) => [...c].map((ch) => (ch === 'U' ? Math.PI : 0));
for (const [a, b] of seqs) {
  const th0 = codeAngles(a);
  const changes = [...a].filter((ch, i) => ch !== b[i]).length;
  let best = null;
  const t0 = performance.now();
  let tries = 0;
  for (let mask = 0; mask < (1 << n) && tries < 8; mask++) {
    const signs = Array.from({ length: n }, (_, i) => ((mask >> i) & 1 ? -1 : 1));
    // (inutile d'essayer deux sens pour un maillon qui ne change pas)
    if (signs.some((s, i) => s < 0 && a[i] === b[i])) continue;
    for (const tm of [1, 1.2]) {
      tries++;
      const th1 = targetAngles(th0, b, signs);
      const X0 = sys.restState(th0), X1 = sys.restState(th1);
      let seed = 7 + mask * 31 + tm * 100; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const T = F.T[Math.min(changes, F.T.length) - 1] * tm;
      const r = solveTransition(sys, { T, X0, X1, ...F.weights, N: n === 3 ? 80 : 60, S: n === 3 ? 16 : 12, rng });
      const tag = `${signs.join('')} T${T.toFixed(1)} ok${+r.ok} it${r.it} cost${r.cost.toFixed(2)} s[${r.sMin.toFixed(2)},${r.sMax.toFixed(2)}] u${r.uMax.toFixed(1)}`;
      if (process.env.V) console.log('   ', tag);
      if (r.ok && (!best || r.cost < best.r.cost)) best = { r, tag };
    }
  }
  console.log(`${fam}${n} ${a}→${b}: ${best ? best.tag : 'ÉCHEC'}  (${tries} essais, ${(performance.now() - t0).toFixed(0)} ms)`);
}
