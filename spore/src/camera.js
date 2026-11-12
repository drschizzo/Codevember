// La caméra du film (module pur) : un voyage le long du bois, avec le vent.
//
// Elle avance de L par boucle (le bois et les sites se répètent de L en L :
// la pose à u + 1 est la pose à u translatée de L, la boucle est parfaite).
// Elle s'attarde au-dessus du site pendant que la vie s'y organise (dérive
// lente), puis suit le nuage de spores jusqu'au site suivant. Elle monte pour
// lire le réseau d'en haut (plongée), descend au ras du bois quand la forêt se
// lève (silhouettes, contre-jour), et remonte un peu pendant le voyage.
// Trajectoire échantillonnée, partie périodique lissée par un noyau gaussien
// périodique, relue en Catmull-Rom ; translation ajoutée ensuite (exacte).
import { T } from './timeline.js';

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
const lerp = (a, b, t) => a + (b - a) * t;

// images clés : [u, plongée (0 réseau, 1 forêt), distance relative, hauteur de la cible (0 bois … 1 sporanges)]
const KEYS = [
  [0.0, 0.55, 1.08, 0.1], [0.07, 0.25, 0.95, 0.0], [0.2, 0.05, 1.0, 0.0], [0.36, 0.0, 1.04, 0.0],
  [0.46, 0.3, 0.98, 0.2], [0.56, 0.85, 0.9, 0.6], [0.68, 1.0, 0.86, 0.7], [0.79, 1.0, 0.92, 0.75],
  [0.88, 0.8, 1.02, 0.55], [0.95, 0.6, 1.1, 0.3],
];
function keyAt(u) {
  u -= Math.floor(u);
  const K = KEYS, n = K.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (K[k][0] <= u) i = k;
  const k0 = K[(i - 1 + n) % n], k1 = K[i], k2 = K[(i + 1) % n], k3 = K[(i + 2) % n];
  const u1 = k1[0], u2 = k2[0] + (i + 1 >= n ? 1 : 0);
  const t = (u - u1) / (u2 - u1);
  return [1, 2, 3].map((j) => catmull(k0[j], k1[j], k2[j], k3[j], t));
}

// avance le long du vent : vitesse = un socle (dérive) + une bosse (le voyage)
// centrée sur le milieu de T.travel ; F(u) ∈ [0, 1), F(u + 1) = F(u) + 1
export function makeTravel(drift = 0.12) {
  const N = 2048, c = (T.travel[0] + T.travel[1]) / 2, w = (T.travel[1] - T.travel[0]) / 2;
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / N;
    let d = u - c; d -= Math.round(d);
    const bump = Math.abs(d) < w ? Math.cos((Math.PI * d) / (2 * w)) ** 2 : 0;
    v[i] = drift + (1 - drift) * bump / w; // (∫ bosse = w : normalisée ensuite)
  }
  const sum = v.reduce((a, b) => a + b, 0);
  const F = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) F[i + 1] = F[i] + v[i] / sum;
  return (u) => {
    const k = Math.floor(u), f = (u - k) * N, i = Math.min(N - 1, Math.floor(f)), t = f - i;
    return k + F[i] + (F[i + 1] - F[i]) * t;
  };
}

// C : recette.camera ; S : { L, target: [x, z] centre du site (réseau),
// forest: [x, z] centre de la forêt, H: hauteur des sporanges }, dur : durée (s)
export function createCameraPath(C, S, dur = 40) {
  const travel = makeTravel();
  const uc = 0.44, Fc = travel(uc);
  const rawPose = (u) => {
    const [e, dk, hk] = keyAt(u);
    const el = lerp(C.elNet, C.elForest, Math.min(1, Math.max(0, e)));
    // cible (relative à la translation) : du centre du réseau vers la forêt ;
    // la distance passe du plan du réseau au plan de la forêt (à l'échelle des sporanges)
    const f = Math.min(1, Math.max(0, e));
    const dist = Math.exp(lerp(Math.log(C.dist), Math.log(S.distForest ?? C.dist), f)) * dk;
    const tx = lerp(S.target[0], S.forest[0], f), tz = lerp(S.target[1], S.forest[1], f);
    const ty = S.y0 + S.H * hk * 0.55;
    const az = C.az + C.sway * Math.sin(2 * Math.PI * u);
    // (la caméra regarde vers −z, inclinée de az autour de la verticale)
    const p = [tx + Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + Math.cos(az) * Math.cos(el) * dist];
    return [...p, tx, ty, tz];
  };
  const N = Math.round(dur * 30), sigma = 0.8 * 30;
  const raw = Array.from({ length: N }, (_, i) => rawPose(i / N));
  const W = Math.ceil(sigma * 3), w = Array.from({ length: 2 * W + 1 }, (_, k) => Math.exp(-((k - W) ** 2) / (2 * sigma * sigma)));
  const ws = w.reduce((x, y) => x + y, 0);
  const smooth = raw.map((_, i) => {
    const acc = [0, 0, 0, 0, 0, 0];
    for (let k = -W; k <= W; k++) { const q = raw[(((i + k) % N) + N) % N], c = w[k + W] / ws; for (let j = 0; j < 6; j++) acc[j] += q[j] * c; }
    return acc;
  });
  const pose = (u) => {
    const fu = u - Math.floor(u), f = fu * N, i = Math.floor(f), t = f - i;
    const g = (k) => smooth[(((i + k) % N) + N) % N];
    const o = [];
    for (let j = 0; j < 6; j++) o.push(catmull(g(-1)[j], g(0)[j], g(1)[j], g(2)[j], t));
    // translation le long du vent (exacte, hors lissage) : la pose à u + 1 est
    // la pose à u + L (en x)
    const X = S.L * (travel(fu) - Fc);
    o[0] += X; o[3] += X;
    // tenir la caméra au-dessus du bois (la cible est sur le bois, la caméra
    // plus haute que le dessus de la bûche à sa position)
    const floor = S.groundAt ? S.groundAt(o[0], o[2]) + 0.25 : -Infinity;
    if (o[1] < floor) o[1] = floor;
    return { pos: o.slice(0, 3), target: o.slice(3, 6), fov: C.fov, focus: Math.hypot(o[0] - o[3], o[1] - o[4], o[2] - o[5]), X };
  };
  return { pose, travel };
}
