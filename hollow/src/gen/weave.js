// Vannerie : deux familles de rubans tressés dessus-dessous, comme une toile.
// Famille A : cercles d'axe X (angle polaire θ_i autour de X) ; famille B :
// cercles d'axe Y. Les rubans se croisent presque à angle droit autour de
// l'oculus (pôle +z), en corbeille autour des pôles ±X et ±Y.
//
// Dessus-dessous : le ruban A_i est soulevé de h·(−1)^i·cos(π(θ_Y − Δ/2)/Δ),
// où θ_Y est l'angle du point autour de Y et Δ l'écart entre rubans ; le ruban
// B_j de −h·(−1)^j·cos(π(θ_X − Δ/2)/Δ). Au croisement de A_i et B_j, l'un est
// en haut quand l'autre est en bas, et l'ordre alterne d'un croisement au
// suivant. Les rubans s'arrêtent au bord de l'oculus, sous une lunette.

import { norm, dot } from './cells.js';
import { Buffers } from './mesh.js';
import { sweep, circle } from './sweep.js';
import { appendIris } from './iris.js';

const { cos, sin, acos, PI, max, min } = Math;
const Z = [0, 0, 1];

export function buildWeave(spec, lod) {
  const B = new Buffers(1 << 16);
  const n = spec.strands, D = PI / n;
  const w = D * spec.width, t = spec.thickness, h = t * 0.9 * spec.wave;
  const r = 1 - h - t * 0.2;
  const cb = cos(spec.bias), sb = sin(spec.bias);
  const X = [cb, sb, 0], Y = [-sb, cb, 0];
  const wl = 0.09; // largeur de la lunette
  // (coupe sur le bord intérieur du brin : il ne mord jamais sur l'oculus)
  const cap = cos(spec.portal + wl * 0.75 + w / 2);
  const ang = (p, a) => acos(max(-1, min(1, dot(norm(p), a))));
  for (const [axis, other, sg] of [[X, Y, 1], [Y, X, -1]]) {
    for (let i = 0; i < n; i++) {
      const beta = (i + 0.5) * D;
      const path = circle(axis, beta);
      const lift = (s) => sg * h * (i % 2 ? -1 : 1) * cos((PI * (ang(path(s)[0], other) - D / 2)) / D);
      // morceaux hors de la calotte de l'oculus
      const N = 720, runs = [];
      let s0 = null;
      for (let k = 0; k <= N; k++) {
        const s = k / N, inside = path(s)[0][2] > cap;
        if (!inside && s0 === null) s0 = s;
        if ((inside || k === N) && s0 !== null) { runs.push([s0, s]); s0 = null; }
      }
      // (boucle complète hors de la calotte : un seul ruban fermé)
      if (runs.length === 1 && runs[0][0] === 0 && runs[0][1] === 1) {
        sweep(B, path, 2 * PI * sin(beta), true, r, w, t, lod, lift);
        continue;
      }
      // (un morceau qui touche s = 1 se poursuit au début : on les réunit)
      if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === 1) {
        const last = runs.pop();
        runs[0] = [last[0] - 1, runs[0][1]];
      }
      for (const [a, b] of runs) {
        if (b - a < 0.01) continue;
        const sub = (s) => path(((a + (b - a) * s) % 1 + 1) % 1);
        const subLift = (s) => lift(((a + (b - a) * s) % 1 + 1) % 1);
        sweep(B, sub, 2 * PI * sin(beta) * (b - a), false, r, w, t, lod, subLift);
      }
    }
  }
  // lunette de l'oculus
  sweep(B, circle(Z, spec.portal + wl / 2), 2 * PI * sin(spec.portal), true, 1 + t * 0.3, wl, t * 2.4, lod);
  if (spec.iris?.blades) appendIris(B, { ...spec, thickness: t * 2.4 + 0.004 }, Math.tan(spec.portal), lod);
  const out = B.result();
  if (lod === 3) delete out.bev;
  return out;
}
