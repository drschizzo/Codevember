// Rectitude du front : le jet de rive de chaque vague, profil par profil du
// faisceau, et son écart à une droite le long de la côte. Une mer extrudée
// (un seul profil) donne 0 par construction ; la revue « changement de
// niveau » vise plus de 0,2 m.
//   node kelp/tools/front.mjs [graine…]
import { simulateBundle, makeProfileZ } from '../src/gen/sea.js';
import { generate } from '../src/recipe.js';
import { BOX, SEA_X } from '../src/gen/scene.js';

const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['k39', 'e5', 'm3', 'p7'];
for (const seed of seeds) {
  const R = generate(seed), T = R.loop.duration, zRef = R.camera.z;
  const profZ = makeProfileZ(R.sea.profile, R.sea.edge), zs = [];
  for (let z = BOX.z0; z <= BOX.z1; z += 0.9) zs.push(z);
  const B = simulateBundle({ T, x0: SEA_X[0], x1: SEA_X[1], dx: 0.05, cfl: 0.8, profileZ: profZ, zs, waves: R.sea.waves, manning: R.sea.manning, fps: 30, loops: 2 });
  const n = B.nf * B.nx, out = [];
  for (const w of R.sea.waves) {
    // le plus loin que monte le jet de rive (2 cm d'eau) dans les 6 s qui suivent la vague
    const xs = zs.map((z, k) => {
      let best = -99;
      for (let f = Math.round((w.t - 1) * B.fps); f < Math.round((w.t + 6) * B.fps); f++) {
        const ff = ((f + Math.round(R.sea.obliq * (z - zRef) * B.fps)) % B.nf + B.nf) % B.nf;
        for (let i = B.nx - 1; i >= 0; i--) { const o = k * n + ff * B.nx + i; if (B.eta[o] - B.b[k * B.nx + i] > 0.02) { best = Math.max(best, B.x0 + (i + 0.5) * B.dx); break; } }
      }
      return best;
    });
    const m = zs.length, mz = zs.reduce((a, b) => a + b) / m, mx = xs.reduce((a, b) => a + b) / m;
    let sxz = 0, szz = 0; zs.forEach((z, k) => { sxz += (z - mz) * (xs[k] - mx); szz += (z - mz) ** 2; });
    const a = sxz / szz, dev = Math.max(...zs.map((z, k) => Math.abs(xs[k] - (mx + a * (z - mz)))));
    out.push(+dev.toFixed(2));
  }
  console.log(seed, R.mood, 'écart max du jet de rive à sa droite (m), par vague :', out.join(' / '));
}
