// La caméra du film : une fonction de la recette et de la phase (module pur).
//
// Grammaire : un plan rapproché qui suit la plume — la plume couchée au début
// (et l'ancienne qui part), la cible qui monte avec le tuyau, la caméra qui
// s'approche et glisse d'un quart de tour lent pendant le déroulement (le
// livre s'ouvre de trois quarts), puis recule quand la plume se couche. Un
// seul sens de glissement, un retour lent et lisse vers la pose de départ.
// La trajectoire est échantillonnée sur la boucle puis lissée par un noyau
// gaussien périodique (σ = 0,7 s) : la boucle se referme, l'export rend la
// même chose que la lecture.
import { FAMILIES } from './families.js';
import { bendOf, bodyFrame, featherFrame, betaAt, betaSolved, rachisPoint, qrot, ejection, layoutPlumage, mix, sstep, smoother, SCHED } from './gen/feather.js';

const N = 720;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// pose brute (avant lissage) à la phase u
function rawPose(R, lay, u, path) {
  const beta = (x) => (path ? betaSolved(path, x) : betaAt(x, R.shape.radial));
  const P = R.shape, C = R.camera, L = P.L;
  const { n, d, e, p: root } = bodyFrame(lay.Rd, lay.thH, 0);
  const k = bendOf(P, lay.Rd);
  // la nouvelle plume : milieu de sa partie sortie
  const fr = featherFrame(lay.Rd, lay.thH, 0, beta(u));
  const S = { u, L, k, cal: P.calamus, radial: P.radial, over: P.over };
  const len = P.radial ? 0.6 : 1;
  const ptNew = rachisPoint(Math.max(P.calamus, 1 - 0.5 * visibleFrac(S)) * len, S).p;
  let tNew = add(root, qrot(fr.q, ptNew));
  if (P.radial) tNew = add(root, qrot(fr.q, [0, Math.min(1, visibleFrac(S)) * L * 0.55, 0]));
  // l'ancienne plume (couchée, puis chassée) : son milieu
  // (la caméra ne suit pas la chute : elle reste sur le follicule, l'ancienne sort du cadre)
  const ej = ejection(Math.min(u, SCHED.fall[0]), P, lay);
  const fo = featherFrame(lay.Rd, ej.th, 0, beta(1));
  const tOld = add(add(fo.p, ej.off), qrot(fo.q, rachisPoint(P.radial ? 0.3 : 0.45, { u: 1, L, k, cal: P.calamus, radial: P.radial, over: P.over }).p));
  const w = smoother(0.04, 0.24, u);
  const target = add(scl(tOld, 1 - w), scl(tNew, w));
  // distance (en longueurs de plume), plongée, azimut : trois respirations
  const close = smoother(0.3, 0.5, u) * (1 - smoother(0.66, 0.86, u));
  // (1,65 L : la plume entière tient dans un champ de 30° avec de l'air autour)
  const dist = 1.65 * L * (P.radial ? 1.5 : 1) * C.d * mix(1.12, 0.86, close);
  const el = C.el + 0.15 + 0.12 * (1 - close) - 0.05 * smoother(0.2, 0.4, u) * (1 - smoother(0.8, 1, u));
  // un glissement lent dans un seul sens pendant le déroulement, retour pendant l'usure
  const slide = smoother(0.28, 0.72, u) - smoother(0.82, 1.0, u);
  const az = C.az + C.drift * Math.sign(C.az || 1) * slide;
  // direction : du côté de la tête (−d), de trois quarts (e), en plongée (n)
  const h = [-Math.cos(az) * d[0] + Math.sin(az) * e[0], -Math.cos(az) * d[1] + Math.sin(az) * e[1], -Math.cos(az) * d[2] + Math.sin(az) * e[2]];
  const dir = add(scl(h, Math.cos(el)), scl(n, Math.sin(el)));
  return { pos: add(target, scl(dir, dist)), target, dist };
}
// part visible du rachis (0–1)
function visibleFrac(S) {
  const p0 = rachisPoint(1, S);
  if (p0.hidden) return 0;
  // (dichotomie : la hauteur s où le rachis sort de la peau)
  let a = 0, b = 1;
  for (let i = 0; i < 18; i++) { const m = 0.5 * (a + b); if (rachisPoint(m, S).hidden) a = m; else b = m; }
  return 1 - b;
}

// trajectoire lissée, échantillonnée sur la boucle : { at(u) → { pos, target, dist } }
export function cameraPath(R, lay = null, path = null) {
  lay ??= layoutPlumage(R.shape, R.seed, { tile: R.tile });
  const raw = Array.from({ length: N }, (_, i) => rawPose(R, lay, i / N, path));
  const sig = (0.7 / R.loop.duration) * N; // (σ en échantillons)
  const W = Math.ceil(sig * 3);
  const ker = Array.from({ length: 2 * W + 1 }, (_, j) => Math.exp(-0.5 * ((j - W) / sig) ** 2));
  const ks = ker.reduce((a, b) => a + b, 0);
  const smooth = (key) => raw.map((_, i) => {
    const o = [0, 0, 0];
    for (let j = -W; j <= W; j++) { const q = raw[(i + j + N) % N][key], w = ker[j + W] / ks; o[0] += q[0] * w; o[1] += q[1] * w; o[2] += q[2] * w; }
    return o;
  });
  const P = smooth('pos'), T = smooth('target');
  const cr = (arr, u) => {
    const x = (((u % 1) + 1) % 1) * N, i = Math.floor(x), f = x - i;
    const p0 = arr[(i - 1 + N) % N], p1 = arr[i % N], p2 = arr[(i + 1) % N], p3 = arr[(i + 2) % N];
    const f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f3));
  };
  return {
    at(u) {
      const pos = cr(P, u), target = cr(T, u);
      return { pos, target, dist: Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]) };
    },
    lay,
  };
}
void FAMILIES; void sstep; void SCHED;
