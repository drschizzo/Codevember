// Résout la scène (pose, ancienne plume, voisines) puis repasse le banc des traversées.
import { generate } from '../src/recipe.js';
import { layoutPlumage, barbTable } from '../src/gen/feather.js';
import { solveScene, sceneCrossings } from '../src/gen/collide.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['33'];
for (const seed of seeds) {
  const R = generate(seed), P = R.shape, T = R.tile ?? P, lay = layoutPlumage(P, R.seed, { tile: R.tile });
  const tables = { hero: barbTable(P, R.seed), tile: barbTable(T, `${R.seed}:tile`, 10) };
  let t0 = performance.now();
  const solved = solveScene(R, lay, tables);
  console.log(seed, R.family, 'résolu en', ((performance.now() - t0) / 1000).toFixed(1), 's ; voisines qui bougent :', [...solved.tiles.keys()].join(' '), '; soulèvement max de l’ancienne', Math.max(...solved.old).toFixed(2), 'cm');
  const rows = [];
  for (let i = 0; i <= 200; i++) { const u = i / 200, c = sceneCrossings(R, lay, u, tables, solved); if (c.depth > 0.02) rows.push(`  u=${u.toFixed(3)} ${c.depth.toFixed(3)} cm (${c.total}) ${c.pair}`); }
  console.log(`  ${rows.length} instants sur 201 avec une traversée > 0,2 mm`); console.log(rows.slice(0, 30).join('\n'));
}
