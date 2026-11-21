// Refroidissement d'une surface de lave pāhoehoe : conduction dans la croûte,
// rayonnement et convection de l'air en surface, chaleur latente de
// cristallisation, propriétés selon la porosité — d'après le modèle physique
// de Keszthelyi et Denlinger (1996, « The initial cooling of pahoehoe flow
// lobes », Bull. Volcanol. 58), simplifié à une dimension.
//
// Résolution implicite (Euler arrière, système tridiagonal) sur une grille
// régulière, pas de temps croissant géométriquement (la surface perd 140 K/s
// dans les premières secondes, puis plus rien ne presse). Le résultat est une
// table indexée par le logarithme de l'âge : température de surface,
// épaisseur de croûte (isotherme 1 070 °C, Hon et al. 1994) et températures à
// quelques profondeurs (ce qu'on voit au fond d'une fissure).
//
// Module pur (Node, workers).

const SIGMA = 5.670374e-8;

export const COOLING_DEFAULTS = {
  T0: 1150 + 273.15, // éruption (K)
  Tsky: 273, // ciel effectif (K)
  Tair: 293,
  hc: 50, // convection de l'air (W m⁻² K⁻¹) ; ~ 3× sous la pluie
  eps: 0.95,
  porosity: 0.3,
  rho0: 2800, cp: 1200, k0: 1.6, // basalte dense
  latent: 3.5e5, Tliq: 1150 + 273.15, Tsol: 980 + 273.15, // cristallisation
  Tcrust: 1070 + 273.15, // limite de la croûte rigide (Hon et al. 1994)
  depth: 0.3, dz: 0.00025, // m
  ageMax: 6 * 3600, // s
  depths: [0.002, 0.006, 0.015, 0.03], // fond d'une fissure (m)
};

// ages de la table : de 0,05 s à ageMax, log-régulier
export const ageAt = (i, n, ageMax) => 0.05 * (ageMax / 0.05) ** (i / (n - 1));
export const indexOfAge = (age, n, ageMax) => (Math.log(Math.max(0.05, age) / 0.05) / Math.log(ageMax / 0.05)) * (n - 1);

export function solveCooling(opts = {}, nOut = 256) {
  const P = { ...COOLING_DEFAULTS, ...opts };
  const N = Math.round(P.depth / P.dz), dz = P.dz;
  const phi = P.porosity, rho = P.rho0 * (1 - phi);
  // conductivité d'un milieu poreux (Keszthelyi : k diminue avec la porosité)
  const kOf = (T) => P.k0 * (1 - phi) / (1 + phi) * (1 + 0.0003 * (T - 300)) ;
  // capacité apparente : la chaleur latente est libérée entre liquidus et solidus
  const cpOf = (T) => P.cp + (T < P.Tliq && T > P.Tsol ? P.latent / (P.Tliq - P.Tsol) : 0);
  const T = new Float64Array(N).fill(P.T0);
  const a = new Float64Array(N), b = new Float64Array(N), c = new Float64Array(N), d = new Float64Array(N);
  const out = { n: nOut, ageMax: P.ageMax, surf: new Float32Array(nOut), crust: new Float32Array(nOut), deep: P.depths.map(() => new Float32Array(nOut)), depths: P.depths, energy: 0 };
  const sample = (i) => {
    out.surf[i] = T[0];
    let j = 0;
    while (j < N - 1 && T[j] < P.Tcrust) j++;
    // interpolation de l'isotherme entre deux nœuds
    out.crust[i] = j === 0 ? 0 : (j - 1 + (T[j - 1] - P.Tcrust) / (T[j - 1] - T[j] || 1)) * dz;
    P.depths.forEach((z, k) => { const x = z / dz, i0 = Math.min(N - 2, Math.floor(x)), f = x - i0; out.deep[k][i] = T[i0] * (1 - f) + T[i0 + 1] * f; });
  };
  let t = 0, dt = 0.002, next = 0, lost = 0;
  const e0 = T.reduce((s, v) => s + v, 0);
  while (next < nOut) {
    const target = ageAt(next, nOut, P.ageMax);
    if (t >= target - 1e-9) { sample(next++); continue; }
    const h = Math.min(dt, target - t);
    // Euler arrière, flux de surface linéarisé autour de T[0]
    for (let i = 0; i < N; i++) {
      const Ti = T[i], C = rho * cpOf(Ti) * dz / h;
      const kw = i > 0 ? (kOf(T[i - 1]) + kOf(Ti)) / 2 / dz : 0;
      const ke = i < N - 1 ? (kOf(T[i + 1]) + kOf(Ti)) / 2 / dz : 0;
      a[i] = -kw; c[i] = -ke; b[i] = C + kw + ke; d[i] = C * Ti;
      if (i === 0) {
        // q = εσ(T⁴ − Tsky⁴) + hc(T − Tair) ≈ q0 + q'(T − T0)
        const q0 = P.eps * SIGMA * (Ti ** 4 - P.Tsky ** 4) + P.hc * (Ti - P.Tair);
        const dq = 4 * P.eps * SIGMA * Ti ** 3 + P.hc;
        b[i] += dq; d[i] += -q0 + dq * Ti;
      }
    }
    // (fond : flux nul, l'intérieur de l'orteil reste chaud)
    for (let i = 1; i < N; i++) { const m = a[i] / b[i - 1]; b[i] -= m * c[i - 1]; d[i] -= m * d[i - 1]; }
    const T0old = T[0];
    T[N - 1] = d[N - 1] / b[N - 1];
    for (let i = N - 2; i >= 0; i--) T[i] = (d[i] - c[i] * T[i + 1]) / b[i];
    lost += (P.eps * SIGMA * (T0old ** 4 - P.Tsky ** 4) + P.hc * (T0old - P.Tair)) * h;
    t += h;
    dt = Math.min(dt * 1.02, 20);
  }
  out.lost = lost; // (énergie perdue en surface, J/m² — bilan dans les tests)
  return out;
}

// lecture de la table à un âge (s) : interpolation linéaire en log(âge)
export function coolAt(tab, age, key = 'surf', k = 0) {
  const arr = key === 'deep' ? tab.deep[k] : tab[key];
  const x = Math.min(tab.n - 1, Math.max(0, indexOfAge(age, tab.n, tab.ageMax)));
  const i = Math.min(tab.n - 2, Math.floor(x)), f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}
