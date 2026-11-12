// Banc des contacts sur N graines (toutes familles) : résout, pose, vérifie.
//   node tools/contacts.mjs [début] [nombre]
import { generate } from '../src/recipe.js';
import { solveMove } from '../src/gen/plan.js';
import { systemOf } from '../src/gen/machines.js';
import { buildFilm, movesOf } from '../src/film.js';
import { clearance } from '../src/gen/clearance.js';

const [a = 0, n = 40] = process.argv.slice(2).map(Number);
let bad = 0, fail = 0;
for (let k = a; k < a + n; k++) {
  const R = generate(`c${k}`);
  const res = movesOf(R).map((m) => solveMove(R, m.i));
  if (res.some((r) => !r.ok)) { fail++; console.log(`c${k} ${R.family} : ÉCHEC du solveur`); continue; }
  const F = buildFilm(R, systemOf(R.machine), res.map((r) => r.tab));
  const c = clearance(R.machine, F, { wood: /mahogany|walnut|ebonized|oak/.test(R.accord.base) });
  if (c.hits.length) bad++;
  console.log(`c${k} ${R.family}${R.machine.links.length} ${R.mood} boucle ${F.duration.toFixed(1)} s  jeu ${(c.minGap * 1000).toFixed(1)} mm ${c.hits.length ? 'CONTACT ' + JSON.stringify(c.hits[0]) : ''}`);
}
console.log(`contacts : ${bad}, échecs : ${fail} sur ${n}`);
