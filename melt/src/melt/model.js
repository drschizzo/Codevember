// La fonte calculée (fonctions pures, Node et navigateur) : le modèle thermique
// partagé par la simulation GPU (scene/melt.js) et sa version de référence en
// JavaScript (simulate, pour les tests).
//
// Problème de Stefan, méthode de l'enthalpie, sur une grille 3D posée sur la
// croûte, dans le repère du cristal :
// - le solide, à peine sorti du bain, est juste sous le point de fusion (T0) ;
// - la croûte du fond fond sous la grappe (le creuset chauffe par le bas) : la
//   grappe descend dans le bain. Dans le repère du cristal, le bain monte :
//   L(u) = LL + D·u^RISE (+ le tassement du cristal, voir plus bas). Sous la
//   ligne, le bain brassé (Tb) échange fortement (hb), au prorata de la part
//   noyée d'une cellule ;
// - au-dessus, l'air reçoit un panache chaud né du bain, qui retombe vers l'air
//   de l'atelier, sous la fusion (ha, a, λ, amb) ;
// - la croûte, plus froide (le creuset gèle par le bas), tient le pied ;
// - le solide conduit (α). Une cellule qui a reçu la moitié de sa chaleur
//   latente fond : au-dessus du bain le liquide s'égoutte, dessous il rejoint le
//   bain. On note l'instant τ où chaque cellule fond ;
// - l'appui : quand la section du solide au ras du bain tombe sous 15 % de ce
//   qu'elle était à cette hauteur (la taille a fondu, comme l'encoche d'un
//   iceberg à sa ligne de flottaison), le bloc s'enfonce (vitesse bornée)
//   jusqu'à reposer sur une section plus large.
//
// Unités : cm ; u, le temps de la fonte (0 : début de la descente, 1 : fin) ;
// températures rapportées à l'écart bain – fusion (Tm = 0, Tb = 1).

export const PHYS = {
  alpha: 0.3, T0: -0.1, Tb: 1, Lh: 1,      // diffusivité, solide, bain, chaleur latente
  hb: 2, ha: 0.4, a: 0.45, lam: 0.3,      // échanges bain / air, panache (part de la chaleur du bain à la ligne, longueur)
  amb: -0.4, crust: -0.6,                 // air de l'atelier, croûte
  rise: 1.5, fall: 6, neck: 0.15,         // descente en u^rise, vitesse de tassement, section d'appui
  uEnd: 1.15,                             // (au-delà de 1, le bain a tout couvert)
};

// demi-largeur horizontale du cristal (repère monde), selon son port
export const reachOf = (s, habit) => (habit === 2 ? 2.1 : 1.65) * s; // (coin d’un cube tourné et incliné de 0,3 rad)

// la grille d'un cristal : pas, demi-largeur, hauteur, dimensions
export function gridFor(c, habit, quality = 1) {
  const h = Math.min(0.045, Math.max(0.02, c.s / 42)) * quality;
  const X = reachOf(c.s, habit) + 3 * h;
  const Y = c.y + c.s * 1.45 + 3 * h;
  return { h, X, Y, nx: Math.ceil((2 * X) / h), ny: Math.ceil(Y / h), nz: Math.ceil((2 * X) / h) };
}

// les grilles d'une grappe, dans un budget de calcul (cellules × pas) : au-delà,
// le pas grandit pour toute la grappe (le temps de calcul croît comme 1/h⁵)
export function gridsFor(cluster, habit, { quality = 1, budget = 2.5e10 } = {}) {
  let q = quality, grids;
  for (let it = 0; it < 8; it++) {
    grids = cluster.map((c) => gridFor(c, habit, q));
    const work = grids.reduce((s, g) => s + g.nx * g.ny * g.nz * stepsFor(g.h).steps, 0);
    if (work <= budget) break;
    q *= Math.pow(work / budget, 1 / 5) * 1.02;
  }
  return grids;
}

// le pas de temps et le nombre de pas d'une grille (schéma explicite stable)
export function stepsFor(h, P = PHYS) {
  const dt = 0.9 / ((6 * P.alpha) / (h * h) + P.hb / h);
  return { dt, steps: Math.ceil(P.uEnd / dt) };
}

