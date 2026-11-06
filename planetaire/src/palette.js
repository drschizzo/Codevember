// Palette de provenance : couleur d'un matériau selon son rayon de naissance.
// Même formule côté GPU (TSL) et côté CPU (coupe des planètes, UI).
import { vec3, mix, smoothstep } from 'three/tsl';

const STOPS = [
  [0.35, [1.0, 0.30, 0.12]],  // fer / silicates chauds
  [1.1, [0.95, 0.52, 0.22]],  // ocre
  [2.2, [0.93, 0.76, 0.48]],  // sable
  [3.2, [0.62, 0.86, 1.0]],   // glaces (au-delà de la ligne des glaces)
  [5.0, [0.45, 0.62, 1.0]],   // bleu profond
  [8.0, [0.78, 0.62, 1.0]],   // violet (bord externe)
];

export function provenanceTSL(r) {
  let c = vec3(...STOPS[0][1]);
  for (let k = 1; k < STOPS.length; k++) {
    c = mix(c, vec3(...STOPS[k][1]), smoothstep(STOPS[k - 1][0], STOPS[k][0], r));
  }
  return c;
}

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function provenanceRGB(r) {
  let c = STOPS[0][1].slice();
  for (let k = 1; k < STOPS.length; k++) {
    const t = ss(STOPS[k - 1][0], STOPS[k][0], r), d = STOPS[k][1];
    c = c.map((v, i) => v + (d[i] - v) * t);
  }
  return c;
}

export const ROCK = [1.0, 0.55, 0.25];
export const ICE = [0.55, 0.85, 1.0];

export const css = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(',')})`;
