// L'horloge unique du film. Module pur : la scène, les tests et les bancs le lisent.
//
// Le soleil : H(u) = H_s + 2π · w(u), où w est l'intégrale d'une vitesse
// ρ(u) = 1 − c · Σ_k bosse(u − u_k), normalisée pour que w(1) = 1. Autour des
// deux figures (u_k), le soleil ralentit à (1 − c) de sa vitesse moyenne :
// c'est un accéléré à vitesse variable, une convention de cinéma qui ne touche
// que l'horloge. w est strictement croissante (ρ > 0) et H(1) = H(0) + 2π :
// le soleil fait exactement un tour, la boucle est parfaite.
//
// La caméra : des poses clés (une tenue sur chaque figure, dans l'axe de son
// ombre, et une ronde rapprochée autour de l'objet pendant le reste du jour),
// interpolées par une spline de Catmull-Rom périodique en u. L'azimut fait un
// tour entier par boucle, comme le soleil.
import { sunAt, DEG } from './shadowart.js';

const TAU = Math.PI * 2;
const N = 1024; // table de w

function bump(x, s) { x -= Math.round(x); return Math.exp(-((x / s) ** 2)); }

// Table de w(u) pour des tenues en u_k ; c : ralentissement ; s : largeur.
function warpTable(uk, c = 0.86, s = 0.05) {
  const rho = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) { const u = i / N; let b = 0; for (const k of uk) b += bump(u - k, s); rho[i] = 1 - c * Math.min(1, b); }
  const W = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) W[i] = W[i - 1] + (rho[i - 1] + rho[i]) / 2 / N;
  const tot = W[N];
  for (let i = 0; i <= N; i++) W[i] /= tot;
  return W;
}
const lookup = (W, u) => {
  const f = u - Math.floor(u), x = f * N, i = Math.min(N - 1, Math.floor(x));
  return Math.floor(u) + W[i] + (W[i + 1] - W[i]) * (x - i);
};

// Les temps du film, calculés une fois par recette : u1 (première figure)
// est fixé, u2 tel que le soleil aille de H1 à H2 entre les deux tenues.
const cache = new WeakMap();
export function timeline(R) {
  let T = cache.get(R.sun);
  const key = `${R.object.figs.map((f) => f.H).join()}:${R.loop.u1}`;
  if (T && T.key === key) return T;
  const [H1, H2] = R.object.figs.map((f) => f.H);
  const frac = (((H2 - H1) % TAU) + TAU) % TAU / TAU; // part du jour entre les deux figures
  const u1 = R.loop.u1;
  // u2 par dichotomie : w(u2) − w(u1) = frac
  let lo = u1, hi = u1 + 1, W = null;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    W = warpTable([u1, mid]);
    if (lookup(W, mid) - lookup(W, u1) < frac) lo = mid; else hi = mid;
  }
  const u2 = (lo + hi) / 2;
  W = warpTable([u1, u2]);
  T = { key, u1, u2, W, Hs: H1 - TAU * lookup(W, u1) };
  cache.set(R.sun, T);
  return T;
}

export function hourAngle(R, u) {
  const T = timeline(R);
  return T.Hs + TAU * lookup(T.W, u);
}

