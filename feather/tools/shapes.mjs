// Contours des familles à plusieurs instants (lignes de barbes en projection),
// pour juger la forme dans Node : JSON vers stdout, dessiné par tools/draw.py.
import { FAMILIES } from '../src/families.js';
import { createRng } from '../../shared/rng.js';
import { shapeOf, barbTable, barbPose, BARB_STRIDE } from '../src/gen/feather.js';
const us = (process.argv[2] || '0.3,0.42,0.5,0.56,0.66,1').split(',').map(Number);
const out = [];
for (const fam of Object.keys(FAMILIES)) {
  const P = shapeOf(fam, createRng('s1'));
  const T = barbTable(P, 's1');
  for (const u of us) {
    const S = { u, L: P.L, k: 1 / (P.L * FAMILIES[fam].dome) + P.bend, wear: u >= 0.99 ? 1 : 0, g: [0, -0.5, -0.86], radial: P.radial };
    const lines = [];
    for (let b = 0; b < T.length / BARB_STRIDE; b++) {
      const B = [...T.slice(b * BARB_STRIDE, (b + 1) * BARB_STRIDE)];
      const pts = [];
      for (let i = 0; i <= 12; i++) { const r = barbPose(B, i / 12, 0, 0, S); if (!r.hidden) pts.push(r.p.map((x) => +x.toFixed(3))); }
      lines.push(pts);
    }
    out.push({ fam, u, L: P.L, lines });
  }
}
console.log(JSON.stringify(out));
