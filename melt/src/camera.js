// La caméra du film (module pur) : une macro sur rail qui respire avec le
// cristal. Le cadre garde le sujet à la même place dans l'image : il recule
// pendant que l'étoile pousse, avance pendant qu'elle se rassemble en goutte.
// Un seul balancement lent en azimut par boucle (les nervures accrochent la
// lumière tour à tour), une hauteur fixe propre à l'humeur.
//
// La trajectoire est échantillonnée sur toute la boucle, lissée par un noyau
// gaussien périodique (σ ≈ 1,2 s : le recul suit la croissance sans trembler),
// puis interpolée : périodique, continue, accélération bornée (test).
import { clock, TL } from './timeline.js';

export const CAM_SAMPLES = 720;
const DEG = Math.PI / 180;

// rayon apparent du sujet à la phase u (mm) : cristal en croissance, glace et
// perles pendant la fonte, goutte
export function subjectRadius(u, C, R) {
  const k = clock(u, C);
  const lookup = (arr, x) => {
    const n = arr.length - 1, f = Math.min(n, Math.max(0, x * n)), i = Math.floor(f), j = Math.min(n, i + 1);
    return arr[i] + (arr[j] - arr[i]) * (f - i);
  };
  const bead = R.water.bead * 1.4;
  if (k.u < TL.melt0) return Math.max(bead, k.tg <= 0 ? 0 : lookup(C.growR, Math.min(1, k.tg)));
  if (k.u < TL.melt1 + 0.02) return Math.max(bead, lookup(C.meltR, Math.min(1, Math.max(0, k.sm))));
  return bead + (C.dropR - bead) * (1 - k.evap);
}

export function cameraPath(R, C, aspect = 1.5) {
  const n = CAM_SAMPLES, Cm = R.camera;
  const fov = Cm.fov * DEG, tanH = Math.tan(fov / 2) * Math.min(1.6, Math.max(0.8, aspect)); // (demi-largeur)
  const rmin = Math.max(0.55, C.radius / 2.4); // (rapport des distances ≤ 2,5)
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.max(rmin, subjectRadius(i / n, C, R) * 1.08);
    raw[i] = r / Cm.fill / tanH;
  }
  // lissage gaussien périodique
  const sigma = (1.2 / R.loop.duration) * n, w = Math.ceil(sigma * 3);
  const ker = Array.from({ length: 2 * w + 1 }, (_, j) => Math.exp(-(((j - w) / sigma) ** 2) / 2));
  const ks = ker.reduce((a, b) => a + b, 0);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -w; j <= w; j++) s += raw[(i + j + n * 4) % n] * ker[j + w];
    dist[i] = s / ks;
  }
  return { dist };
}

// pose à la phase u : { pos: [x, y, z], target, up, fov, dist }
// (repère du monde : y vers le haut, le support est le plan y = 0 ; le
// cristal, construit dans le plan xy de son repère, y est couché)
export function cameraAt(u, R, path) {
  u -= Math.floor(u);
  const n = CAM_SAMPLES, f = u * n, i = Math.floor(f) % n, t = f - Math.floor(f);
  // Catmull-Rom périodique
  const P = (k) => path.dist[(i + k + n) % n];
  const p0 = P(-1), p1 = P(0), p2 = P(1), p3 = P(2);
  const d = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const Cm = R.camera;
  const az = Cm.az + Cm.sway * DEG * Math.sin(2 * Math.PI * u);
  const el = Cm.el * DEG + 2.5 * DEG * Math.sin(2 * Math.PI * u + 1.1);
  const target = [0, 0.03, 0];
  const pos = [target[0] + Math.cos(el) * Math.cos(az) * d, target[1] + Math.sin(el) * d, target[2] + Math.cos(el) * Math.sin(az) * d];
  return { pos, target, up: [0, 1, 0], fov: Cm.fov, dist: d };
}
