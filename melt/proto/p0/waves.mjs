// cherche des festons : extrema locaux de r(z) (lissé sur 1 mm), profondeur > seuil
// node waves.mjs out/x.json [seuil_mm=0.2]
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2])), thr = +(process.argv[3] ?? 0.2);
const dz = d.dx * 1e3, w = Math.max(1, Math.round(0.5 / dz));
for (const [n, s] of d.snapshots.entries()) {
  const r = s.r_mm, N = r.length, sm = new Float64Array(N);
  for (let j = 0; j < N; j++) { let a = 0, c = 0; for (let q = -w; q <= w; q++) if (j + q >= 0 && j + q < N) { a += r[j + q]; c++; } sm[j] = a / c; }
  const on = [...sm].map((v) => v > 1.5);
  const j0 = on.indexOf(true), j1 = on.lastIndexOf(true);
  const ext = [];
  for (let j = j0 + 4; j < j1 - 4; j++) {
    const isMax = sm[j] > sm[j - 1] && sm[j] >= sm[j + 1], isMin = sm[j] < sm[j - 1] && sm[j] <= sm[j + 1];
    if (isMax || isMin) ext.push({ z: (j + 0.5) * dz, r: sm[j], t: isMax ? 'M' : 'm' });
  }
  // filtre : garder les extrema dont l'amplitude avec le voisin dépasse thr
  const keep = ext.filter((e, i) => { const nb = [ext[i - 1], ext[i + 1]].filter(Boolean); return nb.some((b) => Math.abs(b.r - e.r) > thr); });
  console.log(`snap ${n} V=${s.V.toFixed(2)}: ${keep.map((e) => `${e.t}@${e.z.toFixed(1)}(${e.r.toFixed(1)})`).join(' ') || 'aucun'}`);
}
