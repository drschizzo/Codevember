// P1 : la colonne sans fin. Une colonne de glace entre par la surface (haut du
// domaine) à vitesse constante v ; la température du lac T∞(u) fait un cycle de
// période P. On simule plusieurs périodes et on mesure l'écart de forme d'une
// période à la suivante (la boucle doit se refermer d'elle-même).
//
// Solveur : celui de P0 (../p0/sim.js), plus :
//  - l'avance : quand la glace a avancé d'une maille, son enthalpie descend d'une
//    rangée (décalage exact, sans diffusion numérique) ; une maille que la glace
//    quitte devient de l'eau à 0 °C ; la rangée du haut reçoit de la glace neuve ;
//  - le lac : au-delà de r = a + 8 mm, l'eau est rappelée vers T∞(t) (le large) ;
//  - le détachement : la glace qui n'est plus reliée à la surface (remplissage
//    depuis la rangée du haut) est retirée et l'événement est noté (P2 la fera
//    flotter et basculer).
//
// node p1.js --name=meta --T0=3 --T1=9 --P=400 --v=4e-4 --periods=4 [--feedOff=0.35,0.7 --F=20 --dx=0.5e-3]
import fs from 'node:fs';
import path from 'node:path';
import { Sim } from '../p0/sim.js';
import { writePNG } from '../p0/png.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const name = args.name ?? 'p1';
const T0 = +(args.T0 ?? 3), T1 = +(args.T1 ?? 9);
const P = +(args.P ?? 400);
const v = +(args.v ?? 4e-4);
// avance intermittente : la colonne descend pendant la saison froide et s'arrête
// l'été (--feedOff=0.35,0.7 : phases où elle est à l'arrêt, raccords de 0,05)
const feedOff = args.feedOff ? args.feedOff.split(',').map(Number) : null;
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const vAt = (t) => {
  if (!feedOff) return v;
  const ph = ((t / P) % 1 + 1) % 1, [a0, a1] = feedOff;
  return v * (1 - sstep(a0 - 0.05, a0, ph) * (1 - sstep(a1, a1 + 0.05, ph)));
};
const periods = +(args.periods ?? 4);
const F = +(args.F ?? 20);
const dx = +(args.dx ?? 0.5e-3);
const R = +(args.R ?? 0.04), Z = +(args.Z ?? 0.16);
const a = +(args.a ?? 0.014), H0 = +(args.H ?? 0.09);
const sample = +(args.sample ?? 2); // s entre deux relevés de profil

// T∞(t) : minimum à t = 0, maximum à P/2
const Tlake = (t) => 0.5 * (T0 + T1) - 0.5 * (T1 - T0) * Math.cos(2 * Math.PI * t / P);

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(outDir, { recursive: true });
const logPath = path.join(outDir, `${name}.log`);
fs.writeFileSync(logPath, '');
const log = (s) => { fs.appendFileSync(logPath, s + '\n'); console.log(s); };

const geom = { a, z0: Z - H0, z1: Z + 1, sup: [] };
const sim = new Sim({ dx, R, Z, Tinf: Tlake(0), F, geom, nV: 1, eta: 1e6, sponge: 0.5, wSponge: 0.008, spongeZ: { bottom: true, top: false } });
const { nr, nz, NR } = sim;
// le lac : rappel au-delà de a + 8 mm
const rLake = a + 0.008, sigLake = +(args.sigLake ?? 0.05);
for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
  if (sim.rc[i] > rLake) { const k = sim.id(i, j); sim.sig[k] = Math.max(sim.sig[k], sigLake * Math.min(1, (sim.rc[i] - rLake) / 0.004)); }
}
const iA = Math.ceil(a / dx) + 1; // colonnes où la glace peut se trouver
log(`# ${name}  T∞ ${T0}→${T1}→${T0} °C, P=${P} s, v=${(v * 1e3).toFixed(3)} mm/s, F=${F}, grille ${nr}x${nz}, dx=${dx * 1e3} mm, dt=${sim.dt.toFixed(4)} s`);

