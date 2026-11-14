// P4 : variante salée du solveur de P0. Eau stratifiée en sel ; équation d'état
// linéaire ρ = ρ0[1 − α(T − Tr) + βS(S − Sr)] ; la glace est douce (S = 0) : une
// maille qui fond donne de l'eau douce ; le sel ne diffuse pas dans la glace.
// κS = κT / Le (Le = 10 par défaut, au lieu de ≈ 100 : la couche limite de sel
// doit rester résolue à 0,5 mm ; le régime reste doublement diffusif).
// Pas d'abaissement du point de fusion par le sel (glace à 0 °C).
//
// Méthode
//  - Navier-Stokes Boussinesq incompressible en (r, z), sans swirl, grille MAC uniforme.
//  - Projection : Poisson axisymétrique résolu par multigrille (V-cycles, Gauss-Seidel rouge-noir).
//  - Glace = milieu poreux de Brinkman, terme -eta*fs^2*u traité implicitement (fs = fraction solide).
//  - Thermique par enthalpie : h = T dans l'eau, h in [-Lc/F, 0] dans la maille de fonte (T = 0).
//    La condition de Stefan est implicite dans le bilan d'énergie de la maille. F gonfle St.
//  - Advection MUSCL (van Leer), diffusion explicite, Euler explicite.
//  - Bords : axe (symétrie), paroi externe, fond et surface en glissement libre et adiabatiques ;
//    une couronne éponge (r > R - wSponge) rappelle T vers T∞ (réservoir infini).
//  - Support : mailles solides isolantes qui ne fondent pas.

export const PHYS = {
  g: 9.81, beta: 8e-6, Ts: 4.0, nu: 1.7e-6, kappa: 1.4e-7,
  Lc: (917 * 334000) / (1000 * 4200), // chaleur latente par volume de glace / (rho_w cp), en °C
};

function vl(a, b) { const p = a * b; return p > 0 ? (2 * p) / (a + b) : 0; }

