// Lance un cas P0 et écrit out/<name>.{png,json,csv,log}
// node run.js --name=A --Tinf=3.5 --F=4 --dx=0.5e-3 --hold=top|bottom|hang [--vstop=0.3] [--tmax=4000]
import fs from 'node:fs';
import path from 'node:path';
import { Sim, PHYS } from './sim.js';
import { writePNG } from './png.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const name = args.name ?? 'run';
const Tinf = +(args.Tinf ?? 4);
const F = +(args.F ?? 4);
const dx = +(args.dx ?? 0.5e-3);
const hold = args.hold ?? 'top';
const vstop = +(args.vstop ?? 0.12);
const tmax = +(args.tmax ?? 6000);
const nV = +(args.nV ?? 2);
const R = +(args.R ?? 0.04), Z = +(args.Z ?? 0.144);
const a = +(args.a ?? 0.014), Hice = +(args.H ?? 0.09);

let geom;
const zb = +(args.zb ?? 0.027);
if (hold === 'top') { const z0 = zb, z1 = z0 + Hice; geom = { a, z0, z1, sup: [{ r: a, z0: z1, z1: Z + 1 }] }; }
else if (hold === 'bottom') { const z0 = zb, z1 = z0 + Hice; geom = { a, z0, z1, sup: [{ r: a, z0: -1, z1: z0 }] }; }
else if (hold === 'hang') { geom = { a, z0: Z - Hice, z1: Z + 1, sup: [] }; }
else throw new Error('hold');

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, `${name}.log`);
fs.writeFileSync(logPath, '');
const log = (s) => { fs.appendFileSync(logPath, s + '\n'); console.log(s); };

const sim = new Sim({ dx, R, Z, Tinf, F, geom, nV, eta: +(args.eta ?? 1e6), noise: +(args.noise ?? 0), sponge: +(args.sponge ?? 0.5), wSponge: +(args.wSponge ?? 0.008), spongeZ: { bottom: true, top: hold !== 'hang' } });
log(`# ${name}  Tinf=${Tinf} °C  F(St)=${F}  St_eff/Tinf=${(1 / sim.Lce).toFixed(4)} /°C  hold=${hold}`);
log(`# grid ${sim.nr}x${sim.nz}  dx=${(dx * 1e3).toFixed(3)} mm  dt=${sim.dt.toFixed(5)} s  R=${R} Z=${Z}  ice a=${a} H=${Hice}  MG levels=${sim.mg.length} (${sim.mg.at(-1).n}x${sim.mg.at(-1).m}) nV=${nV}`);
const Ra = PHYS.g * PHYS.beta * Math.max((Tinf - PHYS.Ts) ** 2, PHYS.Ts ** 2) * Hice ** 3 / (PHYS.nu * PHYS.kappa);
log(`# Ra(H, max dT^2) ~ ${Ra.toExponential(2)}  Ra/Tinf^2 (L=2a) = ${(PHYS.g * PHYS.beta * (2 * a) ** 3 / (PHYS.nu * PHYS.kappa)).toExponential(2)}`);

const stops = (args.stops ?? `1,0.8,0.6,0.4,0.25,${vstop}`).split(',').map(Number);
const snaps = [];
function snapshot() {
  const { nr, nz } = sim;
  const T = new Float32Array(nr * nz), fsA = new Float32Array(nr * nz), sup = new Uint8Array(nr * nz), ice0 = new Uint8Array(nr * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
    const k = sim.id(i, j), q = j * nr + i;
    T[q] = sim.T[k]; fsA[q] = sim.fs[k]; sup[q] = sim.sup[k]; ice0[q] = sim.ice0[k];
  }
    const probe = [0.25, 0.5, 0.75].map((fz) => {
    const j = Math.round((geom.z0 + fz * (Math.min(geom.z1, Z) - geom.z0)) / dx);
    const o = { z_mm: +(j * dx * 1e3).toFixed(2), r_mm: [], w_mms: [], T: [] };
    for (let i = 0; i < Math.min(nr, Math.round(0.03 / dx)); i++) {
      const k = sim.id(i, j);
      o.r_mm.push(+((i + 0.5) * dx * 1e3).toFixed(2)); o.w_mms.push(+(0.5 * (sim.w[k] + sim.w[k - sim.NR]) * 1e3).toFixed(3)); o.T.push(+sim.T[k].toFixed(3));
    }
    return o;
  });
  snaps.push({ probe, t: sim.t, step: sim.nstep, V: sim.iceVolume() / sim.V0, T, fs: fsA, sup, ice0, psi: sim.streamfunction(), prof: Array.from(sim.profile()) });
}

