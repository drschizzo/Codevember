// Banc d'essai du transport optimal : dessine la cible, résout, pousse la
// lumière, écrit les images (PGM) et imprime la convergence.
//   node tools/ot.mjs [série] [niveau] [dossier]
import fs from 'node:fs';
import { target } from '../src/gen/motifs.js';
import { solveTransport, pushForward } from '../src/gen/transport.js';

const [series = 'diatom', level = '1', dir = '/tmp'] = process.argv.slice(2);
const nt = 256;
const t0 = performance.now();
const nu = target(series, +level, 'test', nt);
let mean = 0, mn = 1e9, mx = 0;
for (const v of nu) { mean += v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
console.log(`cible ${series}/${level} : moyenne ${(mean / nu.length).toFixed(4)} min ${mn.toFixed(3)} max ${mx.toFixed(3)} (${(performance.now() - t0).toFixed(0)} ms)`);
const t1 = performance.now();
const T = solveTransport(nu, nt, { iters: +(process.env.ITERS || 80), onStep: (i, r) => { if (i % 10 === 0) console.log(`  it ${i} résidu ${r.toFixed(4)}`); } });
console.log(`transport : ${T.history.length} itérations, résidu ${T.residual.toFixed(4)} (${(performance.now() - t1).toFixed(0)} ms)`);
const pf = pushForward(T, 128);
const pgm = (name, a, n, scale) => {
  const b = Buffer.alloc(n * n);
  for (let i = 0; i < n * n; i++) b[i] = Math.max(0, Math.min(255, Math.round((a[i] / scale) * 255)));
  fs.writeFileSync(`${dir}/${name}.pgm`, Buffer.concat([Buffer.from(`P5 ${n} ${n} 255\n`), b]));
};
pgm(`ot-${series}${level}-target`, nu, nt, mx);
pgm(`ot-${series}${level}-push`, pf, 128, mx);
