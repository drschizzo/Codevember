// Le plan d'une boucle : familles (ce qui pend), cycles de torsion, came,
// barre de blocage, temps physique et temps du film. Module pur (Node, tests,
// worker) : aucune dépendance à three.js.
//
// Une boucle = trois cycles en crescendo. Chaque cycle : le moteur tourne le
// mandrin de K tours entiers ; la came du compte-tours écarte la barre au
// moment où il s'arrête ; le volant, libéré, tourne et se pose ; la barre
// revient quand le moteur repart (la came la quitte). Le compte-tours fait un
// tour par boucle (rapport K₁ + K₂ + K₃) : tout revient à sa place.

const TAU = Math.PI * 2;
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Familles ──────────────────────────────────────────────────────────────────
// Raideurs : B (flexion), C (torsion), en N·m² ; mu : masse linéique ; r : rayon
// (contact et rendu) ; n : segments ; M : masse du volant (tension). Le seuil de
// flambage d'une tige tendue (Greenhill) : τc = 2√(BF)/C, soit Lk_c = τc·L/2π.
export const FAMILIES = {
  cordon: {
    label: 'Cordon', strands: 1, L: 0.62, r: 0.005, mu: 0.06, B: 2.4e-3, CB: 1 / 1.4, aniso: 1, M: 0.11, n: 72, rMin: 0.0075,
    gesture: 'reste droit pendant que sa rayure tourne, puis une boucle naît et s\'enroule sur elle-même',
  },
  paire: {
    label: 'Paire', strands: 2, spread: 0.014, L: 0.62, r: 0.0036, mu: 0.035, B: 6e-4, CB: 1 / 1.4, aniso: 1, M: 0.16, n: 64, rMin: 0.0055,
    gesture: 'les deux brins s\'enroulent l\'un autour de l\'autre en hélice serrée',
  },
  spirale: {
    label: 'Spirale', strands: 1, L: 0.62, r: 0.0045, mu: 0.05, B: 2.2e-3, CB: 1 / 1.4, aniso: 1, M: 0.025, n: 72, rMin: 0.007,
    gesture: 'peu tendu, il se love tout entier en ressort, d\'un bout à l\'autre',
  },
  ruban: {
    label: 'Ruban', strands: 1, L: 0.62, r: 0.0058, w: 0.013, h: 0.0012, mu: 0.03, B: 9e-4, CB: 1.3, aniso: 18, M: 0.08, n: 72, rMin: 0.009,
    gesture: 'vrille en hélicoïde qui clignote, puis se plie en boucles plates',
  },
  fil: {
    label: 'Fil', strands: 1, L: 0.62, r: 0.0016, mu: 0.016, B: 6.5e-3, CB: 1 / 1.3, aniso: 1, M: 0.5, n: 80, rMin: 0.02,
    gesture: 'rien ne se voit pendant des tours, puis une coque claque d\'un coup',
  },
};
export const familyKeys = Object.keys(FAMILIES);

// seuil de flambage estimé (tours) : tension au milieu de la corde
export function criticalTurns(F) {
  const T = (F.M + 0.5 * F.mu * F.L) * 9.81, C = F.B * F.CB;
  return (2 * Math.sqrt(F.B * T) / C) * F.L / TAU;
}

