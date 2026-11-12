// node kelp/tools/scene.mjs [graine] [humeur] [famille] : construit une scène entière (comme le worker)
import { generate } from '../src/recipe.js';
import { buildScene } from '../src/gen/scene.js';
import { skyPixels } from '../src/gen/sky.js';
const [seed = 'a1', mood, family] = process.argv.slice(2);
const R = generate(seed, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) });
console.log(R.mood, R.family, JSON.stringify(R.sea.waves.map((w) => [w.t, w.A])), 'cam', JSON.stringify(R.camera));
let t = Date.now();
const S = buildScene(R, { lite: process.env.LITE === '1', onProgress: (p) => process.stdout.write(`\r${(p * 100).toFixed(0)} %  `) });
console.log(`\n${Date.now() - t} ms`, JSON.stringify(S.times), 'caméra', JSON.stringify(S.cam), JSON.stringify(S.stats));
const mb = (o) => Object.values(o).reduce((s, v) => s + (ArrayBuffer.isView(v) ? v.byteLength : v && typeof v === 'object' ? mb(v) : 0), 0);
console.log('Mo', (mb(S) / 1e6).toFixed(1), 'sommets lanières', S.kelp.straps.count, 'crampons', S.kelp.holdfasts.position.length / 3);
t = Date.now(); skyPixels(R, 1024); console.log('ciel', Date.now() - t, 'ms');
