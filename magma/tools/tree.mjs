// Banc d'essai de l'arbre des orteils : statistiques et image vue de dessus
// (relief ombré en lumière rasante, nouvelle nappe à l'instant t colorée par
// son âge). Usage : node magma/tools/tree.mjs [graine] [t (s)] [sortie.ppm]
import fs from 'node:fs';
import { growTree, bakeLists, surfaceFromLists, makeIndex, topAt, toeZ, local, outline, passTime } from '../src/gen/toes.js';

const seed = process.argv[2] ?? 'a1', tq = Number(process.argv[3] ?? 300), outp = process.argv[4] ?? '/tmp/tree.ppm';
const spec = {
  seed, F: 3.2, sources: [{ x: -0.3, z: -1.6, heading: 1.5, t: 0, fan: [-0.9, 0.9] }],
  slope: { dir: 1.5, grade: 0.03, bias: 0.6 }, L: 0.38, aspect: 0.62, hT: 0.14, speed: 0.012, delay: [6, 25], corr: 0.8, spread: 0.7,
};
let t0 = performance.now();
const tree = growTree(spec);
const t1 = performance.now();
const h = 0.11;
const L = bakeLists(tree, 1024, h);
const t2 = performance.now();
let tmax = 0;
for (let k = 0; k < tree.n; k++) tmax = Math.max(tmax, tree.T[k * 12 + 8] + tree.T[k * 12 + 9]);
console.log(`orteils ${tree.n}  croissance ${(t1 - t0).toFixed(0)} ms  listes ${(t2 - t1).toFixed(0)} ms  débordement ${(L.overflow * 100).toFixed(2)} %  vides ${(L.empty * 100).toFixed(2)} %  durée ${(tmax / 60).toFixed(1)} min`);
// image
const W = 600, F = 3.2, img = Buffer.alloc(W * W * 3);
const Sg = new Float32Array(W * W), lay = new Uint8Array(W * W), age = new Float32Array(W * W);
for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
  const x = -F + ((i + 0.5) / W) * 2 * F, z = -F + ((j + 0.5) / W) * 2 * F;
  const r = surfaceFromLists(tree.T, L, x, z, tq, h);
  Sg[j * W + i] = r.S; lay[j * W + i] = r.layer;
  if (r.layer) { const [s, v] = local(tree.T, r.top, x, z); age[j * W + i] = tq - passTime(tree.T, r.top, s, v); }
}
const px = (2 * F) / W;
for (let j = 1; j < W - 1; j++) for (let i = 1; i < W - 1; i++) {
  const q = j * W + i, gx = (Sg[q + 1] - Sg[q - 1]) / (2 * px), gz = (Sg[q + W] - Sg[q - W]) / (2 * px);
  const nl = Math.hypot(gx, gz, 1), sh = Math.max(0, (-gx * 0.7 - gz * 0.3 + 0.6) / nl);
  let c = [0.25 + 0.6 * sh, 0.27 + 0.6 * sh, 0.3 + 0.6 * sh];
  if (lay[q]) { const a = age[q]; const hot = Math.exp(-a / 40); c = [c[0] * 0.5 + hot, c[1] * 0.45 + hot * 0.45, c[2] * 0.4 + hot * 0.1]; }
  for (let ch = 0; ch < 3; ch++) img[q * 3 + ch] = Math.max(0, Math.min(255, c[ch] * 255));
}
fs.writeFileSync(outp, Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), img]));
