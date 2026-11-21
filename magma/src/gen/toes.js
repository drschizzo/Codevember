// L'arbre des orteils : comment une nappe de pāhoehoe couvre le champ.
//
// Modèle : marche aléatoire corrélée avec biais (Baloga et Glaze 2003,
// « Pahoehoe transport as a correlated random walk ») — chaque orteil part du
// nez (ou du flanc) de son parent, avec un cap corrélé au sien, tiré vers la
// pente et vers la place libre (Hamilton et al. 2013 : la topographie choisit
// le point de percée) ; dimensions d'après les 445 orteils de Mauna Ulu
// (Crown et Baloga 1999 : 20–60 cm de long, rapport longueur/largeur ~ 2) ;
// un orteil s'arrête quand sa croûte le retient, puis se rompt au nez après
// un délai, et le fils sort.
//
// La surface (règle de la boucle, docs/concept.md) :
//   ancienne nappe   S₀(p) = max_k z_k(p)                      (= R)
//   nappe en cours   S(p,t) = max(R(p), max_k n_k(p,t))
//   n_k(p,t) = min(z_k(p) + h, R(p) + (h + hT_k)·C(d_k(p,t)))
// où z_k est le dôme final de l'orteil k, d_k la distance derrière son front
// (un demi-cercle qui avance le long de son axe) et C un quart de cercle de
// rayon rr (le nez bulbeux). Une fois l'orteil achevé, n_k = z_k + h : quand
// tous le sont, S = R + h exactement. La scène à u = 1 est la scène à u = 0
// une nappe plus haut — par construction.
//
// Ce module est pur (Node, workers) ; scene/field.js en reproduit les
// formules en TSL, à l'identique (test : test/toes.test.mjs).
import { createRng } from '../../../shared/rng.js';

// ── Paramètres d'un orteil (STRIDE flottants, rangés en 3 vec4 pour le GPU) ──
// 0 x0, 1 z0 (col), 2 θ (cap), 3 κ (courbure de l'axe, 1/m)
// 4 L (longueur), 5 W (demi-largeur max), 6 hT (épaisseur), 7 B (base)
// 8 t0 (début, s), 9 dur (croissance, s), 10 neck (largeur du col / W), 11 hash
export const STRIDE = 12;
export const WALL = 1.0; // pente du pied, sous le bord arrondi (45°)
export const EDGE = 2.0; // le bord arrondi est un quart d'ellipse : hT de haut, EDGE·hT de large

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const quarter = (x) => { const t = 1 - clamp(x, 0, 1); return Math.sqrt(Math.max(0, 1 - t * t)); }; // quart de cercle : 0 → 1, vertical en 0

// coordonnées locales (abscisse le long de l'axe courbe, travers)
export function local(T, k, x, z) {
  const o = k * STRIDE;
  const dx = x - T[o], dz = z - T[o + 1], c = Math.cos(T[o + 2]), s = Math.sin(T[o + 2]);
  const a = dx * c + dz * s, b = -dx * s + dz * c;
  return [a, b - 0.5 * T[o + 3] * a * a];
}

// demi-largeur à l'abscisse s : col étroit, ventre, nez
// (le bord ondule : deux sinus de phase propre à l'orteil, ±15 %)
export function halfWidth(T, k, s) {
  const o = k * STRIDE, L = T[o + 4], W = T[o + 5], nk = T[o + 10], hh = T[o + 11];
  const wob = 1 + 0.1 * Math.sin(s * 9 + hh * 40) + 0.05 * Math.sin(s * 21 + hh * 17);
  return W * (nk + (1 - nk) * sstep(-0.05 * L, 0.5 * L, s)) * wob;
}
// bosses du dos (gonflements inégaux), mêmes sinus en TSL
export const bumps = (s, v, hh) => 0.16 * Math.sin(s * 17 - v * 11 + hh * 73) + 0.1 * Math.sin(v * 23 + s * 5 + hh * 19);

// distance signée au contour (négative dedans) : un « cône arrondi » le long
// de l'axe, de rayon variable
export function outline(T, k, s, v, len = T[k * STRIDE + 4]) {
  const r0 = halfWidth(T, k, 0), r1 = halfWidth(T, k, len);
  const sc = clamp(s, r0 * 0.6, Math.max(r0 * 0.6, len - r1));
  return Math.hypot(s - sc, v) - halfWidth(T, k, sc);
}

