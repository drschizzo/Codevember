// Géométrie 4D du tesseract : transformations affines, patrons dépliés,
// symétries et chorégraphie de la boucle. Ce module ne dépend de rien (il est
// aussi utilisé par l'interface et par l'export).
//
// Le tesseract est [-1, 1]⁴. Ses 8 cellules (des cubes) sont repérées par leur
// normale ±eₖ : cellule c = 2k + (σ > 0), k ∈ {x, y, z, w}. Deux cellules sont
// adjacentes (elles partagent un carré) sauf si elles sont opposées.
//
// Une application affine 4D est { m: [16] (ligne-major), t: [4] } : x ↦ m·x + t.

export const AXES = ['x', 'y', 'z', 'w'];
export const W = 3;
export const cellAxis = (c) => c >> 1;
export const cellSign = (c) => ((c & 1) ? 1 : -1);
export const cellOf = (k, s) => 2 * k + (s > 0 ? 1 : 0);
export const opposite = (c) => c ^ 1;
export const adjacent = (a, b) => cellAxis(a) !== cellAxis(b);
export const normalOf = (c) => { const n = [0, 0, 0, 0]; n[cellAxis(c)] = cellSign(c); return n; };
export const CELL_NAMES = ['−X', '+X', '−Y', '+Y', '−Z', '+Z', '−W', '+W'];
export const ROOT = cellOf(W, -1); // cellule « socle » du patron : −W

// ── Applications affines ─────────────────────────────────────────────────────
export const ident = () => ({ m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], t: [0, 0, 0, 0] });
export function compose(a, b) { // a ∘ b
  const m = new Array(16).fill(0), t = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a.m[r * 4 + k] * b.m[k * 4 + c]; m[r * 4 + c] = s; }
    let s = a.t[r];
    for (let k = 0; k < 4; k++) s += a.m[r * 4 + k] * b.t[k];
    t[r] = s;
  }
  return { m, t };
}
export function apply(a, x) {
  const y = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) y[r] = a.m[r * 4] * x[0] + a.m[r * 4 + 1] * x[1] + a.m[r * 4 + 2] * x[2] + a.m[r * 4 + 3] * x[3] + a.t[r];
  return y;
}
export const linear = (m) => ({ m: [...m], t: [0, 0, 0, 0] });

// rotation d'angle θ dans le plan (u, v) (vecteurs unitaires orthogonaux),
// qui porte u vers v
function planeRotation(u, v, th) {
  const c = Math.cos(th), s = Math.sin(th), m = new Array(16);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
    m[r * 4 + k] = (r === k ? 1 : 0) + (c - 1) * (u[r] * u[k] + v[r] * v[k]) + s * (v[r] * u[k] - u[r] * v[k]);
  }
  return m;
}
const e = (k, s = 1) => { const v = [0, 0, 0, 0]; v[k] = s; return v; };

// ── Charnière entre deux cellules du patron ──────────────────────────────────
// La cellule s pivote autour du carré qu'elle partage avec son parent p (centre
// n_p + n_s), dans le plan (n_p, n_s) : à θ = 0 elle est à sa place dans le
// tesseract, à θ = π/2 elle est couchée dans l'hyperplan du parent, du côté
// opposé (dépliée).
export function hinge(p, s, th) {
  const np = normalOf(p), ns = normalOf(s);
  const m = planeRotation(np.map((x) => -x), ns, th);
  const h = np.map((x, i) => x + ns[i]);
  const R = linear(m), Rh = apply(R, h);
  return { m, t: h.map((x, i) => x - Rh[i]) };
}

// ── Patrons ──────────────────────────────────────────────────────────────────
// Un patron est un arbre couvrant des cellules, de racine −W : parent[c]
// (−1 pour la racine). Déplié, chaque cellule est couchée dans l'hyperplan
// w = −1 : on vérifie que deux cellules n'y tombent jamais au même endroit.

