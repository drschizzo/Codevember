// Le film (module pur) : la boucle est une suite d'équilibres E₀ → E₁ → … →
// E₀. Chaque étape est une tenue (la chaîne immobile sur Eᵢ) puis une
// transition (la table calculée par le solveur, relue en Hermite). Chaque
// transition part au repos et arrive au repos, la machine revenue à son point
// zéro : l'état à u = 1 est exactement celui de u = 0, la boucle est parfaite
// par construction.
//
// Les transitions sont résolues depuis la forme canonique de leur équilibre
// de départ (chaque angle vaut 0 ou π) ; l'arrivée vaut ±π de plus sur les
// maillons qui basculent. Un angle ne compte qu'à 2π près (le rendu ne lit
// que des rotations), si bien que la fin d'une transition (−π, 3π…) raccorde
// exactement la tenue suivante (π).
//
// Ralenti de caméra rapide (temps fort) : la vitesse du film descend à κ
// autour de l'instant où la chaîne se pose, montée et descente en
// smoothstep ; temps physique τ(t) en forme fermée (∫ smoothstep = x³ − x⁴/2).
import { sampleTable } from './gen/shoot.js';

export const codeAngles = (code) => [...code].map((ch) => (ch === 'U' ? Math.PI : 0));

// transitions à résoudre : depuis l'équilibre i vers i+1 (le dernier revient au premier)
export function movesOf(R) {
  const seq = R.film.seq, k = seq.length;
  return R.film.moves.map((m, i) => {
    const a = seq[i], b = seq[(i + 1) % k];
    const th0 = codeAngles(a);
    // (grand tour : chaque maillon fait un tour entier)
    const th1 = th0.map((t, j) => (m.turn ? t + m.signs[j] * 2 * Math.PI : a[j] === b[j] ? t : t + m.signs[j] * Math.PI));
    return { i, from: a, to: b, th0, th1, T: m.T, signs: m.signs, slow: m.slow, turn: !!m.turn };
  });
}

const S3 = (x) => x * x * x - (x * x * x * x) / 2; // ∫₀ˣ smoothstep

// Fenêtre de ralenti d'une transition, en temps physique [p0, p1] (κ : vitesse
// du film dans la fenêtre, r : durée d'une rampe en temps du film)
export function slowWindow(T, catchAt, slow) {
  if (!slow || slow.k >= 0.999) return null;
  const k = slow.k, r = Math.min(0.35, 0.18 * T);
  const half = slow.span ?? 0.35;
  let p0 = Math.max(r * (1 + k) / 2 + 0.05, catchAt - half * 1.3);
  let p1 = Math.min(T - r * (1 + k) / 2 - 0.05, catchAt + half * 0.7);
  if (p1 <= p0 + 0.05) return null;
  const a = p0 - (r * (1 + k)) / 2; // début de la rampe (temps du film = temps physique avant)
  const Pf = (p1 - p0) / k;
  const F = T + (p1 - p0) * (1 / k - 1) + r * (1 - k);
  return { k, r, p0, p1, a, b: a + r + Pf, F };
}

// temps physique au temps du film t ∈ [0, F]
export function physTime(t, W, T) {
  if (!W) return Math.min(Math.max(t, 0), T);
  const { k, r, p0, p1, a, b } = W;
  if (t <= a) return Math.max(t, 0);
  if (t < a + r) { const x = (t - a) / r; return a + r * (x - (1 - k) * S3(x)); }
  if (t < b) return p0 + k * (t - a - r);
  if (t < b + r) { const x = (t - b) / r; return p1 + r * (k * x + (1 - k) * S3(x)); }
  return Math.min(T, p1 + (r * (1 + k)) / 2 + (t - b - r));
}
// vitesse du film (dτ/dt), pour la vitesse des pièces au rendu
export function physRate(t, W) {
  if (!W) return 1;
  const { k, r, a, b } = W;
  const sm = (x) => x * x * (3 - 2 * x);
  if (t <= a || t >= b + r) return 1;
  if (t < a + r) return 1 - (1 - k) * sm((t - a) / r);
  if (t < b) return k;
  return k + (1 - k) * sm((t - b) / r);
}

// Instant où la chaîne « se pose » : la dernière fois que son énergie
// potentielle entre dans la bande des 25 % autour de celle d'arrivée.
export function catchTime(sys, tab) {
  const { M, nx, dt } = tab, th = new Float64Array(sys.n), td = new Float64Array(sys.n), x = new Float64Array(nx);
  const pe = (i) => { x.set(tab.X.subarray(i * nx, i * nx + nx)); sys.angles(x, th, td); let v = 0; for (let j = 0; j < sys.n; j++) v -= sys.mu[j] * Math.cos(th[j]); return v; };
  const a = pe(0), b = pe(M - 1), band = Math.max(0.25 * Math.abs(b - a), 1e-4);
  let last = M - 1;
  for (let i = M - 1; i >= 0; i--) { if (Math.abs(pe(i) - b) > band) { last = i + 1; break; } if (i === 0) last = 0; }
  return Math.min(M - 1, last) * dt;
}

