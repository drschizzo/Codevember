// Précalcule les primitives et la séquence de basculements des prismes du
// catalogue (Culbute) : node tension/tools/precompute.mjs → src/gen/culbuteTable.js
import fs from 'node:fs';
import { prepare } from '../src/gen/gait.js';
const out = {};
for (const n of [6]) {
  const P = prepare({ family: 'culbute', n, table: false }, () => {});
  out[n] = { prims: P.prims.map((p) => ({ pair: p.pair, k: +p.k.toFixed(4), dx: +p.dx.toFixed(3), dz: +p.dz.toFixed(3), yaw: +p.yaw.toFixed(4) })), seq: P.seq };
  console.log(n, 'prims', out[n].prims.length, 'seq', P.seq.join(','), 'd', P.d.map((v) => v.toFixed(2)), 'yaw°', (P.yaw * 180 / Math.PI).toFixed(2));
}
fs.writeFileSync(new URL('../src/gen/culbuteTable.js', import.meta.url), `// Table précalculée (tools/precompute.mjs) : primitives de basculement et\n// séquence d'un pas, pour les prismes du catalogue. Ne pas modifier à la main.\nexport const CULBUTE_TABLE = ${JSON.stringify(out)};\n`);
