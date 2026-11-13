// Le nuage de spores : une simulation de fluide (module pur : worker, tests).
//
// Une grille 3D couvre le site et l'aval jusqu'au site suivant (cellules de
// 0,9 mm). L'air y obéit aux équations d'Euler incompressibles, résolues par
// la méthode de Stam (« Stable Fluids », 1999) :
//   1. forces : le vent du lieu (profil logarithmique de couche limite au-
//      dessus du bois, rappelé vers la vitesse du souffle de timeline.js), des
//      tourbillons qui passent avec lui (forçage à divergence nulle), le
//      confinement de vorticité (Fedkiw et al., 2001) qui garde les volutes ;
//   2. advection semi-lagrangienne (rétro-traçage, interpolation trilinéaire) ;
//   3. projection : pression par Jacobi (repartie de la précédente), puis
//      u ← u − ∇p ; le bois est un obstacle (vitesse nulle, Neumann).
// La concentration de spores ρ est émise par les têtes qui s'ouvrent (le
// volume que chaque sporange perd en s'ouvrant), transportée par l'air et par
// la chute de Stokes (v_s ∝ d²), et se DÉPOSE sur le bois : le flux qui
// traverse la surface, ρ·v_s, quitte l'air et s'ajoute à une carte de dépôt —
// la poussière du site suivant. La masse est tenue par un bilan exact :
// émise = en l'air + déposée + sortie du domaine (l'advection semi-
// lagrangienne, non conservative, est renormalisée à chaque pas).
//
// Des grains (quelques milliers de spores visibles une à une) sont portés par
// le même champ de vitesse (Runge-Kutta 2) et se posent là où la poussière se
// dépose ; ceux qui tombent le plus près des points de germination du site
// suivant y sont menés exactement.
//
// Enregistré en F images sur [S0, S1] (phase du site) : densité, transmission
// de la lumière vers le soleil, vitesse (pour l'interpolation entre images
// avec compensation de mouvement), dépôt cumulé ; relu à l'image.
import { createRng } from '../../../shared/rng.js';
import { windSpeed } from '../timeline.js';

export const SMOKE = { s0: 0.73, s1: 1.22, frames: 64, h: 0.1, sec: 40 };

const clampi = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

export function smokeDomain(L, groundMin) {
  const h = SMOKE.h;
  const x0 = -1.5, x1 = L + 1.2, z0 = -1.45, z1 = 1.45, y0 = groundMin - 0.04, y1 = y0 + 2.5;
  const nx = Math.round((x1 - x0) / h), ny = Math.round((y1 - y0) / h), nz = Math.round((z1 - z0) / h);
  return { x0, y0, z0, x1: x0 + nx * h, y1: y0 + ny * h, z1: z0 + nz * h, nx, ny, nz, h };
}

