// Prototype s0 : la fonte d'une trémie de bismuth par la chaleur (problème de
// Stefan), méthode de l'enthalpie sur une grille 3D. Version Node, pour régler
// le modèle ; le même noyau tourne en WGSL dans s0.js.
//
// - Le solide : la trémie (même fonction de distance que le rendu), échantillonnée
//   au centre des cellules, à T0 < Tm (il a refroidi à l'air).
// - Le bain : sous la ligne L(u), le métal liquide à Tb (brassé, bien mélangé)
//   échange fortement avec le solide (coefficient hb).
// - L'air : au-dessus, un panache chaud né du bain, Ta(y) = Tamb + (Tb·a − Tamb)·exp(−(y − L)/λ),
//   échange faiblement (ha). Les parois minces (les gradins) chauffent des deux
//   côtés, les arêtes et les coins par deux ou trois faces : ils fondent d'abord.
// - Le solide conduit (diffusivité α). Une cellule dont l'enthalpie dépasse la
//   moitié de la chaleur latente fond : au-dessus de la ligne, le liquide
//   s'égoutte (la cellule devient de l'air) ; dessous, elle rejoint le bain.
// - On note pour chaque cellule l'instant τ où elle fond. Le cristal à
//   l'instant u est { τ > u } : un seul champ relu à chaque image.
//
// Unités : cm, temps u de la remontée (0 : bain bas, 1 : bain haut) ; Tm = 0.

export const P0 = {
  s: 1, cy: 0.8, ang: 0.5, tilt: 0.08, // la trémie (demi-côté, centre, pose)
  h: 0.04, X: 1.6, Y: 2.2,             // grille : pas, demi-largeur, hauteur
  LL: 0.22, LH: 2.05, rise: 1.5,       // marée : bas, haut, exposant de la remontée
  alpha: 0.3, T0: -0.1, Tb: 1, Lh: 1,  // diffusivité, solide (à peine sorti du bain : juste sous la fusion), bain, chaleur latente
  hb: 2, ha: 0.5, a: 0.85, lam: 0.45,   // échanges bain / air, panache (part, longueur)
  amb: -0.4, crust: -0.6, // la croûte du fond, plus froide : elle tient le pied du cristal
                          // l'air de l'atelier, loin du bain : sous le point de fusion
  uEnd: 1.15,
};

export const level = (u, P) => P.LL + (P.LH - P.LL) * Math.pow(Math.min(Math.max(u, 0), 1), P.rise);

function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; }
function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]; }

// la trémie (port « trémie » de scene/tracer.js, sans arrondi ni fonte)
export function hopper(p, P) {
  const q = rotX(rotY([p[0], p[1] - P.cy, p[2]], P.ang), P.tilt), s = P.s;
  const b = q.map((v) => Math.abs(v) - s);
  const dbox = Math.hypot(Math.max(b[0], 0), Math.max(b[1], 0), Math.max(b[2], 0)) + Math.min(Math.max(b[0], b[1], b[2]), 0);
  const a = q.map(Math.abs);
  let n, t;
  if (a[0] >= a[1] && a[0] >= a[2]) { n = a[0]; t = [q[1], q[2]]; } else if (a[1] >= a[2]) { n = a[1]; t = [q[0], q[2]]; } else { n = a[2]; t = [q[0], q[1]]; }
  if (q[1] < -Math.max(a[0], a[2])) return dbox; // (la base a poussé sur la croûte : pleine)
  const w = s * 0.11, rim = s - Math.max(Math.abs(t[0]), Math.abs(t[1]));
  const k = Math.min(Math.floor(rim / w), 7);
  const depth = k * w * 0.75;
  let dcav = n - (s - depth);
  if (k > 0.5) { const up = (k - 1) * w * 0.75, lat = rim - k * w; dcav = Math.min(dcav, Math.hypot(lat, Math.max(n - (s - up), 0))); }
  return Math.max(dbox, dcav);
}

export function simulate(P = P0, { log = false } = {}) {
  const nx = Math.round((2 * P.X) / P.h), ny = Math.round(P.Y / P.h), nz = nx, N = nx * ny * nz;
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const H = new Float32Array(N), H2 = new Float32Array(N), tau = new Float32Array(N);
  const alive = new Uint8Array(N);
  let nMat = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = [-P.X + (i + 0.5) * P.h, (j + 0.5) * P.h, -P.X + (k + 0.5) * P.h];
    const id = idx(i, j, k);
    if (hopper(p, P) < 0) { alive[id] = 1; H[id] = P.T0; tau[id] = 99; nMat++; } else tau[id] = 0;
  }
  const K = P.alpha / (P.h * P.h), Hb = P.hb / P.h, Ha = P.ha / P.h;
  const dt = 0.9 / (6 * K + Hb);
  const steps = Math.ceil(P.uEnd / dt);
  const Tof = (e) => (e < 0 ? e : e > P.Lh ? e - P.Lh : 0);
  const list = []; for (let id = 0; id < N; id++) if (alive[id]) list.push(id);
  const half = 0.5 * P.Lh;
  const melt = [];
  for (let n = 0; n < steps; n++) {
    const u = n * dt, L = level(u, P);
    melt.length = 0;
    for (const id of list) {
      if (!alive[id]) continue;
      const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
      const T = Tof(H[id]);
      let f = 0;
      const nb = (ii, jj, kk) => {
        if (jj < 0) { f += K * (P.crust - T); return; } // la croûte du fond, plus froide
        const y = (jj + 0.5) * P.h;
        if (ii >= 0 && ii < nx && jj < ny && kk >= 0 && kk < nz) {
          const o = idx(ii, jj, kk);
          if (alive[o]) { f += K * (Tof(H[o]) - T); return; }
        }
        const wet = Math.min(Math.max((L - (y - 0.5 * P.h)) / P.h, 0), 1); // (au prorata de la part noyée)
        f += wet * Hb * (P.Tb - T) + (1 - wet) * Ha * (P.amb + (P.Tb * P.a - P.amb) * Math.exp(-Math.max(y - L, 0) / P.lam) - T);
      };
      nb(i - 1, j, k); nb(i + 1, j, k); nb(i, j - 1, k); nb(i, j + 1, k); nb(i, j, k - 1); nb(i, j, k + 1);
      const e = H[id] + dt * f;
      H2[id] = e;
      if (e >= half) melt.push(id, u + dt * (half - H[id]) / Math.max(e - H[id], 1e-9));
    }
    for (const id of list) H[id] = H2[id];
    for (let m = 0; m < melt.length; m += 2) { alive[melt[m]] = 0; tau[melt[m]] = melt[m + 1]; }
    if (log && n % Math.round(steps / 10) === 0) {
      let a = 0, above = 0; for (const id of list) if (alive[id]) { a++; if ((Math.floor(id / nx) % ny + 0.5) * P.h > L) above++; }
      console.log(`u=${u.toFixed(2)} L=${L.toFixed(2)} solide=${(a / nMat * 100).toFixed(0)}% (à l'air ${above})`);
    }
  }
  return { tau, nx, ny, nz, h: P.h, X: P.X, steps, dt };
}
