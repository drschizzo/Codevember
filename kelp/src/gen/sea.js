// La mer (module pur, sans three.js) : équations de Saint-Venant 1D sur le
// profil transversal du platier.
//
//   ∂h/∂t + ∂(hu)/∂x = 0
//   ∂(hu)/∂t + ∂(hu² + g h²/2)/∂x = −g h ∂b/∂x − g n² |u| u / h^{1/3}
//
// Volumes finis du premier ordre, reconstruction hydrostatique d'Audusse et al.
// (2004) — elle garde la mer au repos exactement au repos sur un fond
// quelconque et la hauteur positive, front mouillé-sec compris — et flux HLL
// (les ressauts, c'est-à-dire les vagues déferlées qui courent sur le platier,
// sont des chocs que le schéma capture). Frottement de Manning implicite. Au
// large, un bord générant-absorbant : la vague incidente entre par
// l'invariant de Riemann montant (u + 2c), la vague réfléchie sort librement.
//
// Le forçage (une série de vagues) a la période T de la boucle ; le système
// est dissipatif (frottement, déferlement) : on l'intègre jusqu'à ce que l'état
// à t + T égale l'état à t, puis on enregistre une période.
//
// Axe x : transversal, vers la côte (le large en x < 0). Hauteurs en mètres,
// niveau de la mer au repos y = 0.
export const g = 9.81;

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Le profil moyen du platier : b(x) ─────────────────────────────────────────
// fond du large (depth), tombant (edge), platier qui monte doucement vers la
// côte (shelf : hauteur au bord du platier, slope : pente), gradins éventuels
// (steps : hauteur et pas des marches, pour l'ardoise et le grès)
export function makeProfile(P) {
  const { depth = 1.4, edgeX = -2.6, edgeW = 0.9, shelf = -0.05, slope = 0.07, steps = 0, stepW = 0.8, riseX = 1.5, rise = 0.08, cap = 1.3 } = P;
  return (x) => {
    const t = sst(edgeX - edgeW, edgeX + edgeW * 0.35, x);
    let top = shelf + slope * Math.max(0, x - edgeX) + rise * Math.max(0, x - riseX) ** 2; // (la côte se relève : le jet de rive s'arrête)
    top = top - Math.log1p(Math.exp((top - cap) * 12)) / 12; // (… jusqu'à un haut de platier : minimum adouci)
    if (steps > 0) {
      // marches arrondies : la pente se fait par paliers
      const k = (x - edgeX) / stepW, f = k - Math.floor(k);
      top += steps * (sst(0.7, 0.95, f) - f) * (x > edgeX ? 1 : 0);
    }
    return -depth * (1 - t) + top * t;
  };
}

// ── La série de vagues incidente au large : η_in(t), période T ───────────────
// chaque vague : une crête de hauteur A (largeur temporelle tc) précédée d'un
// creux (la mer qui se retire) de profondeur β·A, d secondes avant
export function makeForcing(waves, T) {
  const one = (w, t) => {
    let s = 0;
    for (let k = -2; k <= 2; k++) { // (copies périodiques)
      const dt = t - w.t - k * T;
      s += w.A * Math.exp(-((dt / w.tc) ** 2)) - w.A * w.beta * Math.exp(-(((dt + w.d) / w.tt) ** 2));
    }
    return s;
  };
  return (t) => { let s = 0; for (const w of waves) s += one(w, t); return s; };
}

