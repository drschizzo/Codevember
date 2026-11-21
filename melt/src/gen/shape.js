// Une figurine de cire, en données pures (worker et Node) : les particules de
// la simulation (repère de la grille), le champ de distance de l'objet (demi-
// flottants) et les deux demi-coques du moule (surface nets). Le fil principal
// n'en fait que des objets three.js (scene/stage.js) : ce calcul, d'environ une
// seconde par figurine, le bloquait.
//
// C : constantes de la grille, passées par l'appelant (sim/mpm.js importe
// three.js, qu'un worker ne peut pas charger) : { O, PS, CELL, SEED_H }.
import { OBJECTS, BOX, sdObject, scaleOf, seedPoints, heightOf, mouldField, surfaceNets } from '../objects.js';

export const NMAX = 40000; // particules (capacité : tous les objets ont le même volume)
export const RES = 2; // texture de distance : demi-cellule

// float → demi-flottant, exactement THREE.DataUtils.toHalfFloat (tables de
// van der Zijp, troncature) : la texture est identique à celle d'avant
const _b = new ArrayBuffer(4), _f = new Float32Array(_b), _u = new Uint32Array(_b);
const BASE = new Uint32Array(512), SHIFT = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
  const e = i - 127;
  let b, s;
  if (e < -27) { b = 0x0000; s = 24; }
  else if (e < -14) { b = 0x0400 >> (-e - 14); s = -e - 1; }
  else if (e <= 15) { b = (e + 15) << 10; s = 13; }
  else if (e < 128) { b = 0x7c00; s = 24; }
  else { b = 0x7c00; s = 13; }
  BASE[i] = b; BASE[i | 0x100] = e > 15 ? 0xfc00 : b | 0x8000;
  SHIFT[i] = SHIFT[i | 0x100] = s;
}
export function toHalf(v) {
  _f[0] = Math.min(65504, Math.max(-65504, v));
  const f = _u[0], e = (f >> 23) & 0x1ff;
  return BASE[e] + ((f & 0x007fffff) >> SHIFT[e]);
}

export function shapeData(key, salt, { O, PS, CELL, SEED_H }) {
  const sc = scaleOf(key), prims = OBJECTS[key].prims;
  const pts = seedPoints(key, sc, SEED_H), n = Math.min(NMAX, pts.length / 3);
  const data = new Float32Array(NMAX * PS);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3] + O[0], y = pts[i * 3 + 1] + O[1], z = pts[i * 3 + 2] + O[2], o = i * PS;
    data[o] = x; data[o + 1] = y; data[o + 2] = z;
    data[o + 20] = 1; data[o + 25] = 1; data[o + 30] = 1; // b = I
    data[o + 32] = x; data[o + 33] = y; data[o + 34] = z;
    // pigment : des veines dans la masse (repère de repos), que l'écoulement emporte
    const v = Math.sin(0.33 * y + 2.2 * Math.sin(0.17 * x + 1 + salt) + 1.7 * Math.sin(0.21 * z + 0.4 - salt) + 0.8 * Math.sin(0.5 * x + 0.3 * z + salt));
    data[o + 37] = Math.min(1, Math.max(0, (v - 0.55) * 4)); data[o + 38] = 1;
  }
  for (let i = n; i < NMAX; i++) { data[i * PS] = 3; data[i * PS + 1] = 3; data[i * PS + 2] = 3; } // (inactives)
  const N = BOX.size.map((v) => v * RES), sdf = new Uint16Array(N[0] * N[1] * N[2]);
  for (let z = 0; z < N[2]; z++) for (let y = 0; y < N[1]; y++) for (let x = 0; x < N[0]; x++) {
    sdf[x + N[0] * (y + N[1] * z)] = toHalf(sdObject(prims, sc, BOX.min[0] + (x + 0.5) / RES, BOX.min[1] + (y + 0.5) / RES, BOX.min[2] + (z + 0.5) / RES));
  }
  // le moule : deux demi-coques (repère objet, unités du monde)
  let top = 0, zBack = 0;
  const halves = [1, -1].map((side) => {
    const Fd = mouldField(key, sc, side), G = surfaceNets(Fd);
    top = Fd.top * CELL; zBack = Fd.zBack * CELL;
    for (let i = 0; i < G.position.length; i++) G.position[i] *= CELL;
    return { position: G.position, index: G.index };
  });
  return { key, data, sdf, dims: N, n, height: heightOf(key, sc) * CELL, top, zBack, halves };
}
