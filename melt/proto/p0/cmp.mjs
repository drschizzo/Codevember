// compare deux runs snapshot par snapshot (même V/V0) : node cmp.mjs a.json b.json
import fs from 'node:fs';
const A = JSON.parse(fs.readFileSync(process.argv[2])), B = JSON.parse(fs.readFileSync(process.argv[3]));
const rs = (d, s) => { // rééchantillonne sur 0.5 mm
  const k = Math.round(0.5e-3 / d.dx); const out = [];
  for (let j = 0; j + k <= s.r_mm.length; j += k) { let m = 0; for (let q = 0; q < k; q++) m += s.r_mm[j + q] ** 2; out.push(Math.sqrt(m / k)); }
  return out;
};
for (let n = 1; n < Math.min(A.snapshots.length, B.snapshots.length); n++) {
  const a = rs(A, A.snapshots[n]), b = rs(B, B.snapshots[n]);
  let s = 0, mx = 0, c = 0;
  for (let j = 0; j < Math.min(a.length, b.length); j++) if (a[j] > 0.3 || b[j] > 0.3) { const d = a[j] - b[j]; s += d * d; c++; mx = Math.max(mx, Math.abs(d)); }
  console.log(`snap ${n} V=${A.snapshots[n].V.toFixed(2)}/${B.snapshots[n].V.toFixed(2)} t=${A.snapshots[n].t.toFixed(0)}/${B.snapshots[n].t.toFixed(0)}s  rms dr=${Math.sqrt(s / c).toFixed(2)} mm  max=${mx.toFixed(2)} mm`);
}
