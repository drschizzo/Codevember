// Invariants du cœur : optique, FFT et Poisson, transport optimal, lentille,
// ondes (retournement temporel), horloge du film, caméra, tourbillons.
//   node --test caustic/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nWater, refract, snellNormal, vnorm, omega, groupVelocity, fresnel } from '../src/optics.js';
import { fft2, poissonDirichlet, poissonNeumann } from '../src/gen/fft.js';
import { solveTransport, pushForward } from '../src/gen/transport.js';
import { target, SERIES } from '../src/gen/motifs.js';
import { buildEvent, flatLanding } from '../src/gen/lens.js';
import { evolve, causticCPU } from '../src/gen/waves.js';
import { foyerClock, faradayState, karmanVortices, cameraPose, B7 } from '../src/timeline.js';
import { generate } from '../src/recipe.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} ≠ ${b} (±${tol})`);

test('indice de l’eau (Quan et Fry) et dispersion normale', () => {
  close(nWater(589), 1.333, 5e-4, 'n(589 nm)');
  assert.ok(nWater(450) > nWater(550) && nWater(550) > nWater(650), 'le bleu est plus réfracté que le rouge');
});

test('Snell : la normale calculée fait bien la déviation demandée', () => {
  const n2 = 1.333;
  for (const [i, t] of [[[0, -1, 0], vnorm([0.2, -1, 0.1])], [vnorm([0.4, -1, -0.2]), vnorm([0.1, -1, 0])]]) {
    const n = snellNormal(i, t, 1, n2);
    const r = refract(i, n, 1 / n2);
    for (let k = 0; k < 3; k++) close(r[k], t[k], 1e-9, 'réfraction');
  }
  close(fresnel(1, 1, 1.333), 0.0204, 2e-4, 'Fresnel à incidence normale');
  assert.equal(fresnel(0.5, 1.333, 1), 1, 'réflexion totale au-delà de 48,6°');
});

test('ondes de capillarité-gravité : vitesse de groupe minimale ≈ 18 cm/s', () => {
  let min = 1e9;
  for (let k = 50; k < 3000; k += 5) min = Math.min(min, groupVelocity(k, 0.45));
  close(min, 0.177, 0.01, 'c_g min');
  close(omega(1000, 0.45) ** 2, 9.81 * 1000 + 7.28e-5 * 1e9, 1, 'ω²');
});

test('FFT : aller-retour exact ; Poisson : le laplacien discret redonne le second membre', () => {
  const n = 64, re = new Float64Array(n * n), im = new Float64Array(n * n), ref = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) { re[i] = Math.sin(i * 0.37) + Math.cos(i * 0.011); ref[i] = re[i]; }
  fft2(re, im, n); fft2(re, im, n, true);
  for (let i = 0; i < n * n; i++) close(re[i], ref[i], 1e-9);
  const m = 63, h = 1 / 64, f = new Float64Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) f[j * m + i] = Math.exp(-((i - 30) ** 2 + (j - 20) ** 2) / 50);
  const u = poissonDirichlet(f, m, h);
  const at = (i, j) => (i < 0 || j < 0 || i >= m || j >= m ? 0 : u[j * m + i]);
  let err = 0;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) err = Math.max(err, Math.abs((at(i + 1, j) + at(i - 1, j) + at(i, j + 1) + at(i, j - 1) - 4 * at(i, j)) / (h * h) - f[j * m + i]));
  assert.ok(err < 1e-6, `Dirichlet ${err}`);
  const g = new Float64Array(64 * 64);
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) g[j * 64 + i] = Math.cos((Math.PI * (i + 0.5)) / 64);
  const v = poissonNeumann(g, 64, h);
  assert.ok(Number.isFinite(v[0]), 'Neumann');
});