export class Sim {
  constructor(o) {
    this.o = o;
    const dx = o.dx;
    const nr = Math.round(o.R / dx), nz = Math.round(o.Z / dx);
    const NR = nr + 4, NZ = nz + 4, N = NR * NZ;
    Object.assign(this, { dx, nr, nz, NR, NZ, N });
    this.Tinf = o.Tinf;
    this.F = o.F;
    this.Lce = PHYS.Lc / o.F;
    this.eta = o.eta ?? 1e6;
    this.nV = o.nV ?? 2;
    const A = () => new Float64Array(N);
    this.S = A(); this.fSr = A(); this.fSz = A(); this.Sinf = new Float64Array(nz);
    this.h = A(); this.T = A(); this.fs = A(); this.u = A(); this.w = A();
    this.u2 = A(); this.w2 = A(); this.b = A(); this.fr = A(); this.fz = A();
    this.cr = A(); this.cz = A();
    this.sup = new Uint8Array(N);
    this.ice0 = new Uint8Array(N);
    this.rc = new Float64Array(nr); this.rf = new Float64Array(nr); this.rfm = new Float64Array(nr);
    for (let i = 0; i < nr; i++) { this.rc[i] = (i + 0.5) * dx; this.rf[i] = (i + 1) * dx; this.rfm[i] = i * dx; }
    // éponge
    // éponge : couronne externe, plus tranches basse et haute si demandées (o.spongeZ = {bottom, top})
    this.sig = new Float64Array(N);
    const ws = o.wSponge ?? 0.008, smax = o.sponge ?? 0.5, sz = o.spongeZ ?? { bottom: true, top: true };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const z = (j + 0.5) * dx;
      let s = Math.max(0, (this.rc[i] - (o.R - ws)) / ws);
      if (sz.bottom) s = Math.max(s, (ws - z) / ws);
      if (sz.top) s = Math.max(s, (z - (o.Z - ws)) / ws);
      this.sig[this.id(i, j)] = smax * s * s;
    }
    // géométrie
    const g = o.geom; // {a, z0, z1, sup: [{r, z0, z1}]}
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = this.id(i, j), r = this.rc[i], z = (j + 0.5) * dx;
      let isSup = false;
      for (const s of g.sup) if (r < s.r && z > s.z0 && z < s.z1) isSup = true;
      if (isSup) { this.sup[k] = 1; this.fs[k] = 1; this.h[k] = -this.Lce; this.T[k] = 0; continue; }
      if (r < g.a && z > g.z0 && z < g.z1) { this.h[k] = -this.Lce; this.fs[k] = 1; this.T[k] = 0; this.ice0[k] = 1; }
      else { this.h[k] = o.Tinf; this.T[k] = o.Tinf; }
    }
    // sel : profil lointain S∞(z), glace douce
    for (let j = 0; j < nz; j++) {
      const z = (j + 0.5) * dx;
      this.Sinf[j] = o.Sbot + (o.Stop - o.Sbot) * z / o.Z;
      for (let i = 0; i < nr; i++) { const k = this.id(i, j); this.S[k] = this.fs[k] > 0 ? 0 : this.Sinf[j]; }
    }
    // conductances (0 à travers un support)
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = this.id(i, j);
      if (i < nr - 1) this.cr[k] = this.sup[k] || this.sup[k + 1] ? 0 : 1;
      if (j < nz - 1) this.cz[k] = this.sup[k] || this.sup[k + NR] ? 0 : 1;
    }
    this.dt = o.dt ?? (o.cfl0 ?? 0.16) * dx * dx / PHYS.nu;
    this.t = 0; this.nstep = 0;
    this.buildMG();
    this.V0 = this.iceVolume();
  }
  id(i, j) { return (j + 2) * this.NR + i + 2; }

  // ---------- ghosts ----------
  fillCell(f) {
    const { nr, nz, NR } = this;
    for (let j = 0; j < nz; j++) {
      const k = (j + 2) * NR + 2;
      f[k - 1] = f[k]; f[k - 2] = f[k + 1];
      f[k + nr] = f[k + nr - 1]; f[k + nr + 1] = f[k + nr - 2];
    }
    for (let I = 0; I < NR; I++) {
      f[NR + I] = f[2 * NR + I]; f[I] = f[3 * NR + I];
      const t = (nz + 1) * NR + I;
      f[t + NR] = f[t]; f[t + 2 * NR] = f[t - NR];
    }
  }
  fillU(u) {
    const { nr, nz, NR } = this;
    for (let j = 0; j < nz; j++) {
      const k = (j + 2) * NR + 2;
      u[k + nr - 1] = 0;
      u[k - 1] = 0; u[k - 2] = -u[k];
      u[k + nr] = -u[k + nr - 2]; u[k + nr + 1] = -u[k + nr - 3];
    }
    for (let I = 0; I < NR; I++) {
      u[NR + I] = u[2 * NR + I]; u[I] = u[3 * NR + I];
      const t = (nz + 1) * NR + I;
      u[t + NR] = u[t]; u[t + 2 * NR] = u[t - NR];
    }
  }
  fillW(w) {
    const { nr, nz, NR } = this;
    for (let i = 0; i < nr; i++) {
      const I = i + 2;
      w[(nz + 1) * NR + I] = 0; // paroi haute
      w[NR + I] = 0; w[I] = -w[2 * NR + I];
      w[(nz + 2) * NR + I] = -w[nz * NR + I]; w[(nz + 3) * NR + I] = -w[(nz - 1) * NR + I];
    }
    for (let J = 0; J < this.NZ; J++) {
      const k = J * NR + 2;
      w[k - 1] = w[k]; w[k - 2] = w[k + 1];
      w[k + nr] = w[k + nr - 1]; w[k + nr + 1] = w[k + nr - 2];
    }
  }

  // ---------- multigrille ----------
  buildMG() {
    const L = [];
    let n = this.nr, m = this.nz, H = this.dx;
    for (;;) {
      const P = n + 2, S = P * (m + 2);
      const lv = { n, m, H, P, x: new Float64Array(S), b: new Float64Array(S), r: new Float64Array(S),
        cE: new Float64Array(n), cW: new Float64Array(n), cN: new Float64Array(m), cS: new Float64Array(m), ri: new Float64Array(n) };
      for (let i = 0; i < n; i++) {
        const rc = (i + 0.5) * H;
        lv.ri[i] = rc;
        lv.cE[i] = i < n - 1 ? (i + 1) * H / (rc * H * H) : 0;
        lv.cW[i] = i > 0 ? i * H / (rc * H * H) : 0;
      }
      for (let j = 0; j < m; j++) { lv.cN[j] = j < m - 1 ? 1 / (H * H) : 0; lv.cS[j] = j > 0 ? 1 / (H * H) : 0; }
      L.push(lv);
      if (n % 2 || m % 2 || n < 8 || m < 8) break;
      n /= 2; m /= 2; H *= 2;
    }
    this.mg = L;
  }
  smooth(lv, sweeps) {
    const { n, m, P, x, b, cE, cW, cN, cS } = lv;
    for (let s = 0; s < sweeps; s++) for (let c = 0; c < 2; c++) {
      for (let j = 0; j < m; j++) {
        const cn = cN[j], cs = cS[j];
        for (let i = (j + c) & 1; i < n; i += 2) {
          const k = (j + 1) * P + i + 1;
          const ce = cE[i], cw = cW[i];
          x[k] = (ce * x[k + 1] + cw * x[k - 1] + cn * x[k + P] + cs * x[k - P] - b[k]) / (ce + cw + cn + cs);
        }
      }
    }
  }
  resid(lv) {
    const { n, m, P, x, b, r, cE, cW, cN, cS } = lv;
    let mx = 0;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const k = (j + 1) * P + i + 1;
      const Ax = cE[i] * (x[k + 1] - x[k]) + cW[i] * (x[k - 1] - x[k]) + cN[j] * (x[k + P] - x[k]) + cS[j] * (x[k - P] - x[k]);
      r[k] = b[k] - Ax;
      const a = Math.abs(r[k]); if (a > mx) mx = a;
    }
    return mx;
  }
  vcycle(l) {
    const lv = this.mg[l];
    if (l === this.mg.length - 1) {
      // compatibilité (moyenne pondérée nulle)
      let s = 0, sw = 0;
      for (let j = 0; j < lv.m; j++) for (let i = 0; i < lv.n; i++) { s += lv.b[(j + 1) * lv.P + i + 1] * lv.ri[i]; sw += lv.ri[i]; }
      s /= sw;
      for (let j = 0; j < lv.m; j++) for (let i = 0; i < lv.n; i++) lv.b[(j + 1) * lv.P + i + 1] -= s;
      this.smooth(lv, 60);
      return;
    }
    this.smooth(lv, 2);
    this.resid(lv);
    const c = this.mg[l + 1];
    for (let J = 0; J < c.m; J++) for (let I = 0; I < c.n; I++) {
      let s = 0, sw = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const i = 2 * I + di, j = 2 * J + dj;
        s += lv.r[(j + 1) * lv.P + i + 1] * lv.ri[i]; sw += lv.ri[i];
      }
      const kc = (J + 1) * c.P + I + 1;
      c.b[kc] = s / sw; c.x[kc] = 0;
    }
    this.vcycle(l + 1);
    // prolongation bilinéaire (fantômes du grossier en miroir = Neumann)
    const { x: xc, P: Pc, n: nc, m: mc } = c;
    for (let J = 0; J < mc; J++) { const k = (J + 1) * Pc; xc[k] = xc[k + 1]; xc[k + nc + 1] = xc[k + nc]; }
    for (let I = 0; I < nc + 2; I++) { xc[I] = xc[Pc + I]; xc[(mc + 1) * Pc + I] = xc[mc * Pc + I]; }
    for (let j = 0; j < lv.m; j++) {
      const J = j >> 1, oj = j & 1 ? 1 : -1;
      for (let i = 0; i < lv.n; i++) {
        const I = i >> 1, oi = i & 1 ? 1 : -1;
        const kc = (J + 1) * Pc + I + 1;
        const v = 0.5625 * xc[kc] + 0.1875 * (xc[kc + oi] + xc[kc + oj * Pc]) + 0.0625 * xc[kc + oi + oj * Pc];
        lv.x[(j + 1) * lv.P + i + 1] += v;
      }
    }
    this.smooth(lv, 2);
  }

  project() {
    const { nr, nz, NR, dx, u, w, rc, rf, rfm } = this;
    const lv = this.mg[0], P = lv.P, b = lv.b, x = lv.x;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = (j + 2) * NR + i + 2;
      const um = i > 0 ? u[k - 1] : 0, wm = j > 0 ? w[k - NR] : 0;
      b[(j + 1) * P + i + 1] = (rf[i] * u[k] - rfm[i] * um) / (rc[i] * dx) + (w[k] - wm) / dx;
    }
    for (let c = 0; c < this.nV; c++) this.vcycle(0);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = (j + 2) * NR + i + 2, q = (j + 1) * P + i + 1;
      if (i < nr - 1) u[k] -= (x[q + 1] - x[q]) / dx;
      if (j < nz - 1) w[k] -= (x[q + P] - x[q]) / dx;
    }
  }
  divergence() {
    const { nr, nz, NR, dx, u, w, rc, rf, rfm } = this;
    let mx = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = (j + 2) * NR + i + 2;
      const um = i > 0 ? u[k - 1] : 0, wm = j > 0 ? w[k - NR] : 0;
      const d = Math.abs((rf[i] * u[k] - rfm[i] * um) / (rc[i] * dx) + (w[k] - wm) / dx);
      if (d > mx) mx = d;
    }
    return mx;
  }

  step() {
    const { nr, nz, NR, dx, T, fs, h, b, sup, rc, rf, rfm, cr, cz, sig } = this;
    const dt = this.dt, nu = PHYS.nu, kap = PHYS.kappa, eta = this.eta, dx2 = dx * dx;
    const gb = PHYS.g * PHYS.beta, Ts = PHYS.Ts, Tinf = this.Tinf, bref = (Tinf - Ts) * (Tinf - Ts);
    let u = this.u, w = this.w;
    const u2 = this.u2, w2 = this.w2;
    this.fillCell(T); this.fillU(u); this.fillW(w);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = (j + 2) * NR + i + 2;
      b[k] = PHYS.g * (this.o.alpha * (T[k] - Tinf) - this.o.betaS * (this.S[k] - this.Sinf[j]));
    }
    // ---- quantité de mouvement radiale (faces i+1/2)
    for (let j = 0; j < nz; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr - 1; i++) {
        const k = base + i, uc = u[k];
        const az = 0.25 * (w[k] + w[k + 1] + w[k - NR] + w[k + 1 - NR]);
        let dr, dz;
        if (uc >= 0) dr = (uc + 0.5 * vl(uc - u[k - 1], u[k + 1] - uc)) - (u[k - 1] + 0.5 * vl(u[k - 1] - u[k - 2], uc - u[k - 1]));
        else dr = (u[k + 1] - 0.5 * vl(u[k + 2] - u[k + 1], u[k + 1] - uc)) - (uc - 0.5 * vl(u[k + 1] - uc, uc - u[k - 1]));
        if (az >= 0) dz = (uc + 0.5 * vl(uc - u[k - NR], u[k + NR] - uc)) - (u[k - NR] + 0.5 * vl(u[k - NR] - u[k - 2 * NR], uc - u[k - NR]));
        else dz = (u[k + NR] - 0.5 * vl(u[k + 2 * NR] - u[k + NR], u[k + NR] - uc)) - (uc - 0.5 * vl(u[k + NR] - uc, uc - u[k - NR]));
        const r = rf[i];
        const lap = (rc[i + 1] * (u[k + 1] - uc) - rc[i] * (uc - u[k - 1])) / r + (u[k + NR] - 2 * uc + u[k - NR]);
        const f = 0.5 * (fs[k] + fs[k + 1]);
        u2[k] = (uc + dt * (-(uc * dr + az * dz) / dx + nu * (lap / dx2 - uc / (r * r)))) / (1 + dt * eta * f * f);
      }
    }
    // ---- quantité de mouvement axiale (faces j+1/2)
    for (let j = 0; j < nz - 1; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr; i++) {
        const k = base + i, wc = w[k];
        const ar = 0.25 * (u[k] + u[k - 1] + u[k + NR] + u[k + NR - 1]);
        let dr, dz;
        if (ar >= 0) dr = (wc + 0.5 * vl(wc - w[k - 1], w[k + 1] - wc)) - (w[k - 1] + 0.5 * vl(w[k - 1] - w[k - 2], wc - w[k - 1]));
        else dr = (w[k + 1] - 0.5 * vl(w[k + 2] - w[k + 1], w[k + 1] - wc)) - (wc - 0.5 * vl(w[k + 1] - wc, wc - w[k - 1]));
        if (wc >= 0) dz = (wc + 0.5 * vl(wc - w[k - NR], w[k + NR] - wc)) - (w[k - NR] + 0.5 * vl(w[k - NR] - w[k - 2 * NR], wc - w[k - NR]));
        else dz = (w[k + NR] - 0.5 * vl(w[k + 2 * NR] - w[k + NR], w[k + NR] - wc)) - (wc - 0.5 * vl(w[k + NR] - wc, wc - w[k - NR]));
        const lap = (rf[i] * (w[k + 1] - wc) - rfm[i] * (wc - w[k - 1])) / rc[i] + (w[k + NR] - 2 * wc + w[k - NR]);
        const f = 0.5 * (fs[k] + fs[k + NR]);
        w2[k] = (wc + dt * (-(ar * dr + wc * dz) / dx + nu * lap / dx2 + 0.5 * (b[k] + b[k + NR]))) / (1 + dt * eta * f * f);
      }
    }
    this.u = u2; this.u2 = u; this.w = w2; this.w2 = w;
    u = this.u; w = this.w;
    this.project();
    // ---- enthalpie
    const fr = this.fr, fz = this.fz;
    for (let j = 0; j < nz; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr; i++) {
        const k = base + i;
        if (i < nr - 1) {
          const uf = u[k];
          const Tf = uf >= 0 ? T[k] + 0.5 * vl(T[k] - T[k - 1], T[k + 1] - T[k]) : T[k + 1] - 0.5 * vl(T[k + 2] - T[k + 1], T[k + 1] - T[k]);
          fr[k] = rf[i] * (uf * Tf - kap * cr[k] * (T[k + 1] - T[k]) / dx);
        }
        if (j < nz - 1) {
          const wf = w[k];
          const Tf = wf >= 0 ? T[k] + 0.5 * vl(T[k] - T[k - NR], T[k + NR] - T[k]) : T[k + NR] - 0.5 * vl(T[k + 2 * NR] - T[k + NR], T[k + NR] - T[k]);
          fz[k] = wf * Tf - kap * cz[k] * (T[k + NR] - T[k]) / dx;
        }
      }
    }
    const Lce = this.Lce;
    // bruit thermique ambiant optionnel (germe d'instabilités convectives), amplitude o.noise en °C/sqrt(s)
    const na = (this.o.noise ?? 0) * Math.sqrt(dt);
    let seed = this.seed ?? 12345;
    for (let j = 0; j < nz; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr; i++) {
        const k = base + i;
        if (sup[k]) continue;
        let hn = h[k] - dt * ((fr[k] - fr[k - 1]) / (rc[i] * dx) + (fz[k] - fz[k - NR]) / dx);
        if (hn > 0 && sig[k] > 0) hn += dt * sig[k] * (Tinf - hn);
        if (na > 0 && hn > 0) { seed = (seed * 1664525 + 1013904223) >>> 0; hn += na * (seed / 4294967296 - 0.5); }
        h[k] = hn;
        if (hn >= 0) { T[k] = hn; fs[k] = 0; }
        else { T[k] = 0; fs[k] = hn <= -Lce ? 1 : -hn / Lce; }
      }
    }
    this.seed = seed;
    // ---- sel (flux nuls à travers une face qui touche de la glace pleine)
    const S = this.S, fSr = this.fSr, fSz = this.fSz, kS = PHYS.kappa / (this.o.Le ?? 10);
    this.fillCell(S);
    for (let j = 0; j < nz; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr; i++) {
        const k = base + i;
        if (i < nr - 1) {
          const open = fs[k] < 0.99 && fs[k + 1] < 0.99 ? 1 : 0, uf = u[k];
          const Sf = uf >= 0 ? S[k] + 0.5 * vl(S[k] - S[k - 1], S[k + 1] - S[k]) : S[k + 1] - 0.5 * vl(S[k + 2] - S[k + 1], S[k + 1] - S[k]);
          fSr[k] = open * rf[i] * (uf * Sf - kS * (S[k + 1] - S[k]) / dx);
        }
        if (j < nz - 1) {
          const open = fs[k] < 0.99 && fs[k + NR] < 0.99 ? 1 : 0, wf = w[k];
          const Sf = wf >= 0 ? S[k] + 0.5 * vl(S[k] - S[k - NR], S[k + NR] - S[k]) : S[k + NR] - 0.5 * vl(S[k + 2 * NR] - S[k + NR], S[k + NR] - S[k]);
          fSz[k] = open * (wf * Sf - kS * (S[k + NR] - S[k]) / dx);
        }
      }
    }
    for (let j = 0; j < nz; j++) {
      const base = (j + 2) * NR + 2;
      for (let i = 0; i < nr; i++) {
        const k = base + i;
        if (sup[k] || fs[k] >= 0.99) continue;
        let sn = S[k] - dt * ((fSr[k] - (i > 0 ? fSr[k - 1] : 0)) / (rc[i] * dx) + (fSz[k] - (j > 0 ? fSz[k - NR] : 0)) / dx);
        if (sig[k] > 0) sn += dt * sig[k] * (this.Sinf[j] - sn);
        S[k] = sn;
      }
    }
    this.t += dt; this.nstep++;
  }

  iceVolume() {
    const { nr, nz, fs, sup, rc, dx } = this;
    let v = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = this.id(i, j);
      if (!sup[k]) v += fs[k] * 2 * Math.PI * rc[i] * dx * dx;
    }
    return v;
  }
  // rayon équivalent (volume) de la glace par rangée
  profile() {
    const { nr, nz, fs, sup, rc, dx } = this;
    const out = new Float64Array(nz);
    for (let j = 0; j < nz; j++) {
      let s = 0;
      for (let i = 0; i < nr; i++) { const k = this.id(i, j); if (!sup[k]) s += fs[k] * rc[i] * dx; }
      out[j] = Math.sqrt(2 * s);
    }
    return out;
  }
  maxVel() {
    const { nr, nz, u, w, fs } = this;
    let mx = 0, mi = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nr; i++) {
      const k = this.id(i, j), v = Math.max(Math.abs(u[k]), Math.abs(w[k]));
      if (fs[k] >= 1) { if (v > mi) mi = v; } else if (v > mx) mx = v;
    }
    return { umax: mx, uice: mi };
  }
  // fonction de courant de Stokes aux centres
  streamfunction() {
    const { nr, nz, NR, w, rc, dx } = this;
    const psi = new Float64Array(nr * nz);
    for (let j = 0; j < nz; j++) {
      let acc = 0;
      for (let i = 0; i < nr; i++) {
        const k = (j + 2) * NR + i + 2;
        const wc = 0.5 * (w[k] + (j > 0 ? w[k - NR] : 0));
        psi[j * nr + i] = acc + 0.5 * rc[i] * wc * dx;
        acc += rc[i] * wc * dx;
      }
    }
    return psi;
  }
}
