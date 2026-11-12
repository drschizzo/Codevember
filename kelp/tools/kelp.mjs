// Banc des laminaires : node kelp/tools/kelp.mjs [famille] [boucles]
// temps de calcul, écart au raccord, étirement, courbes (hauteur des lanières
// au-dessus de la roche, part immergée) le long de la boucle.
import { simulateSea, sampleField } from '../src/gen/sea.js';
import { bakeRock, sampler, makePools } from '../src/gen/rock.js';
import { layoutPlants, buildKelp, simulateKelp } from '../src/gen/kelp.js';
const fam = process.argv[2] ?? 'digitata', loops = Number(process.argv[3] ?? 2);
const T = 32;
const profile = { depth: 1.4, edgeX: -2.8, edgeW: 0.8, shelf: 0.05, slope: 0.06, riseX: 1.2, rise: 0.06 };
const waves = [
  { t: 5, A: 0.3, beta: 0.45, d: 2.6, tc: 1.2, tt: 1.7 },
  { t: 12.5, A: 0.45, beta: 0.55, d: 2.8, tc: 1.3, tt: 1.8 },
  { t: 20, A: 0.7, beta: 0.8, d: 3.1, tc: 1.5, tt: 2.0 },
];
let t0 = performance.now();
const sea = simulateSea({ T, x0: -9, x1: 10, profile, waves, loops: 2, fps: 60 });
console.log(`mer ${(performance.now() - t0).toFixed(0)} ms`);
t0 = performance.now();
const box = { x0: -7, x1: 9, z0: -12, z1: 4 };
const rock = bakeRock({ type: 'granite', seed: 'a1', profile, box, M: 512, pools: makePools('a1', { x0: -1.5, x1: 3, z0: -8, z1: 1 }, 5) });
const H = sampler(rock, rock.Hc);
console.log(`roche ${(performance.now() - t0).toFixed(0)} ms`);
const plants = layoutPlants(fam, 'a1', { x0: -2.7, x1: -0.3, z0: -5, z1: 0.8 }, H, { near: { x: -0.8, z: 0.8 }, nearR: 3, max: Number(process.env.MAXP ?? 40) });
const K = buildKelp(fam, plants, H);
console.log(`${plants.length} plantes, ${K.nodes.length} nœuds, ${K.chains.length} chaînes, ${K.bend.length} flexions`);
t0 = performance.now();
const R = simulateKelp(K, { sea, rockH: H, T, fps: 30, sub: Number(process.env.SUB ?? 480), loops }, (p) => process.stdout.write(`\r${(p * 100).toFixed(0)} %   `));
console.log(`\nlaminaires ${(performance.now() - t0).toFixed(0)} ms, raccord ${JSON.stringify(R.stats.residual)}, étirement ${(R.stats.maxStretch * 100).toFixed(2)} %, ${JSON.stringify(R.stats)}`);
// courbes : hauteur moyenne des nœuds de lanière au-dessus de la roche, part immergée, profondeur à x = −1.5
const blade = K.nodes.map((o, i) => (o.kind === 1 ? i : -1)).filter((i) => i >= 0);
for (let f = 0; f < R.nf; f += 15) {
  let hs = 0, sub = 0, top = 0;
  for (const i of blade) {
    const x = R.pos[(f * R.n + i) * 3], y = R.pos[(f * R.n + i) * 3 + 1], z = R.pos[(f * R.n + i) * 3 + 2];
    const g = H(x, z), d = y - g; hs += d; top = Math.max(top, d);
    if (sampleField(sea, sea.eta, x, f / 30 - 0.06 * z) > y) sub++;
  }
  const dep = Math.max(0, sampleField(sea, sea.eta, -1.5, f / 30) - H(-1.5, -2));
  console.log(`${(f / 30).toFixed(1).padStart(5)} | prof(−1.5) ${dep.toFixed(2)} | hauteur moy ${(hs / blade.length * 100).toFixed(1).padStart(5)} cm, max ${(top * 100).toFixed(0).padStart(3)} cm | immergés ${(sub / blade.length * 100).toFixed(0).padStart(3)} %`);
}
