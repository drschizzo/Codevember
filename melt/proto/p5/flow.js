// P5, étape 1 : l'écoulement autour d'une colonne suspendue, en régime établi,
// en eau froide (3 °C, couche limite montante) et en eau chaude (8 °C,
// descendante). Solveur de P0, F = 20. Écrit out/flow_<T>.json : vitesses aux
// centres des mailles (m/s), température, profil de la glace.
//
// node flow.js --Tinf=3 --tmax=80
import fs from 'node:fs';
import path from 'node:path';
import { Sim } from '../p0/sim.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const Tinf = +(args.Tinf ?? 3), tmax = +(args.tmax ?? 80), dx = 0.5e-3;
const R = 0.04, Z = 0.144, a = 0.014, H = 0.09;
const sim = new Sim({ dx, R, Z, Tinf, F: 20, nV: 1, geom: { a, z0: Z - H, z1: Z + 1, sup: [] }, sponge: 0.5, wSponge: 0.008, spongeZ: { bottom: true, top: false } });
while (sim.t < tmax) {
  sim.step();
  if (sim.nstep % 50 === 0) { const mv = sim.maxVel(); if (mv.umax * sim.dt / dx > 0.45) sim.dt *= 0.8; }
}
const { nr, nz, NR } = sim;
const U = [], Wv = [], T = [];
for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
  const k = sim.id(i, j);
  U.push(+(0.5 * (sim.u[k] + (i > 0 ? sim.u[k - 1] : 0))).toExponential(3));
  Wv.push(+(0.5 * (sim.w[k] + (j > 0 ? sim.w[k - NR] : 0))).toExponential(3));
  T.push(+sim.T[k].toFixed(3));
}
const prof = Array.from(sim.profile(), (x) => +(x * 1e3).toFixed(3)); // mm, par rangée (z du bas)
const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `flow_${Tinf}.json`), JSON.stringify({ Tinf, dx, nr, nz, Z, t: sim.t, V: sim.iceVolume() / sim.V0, u: U, w: Wv, T, prof_mm: prof }));
console.log(`T∞=${Tinf} : t=${sim.t.toFixed(0)} s, V/V0=${(sim.iceVolume() / sim.V0).toFixed(2)}, umax=${(sim.maxVel().umax * 1e3).toFixed(2)} mm/s`);
