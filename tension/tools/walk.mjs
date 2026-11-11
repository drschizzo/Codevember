import { prepare } from '../src/gen/gait.js';
const fam = process.argv[2] || 'culbute', n = +(process.argv[3] || 3);
const spec = { ...(fam === 'culbute' ? { family: fam, n } : { family: fam, m: n }), ...JSON.parse(process.argv[4] || '{}') };
const t0 = performance.now();
const P = prepare(spec, (p, s) => process.stdout.write(`\r${s} ${(p*100).toFixed(0)}%   `));
console.log('\ntime', ((performance.now()-t0)/1000).toFixed(2), 's  film', P.time.toFixed(2), 's  d', P.d.map(v=>v.toFixed(3)), '|d|', Math.hypot(...P.d).toFixed(2), 'yaw°', (P.yaw*180/Math.PI).toFixed(3), 'res', P.residual.toExponential(2), 'final', P.finalErr.toExponential(2), 'iters', P.iters, 'seq', P.seq);
console.log('events', P.events.map(e=>e.t.toFixed(2)).join(' '));
const N = P.T.nodes.length, F = P.frames;
let line = '';
for (let f = 0; f < F.length; f += Math.round(F.length/30)) {
  let cx=0, cy=0, cz=0; for (let i=0;i<N;i++){cx+=F[f][i*3];cy+=F[f][i*3+1];cz+=F[f][i*3+2];}
  line += `${(f/240).toFixed(1)}:${(cx/N).toFixed(2)},${(cy/N).toFixed(2)},${(cz/N).toFixed(2)}  `;
}
console.log(line);
