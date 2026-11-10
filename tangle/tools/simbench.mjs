// Banc d'essai de la simulation (Node) : tord un brin, puis lâche le volant.
//   TURNS=16 HZ=3000 N=72 node tangle/tools/simbench.mjs
import { createRod, twist, writhe } from '../src/gen/rod.js';

const E = (k, d) => Number(process.env[k] ?? d);
const L = 0.62, n = E('N', 72), B = E('B', 2.4e-3), M = E('M', 0.11), Rf = 0.045;
const spec = {
  strands: [{ top: [0, 0, 0], bottom: [0, 0.01, 0], n }],
  L, r: 0.005, mu: 0.06, B1: B, B2: B, C: B / 1.4, inertiaScale: E('IS', 100),
  fly: { M, I: M * Rf * Rf / 2, drag: E('DRAG', 3e-5), friction: E('FRIC', 4e-5), vdamp: E('VD', 1.5), yMin: -1 },
  imperfection: { kappa: 0.6 }, topY: 0.8, damp: E('DAMP', 1.2), dampW: E('DAMPW', 4), friction: 0.3,
  iterations: 1, pairEvery: 4, clearTop: 0.004, clearFly: 0.004,
};
const rod = createRod(spec);
const hz = E('HZ', 3000), dt = 1 / hz;
const turns = E('TURNS', 16), rate = E('RATE', 1.2);
const T1 = 0.5 + turns / rate + 1, T2 = T1 + E('REL', 8);
const t0 = performance.now();
let lastPrint = -1, maxW = 0;
const y0 = rod.state.fly.y, dump = [];
for (let i = 0; ; i++) {
  const t = i * dt;
  if (t > T2) break;
  const theta = 2 * Math.PI * Math.min(turns, Math.max(0, t - 0.5) * rate);
  rod.step(dt, { theta, locked: t < T1, lockPhi: 0, detent: 0 });
  maxW = Math.max(maxW, Math.abs(rod.state.fly.w));
  if (Math.floor(t * 2) !== lastPrint) {
    lastPrint = Math.floor(t * 2);
    dump.push({ t, P: Array.from(rod.state.P, (x) => +x.toFixed(4)), fy: rod.state.fly.y });
    const P = rod.state.P;
    let stretch = 0, rmax = 0;
    for (let v = 0; v < n; v++) { const d = Math.hypot(P[v * 3 + 3] - P[v * 3], P[v * 3 + 4] - P[v * 3 + 1], P[v * 3 + 5] - P[v * 3 + 2]); stretch = Math.max(stretch, Math.abs(d / (L / n) - 1)); }
    for (let v = 0; v <= n; v++) rmax = Math.max(rmax, Math.hypot(P[v * 3], P[v * 3 + 2]));
    const lk = (theta - rod.state.fly.phi) / 2 / Math.PI, wr = writhe(rod);
    console.log(`t=${t.toFixed(1)} Lk=${lk.toFixed(2)} Tw=${twist(rod).toFixed(2)} Wr=${wr.toFixed(2)} Tw+Wr=${(twist(rod) + wr).toFixed(2)} phi=${(rod.state.fly.phi / 2 / Math.PI).toFixed(2)}t w=${(rod.state.fly.w / 2 / Math.PI).toFixed(2)}t/s dy=${((rod.state.fly.y - y0) * 1000).toFixed(1)}mm rmax=${(rmax * 1000).toFixed(0)}mm stretch=${(stretch * 100).toFixed(2)}% contacts=${rod.state.contacts}`);
  }
}
console.log(`${((performance.now() - t0) / 1000).toFixed(2)} s pour ${T2.toFixed(1)} s physiques ; ω max ${(maxW / 2 / Math.PI).toFixed(1)} t/s`);

if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(dump));