// hauteur du dôme final de l'orteil k au point (x, z)
export function toeZ(T, k, x, z) {
  const o = k * STRIDE, hT = T[o + 6], B = T[o + 7], L = T[o + 4];
  const [s, v] = local(T, k, x, z);
  const e = outline(T, k, s, v);
  if (e > 0) return B - WALL * e; // mur sous le bord, qui rejoint ce qui est dessous
  const rr = EDGE * hT, w = halfWidth(T, k, clamp(s, 0, L));
  // bord arrondi (quart de cercle de rayon hT), dos légèrement bombé
  const crown = 0.14 * hT * (1 - (v / w) ** 2) * Math.sin(Math.PI * clamp(s / L, 0, 1));
  // (bord en sinus : pente bornée à ≈ 40° — un quart d'ellipse, vertical au ras
  // du bord, faisait basculer la normale en traînées noires)
  return B + hT * Math.sin(0.5 * Math.PI * clamp(-e / rr, 0, 1)) + (Math.max(0, crown) + hT * bumps(s, v, T[o + 11])) * sstep(0, rr, -e);
}

// position du front le long de l'axe au temps t : il part sans à-coup,
// accélère puis ralentit (la croûte du nez s'épaissit), du col jusqu'au-delà
// du nez et des flancs
export function frontAt(T, k, t) {
  const o = k * STRIDE, x = clamp((t - T[o + 8]) / T[o + 9], 0, 1);
  if (t <= T[o + 8]) return -1;
  return frontLen(T, k) * (0.5 - 0.5 * Math.cos(Math.PI * x)) - 0.02;
}
// course totale du front : de quoi que tout point de l'orteil (mur compris)
// soit couvert à la fin — c'est ce qui rend la boucle exacte
export const frontLen = (T, k) => { const o = k * STRIDE; return T[o + 4] + 1.4 * T[o + 5] + EDGE * T[o + 6] + 0.12; };
// abscisse du front qui passe en (s, v) : demi-cercle de rayon w(s)
// (derrière le col, s < 0 : la lave se répand en arrière depuis le col, à
// 1/1,5 de la vitesse du front — autour d'une bouche de percée, elle sort en
// s'étalant au lieu d'apparaître d'un coup)
export function frontS(T, k, s, v) {
  const w = halfWidth(T, k, Math.max(0, s));
  const f = Math.max(0, s) + w - Math.sqrt(Math.max(0, w * w - v * v));
  return s < 0 ? f - 1.5 * s : f;
}
// instant où le front passe en (s, v) (inverse de frontAt)
export function passTime(T, k, s, v) {
  const o = k * STRIDE, e = clamp((frontS(T, k, s, v) + 0.02) / frontLen(T, k), 0, 1);
  return T[o + 8] + (Math.acos(1 - 2 * e) / Math.PI) * T[o + 9];
}

// Hauteur de la nappe en cours portée par l'orteil k, sur l'ancienne surface
// Rold (une autre : l'ancienne nappe est le même champ, décalé — voir stage.js).
// Le nez est un bourrelet dont la hauteur est l'épaisseur locale (la lave
// remplit les creux, s'amincit sur les bosses) ; derrière lui, l'orteil
// gonfle encore pendant une minute (de 60 % à 100 % de son épaisseur).
export const INFL = 0.4, INFL_T = 30;
export function toeN(T, k, x, z, t, Rold, h) {
  const o = k * STRIDE, hT = T[o + 6];
  const sf = frontAt(T, k, t);
  if (sf < 0) return -1e9;
  const [s, v] = local(T, k, x, z);
  const d = sf - frontS(T, k, s, v);
  if (d <= 0) return -1e9;
  const top = toeZ(T, k, x, z) + h;
  const age = t - passTime(T, k, s, v);
  const infl = 1 - INFL * Math.exp(-Math.max(0, age) / INFL_T);
  return Rold + Math.max(0, top - Rold) * quarter(d / (EDGE * hT)) * infl;
}

