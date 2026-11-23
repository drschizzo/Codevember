// Banc du drapé d'une graine, sans navigateur : pendaison, puis descente sur
// chacune de ses formes avec le vent de la recette, et images au rastériseur
// depuis la caméra de la recette (repos).   node veil/tools/drape.mjs <dossier> <graine> [json de surcharges]
import fs from 'node:fs';
import { simulate, RC } from '../src/gen/cloth.js';
import { buildForm, plinthSDF } from '../src/gen/forms.js';
import { generate } from '../src/recipe.js';
import { makeCam, render } from './raster.mjs';

const [dir, seed = 'a1', ov = '{}'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const O = JSON.parse(ov);
const R = generate(seed, O.gen ?? {});
if (O.wind) Object.assign(R.wind, O.wind);
if (O.veil) Object.assign(R.veil, O.veil);
if (O.n) R.sim.n = O.n;
if (O.forms) R.forms = O.forms.map((k, i) => ({ ...generate(seed + i, { forms: [k] }).forms[0] }));
if (O.fabric) R.fabric = O.fabric;
const { n, sub } = R.sim, L = R.veil.L;
console.log(seed, R.mood, R.fabric, 'L', L, 'n', n, 'vent', JSON.stringify(R.wind), R.forms.map((f) => f.kind).join(','));
const hang = simulate({ mode: 'hang', n, L, fabric: R.fabric, seed, rot: R.veil.rot, T: { total: 3.5 }, floorY: -10, sub });
let lowest = 0;
for (let k = 0; k < hang.N; k++) lowest = Math.min(lowest, hang.final[k * 3 + 1]);
const forms = R.forms.map((f) => buildForm(f));
const yH = Math.max(...forms.map((f) => Math.max(f.top, f.box[4] - 0.04))) + RC - lowest + 0.08;
const H = hang.final.slice();
for (let k = 0; k < hang.N; k++) H[k * 3 + 1] += yH;
const wa = R.wind.az;
const wind = R.wind.speed > 0 ? { dir: [-Math.sin(wa), -0.05, -Math.cos(wa)], speed: R.wind.speed, breath: R.wind.breath, phase: R.wind.phase } : null;
const P = plinthSDF(R.plinth);
const C = R.camera;
const eye = [Math.sin(C.az) * C.dist, 0.35 + Math.sin(C.el) * C.dist, Math.cos(C.az) * C.dist];
const cam = makeCam(eye, [0, 0.33, 0], C.fov + 4, 300, 300);
const camF = makeCam([0.05, 0.42, 1.7], [0, 0.33, 0], 34, 300, 300), camS = makeCam([1.7, 0.42, 0.05], [0, 0.33, 0], 34, 300, 300);
const hexc = (h) => [1, 3, 5].map((i) => Math.max(0.15, parseInt(h.slice(i, i + 2), 16) / 255));
R.forms.forEach((spec, k) => {
  const t = performance.now();
  const S = simulate({ mode: 'desc', n, L, fabric: R.fabric, start: H, form: spec, plinth: R.plinth, yH, y1: forms[k].top + RC, T: R.timing.desc, wind, floorY: -R.plinth.height, sub, wet: O.wet ?? 0 });
  console.log(spec.kind, ((performance.now() - t) / 1000).toFixed(1), 's');
  const land = R.timing.desc.pre + R.timing.desc.lower;
  const f = S.count - 1, X = S.frames.subarray(f * S.N * 3, (f + 1) * S.N * 3);
  [cam, camF, camS].forEach((c, i) => render(c, { cloth: X, n, sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }], color: hexc(R.veil.color), out: `${dir}/${seed}-${k}-${i}.ppm` }));
  render(cam, { sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }, { f: forms[k], col: [0.85, 0.6, 0.5] }], out: `${dir}/${seed}-${k}-f.ppm` });
});
