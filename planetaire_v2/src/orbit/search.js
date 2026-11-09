// Une graine → une chorégraphie.
//
// La graine fixe le problème (nombre de corps, vitesse du repère tournant,
// classe de symétrie : voir symmetry.js) ; chaque essai part d'une courbe
// aléatoire de la classe, la détend en minimisant l'action sous une force
// forte qui garde sa tresse, puis sous la seule gravitation, et la polit par
// la méthode de Newton avec de plus en plus d'harmoniques. Passé 12 essais
// infructueux (4 pour une classe faible), la classe est abandonnée. L'orbite
// n'est retenue que si elle passe toutes les épreuves :
//   - convergence (gradient de l'action presque nul) ;
//   - pas de collision ni de frôlement extrême ;
//   - pas le polygone de Lagrange (une seule harmonique : un cercle), ni une
//     orbite plus simple parcourue plusieurs fois ;
//   - certificat : la loi de Newton est satisfaite tout le long de la courbe
//     (résidu relatif < 10⁻⁴).
// Les essais d'une graine sont indépendants (on peut les lancer en parallèle) ;
// le premier essai réussi, par ordre d'indice, fait foi : même graine, même orbite.
import { createRng } from '../rng.js';
import { createAction } from './action.js';
import { lbfgs } from './lbfgs.js';
import { newton } from './newton.js';
import { pickSymmetry, initialGuessSym } from './symmetry.js';
import { analyze, residual, spectrum as spectrumOf } from './classify.js';
import { closure, monodromyRadius } from './integrate.js';

// ω = p/q (|ω| ≤ 1,2), petits dénominateurs favorisés (boucle de q périodes)
const FRACTIONS = [];
for (const q of [1, 2, 3, 4, 5]) {
  for (let p = -6; p <= 6; p++) {
    const g = (a, b) => (b ? g(b, a % b) : a);
    if (p && g(Math.abs(p), q) === 1 && Math.abs(p / q) <= 1.2) FRACTIONS.push([[p, q], 6 - q]);
  }
}

export const STRATEGIES = ['spectre', 'tresse', 'boucles', 'entrelacs'];

// over : contraintes imposées (N, sym — null pour aucune —, omegaFrac [p, q]) ;
// les tirages se font toujours dans le même ordre, si bien qu'une graine sans
// contrainte donne toujours la même orbite
export function orbitParams(seed, over = {}) {
  const { N: oN, sym: oSym, omegaFrac: oFrac, ...rest } = over;
  const rng = createRng(`orbit:${seed}`);
  const N0 = rng.weighted([[3, 3], [4, 3], [5, 3], [6, 2], [7, 2], [8, 1], [9, 1]]);
  const N = oN ?? N0;
  // l'espace est en attente : sans symétrie imposée, la minimisation aplatit
  // toute courbe gauche (voir README, « Ce qui reste à faire »)
  const D = rest.D ?? 2;
  // vitesse du repère tournant : rationnelle, ω = p/q. Le plateau du planétaire
  // tourne à ω ; après q périodes il a fait p tours entiers : la boucle est
  // parfaite, et tous les rapports d'engrenage sont rationnels
  const drawn = rng.chance(0.3) ? [0, 1] : rng.weighted(FRACTIONS);
  const [pw, qw] = oFrac ?? drawn;
  // classe de symétrie (plan seulement) : m pétales, miroir
  const symDrawn = D === 2 ? pickSymmetry(rng, N) : null;
  const sym = oSym !== undefined ? oSym : symDrawn;
  return { N, D, omega: pw / qw, omegaFrac: [pw, qw], sym, Kc: 12, K: 32, Kmax: 128, ...rest };
}

// courbe de départ : quelques harmoniques dominantes (permises : k non multiple
// de N), un peu de toutes les autres
function initialGuess(p, rng, Kc) {
  const { N, D } = p;
  if (p.sym) return { c: initialGuessSym(p, rng, Kc), strategy: 'symétrie' };
  const c = new Float64Array(Kc * 2 * D);
  const allowed = [];
  for (let k = 1; k <= Kc; k++) if (k % N) allowed.push(k);
  const strategy = rng.pick(STRATEGIES);
  const dom = new Map();
  if (strategy === 'spectre') {
    // deux ou trois harmoniques basses, au hasard
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) dom.set(rng.pick(allowed.filter((k) => k <= 2 * N)), rng.range(0.4, 1));
  } else if (strategy === 'tresse') {
    // une harmonique porteuse et une harmonique voisine forte : des corps qui se doublent
    const k0 = rng.pick(allowed.filter((k) => k <= N + 1));
    dom.set(k0, 1);
    const k1 = rng.pick(allowed.filter((k) => k !== k0 && k <= 3 * N));
    dom.set(k1, rng.range(0.3, 0.9));
  } else if (strategy === 'entrelacs') {
    // trois ou quatre harmoniques fortes, jusqu'à 4N : une tresse très croisée
    const pool = allowed.filter((k) => k <= Math.min(Kc, 4 * N));
    const n = rng.int(3, 4);
    for (let i = 0; i < n; i++) dom.set(rng.pick(pool), rng.range(0.35, 1));
  } else {
    // boucles : une harmonique haute qui fait des épicycles
    dom.set(1 % N ? 1 : 2, 1);
    dom.set(rng.pick(allowed.filter((k) => k > 2 && k <= 3 * N)), rng.range(0.2, 0.6));
  }
  const zScale = D === 3 ? rng.range(0.3, 1) : 0;
  for (const k of allowed) {
    const amp = (dom.get(k) ?? 0.08) / Math.sqrt(k);
    for (let s = 0; s < 2; s++) {
      for (let d = 0; d < D; d++) c[(k - 1) * 2 * D + s * D + d] = amp * rng.gauss() * (d === 2 ? zScale : 1);
    }
  }
  return { c, strategy };
}