// ── Grille de recherche (quels orteils peuvent toucher un point) ────────────
export function makeIndex(T, n, F, cell = 0.1) {
  const N = Math.ceil((2 * F) / cell), bins = Array.from({ length: N * N }, () => []);
  for (let k = 0; k < n; k++) {
    const o = k * STRIDE, L = T[o + 4], W = T[o + 5], reach = L + W + T[o + 6] * 2 + 0.05;
    const i0 = Math.max(0, Math.floor((T[o] - reach + F) / cell)), i1 = Math.min(N - 1, Math.floor((T[o] + reach + F) / cell));
    const j0 = Math.max(0, Math.floor((T[o + 1] - reach + F) / cell)), j1 = Math.min(N - 1, Math.floor((T[o + 1] + reach + F) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * N + i].push(k);
  }
  return { N, cell, F, bins, at(x, z) { const i = Math.floor((x + F) / cell), j = Math.floor((z + F) / cell); return i < 0 || j < 0 || i >= N || j >= N ? [] : bins[j * N + i]; } };
}

// relief de l'ancienne nappe en (x, z) et orteil du dessus
export function topAt(T, idx, x, z, floor = -1) {
  let best = floor, who = -1;
  for (const k of idx.at(x, z)) { const v = toeZ(T, k, x, z); if (v > best) { best = v; who = k; } }
  return [best, who];
}

// ── Croissance de l'arbre ───────────────────────────────────────────────────
// spec : { seed, F (demi-côté du champ), sources: [{x, z, heading, t}],
//          slope: {dir, grade}, L (longueur moyenne), aspect (W/L), hT,
//          speed (m/s), delay [min, max] (s), corr (0–1), spread (rad) }
export function growTree(spec) {
  const rng = createRng(`${spec.seed}-toes`);
  const F = spec.F, max = spec.max ?? 1600;
  const T = new Float32Array(max * STRIDE);
  let n = 0;
  // grille d'occupation (5 cm) : place libre et draperie (relief courant)
  const G = 0.05, NG = Math.ceil((2 * F + 1.2) / G), off = F + 0.6;
  const occ = new Uint8Array(NG * NG), relief = new Float32Array(NG * NG).fill(-1);
  const gi = (x, z) => { const i = Math.floor((x + off) / G), j = Math.floor((z + off) / G); return i < 0 || j < 0 || i >= NG || j >= NG ? -1 : j * NG + i; };
  const base = (x, z) => -(spec.slope.grade) * (x * Math.cos(spec.slope.dir) + z * Math.sin(spec.slope.dir));
  const inField = (x, z, m = 0) => Math.abs(x) < F + m && Math.abs(z) < F + m;

  // échantillons d'une empreinte (pour l'ouverture et la draperie)
  const tmp = new Float32Array(STRIDE);
  function footprint(p, cb) {
    tmp.set(p);
    const L = p[4], W = p[5];
    for (let a = 0.08; a < 1; a += 0.14) for (let b = -0.8; b <= 0.81; b += 0.4) {
      const s = a * L, v = b * halfWidth(tmp, 0, s);
      // retour au plan : inverse de local() (courbure comprise)
      const vv = v + 0.5 * p[3] * s * s, c = Math.cos(p[2]), sn = Math.sin(p[2]);
      cb(p[0] + s * c - vv * sn, p[1] + s * sn + vv * c);
    }
  }
  function openness(p) {
    let free = 0, all = 0, out = 0;
    footprint(p, (x, z) => { all++; const g = gi(x, z); if (!inField(x, z, 0.35)) out++; else if (g >= 0 && !occ[g]) free++; });
    return { free: free / all, out: out / all };
  }

  function place(p) {
    // draperie : la base suit ce qui est dessous (moyenne du relief courant)
    let sum = 0, cnt = 0;
    footprint(p, (x, z) => { const g = gi(x, z); const fl = base(x, z) - p[6] * 0.9, r = g >= 0 ? Math.max(relief[g], fl) : fl; sum += r; cnt++; /* (jamais sous le plancher : sinon chaque génération s'enfonce) */ });
    p[7] = sum / cnt - p[6] * 0.6;
    T.set(p, n * STRIDE);
    const k = n++;
    // occupation et relief : la grille entière sous l'empreinte élargie
    const reach = p[4] + p[5] + 0.1;
    const i0 = gi(p[0] - reach, p[1] - reach), i1 = gi(p[0] + reach, p[1] + reach);
    const a0 = Math.max(0, Math.floor((p[0] - reach + off) / G)), a1 = Math.min(NG - 1, Math.floor((p[0] + reach + off) / G));
    const b0 = Math.max(0, Math.floor((p[1] - reach + off) / G)), b1 = Math.min(NG - 1, Math.floor((p[1] + reach + off) / G));
    void i0; void i1;
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
      const x = (i + 0.5) * G - off, z = (j + 0.5) * G - off;
      const [s, v] = local(T, k, x, z);
      if (outline(T, k, s, v) < -0.01) occ[j * NG + i] = 1;
      const zz = toeZ(T, k, x, z);
      if (zz > relief[j * NG + i]) relief[j * NG + i] = zz;
    }
    return k;
  }

  const lognorm = (s) => Math.exp(rng.gauss() * s);
  function makeToe(x0, z0, th, t0, parentHT) {
    const L = spec.L * lognorm(0.22), W = 0.5 * L * spec.aspect * (0.85 + 0.3 * rng.next());
    const hT = (parentHT ?? spec.hT) * (0.9 + 0.2 * rng.next());
    return Float32Array.from([x0, z0, th, rng.gauss() * 0.9, L, W, hT, 0, t0, L / (spec.speed * (0.75 + 0.5 * rng.next())), 0.5 + 0.2 * rng.next(), rng.next()]);
  }

  // choisit le cap d'un bourgeon parmi des candidats (ouverture, pente, mémoire)
  const down = spec.slope.dir;
  function chooseBud(x0, z0, th0, t0, parentHT, cone) {
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 11; i++) {
      const th = th0 + (i / 10 - 0.5) * 2 * cone + rng.gauss() * 0.08;
      const p = makeToe(x0, z0, th, t0, parentHT);
      const o = openness(p);
      if (o.free < 0.3 || o.out > 0.5) continue;
      const score = 3.2 * o.free + spec.slope.bias * Math.cos(th - down) + spec.corr * Math.cos(th - th0) - 2 * o.out - Math.log(-Math.log(rng.next() + 1e-9)) * 0.35;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // file d'événements (fins de croissance), par temps
  const queue = [];
  const push = (k) => { queue.push(k); queue.sort((a, b) => T[b * STRIDE + 8] - T[a * STRIDE + 8]); };
  for (const S of spec.sources) {
    const p = makeToe(S.x, S.z, S.heading, S.t, spec.hT);
    p[3] *= 0.3;
    push(place(p));
    // une source pousse aussitôt un ou deux autres orteils (la fente s'ouvre)
    for (const dth of S.fan ?? []) { const q = chooseBud(S.x, S.z, S.heading + dth, S.t + rng.range(2, 8), spec.hT, 0.5); if (q) push(place(q)); }
  }
  const tipOf = (k, a) => {
    const o = k * STRIDE, s = a * T[o + 4];
    const vv = 0.5 * T[o + 3] * s * s, c = Math.cos(T[o + 2]), sn = Math.sin(T[o + 2]);
    return [T[o] + s * c - vv * sn, T[o + 1] + s * sn + vv * c, T[o + 2] + T[o + 3] * s];
  };
  while (queue.length && n < max - 4) {
    // Le bourgeon part quand le front du parent passe au point de percée (pas
    // à la fin de sa croissance) : la propagation est continue, les orteils se
    // relaient sans pause.
    const k = queue.pop(), o = k * STRIDE;
    const budT = (a, side = 0) => passTime(T, k, a * T[o + 4], side * T[o + 5] * 0.7);
    const hT = T[o + 6];
    // bourgeons au nez : 1 à 3
    // (spec.buds < 1 : moins de bourgeons, des lobes plus longs — cordée, dalles)
    const b = spec.buds ?? 1, r = rng.next(), nb = r < Math.min(0.95, 0.55 / b) ? 1 : r < 0.92 ? 2 : 3;
    const [tx, tz, th] = tipOf(k, 0.86);
    for (let b = 0; b < nb; b++) {
      const t0 = budT(0.86) + rng.range(spec.delay[0], spec.delay[1]);
      const dir = th + (nb > 1 ? (b / (nb - 1) - 0.5) * 1.3 : 0);
      const p = chooseBud(tx, tz, dir, t0, hT, spec.spread);
      if (p) push(place(p));
    }
    // bourgeon de flanc (une fois sur quatre)
    if (rng.next() < 0.25) {
      const side = rng.next() < 0.5 ? -1 : 1, fa = rng.range(0.35, 0.7), [fx, fz, fth] = tipOf(k, fa);
      const w = T[o + 5];
      const nx = fx - Math.sin(fth) * side * w * 0.7, nz = fz + Math.cos(fth) * side * w * 0.7, [ls, lv] = local(T, k, nx, nz);
      const p = chooseBud(nx, nz, fth + side * 1.2, passTime(T, k, Math.max(0, ls), lv) + rng.range(spec.delay[0], spec.delay[1]) * 2, hT, 0.6);
      if (p) push(place(p));
    }
  }

  // Comblement : ce que l'arbre n'a pas atteint (dans le champ) reçoit un
  // orteil parti du bord du voisin couvert le plus proche, après lui.
  const idx0 = () => makeIndex(T, n, F + 0.6);
  for (let pass = 0; pass < 6; pass++) {
    const idx = idx0();
    const holes = [];
    for (let z = -F; z <= F; z += 0.04) for (let x = -F; x <= F; x += 0.04) {
      let inside = false;
      for (const k of idx.at(x, z)) { const [s, v] = local(T, k, x, z); if (outline(T, k, s, v) < -0.004) { inside = true; break; } }
      if (!inside) holes.push([x, z]);
    }
    if (!holes.length) break;
    rng.shuffle?.(holes);
    const done = new Uint8Array(NG * NG);
    for (const [hx, hz] of holes) {
      const g = gi(hx, hz);
      if (done[g]) continue;
      // voisin le plus proche (orteil dont le contour est le plus près)
      let bk = -1, be = 1e9;
      for (let k = 0; k < n; k++) {
        const o = k * STRIDE;
        if (Math.hypot(T[o] - hx, T[o + 1] - hz) - T[o + 4] - T[o + 5] > be) continue; // (borne : il ne peut pas faire mieux)
        const [s, v] = local(T, k, hx, hz), e = outline(T, k, s, v);
        if (e < be) { be = e; bk = k; }
      }
      if (bk < 0) bk = 0;
      // part d'un point du contour du voisin, vers le trou
      const o = bk * STRIDE;
      const cx = T[o] + Math.cos(T[o + 2]) * T[o + 4] * 0.5, cz = T[o + 1] + Math.sin(T[o + 2]) * T[o + 4] * 0.5;
      const th = Math.atan2(hz - cz, hx - cx);
      const dist = Math.hypot(hx - cx, hz - cz);
      // le col est au bord du voisin (là où sa lave s'arrête), pas en plein vide
      let start = 0;
      for (let a = 0; a < dist; a += 0.01) {
        const [s, v] = local(T, bk, cx + Math.cos(th) * a, cz + Math.sin(th) * a);
        if (outline(T, bk, s, v) > -0.03) break;
        start = a;
      }
      const sx = cx + Math.cos(th) * start, sz = cz + Math.sin(th) * start;
      const [s0, v0] = local(T, bk, sx, sz);
      const p = makeToe(sx, sz, th, Math.max(T[o + 8], passTime(T, bk, s0, v0)) + rng.range(spec.delay[0], spec.delay[1]), T[o + 6]);
      p[3] *= 0.3;
      p[4] = Math.max(p[4], Math.min(1.2, dist - start + 0.25));
      p[5] = Math.max(p[5], 0.12);
      p[9] = p[4] / spec.speed;
      place(p);
      // marque la zone traitée
      for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) { const q = gi(hx + dx * G, hz + dz * G); if (q >= 0) done[q] = 1; }
      if (n >= max) break;
    }
  }
  return { T: T.slice(0, n * STRIDE), n, F };
}

