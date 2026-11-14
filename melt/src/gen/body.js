// Le fuseau libéré : un corps de glace de révolution (le profil relevé par
// lake.js au détachement) remonte, bascule et se couche à la surface, puis la
// brise l'emporte. Prototype : proto/p2.
//
// Corps rigide dans le plan vertical de basculement (x, y, θ), θ = angle de
// l'axe avec la verticale (horaire), plus la dérive horizontale (le long de la
// brise, hors du plan) :
//  - poussée d'Archimède exacte par tranches : chaque disque est coupé par le
//    plan d'eau y = 0 ; volume immergé = segment de disque, centre de poussée
//    = centroïde du segment ;
//  - masse ajoutée (Ca = 0,5), inertie ajoutée de corps élancé (Ca = 1) ;
//  - traînée quadratique par tranche (Cd = 1,2 en travers, 0,2 le long) ;
//  - amortissement du pilonnement, du roulis et du tangage par les vagues
//    rayonnées (ζ = 0,15 sur les raideurs hydrostatiques) ;
//  - contact sans frottement avec la souche (cône au ras de la surface).
// Vérifié : un fuseau libre se couche avec 8,3 % de son volume émergé
// (1 − ρ_glace/ρ_eau), un cylindre trapu (D/L > 0,78) reste debout.
const rhoW = 1000, rhoI = 917, g = 9.81;

