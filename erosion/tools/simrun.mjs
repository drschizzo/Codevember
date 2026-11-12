// Banc de la simulation dans Node : node erosion/tools/simrun.mjs <famille> [NX] [sortie]
// Imprime les courbes (eau, sable, érosion) et écrit des cartes ombrées (PPM) à quelques instants.
import fs from 'node:fs';
import { TABLE, familySpec, initialTerrain } from '../src/gen/table.js';
import { createSim, PHYS } from '../src/gen/sim.js';
// réglages en ligne de commande : PHYS=Kc=0.005,diffuse=1e-6  SPEC=morfac=60,q=0.0003
for (const kv of (process.env.PHYS || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); PHYS[k] = +v; }
const over = {}; for (const kv of (process.env.SPEC || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); over[k] = +v; }
const fam = process.argv[2] || 'delta', NX = +(process.argv[3] || 256), NY = NX / 2, out = process.argv[4] || '/tmp/ero';
const S = familySpec(fam, over);
const strata = [];
for (let z = 0.004, k = 0; z < 0.12; z += 0.005 + (k % 3) * 0.003, k++) strata.push({ bottom: z, hard: k % 3 === 1 ? 0.75 : 0.1, tone: k % 4 });
const b0 = initialTerrain(S.form, NX, NY, 7);
const sim = createSim({ NX, NY, b0, strata, S });
const V0 = sim.sandVolume();
fs.mkdirSync(out, { recursive: true });
function shot(name) {
  const W = NX, H = NY, px = Buffer.alloc(W * H * 3), l = sim.l;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * NX + i, iL = Math.max(0, i - 1), iR = Math.min(W - 1, i + 1), jT = Math.max(0, j - 1), jB = Math.min(H - 1, j + 1);
    const gx = (sim.b[j * NX + iR] - sim.b[j * NX + iL]) / (2 * l), gy = (sim.b[jB * NX + i] - sim.b[jT * NX + i]) / (2 * l);
    const n = [-gx, -gy, 1], m = Math.hypot(...n), L = [-0.6, -0.3, 0.5], lm = Math.hypot(...L);
    let sh = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (m * lm));
    const k = (strata.findIndex((L) => b0[c] - sim.b[c] <= L.bottom)) % 2; const dep = sim.b[c] > sim.bmin[c] + 0.0003;
    let col = dep ? [230, 210, 170] : k ? [200, 120, 80] : [225, 190, 150];
    col = col.map((v) => v * (0.25 + 0.9 * sh));
    const d = sim.d[c];
    if (d > 2e-5) { const a = Math.min(1, d / 0.01); const tb = Math.min(1, sim.s[c] * 4000); col = col.map((v, q) => v * (1 - 0.6 * a) + a * 0.6 * [40 + 120 * tb, 80 + 80 * tb, 120 + 20 * tb][q]); }
    px.set(col.map((v) => Math.max(0, Math.min(255, v | 0))), ((H - 1 - j) * W + i) * 3);
  }
  fs.writeFileSync(`${out}/${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), px]));
}
const t0 = performance.now();
let next = 0;
const marks = [4, 8, 12, 16, 20, 24, 28, S.T - 0.01];
sim.runTo(S.T, (st) => {
  if (st.T >= next) {
    let er = 0, dep = 0, wet = 0, vmax = 0, smax = 0;
    for (let i = 0; i < sim.b.length; i++) { const db = sim.b[i] - b0[i]; if (db < 0) er -= db; else dep += db; if (sim.d[i] > 2e-5) wet++; vmax = Math.max(vmax, Math.hypot(sim.vx[i], sim.vy[i])); smax = Math.max(smax, sim.s[i]); }
    console.log(`T ${st.T.toFixed(1).padStart(5)}  eau ${(sim.waterVolume() * 1000).toFixed(2)} L  mouillé ${(wet / sim.b.length * 100).toFixed(1)}%  vmax ${vmax.toFixed(2)}  smax ${(smax * 1000).toFixed(2)}mm  érodé ${(er * sim.l * sim.l * 1e6).toFixed(0)} cm³  déposé ${(dep * sim.l * sim.l * 1e6).toFixed(0)} cm³  Δsable ${((sim.sandVolume() - V0) * 1e6).toFixed(1)} cm³ (sorti ${(sim.st.outSand * 1e6 * S.morfac).toFixed(1)})`);
    next += 2;
  }
  if (marks.length && st.T >= marks[0]) { shot(`${fam}-${String(Math.round(marks[0])).padStart(2, '0')}`); marks.shift(); }
});
console.log(`${sim.st.steps} pas en ${((performance.now() - t0) / 1000).toFixed(1)} s, dt ${sim.dt.toFixed(4)}`);
