// La mise en scène : le temps de l'orbite et la caméra, en fonction de la
// seule phase L ∈ [0, 1) de la boucle (donc sans couture).
//
// ── Les ralentis. Le temps de l'orbite τ est déformé autour des passages
// serrés (plus courtes approches entre deux astres), avec le noyau de Hollow :
//   τ(t) = t − Σ a·w·K((t − t_b)/w),  K(x) = x − 3x³ + 3x⁵ − x⁷,
// dont la dérivée (1 − 7x²)(1 − x²)² est d'intégrale nulle : au passage la
// vitesse tombe à 1 − a, se rattrape de part et d'autre, rejoint 1 sans
// à-coup en ±w, et τ(t_b) = t_b. Le temps total de la boucle est conservé.
// Par symétrie, un passage serré revient N fois par période : c'est une
// pulsation, dont la graine choisit les accents (forts, faibles, silences).
//
// ── La caméra. Une suite de plans (ensemble, rasant, zénith, astre, machine),
// chacun une fonction lisse de sa phase locale, en coordonnées sphériques
// autour d'une cible ; d'un plan au suivant, un fondu (azimut par le plus
// court chemin, élévation, distance, cible) : la caméra tourne autour de la
// machine sans jamais la traverser. Elle vit en temps réel : pendant un
// ralenti, le monde ralentit, pas elle.
import { createRng } from '../rng.js';
import { curveAt } from '../orbit/action.js';

