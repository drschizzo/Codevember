// La simulation d'une boucle entière, enregistrée pour être relue.
//
// 1. intègre la corde (gen/rod.js) sur le plan physique (plan.js), à petits
//    pas, et l'enregistre à 120 Hz physiques ;
// 2. repère les temps forts (le premier flambage de chaque cycle, les lâchers)
//    et en déduit le temps du film (ralentis de caméra rapide, accélérés) ;
// 3. corrige le résidu de la boucle (l'état final rejoint l'état initial, à
//    quelques microns près ; la correction est répartie sur la dernière
//    seconde de repos) ;
// 4. rééchantillonne à 30 images par seconde de film.
// Module pur : importable depuis Node (tests, bancs) et le worker.
import { createRod } from './rod.js';
import { makePlan, makeWarp, rodSpec, sstep } from '../plan.js';

const REC = 120;      // Hz physiques
const FILM = 30;      // images par seconde de film enregistrées

export function simulate(R, { hz = 3000, onProgress } = {}) {
  const plan = makePlan(R);
  const spec = rodSpec(R.family, R.sim);
  spec.topY = 0;
  const rod = createRod(spec);
  const { nv, ns } = rod, st = rod.state;
  const stride = nv * 3 + ns * 4 + 4; // positions, quaternions, volant (y, φ), mandrin θ, barre
  const steps = Math.round(plan.P * hz), every = Math.round(hz / REC), nrec = Math.floor(steps / every) + 1;
  const rec = new Float32Array(nrec * stride);
  const y0 = st.fly.y;
  const buckles = [];
  let r = 0;
  const record = () => {
    const o = r * stride;
    rec.set(st.P, o);
    rec.set(st.Q, o + nv * 3);
    rec[o + stride - 4] = st.fly.y;
    rec[o + stride - 3] = st.fly.phi;
    rec[o + stride - 2] = st.theta;
    rec[o + stride - 1] = 0;
    r++;
  };
  record();
  const dt = 1 / hz;
  let cyc = 0;
  for (let i = 1; i <= steps; i++) {
    const tau = i * dt, d = plan.drive(tau);
    rod.step(dt, d);
    // premier flambage d'un cycle : le volant remonte de 1 cm pendant la torsion
    const c = plan.cycles[cyc];
    if (c && tau > c.t1) cyc++;
    else if (c && tau > c.t0 && buckles.length <= cyc && st.fly.y - y0 > 0.01) buckles[cyc] = tau;
    if (i % every === 0) record();
    if (onProgress && i % (hz * 2) === 0) onProgress(i / steps);
  }
  while (r < nrec) record();
  const P = plan.P;

  // ── résidu de la boucle ──
  const last = (nrec - 1) * stride;
  let resid = 0;
  const delta = new Float32Array(stride);
  for (let k = 0; k < nv * 3; k++) { delta[k] = rec[last + k] - rec[k]; resid = Math.max(resid, Math.abs(delta[k])); }
  // quaternions : après N tours, un repère revient à la même orientation mais
  // son quaternion peut avoir changé de signe (revêtement double) : on vise ±q₀
  for (let j = 0; j < ns; j++) {
    const o = nv * 3 + j * 4;
    let d = 0;
    for (let c = 0; c < 4; c++) d += rec[last + o + c] * rec[o + c];
    const sg = d < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) delta[o + c] = rec[last + o + c] - sg * rec[o + c];
  }
  delta[stride - 4] = rec[last + stride - 4] - rec[stride - 4];
  const turnsEnd = rec[last + stride - 3] / (2 * Math.PI);
  delta[stride - 3] = (turnsEnd - plan.N) * 2 * Math.PI; // (le volant a fait N tours entiers)
  const residPhi = Math.abs(turnsEnd - plan.N);
  for (let j = 0; j < nrec; j++) {
    const tau = j / REC, w = sstep(P - 1.5, P, tau);
    if (!w) continue;
    const o = j * stride;
    for (let k = 0; k < stride - 2; k++) rec[o + k] -= w * delta[k];
  }

  // ── temps du film ──
  const bumps = [];
  plan.cycles.forEach((c, k) => {
    const big = k === plan.cycles.length - 1;
    if (buckles[k]) bumps.push({ c: buckles[k] + 0.15, w: 0.9, a: Math.log(1 / 2.5) });
    bumps.push({ c: c.free0 + 0.35, w: big ? 1.6 : 1.1, a: Math.log(1 / (big ? 3 : 2)) });
    if (c.settle > 5) bumps.push({ c: (c.free0 + 2.5 + c.free1) / 2, w: (c.free1 - c.free0 - 3) / 2, a: Math.log(1.7) });
  });
  const warp = makeWarp(P, bumps);
  const T = warp.T, nf = Math.round(T * FILM);

  // ── rééchantillonnage (Catmull-Rom en τ) ──
  const frames = new Float32Array(nf * stride);
  for (let f = 0; f < nf; f++) {
    const tau = warp.tauOf((f / nf) * T), x = tau * REC, i1 = Math.floor(x), u = x - i1;
    const idx = (i) => Math.min(nrec - 1, Math.max(0, i)) * stride;
    const a = idx(i1 - 1), b = idx(i1), c2 = idx(i1 + 1), d = idx(i1 + 2), o = f * stride;
    const u2 = u * u, u3 = u2 * u;
    const w0 = -0.5 * u3 + u2 - 0.5 * u, w1 = 1.5 * u3 - 2.5 * u2 + 1, w2 = -1.5 * u3 + 2 * u2 + 0.5 * u, w3 = 0.5 * u3 - 0.5 * u2;
    for (let k = 0; k < stride; k++) frames[o + k] = w0 * rec[a + k] + w1 * rec[b + k] + w2 * rec[c2 + k] + w3 * rec[d + k];
  }

  return {
    frames, nf, fps: FILM, T, P, stride, nv, ns, bumps, buckles, residual: resid, residualTurns: residPhi,
    strands: rod.nSeg.map((n, k) => ({ n, v0: rod.vOff[k], s0: rod.sOff[k] })),
    y0, r: spec.r, L: spec.L,
  };
}
