// Disposition de la machinerie (module pur) : où sont les colonnes, le mât,
// l'araignée et les cordes, dans le repère de la machinerie (construite vers
// +x, puis tournée de « yaw » autour de l'axe des coupes). scene/machine.js
// construit les pièces sur ces cotes ; les tests vérifient qu'aucune ne passe
// entre l'œil et l'image.
import { PARAB } from './mirascope.js';

export function layout(kind, f = PARAB.f) {
  const R = PARAB.rimK * f;
  if (kind === 'cremaillere') {
    const cx = R + 0.05;
    return { cx, yA: f / 2 + 0.006, posts: [{ x: cx, z: 0, r: 0.0095, y0: -0.03, y1: 0.18 }], bars: [{ a: [cx, f / 2 + 0.012, 0], b: [R + 0.004, f / 2 + 0.01, 0], r: 0.004, rides: true }] };
  }
  if (kind === 'vis') {
    const Rc = R + 0.024;
    return { Rc, posts: [0, 1, 2].map((k) => ({ x: Rc * Math.cos((k / 3) * Math.PI * 2), z: Rc * Math.sin((k / 3) * Math.PI * 2), r: 0.009, y0: -0.03, y1: 0.145 })), bars: [] };
  }
  const px = R + 0.06, yS = 0.128;
  const arms = [0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2 + Math.PI / 3; return [Math.cos(a), Math.sin(a)]; });
  return {
    px, yS, arms,
    posts: [{ x: px, z: 0, r: 0.012, y0: -0.03, y1: yS + 0.028 }],
    bars: [{ a: [px, yS + 0.012, 0], b: [0, yS + 0.012, 0], r: 0.0035 }, ...arms.map(([c, s]) => ({ a: [0, yS + 0.012, 0], b: [c * R, yS + 0.012, s * R], r: 0.0045 }))],
    cords: arms.map(([c, s]) => ({ x: c * (R + 0.004), z: s * (R + 0.004) })), // (verticales, du bord du couvercle à la poulie)
  };
}

// azimut (convention de la caméra : atan2(x, z)) d'un point local tourné de yaw (degrés)
export function toWorld(p, yawDeg) {
  const t = (yawDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; // (rotation de three.js autour de y)
}
