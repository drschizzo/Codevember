// Planche de cristaux : node tools/sweep.mjs <sortie.png-sans-ext> '<json [[nom, params]...]>'
import { grow, cellXY } from '../src/gen/growth.js';
import fs from 'node:fs';
const [out, json] = process.argv.slice(2);
const sets = JSON.parse(json);
const W = 300;
const imgs = [];
for (const [name, p] of sets) {
  const t0 = Date.now();
  const g = grow({ R: 100, sigma: 0, ...p });
  const { L, a, c, T } = g;
  let cmin = 9, cmax = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) { cmin = Math.min(cmin, c[i]); cmax = Math.max(cmax, c[i]); }
  const img = Buffer.alloc(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const X = (x - W / 2) / (W / 2) * L.R, Y = (y - W / 2) / (W / 2) * L.R;
    const r = Math.round(Y / (Math.sqrt(3) / 2)), q = Math.round(X - r / 2);
    if (Math.abs(q) > L.R || Math.abs(r) > L.R) continue;
    const i = (r + L.R) * L.N + (q + L.R);
    if (a[i]) img[y * W + x] = 50 + 205 * (c[i] - cmin) / (cmax - cmin + 1e-6);
  }
  console.log(name, 'steps', g.steps, 'rmax', g.rmax, 'ms', Date.now() - t0, 'c', cmin.toFixed(2), cmax.toFixed(2));
  imgs.push(img);
}
const cols = Math.min(6, imgs.length), rows = Math.ceil(imgs.length / cols);
const S = Buffer.alloc(cols * W * rows * W);
imgs.forEach((im, k) => { const ox = (k % cols) * W, oy = Math.floor(k / cols) * W; for (let y = 0; y < W; y++) im.copy(S, (oy + y) * cols * W + ox, y * W, y * W + W); });
fs.writeFileSync(out + '.pgm', Buffer.concat([Buffer.from(`P5 ${cols * W} ${rows * W} 255\n`), S]));
