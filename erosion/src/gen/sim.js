// Simulation de référence (processeur) : eau peu profonde par tuyaux
// virtuels, transport de sédiments, effondrement des talus. Même algorithme,
// mêmes passes, mêmes constantes que la version GPU (scene/gpusim.js) : celle-
// ci sert aux tests, aux réglages dans Node et à l'écran de chargement.
//
// Références : O'Brien et Hodgins 1995 (tuyaux virtuels) ; Mei, Decaudin et
// Hu 2007, « Fast hydraulic erosion simulation and visualization on GPU » ;
// Šťava et al. 2008 ; frottement de Manning ; facteur d'accélération
// morphologique (MORFAC) de Lesser et al. 2004.
//
// Champs par cellule : b (lit, m), d (eau, m), s (sédiment en suspension, m
// de sable), fL fR fT fB (flux sortants, m³/s), vx vy (vitesse, m/s),
// bmin (le plus bas jamais atteint : au-dessus, c'est un dépôt).
import { TABLE, hardnessAt, inflowAt, rainAt, baseAt, fbm } from './table.js';

export const PHYS = {
  g: 9.81,
  manning: 0.022,      // rugosité de Manning (sable fin)
  dWet: 2e-5,          // en dessous : cellule sèche
  vMax: 1.2,           // plafond de vitesse (m/s)
  Kc: 200,            // capacité : s_eq = Kc·(τ − τc)^1,5 (Meyer-Peter–Müller), τ = d·S en m
  tauC: 1.5e-5,        // seuil de Shields : θc·(ρs/ρ − 1)·D ≈ 0,05 · 1,65 · 0,18 mm (sable fin)
  Ks: 2,               // taux d'arrachement (1/s)
  ws: 0.02,            // vitesse de chute du sable fin (m/s) : dépôt au taux ws/d
  hetero: 0.35,        // hétérogénéité du tassement (érodabilité ×(1 ± …), cellules de ~3 cm)
  eMax: 0.00002,       // érosion maximale par pas (m, après MORFAC)
  dVel: 0.0008,        // profondeur plancher pour estimer la vitesse (lames minces)
  talusWet: Math.tan((30 * Math.PI) / 180),  // sable immergé
  talusDamp: Math.tan((62 * Math.PI) / 180), // sable humide (cohésion capillaire)
  talusRate: 0.25,     // part de l'excès redistribuée par pas
  diffuse: 1e-6,       // diffusion du lit mouillé (m²/s, temps morphologique)
  tDry: 6,             // mémoire de l'humidité (s) : le sable reste sombre après le passage de l'eau
  kRip: 4000,          // cumul du cisaillement → amplitude des rides de courant (0–1)
  courant: 0.55,       // dt = courant · l / (1 m/s)
};

