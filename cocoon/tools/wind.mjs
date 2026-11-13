// Banc d'essai du bobinage : temps, longueurs, couverture, et images de la
// carte (σ, φ) de la paroi à plusieurs instants (PGM → PNG par sips).
import fs from 'node:fs';
import { windCocoon, threadSegments } from '../src/gen/winding.js';
const out = process.argv[2] || '/tmp/wind';
fs.mkdirSync(out, { recursive: true });
const base = (family, shape = 'ovoid') => ({
  family, cage: { shape, R: 0.13, hub: 0.024, ribs: 18, wire: 0.0016 },
  band: { threads: 12, thread: 0.0016, gap: 1.04, width: 12 * 0.0016 * 1.04 },
  wind: { c1: 0.55, n1: 8, c2: 0.3, ribs: 5, mu: 0.42, amp: 0.035, adv: 0.55, sweeps: 5 },
  grid: { ns: 512, np: 1024 }, step: 0.003,
});
const fams = (process.argv[3] || 'losange,cerclage,huit,meridien').split(',');
for (const f of fams) {
  const t0 = performance.now();
  const W = windCocoon(base(f, process.argv[4] || 'ovoid'));
  const t1 = performance.now();
  const S = threadSegments(W);
  const { Ns, Np } = W.grid;
  const tau = 0.3;
  const cover = (Sx) => { let open = 0, tot = 0; const lo = Math.floor(W.P.sLo / W.grid.cs) + 4, hi = Math.floor(W.P.sHi / W.grid.cs) - 4; for (let i = lo; i < hi; i++) for (let k = 0; k < Np; k++) { tot++; const c = (i * Np + k) * 4; let n = 0; for (let q = 0; q < 4; q++) if (W.cook[c + q] < Sx) n++; if (n === 0) open++; } return open / tot; };
  let maxNB = 0; for (const v of W.NB) maxNB = Math.max(maxNB, v);
  let maxH = 0; for (const v of W.Hp) maxH = Math.max(maxH, v);
  console.log(`${f}: ${(t1 - t0).toFixed(0)} ms, ruban ${W.path.total.toFixed(1)} m, ${W.m} points, ${S.count} segments, couches max ${maxNB}, h max ${(maxH * 1000).toFixed(1)} mm, régimes ${W.path.marks.map((k) => `${k.name}@${k.s.toFixed(2)}`).join(' ')}`);
  console.log('   ouvert(S):', [0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((x) => `${x}:${(cover(x) * 100).toFixed(0)}%`).join(' '));
  // images : transmission à 4 instants, côte à côte
  const Ss = [0.08, 0.25, 0.5, 0.75, 1.0];
  const W2 = Np / 2, H2 = Ns / 2, img = new Uint8Array(W2 * Ss.length * H2);
  Ss.forEach((Sx, q) => {
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = Ns - 1 - y * 2, k = x * 2, c = (i * Np + k) * 4;
      let n = 0; for (let z = 0; z < 4; z++) if (W.cook[c + z] < Sx) n++;
      img[y * W2 * Ss.length + q * W2 + x] = Math.round(255 * tau ** n);
    }
  });
  fs.writeFileSync(`${out}/${f}.pgm`, Buffer.concat([Buffer.from(`P5 ${W2 * Ss.length} ${H2} 255\n`), Buffer.from(img)]));
}
