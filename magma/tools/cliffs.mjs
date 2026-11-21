// Falaises de la nappe : plus grand saut de hauteur entre deux points voisins
// (4 mm) pendant la coulée, et ce qui le cause (instants de passage).
import { growTree, bakeLists, bakeBlur, surfaceFromLists, cellAt, frontTime } from '../src/gen/toes.js';
import { generate } from '../src/recipe.js';
const seed = process.argv[2] ?? 'a1', R = generate(seed), tree = growTree({ seed, ...R.toes }), T = tree.T;
const L = bakeLists(tree, 1024, 0.1), Bl = bakeBlur(tree, 512), [cx, cz] = R.camera.target, h = R.toes.h;
const st = 0.0041;
for (const t of [60, 120, 300]) {
  let worst = 0, at = null;
  for (let z = cz - 1.2; z < cz + 1; z += st * 3) {
    let prev = null, px = 0;
    for (let x = cx - 1.4; x < cx + 1.4; x += st) {
      const r = surfaceFromLists(T, L, x, z, t, h, Bl);
      if (prev) { const j = Math.abs(r.S - prev.S); if (j > worst) { worst = j; at = [x, z, frontTime(cellAt(T, L, px, z)), frontTime(cellAt(T, L, x, z))]; } }
      prev = r; px = x;
    }
  }
  console.log('t', t, 'saut max', worst.toFixed(3), 'm', JSON.stringify(at?.map((v) => +v.toFixed(3))));
}
