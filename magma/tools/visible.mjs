// Lisibilité de la propagation : combien d'orteils naissent d'un parent qu'on
// ne voit pas (sa lave passe sous l'ancienne croûte décalée), et quelle part
// de la nappe neuve reste cachée pendant la coulée.
import { growTree, bakeLists, surfaceFromLists, layerThickness, STRIDE } from '../src/gen/toes.js';
import { generate } from '../src/recipe.js';
for (const seed of process.argv.slice(2)) {
  const R = generate(seed), tree = growTree({ seed, ...R.toes }), T = tree.T;
  const L = bakeLists(tree, 512, 0.1), [cx, cz] = R.camera.target, d = R.toes.delta;
  const h = layerThickness(T, L, d, [cx - 2, cx + 2, cz - 1.9, cz + 1.6]);
  let born = 0, hidden = 0;
  for (let k = 0; k < tree.n; k++) {
    const o = k * STRIDE, x = T[o], z = T[o + 1], t0 = T[o + 8];
    if (t0 < 10 || Math.abs(x - cx) > 1.5 || z < cz - 1.4 || z > cz + 1.2) continue;
    born++;
    if (surfaceFromLists(T, L, x, z, t0 - 0.5, h, d).layer === 0) hidden++;
  }
  console.log(seed, 'h', h.toFixed(3), 'naissances à l’image', born, 'dont parent caché', hidden, `(${(100 * hidden / born).toFixed(0)} %)`);
}