// transformation de dépliage de chaque cellule (angles par cellule, θ[ROOT] ignoré)
export function unfoldTransforms(parent, theta) {
  const T = new Array(8);
  const get = (c) => {
    if (T[c]) return T[c];
    if (parent[c] < 0) return (T[c] = ident());
    return (T[c] = compose(get(parent[c]), hinge(parent[c], c, theta[c])));
  };
  for (let c = 0; c < 8; c++) get(c);
  return T;
}
export function netCenters(parent) {
  const T = unfoldTransforms(parent, new Array(8).fill(Math.PI / 2));
  return T.map((t, c) => apply(t, normalOf(c)));
}
export function validNet(parent) {
  const seen = new Set();
  for (const p of netCenters(parent)) {
    const k = p.slice(0, 3).map((x) => Math.round(x)).join(',');
    if (seen.has(k) || Math.abs(p[3] + 1) > 1e-6) return false;
    seen.add(k);
  }
  return true;
}
export function depthOf(parent) {
  return parent.map((_, c) => { let d = 0; for (let x = c; parent[x] >= 0; x = parent[x]) d++; return d; });
}

// Patron de Dalí (Corpus Hypercubus) : croix à six bras autour du socle, et
// la huitième cellule sous le bras −Y.
export const DALI = (() => {
  const p = new Array(8).fill(ROOT);
  p[ROOT] = -1;
  p[cellOf(W, 1)] = cellOf(1, -1);
  return p;
})();

// patron tiré au hasard (arbre couvrant aléatoire, sans chevauchement) ;
// shape : 'dali' | 'cross' (le socle au centre d'une croix) | 'chain'
// (patron étiré, en serpent) | 'random'
export function randomNet(rng, shape = 'random') {
  if (shape === 'dali') {
    // la huitième cellule pend sous l'un des six bras
    const p = new Array(8).fill(ROOT);
    p[ROOT] = -1;
    p[cellOf(W, 1)] = rng.pick([0, 1, 2, 3, 4, 5]);
    return p;
  }
  for (let tries = 0; tries < 500; tries++) {
    const parent = new Array(8).fill(-2);
    parent[ROOT] = -1;
    const inTree = [ROOT];
    while (inTree.length < 8) {
      // croissance : on rattache une cellule hors de l'arbre à une cellule de
      // l'arbre ; 'chain' préfère prolonger la dernière, 'cross' le socle
      const pool = [];
      for (const a of inTree) for (let b = 0; b < 8; b++) {
        if (parent[b] !== -2 || !adjacent(a, b)) continue;
        let w = 1;
        if (shape === 'chain') w = a === inTree[inTree.length - 1] ? 6 : 0.3;
        if (shape === 'cross') w = a === ROOT ? 4 : 1;
        pool.push([[a, b], w]);
      }
      const [a, b] = rng.weighted(pool);
      parent[b] = a;
      inTree.push(b);
    }
    if (validNet(parent)) return parent;
  }
  return [...DALI];
}