let shiftAcc = 0, nShift = 0;
function feed() {
  shiftAcc += vAt(sim.t) * sim.dt;
  if (shiftAcc < dx) return;
  shiftAcc -= dx; nShift++;
  const { h, T, fs: fsA } = sim, Lce = sim.Lce;
  for (let i = 0; i < iA; i++) {
    for (let j = 0; j < nz - 1; j++) {
      const k = sim.id(i, j), ku = k + NR;
      if (h[ku] < 0) h[k] = h[ku];
      else if (h[k] < 0) h[k] = 0;
    }
    const kt = sim.id(i, nz - 1);
    h[kt] = sim.rc[i] < a ? -Lce : h[kt];
    for (let j = 0; j < nz; j++) {
      const k = sim.id(i, j), hn = h[k];
      if (hn >= 0) { T[k] = hn; fsA[k] = 0; } else { T[k] = 0; fsA[k] = hn <= -Lce ? 1 : -hn / Lce; }
    }
  }
}

const events = [];
const seen = new Uint8Array(sim.N);
function detach() {
  const { fs: fsA, h, T } = sim;
  seen.fill(0);
  const stack = [];
  for (let i = 0; i < iA; i++) { const k = sim.id(i, nz - 1); if (fsA[k] > 0.5) { seen[k] = 1; stack.push(k); } }
  while (stack.length) {
    const k = stack.pop();
    for (const d of [1, -1, NR, -NR]) {
      const q = k + d;
      if (!seen[q] && fsA[q] > 0.5) { seen[q] = 1; stack.push(q); }
    }
  }
  let vol = 0, zmin = 1e9, zmax = -1e9;
  for (let j = 0; j < nz; j++) for (let i = 0; i < iA; i++) {
    const k = sim.id(i, j);
    if (fsA[k] > 0 && !seen[k]) {
      // une maille de fonte voisine de la glace reliée reste (c'est l'interface)
      if (fsA[k] <= 0.5 && (seen[k + 1] || seen[k - 1] || seen[k + NR] || seen[k - NR])) continue;
      vol += fsA[k] * 2 * Math.PI * sim.rc[i] * dx * dx;
      zmin = Math.min(zmin, j * dx); zmax = Math.max(zmax, (j + 1) * dx);
      h[k] = sim.Tinf; T[k] = sim.Tinf; fsA[k] = 0;
    }
  }
  if (vol > 2e-9) events.push({ t: sim.t, phase: (sim.t / P) % 1, vol_cm3: vol * 1e6, z_mm: [zmin * 1e3, zmax * 1e3] });
}

// relevés : rayon équivalent par rangée, toutes les `sample` secondes
const perPeriod = Math.round(P / sample);
const rec = []; // rec[n] = Float32Array(nz) en mm
const snaps = []; // instants de la dernière période pour l'image
const snapPh = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
function grabSnap() {
  const Tm = new Float32Array(nr * nz), F2 = new Float32Array(nr * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) { const k = sim.id(i, j), q = j * nr + i; Tm[q] = sim.T[k]; F2[q] = sim.fs[k]; }
  snaps.push({ t: sim.t, Tinf: sim.Tinf, T: Tm, fs: F2, psi: sim.streamfunction() });
}

const t0w = performance.now();
let nextSample = 0, nSample = 0;
const tEnd = periods * P;
while (sim.t < tEnd) {
  sim.Tinf = Tlake(sim.t);
  sim.step();
  feed();
  if (sim.nstep % 50 === 0) {
    const mv = sim.maxVel();
    let hs = 0; for (let q = 0; q < sim.N; q += 7) hs += sim.h[q] + sim.u[q] + sim.w[q];
    if (!Number.isFinite(mv.umax) || !Number.isFinite(hs)) { log(`# NaN à t=${sim.t.toFixed(1)} s, pas ${sim.nstep}, T∞=${sim.Tinf.toFixed(2)}, dt=${sim.dt}`); process.exit(1); }
    if (mv.umax * sim.dt / dx > 0.45) { sim.dt *= 0.8; log(`# dt → ${sim.dt.toFixed(4)}`); }
  }
  if (sim.nstep % 100 === 0) detach();
  if (sim.t >= nextSample) {
    rec.push(Float32Array.from(sim.profile(), (x) => x * 1e3));
    if (nSample >= (periods - 1) * perPeriod) {
      const ph = (nSample % perPeriod) / perPeriod;
      if (snapPh.some((p) => Math.abs(p - ph) < 0.5 / perPeriod)) grabSnap();
    }
    nSample++; nextSample += sample;
  }
  if (sim.nstep % 4000 === 0) {
    const pr = rec.at(-1); let tip = nz; for (let j = 0; j < nz; j++) if (pr[j] > 0.3) { tip = j; break; }
    log(`t=${sim.t.toFixed(0)} s (période ${(sim.t / P).toFixed(2)})  T∞=${sim.Tinf.toFixed(2)}  V=${(sim.iceVolume() * 1e6).toFixed(2)} cm³  bout à z=${(tip * dx * 1e3).toFixed(0)} mm  ${((performance.now() - t0w) / sim.nstep).toFixed(2)} ms/pas`);
  }
}
const wall = (performance.now() - t0w) / 1000;
log(`# fin : ${sim.nstep} pas, ${wall.toFixed(0)} s, ${(wall * 1000 / sim.nstep).toFixed(2)} ms/pas, ${nShift} décalages`);