snapshot();
let si = 1;
const t0 = performance.now();
let tl = t0, sl = 0;
const logEvery = +(args.logEvery ?? 2000);
for (;;) {
  sim.step();
  if (sim.nstep % 50 === 0) {
    const mv = sim.maxVel();
    if (mv.umax * sim.dt / dx > 0.45) { sim.dt *= 0.8; log(`# dt reduced to ${sim.dt.toFixed(5)} (CFL)`); }
    if (!Number.isFinite(mv.umax)) { log('# NaN, abort'); break; }
  }
  if (sim.nstep % logEvery === 0) {
    const now = performance.now();
    const mv = sim.maxVel();
    const V = sim.iceVolume() / sim.V0;
    const div = sim.divergence() * dx / Math.max(mv.umax, 1e-9);
    log(`t=${sim.t.toFixed(1)}s step=${sim.nstep} V/V0=${V.toFixed(4)} umax=${(mv.umax * 1e3).toFixed(2)}mm/s uIce=${(mv.uice * 1e3).toFixed(3)}mm/s div*dx/U=${div.toExponential(1)} ms/step=${((now - tl) / (sim.nstep - sl)).toFixed(2)}`);
    tl = now; sl = sim.nstep;
  }
  if (sim.nstep % 100 === 0) {
    const V = sim.iceVolume() / sim.V0;
    if (si < stops.length && V <= stops[si]) { snapshot(); si++; }
    if (si >= stops.length || sim.t > tmax) { if (si < stops.length) snapshot(); break; }
  }
}
const wall = (performance.now() - t0) / 1000;
log(`# done: t=${sim.t.toFixed(1)} s physical, ${sim.nstep} steps, wall ${wall.toFixed(1)} s, ${(wall * 1000 / sim.nstep).toFixed(2)} ms/step, cells=${sim.nr * sim.nz}`);
log(`# snapshots at t = ${snaps.map((s) => s.t.toFixed(0)).join(', ')} s ; V/V0 = ${snaps.map((s) => s.V.toFixed(2)).join(', ')}`);

// ---------- rendu ----------
function lerpPal(t) {
  const P = [[0, 150, 230, 255], [0.3, 60, 140, 210], [0.7, 35, 60, 110], [1, 16, 18, 26]];
  t = Math.max(0, Math.min(1, t));
  for (let n = 1; n < P.length; n++) if (t <= P[n][0]) {
    const a = P[n - 1], b = P[n], s = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2]), a[3] + s * (b[3] - a[3])];
  }
  return P.at(-1).slice(1);
}
const { nr, nz } = sim;
const sc = +(args.scale ?? (nr <= 100 ? 2 : 1));
const fw = 2 * nr * sc, fh = nz * sc, gap = 6;
const W = snaps.length * fw + (snaps.length - 1) * gap, Hh = fh;
const img = new Uint8Array(W * Hh * 3).fill(255);
snaps.forEach((s, n) => {
  let pm = 0; for (const v of s.psi) pm = Math.max(pm, Math.abs(v));
  const dpsi = pm / 14 || 1;
  const lev = (q) => Math.floor(s.psi[q] / dpsi);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const j = nz - 1 - Math.floor(y / sc);
    const xc = Math.floor(x / sc) - nr; // -nr..nr-1
    const i = xc >= 0 ? xc : -xc - 1;
    const q = j * nr + i;
    let c;
    if (s.sup[q]) c = [120, 120, 120];
    else {
      c = lerpPal(s.T[q] / Tinf);
      // isotherme T* (4 °C)
      if (Tinf > PHYS.Ts && s.fs[q] === 0) {
        const t0v = s.T[q] - PHYS.Ts;
        const nb = [i + 1 < nr ? q + 1 : q, j + 1 < nz ? q + nr : q];
        if (nb.some((p) => (s.T[p] - PHYS.Ts) * t0v < 0 && s.fs[p] === 0)) c = [255, 200, 60];
      }
      // lignes de courant
      if (s.fs[q] === 0 && i + 1 < nr && j + 1 < nz && (lev(q) !== lev(q + 1) || lev(q) !== lev(q + nr))) c = c.map((v) => v * 0.55 + 255 * 0.45);
      const f = s.fs[q];
      if (f > 0) c = c.map((v, m) => v * (1 - f) + [235, 242, 250][m] * f);
      // contour initial
      if (s.ice0[q] && ((i + 1 < nr && !s.ice0[q + 1]) || (j + 1 < nz && !s.ice0[q + nr]) || (j > 0 && !s.ice0[q - nr]))) c = [230, 40, 40];
    }
    const X = n * (fw + gap) + x, o = (y * W + X) * 3;
    img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
});
writePNG(path.join(outDir, `${name}.png`), W, Hh, img);

// ---------- profils ----------
const fin = snaps.at(-1);
const csv = ['z_mm,r_mm'];
for (let j = 0; j < nz; j++) csv.push(`${((j + 0.5) * dx * 1e3).toFixed(3)},${(fin.prof[j] * 1e3).toFixed(4)}`);
fs.writeFileSync(path.join(outDir, `${name}_profile.csv`), csv.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({
  name, Tinf, F, dx, hold, nr, nz, dt: sim.dt, steps: sim.nstep, wall, msPerStep: wall * 1000 / sim.nstep,
  snapshots: snaps.map((s) => ({ t: s.t, step: s.step, V: s.V, r_mm: s.prof.map((v) => +(v * 1e3).toFixed(4)), probe: s.probe })),
}));
log(`# wrote ${name}.png (${W}x${Hh}), ${name}.json, ${name}_profile.csv`);