// ── Symétries ────────────────────────────────────────────────────────────────
// Un « mouvement » est un quart de tour dans un plan contenant w (la cellule
// intérieure passe à l'extérieur), éventuellement doublé d'un quart de tour
// dans le plan orthogonal (rotation double, isocline) :
// { a, s, b?, c?, s2? } : plan (eₐ, s·e_w) [+ plan (e_b, s2·e_c)].
export function moveMatrix(mv, frac = 1) {
  const th = (frac * Math.PI) / 2;
  let m = planeRotation(e(mv.a), e(W, mv.s), th);
  if (mv.b !== undefined) m = compose(linear(m), linear(planeRotation(e(mv.b), e(mv.c, mv.s2), th))).m;
  return m;
}
export const moveLabel = (mv) => {
  const a = `${AXES[mv.a]}w${mv.s > 0 ? '' : '′'}`;
  return mv.b === undefined ? a : `${a}+${AXES[mv.b]}${AXES[mv.c]}${mv.s2 > 0 ? '' : '′'}`;
};
const allMoves = () => {
  const out = [];
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
    out.push({ a, s });
    const [b, c] = [0, 1, 2].filter((x) => x !== a);
    for (const s2 of [1, -1]) out.push({ a, s, b, c, s2 });
  }
  return out;
};
export const MOVES = allMoves();
const mulM = (A, B) => compose(linear(A), linear(B)).m;
const isIdent = (M) => M.every((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) < 1e-9);
const sameM = (A, B) => A.every((x, i) => Math.abs(x - B[i]) < 1e-9);
// suite de mouvements dont le produit est l'identité : la boucle se referme
// (chaque étape montre le même patron, garni d'autres cellules)
// mode : 'tour' (huit mouvements : le cube intérieur passe par les huit
// cellules), 'same' (un seul plan, 4 quarts de tour), 'mixed' (3 ou 4
// mouvements différents) ; allowDouble : rotations doubles admises
export function randomMoves(rng, mode = 'mixed', allowDouble = true) {
  const pool = MOVES.filter((m) => allowDouble || m.b === undefined);
  if (mode === 'tour') { const tour = randomTour(rng, pool); if (tour) return tour; }
  if (mode === 'short') { const tour = randomTour(rng, pool, 4); if (tour) return tour; const m = rng.pick(pool); return [m, m, m, m]; }
  if (mode === 'same') { const m = rng.pick(pool); return [m, m, m, m]; }
  for (let tries = 0; tries < 4000; tries++) {
    const L = rng.pick([3, 4, 4]);
    const seq = [];
    let P = ident().m;
    for (let i = 0; i < L - 1; i++) { const m = rng.pick(pool); seq.push(m); P = mulM(moveMatrix(m), P); }
    // dernier mouvement : l'inverse du produit, s'il est un mouvement permis
    const last = pool.find((m) => isIdent(mulM(moveMatrix(m), P)));
    if (!last) continue;
    seq.push(last);
    // pas d'aller-retour immédiat, ni d'étape qui ramène au même état
    const states = [ident().m];
    let ok = true;
    for (let i = 0; i < seq.length - 1 && ok; i++) {
      const S = mulM(moveMatrix(seq[i]), states[i]);
      if (states.some((X) => sameM(X, S))) ok = false;
      states.push(S);
    }
    if (ok) return seq;
  }
  const m = rng.pick(pool);
  return [m, m, m, m];
}
// cellule intérieure (celle qui fait face à −w, au centre de la projection)
// pour l'orientation Q : Q·n_c = −e_w, donc n_c = Qᵀ·(−e_w), l'opposée de la
// dernière ligne de Q
export function innerCell(Q) {
  const n = [0, 1, 2, 3].map((k) => -Q[12 + k]);
  const k = n.findIndex((x) => Math.abs(x) > 0.5);
  return cellOf(k, n[k]);
}

