// La caméra du film (fonction pure) : le cadrage de l'humeur, un balancement
// lent et périodique (même pose à u = 0 et u = 1).
import { MOODS } from './recipe.js';

const TAU = Math.PI * 2;

export function cameraAt(R, u) {
  const C = MOODS[R.mood].cam, K = R.camera;
  const tgt = [...C.tgt];
  const off = [C.pos[0] - tgt[0], C.pos[1] - tgt[1], C.pos[2] - tgt[2]];
  const az = K.sway * Math.sin(TAU * u), lift = K.lift * Math.sin(TAU * u + 1.3);
  const c = Math.cos(az), s = Math.sin(az);
  const pos = [tgt[0] + (off[0] * c + off[2] * s) * K.dolly, tgt[1] + off[1] * K.dolly + lift, tgt[2] + (-off[0] * s + off[2] * c) * K.dolly];
  return { pos, tgt, fov: C.fov };
}

