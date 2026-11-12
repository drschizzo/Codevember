// Banc d'essai : résout toutes les transitions de N graines, imprime le taux
// de réussite, les essais, les temps.  node tools/seeds.mjs [début] [nombre] [famille]
import { generate } from '../src/recipe.js';
import { solveMove } from '../src/gen/plan.js';
import { movesOf } from '../src/film.js';

const [a = 0, n = 12, fam] = process.argv.slice(2);
let fails = 0, total = 0, tsum = 0;
for (let s = +a; s < +a + +n; s++) {
  const R = generate(`s${s}`, fam ? { family: fam } : {});
  const mv = movesOf(R);
  const out = [];
  for (let i = 0; i < mv.length; i++) {
    const t0 = performance.now();
    const r = solveMove(R, i);
    const dt = performance.now() - t0;
    tsum += dt; total++;
    if (!r.ok) fails++;
    out.push(`${mv[i].from}→${mv[i].to}:${r.ok ? `#${r.attempt} T${r.T.toFixed(1)} s${r.sMax.toFixed(2)} u${r.uMax.toFixed(0)}` : `ÉCHEC ${JSON.stringify(r.why)}`} ${(dt / 1000).toFixed(1)}s`);
  }
  console.log(`s${s} ${R.family}${R.machine.links.length} ${R.mood}  ${out.join('  ')}`);
}
console.log(`échecs ${fails}/${total}, ${(tsum / total / 1000).toFixed(2)} s par transition`);
