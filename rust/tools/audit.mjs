// Audit de cohérence : éléments qui flottent (voir src/gen/audit.js).
//   node tools/audit.mjs <famille> <graine> [tol=0.0025]
import { buildPiece } from '../src/gen/pieces.js';
import { generate } from '../src/recipe.js';
import { floatingGroups } from '../src/gen/audit.js';
const [family = 'vanne', seed = 'a1', tolArg] = process.argv.slice(2);
const R = generate(seed, { family });
const P = buildPiece({ family, params: R.piece.params, seed });
const A = floatingGroups([['pièce', P.body], ['support', P.stand]], +(tolArg ?? 0.0025));
console.log(`${family} ${seed} : ${A.count} éléments, ${A.groups.length} groupe(s) flottant(s)`);
for (const g of A.groups) console.log(`  ${g.n} élément(s) [${g.name}] de (${g.lo.map((v) => v.toFixed(3))}) à (${g.hi.map((v) => v.toFixed(3))})`);