const TAU = Math.PI * 2;
const K7 = (x) => x - 3 * x ** 3 + 3 * x ** 5 - x ** 7;
const ss5 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// plus courte distance entre deux astres à l'instant t (repère du plateau)
function minPair(coef, p, t, a, b) {
  const { N } = p;
  let m = Infinity;
  for (let i = 0; i < N; i++) {
    curveAt(coef, p, t + (TAU * i) / N, a);
    for (let j = i + 1; j < N; j++) {
      curveAt(coef, p, t + (TAU * j) / N, b);
      m = Math.min(m, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
  }
  return m;
}

// ralentis sur une boucle de q périodes (temps de l'orbite, 0 … 2πq)
export function beatsFor(coef, p, q, seed, strength = 1) {
  const rng = createRng(`choreo:${seed}`);
  const { N } = p, span = TAU / N, n = 256;
  const a = new Float64Array(2), b = new Float64Array(2);
  // la fonction « plus courte distance » a la période 2π/N : on cherche son
  // minimum le plus profond sur une seule tranche
  let tMin = 0, dMin = Infinity;
  for (let i = 0; i < n; i++) {
    const t = (span * i) / n, d = minPair(coef, p, t, a, b);
    if (d < dMin) { dMin = d; tMin = t; }
  }
  // affinage (section dorée)
  let lo = tMin - span / n, hi = tMin + span / n;
  for (let i = 0; i < 40; i++) {
    const m1 = hi - (hi - lo) * 0.618, m2 = lo + (hi - lo) * 0.618;
    if (minPair(coef, p, m1, a, b) < minPair(coef, p, m2, a, b)) hi = m2; else lo = m1;
  }
  tMin = (lo + hi) / 2;
  // passages : tMin + k·2π/N sur toute la boucle ; au plus ~4 par période
  const stride = Math.max(1, Math.ceil(N / 4));
  const count = Math.round((q * N) / stride);
  const gap = span * stride;
  const accents = [rng.range(0.55, 0.72), rng.range(0.2, 0.45), rng.range(0.35, 0.6), rng.range(0.15, 0.4)];
  const beats = [];
  for (let k = 0; k < count; k++) {
    // un silence de temps en temps : la pulsation respire
    const silent = count > 3 && rng.chance(0.18);
    beats.push({ t: tMin + k * gap, a: silent ? 0 : Math.min(0.92, accents[k % accents.length] * strength), w: Math.min(0.42 * gap, 0.9) });
  }
  return { beats, loop: TAU * q, dMin };
}

// temps de l'orbite déformé ; open ∈ [0, 1] : profondeur du ralenti en cours.
// (la correction est périodique, de période B.loop : on la calcule sur t ramené
// dans [0, B.loop), pour tout t)
export function warp(t, B) {
  const tm = ((t % B.loop) + B.loop) % B.loop;
  const r = warp0(tm, B);
  return { tau: t + (r.tau - tm), open: r.open };
}
function warp0(t, B) {
  let tau = t, open = 0;
  for (const b of B.beats) {
    for (const off of [-B.loop, 0, B.loop]) {
      const x = (t - b.t - off) / b.w;
      if (Math.abs(x) >= 1) continue;
      tau -= b.a * b.w * K7(x);
      open = Math.max(open, b.a * (1 - x * x) ** 2);
    }
  }
  return { tau, open };
}

// ── caméra ──────────────────────────────────────────────────────────────────

// balayage d'azimut de chaque plan (radians, sur la durée du plan)
const SWEEP = { ensemble: 0.9, rasant: 0.6, zenith: 0.45, astre: 0.8, machine: 0.7 };
const SHOTS = {
  // plan d'ensemble : la machine entière, en légère plongée
  ensemble: (u, s, c) => ({ az: s.az0 + s.dir * SWEEP.ensemble * u, el: 0.62, r: 1, ty: (c.y.body + c.y.top) / 2, fov: 30 }),
  // rasant : à hauteur des astres, au-dessus de la forêt des roues
  rasant: (u, s, c) => ({ az: s.az0 + s.dir * SWEEP.rasant * u, el: 0.1, r: 0.78, ty: c.y.body + 0.03, fov: 30 }),
  // zénith : la courbe et ses sillons vus comme un dessin
  zenith: (u, s, c) => ({ az: s.az0 + s.dir * SWEEP.zenith * u, el: 1.38, r: 0.98, ty: c.y.plate, fov: 30 }),
  // astre : on suit l'un d'eux de près
  astre: (u, s, c) => ({ az: s.az0 + s.dir * SWEEP.astre * u, el: 0.34, r: 0.5, follow: c.body(s.body), ty: c.y.body + 0.05, fov: 28 }),
  // machine : les étages de roues, depuis le bas
  machine: (u, s, c) => ({ az: s.az0 + s.dir * SWEEP.machine * u, el: 0.16, r: 0.55, ty: (c.y.plate + c.y.top) / 2, fov: 30 }),
};

export function shotsFor(seed, duration, N, shotLength = 6) {
  const rng = createRng(`shots:${seed}`);
  const count = Math.max(2, Math.round(duration / shotLength));
  const kinds = ['ensemble'];
  const pool = ['rasant', 'zenith', 'astre', 'machine', 'ensemble'];
  while (kinds.length < count) {
    const k = rng.pick(pool);
    if (k !== kinds[kinds.length - 1] && !(kinds.length === count - 1 && k === kinds[0])) kinds.push(k);
  }
  // azimuts : chaque plan reprend à peu près où le précédent s'arrête, et la
  // suite se referme sur un nombre entier de tours (pas de saut à la couture)
  const dirs = kinds.map(() => rng.sign());
  const inc = kinds.map((k, i) => dirs[i] * SWEEP[k] + rng.range(-0.3, 0.3));
  const total = inc.reduce((a, b) => a + b, 0);
  const fix = (TAU * Math.round(total / TAU) - total) / kinds.length;
  let az = rng.range(0, TAU);
  return kinds.map((kind, i) => {
    const s = { kind, az0: az, dir: dirs[i], body: rng.int(0, N - 1) };
    az += inc[i] + fix;
    return s;
  });
}

// pose de la caméra à la phase L : { pos, target, fov }
export function cameraAt(L, shots, ctx) {
  const n = shots.length, x = L * n, k = Math.floor(x) % n, u = x - Math.floor(x);
  const H = 0.3; // demi-largeur du fondu, en fraction de plan
  const pose = (i, uu) => {
    const s = shots[(i + n) % n], c = SHOTS[s.kind](uu, s, ctx);
    const tx = c.follow ? c.follow[0] * 0.6 : 0, tz = c.follow ? c.follow[2] * 0.6 : 0;
    return { az: c.az, el: c.el, r: c.r * ctx.fit, tx, ty: c.ty, tz, fov: c.fov };
  };
  let P = pose(k, u);
  // monture suspendue : on regarde la machine par en dessous, sans descendre sous le sol
  const flipEl = (Q) => { if (ctx.flip) Q.el = Q.el > 1 ? -0.22 : Q.el > 0.5 ? -0.17 : -0.06; return Q; };
  P = flipEl(P);
  // fondu avec le plan précédent (début de plan) ou suivant (fin de plan)
  let Q = null, w = 0;
  if (u < H) { Q = flipEl(pose(k - 1, 1 + u)); w = 0.5 - 0.5 * ss5(u / H); }
  else if (u > 1 - H) { Q = flipEl(pose(k + 1, u - 1)); w = 0.5 * ss5((u - (1 - H)) / H); }
  if (Q) {
    const az = P.az + wrapPi(Q.az - P.az) * w;
    const m = (a, b) => a + (b - a) * w;
    P = { az, el: m(P.el, Q.el), r: m(P.r, Q.r), tx: m(P.tx, Q.tx), ty: m(P.ty, Q.ty), tz: m(P.tz, Q.tz), fov: m(P.fov, Q.fov) };
  }
  const r = P.r * (1 + 0.07 * ctx.open);
  const ce = Math.cos(P.el);
  return {
    pos: [P.tx + Math.cos(P.az) * ce * r, P.ty + Math.sin(P.el) * r, P.tz + Math.sin(P.az) * ce * r],
    target: [P.tx, P.ty, P.tz], fov: P.fov,
  };
}
