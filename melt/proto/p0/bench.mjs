// coût par pas selon le nombre de V-cycles : node bench.mjs dx
import { Sim } from './sim.js';
const dx = +(process.argv[2] ?? 0.25e-3);
for (const nV of [0, 1, 2]) {
  const s = new Sim({ dx, R: 0.04, Z: 0.144, Tinf: 8, F: 20, nV, geom: { a: 0.014, z0: 0.027, z1: 0.117, sup: [{ r: 0.014, z0: -1, z1: 0.027 }] } });
  for (let n = 0; n < 100; n++) s.step();
  const t0 = performance.now(); for (let n = 0; n < 400; n++) s.step();
  const ms = (performance.now() - t0) / 400;
  console.log(`dx=${dx * 1e3}mm ${s.nr}x${s.nz} nV=${nV}: ${ms.toFixed(2)} ms/step, ${(ms * 1e6 / (s.nr * s.nz)).toFixed(0)} ns/cell`);
}
