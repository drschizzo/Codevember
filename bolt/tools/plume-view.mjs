// Banc : simule le panache et écrit quelques images du traceur (PGM) pour tools/plume-view.py
import { simulatePlume, PLUME } from '../src/gen/plume.js';
import { writeFileSync } from 'node:fs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(k + '=')); return a ? +a.split('=')[1] : d; };
const t0 = performance.now();
const P = simulatePlume({ r0: arg('r0', 0.1), top: arg('top', 1.7), heat: arg('heat', 1), puffs: arg('puffs', 7), gamma: arg('gamma', 5), debug: arg('debug', 0), mix: arg('mix', 0.12) });
console.log('ms', Math.round(performance.now() - t0), 'rMax', P.rMax.toFixed(2), 'zMax', P.zMax.toFixed(2), 'masse', Array.from(P.mass).filter((_, i) => i % 9 === 0).map((m) => m.toFixed(0)).join(' '));
writeFileSync(process.argv[2], Buffer.from(P.frames));
writeFileSync(process.argv[2] + '.json', JSON.stringify({ NR: P.NR, NZ: P.NZ, NF: P.NF }));