// ---- périodicité : écart de profil entre périodes successives, même phase
const res = [];
for (let p = 1; p < periods; p++) {
  let s2 = 0, n = 0, mx = 0;
  for (let q = 0; q < perPeriod; q++) {
    const A = rec[(p - 1) * perPeriod + q], B = rec[p * perPeriod + q];
    if (!A || !B) continue;
    for (let j = 0; j < nz; j++) { const d = A[j] - B[j]; s2 += d * d; n++; mx = Math.max(mx, Math.abs(d)); }
  }
  res.push({ from: p - 1, to: p, rms_mm: Math.sqrt(s2 / n), max_mm: mx });
  log(`# écart période ${p - 1} → ${p} : RMS ${Math.sqrt(s2 / n).toFixed(3)} mm, max ${mx.toFixed(2)} mm`);
}
for (const e of events) log(`# détachement t=${e.t.toFixed(0)} s (phase ${e.phase.toFixed(3)}, période ${Math.floor(e.t / P)}) : ${e.vol_cm3.toFixed(2)} cm³, z ${e.z_mm[0].toFixed(0)}–${e.z_mm[1].toFixed(0)} mm`);

// ---- image : les 8 phases de la dernière période
function pal(t) {
  const Pp = [[0, 150, 230, 255], [0.3, 60, 140, 210], [0.7, 35, 60, 110], [1, 16, 18, 26]];
  t = Math.max(0, Math.min(1, t));
  for (let n = 1; n < Pp.length; n++) if (t <= Pp[n][0]) { const A = Pp[n - 1], B = Pp[n], s = (t - A[0]) / (B[0] - A[0]); return [0, 1, 2].map((m) => A[m + 1] + s * (B[m + 1] - A[m + 1])); }
  return Pp.at(-1).slice(1);
}
const sc = 2, fw = 2 * nr * sc, fh = nz * sc, gap = 6;
const W = snaps.length * fw + (snaps.length - 1) * gap;
const img = new Uint8Array(W * fh * 3).fill(255);
snaps.forEach((s, n) => {
  let pm = 0; for (const x of s.psi) pm = Math.max(pm, Math.abs(x));
  const dp = pm / 14 || 1, lev = (q) => Math.floor(s.psi[q] / dp);
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const j = nz - 1 - Math.floor(y / sc), xc = Math.floor(x / sc) - nr, i = xc >= 0 ? xc : -xc - 1, q = j * nr + i;
    let c = pal(s.T[q] / Math.max(s.Tinf, 0.5));
    if (s.fs[q] === 0 && i + 1 < nr && j + 1 < nz && (lev(q) !== lev(q + 1) || lev(q) !== lev(q + nr))) c = c.map((u) => u * 0.55 + 255 * 0.45);
    const f = s.fs[q]; if (f > 0) c = c.map((u, m) => u * (1 - f) + [235, 242, 250][m] * f);
    // jauge de T∞ en haut à gauche
    if (y < 8 && x < (s.Tinf / 10) * fw) c = [255, 140, 60];
    const o = (y * W + n * (fw + gap) + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
});
writePNG(path.join(outDir, `${name}.png`), W, fh, img);
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({
  name, T0, T1, P, v, F, dx, nr, nz, periods, sample, wall, msPerStep: wall * 1000 / sim.nstep, residuals: res, events,
  lastPeriod_r_mm: rec.slice((periods - 1) * perPeriod).map((r) => Array.from(r, (x) => +x.toFixed(3))),
}));
log(`# écrit ${name}.png, ${name}.json`);
