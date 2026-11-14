// La caméra du film : une fonction de la recette et de la phase (module pur).
//
// Grammaire : un plan rapproché fixe sur la gerbe, de trois quarts, en légère
// plongée (on voit dans le bouquet). Un seul mouvement, lent : un balancement
// d'azimut sur toute la boucle, et une respiration de distance ; la mise au
// point, elle, glisse vers la plume qui se déplie (moyenne pondérée de leurs
// distances : une seule horloge, sans saut quand une autre prend le relais).
// La trajectoire est échantillonnée sur la boucle puis lissée par un noyau
// gaussien périodique : la boucle se referme, l'export rend la même chose
// que la lecture.
import { qrot } from './gen/feather.js';
import { layoutBouquet, ageOf, frameAt, unfoldWeight } from './gen/bouquet.js';

const N = 720;
const TAU = Math.PI * 2;

function rawPose(R, lay, u) {
  const P = R.shape, C = R.camera, L = P.L;
  const target = lay.center.slice();
  // (la gerbe entière tient dans le champ, avec de l'air autour)
  const dist = L * (P.radial ? 3.2 : 2.0) * C.d * (1 + 0.05 * Math.cos(TAU * u));
  const el = C.el * 0.55 + 0.04 * Math.sin(TAU * u); // (presque à hauteur : la gerbe se lève dans le champ, le duvet en bas)
  const az = C.az + C.drift * Math.sin(TAU * u);
  const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const pos = target.map((v, i) => v + dir[i] * dist);
  // la plume qui se déplie : le milieu de son vexille
  let ws = 0, fd = 0;
  for (const f of lay.follicles) {
    const a = ageOf(lay, f.i, u), w = unfoldWeight(a) + 1e-4;
    const fr = frameAt(lay, f, a);
    const m = qrot(fr.q, [0, L * f.scale * 0.6, 0]).map((v, i) => v + fr.p[i]);
    fd += w * Math.hypot(m[0] - pos[0], m[1] - pos[1], m[2] - pos[2]);
    ws += w;
  }
  return { pos, target, focus: [fd / ws, 0, 0] };
}

// trajectoire lissée, échantillonnée sur la boucle : { at(u) → { pos, target, dist, focusDist } }
export function cameraPath(R, lay = null) {
  lay ??= layoutBouquet(R.shape, R.seed);
  const raw = Array.from({ length: N }, (_, i) => rawPose(R, lay, i / N));
  const sig = (0.9 / R.loop.duration) * N; // (σ en échantillons)
  const W = Math.ceil(sig * 3);
  const ker = Array.from({ length: 2 * W + 1 }, (_, j) => Math.exp(-0.5 * ((j - W) / sig) ** 2));
  const ks = ker.reduce((a, b) => a + b, 0);
  const smooth = (key) => raw.map((_, i) => {
    const o = [0, 0, 0];
    for (let j = -W; j <= W; j++) { const q = raw[(i + j + N) % N][key], w = ker[j + W] / ks; o[0] += q[0] * w; o[1] += q[1] * w; o[2] += q[2] * w; }
    return o;
  });
  const P = smooth('pos'), T = smooth('target'), F = smooth('focus');
  const cr = (arr, u) => {
    const x = (((u % 1) + 1) % 1) * N, i = Math.floor(x), f = x - i;
    const p0 = arr[(i - 1 + N) % N], p1 = arr[i % N], p2 = arr[(i + 1) % N], p3 = arr[(i + 2) % N];
    const f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * f + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * f2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * f3));
  };
  return {
    at(u) {
      const pos = cr(P, u), target = cr(T, u);
      return { pos, target, dist: Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]), focusDist: cr(F, u)[0] };
    },
    lay,
  };
}
