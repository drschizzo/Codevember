// Banc d'essai du plan : node fold/tools/try-plan.mjs [graines…]
import { growPlant, PLANTS } from '../src/gen/plant.js';
import { containerShape } from '../src/container.js';
import { planLoop } from '../src/plan.js';
import { buildTimeMap } from '../src/physio.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['a1', 'b2', 'c3'];
const kinds = Object.keys(PLANTS), conts = ['terracotta', 'cloche', 'ward', 'cachepot', 'bonsai'];
for (const [i, s] of seeds.entries()) {
  const kind = kinds[i % kinds.length], cont = conts[i % conts.length];
  let t0 = performance.now();
  const plant = growPlant({ kind, seed: s });
  const t1 = performance.now();
  const E = Math.max(...plant.leaves.map((L) => Math.hypot(L.tip[0], L.tip[2]) + 0.5));
  const S = containerShape(cont, plant.H, E);
  const events = [{ cause: 'drop', source: cont === 'cloche' || cont === 'ward' ? 'roof' : 'burette' }, { cause: 'tap' }, { cause: 'drop', source: cont === 'cloche' || cont === 'ward' ? 'roof' : 'burette' }];
  const plan = planLoop(plant, S, { seed: s, events, spacing: 560 });
  const t2 = performance.now();
  const tm = buildTimeMap({ P: plan.P, T: 36, windows: plan.windows });
  const t3 = performance.now();
  const droops = plant.leaves.map((L) => L.droopFrac.toFixed(2));
  console.log(`${s} ${kind}/${cont}: ${plant.leaves.length} feuilles, H=${plant.H.toFixed(2)} | croissance ${(t1 - t0).toFixed(0)} ms, plan ${(t2 - t1).toFixed(0)} ms, temps ${(t3 - t2).toFixed(0)} ms, V=${tm.V.toFixed(1)}`);
  console.log('  affaissement :', droops.join(' '));
  for (const e of plan.events) {
    const hit = e.amp.filter((a) => a > 0.2).length;
    console.log(`  ${e.cause}${e.source ? '/' + e.source : ''} tc=${e.tc.toFixed(1)} S=${e.strength.toFixed(2)} nœuds=${hit} vague=${e.wave.toFixed(2)}s` + (e.cause === 'drop' ? ` chute=${e.fall.toFixed(3)}s r=${e.r.toFixed(4)} éclats=${e.splash.length} [${e.splash.map((s) => s.kind).join(',')}]` : ` θc=${e.hammer.thetaC.toFixed(3)}`));
  }
}