export function createSim({ NX, NY, b0, strata, S }) {
  const N = NX * NY, l = TABLE.Lx / NX, A = l * l, P = PHYS;
  const dt = P.courant * l;
  const b = Float32Array.from(b0), bmin = Float32Array.from(b0), bN = new Float32Array(N);
  const d = new Float32Array(N), s = new Float32Array(N), s2 = new Float32Array(N), conc = new Float32Array(N);
  const fL = new Float32Array(N), fR = new Float32Array(N), fT = new Float32Array(N), fB = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), wet = new Float32Array(N), rip = new Float32Array(N);
  const tOut = new Float32Array(N * 8);
  // source : une tache gaussienne sous la lèvre de la boîte d'alimentation
  const srcW = new Float32Array(N);
  if (S.src) {
    let sum = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * l, y = (j + 0.5) * l;
      const w = Math.exp(-(((x - S.src.x) / 0.012) ** 2) - (((y - S.src.y) / (S.src.w / 2)) ** 2) * 1.5);
      srcW[j * NX + i] = w > 0.02 ? w : 0; sum += srcW[j * NX + i];
    }
    for (let i = 0; i < N; i++) srcW[i] /= sum * A; // (∑ srcW·A = 1 : le débit entier entre)
  }
  // pluie : bande en x, un peu irrégulière en travers
  const rainW = new Float32Array(N);
  if (S.rain) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = (i + 0.5) * l;
    rainW[j * NX + i] = x >= S.rain.x0 && x <= S.rain.x1 ? 1 : 0;
  }
  // tassement inégal du sable (érodabilité) : bruit à ~3 cm, tiré de la graine
  const erod = new Float32Array(N);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) erod[j * NX + i] = 1 + P.hetero * fbm((i + 0.5) * l * 30, (j + 0.5) * l * 30, (S.seed ?? 1) + 555, 3) * 1.4;
  const OUT = NX - 2; // (deux dernières colonnes : le déversoir)
  const st = { T: 0, steps: 0, outWater: 0, inWater: 0, outSand: 0 };

  function step() {
    const T = st.T, q = inflowAt(S, T), r = rainAt(S, T), L = baseAt(S, T), MF = S.morfac;
    // 1. sources et déversoir, puis flux (tuyaux virtuels, frottement de Manning)
    for (let i = 0; i < N; i++) {
      const add = (q * srcW[i] + r * rainW[i]) * dt;
      d[i] += add; st.inWater += add * A;
    }
    for (let j = 0; j < NY; j++) for (let i = OUT; i < NX; i++) {
      const c = j * NX + i, want = Math.max(0, L - b[c]);
      st.outWater += (d[c] - want) * A; d[c] = want; st.outSand += s[c] * A; s[c] = 0;
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = j * NX + i, h = b[c] + d[c];
      if (d[c] < P.dWet) { fL[c] = fR[c] = fT[c] = fB[c] = 0; continue; }
      const vm = Math.hypot(vx[c], vy[c]);
      const kf = P.g * P.manning * P.manning * vm / Math.pow(Math.max(d[c], 1e-4), 4 / 3);
      const damp = 1 / (1 + dt * kf);
      const flow = (f, n) => (n < 0 ? 0 : Math.max(0, (f + dt * A * P.g * (h - b[n] - d[n]) / l) * damp));
      let a = flow(fL[c], i > 0 ? c - 1 : -1), e = flow(fR[c], i < NX - 1 ? c + 1 : -1);
      let t = flow(fT[c], j > 0 ? c - NX : -1), u = flow(fB[c], j < NY - 1 ? c + NX : -1);
      const sum = a + e + t + u;
      const K = sum > 0 ? Math.min(1, (d[c] * A) / (sum * dt)) : 0;
      fL[c] = a * K; fR[c] = e * K; fT[c] = t * K; fB[c] = u * K;
    }
    // 2. transport du sédiment, porté par les flux d'eau eux-mêmes (conservatif :
    //    une cellule cède la part de son sable que porte l'eau qui sort)
    for (let c = 0; c < N; c++) conc[c] = d[c] > P.dWet ? s[c] / d[c] : 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      const inL = i > 0 ? fR[c - 1] * conc[c - 1] : 0, inR = i < NX - 1 ? fL[c + 1] * conc[c + 1] : 0;
      const inT = j > 0 ? fB[c - NX] * conc[c - NX] : 0, inB = j < NY - 1 ? fT[c + NX] * conc[c + NX] : 0;
      s2[c] = Math.max(0, s[c] + (dt * (inL + inR + inT + inB - conc[c] * (fL[c] + fR[c] + fT[c] + fB[c]))) / A);
    }
    s.set(s2);
    // 3. hauteur d'eau et vitesse
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      const inL = i > 0 ? fR[c - 1] : 0, inR = i < NX - 1 ? fL[c + 1] : 0, inT = j > 0 ? fB[c - NX] : 0, inB = j < NY - 1 ? fT[c + NX] : 0;
      const d0 = d[c], d1 = Math.max(0, d0 + dt * (inL + inR + inT + inB - fL[c] - fR[c] - fT[c] - fB[c]) / A);
      d[c] = d1;
      const dm = (d0 + d1) / 2;
      if (dm < P.dWet) { vx[c] = vy[c] = 0; continue; }
      const dv = Math.max(dm, P.dVel);
      let ux = (inL - fL[c] + fR[c] - inR) / 2 / (dv * l), uy = (inT - fT[c] + fB[c] - inB) / 2 / (dv * l);
      const m = Math.hypot(ux, uy);
      if (m > P.vMax) { ux *= P.vMax / m; uy *= P.vMax / m; }
      vx[c] = ux; vy[c] = uy;
    }
    // 4. arrachement et dépôt, et diffusion du lit sous l'eau (la charge de fond
    //    roule vers le bas des pentes : elle efface le bruit d'une cellule)
    //    — lit b → bN (lecture de l'ancien lit seulement, comme sur le GPU)
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      bN[c] = b[c];
      if (i < 1 || i >= OUT || j < 1 || j >= NY - 1) continue;
      // diffusion : coefficient d'arête symétrique (conservatif), là où l'eau coule
      const wc = d[c] >= P.dWet ? 1 : 0;
      let lap = 0;
      for (const n of [c - 1, c + 1, c - NX, c + NX]) {
        const ni = n % NX, nj = (n / NX) | 0;
        if (ni < 1 || ni >= OUT || nj < 1 || nj >= NY - 1) continue;
        lap += 0.5 * (wc + (d[n] >= P.dWet ? 1 : 0)) * (b[n] - b[c]);
      }
      bN[c] += Math.min(0.2, (P.diffuse * dt * MF) / A) * lap;
      wet[c] = d[c] >= P.dWet ? 1 : wet[c] * Math.exp(-dt / P.tDry);
      if (d[c] < P.dWet) { if (s[c] > 0) { bN[c] += s[c] * MF; s[c] = 0; } continue; } // (l'eau partie, son sable reste)
      // cisaillement au fond par le frottement de Manning, en hauteur équivalente
      // (τ/ρg = n²·v²/d^⅓ ; en régime établi c'est d·S) : robuste aux ondes du lac
      const vm = Math.hypot(vx[c], vy[c]);
      const tau = (P.manning * P.manning * vm * vm) / Math.cbrt(Math.max(d[c], 0.001));
      const C = P.Kc * Math.max(0, tau - P.tauC) ** 1.5;
      rip[c] = Math.min(1, rip[c] + P.kRip * Math.max(0, tau - P.tauC) * dt);
      if (s[c] < C) {
        const hard = b[c] > bmin[c] + 0.0002 ? 0 : hardnessAt(strata, b0[c] - b[c]);
        // (sous plus de 2 cm d'eau, la vitesse moyenne surestime le cisaillement au fond : un lac n'arrache plus son fond)
        const deep = 1 - Math.min(1, Math.max(0, (d[c] - 0.012) / 0.01));
        const e = Math.min(P.eMax / MF, P.Ks * (1 - hard) * erod[c] * deep * (C - s[c]) * dt);
        bN[c] -= e * MF; s[c] += e;
      } else {
        const e = (s[c] - C) * Math.min(1, (P.ws * dt) / Math.max(d[c], 0.001));
        bN[c] += e * MF; s[c] -= e;
      }
    }
    // 5. talus : la part au-delà de l'angle de repos glisse vers les voisins plus bas
    const D8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]];
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < OUT; i++) {
      const c = j * NX + i, tan = d[c] > 0.0005 ? P.talusWet : P.talusDamp;
      let tot = 0, mx = 0;
      for (let k = 0; k < 8; k++) {
        const ni = i + D8[k][0], nj = j + D8[k][1], n = nj * NX + ni, dist = k < 4 ? l : l * Math.SQRT2;
        const inside = ni >= 1 && ni < OUT && nj >= 1 && nj < NY - 1;
        const ex = inside ? Math.max(0, bN[c] - bN[n] - tan * dist) : 0;
        tOut[c * 8 + k] = ex; tot += ex; if (ex > mx) mx = ex;
      }
      const move = (P.talusRate * mx) / 2, f = tot > 0 ? move / tot : 0;
      for (let k = 0; k < 8; k++) tOut[c * 8 + k] *= f;
    }
    b.set(bN);
    for (let j = 1; j < NY - 1; j++) for (let i = 1; i < OUT; i++) {
      const c = j * NX + i;
      let delta = 0;
      for (let k = 0; k < 8; k++) {
        delta -= tOut[c * 8 + k];
        const n = c + D8[k][0] + D8[k][1] * NX, ni = n % NX, nj = (n / NX) | 0;
        if (ni >= 1 && ni < OUT && nj >= 1 && nj < NY - 1) delta += tOut[n * 8 + (k ^ 1)];
      }
      b[c] = bN[c] + delta;
      if (b[c] < bmin[c]) bmin[c] = b[c];
    }
    st.T += dt; st.steps++;
  }
  // (k ^ 1 : la direction opposée — les paires de D8 sont rangées (−, +))

  return {
    NX, NY, l, dt, b, d, s, vx, vy, bmin, wet, rip, b0, st,
    step,
    // avance jusqu'au temps hydraulique T
    runTo(T, onStep) { while (st.T < T) { step(); onStep?.(st); } },
    sandVolume() { let v = 0; for (let i = 0; i < N; i++) v += b[i] + s[i] * S.morfac; return v * A; },
    waterVolume() { let v = 0; for (let i = 0; i < N; i++) v += d[i]; return v * A; },
  };
}