// emitters : [{ at(s) → { c, r, h } | null, rate(s) → volume/s, kick }]
export function simulateSmoke({ R, L, ground, emitters, sunDir, settle, grains = 5000, seeds = [], seed = 'smoke', progress = null }) {
  const rng = createRng(seed);
  let gmin = Infinity;
  for (let z = -1.45; z <= 1.45; z += 0.05) for (let x = -1.5; x <= L + 1.2; x += 0.1) gmin = Math.min(gmin, ground(x, z));
  const Dm = smokeDomain(L, gmin), { nx, ny, nz, h } = Dm, N = nx * ny * nz;
  const id = (i, j, k) => (k * ny + j) * nx + i;
  const X = (i) => Dm.x0 + (i + 0.5) * h, Y = (j) => Dm.y0 + (j + 0.5) * h, Z = (k) => Dm.z0 + (k + 0.5) * h;
  // obstacle : le bois (et la hauteur du sol sous chaque colonne)
  const solid = new Uint8Array(N), floorJ = new Int32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const gy = ground(X(i), Z(k));
    let fj = 0;
    for (let j = 0; j < ny; j++) if (Y(j) < gy) { solid[id(i, j, k)] = 1; fj = j + 1; }
    floorJ[k * nx + i] = Math.min(ny - 1, fj);
  }
  let u = new Float32Array(N), v = new Float32Array(N), w = new Float32Array(N), rho = new Float32Array(N);
  let u2 = new Float32Array(N), v2 = new Float32Array(N), w2 = new Float32Array(N), r2 = new Float32Array(N);
  const p = new Float32Array(N), div = new Float32Array(N), p2 = new Float32Array(N);
  const dep = new Float32Array(nx * nz);
  // trilinéaire (coordonnées en cellules, centres en i + 0,5)
  const tri = (f, x, y, z) => {
    x -= 0.5; y -= 0.5; z -= 0.5;
    const i0 = Math.floor(x), j0 = Math.floor(y), k0 = Math.floor(z), fx = x - i0, fy = y - j0, fz = z - k0;
    const a = clampi(i0, nx), b = clampi(i0 + 1, nx), c = clampi(j0, ny), d = clampi(j0 + 1, ny), e = clampi(k0, nz), g = clampi(k0 + 1, nz);
    const l = (q, r, t) => f[(t * ny + r) * nx + q];
    return ((l(a, c, e) * (1 - fx) + l(b, c, e) * fx) * (1 - fy) + (l(a, d, e) * (1 - fx) + l(b, d, e) * fx) * fy) * (1 - fz)
      + ((l(a, c, g) * (1 - fx) + l(b, c, g) * fx) * (1 - fy) + (l(a, d, g) * (1 - fx) + l(b, d, g) * fx) * fy) * fz;
  };
  // tourbillons qui passent avec le vent : quelques modes à divergence nulle
  const modes = Array.from({ length: 7 }, () => ({
    k: 1.6 + 3.5 * rng.next(), m: 1.2 + 3 * rng.next(), ph: rng.next() * 6.283, ph2: rng.next() * 6.283, a: 0.35 + 0.65 * rng.next(), plane: rng.next() < 0.5 ? 0 : 1,
  }));
  const F = SMOKE.frames, ds = (SMOKE.s1 - SMOKE.s0) / (F - 1), sub = 2, dtPhase = ds / sub, dt = dtPhase * SMOKE.sec;
  // enregistrement
  const rec = new Uint8Array(F * N * 4), depRec = new Float32Array(F * nx * nz);
  let emitted = 0, deposited = 0, outflow = 0, rhoMax = 1e-9;
  const frames = [], cent = [];
  const vs = settle;
  let windX = 0; // (déplacement du vent moyen, pour les tourbillons)
  // grains
  const G = [];
  const em = emitters.filter(Boolean);
  const totalRate = (s) => em.reduce((a, e) => a + e.rate(s), 0);
  let gAcc = 0;
  // masse totale émise prévue (pour répartir les grains)
  let Etot = 0; for (let s = SMOKE.s0; s < SMOKE.s1; s += dtPhase) Etot += totalRate(s) * dt;
  const grainPerMass = Etot > 0 ? grains / Etot : 0;
  const gPos = new Float32Array(F * grains * 3).fill(NaN); // (rempli plus bas : avant leur départ, les grains attendent à leur point de départ)
  let step = 0;
  for (let f = 0; f < F; f++) {
    for (let q = 0; q < (f === 0 ? 1 : sub); q++) {
      const s = SMOKE.s0 + (f - 1) * ds + (q + 1) * dtPhase;
      if (f > 0) {
        const U = windSpeed(s, R.wind.gust, R.wind.strength);
        windX += U * dt;
        // ── 1. forces ── (tourbillons : tables séparables par axe, recalculées à chaque pas)
        const MS = modes.map((md) => ({
          md,
          sx: Float32Array.from({ length: nx }, (_, i) => Math.sin(md.k * (X(i) - windX * 0.8) + md.ph)),
          cx: Float32Array.from({ length: nx }, (_, i) => Math.cos(md.k * (X(i) - windX * 0.8) + md.ph)),
          sy: Float32Array.from({ length: ny }, (_, j) => Math.sin(md.m * Y(j) + md.ph2)),
          cy: Float32Array.from({ length: ny }, (_, j) => Math.cos(md.m * Y(j) + md.ph2)),
          sz: Float32Array.from({ length: nz }, (_, k) => Math.sin(md.m * Z(k) + md.ph2)),
          cz: Float32Array.from({ length: nz }, (_, k) => Math.cos(md.m * Z(k) + md.ph2)),
        }));
        const kr = Math.min(1, dt / 0.9), kd = 1 - Math.min(1, dt / 4);
        const lnN = Math.log(1 + 1.2 / 0.03);
        for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
          const fj = floorJ[k * nx + i], gy = Dm.y0 + fj * h;
          for (let j = fj; j < ny; j++) {
            const o = id(i, j, k), yr = Y(j) - gy;
            const prof = Math.min(1.25, Math.log(1 + yr / 0.03) / lnN);
            u[o] += (U * prof - u[o]) * kr;
            v[o] *= kd; w[o] *= kd;
            if (U > 0.02) {
              const amp = U * 0.45 * Math.min(1, yr / 0.25) * dt;
              for (const T2 of MS) {
                const md = T2.md;
                if (md.plane === 0) { u[o] += amp * md.a * md.m * T2.sx[i] * T2.cy[j]; v[o] -= amp * md.a * md.k * T2.cx[i] * T2.sy[j]; }
                else { u[o] += amp * md.a * md.m * T2.sx[i] * T2.cz[k] * 0.6; w[o] -= amp * md.a * md.k * T2.cx[i] * T2.sz[k] * 0.6; }
              }
            }
          }
        }
        // confinement de vorticité
        vorticity(u, v, w, solid, nx, ny, nz, h, dt, 0.35);
        // ── émission : chaque tête verse ce qu'elle perd en s'ouvrant ──
        for (const e of em) {
          const rate = e.rate(s); if (rate <= 0) continue;
          const H = e.at(s); if (!H) continue;
          const m = rate * dt; emitted += m;
          const n = 3;
          for (let t = 0; t < n; t++) {
            const a = rng.next() * 6.283, rr = Math.sqrt(rng.next()) * H.r, yy = (rng.next() * 2 - 1) * H.h;
            splat(rho, (H.c[0] + Math.cos(a) * rr - Dm.x0) / h, (H.c[1] + yy - Dm.y0) / h, (H.c[2] + Math.sin(a) * rr - Dm.z0) / h, m / n / (h * h * h), nx, ny, nz);
            splat(v, (H.c[0] - Dm.x0) / h, (H.c[1] + H.h - Dm.y0) / h, (H.c[2] - Dm.z0) / h, e.kick * dt * 4 / n, nx, ny, nz);
          }
          // grains : en proportion de la masse
          gAcc += m * grainPerMass;
          while (gAcc >= 1 && G.length < grains) {
            gAcc -= 1;
            const a = rng.next() * 6.283, rr = Math.sqrt(rng.next()) * H.r;
            G.push({ x: H.c[0] + Math.cos(a) * rr, y: H.c[1] + (rng.next() * 2 - 1) * H.h, z: H.c[2] + Math.sin(a) * rr, s0: s, land: -1, vs: vs * (0.7 + 0.6 * rng.next()), jit: rng.next() });
          }
        }
        // ── 2. advection ──
        const Mbefore = mass(rho, solid, h);
        advect(u2, u, u, v, w, solid, nx, ny, nz, h, dt, 0, tri);
        advect(v2, v, u, v, w, solid, nx, ny, nz, h, dt, 0, tri);
        advect(w2, w, u, v, w, solid, nx, ny, nz, h, dt, 0, tri);
        advect(r2, rho, u, v, w, solid, nx, ny, nz, h, dt, vs, tri);
        [u, u2] = [u2, u]; [v, v2] = [v2, v]; [w, w2] = [w2, w]; [rho, r2] = [r2, rho];
        // dépôt : le flux ρ·v_s qui traverse la surface du bois ; sortie : ce qui quitte le domaine
        let dmass = 0, omass = 0;
        for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
          const o = id(i, floorJ[k * nx + i], k);
          const out = Math.min(rho[o], rho[o] * (vs + Math.max(0, -v[o])) * dt / h);
          rho[o] -= out; const mm = out * h * h * h; dep[k * nx + i] += mm; dmass += mm;
        }
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const o = id(nx - 1, j, k); const out = Math.min(rho[o], rho[o] * Math.max(0, u[o]) * dt / h); rho[o] -= out; omass += out * h * h * h; }
        for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const o = id(i, ny - 1, k); const out = Math.min(rho[o], rho[o] * Math.max(0, v[o]) * dt / h); rho[o] -= out; omass += out * h * h * h; }
        deposited += dmass; outflow += omass;
        // renormalisation : la masse en l'air est exactement ce que dit le bilan
        const Mtarget = Math.max(0, emitted - deposited - outflow), Mnow = mass(rho, solid, h);
        if (Mnow > 0) { const kk = Mtarget / Mnow; for (let o = 0; o < N; o++) rho[o] *= kk; }
        void Mbefore;
        // ── 3. projection ──
        project(u, v, w, p, div, p2, solid, nx, ny, nz, h, 10);
        // grains : RK2 dans le champ de vitesse, chute de Stokes, pose sur le bois
        for (const g of G) {
          if (g.land >= 0) continue;
          const cx = (g.x - Dm.x0) / h, cy = (g.y - Dm.y0) / h, cz = (g.z - Dm.z0) / h;
          const ua = tri(u, cx, cy, cz), va = tri(v, cx, cy, cz) - g.vs, wa = tri(w, cx, cy, cz);
          const mx = cx + ua * dt / (2 * h), my = cy + va * dt / (2 * h), mz = cz + wa * dt / (2 * h);
          const ub = tri(u, mx, my, mz), vb = tri(v, mx, my, mz) - g.vs, wb = tri(w, mx, my, mz);
          g.x += ub * dt; g.y += vb * dt; g.z += wb * dt;
          const gy = ground(g.x, g.z);
          if (g.y <= gy) { g.y = gy; g.land = s; }
        }
        step++;
      }
    }
    // ── enregistrement de l'image f ──
    for (let o = 0; o < N; o++) rhoMax = Math.max(rhoMax, rho[o]);
    frames.push(Float32Array.from(rho));
    // centre de masse du nuage en l'air (la caméra le suit)
    { let m = 0, cx = 0, cy = 0, cz = 0; for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const r0 = rho[id(i, j, k)]; if (r0 <= 0) continue; m += r0; cx += r0 * X(i); cy += r0 * Y(j); cz += r0 * Z(k); }
      cent.push(m > 0 ? [cx / m, cy / m, cz / m, m * h * h * h] : [NaN, NaN, NaN, 0]); }
    const vo = f * N * 4;
    for (let o = 0; o < N; o++) {
      rec[vo + o * 4 + 2] = Math.max(0, Math.min(255, Math.round(128 + u[o] * 40)));
      rec[vo + o * 4 + 3] = Math.max(0, Math.min(255, Math.round(128 + v[o] * 40)));
    }
    depRec.set(dep, f * nx * nz);
    for (let gi = 0; gi < G.length; gi++) { const g = G[gi]; gPos.set([g.x, g.y, g.z], (f * grains + gi) * 3); }
    progress?.((f + 1) / F);
  }
  // boîte serrée autour de la fumée visible, par image (le rendu ne marche que là)
  const bbox = new Int16Array(F * 6);
  for (let f = 0; f < F; f++) {
    const fr = frames[f], th = rhoMax * 0.004;
    let a = [nx, ny, nz], b = [-1, -1, -1];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (fr[id(i, j, k)] > th) { a = [Math.min(a[0], i), Math.min(a[1], j), Math.min(a[2], k)]; b = [Math.max(b[0], i), Math.max(b[1], j), Math.max(b[2], k)]; }
    bbox.set(b[0] < 0 ? [0, 0, 0, -1, -1, -1] : [...a, ...b], f * 6);
  }
  // densité normalisée (racine : dynamique des panaches minces) et transmission vers le soleil
  const sd = norm3(sunDir);
  for (let f = 0; f < F; f++) {
    const fr = frames[f], vo = f * N * 4;
    for (let o = 0; o < N; o++) rec[vo + o * 4] = Math.round(255 * Math.sqrt(Math.min(1, fr[o] / rhoMax)));
    // transmission : marche vers le soleil (pas de 1,5 cellule), σ = κ·ρ
    const kap = 2.2 / rhoMax / h;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = id(i, j, k);
      let tau = 0, x = i + 0.5, y = j + 0.5, z = k + 0.5;
      for (let t = 0; t < 22; t++) {
        x += sd[0] * 1.5; y += sd[1] * 1.5; z += sd[2] * 1.5;
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) break;
        const q = id(x | 0, y | 0, z | 0);
        if (solid[q]) { tau += 50; break; }
        tau += fr[q] * kap * 1.5 * h;
      }
      rec[vo + o * 4 + 1] = Math.round(255 * Math.exp(-tau));
    }
  }
  // avant son départ, un grain attend à son point de départ (pas de NaN pour le GPU)
  for (let gi = 0; gi < G.length; gi++) {
    let first = -1;
    for (let f = 0; f < F; f++) if (gPos[(f * grains + gi) * 3] === gPos[(f * grains + gi) * 3]) { first = f; break; }
    for (let f = 0; f < first; f++) gPos.copyWithin((f * grains + gi) * 3, (first * grains + gi) * 3, (first * grains + gi) * 3 + 3);
  }
  // grains : instant de pose (en images), et menés exactement aux germinations du site suivant
  const landS = new Float32Array(G.length), s0s = new Float32Array(G.length);
  G.forEach((g, i) => { landS[i] = g.land >= 0 ? g.land : 9; s0s[i] = g.s0; });
  const corr = new Float32Array(G.length * 2), designated = [];
  const used = new Set();
  for (const sd2 of seeds) {
    const tx = sd2.x + L, tz = sd2.z;
    let best = -1, bd = Infinity;
    G.forEach((g, i) => { if (g.land < 0 || used.has(i) || g.land > 1 + sd2.t - 0.01) return; const d = (g.x - tx) ** 2 + (g.z - tz) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best < 0) continue;
    used.add(best); designated.push(best);
    corr[best * 2] = tx - G[best].x; corr[best * 2 + 1] = tz - G[best].z;
  }
  return {
    domain: Dm, frames: F, rec, bbox, dep: depRec, depMax: Math.max(1e-12, ...dep),
    grains: { pos: gPos, n: grains, count: G.length, land: landS, born: s0s, corr, designated },
    budget: { emitted, deposited, outflow, airborne: mass(rho, solid, h) }, rhoMax, steps: step, centroid: cent.flat(),
  };
}