// ── Listes de candidats par texel (pour le GPU) ─────────────────────────────
// Pour chaque texel : les (au plus) 4 orteils dont le dôme est à moins de
// h + marge du dessus. Ce sont les seuls qui peuvent paraître, dans l'ancienne
// nappe comme dans la nouvelle. Identifiants + 1 (0 = aucun).
// (rasterisé orteil par orteil, dans sa boîte, en gardant les K meilleurs par
// texel ; rows = [j0, j1) pour partager le travail entre workers)
const KEEP = 8; export const SLOTS = 8;
// boîte englobante d'un orteil (axe courbe compris), élargie de pad
export function toeBox(T, k, pad = 0) {
  const o = k * STRIDE, L = T[o + 4], W = T[o + 5] + pad, c = Math.cos(T[o + 2]), sn = Math.sin(T[o + 2]);
  let xa = 1e9, xb = -1e9, za = 1e9, zb = -1e9;
  for (let a = -0.25; a <= 1.25; a += 0.125) {
    const s = a * L, vv = 0.5 * T[o + 3] * s * s;
    for (const b of [-W, W]) {
      const x = T[o] + s * c - (vv + b) * sn, z = T[o + 1] + s * sn + (vv + b) * c;
      xa = Math.min(xa, x); xb = Math.max(xb, x); za = Math.min(za, z); zb = Math.max(zb, z);
    }
  }
  return [xa - pad, xb + pad, za - pad, zb + pad];
}
// Huit candidats par texel : le ou les deux orteils les plus hauts (le
// relief final, max des dômes) puis les premiers arrivés parmi ceux qui couvrent le
// point (le front). Ne garder que les plus hauts faisait disparaître, d'un
// texel au suivant, l'orteil qui avait couvert le point en premier — sa lave
// avec lui : une falaise.
export function bakeLists(tree, res, h, Fmap = tree.F, rows = [0, res]) {
  const { T, n } = tree;
  const [r0, r1] = rows, nr = r1 - r0, NN = nr * res;
  const out = new Float32Array(NN * SLOTS);
  const cell = (2 * Fmap) / res;
  const z1 = new Float32Array(NN).fill(-1e9), z2 = new Float32Array(NN).fill(-1e9), k1 = new Int32Array(NN).fill(-1), k2 = new Int32Array(NN).fill(-1);
  const pt = new Float32Array(NN * KEEP).fill(1e9), pk = new Int32Array(NN * KEEP).fill(-1);
  for (let k = 0; k < n; k++) {
    const [xa, xb, za, zb] = toeBox(T, k, 0.08);
    const i0 = Math.max(0, Math.floor((xa + Fmap) / cell)), i1 = Math.min(res - 1, Math.floor((xb + Fmap) / cell));
    const j0 = Math.max(r0, Math.floor((za + Fmap) / cell)), j1 = Math.min(r1 - 1, Math.floor((zb + Fmap) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = -Fmap + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -Fmap + (i + 0.5) * cell, c = (j - r0) * res + i;
        const v = toeZ(T, k, x, z);
        if (v > z1[c]) { z2[c] = z1[c]; k2[c] = k1[c]; z1[c] = v; k1[c] = k; } else if (v > z2[c]) { z2[c] = v; k2[c] = k; }
        const [s, w] = local(T, k, x, z);
        if (outline(T, k, s, w) > COVER_E + cell) continue;
        // (classés par instant de passage pénalisé, celui de la nappe)
        const lat = lateral(outline(T, k, s, w));
        if (lat <= 0) continue;
        const p = penal(passTime(T, k, s, w), lat), q = c * KEEP;
        if (p >= pt[q + KEEP - 1]) continue;
        let m = KEEP - 1;
        while (m > 0 && pt[q + m - 1] > p) { pt[q + m] = pt[q + m - 1]; pk[q + m] = pk[q + m - 1]; m--; }
        pt[q + m] = p; pk[q + m] = k;
      }
    }
  }
  let overflow = 0, empty = 0;
  for (let c = 0; c < NN; c++) {
    const ids = [];
    if (k1[c] >= 0) ids.push(k1[c]);
    if (k2[c] >= 0 && z2[c] > z1[c] - 0.03) ids.push(k2[c]); // (seulement s'il dispute le dessus)
    for (let m = 0; m < KEEP && ids.length < SLOTS; m++) { const k = pk[c * KEEP + m]; if (k >= 0 && !ids.includes(k)) ids.push(k); }
    if (!ids.length) empty++;
    if (pk[c * KEEP + KEEP - 1] >= 0) overflow++;
    for (let q = 0; q < SLOTS; q++) out[c * SLOTS + q] = q < ids.length ? ids[q] + 1 : 0;
  }
  return { lists: out, res, rows, overflow: overflow / NN, empty: empty / NN, F: Fmap };
}

