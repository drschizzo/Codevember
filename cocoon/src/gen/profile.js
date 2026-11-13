// Profils des cages : surfaces de révolution autour de l'axe y de la station.
// Une forme est un profil méridien (r, y) paramétré par t ∈ [0, 1] du pôle bas
// au pôle haut, rééchantillonné en abscisse curviligne σ (le paramètre de la
// carte de la paroi). Module pur : importable depuis Node et les workers.

const TAU = Math.PI * 2;

// g(t) : rayon relatif (× R) ; la hauteur suit y = −(H/2)·cos(πt), si bien
// qu'une sphère (H = 2R, g = sin πt) est exacte.
export const SHAPES = {
  ovoid:   { label: 'Ovoïde',      H: 2.35, g: (t) => Math.sin(Math.PI * t) ** 0.92 * (1 + 0.1 * Math.cos(Math.PI * t)) },
  peanut:  { label: 'Arachide',    H: 2.6,  g: (t) => Math.sin(Math.PI * t) ** 0.85 * (1 - 0.2 * Math.exp(-(((t - 0.5) / 0.11) ** 2))) },
  spindle: { label: 'Fuseau',      H: 2.9,  g: (t) => Math.sin(Math.PI * t) ** 1.35 },
  sphere:  { label: 'Sphère',      H: 2.0,  g: (t) => Math.sin(Math.PI * t) },
  pear:    { label: 'Poire',       H: 2.4,  g: (t) => Math.sin(Math.PI * t) ** 0.8 * (0.78 + 0.3 * Math.cos(Math.PI * t) ** 1 * (Math.cos(Math.PI * t) > 0 ? 1 : 0.45)) },
  capsule: { label: 'Capsule',     H: 2.3,  g: (t) => (1 - Math.abs(Math.cos(Math.PI * t)) ** 4.5) ** (1 / 4.5) },
  bicone:  { label: 'Double cône', H: 2.3,  g: (t) => { const c = Math.cos(Math.PI * t); return 1 - Math.sqrt(c * c + 0.02) + Math.sqrt(0.02); } },
};

// Profil échantillonné : n points également espacés en σ ∈ [0, len].
// hub : rayon des rosaces polaires (le fil ne descend pas en dessous).
export function makeProfile({ shape = 'ovoid', R = 0.13, hub = 0.024 }, n = 512) {
  const S = SHAPES[shape] ?? SHAPES.ovoid;
  const H = S.H * R;
  // échantillonnage fin en t, puis abscisse curviligne cumulée
  const m = 8192, rt = new Float64Array(m + 1), yt = new Float64Array(m + 1), st = new Float64Array(m + 1);
  for (let i = 0; i <= m; i++) {
    const t = i / m;
    rt[i] = Math.max(0, R * S.g(t));
    yt[i] = -(H / 2) * Math.cos(Math.PI * t);
    if (i) st[i] = st[i - 1] + Math.hypot(rt[i] - rt[i - 1], yt[i] - yt[i - 1]);
  }
  const len = st[m];
  const r = new Float64Array(n), y = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * len;
    while (j < m - 1 && st[j + 1] < s) j++;
    const f = (s - st[j]) / Math.max(1e-12, st[j + 1] - st[j]);
    r[i] = rt[j] + (rt[j + 1] - rt[j]) * f;
    y[i] = yt[j] + (yt[j + 1] - yt[j]) * f;
  }
  const ds = len / (n - 1);
  const dr = new Float64Array(n), dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const ex = (r[b] - r[a]), ey = (y[b] - y[a]), l = Math.hypot(ex, ey) || 1;
    dr[i] = ex / l; dy[i] = ey / l; // (tangente unitaire du méridien)
  }
  // bornes de la paroi enroulable : r ≥ hub
  let lo = 0, hi = n - 1;
  while (lo < n - 1 && r[lo] < hub) lo++;
  while (hi > 0 && r[hi] < hub) hi--;
  const sample = (arr, s) => {
    const x = Math.min(n - 1, Math.max(0, s / ds)), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  };
  const P = {
    shape, R, H, hub, n, len, ds, r, y, dr, dy,
    sLo: lo * ds, sHi: hi * ds,
    rAt: (s) => sample(r, s), yAt: (s) => sample(y, s),
    drAt: (s) => sample(dr, s), dyAt: (s) => sample(dy, s),
    rMax: Math.max(...r),
  };
  // σ de l'équateur (rayon maximal) et σ où r = c de part et d'autre
  let iMax = 0;
  for (let i = 1; i < n; i++) if (r[i] > r[iMax]) iMax = i;
  P.sEq = iMax * ds;
  P.sigmaAtR = (c, side) => { // side −1 : côté bas, +1 : côté haut
    if (side < 0) { for (let i = 1; i <= iMax; i++) if (r[i] >= c) { const f = (c - r[i - 1]) / Math.max(1e-12, r[i] - r[i - 1]); return (i - 1 + f) * ds; } return P.sEq; }
    for (let i = n - 2; i >= iMax; i--) if (r[i] >= c) { const f = (c - r[i + 1]) / Math.max(1e-12, r[i] - r[i + 1]); return (i + 1 - f) * ds; }
    return P.sEq;
  };
  return P;
}

// Point de la paroi (σ, φ) à la hauteur h le long de la normale extérieure,
// dans le repère de la station (axe y, centre de la cage à l'origine).
export function wallPoint(P, s, phi, h, out = [0, 0, 0]) {
  const r = P.rAt(s), y = P.yAt(s), tr = P.drAt(s), ty = P.dyAt(s);
  // normale extérieure dans le plan méridien : (ty, −tr)
  const nr = ty, ny = -tr, rr = r + h * nr;
  out[0] = rr * Math.cos(phi); out[1] = y + h * ny; out[2] = rr * Math.sin(phi);
  return out;
}

// Table « direction depuis la lampe → σ » : la lampe est sur l'axe à yLamp ;
// θ est l'angle à +y. Pour chaque θ (n entrées de 0 à π), le σ où le rayon
// sort de la paroi (le profil est étoilé vu de la lampe).
export function thetaTable(P, yLamp = 0, n = 256) {
  const th = new Float64Array(P.n);
  for (let i = 0; i < P.n; i++) th[i] = Math.atan2(P.r[i], P.y[i] - yLamp);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * Math.PI;
    // th décroît de π (pôle bas, σ = 0) à 0 (pôle haut)
    let i = 0;
    while (i < P.n - 1 && th[i + 1] > t) i++;
    const f = (th[i] - t) / Math.max(1e-12, th[i] - th[i + 1]);
    out[k] = Math.min(P.len, Math.max(0, (i + Math.min(1, Math.max(0, f))) * P.ds));
  }
  return out;
}

export { TAU };
