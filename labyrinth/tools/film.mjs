// Banc : planifie des scènes et imprime les mesures de leurs films.
//   node tools/film.mjs <famille> <topo> <a> <b> [graines…]
import { buildMaze } from '../src/gen/maze.js';
import { planScene } from '../src/gen/plan.js';
const [fam = 'plateau', topo = 'grid', a = 9, b = 9, ...seeds] = process.argv.slice(2);
for (const seed of seeds.length ? seeds : ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']) {
  const spec = { family: fam, topo, nx: +a, ny: +b, K: +a, c: 22, r0: 22, seed, detours: 2, turn: 1 };
  const t0 = performance.now();
  try {
    const { maze: m, film: f, attempt } = planScene(spec, null, buildMaze);
    console.log(seed, `essai ${attempt}`, `chemin ${m.path.length}`, `durée ${f.duration.toFixed(1)} s`, `résidu ${f.residual.toFixed(3)} mm`, f.moves ? `coups ${f.moves.map((d) => Math.round(d * 57.3)).join(',')}` : '', `tours ${f.turns}`, `${(performance.now() - t0).toFixed(0)} ms`);
  } catch (e) { console.log(seed, 'ÉCHEC', e.message, `${(performance.now() - t0).toFixed(0)} ms`); }
}