function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function mass(r, solid, h) { let m = 0; for (let o = 0; o < r.length; o++) if (!solid[o]) m += r[o]; return m * h * h * h; }

function splat(f, x, y, z, val, nx, ny, nz) {
  x -= 0.5; y -= 0.5; z -= 0.5;
  const i0 = Math.floor(x), j0 = Math.floor(y), k0 = Math.floor(z), fx = x - i0, fy = y - j0, fz = z - k0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const i = i0 + a, j = j0 + b, k = k0 + c;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
    f[(k * ny + j) * nx + i] += val * (a ? fx : 1 - fx) * (b ? fy : 1 - fy) * (c ? fz : 1 - fz);
  }
}

// advection semi-lagrangienne (vy − sink : la chute de Stokes pour la densité)
function advect(out, f, u, v, w, solid, nx, ny, nz, h, dt, sink, tri) {
  const k = dt / h;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const o = (z * ny + y) * nx + x;
    if (solid[o]) { out[o] = 0; continue; }
    const bx = x + 0.5 - u[o] * k, by = y + 0.5 - (v[o] - sink) * k, bz = z + 0.5 - w[o] * k;
    // (le vent entre par l'amont : hors du domaine en amont, l'air est propre)
    out[o] = bx < 0 && sink >= 0 && f !== u ? 0 : tri(f, bx, by, bz);
  }
}

