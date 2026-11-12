// Aperçu du plasmodium dans Node : front (T), veines à quelques instants, perles.
import fs from 'node:fs';
import { buildPlasmodium, K_SNAP, S0, S1 } from '../src/gen/plasmodium.js';
import { generate } from '../src/recipe.js';
import { FAMILIES } from '../src/families.js';
const out = process.argv[2] || '.';
const seeds = (process.argv[3] || 'a1').split(',');
const snaps = [6, 14, 22, 31];
const W = 640, H = 400, X0 = -1.6, X1 = 1.9, Z0 = -1.1, Z1 = 1.1;
const sc = W / (X1 - X0);
for (const sd of seeds) {
  const [s, fam] = sd.split(':');
  const R = generate(s, fam ? { family: fam } : {});
  const sp = FAMILIES[R.family].species[R.species];
  const t0 = performance.now();
  const Pm = buildPlasmodium({ P: R.plasmodium, sp, fruit: R.fruit, L: R.site.L });
  const ms = performance.now() - t0;
  const { Gr, net, rad, beads, F } = Pm;
  const imgs = snaps.map((k) => {
    const sph = S0 + (S1 - S0) * k / (K_SNAP - 1);
    const px = Buffer.alloc(W * H * 3, 30);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = X0 + i / sc, z = Z0 + j / sc;
      // T bilinéaire
      const u = (x - F.x0) / F.h, v = (z - F.z0) / F.h, a = Math.floor(u), b = Math.floor(v);
      let t = 9; if (a >= 0 && b >= 0 && a < F.Gx - 1 && b < F.Gz - 1) t = F.T[b * F.Gx + a];
      const o = (j * W + i) * 3;
      if (t <= sph) { const age = sph - t; const sheet = Math.max(0, 1 - age / 0.06); px[o] = 60 + 120 * sheet; px[o + 1] = 55 + 100 * sheet; px[o + 2] = 20; }
    }
    for (let e = 0; e < Gr.m; e++) {
      const r = rad(net.snapD[k * Gr.m + e]); if (!r) continue;
      const xa = Gr.x[Gr.ea[e]], za = Gr.z[Gr.ea[e]], xb = Gr.x[Gr.eb[e]], zb = Gr.z[Gr.eb[e]];
      const n = 8, rr = Math.max(0.6, r * sc);
      for (let q = 0; q <= n; q++) {
        const x = xa + (xb - xa) * q / n, z = za + (zb - za) * q / n, ci = (x - X0) * sc, cj = (z - Z0) * sc;
        for (let dj = -Math.ceil(rr); dj <= Math.ceil(rr); dj++) for (let di = -Math.ceil(rr); di <= Math.ceil(rr); di++) {
          if (di * di + dj * dj > rr * rr) continue;
          const ii = Math.round(ci + di), jj = Math.round(cj + dj); if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const o = (jj * W + ii) * 3; px[o] = 255; px[o + 1] = 225; px[o + 2] = 60;
        }
      }
    }
    if (k === 31) for (const bd of beads) {
      const ci = (bd.x - X0) * sc, cj = (bd.z - Z0) * sc, rr = 0.03 * bd.size * sc;
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { if (di * di + dj * dj > rr * rr) continue; const ii = Math.round(ci + di), jj = Math.round(cj + dj); if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const o = (jj * W + ii) * 3; px[o] = 255; px[o + 1] = 60 + 190 * bd.delay; px[o + 2] = 200; }
    }
    for (const g of Pm.seeds) { const ci = Math.round((g.x - X0) * sc), cj = Math.round((g.z - Z0) * sc); for (let d = -3; d <= 3; d++) { const o1 = (cj * W + ci + d) * 3, o2 = ((cj + d) * W + ci) * 3; px[o1] = px[o2] = 0; px[o1 + 1] = px[o2 + 1] = 255; } }
    return px;
  });
  const sheet = Buffer.concat(imgs);
  fs.writeFileSync(`${out}/net-${sd.replace(':', '_')}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H * snaps.length} 255\n`), sheet]));
  console.log(sd, R.family, R.species, R.plasmodium.net, `n=${Gr.n} m=${Gr.m}`, `${ms.toFixed(0)} ms`, 'résidu', net.residual.toExponential(2), 'perles', beads.length, 'V', Pm.Vnet.toFixed(5), Pm.Vbeads.toFixed(5));
}
