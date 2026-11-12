// Banc des lames en l'air : node kelp/tools/sag.mjs [graine] — part des nœuds
// de lanière à l'air (l'eau à plus de 3 cm sous eux) qui flottent à plus de
// 10 cm au-dessus de la roche, et la plus grande hauteur, par vingtième de
// boucle. Hors de l'eau, une lame s'effondre sur la roche : une poutre
// horizontale en l'air se voit tout de suite.
import { generate } from '../src/recipe.js';
import { buildScene } from '../src/gen/scene.js';
import { sampler } from '../src/gen/rock.js';
const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * (m / 1024) * 2 ** -14 : s * 2 ** (e - 15) * (1 + m / 1024); };
const [sd, mood, family] = (process.argv[2] ?? 'k39').split(':');
const R = generate(sd, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) }), S = buildScene(R, { lite: process.env.LITE === '1' }), K = S.kelp, Sea = S.sea;
const Rk = S.rock, M = Rk.M, B = Rk.box;
const rock = (x, z) => { const i = Math.max(0, Math.min(M - 1, Math.round((x - B.x0) / (B.x1 - B.x0) * (M - 1)))), j = Math.max(0, Math.min(M - 1, Math.round((z - B.z0) / (B.z1 - B.z0) * (M - 1)))); return fromHalf(Rk.relief[(j * M + i) * 4]); };
const anch = new Float32Array(K.n * 3), kind = new Uint8Array(K.n), sg = K.straps;
for (let v = 0; v < sg.count; v++) for (let q = 0; q < 4; q++) { const i = sg.nidx[v * 4 + q]; anch[3 * i] = sg.anch[v * 4]; anch[3 * i + 1] = sg.anch[v * 4 + 1]; anch[3 * i + 2] = sg.anch[v * 4 + 2]; if (sg.sect[v * 4 + 2] > 0.5 && q === 1) kind[i] = 1; }
const P = (f, i) => { const o = (f * K.n + i) * 4; return [fromHalf(K.pos[o]) + anch[3 * i], fromHalf(K.pos[o + 1]) + anch[3 * i + 1], fromHalf(K.pos[o + 2]) + anch[3 * i + 2]]; };
const field = (x, t) => { const i = Math.max(0, Math.min(Sea.nx - 1, Math.round((x - Sea.x0) / Sea.dx - 0.5))); let f = Math.round(t * Sea.fps) % Sea.nf; if (f < 0) f += Sea.nf; return fromHalf(Sea.tex[(f * Sea.nx + i) * 4]); };
const high = new Array(20).fill(0), tot = new Array(20).fill(0), top = new Array(20).fill(0);
for (let f = 0; f < K.nf; f++) {
  const t = f / K.fps, b = Math.floor((f / K.nf) * 20);
  for (let i = 0; i < K.n; i++) {
    if (!kind[i]) continue;
    const p = P(f, i), tl = t - R.sea.obliq * (p[2] - S.cam.z);
    if (field(p[0], tl) > p[1] - 0.03) continue;
    const h = p[1] - rock(p[0], p[2]);
    tot[b]++; if (h > 0.1) high[b]++; top[b] = Math.max(top[b], h);
  }
}
console.log(R.seed, R.family, 'lames à l\'air à plus de 10 cm (%) :', high.map((x, k) => (tot[k] ? Math.round((100 * x) / tot[k]) : '-')).join(' '));
console.log(R.seed, R.family, 'hauteur max à l\'air (cm)        :', top.map((x) => Math.round(x * 100)).join(' '));
