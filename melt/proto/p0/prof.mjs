// résumé des profils : node prof.mjs out/x.json [snapshotIndex]
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2]));
const si = process.argv[3] !== undefined ? +process.argv[3] : d.snapshots.length - 1;
const s = d.snapshots[si];
const r = s.r_mm, dz = d.dx * 1e3;
let j0 = r.findIndex((v) => v > 0.5), j1 = r.length - 1 - [...r].reverse().findIndex((v) => v > 0.5);
console.log(`${d.name} snap ${si} t=${s.t.toFixed(0)}s V=${s.V.toFixed(2)} ice z=[${(j0 * dz).toFixed(1)}, ${(j1 * dz).toFixed(1)}] mm`);
const n = 12;
let line = '';
for (let q = 0; q <= n; q++) { const j = Math.round(j0 + (j1 - j0) * q / n); line += `${(j * dz).toFixed(0)}:${r[j].toFixed(1)} `; }
console.log(' z:r(mm) ' + line);