// spécification de la simulation (gen/rod.js) d'une famille
export function rodSpec(fam, R = {}) {
  const F = FAMILIES[fam];
  const strands = [];
  if (F.strands === 1) strands.push({ top: [0, 0, 0], bottom: [0, 0.012, 0], n: F.n });
  else for (let k = 0; k < F.strands; k++) {
    const a = (k / F.strands) * TAU, x = Math.cos(a) * F.spread, z = Math.sin(a) * F.spread;
    strands.push({ top: [x, 0, z], bottom: [x, 0.012, z], n: F.n });
  }
  // le balancier : un moyeu lourd (la tension) et un bras léger de 20 cm dont
  // le bout court dans la glissière (pendule de torsion) ; amorti par l'air et
  // par son pivot ; un amortisseur à huile freine sa montée et sa descente
  // raideur de torsion : celle des brins, plus, pour une paire, le rappel
  // géométrique de deux brins tendus écartés (M g d² / L)
  const kT = F.strands * F.B * F.CB / F.L + (F.strands > 1 ? F.M * 9.81 * (2 * F.spread) ** 2 / F.L : 0), I = F.M * 0.0063;
  const crit = 2 * Math.sqrt(kT * I);
  return {
    strands, L: F.L, r: F.r, mu: F.mu, B1: F.B, B2: F.B * F.aniso, C: F.B * F.CB, inertiaScale: 100,
    fly: { M: F.M, I, drag: 0.05 * I, friction: 0.5 * crit, vdamp: R.dashpot ?? 15, yMin: -1 },
    imperfection: { kappa: 0.6, phase: R.imperfection ?? 0 }, topY: 0, damp: 10, dampW: 4, friction: 0.25,
    rail: { x: 0.24, z: -0.012, pivotY: 0.022, maxAngle: 0.14, R: 0.0075 }, cols: [[0.34, 0, 0.024], [-0.34, 0, 0.024]],
    iterations: 1, pairEvery: 4, clearTop: F.r + 0.0015, clearFly: F.r + 0.0015, maxShear: 0.05, rMinBend: F.rMin,
  };
}

// ── Plan physique ─────────────────────────────────────────────────────────────
// R.cycles : [{ K, rate (tours/s), settle (s) }] ; renvoie la frise des phases
// et les fonctions du temps physique τ.
const RAMP = 0.6;      // montée et descente du moteur (s)
const CAM_T = 0.3;     // la came écarte la barre pendant le dernier tiers de tour
const CLOSE_T = 0.3;   // la barre revient pendant le premier tiers de tour suivant
export function makePlan(R) {
  const cyc = [];
  let t = 0, turns = 0;
  for (const c of R.cycles) {
    const D = c.K / c.rate + RAMP; // (vitesse en trapèze : la rampe ajoute RAMP/2 de chaque côté)
    cyc.push({ ...c, t0: t, t1: t + D, from: turns, to: turns + c.K, free0: t + D, free1: t + D + c.settle });
    t += D + c.settle;
    turns += c.K;
  }
  const P = t, N = turns;
  // angle du mandrin : trapèze de vitesse, intégré en forme fermée
  const prof = (x, D) => { // fraction de rotation à x ∈ [0, D], rampes de RAMP
    const r = RAMP, v = 1 / (D - r); // (vitesse de croisière normalisée)
    if (x <= 0) return 0;
    if (x >= D) return 1;
    // vitesse : smoothstep de 0 à v sur [0, r], v, puis de v à 0 sur [D − r, D] ;
    // ∫₀ˣ smoothstep = r·(u³ − u⁴/2) avec u = x/r
    const ramp = (y) => { const u = Math.min(1, y / r); return r * (u * u * u - u * u * u * u / 2) + Math.max(0, y - r); };
    if (x < D / 2) return v * ramp(x);
    return 1 - v * ramp(D - x);
  };
  const wrap = (tau) => ((tau % P) + P) % P;
  const theta = (tau) => {
    tau = wrap(tau);
    for (const c of cyc) if (tau < c.free0) return TAU * (c.from + c.K * prof(tau - c.t0, c.t1 - c.t0));
    return TAU * N; // (≡ 0 : un nombre entier de tours)
  };
  // vitesse du moteur (tours/s), pour la courroie, la poulie et le son
  const motorRate = (tau) => (theta(tau + 1e-3) - theta(tau - 1e-3)) / (TAU * 2e-3);
  // barre : 0 fermée (l'ergot du balancier contre elle), 1 écartée. Elle est
  // menée par la came de la roue-programme, donc par l'angle du mandrin : elle
  // s'écarte pendant le dernier CAM_T de tour d'un cycle, reste écartée tant
  // que le moteur est arrêté, et revient pendant le premier CLOSE_T de tour du
  // cycle suivant. (La came est lisse : la levée suit l'angle, pas le temps.)
  const turnsIn = (tau) => { // (cycle en cours, tours faits dans ce cycle) ou null pendant un retour
    tau = wrap(tau);
    for (const c of cyc) if (tau >= c.t0 && tau < c.free0) return { c, n: theta(tau) / TAU - c.from };
    return null;
  };
  // ouverture d'après le nombre de tours faits dans un cycle de K tours
  const barOf = (n, K) => Math.max(1 - sstep(0, CLOSE_T, n), sstep(K - CAM_T, K, n));
  const bar = (tau) => {
    const q = turnsIn(tau);
    return q ? barOf(q.n, q.c.K) : 1;
  };
  // levée de la came à l'angle ψ de la roue-programme (ψ ∈ [0, 1) tour = N tours du mandrin)
  const camLift = (psi) => {
    const n = (((psi % 1) + 1) % 1) * N;
    for (const c of cyc) if (n >= c.from && n < c.from + c.K) return barOf(n - c.from, c.K);
    return 1;
  };
  const inClosing = (tau) => { const q = turnsIn(tau); return !!q && q.n < CLOSE_T; };
  // volant : bloqué quand la barre est fermée ; cran (ressort de la fourche en V) pendant qu'elle revient
  const drive = (tau) => {
    const b = bar(tau);
    tau = wrap(tau);
    let lockTurns = 0;
    for (const c of cyc) if (tau >= c.t0) lockTurns = c.from;
    const closing = inClosing(tau);
    const locked = b < 0.35 && !closing; // (l'ergot quitte la barre quand elle s'est écartée d'un tiers)
    // (butée en V : ±0,6 rad quand la barre est écartée, 0 quand elle est fermée)
    return { theta: theta(tau), locked, lockPhi: TAU * lockTurns, gap: closing ? 0.6 * b : undefined, bar: b };
  };
  return { cycles: cyc, P, N, theta, motorRate, bar, camLift, drive, RAMP, CAM_T, CLOSE_T };
}

