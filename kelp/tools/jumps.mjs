// Banc des sauts : node kelp/tools/jumps.mjs [graine] — déplacement des nœuds
// d'une image à l'autre (30 i/s) le long de la boucle : les pointes isolées
// (un nœud qui bouge bien plus qu'avant et après) sont des sauts visibles.
import { generate } from '../src/recipe.js';
import { buildScene } from '../src/gen/scene.js';
const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * (m / 1024) * 2 ** -14 : s * 2 ** (e - 15) * (1 + m / 1024); };
const R = generate(process.argv[2] ?? 'k39');
const S = buildScene(R, { lite: true }), K = S.kelp;
const P = (f, i) => { const o = (f * K.n + i) * 4; return [fromHalf(K.pos[o]), fromHalf(K.pos[o + 1]), fromHalf(K.pos[o + 2])]; };
// « saut » : déplacement à l'image f bien plus grand que la moyenne de ses voisines (accélération)
const per = [];
let worst = 0;
for (let f = 0; f < K.nf; f++) {
  let m = 0;
  for (let i = 0; i < K.n; i++) {
    const a = P((f + K.nf - 1) % K.nf, i), b = P(f, i), c = P((f + 1) % K.nf, i);
    const acc = Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]);
    m = Math.max(m, acc);
  }
  per.push(m); worst = Math.max(worst, m);
}
const sorted = per.map((v, f) => [v, f]).sort((p, q) => q[0] - p[0]).slice(0, 8);
console.log('écart A–B par vingtième :', S.stats.kelp.gap?.join(' '));
console.log(R.family, 'pire « accélération » d\'image (m) :', worst.toFixed(3));
console.log(sorted.map(([v, f]) => `u=${(f / K.nf).toFixed(3)}:${v.toFixed(3)}`).join('  '));
const p95 = [...per].sort((p, q) => p - q)[Math.floor(per.length * 0.95)];
console.log('95e centile', p95.toFixed(3), ' médiane', [...per].sort((p, q) => p - q)[per.length >> 1].toFixed(3));
if (process.env.DBG) {
  for (const [, f] of sorted.slice(0, 3)) {
    let bi = 0, bm = 0;
    for (let i = 0; i < K.n; i++) { const a = P((f + K.nf - 1) % K.nf, i), b = P(f, i), c = P((f + 1) % K.nf, i); const acc = Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]); if (acc > bm) { bm = acc; bi = i; } }
    console.log('u', (f / K.nf).toFixed(3), 'nœud', bi, [-2, -1, 0, 1, 2].map((d) => P((f + d + K.nf) % K.nf, bi).map((v) => v.toFixed(2)).join(',')).join(' | '));
  }
}
if (process.env.HIST) {
  const bins = new Array(20).fill(0);
  per.forEach((v, f) => { if (v > 0.12) bins[Math.floor((f / K.nf) * 20)]++; });
  console.log('images avec saut > 12 cm, par vingtième de boucle :', bins.join(' '));
}
