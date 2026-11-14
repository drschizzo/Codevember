// P4 : la pagode. Une colonne de glace pend de la surface dans une eau stratifiée
// en sel (plus salée au fond) ; l'eau de fonte, douce et froide, devrait s'étaler
// en nappes horizontales (Huppert et Turner 1980), d'épaisseur
// h ≈ 0,65·Δρ_T / |dρ/dz| avec Δρ_T = ρ0 α (T∞ − 0), et creuser des gradins.
//
// node p4.js --name=pagode --Tinf=10 --Sbot=12 --Stop=4 [--F=20 --Le=10 --tmax=600]
import fs from 'node:fs';
import path from 'node:path';
import { Sim } from './simS.js';
import { writePNG } from '../p0/png.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const name = args.name ?? 'pagode';
const Tinf = +(args.Tinf ?? 10), Sbot = +(args.Sbot ?? 12), Stop = +(args.Stop ?? 4);
const F = +(args.F ?? 20), dx = +(args.dx ?? 0.5e-3), Le = +(args.Le ?? 10);
const R = 0.04, Z = +(args.Z ?? 0.144), a = 0.014, H0 = +(args.H ?? 0.1);
const alpha = +(args.alpha ?? 1e-4), betaS = 7.8e-4;
const tmax = +(args.tmax ?? 600);
const dRhoT = 1000 * alpha * Tinf, dRhoDz = 1000 * betaS * (Sbot - Stop) / Z;
const hPred = 0.65 * dRhoT / dRhoDz;

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, `${name}.log`); fs.writeFileSync(logPath, '');
const log = (s) => { fs.appendFileSync(logPath, s + '\n'); console.log(s); };

const sim = new Sim({ dx, R, Z, Tinf, F, nV: 1, geom: { a, z0: Z - H0, z1: Z + 1, sup: [] }, alpha, betaS, Le, Sbot, Stop, sponge: 0.5, wSponge: 0.008, spongeZ: { bottom: true, top: false } });
const { nr, nz } = sim;
log(`# ${name}  T∞=${Tinf} °C, S ${Sbot}→${Stop} (fond→surface), α=${alpha}, Le=${Le}, F=${F}, grille ${nr}x${nz}`);
log(`# Huppert-Turner : Δρ_T=${dRhoT.toFixed(2)} kg/m³, dρ/dz=${dRhoDz.toFixed(1)} kg/m⁴ → épaisseur prévue ${(hPred * 1e3).toFixed(1)} mm`);

const snaps = [];
const grab = () => {
  const S = new Float32Array(nr * nz), T = new Float32Array(nr * nz), f = new Float32Array(nr * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) { const k = sim.id(i, j), q = j * nr + i; S[q] = sim.S[k]; T[q] = sim.T[k]; f[q] = sim.fs[k]; }
  snaps.push({ t: sim.t, S, T, f, prof: Array.from(sim.profile(), (x) => x * 1e3) });
};
grab();
const times = [0.15, 0.3, 0.45, 0.6, 0.8, 1].map((x) => x * tmax);
let ti = 0;
const t0 = performance.now();
while (sim.t < tmax) {
  sim.step();
  if (sim.nstep % 50 === 0) {
    const mv = sim.maxVel();
    if (!Number.isFinite(mv.umax)) { log('# NaN'); break; }
    if (mv.umax * sim.dt / dx > 0.45) { sim.dt *= 0.8; }
  }
  if (ti < times.length && sim.t >= times[ti]) { grab(); ti++; log(`t=${sim.t.toFixed(0)} s  V/V0=${(sim.iceVolume() / sim.V0).toFixed(3)}`); }
}
log(`# ${sim.nstep} pas, ${((performance.now() - t0) / 1000).toFixed(0)} s`);

// gradins : minima locaux du rayon (creux) le long de la colonne, au dernier relevé
const pr = snaps.at(-1).prof;
const notches = [];
for (let j = 3; j < nz - 3; j++) {
  if (pr[j] < 0.5) continue;
  if (pr[j] < pr[j - 1] && pr[j] <= pr[j + 1] && Math.max(pr[j - 3], pr[j + 3]) - pr[j] > 0.15) notches.push(+(j * dx * 1e3).toFixed(1));
}
const gaps = notches.slice(1).map((z, n) => +(z - notches[n]).toFixed(1));
log(`# creux du profil (z, mm) : ${notches.join(', ')} ; espacements : ${gaps.join(', ')} (prévu ≈ ${(hPred * 1e3).toFixed(0)} mm)`);

// nappes d'intrusion : minima de S − S∞ le long d'une verticale à r = a + 6 mm
{
  const s = snaps.at(-1), i0 = Math.round((a + 0.006) / dx);
  const d = []; for (let j = 0; j < nz; j++) d.push(s.S[j * nr + i0] - sim.Sinf[j]);
  const mins = [];
  for (let j = 4; j < nz - 4; j++) if (d[j] < d[j - 1] && d[j] <= d[j + 1] && d[j] < -0.05 && Math.max(d[j - 4], d[j + 4]) - d[j] > 0.05) mins.push(+(j * dx * 1e3).toFixed(1));
  const g2 = mins.slice(1).map((z, n) => +(z - mins[n]).toFixed(1));
  log(`# nappes (minima de sel à r = a + 6 mm, z en mm) : ${mins.join(', ')} ; espacements : ${g2.join(', ')}`);
}

// image : sel (gris → bleu), isolignes de T, glace blanche
const sc = 2, fw = 2 * nr * sc, fh = nz * sc, gap = 6, W = snaps.length * fw + (snaps.length - 1) * gap;
const img = new Uint8Array(W * fh * 3).fill(255);
snaps.forEach((s, n) => {
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const j = nz - 1 - Math.floor(y / sc), xc = Math.floor(x / sc) - nr, i = xc >= 0 ? xc : -xc - 1, q = j * nr + i;
    // écart de sel au profil lointain : l'eau de fonte (douce) en clair
    const dS = (s.S[q] - sim.Sinf[j]) / (Sbot - Stop) * 4;
    const base = 30 + 140 * (s.S[q] - Stop) / (Sbot - Stop);
    let c = [base * 0.5, base * 0.7, base];
    if (dS < 0) c = c.map((v, m) => v + (-dS) * [230, 200, 120][m]);
    const f = s.f[q]; if (f > 0) c = c.map((v, m) => v * (1 - f) + [240, 245, 250][m] * f);
    const o = (y * W + n * (fw + gap) + x) * 3; img[o] = Math.min(255, c[0]); img[o + 1] = Math.min(255, c[1]); img[o + 2] = Math.min(255, c[2]);
  }
});
writePNG(path.join(outDir, `${name}.png`), W, fh, img);
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ name, Tinf, Sbot, Stop, alpha, Le, F, hPred_mm: hPred * 1e3, notches_mm: notches, gaps_mm: gaps, profiles: snaps.map((s) => ({ t: s.t, r_mm: s.prof })) }));
