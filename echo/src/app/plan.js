// Le plan de la pièce pour l'écran de chargement (module pur) : ce que dit la
// recette, ramené au plan horizontal (x, z) — table, vases, lampe, réflecteur,
// œil, source image ou foyer, et le cône de l'écho.
import { derive } from '../gen/layout.js';
import { cameraAt, TIMELINE } from '../film.js';
import { add, sub, mul, dist } from '../gen/optics.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const p3 = (p) => p.map(r3);

export function planOf(R) {
  const D = derive(R);
  const eye = cameraAt(R.camera, (TIMELINE.on.slow + TIMELINE.on.end) / 2).pos;
  const P = {
    cx: 0.05, cz: (R.room.wallZ + 0.6) / 2, tw: R.table.width, td: R.table.depth, wz: R.room.wallZ,
    objects: R.objects.map((o) => [o.x, 0, o.z, o.r]), s: p3(D.s), eye: p3(eye),
  };
  const far = (o, q) => p3(add(o, mul(sub(q, o), 8)));
  if (D.plane) {
    const Pl = D.plane;
    const e1 = add(Pl.c, mul(Pl.u, -Pl.hw)), e2 = add(Pl.c, mul(Pl.u, Pl.hw));
    P.mirror = [p3(e1), p3(e2)];
    P.sv = p3(D.sv);
    P.cone = [far(D.sv, e1), far(D.sv, e2)];
    P.dm = dist(D.s, Pl.c);
  }
  if (D.E) {
    const E = D.E;
    const side = [-E.axis[2], 0, E.axis[0]];
    const n = Math.hypot(side[0], side[2]) || 1;
    const w = E.capRadius;
    const a = add(E.M, mul(side, w / n)), b = add(E.M, mul(side, -w / n));
    P.cap = [p3(a), p3(add(E.M, mul(E.normal, -0.02))), p3(b)];
    P.f2 = p3(E.f2); P.a = r3(E.a);
    P.cone = [p3(a), p3(b)];
    P.dm = dist(D.s, E.M);
  }
  if (D.B) { P.ball = [...p3(D.B.c), D.B.r]; P.dm = dist(D.s, D.B.c); }
  return P;
}
