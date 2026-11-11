// Continuité image par image (60 i/s, boucle de 36 s) : déplacement maximal,
// d'une image à la suivante, des barbes des voisines touchées par le contact.
//   node feather/tools/continuity.mjs [graines…]
import { generate } from '../src/recipe.js';
import { layoutPlumage, tileContacts, featherFrame, LIE_BETA, LIE, barbTable, barbPose, BARB_STRIDE, contactPush, qrot, bendOf } from '../src/gen/feather.js';
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['33', 'nqbh3w', 'a', 'o', 'u'];
for (const seed of seeds) {
  const R = generate(seed), P = R.shape, T = R.tile ?? P, lay = layoutPlumage(P, R.seed, { tile: R.tile });
  const TB = barbTable(T, `${R.seed}:tile`, 6), kt = bendOf(T, lay.Rd);
  const N = 36 * 60;
  const frames = Array.from({ length: N + 1 }, (_, f) => tileContacts(P, lay, f / N, R.tile));
  const touched = new Set(); frames.forEach((C) => C.forEach((c, j) => (c.tent > 0 || c.split > 0) && touched.add(j)));
  let worst = 0, at = '';
  for (const j of touched) {
    const t = lay.tiles[j], f = featherFrame(lay.Rd, t.th, t.ph, LIE_BETA(T.radial), LIE.omega, t.yaw);
    const St = { u: 1, L: T.L, k: kt * t.scale, wear: t.wear, g: [0, 0, -1], radial: false, cal: T.calamus, over: T.over };
    const base = [];
    for (let b = 0; b < TB.length / BARB_STRIDE; b += 2) for (let i = 0; i <= 8; i++) { const r = barbPose([...TB.slice(b * 16, b * 16 + 16)], i / 8, 0, 0, St); if (!r.hidden) base.push(r.p); }
    let prev = null;
    frames.forEach((C, fi) => {
      const c = C[j], K = [c.ext, c.x0, c.y0, c.r], Q = [c.split, c.tent];
      const cur = base.map((p) => contactPush(p, K, Q).map((v) => v * t.scale));
      if (prev) for (let q = 0; q < cur.length; q++) { const d = Math.hypot(cur[q][0] - prev[q][0], cur[q][1] - prev[q][1], cur[q][2] - prev[q][2]); if (d > worst) { worst = d; at = `u=${(fi / N).toFixed(4)} tuile ${j}`; } }
      prev = cur;
    });
  }
  console.log(seed, R.family, 'voisines touchées', touched.size, 'saut max', worst.toFixed(3), 'cm/image', at);
}
