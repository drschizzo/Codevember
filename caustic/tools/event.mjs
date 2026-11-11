// Banc d'essai d'un dessin : transport → lentille → spectre → onde à
// plusieurs instants → caustique au fond (processeur). Écrit une planche PGM.
//   node tools/event.mjs [série] [niveau] [dossier] [N]
import fs from 'node:fs';
import { buildEvent } from '../src/gen/lens.js';
import { evolve, causticCPU } from '../src/gen/waves.js';

const [series = 'diatom', level = '1', dir = '/tmp', Narg = '512'] = process.argv.slice(2);
const N = +Narg, L = 1.2, H = 0.45;
const elev = +(process.env.ELEV || 70) * Math.PI / 180;
const light = process.env.LAMP ? { kind: 'lamp', pos: [0.1, 1.0, -0.15] } : { kind: 'sun', dir: [Math.cos(elev) * 0.6, -Math.sin(elev), -Math.cos(elev) * 0.8] };
const t0 = performance.now();
const ev = buildEvent({ series, level: +level, seed: 'test', N, L, H, light, side: +(process.env.SIDE || 0.52) });
console.log('lentille', ev.lens, `${(performance.now() - t0).toFixed(0)} ms`);
const taus = (process.env.TAUS || '-0.6,-0.25,-0.08,-0.02,0,0.01,0.03,0.1,0.4').split(',').map(Number);
const n = +(process.env.RES || 192), region = [-0.3, -0.3, 0.6];
const imgs = [];
for (const tau of taus) {
  const f = evolve(ev.spec, N, L, H, tau);
  let mh = 0, ms = 0;
  for (let k = 0; k < N * N; k++) { mh = Math.max(mh, Math.abs(f.h[k])); ms = Math.max(ms, Math.hypot(f.hx[k], f.hz[k])); }
  const c = causticCPU(f, N, L, H, light, region, n);
  imgs.push(c);
  console.log(`τ = ${tau} s : |h| max ${(mh * 1000).toFixed(2)} mm, pente max ${ms.toFixed(3)}`);
}
// planche : une rangée, valeur ajustée (gamma 0.6, max à 4×)
const W = n * imgs.length, b = Buffer.alloc(W * n);
imgs.forEach((im, t) => { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) b[j * W + t * n + i] = Math.min(255, Math.round(255 * Math.pow(im[j * n + i] / 4, 0.6))); });
fs.writeFileSync(`${dir}/event-${series}${level}.pgm`, Buffer.concat([Buffer.from(`P5 ${W} ${n} 255\n`), b]));
