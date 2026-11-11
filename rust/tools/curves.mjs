// Courbes du film (règle « une seule horloge ») : τ, pluie, eau, ciel et
// progression des machines, en fonction de u, en texte.
//   node tools/curves.mjs [graine] [machine]
import { generate } from '../src/recipe.js';
import { curves } from '../src/timeline.js';
import { turnS } from '../src/machines.js';
const [seed = 'a1', machine] = process.argv.slice(2);
const R = generate(seed, machine ? { machine } : {});
const bar = (v, w = 20) => '█'.repeat(Math.round(v * w)).padEnd(w, '·');
console.log(`${seed} ${R.machine.kind} ${R.family} ${R.mood} ${R.climate} — averses ${JSON.stringify(R.timing.showers)}`);
for (const c of curves(R, 50)) console.log(c.u.toFixed(2), 'τ', bar(c.tau), 'pluie', bar(c.rain, 10), 'eau', bar(c.wet, 10), 'ciel', bar(c.sky, 10), 's', bar(turnS(R, c.u), 10));