// Le film complet : durées, fenêtres, et l'état à toute phase u.
// tables[i] : table de la transition i (record() de gen/shoot.js).
export function buildFilm(R, sys, tables) {
  const moves = movesOf(R), k = moves.length;
  const steps = [];
  let t = 0;
  for (let i = 0; i < k; i++) {
    const hold = R.film.holds[i];
    steps.push({ kind: 'hold', i, t0: t, dur: hold, rest: sys.restState(codeAngles(R.film.seq[i])) });
    t += hold;
    const tab = tables[i], T = tab.T;
    const W = slowWindow(T, catchTime(sys, tab), moves[i].slow);
    const F = W ? W.F : T;
    steps.push({ kind: 'move', i, t0: t, dur: F, T, W, tab, catchAt: W ? (W.p0 + W.p1) / 2 : null });
    t += F;
  }
  const duration = t;
  const x = new Float64Array(sys.nx), th = new Float64Array(sys.n), thd = new Float64Array(sys.n);
  const find = (tf) => { for (let i = steps.length - 1; i >= 0; i--) if (tf >= steps[i].t0) return steps[i]; return steps[0]; };
  // état à la phase u (partie fractionnaire) : angles absolus des maillons,
  // coordonnée imposée et ses dérivées, quelle étape, avancement
  function at(u, out = {}) {
    const ph = u - Math.floor(u);
    const tf = ph * duration;
    const st = find(tf);
    let rate = 1, acc = 0;
    if (st.kind === 'hold') { x.set(st.rest); }
    else {
      const local = tf - st.t0, tp = physTime(local, st.W, st.T);
      sampleTable(st.tab, tp, x);
      rate = physRate(local, st.W);
      // accélération imposée (commande) : affine entre deux pas d'intégration
      const f = Math.min(Math.max(tp / st.tab.dt, 0), st.tab.M - 1 - 1e-9), i = Math.floor(f);
      acc = st.tab.U[i] + (st.tab.U[Math.min(i + 1, st.tab.M - 1)] - st.tab.U[i]) * (f - i);
      out.tp = tp; out.local = local;
    }
    sys.angles(x, th, thd);
    out.theta = Array.from(th); out.thetaDot = Array.from(thd, (v) => v * rate);
    out.s = x[2 * sys.np]; out.sd = x[2 * sys.np + 1] * rate; out.sdd = acc * rate * rate;
    out.step = st; out.rate = rate; out.tf = tf;
    return out;
  }
  return { steps, duration, at, moves };
}

// Un équilibre tenu n'est jamais immobile au micron : un pendule inversé ne
// tient debout que par les corrections continues de son moteur (le chariot,
// le bras, le coude ou le volant suivent la chaîne qui penche). Le rendu les
// ajoute pendant les tenues où un maillon est debout — quelques millièmes de
// radian, un ou deux millimètres de chariot —, nulles aux deux bouts de la
// tenue (les raccords et la boucle restent exacts, le film pur ne change pas).
// Sans elles, la chaîne debout se lit comme une image arrêtée.
const TREMOR = { cart: 1.5, rotary: 4, acrobat: 6, wheel: 60 }; // (coordonnée imposée par mètre de penchant)
export function tremor(R, out, amp = 1) {
  const st = out.step;
  if (!st || st.kind !== 'hold' || !(amp > 0)) return out;
  const code = R.film.seq[st.i];
  if (!code.includes('U')) return out;
  const t = out.tf - st.t0, D = st.dur;
  const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const w = sm(t / 0.6) * sm((D - t) / 0.6) * amp;
  if (w <= 0) return out;
  // (trois fréquences incommensurables, phases propres à la tenue : jamais un battement régulier)
  const p = st.i * 1.731 + 0.37;
  const sig = (a) => 0.55 * Math.sin(2 * Math.PI * 1.3 * t + a) + 0.3 * Math.sin(2 * Math.PI * 2.3 * t + 2.1 * a + 1) + 0.15 * Math.sin(2 * Math.PI * 3.7 * t + 3.3 * a + 2);
  const e1 = sig(p), e2 = sig(p + 2.4);
  let lean = 0;
  const L = R.machine.links;
  out.theta = out.theta.map((th, j) => {
    // (premier mode : toute la chaîne penche ; le second, plus faible, la plie)
    const d = 0.004 * w * (code[j] === 'U' ? 1 : 0.35) * (e1 + (j % 2 ? -0.5 : 0.25) * e2);
    lean += L[j].l * d;
    return th + d;
  });
  out.s += -(TREMOR[R.family] ?? 0) * lean;
  return out;
}
