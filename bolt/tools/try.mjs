// Banc : recette → récipient → disposition → éclair, sur N graines ; statistiques
import { generate, layout, MOODS } from '../src/recipe.js';
import { buildVessel } from '../src/gen/vessels.js';
import { boltFor } from '../src/gen/worker.js';
const N = +(process.argv[2] || 40);
const stat = {};
let fails = 0;
for (let i = 0; i < N; i++) {
  const R = generate(`t${i}`);
  const { meta } = buildVessel(R.vessel);
  const L = layout(R, meta);
  const t0 = performance.now();
  try {
    const b = boltFor(L.spec, R.bolt.rough);
    const ms = performance.now() - t0;
    const k = R.bolt.family;
    (stat[k] ??= []).push([b.sites, b.seg.length / 12, ms, b.strokes.length]);
  } catch (e) { fails++; console.log('ÉCHEC', R.seed, R.vessel.variant, R.bolt.family, e.message); }
}
for (const [k, v] of Object.entries(stat)) {
  const m = (j) => (v.reduce((a, x) => a + x[j], 0) / v.length).toFixed(0), mx = (j) => Math.max(...v.map((x) => x[j])).toFixed(0);
  console.log(k.padEnd(7), 'n', v.length, 'sites', m(0), '/', mx(0), 'segments', m(1), '/', mx(1), 'ms', m(2), '/', mx(2), 'canaux', m(3));
}
console.log('échecs', fails, '/', N, 'humeurs', Object.keys(MOODS).length);
