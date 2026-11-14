// P5, étape 2 : les bulles libérées par la fonte, portées par l'écoulement.
// Une bulle sort de la glace quand le front l'atteint (ici : en un point tiré
// au hasard sur la surface, à un instant tiré dans les 30 dernières secondes),
// puis va à la vitesse de l'eau plus sa vitesse de remontée propre
// (Stokes corrigée par Schiller-Naumann ; rayons de 10 à 500 µm, loi en 1/r).
// Elle disparaît à la surface. On écrit, pour les bulles présentes à
// l'instant t, le trait parcouru pendant une pose de 1,25 s réelles (une image
// du film en accéléré ×75 : le flou de bougé de l'accéléré).
//
// node bubbles.js --Tinf=3 [--N=6000 --pose=1.25]
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const Tinf = args.Tinf ?? '3', N = +(args.N ?? 6000), pose = +(args.pose ?? 1.25), ageMax = 30;
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
const F = JSON.parse(fs.readFileSync(path.join(dir, `flow_${Tinf}.json`), 'utf8'));
const { nr, nz, dx, Z } = F;
const nu = 1.6e-6, g = 9.81;

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// champ bilinéaire aux centres
function samp(arr, r, z) {
  const x = r / dx - 0.5, y = z / dx - 0.5;
  const i = Math.max(0, Math.min(nr - 2, Math.floor(x))), j = Math.max(0, Math.min(nz - 2, Math.floor(y)));
  const fx = Math.max(0, Math.min(1, x - i)), fy = Math.max(0, Math.min(1, y - j));
  const q = j * nr + i;
  return (arr[q] * (1 - fx) + arr[q + 1] * fx) * (1 - fy) + (arr[q + nr] * (1 - fx) + arr[q + nr + 1] * fx) * fy;
}
const prof = F.prof_mm.map((x) => x * 1e-3);
const Rice = (z) => { const j = Math.max(0, Math.min(nz - 1, Math.round(z / dx - 0.5))); return prof[j]; };
function vRise(rb) {
  let v = (2 / 9) * g * rb * rb / nu;
  for (let k = 0; k < 20; k++) { const Re = 2 * rb * v / nu; v = (2 / 9) * g * rb * rb / nu / (1 + 0.15 * Math.pow(Re, 0.687)); }
  return v;
}
// surface de la glace : rangées où elle existe, pondérées par le rayon
const rows = [];
for (let j = 0; j < nz; j++) if (prof[j] > 0.6e-3) rows.push(j);
const wsum = rows.reduce((s, j) => s + prof[j], 0);
function pickRow() { let t = rnd() * wsum; for (const j of rows) { t -= prof[j]; if (t <= 0) return j; } return rows.at(-1); }

const segs = [];
let tried = 0;
const stats = { up: 0, down: 0 };
while (segs.length < N && tried < N * 40) {
  tried++;
  const rb = 10e-6 * Math.pow(50, rnd()); // 10 → 500 µm, loi en 1/r
  const age = rnd() * ageMax;
  const j = pickRow();
  let z = (j + 0.5) * dx, r = prof[j] + 0.3e-3;
  const th = rnd() * 2 * Math.PI;
  const vr = vRise(rb);
  let t = 0, alive = true, p0 = null;
  const h = 0.01;
  while (t < age) {
    if (!p0 && t >= age - pose) p0 = [r, z];
    const u = samp(F.u, r, z), w = samp(F.w, r, z) + vr;
    r += u * h; z += w * h; t += h;
    if (r < Rice(z) + 0.1e-3 && z < Z) r = Rice(z) + 0.1e-3; // la glace repousse la bulle
    if (z >= Z - 0.2e-3) { alive = false; break; } // crève à la surface
    if (z < 0.002 || r > 0.038) { alive = false; break; }
  }
  if (!alive) continue;
  if (!p0) p0 = [prof[j] + 0.3e-3, (j + 0.5) * dx];
  const toCm = ([rr, zz]) => [rr * Math.cos(th) * 100, (zz - Z) * 100, rr * Math.sin(th) * 100];
  const a = toCm(p0), b = toCm([r, z]);
  if (b[1] > a[1]) stats.up++; else stats.down++;
  segs.push([...a.map((x) => +x.toFixed(4)), ...b.map((x) => +x.toFixed(4)), +(rb * 1e6).toFixed(1)]);
}
// répartition des sens selon la taille
const bins = [[10, 30], [30, 60], [60, 120], [120, 500]].map(([lo, hi]) => {
  const s = segs.filter((q) => q[6] >= lo && q[6] < hi);
  return `${lo}–${hi} µm : ${s.length} bulles, ${Math.round(100 * s.filter((q) => q[4] < q[1]).length / Math.max(1, s.length))} % descendent`;
});
fs.writeFileSync(path.join(dir, `bubbles_${Tinf}.json`), JSON.stringify({ Tinf, pose, segs }));
console.log(`T∞=${Tinf} : ${segs.length} bulles présentes (${tried} tirées), montent ${stats.up}, descendent ${stats.down}`);
for (const b of bins) console.log('  ' + b);
console.log(`  vitesse propre : 15 µm ${(vRise(15e-6) * 1e3).toFixed(2)} mm/s, 40 µm ${(vRise(40e-6) * 1e3).toFixed(2)}, 100 µm ${(vRise(100e-6) * 1e3).toFixed(1)}, 300 µm ${(vRise(300e-6) * 1e3).toFixed(0)} mm/s`);