function vorticity(u, v, w, solid, nx, ny, nz, h, dt, eps) {
  const N = u.length, ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N), om = new Float32Array(N);
  const g = (f, x, y, z) => f[(Math.min(nz - 1, Math.max(0, z)) * ny + Math.min(ny - 1, Math.max(0, y))) * nx + Math.min(nx - 1, Math.max(0, x))];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const o = (z * ny + y) * nx + x; if (solid[o]) continue;
    const a = (g(w, x, y + 1, z) - g(w, x, y - 1, z) - g(v, x, y, z + 1) + g(v, x, y, z - 1)) / (2 * h);
    const b = (g(u, x, y, z + 1) - g(u, x, y, z - 1) - g(w, x + 1, y, z) + g(w, x - 1, y, z)) / (2 * h);
    const c = (g(v, x + 1, y, z) - g(v, x - 1, y, z) - g(u, x, y + 1, z) + g(u, x, y - 1, z)) / (2 * h);
    ox[o] = a; oy[o] = b; oz[o] = c; om[o] = Math.hypot(a, b, c);
  }
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const o = (z * ny + y) * nx + x; if (solid[o]) continue;
    let Nx = (om[o + 1] - om[o - 1]), Ny = (om[o + nx] - om[o - nx]), Nz = (om[o + nx * ny] - om[o - nx * ny]);
    const l = Math.hypot(Nx, Ny, Nz) + 1e-9; Nx /= l; Ny /= l; Nz /= l;
    u[o] += eps * h * (Ny * oz[o] - Nz * oy[o]) * dt;
    v[o] += eps * h * (Nz * ox[o] - Nx * oz[o]) * dt;
    w[o] += eps * h * (Nx * oy[o] - Ny * ox[o]) * dt;
  }
}

