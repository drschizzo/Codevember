// La caméra du film (fonction pure) : le cadrage tiré par la recette, un
// balancement lent autour de la grappe (périodique : même pose à u = 0 et u = 1).
import { FRAMINGS, CLUSTERS } from './recipe.js';
import { buildCluster, tideFor } from './cycle.js';

// (la marée haute de la graine : la caméra reste toujours au-dessus du métal)
let cache = { key: '', LH: 0 };
function highTide(R) {
  const key = `${R.seed}|${R.cluster}`;
  if (cache.key !== key) cache = { key, LH: tideFor(buildCluster(R.seed, CLUSTERS[R.cluster] ?? CLUSTERS.grappe)).LH };
  return cache.LH;
}

const TAU = Math.PI * 2;

export function cameraAt(R, u) {
  const F = FRAMINGS[R.framing], K = R.camera;
  // le cadre suit la grappe : le gros plan se règle sur le grand cristal, les
  // autres cadrages sur l'étendue de la grappe (une druse dense de petits
  // cristaux ne doit pas flotter au milieu du plan large, ni le grand cristal
  // sortir du gros plan)
  const C = CLUSTERS[R.cluster] ?? CLUSTERS.grappe;
  const ext = C.scale * (1 + 2.9 * C.spread);
  const f = R.framing === 'macro' ? Math.min(1.6, Math.max(0.75, C.scale * 1.2)) : Math.min(1.35, Math.max(0.65, ext / 3.9));
  const tgt = [F.tgt[0] * f, F.tgt[1] * f, F.tgt[2] * f];
  const off = [(F.pos[0] - F.tgt[0]) * f, (F.pos[1] - F.tgt[1]) * f, (F.pos[2] - F.tgt[2]) * f];
  const az = K.sway * Math.sin(TAU * u), lift = K.lift * Math.sin(TAU * u + 1.3);
  const c = Math.cos(az), s = Math.sin(az);
  // la hauteur de base reste au-dessus de la marée haute de la grappe (au ras
  // du bain : juste au-dessus) ; le balancement vertical s'y ajoute
  const LH = highTide(R), m = Math.abs(K.lift);
  let y0 = tgt[1] + off[1] * K.dolly;
  y0 = R.framing === 'rasant' ? LH + 0.3 + m : Math.max(y0, LH + 0.5 + m);
  const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, y0 + lift, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
  return { pos, tgt, fov: F.fov };
}
