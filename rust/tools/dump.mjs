// Construit une pièce et écrit ses tampons (pour tools/raster.py) :
//   node tools/dump.mjs <famille> <graine> <sortie.bin>
import fs from 'node:fs';
import { buildPiece, pieceParams } from '../src/gen/pieces.js';
import { createRng } from '../src/rng.js';
const [family = 'noeud', seed = 'a1', out = '/tmp/piece.bin'] = process.argv.slice(2);
const params = pieceParams(family, createRng(seed).fork('piece'));
const t0 = performance.now();
const P = buildPiece({ family, params, seed });
const dt = performance.now() - t0;
const parts = [P.body, P.stand];
const head = { dt: +dt.toFixed(0), params, info: P.info, parts: parts.map((b) => ({ nv: b.position.length / 3, ni: b.index.length })) };
console.log(JSON.stringify(head));
const bufs = [];
for (const b of parts) { bufs.push(Buffer.from(b.position.buffer), Buffer.from(b.normal.buffer), Buffer.from(new Uint8Array(b.surf).buffer), Buffer.from(new Uint32Array(b.index).buffer)); }
const h = Buffer.from(JSON.stringify(head));
const len = Buffer.alloc(4); len.writeUInt32LE(h.length);
fs.writeFileSync(out, Buffer.concat([len, h, ...bufs]));