// ── Temps du film ─────────────────────────────────────────────────────────────
// La vitesse v(τ) du temps physique par seconde de film : 1 en temps réel,
// 1/k autour des temps forts (caméra rapide), > 1 pendant les longs retours au
// repos (accéléré). Bosses lisses en log : ln v = Σ aᵢ·b((τ − cᵢ)/wᵢ), avec
// b(x) = (1 − x²)³ sur ]−1, 1[. t(τ) = ∫ dτ / v, intégré numériquement sur une
// grille fine ; τ(t) par interpolation inverse.
export function makeWarp(P, bumps, grid = 4000) {
  const lnv = (tau) => {
    let s = 0;
    for (const b of bumps) {
      for (const sh of [-P, 0, P]) { // (périodique)
        const x = (tau + sh - b.c) / b.w;
        if (x > -1 && x < 1) { const q = 1 - x * x; s += b.a * q * q * q; }
      }
    }
    return s;
  };
  const tt = new Float64Array(grid + 1);
  for (let i = 0; i < grid; i++) {
    const a = (i / grid) * P, b = ((i + 1) / grid) * P;
    tt[i + 1] = tt[i] + (P / grid) * (Math.exp(-lnv(a)) + 4 * Math.exp(-lnv((a + b) / 2)) + Math.exp(-lnv(b))) / 6;
  }
  const T = tt[grid];
  const tauOf = (t) => { // t ∈ [0, T]
    const k = Math.floor(t / T);
    t -= k * T;
    let lo = 0, hi = grid;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tt[m] <= t) lo = m; else hi = m; }
    const f = (t - tt[lo]) / (tt[hi] - tt[lo] || 1);
    return k * P + ((lo + f) / grid) * P;
  };
  const tOf = (tau) => { const k = Math.floor(tau / P), x = tau - k * P, g = (x / P) * grid, i = Math.min(grid - 1, Math.floor(g)); return k * T + tt[i] + (tt[i + 1] - tt[i]) * (g - i); };
  return { T, tauOf, tOf, speed: (tau) => Math.exp(lnv(tau)) };
}

// ── Catalogue : les familles retenues et leurs cycles (tours entiers) ──────
// Le premier cycle reste sous le seuil (la rayure s'enroule seule), le deuxième
// le franchit à peine (une boucle naît), le troisième le dépasse (la torsade).
// (Le ruban et le fil, essayés, sont écartés : le premier se traverse avec un
// contact de capsules, le second montre une instabilité de torsion locale.)
export const CATALOGUE = {
  cordon: { cycles: [4, 7, 8], settle: [5, 6.5, 8] },
  paire: { cycles: [3, 5, 7], settle: [6, 7, 8] },
  spirale: { cycles: [2, 5, 6], settle: [5, 6.5, 8] },
};
