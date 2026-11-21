// Causalité de l'arbre : distance de chaque orteil au plus proche orteil déjà
// formé à sa naissance (doit rester petite). node magma/tools/causal.mjs a1 b2 …
import { growTree, local, outline, STRIDE } from '../src/gen/toes.js';
import { generate } from '../src/recipe.js';
for (const seed of process.argv.slice(2)) {
  const R = generate(seed), t = growTree({ seed, ...R.toes }), T = t.T;
  let worst = 0, bad = 0, tEnd = 0;
  for (let k = 0; k < t.n; k++) tEnd = Math.max(tEnd, T[k * STRIDE + 8] + T[k * STRIDE + 9]);
  for (let k = 1; k < t.n; k++) {
    const o = k * STRIDE; if (T[o + 8] < 10) continue;
    let best = 1e9;
    for (let j = 0; j < t.n; j++) { const q = j * STRIDE; if (j === k || T[q + 8] + T[q + 9] > T[o + 8]) continue; const [s, v] = local(T, j, T[o], T[o + 1]); best = Math.min(best, outline(T, j, s, v)); }
    worst = Math.max(worst, best); if (best > 0.35) bad++;
  }
  console.log(seed, 'orteils', t.n, 'pire', worst.toFixed(2), 'm', 'fautifs', bad, 'fin', (tEnd / 60).toFixed(1), 'min');
}
