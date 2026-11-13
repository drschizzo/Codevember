// Banc : fait pousser des décharges et écrit leurs segments en JSON pour une planche (tools/bolt-view.py)
import { buildBolt, tessellate } from '../src/gen/dbm.js';
import { writeFileSync } from 'node:fs';
const fam = process.argv[2] || 'strike', out = process.argv[3] || '/tmp/bolts.json';
const specs = {
  strike: (s) => ({ family: 'strike', seed: s, h: 0.05, eta: 3.4, beta: 0.5, active: 32, root: [0.1, 1.55, 0], targets: [[0.42, 0.62, 0.05]], field: 'down', box: { r: 1.2, y0: 0.5, y1: 1.6 }, obstacles: [] }),
  fork: (s) => ({ family: 'fork', seed: s, h: 0.05, eta: 2.8, beta: 0.45, active: 40, root: [0, 1.55, 0], targets: [[0, 0.3, 0]], surface: { y: 0.3, r: 0.5 }, forks: 2, field: 'down', box: { r: 1.2, y0: 0.2, y1: 1.6 }, obstacles: [{ type: 'shell', rIn: 0.55, rOut: 0.62, yTop: 0.36, yFloor: 0.3 }] }),
  upward: (s) => ({ family: 'upward', seed: s, h: 0.05, eta: 3, beta: 0.42, active: 30, root: [0, 0.8, 0], targets: [[0, 1.7, 0]], stopAt: 320, field: 'up', box: { r: 1.0, y0: 0.7, y1: 1.72 }, obstacles: [] }),
  spider: (s) => ({ family: 'spider', seed: s, h: 0.05, eta: 3.6, beta: 0.55, active: 30, root: [-0.3, 1.5, 0], targets: [[0.3, 0.7, 0]], field: 'point', slab: { y0: 1.42, y1: 1.56, count: 150 }, box: { r: 0.9, y0: 0.6, y1: 1.6 }, obstacles: [] }),
};
const all = [];
for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  const b = buildBolt(specs[fam](`v${i}`));
  const seg = tessellate(b, { seed: i + 1 });
  all.push({ seg: Array.from(seg).map((x) => +x.toFixed(4)), n: b.n, sites: b.sites, ms: Math.round(performance.now() - t0), len: b.strokes.map((s) => +s.length.toFixed(2)) });
  console.log(fam, i, 'sites', b.sites, 'gardés', b.n, 'segments', seg.length / 12, 'ms', Math.round(performance.now() - t0), 'canaux', b.strokes.map((s) => s.length.toFixed(2)).join(' '));
}
writeFileSync(out, JSON.stringify(all));
