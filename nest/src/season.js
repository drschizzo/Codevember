// La saison : une seule horloge pour tout le film.
//
// Module pur (Node, worker, page) : aucune dépendance à three.js.
//
// u ∈ [0, 1) : phase de la boucle (le film) ; s ∈ [0, 1] : la saison (du
// début du printemps à la fin de l'hiver) ; t = s·T : le temps physique en
// secondes. Tout lit s(u) : la croissance du nid, la lumière, le givre, les
// guêpes (qui suivent t : elles volent en temps réel pendant les ralentis et ne
// sont plus que des fantômes dans l'accéléré, comme dans un vrai accéléré
// photographique à pose courte).
//
// s(u) = S_base(w(u)) : S_base est une courbe monotone par nœuds (quelle part
// du film pour quelle part de la saison) ; w(u) est le temps du film déformé
// par les passages en temps réel — la vitesse ds/du y descend, en échelle
// logarithmique, jusqu'au temps réel (×1) et y reste sur un palier, puis
// remonte. La boucle se referme : s(0) = 0, s(1) = 1, et le nid est vide aux
// deux bouts.

export const T_SEASON = 180 * 86400; // (avril → septembre, puis l'hiver : ~ six mois utiles)

// Les temps du film, en u (la part du film où chaque chose se voit) ; ils
// sont convertis en saison s par l'horloge (plan()). Les ralentis (SLOW)
// tombent sur cinq d'entre eux : la reine se pose, trois ouvrières posent
// chacune une bande sur une cloche différente (strips), le nid tombe. Le nid
// fini ne tient qu'un cinquième du film avant de se décrocher.
export const FILM = {
  queen: 0.05, comb: 0.135, strips: [0.235, 0.375, 0.515], peak: 0.65, decline: 0.685, wet: 0.715, frost: 0.745, fall: 0.82, spring: 0.9,
  // (une cloche qui porte une bande commence bien avant son ralenti et finit
  // bien après : pendant le ralenti, la saison ne bouge presque plus)
  // (la cloche 0 attend que le rayon de la reine se lise : quelques cellules, un
  // œuf dans chacune ; puis elle les enveloppe pendant que le rayon grandit encore)
  bells: [[0.122, 0.17], [0.155, 0.2], [0.165, 0.33], [0.31, 0.465], [0.45, 0.6], [0.59, 0.65]],
};

// nœuds (u, s) : la part du film donnée à chaque temps de la saison
const KNOTS = [
  [0.0, 0.0], [0.03, 0.09], [0.05, 0.105], [0.235, 0.29], [0.375, 0.44], [0.515, 0.55], [0.65, 0.6], [0.7, 0.75], [0.805, 0.905], [0.82, 0.91], [0.86, 0.94], [1.0, 1.0],
];

// passages au temps réel : centre (en u du film), demi-largeur du palier, rampe, vitesse (×temps réel)
export const SLOW = [
  { name: 'queen', c: 0.05, half: 0.016, ramp: 0.018, k: 1 },
  // (trois ouvrières, chacune sur sa cloche : léger ralenti, une caméra à 120 i/s)
  ...FILM.strips.map((c, i) => ({ name: `strip${i}`, c, half: 0.027, ramp: 0.022, k: 0.5 })),
  { name: 'fall', c: 0.82, half: 0.008, ramp: 0.012, k: 1 },
];

// interpolation monotone (Fritsch–Carlson) des nœuds
function monotone(K) {
  const n = K.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((K[i + 1][1] - K[i][1]) / (K[i + 1][0] - K[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > K[i + 1][0]) i++;
    const h = K[i + 1][0] - K[i][0], t = (x - K[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * K[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * K[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// La table de l'horloge pour une durée de boucle D (secondes de film)
export function makeClock(D = 48, slow = SLOW) {
  const base = monotone(KNOTS);
  const N = 8192;
  // densité ds/du de la courbe de base (différences)
  const g = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { const u = i / N, e = 0.5 / N; g[i] = Math.max(1e-9, (base(Math.min(1, u + e)) - base(Math.max(0, u - e))) / (Math.min(1, u + e) - Math.max(0, u - e))); }
  // masque des paliers (0 : accéléré de base ; 1 : temps réel)
  const mask = (u) => {
    let m = 0;
    for (const w of slow) { const d = Math.abs(u - w.c); m = Math.max(m, 1 - sstep(w.half, w.half + w.ramp, d)); }
    return m;
  };
  const kAt = (u) => { let best = 1, bm = 0; for (const w of slow) { const d = Math.abs(u - w.c), m = 1 - sstep(w.half, w.half + w.ramp, d); if (m > bm) { bm = m; best = w.k; } } return best; };
  // densité finale : géométrique entre la base et le temps réel (rampe en échelle log)
  // ds/du au temps réel ×k : (D / T)·k
  const f = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const u = i / N, m = mask(u), eps = (D / T_SEASON) * kAt(u);
    f[i] = Math.exp((1 - m) * Math.log(g[i]) + m * Math.log(eps));
  }
  // intégrale (trapèzes), normalisée : s(0) = 0, s(1) = 1
  const S = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) S[i] = S[i - 1] + (f[i] + f[i - 1]) / (2 * N);
  const tot = S[N];
  for (let i = 0; i <= N; i++) S[i] /= tot;
  const at = (A, u) => { const x = Math.min(1, Math.max(0, u)) * N, i = Math.min(N - 1, Math.floor(x)), t = x - i; return A[i] * (1 - t) + A[i + 1] * t; };
  return {
    D, N,
    s: (u) => at(S, u - Math.floor(u)),
    // vitesse : secondes physiques par seconde de film
    speed: (u) => (at(f, u - Math.floor(u)) / tot) * T_SEASON / D,
    // temps physique (s)
    t: (u) => at(S, u - Math.floor(u)) * T_SEASON,
    mask,
  };
}

// Le plan de la saison en s : les temps du film passés par l'horloge, et les
// cloches emboîtées (facteur d'échelle, fenêtre de construction). Le nid de
// fondation (cloches 0 et 1) est petit ; les suivantes, plus grandes, vont
// aussi vite à l'écran (plus d'ouvrières).
export const LAMBDA = [0.17, 0.3, 0.46, 0.63, 0.82, 1.0];
export function plan(clock) {
  const P = {};
  for (const [k, v] of Object.entries(FILM)) if (k !== 'bells' && k !== 'strips') P[k] = clock.s(v);
  P.strips = FILM.strips.map((v) => clock.s(v));
  P.strip = P.strips[1]; // (la bande du milieu : le repère de l'été)
  P.bells = FILM.bells.map(([a, b], k) => ({ k, lam: LAMBDA[k], s0: clock.s(a), s1: clock.s(b) }));
  return P;
}

// L'effectif de la colonie (ouvrières en vol autour du nid), en part du maximum
export function colony(s, P) {
  if (s < P.queen || s > P.decline + 0.04) return 0;
  const grow = 0.12 + 0.88 * sstep(P.bells[1].s0, P.peak * 0.9, s) ** 1.2; // (les premières ouvrières naissent pendant la cloche 1)
  if (s < P.bells[1].s0) return 0;
  const die = 1 - sstep(P.peak + 0.02, P.decline + 0.04, s);
  return grow * die;
}