// surface au temps t avec les listes (même calcul que le shader).
//
// Chaque point n'est couvert qu'une fois : par le PREMIER front d'orteil qui
// l'atteint (sinon un endroit déjà refroidi se rallumait quand un orteil plus
// jeune passait dessus — de la lave qui surgit un peu partout). Derrière ce
// front unique, la nappe prend sa forme finale R + h (l'orteil du dessus), au
// nez près, puis gonfle. L'ancienne nappe est le champ lu en (x, z) + delta.
export const COVER_E = 0.22; // (un orteil ne prétend couvrir que son contour et 6 cm de pied)
export function listAt(L, x, z) {
  const { lists, res, F } = L;
  const i = Math.min(res - 1, Math.max(0, Math.floor(((x + F) / (2 * F)) * res)));
  const j = Math.min(res - 1, Math.max(0, Math.floor(((z + F) / (2 * F)) * res)));
  const ids = [];
  for (let q = 0; q < SLOTS; q++) { const id = lists[(j * res + i) * SLOTS + q] - 1; if (id >= 0) ids.push(id); }
  return ids;
}
// relief, orteil du dessus, premier passage (instant) en (x, z) ; la part
// latérale d'un orteil (1 dans son contour, 0 à COVER_E au-delà) amincit sa
// lave vers son bord — sinon la limite de sa zone faisait une falaise
// (pleine jusqu'à 3 cm au-delà du contour : l'arbre couvre le champ à 4 cm près,
// tout point est donc à pleine part d'au moins un orteil — la boucle reste exacte)
export const lateral = (e) => 1 - sstep(0.06, COVER_E, e);
export function cellAt(T, L, x, z) {
  let R = -1e9, top = -1, ta = 1e9;
  const cov = [];
  for (const k of listAt(L, x, z)) {
    const v = toeZ(T, k, x, z);
    if (v > R) { R = v; top = k; }
    const [s, w] = local(T, k, x, z), lat = lateral(outline(T, k, s, w));
    if (lat > 0) {
      const pt = passTime(T, k, s, w);
      cov.push([k, s, w, lat, pt]);
      if (lat > 0.5 && pt < ta) ta = pt;
    }
  }
  return { R, top, ta, cov };
}
export const reliefAt = (T, L, x, z) => { const c = cellAt(T, L, x, z); return [c.R, c.top]; };
// La nappe en cours ne prend pas d'emblée la forme des pierres : la lave
// coule d'abord en nappe lisse (le relief flouté, plus son épaisseur h), qui
// remplit les creux entre les lobes et laisse affleurer leurs dos ; derrière
// le front, en refroidissant et en gonflant, elle se bombe en lobes jusqu'à
// redessiner exactement le motif de départ, une nappe plus haut (R + h).
export const FORM0 = 20, FORM1 = 360; // (s : de la nappe lisse aux lobes)
// La nappe est un seul corps : sa hauteur ne dépend que de l'instant de
// passage du front, champ continu (le minimum, sur les orteils, de leur
// instant de passage, pénalisé vers le bord de chacun) — pas d'un dépôt par
// orteil, qui laissait un pli et deux bourrelets entre deux orteils voisins.
export const NOSE_T = 14; // (s : le bourrelet du front, de 0 à toute l'épaisseur)
export const PEN_T = 40; // (s : pénalité d'un orteil vers son bord)
// (la pénalité tend vers l'infini au bord de la zone d'un orteil : le champ
// reste continu quand un orteil entre ou sort des candidats)
export const penal = (pt, lat) => pt + (PEN_T * (1 - lat)) / Math.max(lat, 1e-4);
export function frontTime(c) {
  let ta = 1e9;
  for (const [, , , lat, pt] of c.cov) if (lat > 0) ta = Math.min(ta, penal(pt, lat));
  return ta;
}
// Le bourrelet du front se règle en distance derrière le front de chaque
// orteil (continue dans toute sa zone) ; la nappe prend le plus haut des
// bourrelets. L'épaisseur et l'âge, eux, sont ceux de toute la nappe (premier
// passage) : un seul corps, sans couture ni pli entre deux orteils.
export const NOSE_R = 0.09, NOSE_K = 1.0; // (m, et × l'épaisseur)
export function surfaceFromLists(T, L, x, z, t, h, Bl) {
  const c = cellAt(T, L, x, z);
  const Rold = c.R, ta = frontTime(c), age = t - ta;
  const m = sstep(FORM0, FORM1, age), bl = blurAt(Bl, x, z), target = bl + h + (c.R - bl) * m;
  const th = Math.max(0, target - Rold), rn = NOSE_R + NOSE_K * th;
  let C = 0;
  for (const [k, s, w, lat] of c.cov) {
    const d = frontAt(T, k, t) - frontS(T, k, s, w);
    if (d > 0) C = Math.max(C, Math.sin(0.5 * Math.PI * clamp(d / rn, 0, 1)) * lat);
  }
  const S = Rold + th * C, layer = S > Rold + 0.003 ? 1 : 0;
  return { S, Rold, R: c.R, top: c.top, layer, age: layer ? Math.max(0.05, age) : (ta < 1e8 ? age : 20000) };
}

