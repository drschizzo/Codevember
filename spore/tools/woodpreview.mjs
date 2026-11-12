// Aperçu des bois cuits dans Node : couleur ombrée par la pente (lumière rasante),
// une image PPM par support, puis planche (python/PIL).
import fs from 'node:fs';
import { bakeWood } from '../src/gen/wood.js';
import { MOODS } from '../src/recipe.js';
const out = process.argv[2] || '.';
const M = +(process.argv[3] || 512);
for (const [k, m] of Object.entries(MOODS)) {
  const t0 = performance.now();
  const b = bakeWood({ ...m.wood, seed: 'a1', L: 4.4, W: 5.2, M, logR: 6.5 });
  const t = performance.now() - t0;
  const W = M, H = M, px = Buffer.alloc(W * H * 3);
  const L = [-0.6, 0.5, 0.35], ln = Math.hypot(...L);
  let hmin = 1e9, hmax = -1e9;
  for (let o = 0; o < M * M; o++) { hmin = Math.min(hmin, b.rel[o * 4]); hmax = Math.max(hmax, b.rel[o * 4]); }
  for (let o = 0; o < M * M; o++) {
    const hx = b.rel[o * 4 + 1], hz = b.rel[o * 4 + 2], nl = Math.hypot(hx, 1, hz);
    const d = Math.max(0, (-hx * L[0] + L[1] - hz * L[2]) / (nl * ln));
    const sh = (0.25 + 1.2 * d) * b.rel[o * 4 + 3];
    for (let c = 0; c < 3; c++) px[o * 3 + c] = Math.min(255, b.col[o * 4 + c] * sh);
  }
  fs.writeFileSync(`${out}/wood-${k}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), px]));
  console.log(k, m.wood.pattern, `${t.toFixed(0)} ms`, 'h', hmin.toFixed(4), hmax.toFixed(4));
}
