// Planche des programmes du collier (réaction-diffusion) : une image par programme.
//   node feather/tools/patterns.mjs <dossier de sortie>
import fs from 'node:fs';
import { PROGRAMS, simulateCollar, normalizePattern } from '../src/gen/pattern.js';
const out = process.argv[2] || '.';
const nx = 128, nz = 192;
for (const k of Object.keys(PROGRAMS)) {
  for (const s of ['a', 'b']) {
    const t0 = performance.now();
    const f = simulateCollar(k, s, { nx, nz });
    let mn = Infinity, mx = -Infinity; for (const v of f) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const n = normalizePattern(f);
    const px = Buffer.alloc(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) px[(nz - 1 - j) * nx + i] = 255 - Math.round(n[j * nx + i] * 255);
    fs.writeFileSync(`${out}/pat-${k}-${s}.pgm`, Buffer.concat([Buffer.from(`P5 ${nx} ${nz} 255\n`), px]));
    console.log(k, s, (performance.now() - t0).toFixed(0) + 'ms', mn.toFixed(3), mx.toFixed(3));
  }
}
