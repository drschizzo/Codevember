// Banc des traversées : sur toute la boucle, la plus profonde traversée d'une
// plume par une autre (scène telle qu'elle est rendue).
//   node feather/tools/crossings.mjs [graine…]
import { generate } from '../src/recipe.js';
import { layoutPlumage, barbTable } from '../src/gen/feather.js';
import { sceneCrossings, sceneState, featherLines, heightField, crossings, solveScene } from '../src/gen/collide.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['33', 'nqbh3w', 'a', 'o', 'u'];
const FAM = process.env.FAM;
for (const seed of seeds) {
  const R = generate(seed, FAM ? { family: FAM } : {}), P = R.shape, T = R.tile ?? P;
  const lay = layoutPlumage(P, R.seed, { tile: R.tile });
  const tables = { hero: barbTable(P, R.seed), tile: barbTable(T, `${R.seed}:tile`, 10) };
  const solved = process.env.RAW ? null : solveScene(R, lay, tables); // (RAW=1 : sans le solveur)
  // le plumage au repos (voisines entre elles)
  {
    const st = sceneState(R, lay, 0.5, solved).filter((o) => o.kind === 'tile');
    const geo = st.slice(0, 400).map((o) => { const lines = featherLines(T, tables.tile, o, lay, { nt: 8 }); return { o, lines, H: heightField(lines, o) }; });
    let rest = 0;
    for (const A of geo) for (const B of geo) if (A !== B && Math.hypot(A.o.p[0] - B.o.p[0], A.o.p[1] - B.o.p[1], A.o.p[2] - B.o.p[2]) < T.L * 1.5) rest = Math.max(rest, crossings(A.lines, B.H).depth);
    console.log(seed, R.family, 'plumage au repos : traversée max', rest.toFixed(3), 'cm');
  }
  const rows = [];
  for (let i = 0; i <= 100; i++) {
    const u = i / 100, c = sceneCrossings(R, lay, u, tables, solved);
    if (c.depth > 0.02) rows.push(`  u=${u.toFixed(2)} ${c.depth.toFixed(3)} cm (${c.total} segments) ${c.pair}`);
  }
  console.log(`${seed} : ${rows.length} instants sur 101 avec une traversée > 0,2 mm`);
  console.log(rows.join('\n'));
}