// Tour de n pièces (huit : le tour complet) : n mouvements dont le produit
// est l'identité et qui font passer le cube intérieur par n cellules
// distinctes, une fois chacune, avant de revenir à la première.
// Recherche en profondeur, mouvements essayés dans un ordre tiré au hasard ;
// null si elle n'aboutit pas assez vite.
function randomTour(rng, pool, n = 8, budget = 50000) {
  const shuffled = () => {
    const a = [...pool];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const seq = [], visited = new Set([innerCell(ident().m)]);
  const search = (Q) => {
    if (--budget < 0) return false;
    if (seq.length === n - 1) {
      const last = pool.find((m) => isIdent(mulM(moveMatrix(m), Q)));
      if (last) seq.push(last);
      return !!last;
    }
    for (const m of shuffled()) {
      const Qn = mulM(moveMatrix(m), Q), c = innerCell(Qn);
      if (visited.has(c)) continue;
      seq.push(m); visited.add(c);
      if (search(Qn)) return true;
      seq.pop(); visited.delete(c);
    }
    return false;
  };
  return search(ident().m) ? seq : null;
}

// orientation au début de chaque étape : Q₀ = I, Qₖ₊₁ = gₖ·Qₖ
export function stepOrientations(moves) {
  const Q = [ident().m];
  for (const mv of moves) Q.push(mulM(moveMatrix(mv), Q[Q.length - 1]));
  return Q;
}

// ── Courbes ──────────────────────────────────────────────────────────────────
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// accélération / décélération avec anticipation et dépassement (le mouvement
// recule un peu avant de partir, dépasse un peu avant de se poser) ; b = 0 :
// cubique
export function easeBack(t, b) {
  t = clamp01(t);
  const c = b * 2.6;
  return t < 0.5 ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2 : ((2 * t - 2) ** 2 * ((c + 1) * (2 * t - 2) + c) + 2) / 2;
}
export const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
// smoothstep de a à b (a > b : décroissant)
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ── Chorégraphie ─────────────────────────────────────────────────────────────
// Chaque étape de la boucle : pause dépliée, pliage (les cellules se replient
// tour à tour), pause, quart de tour 4D, pause, dépliage. Le patron déplié est
// le même à chaque étape (mêmes emplacements), mais les cellules ont changé de
// place : après toutes les étapes, chacune a retrouvé la sienne.
export const PHASES = ['open', 'fold', 'hold', 'turn', 'rest', 'unfold'];

export function stepTimeline(ch) {
  const w = PHASES.map((k) => Math.max(0.001, ch[k]));
  const tot = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  return PHASES.map((k, i) => { const a = acc; acc += w[i] / tot; return { k, a, b: acc }; });
}

// État à la phase ph ∈ [0, 1) : orientation 4D de départ, angle de chaque
// charnière, quart de tour en cours.
//   Q : matrice d'orientation (ligne-major) avant le mouvement en cours
//   theta[slot] : angle de charnière de l'emplacement (0 plié, π/2 déplié)
//   turn : fraction du mouvement en cours, move : ce mouvement
//   fold : pliage moyen (0 déplié, 1 plié)
export function stateAt(ph, R, cache) {
  if (R.voyage?.on) return voyageStateAt(ph, R, cache);
  const { moves, chor } = R;
  const n = moves.length;
  const u = (((ph % 1) + 1) % 1) * n;
  const k = Math.min(n - 1, Math.floor(u)), v = u - k;
  const tl = cache.timeline, Q = cache.Q;
  const depth = cache.depth, maxD = Math.max(1, ...depth);
  const order = cache.order; // rang de pliage de chaque emplacement (0 : premier)
  const span = (i) => clamp01((v - tl[i].a) / (tl[i].b - tl[i].a));
  // pliage échelonné : chaque charnière a sa fenêtre dans la phase
  const stagger = chor.stagger;
  const hingeFold = (x, rank) => {
    const d0 = (stagger * rank) / 7, len = 1 - stagger;
    return easeBack((x - d0) / len, chor.antic);
  };
  const theta = new Array(8).fill(Math.PI / 2);
  let base = Q[k], turn = 0, foldMean = 0;
  const fFold = span(1), fTurn = span(3), fUnfold = span(5);
  let phase = 'open';
  for (const p of tl) if (v >= p.a) phase = p.k;
  if (v >= tl[4].a) base = Q[k + 1]; // (mouvement accompli : nouvelle orientation)
  for (let s = 0; s < 8; s++) {
    let f; // 0 déplié → 1 plié
    if (phase === 'open') f = 0;
    else if (phase === 'fold') f = hingeFold(fFold, order[s]);
    else if (phase === 'unfold') f = 1 - hingeFold(fUnfold, 7 - order[s]);
    else f = 1;
    if (s === ROOT) continue;
    theta[s] = (Math.PI / 2) * (1 - f);
    foldMean += Math.min(1, Math.max(0, f)) / 7;
  }
  if (phase === 'turn') turn = easeBack(fTurn, chor.turnAntic);
  return { Q: base, theta, turn, move: phase === 'turn' ? moves[k] : null, fold: foldMean, step: k, phase, v, maxD };
}

// Ordre de pliage des emplacements : les feuilles d'abord (de la plus
// profonde à la moins profonde), le socle en dernier ; ordre inverse au dépliage.
export function foldOrder(parent, rng) {
  const d = depthOf(parent);
  const idx = [...Array(8).keys()].sort((a, b) => d[b] - d[a] || (rng ? rng.next() - 0.5 : a - b));
  const order = new Array(8);
  idx.forEach((c, i) => { order[c] = i; });
  return order;
}

// Transformation 4D de chaque cellule (étiquette c) pour un état :
// emplacement s = Q·n_c ; dépliage de l'emplacement ; quart de tour.
export function cellTransforms(st, parent) {
  const Qa = linear(st.Q);
  const out = new Array(8);
  if (st.move) {
    const R = linear(moveMatrix(st.move, st.turn));
    const T = compose(R, Qa);
    for (let c = 0; c < 8; c++) out[c] = T;
    return out;
  }
  const U = unfoldTransforms(parent, st.theta);
  for (let c = 0; c < 8; c++) {
    const n = apply(Qa, normalOf(c));
    const k = n.findIndex((x) => Math.abs(x) > 0.5), slot = cellOf(k, n[k]);
    out[c] = compose(U[slot], Qa);
  }
  return out;
}

// Plongement d'une cellule : coordonnées locales l ∈ [-1, 1]³ → 4D
// x = n_c + l₀·e_a + l₁·e_b + l₂·e_c (les trois autres axes, dans l'ordre).
// Renvoie la matrice 4×4 (colonne 3 : translation) qui, appliquée à (l, 1),
// donne le point 4D, composée avec la transformation T de la cellule et une
// échelle locale (retrait de la cellule dans son hyperplan).
export function cellMatrix(T, c, scale = 1, local = null) {
  const k = cellAxis(c), others = [0, 1, 2, 3].filter((x) => x !== k);
  // colonnes de l'application l ↦ x (avant T)
  const E = others.map((a) => e(a, scale));
  const n = normalOf(c);
  // composition avec une transformation locale 3D (rotation d'un contenu…) :
  // local = { m3: [9] (ligne-major), t3: [3] }
  let cols = E, origin = n;
  if (local) {
    cols = [0, 1, 2].map((j) => [0, 1, 2, 3].map((r) => E[0][r] * local.m3[j] + E[1][r] * local.m3[3 + j] + E[2][r] * local.m3[6 + j]));
    origin = [0, 1, 2, 3].map((r) => n[r] + E[0][r] * local.t3[0] + E[1][r] * local.t3[1] + E[2][r] * local.t3[2]);
  }
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let j = 0; j < 3; j++) { let s = 0; for (let q = 0; q < 4; q++) s += T.m[r * 4 + q] * cols[j][q]; out[r * 4 + j] = s; }
    let s = T.t[r];
    for (let q = 0; q < 4; q++) s += T.m[r * 4 + q] * origin[q];
    out[r * 4 + 3] = s;
  }
  return out; // ligne-major
}
// point local l de la cellule c (retrait inset) → 4D, avant la transformation
// de la cellule
export function embedLocal(c, l, inset = 1) {
  const k = cellAxis(c), x = normalOf(c);
  [0, 1, 2, 3].filter((a) => a !== k).forEach((a, i) => { x[a] += l[i] * inset; });
  return x;
}

