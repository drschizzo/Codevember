// avance de la fonte sur la ligne de métal : τ − u_ligne(y), en coupe
// (bleu : fondu avant que le bain n'arrive ; rouge : fondu sous le bain ; blanc : jamais)
import { simulate, P0 } from './sim.mjs';
import { writeFileSync } from 'node:fs';
const P = { ...P0, ...JSON.parse(process.argv[2] ?? '{}') };
const R = simulate(P);
const { tau, nx, ny, nz } = R;
const uline = (y) => Math.pow(Math.min(Math.max((y - P.LL) / (P.LH - P.LL), 0), 1), 1 / P.rise);
const out = [], stats = [];
for (const k of [nz >> 1, Math.round(nz * 0.38)]) for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) {
  const v = tau[i + nx * (j + ny * k)], y = (j + 0.5) * P.h;
  if (v === 0) out.push(20, 20, 24); else if (v > 50) out.push(255, 255, 255);
  else { const d = v - uline(y); if (y > P.LL) stats.push(d); const x = Math.max(-1, Math.min(1, d / 0.3)); out.push(x > 0 ? 255 : 255 * (1 + x), 255 * (1 - Math.abs(x)), x < 0 ? 255 : 255 * (1 - x)); }
}
stats.sort((a, b) => a - b);
const q = (f) => stats[Math.floor(f * (stats.length - 1))].toFixed(3);
console.log(`avance τ−u_ligne : p5 ${q(0.05)}  p25 ${q(0.25)}  médiane ${q(0.5)}  p75 ${q(0.75)}  p95 ${q(0.95)}`);
writeFileSync(process.argv[3], Buffer.concat([Buffer.from(`P6 ${nx} ${ny * 2} 255\n`), Buffer.from(Uint8Array.from(out.map(Math.round)))]));