// ── Caméra ──
// pose : { az (°, direction du regard), pl (plongée, °), dist, tx, tz, ty }
const lerp = (a, b, t) => a + (b - a) * t;
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Poses clés. place : sortie du worker (centre de l'ombre de chaque figure,
// longueur) ; sans elle (avant la génération), une pose de repli.
export function cameraKeys(R, place) {
  const T = timeline(R), C = R.camera;
  const figs = R.object.figs;
  const half = Math.tan(C.fov * DEG / 2);
  const hold = figs.map((f, k) => {
    const P = place?.[k];
    // le cadre tient l'objet (au pied) et toute l'ombre : centre ramené vers
    // l'objet, étendue = ombre + objet
    const len = (P ? P.len : 4) + 1.6;
    const ctr = P ? [P.center[0] * 0.7, P.center[1] * 0.7] : [0, 0];
    const pl = C.plunge;
    // l'ombre entière dans le cadre : son étendue apparente ≈ len · sin(plongée)
    const dist = (len * 0.62 * Math.sin(pl * DEG) + 0.6) / half;
    return { az: f.camAz, pl, dist, tx: ctr[0], ty: 0, tz: ctr[1] };
  });
  const [K1, K2] = hold, [u1, u2] = [T.u1, T.u2], dh = C.hold;
  // la ronde : près de l'objet, plus bas, l'azimut continue dans le même sens
  const turn = ((K2.az - K1.az + 540) % 360) - 180 >= 0 ? 1 : -1; // sens du soleil vu de la caméra
  const az1 = K1.az, az2 = az1 + turn * Math.abs(((K2.az - K1.az + 540) % 360) - 180);
  const gap = (az1 + turn * 360 - az2) / 3;
  const near = (az) => ({ az, pl: C.nearPlunge, dist: C.nearDist, tx: 0, ty: 0.3, tz: 0 });
  const keys = [
    { u: u1 - dh, ...K1, az: az1 - turn * C.drift },
    { u: u1 + dh, ...K1, az: az1 + turn * C.drift },
    { u: u2 - dh, ...K2, az: az2 - turn * C.drift },
    { u: u2 + dh, ...K2, az: az2 + turn * C.drift },
    { u: lerp(u2 + dh, u1 + 1 - dh, 0.3), ...near(az2 + gap) },
    { u: lerp(u2 + dh, u1 + 1 - dh, 0.7), ...near(az2 + 2 * gap) },
  ];
  return keys;
}

export function cameraAt(R, u, place) {
  const keys = cameraKeys(R, place);
  const n = keys.length;
  const f = u - Math.floor(u);
  // segment [k, k+1] contenant f (temps périodiques ; le dernier rejoint le premier + 1)
  const ku = keys.map((k) => k.u);
  let i = n - 1;
  for (let k = 0; k < n; k++) { const a = ku[k], b = k + 1 < n ? ku[k + 1] : ku[0] + 1; const ff = f < a ? f + 1 : f; if (ff >= a && ff < b) { i = k; break; } }
  const get = (k) => { const m = ((k % n) + n) % n, wrap = Math.floor(k / n); const K = keys[m]; return { ...K, u: K.u + wrap, az: K.az + wrap * 360 * Math.sign(keys[2].az - keys[0].az || 1) }; };
  // (l'azimut se déroule : un tour par boucle)
  const P0 = get(i - 1), P1 = get(i), P2 = get(i + 1), P3 = get(i + 2);
  const ff = f < P1.u ? f + 1 : f;
  const t = (ff - P1.u) / (P2.u - P1.u);
  const out = {};
  for (const k of ['az', 'pl', 'dist', 'tx', 'ty', 'tz']) out[k] = catmull(P0[k], P1[k], P2[k], P3[k], t);
  return out;
}

// position et cible (repère de three.js) d'une pose
export function poseToCamera(p) {
  const az = p.az * DEG, pl = p.pl * DEG;
  const fx = Math.sin(az), fz = -Math.cos(az);
  return {
    position: [p.tx - fx * Math.cos(pl) * p.dist, p.ty + Math.sin(pl) * p.dist, p.tz - fz * Math.cos(pl) * p.dist],
    target: [p.tx, p.ty, p.tz],
  };
}

// Le scénario des pièces : assemblage de a0 à a1 (avant la première figure),
// vol de T, démontage en miroir autour de m, le milieu des deux tenues (le film
// est symétrique : u et 2m − u montrent le même tas).
export function assemblyTiming(R) {
  const T = timeline(R);
  return { a0: R.loop.a0 ?? 0.07, a1: R.loop.a1 ?? 0.28, T: R.loop.fly ?? 0.05, m: (T.u1 + T.u2) / 2 };
}
