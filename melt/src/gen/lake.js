// Le lac : une colonne de glace sans fin entre par la surface (le haut du
// domaine) pendant la saison froide et s'arrête l'été ; la température du lac
// fait un cycle par période ; la glace qui n'est plus reliée à la surface se
// détache (le fuseau libéré, qui bascule ensuite : body.js).
//
// On simule plusieurs périodes (la première est le régime transitoire) et on
// relève la dernière : profil de la glace à chaque échantillon, longueur
// immergée, avance cumulée, et le fuseau au moment où il se détache.
// Prototypes : proto/p1 (avance, lac, détachement), proto/p8 (réglage).
//
// La boucle se referme d'elle-même : toute la glace visible est neuve à chaque
// période (P1 mesure un écart de 0,1 à 0,3 mm entre la 3ᵉ et la 4ᵉ période).
import { Sim } from './sim.js';

const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// T∞(u) : minimum à u = 0 (hiver), maximum à u = 0,5 (été)
export const lakeT = (spec, u) => 0.5 * (spec.T0 + spec.T1) - 0.5 * (spec.T1 - spec.T0) * Math.cos(2 * Math.PI * u);
// avance relative (0 : arrêt) à la phase u
export const feedRate = (spec, u) => {
  const [a0, a1] = spec.feedOff, ph = ((u % 1) + 1) % 1;
  return 1 - sstep(a0 - 0.05, a0, ph) * (1 - sstep(a1, a1 + 0.05, ph));
};

export function runLake(spec, onProgress = null) {
  const { T0, T1, P, v, F = 20, dx = 1e-3, R = 0.04, Z = 0.16, a = 0.014, H0 = 0.04, periods = 3, samples = 200, sigLake = 0.05 } = spec;
  const sim = new Sim({ dx, R, Z, Tinf: lakeT(spec, 0), F, geom: { a, z0: Z - H0, z1: Z + 1, sup: [] }, nV: 1, eta: 1e6, sponge: 0.5, wSponge: 0.008, spongeZ: { bottom: true, top: false } });
  const { nr, nz, NR } = sim;
  // le lac : rappel vers T∞ au-delà de a + 8 mm
  const rLake = a + 0.008;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
    if (sim.rc[i] > rLake) { const k = sim.id(i, j); sim.sig[k] = Math.max(sim.sig[k], sigLake * Math.min(1, (sim.rc[i] - rLake) / 0.004)); }
  }
  const iA = Math.ceil(a / dx) + 1;
  const Lce = sim.Lce;

  // ── l'avance : une rangée exacte chaque fois que la glace a avancé d'une maille
  let shiftAcc = 0, fed = 0;
  function feed() {
    const dz = v * feedRate(spec, sim.t / P) * sim.dt;
    shiftAcc += dz; fed += dz;
    if (shiftAcc < dx) return;
    shiftAcc -= dx;
    const { h, T, fs } = sim;
    for (let i = 0; i < iA; i++) {
      for (let j = 0; j < nz - 1; j++) {
        const k = sim.id(i, j), ku = k + NR;
        if (h[ku] < 0) h[k] = h[ku];
        else if (h[k] < 0) h[k] = 0; // l'eau que la glace laisse, à 0 °C
      }
      const kt = sim.id(i, nz - 1);
      if (sim.rc[i] < a) h[kt] = -Lce;
      for (let j = 0; j < nz; j++) {
        const k = sim.id(i, j), hn = h[k];
        if (hn >= 0) { T[k] = hn; fs[k] = 0; } else { T[k] = 0; fs[k] = hn <= -Lce ? 1 : -hn / Lce; }
      }
    }
  }

  // ── le détachement : la glace qui n'est plus reliée à la rangée du haut
  const seen = new Uint8Array(sim.N);
  const events = [];
  function detach(record) {
    const { fs, h, T } = sim;
    seen.fill(0);
    const stack = [];
    for (let i = 0; i < iA; i++) { const k = sim.id(i, nz - 1); if (fs[k] > 0.5) { seen[k] = 1; stack.push(k); } }
    while (stack.length) {
      const k = stack.pop();
      for (const d of [1, -1, NR, -NR]) { const q = k + d; if (!seen[q] && fs[q] > 0.5) { seen[q] = 1; stack.push(q); } }
    }
    let vol = 0, j0 = nz, j1 = -1;
    const rows = new Float64Array(nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < iA; i++) {
      const k = sim.id(i, j);
      if (fs[k] > 0 && !seen[k]) {
        if (fs[k] <= 0.5 && (seen[k + 1] || seen[k - 1] || seen[k + NR] || seen[k - NR])) continue; // l'interface reste
        vol += fs[k] * 2 * Math.PI * sim.rc[i] * dx * dx;
        rows[j] += fs[k] * sim.rc[i] * dx;
        j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        h[k] = sim.Tinf; T[k] = sim.Tinf; fs[k] = 0;
      }
    }
    if (record && vol > 0.2e-6) {
      const prof = new Float32Array(j1 - j0 + 1);
      for (let j = j0; j <= j1; j++) prof[j - j0] = Math.sqrt(2 * rows[j]) * 1e3;
      events.push({ t: sim.t, phase: (sim.t / P) % 1, vol_cm3: vol * 1e6, z0: j0 * dx, z1: (j1 + 1) * dx, prof });
    }
  }

  const prof = new Float32Array(samples * nz), Lim = new Float32Array(samples), feedAt = new Float32Array(samples);
  const tEnd = periods * P, tRec = (periods - 1) * P;
  let k = 0, fedRec = 0;
  const t0 = Date.now();
  let lastReport = 0;
  while (sim.t < tEnd) {
    sim.Tinf = lakeT(spec, sim.t / P);
    sim.step();
    feed();
    if (sim.nstep % 50 === 0) {
      const mv = sim.maxVel();
      if (!Number.isFinite(mv.umax)) throw new Error(`simulation instable (t = ${sim.t.toFixed(1)} s)`);
      if (mv.umax * sim.dt / dx > 0.45) sim.dt *= 0.8;
    }
    if (sim.nstep % 100 === 0) detach(sim.t >= tRec);
    if (sim.t >= tRec && fedRec === 0) fedRec = fed;
    if (sim.t >= tRec + (k * P) / samples && k < samples) {
      const p = sim.profile();
      let jt = 0; while (jt < nz && p[jt] < 0.3e-3) jt++;
      for (let j = 0; j < nz; j++) prof[k * nz + j] = p[j] * 1e3;
      Lim[k] = jt >= nz ? 0 : (nz - jt) * dx * 1e3;
      feedAt[k] = (fed - fedRec) * 1e3;
      k++;
    }
    if (onProgress && sim.t - lastReport > P / 40) {
      lastReport = sim.t;
      onProgress(sim.t / tEnd, { u: (sim.t / P) % 1, T: sim.Tinf, prof: Array.from(sim.profile(), (x) => +(x * 1e3).toFixed(2)) });
    }
  }
  // le fuseau : le plus gros détachement de la dernière période
  const main = events.reduce((m, e) => (!m || e.vol_cm3 > m.vol_cm3 ? e : m), null);
  return {
    nz, dx, Z, samples, P, prof, Lim, feedAt, feedPeriod: (fed - fedRec) * 1e3,
    detach: main ? { phase: main.phase, vol_cm3: main.vol_cm3, z0: main.z0, z1: main.z1, prof: main.prof } : null,
    steps: sim.nstep, ms: Date.now() - t0,
  };
}