// projection : ∇·u = 0 (Jacobi, Neumann sur le bois et en amont, p = 0 en aval et en haut)
export function project(u, v, w, p, div, p2, solid, nx, ny, nz, h, iters) {
  const S = nx * ny;
  const sv = (f, o, d, ok) => (ok && !solid[o + d] ? f[o + d] : 0);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const o = (z * ny + y) * nx + x; if (solid[o]) { div[o] = 0; continue; }
    // (paroi pleine : vitesse nulle ; bords ouverts : la cellule elle-même)
    const ue = x < nx - 1 ? sv(u, o, 1, true) : u[o], uw = x > 0 ? sv(u, o, -1, true) : u[o];
    const vn = y < ny - 1 ? sv(v, o, nx, true) : v[o], vsd = y > 0 ? sv(v, o, -nx, true) : 0;
    const wf = z < nz - 1 ? sv(w, o, S, true) : w[o], wb = z > 0 ? sv(w, o, -S, true) : w[o];
    div[o] = (ue - uw + vn - vsd + wf - wb) / (2 * h);
  }
  for (let it = 0; it < iters; it++) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const o = (z * ny + y) * nx + x; if (solid[o]) { p2[o] = 0; continue; }
      const nb = (ok, d, dir) => (!ok ? (dir ? 0 : p[o]) : solid[o + d] ? p[o] : p[o + d]);
      const s = nb(x < nx - 1, 1, 1) + nb(x > 0, -1, 0) + nb(y < ny - 1, nx, 1) + nb(y > 0, -nx, 0) + nb(z < nz - 1, S, 0) + nb(z > 0, -S, 0);
      p2[o] = (s - div[o] * h * h) / 6;
    }
    p.set(p2);
  }
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const o = (z * ny + y) * nx + x; if (solid[o]) { u[o] = v[o] = w[o] = 0; continue; }
    const g = (ok, d, dir) => (!ok ? (dir ? 0 : p[o]) : solid[o + d] ? p[o] : p[o + d]);
    u[o] -= (g(x < nx - 1, 1, 1) - g(x > 0, -1, 0)) / (2 * h);
    v[o] -= (g(y < ny - 1, nx, 1) - g(y > 0, -nx, 0)) / (2 * h);
    w[o] -= (g(z < nz - 1, S, 0) - g(z > 0, -S, 0)) / (2 * h);
  }
}

// divergence moyenne (test)
export function meanDivergence(u, v, w, solid, nx, ny, nz, h) {
  let s = 0, n = 0;
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const o = (z * ny + y) * nx + x; if (solid[o] || solid[o + 1] || solid[o - 1] || solid[o + nx] || solid[o - nx] || solid[o + nx * ny] || solid[o - nx * ny]) continue;
    s += Math.abs((u[o + 1] - u[o - 1] + v[o + nx] - v[o - nx] + w[o + nx * ny] - w[o - nx * ny]) / (2 * h)); n++;
  }
  return s / Math.max(1, n);
}
