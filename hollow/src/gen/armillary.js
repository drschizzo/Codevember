// Sphère armillaire : une coquille faite d'anneaux. Un anneau polaire (la
// lunette de l'oculus) et un anneau austral tiennent des méridiens ; à
// l'intérieur, l'équateur, les tropiques et des écliptiques inclinées tournent
// chacun à sa vitesse (un nombre entier de tours par boucle) autour de l'axe
// de l'oculus — jamais à travers lui : la caméra passe toujours librement.
// Graduations en clous sur l'équateur, perles-planètes sur les écliptiques.
//
// Chaque anneau est un ruban balayé le long d'un cercle de la sphère, de
// section rectangulaire arrondie : face externe, face interne, flancs (la
// tranche). La proximité du bord (surf.w) suit le travers du ruban : la
// gravure dessine un filet au milieu de chaque anneau.

import { norm } from './cells.js';
import { Buffers, OUT, RIG, revolve } from './mesh.js';
import { sweep, circle, meridian } from './sweep.js';
import { appendIris } from './iris.js';
import { createRng } from '../../../shared/rng.js';

const { cos, sin, PI, min } = Math;
const Z = [0, 0, 1];

const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

export function buildArmillary(spec, lod) {
  const rng = createRng(`${spec.seed}:armillary`);
  const B = new Buffers(1 << 15);
  const t = spec.thickness, w = spec.width;
  const beta0 = spec.portal; // lunette : bord intérieur à l'angle de l'oculus
  const south = PI - spec.south;
  // ── Bâti fixe (r = 1) : lunette, anneau austral, méridiens ──
  B.rig(null);
  const wb = w * 1.6;
  sweep(B, circle(Z, beta0 + wb / 2), 2 * PI * sin(beta0), true, 1, wb, t * 1.2, lod);
  sweep(B, circle(Z, south), 2 * PI * sin(south), true, 1, w, t, lod);
  const nm = spec.meridians, phase = rng.range(0, PI);
  for (let k = 0; k < nm; k++) {
    const phi = phase + (k / nm) * PI * 2;
    sweep(B, meridian(phi, beta0 + wb * 0.9, south), south - beta0, false, 1, w * 0.8, t * 0.9, lod);
  }
  // clous de la lunette
  if (lod < 3) for (let k = 0; k < 24; k++) {
    const [d] = circle(Z, beta0 + wb / 2)(k / 24);
    revolve(B, scale3(d, 1), d, [[w * 0.18, -0.002], [w * 0.17, w * 0.06], [w * 0.1, w * 0.1], [1e-5, w * 0.11]], [10, 8, 6][lod]);
  }
  // ── Anneaux mobiles (rayons décroissants : jamais deux anneaux qui se croisent) ──
  let r = 1 - t * 1.6;
  const ring = (path, len, width, turns, extra) => {
    B.rig([0, 0, 0], Z, turns, turns ? RIG.spin : RIG.none, rng.next());
    sweep(B, path, len, true, r, width, t, lod);
    extra?.(r);
    B.rig(null);
    r -= t * 1.35;
  };
  // équateur gradué
  ring(circle(Z, PI / 2), 2 * PI, w * 1.2, spec.spins[0], (rr) => {
    if (lod >= 3) return;
    for (let k = 0; k < 72; k++) {
      const [d] = circle(Z, PI / 2)(k / 72), big = k % 6 === 0;
      const h = big ? w * 0.16 : w * 0.08, rad = big ? w * 0.16 : w * 0.09;
      revolve(B, scale3(d, rr), d, [[rad, -0.002], [rad, h * 0.7], [rad * 0.6, h], [1e-5, h * 1.05]], [8, 6, 5][lod]);
    }
  });
  if (spec.tropics) {
    ring(circle(Z, PI / 2 - 0.41), 2 * PI * cos(0.41), w * 0.8, spec.spins[1]);
    ring(circle(Z, PI / 2 + 0.41), 2 * PI * cos(0.41), w * 0.8, -spec.spins[1]);
  }
  // écliptiques : grands cercles inclinés (assez peu pour rester loin de l'oculus)
  const maxTilt = PI / 2 - beta0 - wb - 0.12;
  for (let k = 0; k < spec.ecliptics; k++) {
    const tilt = min(maxTilt, spec.tilt * (1 - k * 0.3)), az = rng.range(0, PI * 2);
    const a = norm([sin(tilt) * cos(az), sin(tilt) * sin(az), cos(tilt)]);
    ring(circle(a, PI / 2), 2 * PI, w, spec.spins[2 + k] ?? 1, (rr) => {
      if (!spec.beads || lod >= 3) return;
      // une perle-planète posée sur l'anneau
      const [d] = circle(a, PI / 2)(rng.next()), br = w * 0.9;
      const prof = [];
      for (let i = 0; i <= [10, 7, 5][lod]; i++) { const q = -PI / 2 + (PI * i) / [10, 7, 5][lod]; prof.push([br * cos(q) + 1e-5, br * sin(q) + br]); }
      revolve(B, scale3(d, rr - 0.004), d, prof, [16, 12, 8][lod], OUT);
    });
  }
  B.rig(null);
  // diaphragme sous la lunette (sous la face interne du bâti)
  if (spec.iris?.blades) appendIris(B, { ...spec, thickness: t * 1.2 + 0.004 }, Math.tan(beta0), lod);
  const out = B.result();
  if (lod === 3) delete out.bev;
  return out;
}

