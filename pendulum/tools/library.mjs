// Bibliothèque de départs : pour les chaînes triples, une recherche large
// (sens de bascule × durées × tirages initiaux) sur une machine de référence
// trouve quelques trajectoires de redressement et de descente ; le worker
// part de la plus proche et suit la continuation jusqu'aux maillons de la
// graine (gen/plan.js). Écrit src/gen/library.js.
//   node tools/library.mjs
import fs from 'node:fs';
import { systemOf } from '../src/gen/machines.js';
import { solveTransition } from '../src/gen/shoot.js';
import { REF3 } from '../src/gen/reference.js';

const PI = Math.PI;
const sys = systemOf(REF3);
const out = {};
for (const [name, a] of [['DDD-UUU', [0, 0, 0]], ['UUU-DDD', [PI, PI, PI]]]) {
  const found = [];
  for (const T of [2.4, 2.8, 3.2]) for (let mask = 0; mask < 8; mask++) for (let rep = 0; rep < 6; rep++) {
    const sg = [0, 1, 2].map((i) => ((mask >> i) & 1 ? -1 : 1));
    const th1 = a.map((t, i) => t + sg[i] * PI);
    let seed = 17 + rep * 9973 + mask * 31 + Math.round(T * 100);
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const u0 = Array.from({ length: 80 }, () => (rng() - 0.5) * 40 * (rep > 0));
    const r = solveTransition(sys, { T, X0: sys.restState(a), X1: sys.restState(th1), N: 80, S: 16, alpha: 1, beta: 60, rng, u0 });
    const smax = Math.max(-r.sMin, r.sMax);
    if (r.ok && smax < 0.7 && r.uMax < 40) {
      found.push({ T, signs: sg, cost: r.cost, smax, z: Array.from(r.z, (v) => +v.toPrecision(7)) });
      console.log(name, T, sg.join(','), rep, 'cost', r.cost.toFixed(1), 's', smax.toFixed(2), 'u', r.uMax.toFixed(1));
    }
  }
  // les meilleures par sens de bascule
  const best = {};
  for (const f of found.sort((p, q) => p.cost - q.cost)) { const k = f.signs.join(','); if (!best[k]) best[k] = f; }
  out[name] = Object.values(best);
}
const text = `// Généré par tools/library.mjs — départs pour les chaînes triples (voir gen/plan.js).\n// Machine de référence : gen/reference.js. z : commande et états de tir (N = 80, S = 16).\nexport const LIBRARY = ${JSON.stringify(out)};\n`;
fs.writeFileSync(new URL('../src/gen/library.js', import.meta.url), text);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