// Projection 4D → 3D (même calcul que le shader, voir scene/project.js) :
// gonflement vers la 3-sphère de rayon 2, puis perspective depuis (0,0,0,d).
export function project(y, d, inflate) {
  let p = y;
  if (inflate > 0) {
    const r = Math.hypot(...y) || 1, k = 1 + inflate * (2 / r - 1);
    p = y.map((x) => x * k);
  }
  const s = d / Math.max(d - p[3], 0.05);
  return [p[0] * s, p[1] * s, p[2] * s];
}

// ── Le voyage intérieur ──────────────────────────────────────────────────────
// Gonflé jusqu'au bout (3-sphère de rayon 2) et vu depuis un œil 4D posé sur
// cette sphère (d = 2), le tesseract est projeté stéréographiquement : c'est,
// à une échelle près, ce que verrait un habitant de l'hypersphère placé au pôle
// opposé à l'œil, c'est-à-dire au centre du cube intérieur (l'origine de
// l'espace projeté). Les directions depuis l'origine sont exactes : les grands
// cercles qui y passent deviennent des droites.
//
// Les huit cellules pavent l'hypersphère : ce sont huit pièces, chacune
// accolée à six autres. Et un quart de tour dans un plan qui contient w — le
// mouvement même de la boucle — déplace l'univers entier le long d'un grand
// cercle : vu du centre, on traverse la paroi et l'on passe dans la pièce
// voisine. Quatre quarts de tour dans le même plan : on marche tout droit, on
// traverse quatre pièces, et l'on revient à son point de départ.
//
// Déroulé : pause dépliée, pliage, pause, plongée (l'œil 4D se pose sur la
// sphère, la caméra entre), puis pour chaque mouvement une halte dans la pièce
// et une traversée, une dernière halte, la remontée et le dépliage.
export const VOYAGE_PHASES = ['open', 'fold', 'hold', 'plunge', 'dwell', 'travel', 'surface', 'unfold'];
export function voyageTimeline(R) {
  const C = R.chor, V = R.voyage, n = R.moves.length;
  const segs = [['open', C.open], ['fold', C.fold], ['hold', C.hold], ['plunge', V.plunge]];
  // (chaque traversée a son allure : plus ou moins rapide, et sa halte aussi)
  for (let i = 0; i < n; i++) segs.push(['dwell', V.dwell * pace(R, i, 'd'), i], ['travel', V.travel * pace(R, i, 't'), i]);
  segs.push(['dwell', V.dwell, n], ['surface', V.surface], ['unfold', C.unfold]);
  const tot = segs.reduce((a, s) => a + Math.max(0.001, s[1]), 0);
  let acc = 0;
  return segs.map(([k, w, i = 0]) => { const a = acc; acc += Math.max(0.001, w) / tot; return { k, i, a, b: acc }; });
}
// facteur de durée propre à une traversée ou à une halte (tiré de la graine)
export const pace = (R, i, k) => 0.75 + 0.55 * hash01(`${R.seed}:${k}${i}`);
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
export const voyageSeconds = (R) => {
  const C = R.chor, V = R.voyage, n = R.moves.length;
  let t = C.open + C.fold + C.hold + V.plunge + V.dwell + V.surface + C.unfold;
  for (let i = 0; i < n; i++) t += V.dwell * pace(R, i, 'd') + V.travel * pace(R, i, 't');
  return t;
};
export const timelineFor = (R) => (R.voyage?.on ? voyageTimeline(R) : stepTimeline(R.chor));