// prof : rayons (mm) par rangée de hauteur dz (m), du bas vers le haut
export function simulateBody({ prof, dz, tilt0 = 0.1, T = 8, dtOut = 1 / 120, Uc = 0.004, tauDrift = 2.5, stub = true }) {
  const NS = prof.length;
  const sC = new Float64Array(NS), rS = new Float64Array(NS);
  for (let n = 0; n < NS; n++) { sC[n] = (n + 0.5) * dz; rS[n] = prof[n] * 1e-3; }
  let V = 0, M1 = 0;
  for (let n = 0; n < NS; n++) { const dv = Math.PI * rS[n] ** 2 * dz; V += dv; M1 += dv * sC[n]; }
  const sG = M1 / V, m = rhoI * V, L = NS * dz;
  let IG = 0;
  for (let n = 0; n < NS; n++) IG += rhoI * Math.PI * rS[n] ** 2 * dz * ((sC[n] - sG) ** 2 + rS[n] ** 2 / 4);
  const rmax = rS.reduce((a, b) => Math.max(a, b), 0);
  const ys = -0.0004, stubCone = 25 * Math.PI / 180, stubR = 0.012;

  function forces(x, y, th, vx, vy, w) {
    const ax = Math.sin(th), ay = Math.cos(th), e1x = Math.cos(th), e1y = -Math.sin(th);
    const sn = Math.abs(Math.sin(th)), sgn = Math.sin(th) >= 0 ? 1 : -1;
    let Fx = 0, Fy = -m * g, Tq = 0, Vsub = 0, Iadd = 0, wpl = 0, wplI = 0;
    for (let n = 0; n < NS; n++) {
      const s = sC[n] - sG, r = rS[n];
      if (r <= 0) continue;
      const cx = x + s * ax, cy = y + s * ay;
      let f, xb = 0;
      if (r * sn < 1e-9) f = cy < 0 ? 1 : 0;
      else {
        const hN = Math.max(-1, Math.min(1, cy / (r * sn)));
        const A = Math.acos(hN) - hN * Math.sqrt(1 - hN * hN);
        f = A / Math.PI;
        xb = A > 1e-12 ? (2 / 3) * Math.pow(1 - hN * hN, 1.5) / A * r : 0;
      }
      if (f <= 0) continue;
      const bx = cx + sgn * xb * e1x, dV = Math.PI * r * r * dz * f;
      Vsub += dV;
      const Fb = rhoW * g * dV;
      Fy += Fb; Tq += (bx - x) * Fb;
      const ux = vx + w * (cy - y), uy = vy - w * (cx - x); // θ horaire
      const un = ux * e1x + uy * e1y, ua = ux * ax + uy * ay;
      const Fn = -0.5 * rhoW * 1.2 * (2 * r * dz * f) * Math.abs(un) * un;
      const Fa = -0.5 * rhoW * 0.2 * (2 * Math.PI * r * dz * f) * Math.abs(ua) * ua;
      const fx = Fn * e1x + Fa * ax, fy = Fn * e1y + Fa * ay;
      Fx += fx; Fy += fy; Tq += (cx - x) * fy - (cy - y) * fx;
      Iadd += rhoW * Math.PI * r * r * dz * f * s * s;
      if (f < 1) { wpl += 2 * r * dz; wplI += 2 * r * dz * s * s; }
    }
    if (stub) for (let n = 0; n < NS; n++) for (const side of [-1, 1]) {
      const s = sC[n] - sG, r = rS[n] * side;
      const px = x + s * Math.sin(th) + r * Math.cos(th), py = y + s * Math.cos(th) - r * Math.sin(th);
      if (py <= ys || py > 0.03) continue;
      const d = Math.max(0, (Math.min(stubR, (py - ys) * Math.tan(stubCone)) - Math.abs(px)) * Math.cos(stubCone));
      if (d <= 0) continue;
      const nx = Math.sign(px || 1) * Math.cos(stubCone), ny = -Math.sin(stubCone);
      const ux = vx + w * (py - y), uy = vy - w * (px - x), vn = ux * nx + uy * ny;
      const Fc = Math.max(0, 3e3 * d - 0.3 * Math.min(0, vn));
      Fx += Fc * nx; Fy += Fc * ny; Tq += (px - x) * Fc * ny - (py - y) * Fc * nx;
    }
    if (wpl > 0) {
      const kh = rhoW * g * wpl; Fy += -2 * 0.15 * Math.sqrt(kh * m) * vy;
      const kr = rhoW * g * wplI; Tq += 2 * 0.15 * Math.sqrt(kr * IG) * w;
    }
    return { Fx, Fy, Tq, Vsub, Iadd };
  }

  // départ : debout, la pointe du col juste sous la surface, incliné de tilt0
  let x = 0, th = tilt0, vx = 0, vy = 0, w = 0;
  let y = ys - 0.0005 - (L - sG) * Math.cos(th);
  const dt = 2e-5, every = Math.round(dtOut / dt);
  const out = [];
  let Vsub = V;
  for (let k = 0; k * dt <= T + 1e-9; k++) {
    if (k % every === 0) out.push(x, y, th, Vsub / V);
    const f = forces(x, y, th, vx, vy, w);
    Vsub = f.Vsub;
    const mE = m + 0.5 * rhoW * f.Vsub, IE = IG + f.Iadd;
    vx += dt * f.Fx / mE; vy += dt * f.Fy / mE; w -= dt * f.Tq / IE;
    x += dt * vx; y += dt * vy; th += dt * w;
  }
  return {
    traj: Float32Array.from(out), dtOut, T, sG, L, V, rmax, DL: (2 * rmax) / L,
    Uc, tauDrift, final: { x, y, th, emerged: 1 - Vsub / V },
  };
}

// Pose du fuseau au temps physique τ (s) depuis le détachement : la
// trajectoire calculée, puis la dérive (la brise l'emporte, hors du plan de
// bascule) ; d(τ) = Uc (τ − τd (1 − e^(−τ/τd))) part sans à-coup.
export function bodyPose(B, tau) {
  const n = B.traj.length / 4;
  const f = Math.max(0, Math.min(n - 1.001, tau / B.dtOut));
  const i = Math.floor(f), a = f - i;
  const q = (k) => B.traj[i * 4 + k] * (1 - a) + B.traj[(i + 1) * 4 + k] * a;
  const drift = B.Uc * (tau - B.tauDrift * (1 - Math.exp(-tau / B.tauDrift)));
  return { x: q(0), y: q(1), th: q(2), emerged: 1 - q(3), drift };
}