// mise à l'échelle optimale : l'action vaut a·λ² + b/λ, minimale pour λ³ = b / 2a
function rescale(act, c) {
  act.evaluate(c);
  const { T, P } = act.out;
  if (!(T > 0) || !Number.isFinite(P)) return;
  const l = Math.cbrt(P / (2 * T));
  for (let i = 0; i < c.length; i++) c[i] *= l;
}

// Deux façons de passer de la tresse de départ à une orbite newtonienne :
//   - « descente » : on relâche la force forte en continuant de minimiser ;
//     la courbe peut alors se dénouer vers l'orbite la plus simple à sa portée
//     (souvent une parente du huit) ;
//   - « continuation » : on minimise une fois sous force forte (le minimum
//     existe dans chaque tresse), puis on suit ce point critique pendant que
//     ε décroît jusqu'à zéro, par la méthode de Newton. Rien ne force le
//     point final à être un minimum : on obtient aussi des points selles de
//     l'action newtonienne, des orbites que la descente ne trouve jamais ;
//   - « selle » : Newton directement depuis la courbe aléatoire (à la manière
//     de Simó) ; il converge vers le point critique le plus proche, quel que
//     soit son indice.
export const MODES = ['descente', 'continuation', 'selle'];

export function attempt(p, rng, { onIter = null, index = 0 } = {}) {
  const t0 = now();
  // repli : passé SYM_TRIES essais infructueux, la classe est abandonnée
  if (p.sym && index >= (p.sym.weak ? SYM_TRIES_WEAK : SYM_TRIES)) p = { ...p, sym: null };
  const { c: c0, strategy } = initialGuess(p, rng, p.Kc);
  const mode = p.mode ?? 'descente';
  const base = { strategy, mode, iters: 0, evals: 0 };
  const fail = (reason) => ({ ...base, ok: false, reason, ms: now() - t0 });
  const tally = (r) => { base.iters += r.iters; base.evals += r.evals; return r; };
  const live = (stage, act) => onIter && ((it, f, g, xx) => onIter(stage, it, f, g, xx, act));

  let x = c0;
  if (mode === 'descente') {
    // force forte décroissante, descente à chaque palier
    for (const [i, strong] of STRONG.entries()) {
      const act = createAction({ ...p, K: p.Kc, strong });
      if (i === 0) rescale(act, x);
      const r = tally(lbfgs(act.evaluate, x, { maxIter: 1500, gtol: 1e-5, diag: act.precond, onIter: live(`ε ${strong}`, act) }));
      if (!Number.isFinite(r.f)) return fail('collision');
      x = r.x;
    }
  } else if (mode === 'selle') {
    for (const K of [p.Kc, p.K]) {
      const act = createAction({ ...p, K });
      x = prolong(x, act.nv);
      if (K === p.Kc) rescale(act, x);
      const r = tally(newton(act.evaluate, x, act.precond, { gtol: 1e-8, maxIter: 60, onIter: live(`Newton K ${K}`, act) }));
      if (!Number.isFinite(r.f)) return fail('collision');
      if (r.status !== 'converged') return fail('Newton égaré');
      x = r.x;
    }
  } else {
    // minimum sous force forte, à peu d'harmoniques puis à K
    for (const K of [p.Kc, p.K]) {
      const act = createAction({ ...p, K, strong: EPS0 });
      x = prolong(x, act.nv);
      if (K === p.Kc) rescale(act, x);
      const r = tally(lbfgs(act.evaluate, x, { maxIter: 1500, gtol: 1e-6, diag: act.precond, onIter: live(`ε ${EPS0}`, act) }));
      if (!Number.isFinite(r.f)) return fail('collision');
      x = r.x;
    }
    // puis on suit le point critique jusqu'à ε = 0
    const reach = (a, b, depth) => {
      const act = createAction({ ...p, strong: b });
      const r = tally(newton(act.evaluate, x, act.precond, { gtol: 1e-8, maxIter: 15, onIter: live(`ε ${b.toFixed(4)}`, act) }));
      if (r.status === 'converged') { x = r.x; return true; }
      if (depth >= 3) return false;
      const m = (a + b) / 2;
      return reach(a, m, depth + 1) && reach(m, b, depth + 1);
    };
    let cur = EPS0;
    for (const e of EPS_SCHEDULE) {
      if (!reach(cur, e, 0)) return fail('continuation rompue');
      cur = e;
    }
  }
  if (topShare(x, { ...p, K: Math.min(p.Kc, x.length / (2 * p.D)) }) > 0.995) return fail('Lagrange');

  // raffinement : on double le nombre d'harmoniques tant que la loi de Newton
  // n'est pas satisfaite à RESIDUAL près (le spectre décroît d'autant plus
  // lentement que les corps se frôlent) ; Newton, qui ne quitte pas un point selle
  let q = p, info = null, res = null, r2 = null;
  const reject = (reason) => ({ ...base, ...(res || {}), ok: false, reason, ms: now() - t0 });
  for (let K = p.K; K <= p.Kmax; K *= 2) {
    q = { ...p, K };
    const act = createAction(q);
    x = prolong(x, act.nv);
    r2 = tally(newton(act.evaluate, x, act.precond, { gtol: 1e-9, maxIter: 20, onIter: live(`K ${K}`, act) }));
    if (r2.status !== 'converged' && mode === 'descente') {
      // la descente grossière était loin du but : on minimise, puis on polit
      const r = tally(lbfgs(act.evaluate, x, { maxIter: 3000, gtol: 1e-7, diag: act.precond }));
      r2 = tally(newton(act.evaluate, r.x, act.precond, { gtol: 1e-9, maxIter: 20 }));
    }
    if (!Number.isFinite(r2.f)) return reject('collision');
    x = r2.x;
    info = analyze(x, q, r2.f);
    res = { coef: x, params: q, action: r2.f, gnorm: r2.gnorm, info };
    // rejets précoces, inutile de raffiner
    if (info.ratio < 0.03) return reject('frôlement');
    if (info.top > 0.9995) return reject('Lagrange');
    if (p.D === 3 && info.zShare < 1e-6) return reject('plane');
    if (info.cover > 1) return reject('parcourue plusieurs fois');
    res.residual = residual(x, q);
    if (res.residual < RESIDUAL) break;
    // très loin du but à 64 harmoniques : 128 n'y suffiront pas (frôlement serré)
    if (K >= 64 && res.residual > 100 * RESIDUAL) return reject('non résolue');
  }
  if (r2.gnorm > 1e-6) return reject('non convergée');
  if (!(res.residual < RESIDUAL)) return reject('non résolue');
  return { ...base, ...res, ok: true, ms: now() - t0 };
}