test('transport optimal : convergence et lumière poussée fidèle à la cible (toutes les séries)', () => {
  for (const s of Object.keys(SERIES)) {
    const nu = target(s, 1, 't', 128);
    let mean = 0;
    for (const v of nu) mean += v;
    close(mean / nu.length, 1, 1e-6, `${s} : la lumière totale est conservée`);
    const T = solveTransport(nu, 128, { m: 127, iters: 150 });
    assert.ok(T.residual < 0.02, `${s} : résidu ${T.residual}`);
    // corrélation entre la densité obtenue et la cible (grille 32×32, moyennes)
    const n = 32, pf = pushForward(T, n), tg = new Float64Array(n * n);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) tg[((j >> 2) * n) + (i >> 2)] += nu[j * 128 + i] / 16;
    let sa = 0, sb = 0, sab = 0, saa = 0, sbb = 0;
    for (let k = 0; k < n * n; k++) { sa += pf[k]; sb += tg[k]; sab += pf[k] * tg[k]; saa += pf[k] ** 2; sbb += tg[k] ** 2; }
    const N = n * n, r = (sab - (sa * sb) / N) / Math.sqrt((saa - (sa * sa) / N) * (sbb - (sb * sb) / N));
    assert.ok(r > 0.8, `${s} : corrélation ${r.toFixed(3)}`);
  }
});

test('lentille : pentes plausibles pour de l’eau, rien ne bouge hors du dessin, dessin net au foyer', () => {
  const N = 256, L = 1.2, H = 0.45, light = { kind: 'sun', dir: vnorm([0.15, -1, -0.2]) };
  const ev = buildEvent({ series: 'urchin', level: 1, seed: 't', N, L, H, light, side: 0.52, nt: 128, m: 128 });
  assert.ok(ev.lens.maxSlope < 0.3, `pente ${ev.lens.maxSlope}`);
  assert.ok(ev.lens.leak < 0.01, `fuite ${ev.lens.leak}`);
  // au foyer, la caustique a du contraste (des traits nets) ; ±0,2 s plus tard, un réseau
  const reg = [-0.3, -0.3, 0.6], n = 96;
  const contrast = (tau) => { const c = causticCPU(evolve(ev.spec, N, L, H, tau), N, L, H, light, reg, n); let m = 0, s = 0; for (const v of c) { m += v; s += v * v; } m /= c.length; return Math.sqrt(s / c.length - m * m) / m; };
  assert.ok(contrast(0) > 0.4, `contraste au foyer ${contrast(0)}`);
});

test('ondes : l’onde qui converge est celle qui diverge lue à l’envers (retournement temporel)', () => {
  const N = 64, L = 1.2, H = 0.45, re = new Float32Array(N * N), im = new Float32Array(N * N);
  for (let i = 1; i < 40; i++) { re[i * 7 % (N * N)] = Math.sin(i); im[i * 7 % (N * N)] = 0; }
  // champ réel : spectre hermitien
  const spec = { re: new Float32Array(N * N), im: new Float32Array(N * N) };
  for (let q = 0; q < N; q++) for (let p = 0; p < N; p++) {
    const c = q * N + p, cn = ((N - q) % N) * N + ((N - p) % N);
    spec.re[c] = 0.5 * (re[c] + re[cn]); spec.im[c] = 0.5 * (im[c] - im[cn]);
  }
  const a = evolve(spec, N, L, H, 0.3), b = evolve(spec, N, L, H, -0.3);
  for (let i = 0; i < N * N; i++) { close(a.h[i], b.h[i], 1e-12); close(a.hx[i], b.hx[i], 1e-12); }
});

