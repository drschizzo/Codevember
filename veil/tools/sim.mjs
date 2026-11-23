// Banc de la simulation : pendaison de référence, puis descente sur une forme,
// puis montée ; temps de calcul, et images (rastériseur logiciel) dans un
// dossier.   node veil/tools/sim.mjs <dossier> [forme] [étoffe] [n]
import fs from 'node:fs';
import { simulate, RC } from '../src/gen/cloth.js';
import { buildForm, plinthSDF, drawForm } from '../src/gen/forms.js';
import { createRng } from '../../shared/rng.js';
import { makeCam, render } from './raster.mjs';

const [dir = '/tmp/veil', kind = 'bust', fabric = 'mousseline', nArg = '65'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const n = +nArg, L = +(process.argv[6] ?? 1.0);
const plinth = { kind: 'die', height: 1.0, half: 0.27 };
const formSpec = drawForm(kind, createRng('bench:' + kind));
const form = buildForm(formSpec);
console.log('forme', kind, 'sommet', form.top.toFixed(3), 'boîte', form.box.map((v) => v.toFixed(2)).join(' '));

const ws = +(process.argv[7] ?? 2.2), wa = 0.5; // vent de face, un peu de côté
const WIND = ws > 0 ? { dir: [-Math.sin(wa), -0.05, -Math.cos(wa)], speed: ws, breath: 2.2, phase: 0 } : null;
let t0 = performance.now();
const hang = simulate({ mode: 'hang', n, L, fabric, seed: 's', rot: 0.3, T: { total: 3.5 }, plinth: null, floorY: -10 });
console.log('pendaison', ((performance.now() - t0) / 1000).toFixed(2), 's');
// la pendaison est relative à la bague (y = 0) : on la remonte
let lowest = 0;
for (let k = 0; k < hang.N; k++) lowest = Math.min(lowest, hang.final[k * 3 + 1]);
const yH = form.top + RC - lowest + 0.06;
const H = hang.final.slice();
for (let k = 0; k < hang.N; k++) H[k * 3 + 1] += yH;
console.log('longueur pendue', (-lowest).toFixed(3), 'yH', yH.toFixed(3));

t0 = performance.now();
const y1 = form.top + RC;
const desc = simulate({ mode: 'desc', n, L, fabric, start: H, form: formSpec, plinth, yH, y1, T: { pre: 0.3, lower: 3.0, settle: 4.5 }, floorY: -1, wind: WIND });
console.log('descente', ((performance.now() - t0) / 1000).toFixed(2), 's', desc.count, 'images');
t0 = performance.now();
const rise = simulate({ mode: 'rise', n, L, fabric, start: desc.final, target: H, form: formSpec, plinth, y0: y1, yH, T: { tug: 0.35, lift: 2.4, hang: 1.8 }, floorY: -1, wind: WIND });
console.log('montée', ((performance.now() - t0) / 1000).toFixed(2), 's', rise.count, 'images');
let err = 0;
for (let k = 0; k < H.length; k++) err = Math.max(err, Math.abs(rise.final[k] - H[k]));
console.log('écart final à H', err.toExponential(2));

const cam = makeCam([0.75, 0.55, 1.35], [0, 0.15, 0], 38, 320, 400);
const P = plinthSDF(plinth);
const shots = [['d', desc, [0.55, 0.7, 1]]];
const camF = makeCam([0.05, 0.42, 1.25], [0, 0.25, 0], 34, 320, 400);
render(camF, { cloth: desc.final, n, sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }], out: `${dir}/e_front.ppm` });
render(makeCam([1.25, 0.42, 0.05], [0, 0.25, 0], 34, 320, 400), { cloth: desc.final, n, sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }], out: `${dir}/e_side.ppm` });
for (const [tag, S, us] of shots) us.forEach((u, i) => {
  const f = Math.min(S.count - 1, Math.round(u * (S.count - 1)));
  render(cam, { cloth: S.frames.subarray(f * S.N * 3, (f + 1) * S.N * 3), n, sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }], out: `${dir}/${tag}${i}.ppm` });
});
render(cam, { sdfs: [{ f: P, col: [0.6, 0.6, 0.62] }, { f: form, col: [0.8, 0.5, 0.4] }], out: `${dir}/form.ppm` });

// rugosité à l'échelle de la grille (zigzag) : écart au milieu des voisins, en pas
const rough = (X) => { let a = 0, c = 0; for (let j = 0; j < n; j++) for (let i = 1; i + 1 < n; i++) { const k = (j * n + i) * 3; let d = 0; for (let q = 0; q < 3; q++) { const m = (X[k - 3 + q] + X[k + 3 + q]) / 2 - X[k + q]; d += m * m; } a += Math.sqrt(d); c++; } return a / c / (L / (n - 1)); };
const zz = (X) => { let a = 0, c = 0; for (let j = 0; j < n; j++) for (let i = 2; i + 2 < n; i++) { const k = (j * n + i) * 3; let d = 0; for (let q = 0; q < 3; q++) { const m = (-X[k - 6 + q] + 4 * X[k - 3 + q] + 4 * X[k + 3 + q] - X[k + 6 + q]) / 6 - X[k + q]; d += m * m; } a += Math.sqrt(d); c++; } return a / c / (L / (n - 1)); };
console.log('zigzag (cubique) drapé', zz(desc.final).toFixed(3), 'pendu', zz(H).toFixed(3));
console.log('zigzag drapé', rough(desc.final).toFixed(3), 'pendu', rough(H).toFixed(3));