function prolong(x, nv) {
  if (x.length === nv) return x;
  const c = new Float64Array(nv);
  c.set(x.subarray(0, Math.min(x.length, nv)));
  return c;
}

const RESIDUAL = 1e-4;
const SYM_TRIES = 12, SYM_TRIES_WEAK = 4; // (classe faible : le polygone y gagne presque toujours)
const STRONG = [0.2, 0.05, 0.01, 0];
const EPS0 = 0.2;
const EPS_SCHEDULE = [0.14, 0.1, 0.07, 0.05, 0.035, 0.025, 0.017, 0.012, 0.008, 0.005, 0.003, 0.0015, 0];

// recherche complète : essais successifs jusqu'à une orbite valide
export function search(seed, { maxAttempts = 24, stability = true, onAttempt = null, onIter = null, over } = {}) {
  const p = orbitParams(seed, over);
  const t0 = now();
  const tries = [];
  for (let a = 0; a < maxAttempts; a++) {
    const rng = createRng(`orbit:${seed}:${a}`);
    const r = attempt(p, rng, { onIter, index: a });
    tries.push({ ok: r.ok, reason: r.reason, strategy: r.strategy, ms: r.ms });
    if (onAttempt) onAttempt(a, r);
    if (r.ok) {
      if (stability) {
        const ts = now();
        r.rho = monodromyRadius(r.coef, r.params, r.info.size);
        r.closure = closure(r.coef, r.params, r.info.size).error;
        r.stable = r.rho < 1.01;
        r.msStability = now() - ts;
      }
      return { seed, params: r.params, ok: true, orbit: r, tries, ms: now() - t0 };
    }
  }
  return { seed, params: p, ok: false, tries, ms: now() - t0 };
}

function topShare(c, p) {
  const { e, total } = spectrumOf(c, p);
  return Math.max(...e) / total;
}

const now = () => (globalThis.performance ? performance.now() : Date.now());