test('horloge du foyer : temps physique croissant, ralenti au dessin, boucle exacte', () => {
  const R = generate('t1', { family: 'foyer' });
  const C = foyerClock(R);
  let prev = -1;
  for (let k = 0; k <= 2000; k++) { const p = C.phys(k / 2000 - 1e-12 * (k === 2000)); assert.ok(p >= prev - 1e-12, 'monotone'); prev = p; }
  close(C.phys(0), 0, 1e-12);
  // aux instants des dessins : vitesse minimale, temps propre nul, fenêtre pleine
  C.tj.forEach((t, j) => {
    const u = t / C.T;
    close(C.speed(u), R.foyer.slow.vmin, 1e-9, 'ralenti');
    close(C.events(u)[j].tau, 0, 1e-9, 'τ = 0 au dessin');
    close(C.events(u)[j].w, 1, 1e-12, 'fenêtre');
  });
  // raccord : les états à u = 0 et u = 1 sont identiques (et la fenêtre y est nulle)
  const e0 = C.events(0), e1 = C.events(1 - 1e-9);
  e0.forEach((e, j) => { close(e.w, e1[j].w, 1e-6); close(e.w, 0, 1e-9, 'calme au raccord'); });
  close(B7(1), 16 / 35, 1e-15);
});

test('caméra : périodique, lente (< 25°/s), accélération bornée à 120 i/s', () => {
  for (const fam of ['foyer', 'faraday', 'karman']) for (const seed of ['a', 'b', 'c']) {
    const R = generate(seed, { family: fam });
    const C = fam === 'foyer' ? foyerClock(R) : null;
    const T = R.loop.duration, n = Math.round(T * 120);
    const dir = (u) => { const p = cameraPose(R, u, C); const d = p.target.map((v, i) => v - p.pos[i]); const l = Math.hypot(...d); return d.map((v) => v / l); };
    const a = cameraPose(R, 0, C), b = cameraPose(R, 1, C);
    for (let k = 0; k < 3; k++) close(a.pos[k], b.pos[k], 1e-9, 'raccord');
    let peak = 0, acc = 0, pv = null;
    for (let i = 0; i < n; i++) {
      const d0 = dir(i / n), d1 = dir((i + 1) / n);
      const w = Math.acos(Math.min(1, d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2])) * 120 * (180 / Math.PI);
      peak = Math.max(peak, w);
      const p0 = cameraPose(R, i / n, C).pos, p1 = cameraPose(R, (i + 1) / n, C).pos;
      const v = p1.map((x, k) => (x - p0[k]) * 120);
      if (pv) acc = Math.max(acc, Math.hypot(...v.map((x, k) => (x - pv[k]) * 120)));
      pv = v;
    }
    assert.ok(peak < 25, `${fam}/${seed} : ${peak.toFixed(1)}°/s`);
    assert.ok(acc < 0.5, `${fam}/${seed} : accélération ${acc.toFixed(3)} m/s²`);
  }
});

test('Faraday et Kármán : états périodiques sur la boucle', () => {
  const F = generate('f', { family: 'faraday' });
  for (const s of ['a', 'b', 'c', 'd', 'e']) { const G = generate(s, { family: 'faraday' }); assert.ok(typeof G.faraday.first === 'string' && typeof G.faraday.second === 'string', 'deux réseaux nommés'); }
  const a = faradayState(F, 0), b = faradayState(F, 1 - 1e-12);
  close(a.drive, b.drive, 1e-6); close(a.beat, b.beat, 1e-6); close(a.drive, 0, 1e-9, 'repos au raccord');
  const K = generate('k', { family: 'karman' });
  // (les tourbillons visibles : ceux qui sortent par le déversoir ont une fossette nulle)
  const vis = (u) => karmanVortices(K, u).filter((v) => v[2] > 1e-9);
  const va = vis(0.2), vb = vis(1.2);
  assert.equal(va.length, vb.length);
  va.forEach((v, i) => v.forEach((x, k) => close(x, vb[i][k], 1e-9)));
  assert.ok(va.length > 4, 'une allée à l’image');
});

test('la lentille et son dessin tiennent dans la cuve pour toutes les humeurs du foyer', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const R = generate(seed, { family: 'foyer' });
    const L0 = flatLanding(R.light, [0, 0, 0], R.tank.H, nWater(545));
    assert.ok(Math.hypot(L0[0], L0[2]) < 0.24, `${seed}/${R.mood} : décalage ${Math.hypot(L0[0], L0[2]).toFixed(3)} m`);
  }
});