// Relief flouté (la nappe lisse) : R sur une grille res² du champ, flou gaussien
// σ ; même grille et même interpolation bilinéaire dans le shader.
export function bakeBlur(tree, res = 512, sigma = 0.12) {
  const { T, n, F } = tree, idx = makeIndex(T, n, F + 0.6), cell = (2 * F) / res;
  const A = new Float32Array(res * res), B = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) A[j * res + i] = topAt(T, idx, -F + (i + 0.5) * cell, -F + (j + 0.5) * cell, -0.3)[0];
  const r = Math.ceil((3 * sigma) / cell), w = [];
  let ws = 0;
  for (let q = -r; q <= r; q++) { const v = Math.exp(-0.5 * ((q * cell) / sigma) ** 2); w.push(v); ws += v; }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { let a = 0; for (let q = -r; q <= r; q++) a += w[q + r] * A[j * res + Math.min(res - 1, Math.max(0, i + q))]; B[j * res + i] = a / ws; }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { let a = 0; for (let q = -r; q <= r; q++) a += w[q + r] * B[Math.min(res - 1, Math.max(0, j + q)) * res + i]; A[j * res + i] = a / ws; }
  return { B: A, res, F };
}
export function blurAt(Bl, x, z) {
  const { B, res, F } = Bl;
  const fx = ((x + F) / (2 * F)) * res - 0.5, fz = ((z + F) / (2 * F)) * res - 0.5;
  const i = Math.min(res - 2, Math.max(0, Math.floor(fx))), j = Math.min(res - 2, Math.max(0, Math.floor(fz)));
  const u = clamp(fx - i, 0, 1), v = clamp(fz - j, 0, 1);
  const a = B[j * res + i], b = B[j * res + i + 1], c = B[(j + 1) * res + i], d = B[(j + 1) * res + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// tableau GPU des paramètres : 3 vec4 par orteil
export function packToes(tree) {
  return tree.T; // (déjà rangé par 12 = 3 × 4)
}

// Épaisseur de la nappe : assez pour que la nouvelle surface R(x) + h passe
// au-dessus de l'ancienne R(x + Δ) partout dans la zone vue (sinon une bosse
// de l'ancienne nappe percerait la nouvelle), plus une marge.
export function layerThickness(T, L, delta, [x0, x1, z0, z1], margin = 0.025, step = 0.02) {
  let m = 0;
  for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) {
    m = Math.max(m, reliefAt(T, L, x + delta[0], z + delta[1])[0] - reliefAt(T, L, x, z)[0]);
  }
  return m + margin;
}
