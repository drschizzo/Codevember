// Banc de cohérence : node kelp/tools/coherence.mjs [graine] — part des nœuds
// immergés qui remontent le courant (|u| > 0,8 m/s, vitesse > 0,3 m/s, à
// contre-sens), par vingtième de boucle. Une lame dans un courant fort va
// avec lui : une part élevée se voit comme un mouvement « incohérent ».
import { generate } from '../src/recipe.js';
import { buildScene } from '../src/gen/scene.js';
const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * (m / 1024) * 2 ** -14 : s * 2 ** (e - 15) * (1 + m / 1024); };
const R = generate(process.argv[2] ?? 'k39'), S = buildScene(R, { lite: true }), K = S.kelp, Sea = S.sea;
const anch = new Float32Array(K.n * 3), sg = K.straps;
for (let v = 0; v < sg.count; v++) for (let q = 0; q < 4; q++) { const i = sg.nidx[v * 4 + q]; anch[3 * i] = sg.anch[v * 4]; anch[3 * i + 1] = sg.anch[v * 4 + 1]; anch[3 * i + 2] = sg.anch[v * 4 + 2]; }
const P = (f, i) => { const o = (f * K.n + i) * 4; return [fromHalf(K.pos[o]) + anch[3 * i], fromHalf(K.pos[o + 1]) + anch[3 * i + 1], fromHalf(K.pos[o + 2]) + anch[3 * i + 2]]; };
const field = (c, x, t) => { const i = Math.max(0, Math.min(Sea.nx - 1, Math.round((x - Sea.x0) / Sea.dx - 0.5))); let f = Math.round(t * Sea.fps) % Sea.nf; if (f < 0) f += Sea.nf; return fromHalf(Sea.tex[(f * Sea.nx + i) * 4 + c]); };
const bad = new Array(20).fill(0), tot = new Array(20).fill(0);
for (let f = 1; f < K.nf - 1; f++) {
  const t = f / K.fps, b = Math.floor((f / K.nf) * 20);
  for (let i = 0; i < K.n; i++) {
    const p = P(f, i), tl = t - R.sea.obliq * (p[2] - S.cam.z);
    if (field(0, p[0], tl) < p[1] + 0.02) continue;
    const u = field(1, p[0], tl); if (Math.abs(u) < 0.8) continue;
    const a = P(f - 1, i), c = P(f + 1, i), vx = (c[0] - a[0]) * K.fps / 2, v = Math.hypot(vx, (c[1] - a[1]) * K.fps / 2, (c[2] - a[2]) * K.fps / 2);
    tot[b]++; if (v > 0.3 && vx * u < 0) bad[b]++;
  }
}
console.log(R.family, 'à contre-courant (%), par vingtième :', bad.map((x, k) => (tot[k] ? Math.round((100 * x) / tot[k]) : '-')).join(' '));
// nœuds à l'air (l'eau à plus de 3 cm sous eux) qui bougent à plus de 0,3 m/s : sans eau, rien ne les pousse
const dry = new Array(20).fill(0), dtot = new Array(20).fill(0);
for (let f = 1; f < K.nf - 1; f++) {
  const t = f / K.fps, b = Math.floor((f / K.nf) * 20);
  for (let i = 0; i < K.n; i++) {
    const p = P(f, i), tl = t - R.sea.obliq * (p[2] - S.cam.z);
    if (field(0, p[0], tl) > p[1] - 0.03) continue;
    const a = P(f - 1, i), c = P(f + 1, i), v = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]) * K.fps / 2;
    dtot[b]++; if (v > 0.3) dry[b]++;
  }
}
console.log(R.family, 'à l\'air et en mouvement (%), par vingtième :', dry.map((x, k) => (dtot[k] ? Math.round((100 * x) / dtot[k]) : '-')).join(' '));
