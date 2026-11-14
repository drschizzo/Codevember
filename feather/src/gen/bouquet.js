// La gerbe : un bouquet de plumes qui poussent, se déplient, s'usent et sont
// chassées, chacune à son tour. Module pur (sans three.js) : la scène, la
// caméra, le banc des traversées et les tests lisent les mêmes fonctions.
//
// LE SOCLE. Le sommet arrondi d'une tête couverte de duvet (une calotte de
// rayon Rd, son sommet à l'origine, prolongée vers le bas par un cylindre qui
// sort du cadre) : un petit champ de follicules (une ptérylie, comme la huppe
// d'un oiseau) sur une couronne de rayon ρ autour du sommet. Les follicules
// d'une huppe sont inclinés vers l'extérieur (thF) : la gerbe s'évase dès la
// peau. La plume chassée glisse vers l'extérieur et tombe le long du flanc.
//
// L'ORDRE. Les follicules se suivent à l'angle d'or (137,5°) : le follicule i
// est à l'azimut i·φ_or, et sa plume a l'âge
//   a_i(φ) = frac(φ + i / N)
// (φ : la phase de la boucle). Deux plumes nées l'une après l'autre sont donc
// loin l'une de l'autre ; deux plumes voisines sur la couronne ont des âges
// très différents (les indices voisins à l'angle d'or diffèrent de 3, 5, 8…),
// donc des inclinaisons différentes : elles s'emboîtent comme des cônes au
// lieu de se croiser. Un zootrope : à chaque instant, une plume se déplie
// quelque part dans le bouquet, et la boucle se referme par construction.
//
// LE GESTE D'UNE PLUME (son âge a, le calendrier SCHED de gen/feather.js) :
// le tuyau sort du follicule, presque droit ; il s'ouvre ; en s'ouvrant, le
// vexille prend du poids et la plume se penche vers l'extérieur (le rachis
// fléchit) ; usée, elle est la plus penchée du bouquet ; puis le tuyau suivant
// la chasse du follicule et elle tombe (pesanteur, freinage de l'air).
//
// Chaque follicule a deux instances : la plume courante (id 2i) et l'ancienne
// qu'elle chasse (id 2i + 1, d'âge 1 + a). Au raccord a = 1 → 0, l'ancienne
// prend exactement la pose de la courante : rien ne saute.
import { FAMILIES } from '../families.js';
import { featherFrame, quatFromBasis, qrot, sinkAt, smoother, sstep, mix, clamp, SCHED, wearAt } from './feather.js';

const TAU = Math.PI * 2;
export const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // (137,5°)

// La gerbe de chaque famille.
//   N : plumes ; cap : rayon de la calotte (en L) ; rho : rayon de la couronne des follicules (en L) ; thF :
//   inclinaison des follicules ; lean : inclinaison de la plume en plus [tuyau,
//   ouverte, usée] (rad) ; kb : courbure du rachis (1/cm, × 1/L)
export const GERBE = {
  vexille: { N: 11, cap: 0.9, rho: 0.12, thF: 0.3, lean: [0.02, 0.34, 0.6], kb: 0.42 },
  ocelle: { N: 8, cap: 0.55, rho: 0.06, thF: 0.26, lean: [0.02, 0.3, 0.56], kb: 0.22 },
  duvet: { N: 6, cap: 1.8, rho: 0.75, thF: 0.3, lean: [0.06, 0.4, 0.62], kb: 0 },
  plume: { N: 7, cap: 0.6, rho: 0.09, thF: 0.2, lean: [0.02, 0.22, 0.42], kb: 0.36 },
};

// inclinaison d'une plume à l'âge a (monotone : elle ne se redresse jamais)
// — la sortie du tuyau, la pente que donne le poids du vexille qui s'ouvre
// (avec le déroulement), puis l'usure (le rachis se fatigue)
export function leanAt(G, a) {
  const [l0, l1, l2] = G.lean;
  return l0 + (l1 - l0) * smoother(SCHED.front[0], SCHED.settle[1], a) + (l2 - l1) * smoother(SCHED.settle[1], 1, a);
}

