// Banc des traversées de la gerbe, graine par graine : le pire instant et les
// paires de plumes en cause (âges, hauteur au-dessus de la peau).
//   node tools/crossings.mjs 1 7 g1:vexille …   (graine[:famille])
import { generate } from '../src/recipe.js';
import { barbTable } from '../src/gen/feather.js';
import { layoutBouquet } from '../src/gen/bouquet.js';
import { bouquetCrossings } from '../src/gen/collide.js';

for (const s of process.argv.slice(2)) {
  const [sd, fam] = s.split(':');
  const R = generate(sd, fam ? { family: fam } : {}), lay = layoutBouquet(R.shape, R.seed);
  const tables = { hero: barbTable(R.shape, R.seed) };
  let worst = 0, at = '', bad = 0, body = 0;
  for (let i = 0; i < 100; i++) {
    const c = bouquetCrossings(R, lay, i / 100, tables);
    if (c.depth > 0.02) bad++;
    body = Math.max(body, c.body);
    if (c.depth > worst) { worst = c.depth; at = `u = ${(i / 100).toFixed(2)} (${c.pair})`; }
  }
  console.log(`${s} ${R.family} ${R.bird} : pire ${(worst * 10).toFixed(2)} mm ${at} ; instants > 0,2 mm : ${bad} % ; socle ${(body * 10).toFixed(2)} mm`);
}
