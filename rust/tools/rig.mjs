// Pièce + élingues du bain (repère de la pièce), pour tools/raster.py :
//   node tools/rig.mjs <famille> <graine> <sortie.bin>
import fs from 'node:fs';
import { generate } from '../src/recipe.js';
import { buildPiece } from '../src/gen/pieces.js';
import { bathPlan } from '../src/machines.js';
import { buildMachine } from '../src/gen/machinery.js';
const [family = 'roue', seed = 'a1', out = '/tmp/rig.bin'] = process.argv.slice(2);
const R = generate(seed, { family, machine: 'bain' });
const P = buildPiece({ family, params: R.piece.params, seed });
const plan = bathPlan(R, P.info.lo, P.info.hi, P.info.lifts, P.info.hook);
const M = buildMachine({ kind: 'bain', lo: P.info.lo, hi: P.info.hi, tank: plan.tank, hook: plan.hook, lifts: P.info.lifts, loops: P.info.loops, spreader: P.info.spreader, rest: plan.rest });
const parts = [P.body, M.parts.hook];
const head = { dt: 0, info: {}, parts: parts.map((b) => ({ nv: b.position.length / 3, ni: b.index.length })) };
const h = Buffer.from(JSON.stringify(head)); const l = Buffer.alloc(4); l.writeUInt32LE(h.length);
fs.writeFileSync(out, Buffer.concat([l, h, ...parts.flatMap((b) => [Buffer.from(b.position.buffer), Buffer.from(b.normal.buffer), Buffer.from(b.surf.buffer), Buffer.from(new Uint32Array(b.index).buffer)])]));