// ── Simulation ───────────────────────────────────────────────────────────────
// spec : { profile, waves, T, x0, x1, dx, fps, manning, loops, foam: {k, tau}, dry: λ }
// retour : { nx, x0, dx, nf, fps, T, eta, u, foam, aer, wet, b, stats }
//   eta, u, foam, aer, wet : Float32Array(nf × nx), image f, cellule i en f·nx + i
//   wet : enveloppe de séchage M(x, t) = max(η, M − λ dt) (la roche sous M est mouillée)
export function simulateSea(spec, onProgress = null) {
  const { T, x0 = -9, x1 = 7, dx = 0.025, fps = 60, manning = 0.035, loops = 3, cfl = 0.42 } = spec;
  const prof = makeProfile(spec.profile);
  const forcing = makeForcing(spec.waves, T);
  const film = spec.film ?? 0.04, drain = spec.drain ?? 1.6, drainBelow = spec.drainBelow ?? -0.35;
  const fk = spec.foam?.k ?? 0.25, ftau = spec.foam?.tau ?? 3.2, atau = spec.foam?.aerTau ?? 1.0, lam = spec.dry ?? 0.012;
  const nx = Math.round((x1 - x0) / dx);
  const b = new Float64Array(nx), h = new Float64Array(nx), q = new Float64Array(nx);
  const f = new Float64Array(nx), a = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { b[i] = prof(x0 + (i + 0.5) * dx); h[i] = Math.max(0, -b[i]); }
  const h0 = h[0], c0 = Math.sqrt(g * h0);
  const Fh = new Float64Array(nx + 1), Fq = new Float64Array(nx + 1);
  const SL = new Float64Array(nx + 1), SR = new Float64Array(nx + 1); // (corrections hydrostatiques des deux côtés)
  const P = new Float64Array(nx); // production d'écume
  const n2 = manning * manning;
  const vel = (hh, qq) => (hh > 1e-4 ? Math.max(-9, Math.min(9, qq / hh)) : 0);

  // flux HLL entre deux états reconstruits
  let fh = 0, fq = 0;
  function hll(hL, uL, hR, uR) {
    if (hL <= 0 && hR <= 0) { fh = 0; fq = 0; return; }
    const cL = Math.sqrt(g * hL), cR = Math.sqrt(g * hR);
    let sL, sR;
    if (hL <= 0) { sL = uR - 2 * cR; sR = uR + cR; }
    else if (hR <= 0) { sL = uL - cL; sR = uL + 2 * cL; }
    else { sL = Math.min(uL - cL, uR - cR); sR = Math.max(uL + cL, uR + cR); }
    const fhL = hL * uL, fqL = hL * uL * uL + 0.5 * g * hL * hL;
    const fhR = hR * uR, fqR = hR * uR * uR + 0.5 * g * hR * hR;
    if (sL >= 0) { fh = fhL; fq = fqL; return; }
    if (sR <= 0) { fh = fhR; fq = fqR; return; }
    const k = 1 / (sR - sL);
    fh = (sR * fhL - sL * fhR + sL * sR * (hR - hL)) * k;
    fq = (sR * fqL - sL * fqR + sL * sR * (hR * uR - hL * uL)) * k;
  }

  function step(t, dt) {
    // bord du large : état fantôme par les invariants de Riemann
    const eIn = forcing(t);
    const cIn = Math.sqrt(g * Math.max(0.01, h0 + eIn));
    const Rp = 4 * cIn - 2 * c0;                                // invariant montant de la vague incidente
    const u1 = vel(h[0], q[0]), Rm = u1 - 2 * Math.sqrt(g * h[0]); // invariant descendant, de l'intérieur
    const cg = Math.max(0, (Rp - Rm) / 4), ug = (Rp + Rm) / 2, hg = (cg * cg) / g;
    for (let j = 0; j <= nx; j++) {
      // états de part et d'autre de l'interface j (entre les cellules j−1 et j)
      let hl, ql, bl, hr, qr, br;
      if (j === 0) { hl = hg; ql = hg * ug; bl = b[0]; } else { hl = h[j - 1]; ql = q[j - 1]; bl = b[j - 1]; }
      if (j === nx) { hr = h[nx - 1]; qr = -q[nx - 1]; br = b[nx - 1]; } else { hr = h[j]; qr = q[j]; br = b[j]; }
      const bs = Math.max(bl, br);
      const hls = Math.max(0, hl + bl - bs), hrs = Math.max(0, hr + br - bs);
      const ul = vel(hl, ql), ur = vel(hr, qr);
      hll(hls, ul, hrs, ur);
      Fh[j] = fh; Fq[j] = fq;
      SL[j] = 0.5 * g * (hl * hl - hls * hls); // (pour la cellule de gauche)
      SR[j] = 0.5 * g * (hr * hr - hrs * hrs); // (pour la cellule de droite)
    }
    // écume : un ressaut = une surface raide où l'écoulement converge
    // (production ∝ −∂u/∂x · |∂η/∂x|, calibrée par fk)
    for (let i = 1; i < nx - 1; i++) {
      if (h[i] < 0.004) continue;
      const ul = vel(h[i - 1], q[i - 1]), ur = vel(h[i + 1], q[i + 1]);
      const conv = Math.max(0, ul - ur) / (2 * dx);
      const slope = Math.abs(h[i + 1] + b[i + 1] - h[i - 1] - b[i - 1]) / (2 * dx);
      P[i] = fk * conv * Math.max(0, slope - 0.06);
    }
    const r = dt / dx;
    for (let i = 0; i < nx; i++) {
      h[i] -= r * (Fh[i + 1] - Fh[i]);
      q[i] -= r * (Fq[i + 1] + SL[i + 1] - Fq[i] - SR[i]);
      // une lame d'eau de quelques centimètres sur la roche s'écoule par son
      // relief (fissures, rigoles, cuvettes : ce que le profil moyen ne voit
      // pas) — un puits d'eau qui ne vide que les nappes minces
      if (h[i] < film && b[i] > drainBelow) { const k = Math.exp(-dt * drain * (1 - h[i] / film)); h[i] *= k; q[i] *= k; }
      if (h[i] < 1e-6) { h[i] = 0; q[i] = 0; continue; }
      // frottement de Manning, implicite
      const hc = Math.max(h[i], 0.004);
      q[i] /= 1 + (dt * g * n2 * Math.abs(q[i])) / hc ** (7 / 3);
    }
    // écume (en surface) et bulles (dans l'eau) : production, transport amont, décroissance
    for (let i = 0; i < nx; i++) {
      const u = vel(h[i], q[i]);
      const up = u > 0 ? (i > 0 ? f[i - 1] : 0) : (i < nx - 1 ? f[i + 1] : 0);
      const upa = u > 0 ? (i > 0 ? a[i - 1] : 0) : (i < nx - 1 ? a[i + 1] : 0);
      const cr = Math.min(1, Math.abs(u) * r);
      const dry = h[i] < 0.002;
      f[i] = Math.min(1.5, (f[i] + cr * (up - f[i]) + dt * P[i]) * Math.exp(-dt / (dry ? 0.6 : ftau)));
      a[i] = Math.min(1.0, (a[i] + cr * (upa - a[i]) + 1.0 * dt * P[i]) * Math.exp(-dt / atau));
      if (dry) a[i] = 0;
      P[i] = 0;
    }
  }

  function maxSpeed() {
    let m = 1e-3;
    for (let i = 0; i < nx; i++) if (h[i] > 1e-4) { const s = Math.abs(q[i] / h[i]) + Math.sqrt(g * h[i]); if (s > m) m = s; }
    return Math.min(m, 25);
  }

  // intègre de t0 à t0 + T en s'arrêtant exactement à chaque image (si rec)
  const nf = Math.round(T * fps);
  const eta = new Float32Array(nf * nx), U = new Float32Array(nf * nx), FO = new Float32Array(nf * nx), AE = new Float32Array(nf * nx);
  let steps = 0;
  function runLoop(k, rec) {
    let t = k * T;
    for (let fr = 0; fr < nf; fr++) {
      const tf = k * T + fr / fps;
      while (t < tf - 1e-12) {
        const dt = Math.min((cfl * dx) / maxSpeed(), tf - t);
        step(t, dt);
        t += dt; steps++;
      }
      if (rec) for (let i = 0; i < nx; i++) {
        const o = fr * nx + i;
        eta[o] = h[i] > 1e-4 ? h[i] + b[i] : b[i] - 0.002; U[o] = vel(h[i], q[i]); FO[o] = f[i]; AE[o] = a[i];
      }
      if (onProgress && fr % 60 === 0) onProgress((k + fr / nf) / loops);
    }
    // dernière image : l'état à k·T + T (pour mesurer le raccord)
    while (t < (k + 1) * T - 1e-12) { const dt = Math.min((cfl * dx) / maxSpeed(), (k + 1) * T - t); step(t, dt); t += dt; steps++; }
  }

  const snap = () => ({ h: Float64Array.from(h), q: Float64Array.from(q) });
  let prev = snap(), residual = [];
  for (let k = 0; k < loops; k++) {
    runLoop(k, k === loops - 1);
    const cur = snap();
    let dh = 0, dq = 0;
    for (let i = 0; i < nx; i++) { dh = Math.max(dh, Math.abs(cur.h[i] - prev.h[i])); dq = Math.max(dq, Math.abs(cur.q[i] - prev.q[i])); }
    residual.push([+dh.toFixed(5), +dq.toFixed(5)]);
    prev = cur;
  }

  // enveloppe de séchage, périodique (deux passages sur la boucle enregistrée)
  const wet = new Float32Array(nf * nx), M = new Float64Array(nx).fill(-9);
  const bf = Float32Array.from(b);
  for (let pass = 0; pass < 2; pass++) for (let fr = 0; fr < nf; fr++) for (let i = 0; i < nx; i++) {
    const o = fr * nx + i, e = eta[o] > b[i] ? eta[o] : -9;
    M[i] = Math.max(e, M[i] - lam / fps);
    if (pass) wet[o] = M[i];
  }
  return { nx, x0, dx, nf, fps, T, eta, u: U, foam: FO, aer: AE, wet, b: bf, stats: { steps, residual, h0 } };
}

// lecture d'un champ enregistré en (x, t) : interpolation bilinéaire, t périodique
export function sampleField(S, arr, x, t) {
  const fx = (x - S.x0) / S.dx - 0.5, i0 = Math.max(0, Math.min(S.nx - 2, Math.floor(fx))), wx = Math.max(0, Math.min(1, fx - i0));
  let ft = (t / S.T) * S.nf; ft = ((ft % S.nf) + S.nf) % S.nf;
  const f0 = Math.floor(ft), f1 = (f0 + 1) % S.nf, wt = ft - f0;
  const A = arr[f0 * S.nx + i0] * (1 - wx) + arr[f0 * S.nx + i0 + 1] * wx;
  const B = arr[f1 * S.nx + i0] * (1 - wx) + arr[f1 * S.nx + i0 + 1] * wx;
  return A * (1 - wt) + B * wt;
}
