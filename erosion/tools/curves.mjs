// Courbes du film (règle 17) : volume creusé par bande de x et volume déposé, au fil du temps hydraulique.
//   node erosion/tools/curves.mjs ravines 192
import { familySpec, initialTerrain, TABLE } from '../src/gen/table.js';
import { createSim } from '../src/gen/sim.js';
const fam = process.argv[2] || 'ravines', NX = +(process.argv[3] || 192), NY = NX / 2;
const S = familySpec(fam); S.seed = 7;
const strata = [{ bottom: 0.005, hard: 0.1 }, { bottom: 0.009, hard: 0.7 }, { bottom: 0.02, hard: 0.1 }, { bottom: 1, hard: 0.2 }];
const b0 = initialTerrain(S.form, NX, NY, 7);
const sim = createSim({ NX, NY, b0, strata, S });
const l = TABLE.Lx / NX, bands = [[0, 0.3], [0.3, 0.45], [0.45, 0.6], [0.6, 0.8], [0.8, 1.28]];
let next = 0;
sim.runTo(S.T, (st) => {
  if (st.T < next) return;
  next += 1.5;
  const cut = bands.map(() => 0), dep = bands.map(() => 0);
  for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * l, db = sim.b[j * NX + i] - b0[j * NX + i], k = bands.findIndex(([a, b]) => x >= a && x < b);
    if (db < 0) cut[k] -= db * l * l * 1e6; else dep[k] += db * l * l * 1e6;
  }
  console.log(`T ${st.T.toFixed(1).padStart(5)}  creusé ${cut.map((v) => v.toFixed(0).padStart(5)).join(' ')}  déposé ${dep.map((v) => v.toFixed(0).padStart(5)).join(' ')}  eau ${(sim.waterVolume() * 1000).toFixed(2)} L`);
});