// Le plan du bouquet
export function layoutBouquet(P, seed, { lite = false } = {}) {
  const G = GERBE[P.family];
  let h = 2166136261;
  for (const ch of `gerbe:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const N = lite ? Math.max(6, Math.round(G.N * 0.75)) : G.N;
  const Rd = G.cap * P.L, az0 = rnd() * TAU;
  const follicles = [];
  for (let i = 0; i < N; i++) {
    follicles.push({
      i, az: az0 + i * GOLDEN, th: (G.rho * P.L * (0.85 + 0.3 * rnd())) / Rd, tilt: G.thF * (0.92 + 0.16 * rnd()),
      scale: 0.9 + 0.16 * rnd(), rnd: rnd(), lean: 0.94 + 0.12 * rnd(),
      roll: (rnd() - 0.5) * 0.1,
    });
  }
  // (la courbure du rachis de la famille, modulée par celle de la plume tirée
  // — le réglage « courbure du rachis » du panneau)
  const B = FAMILIES[P.family].bend, mid = Array.isArray(B) ? (B[0] + B[1]) / 2 : B;
  const kb = (G.kb / P.L) * (mid > 0 ? clamp(P.bend / mid, 0, 2.5) : 1);
  return { G, N, Rd, follicles, kb, center: [0, 0.4 * P.L, 0] };
}

// Le socle : un point à l'abscisse curviligne s le long d'un méridien (depuis
// le sommet), d'azimut φ — sur la calotte puis sur le cylindre. Rend { p, n,
// d (vers le bas, le long du méridien) }.
export function surfaceAt(Rd, s, ph) {
  const cp = Math.cos(ph), sp = Math.sin(ph);
  const th = Math.min(s / Rd, Math.PI / 2), below = Math.max(0, s - (Rd * Math.PI) / 2);
  const n = [Math.sin(th) * sp, Math.cos(th), Math.sin(th) * cp];
  const d = [Math.cos(th) * sp, -Math.sin(th), Math.cos(th) * cp];
  const p = [n[0] * Rd, n[1] * Rd - Rd - below, n[2] * Rd];
  return { p, n, d };
}
// distance signée au socle (négative dedans)
export function surfaceDist(Rd, w) {
  const y = w[1] + Rd;
  return y > 0 ? Math.hypot(w[0], y, w[2]) - Rd : Math.hypot(w[0], w[2]) - Rd;
}

// âge de la plume du follicule i à la phase φ (0 ≤ a < 1)
export const ageOf = (lay, i, ph) => { const a = ph + i / lay.N; return a - Math.floor(a); };

// inclinaison de la plume du follicule f à l'âge a, sur la normale du socle :
// le tuyau sort presque droit (le follicule ne s'incline qu'avec la plume
// qui s'ouvre : un tuyau penché passait sous les bases larges de ses voisines)
export const betaOf = (lay, f, a) => f.tilt * (0.3 + 0.7 * smoother(SCHED.front[0], SCHED.settle[1], a)) + leanAt(lay.G, a) * f.lean;

// repère de la plume du follicule f à l'âge a
export function frameAt(lay, f, a) {
  const beta = betaOf(lay, f, a);
  return featherFrame(lay.Rd, f.th, f.az, beta, f.roll);
}

// pointe du tuyau qui pousse dans le follicule f (âge a), dans le monde
export function pinTipB(lay, f, a, P) {
  const fr = frameAt(lay, f, a);
  const hgt = Math.max(0, P.L * f.scale - sinkAt(a, P.L, P.calamus, P.over) * f.scale);
  return qrot(fr.q, [0, hgt, 0]).map((v, k) => v + fr.p[k]);
}


// repère d'une plume posée sur le socle au point { p, n, d } : dressée de β
// (0 : selon la normale, π/2 : couchée vers le bas du méridien), roulée de ω
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function frameOnSurface({ n, d }, beta, omega) {
  let Y = n.map((v, i) => v * Math.cos(beta) + d[i] * Math.sin(beta));
  let Z = n.map((v, i) => v * Math.sin(beta) - d[i] * Math.cos(beta));
  let X = crs(Y, Z);
  const co = Math.cos(omega), so = Math.sin(omega);
  [X, Z] = [X.map((v, i) => v * co + Z[i] * so), Z.map((v, i) => v * co - X[i] * so)];
  return quatFromBasis(X, Y, Z);
}

// La chute de l'ancienne. Pendant la poussée, le tuyau qui sort chasse son
// calamus hors du follicule : elle glisse le long de son propre axe. Libre,
// elle bascule vers l'extérieur (elle était déjà la plus penchée de la gerbe),
// se couche sur le duvet et glisse le long du méridien, de plus en plus vite à
// mesure que la pente du socle grandit, puis le long du flanc, hors du cadre.
// (ralenti ×8 : une caméra rapide ; la boucle de référence dure 36 s)
export const FALL = { slowmo: 8, lie: Math.PI / 2 - 0.16 };
export function oldPose(lay, f, a, P) {
  const fr = frameAt(lay, f, 1);
  const q1 = fr.q, Y0 = qrot(q1, [0, 1, 0]);
  const push = Math.min(a, SCHED.push[1]);
  const out0 = Math.max(0, P.L - sinkAt(push, P.L, P.calamus, P.over)) * f.scale;
  const slide = Math.min(out0, 0.85 * P.calamus * P.L * f.scale);
  if (a <= SCHED.push[1]) return { p: fr.p.map((v, k) => v + Y0[k] * slide), q: q1, vis: 1 };
  const T = ((a - SCHED.push[1]) * 36) / FALL.slowmo; // (s, temps réel)
  const L = P.L * f.scale;
  // la bascule (la pesanteur la couche, ~0,3 s), puis le glissement
  const k = smoother(0, 0.3, T);
  const beta0 = betaOf(lay, f, 1);
  const beta = beta0 + (FALL.lie - beta0) * k;
  const s = f.th * lay.Rd + L * (1.0 * T * T + 6 * Math.max(0, T - 0.1) ** 2);
  const S = surfaceAt(lay.Rd, s, f.az);
  const lift = 0.025 * L * k; // (couchée sur le duvet)
  // (l'axe sorti du follicule s'efface à mesure qu'elle se couche)
  const p = S.p.map((v, i) => v + S.n[i] * lift + Y0[i] * slide * (1 - k));
  const wob = 0.12 * Math.sin(T * 9) * sstep(0.15, 0.4, T);
  const q = frameOnSurface(S, beta, f.roll + wob);
  // retirée une fois hors du cadre (plus d'une longueur sous le sommet)
  return { p, q, vis: S.p[1] > -1.1 * P.L ? 1 : 0 };
}

// L'état de toutes les plumes à la phase φ : [{ id, kind, p, q, scale, u, wear, rnd, vis, f }]
export function bouquetState(R, lay, ph) {
  const P = R.shape, out = [];
  for (const f of lay.follicles) {
    const a = ageOf(lay, f.i, ph);
    const fr = frameAt(lay, f, a);
    out.push({ id: 2 * f.i, kind: 'new', p: fr.p, q: fr.q, scale: f.scale, u: a, wear: wearAt(a), rnd: f.rnd, vis: 1, f: f.i });
    const o = oldPose(lay, f, a, P);
    // (l'ancienne n'existe que pendant la poussée et la chute)
    const vis = a < SCHED.fall[1] + 0.08 ? o.vis : 0;
    out.push({ id: 2 * f.i + 1, kind: 'old', p: o.p, q: o.q, scale: f.scale, u: 1, wear: 1, rnd: f.rnd, vis, f: f.i });
  }
  return out;
}

// poids de la plume « en train de se déplier » (pour la mise au point) : une
// cloche sur la fenêtre du déroulement
export const unfoldWeight = (a) => sstep(SCHED.grow[1] - 0.06, SCHED.front[0] + 0.06, a) * (1 - sstep(SCHED.front[1] - 0.04, SCHED.bend[1], a));

void mix;