export function voyageStateAt(ph, R, cache) {
  const { moves, chor } = R;
  const n = moves.length;
  const u = ((ph % 1) + 1) % 1;
  const tl = cache.timeline;
  let j = 0;
  while (j < tl.length - 1 && u >= tl[j].b) j++;
  const seg = tl[j], f = clamp01((u - seg.a) / (seg.b - seg.a));
  const order = cache.order, depth = cache.depth, maxD = Math.max(1, ...depth);
  const stagger = chor.stagger;
  const hingeFold = (x, rank) => easeBack((x - (stagger * rank) / 7) / (1 - stagger), chor.antic);
  const theta = new Array(8).fill(Math.PI / 2);
  let foldMean = 0;
  for (let s = 0; s < 8; s++) {
    let fs;
    if (seg.k === 'open') fs = 0;
    else if (seg.k === 'fold') fs = hingeFold(f, order[s]);
    else if (seg.k === 'unfold') fs = 1 - hingeFold(f, 7 - order[s]);
    else fs = 1;
    if (s === ROOT) continue;
    theta[s] = (Math.PI / 2) * (1 - fs);
    foldMean += clamp01(fs) / 7;
  }
  let Q = cache.Q[0], move = null, turn = 0, step = 0;
  if (seg.k === 'dwell') { Q = cache.Q[seg.i]; step = Math.min(n - 1, seg.i); }
  if (seg.k === 'travel') {
    Q = cache.Q[seg.i]; move = moves[seg.i]; step = seg.i;
    // (un léger recul avant l'élan, un léger dépassement à l'arrivée)
    turn = easeBack(f, 0.06 + 0.25 * chor.turnAntic);
  }
  if (seg.k === 'surface') step = n - 1;
  return { Q, theta, turn, move, fold: foldMean, step, phase: seg.k, v: u, maxD, seg: j, room: seg.i, f };
}