// ── la trémie (même fonction que hopperK en WGSL, scene/hopper.js) ──
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]]; }
function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]; }
export function hopper(q0, s, habit) {
  const lng = habit === 2, f = lng ? 0.62 : 1;
  const q = lng ? [q0[0] * 0.62, q0[1], q0[2]] : q0;
  const b = q.map((v) => Math.abs(v) - s);
  const dbox = (Math.hypot(Math.max(b[0], 0), Math.max(b[1], 0), Math.max(b[2], 0)) + Math.min(Math.max(b[0], b[1], b[2]), 0)) * f;
  const a = q.map(Math.abs);
  if (q[1] < -Math.max(a[0], a[2])) return dbox; // (la base a poussé sur la croûte : pleine)
  let n, t;
  if (a[0] >= a[1] && a[0] >= a[2]) { n = a[0]; t = [q[1], q[2]]; } else if (a[1] >= a[2]) { n = a[1]; t = [q[0], q[2]]; } else { n = a[2]; t = [q[0], q[1]]; }
  const w = s * 0.11;
  if (habit === 1) {
    const k0 = Math.floor((s - Math.max(Math.abs(t[0]), Math.abs(t[1]))) / w), an = k0 * 0.07, c = Math.cos(an), sn = Math.sin(an);
    t = [c * t[0] - sn * t[1], sn * t[0] + c * t[1]];
  }
  const rim = s - Math.max(Math.abs(t[0]), Math.abs(t[1]));
  const k = Math.min(Math.floor(rim / w), 7);
  let dcav = n - (s - k * w * 0.75);
  if (k > 0.5) dcav = Math.min(dcav, Math.hypot(rim - k * w, Math.max(n - (s - (k - 1) * w * 0.75), 0)));
  return Math.max(dbox, dcav * f);
}
// distance au cristal c, point p dans le repère de sa grille (x, z centrés ; y = 0 : la croûte)
export const crystalSDF = (p, c, habit) => hopper(rotX(rotY([p[0], p[1] - c.y, p[2]], c.ang), c.tilt), c.s, habit);

// ── version de référence en JavaScript (tests, réglages) ──
// L(u) : le bain dans le repère du cristal, sans le tassement
export const bathAt = (u, LL, D, P = PHYS) => LL + D * Math.pow(Math.min(Math.max(u, 0), 1), P.rise);

export function simulate(c, habit, { LL, D, quality = 1, P = PHYS } = {}) {
  const g = gridFor(c, habit, quality), { h, X, nx, ny, nz } = g, N = nx * ny * nz;
  const { dt, steps } = stepsFor(h, P);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const H = new Float32Array(N), H2 = new Float32Array(N), tau = new Float32Array(N).fill(-1);
  const list = [], layer0 = new Float64Array(ny);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = [-X + (i + 0.5) * h, (j + 0.5) * h, -X + (k + 0.5) * h];
    if (crystalSDF(p, c, habit) < 0) { const id = idx(i, j, k); H[id] = P.T0; tau[id] = 99; list.push(id); layer0[j]++; }
  }
  const K = P.alpha / (h * h), Hb = P.hb / h, Ha = P.ha / h, half = 0.5 * P.Lh;
  const Tof = (e) => (e < 0 ? e : e > P.Lh ? e - P.Lh : 0);
  let drop = 0;
  const dropHist = new Float32Array(steps + 1);
  for (let n = 0; n < steps; n++) {
    const u = n * dt, L = bathAt(u, LL, D, P) + drop;
    const melt = [];
    let band = 0;
    for (const id of list) {
      if (tau[id] <= u) continue;
      const i = id % nx, j = Math.floor(id / nx) % ny, k = Math.floor(id / (nx * ny));
      const T = Tof(H[id]);
      let f = 0;
      const nb = (ii, jj, kk) => {
        if (jj < 0) { f += K * (P.crust - T); return; }
        if (ii >= 0 && ii < nx && jj < ny && kk >= 0 && kk < nz) {
          const o = idx(ii, jj, kk);
          if (tau[o] > u) { f += K * (Tof(H[o]) - T); return; }
        }
        const y = (jj + 0.5) * h, wet = Math.min(Math.max((L - (y - 0.5 * h)) / h, 0), 1);
        f += wet * Hb * (P.Tb - T) + (1 - wet) * Ha * (P.amb + (P.Tb * P.a - P.amb) * Math.exp(-Math.max(y - L, 0) / P.lam) - T);
      };
      nb(i - 1, j, k); nb(i + 1, j, k); nb(i, j - 1, k); nb(i, j + 1, k); nb(i, j, k - 1); nb(i, j, k + 1);
      const e = H[id] + dt * f;
      H2[id] = e;
      if (e >= half) melt.push(id, u + (dt * (half - H[id])) / Math.max(e - H[id], 1e-9));
      else { const y = (j + 0.5) * h; if (y >= L && y < L + 2 * h) band++; }
    }
    for (const id of list) if (tau[id] > u) H[id] = H2[id];
    for (let m = 0; m < melt.length; m += 2) tau[melt[m]] = melt[m + 1];
    const j0 = Math.floor(L / h), ref = (layer0[j0] ?? 0) + (layer0[j0 + 1] ?? 0);
    if (ref > 0 && band < P.neck * ref && L < g.Y - 0.1) drop += P.fall * dt;
    dropHist[n + 1] = drop;
  }
  return { tau, grid: g, dt, steps, drop: dropHist };
}
