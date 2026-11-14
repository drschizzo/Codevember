// La caméra du film (fonction pure) : le cadrage tiré par la recette, un
// balancement lent autour de la grappe (périodique : même pose à u = 0 et u = 1).
import { FRAMINGS } from './recipe.js';

const TAU = Math.PI * 2;

export function cameraAt(R, u) {
  const F = FRAMINGS[R.framing], K = R.camera;
  const tgt = [...F.tgt];
  const off = [F.pos[0] - tgt[0], F.pos[1] - tgt[1], F.pos[2] - tgt[2]];
  const az = K.sway * Math.sin(TAU * u), lift = K.lift * Math.sin(TAU * u + 1.3);
  const c = Math.cos(az), s = Math.sin(az);
  const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, tgt[1] + off[1] * K.dolly + lift, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
  return { pos, tgt, fov: F.fov };
}
