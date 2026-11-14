// coupe verticale du champ τ (instant de fonte) par le centre : PGM couleur
import { simulate, P0 } from './sim.mjs';
import { writeFileSync } from 'node:fs';
const over = JSON.parse(process.argv[2] ?? '{}');
const P = { ...P0, ...over };
const t0 = performance.now();
const R = simulate(P, { log: true });
console.log('pas', R.steps, 'dt', R.dt.toExponential(2), 'durée', ((performance.now() - t0) / 1000).toFixed(1), 's');
const { tau, nx, ny, nz } = R, k = nz >> 1;
const rows = [];
for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) {
  const v = tau[i + nx * (j + ny * k)];
  if (v === 0) rows.push(20, 20, 24); else if (v > 50) rows.push(255, 255, 255);
  else { const x = Math.min(v / P.uEnd, 1); rows.push(255 * x, 80 + 120 * Math.sin(Math.PI * x), 255 * (1 - x)); }
}
writeFileSync(process.argv[3] ?? 'slice.ppm', Buffer.concat([Buffer.from(`P6 ${nx} ${ny} 255\n`), Buffer.from(Uint8Array.from(rows.map((v) => Math.round(v))))]));
writeFileSync((process.argv[3] ?? 'slice.ppm').replace('.ppm', '.bin'), Buffer.from(tau.buffer));
