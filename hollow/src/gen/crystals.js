// Druse de la géode : cristaux prismatiques hexagonaux à pointe pyramidale,
// plantés sur la face interne de la coquille, pointés vers le centre (avec
// une dispersion d'angle), jamais dans un trou ni trop près de son bord.

import { norm, dot, cross, scale, tangentFrame } from './cells.js';
import { inHole } from './shell.js';

const { sqrt, cos, sin, PI, max, min, pow } = Math;

// Cristal unité : base à y = -0,12 (enfouie dans la paroi), pointe à y = 1,
// rayon 1. Facettes à plat (sommets non partagés) ; prisme légèrement
// irrégulier et pointe décentrée, propres à chaque modèle (3 variantes).
export function crystalGeometry(variant = 0) {
  const pos = [], nor = [];
  const sides = 6, tip = 0.3 + 0.08 * variant, y0 = -0.12, y1 = 1 - tip;
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * PI * 2, r = 1 + 0.12 * sin(i * 2.7 + variant * 1.9);
    ring.push([cos(a) * r, sin(a) * r]);
  }
  const apex = [0.08 * sin(variant * 2.1), 1, 0.08 * cos(variant * 1.3)];
  const face = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = norm(cross(u, v));
    pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n);
  };
  for (let i = 0; i < sides; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % sides];
    const A0 = [ax, y0, az], B0 = [bx, y0, bz], A1 = [ax, y1, az], B1 = [bx, y1, bz];
    face(A0, A1, B1); face(A0, B1, B0); // flanc (normales vers l'extérieur : sens indirect vu de dessus)
    face(A1, apex, B1);                 // facette de la pointe
  }
  // orientation : normales vers l'extérieur de l'axe y
  for (let t = 0; t < pos.length; t += 9) {
    const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3, cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
    if (nor[t] * cx + nor[t + 2] * cz < 0) {
      for (let k = 0; k < 3; k++) { const i = t + 3 + k; [pos[i], pos[i + 3]] = [pos[i + 3], pos[i]]; }
      for (let k = 0; k < 9; k++) nor[t + k] = -nor[t + k];
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor) };
}

// Placement : renvoie des matrices 4×4 (ordre colonnes, comme three.js)
export function placeCrystals(prepared, spec, rng) {
  const Ri = 1 - spec.thickness;
  const count = spec.crystals | 0;
  const mats = new Float32Array(count * 16);
  const variants = new Uint8Array(count);
  let n = 0, tries = 0;
  while (n < count && tries++ < count * 30) {
    const d = rng.dir();
    // cellule contenant le point : centre le plus proche (pavage ≈ Voronoï)
    let best = null, bd = -2;
    for (const info of prepared) { const v = dot(info.c, d); if (v > bd) { bd = v; best = info; } }
    const L = spec.crystalSize * (0.35 + 0.65 * pow(rng.next(), 0.8));
    const r = L * rng.range(0.09, 0.17);
    if (best) {
      const w = dot(d, best.c);
      const x = [dot(d, best.e1) / w, dot(d, best.e2) / w];
      if (inHole(best, x, r * 1.5 + 0.015)) continue;
    }
    // axe : vers le centre, incliné au hasard
    const inward = scale(d, -1), [t1, t2] = tangentFrame(inward);
    const tilt = rng.range(0, spec.crystalTilt), az = rng.range(0, PI * 2);
    const axis = norm([
      inward[0] * cos(tilt) + (t1[0] * cos(az) + t2[0] * sin(az)) * sin(tilt),
      inward[1] * cos(tilt) + (t1[1] * cos(az) + t2[1] * sin(az)) * sin(tilt),
      inward[2] * cos(tilt) + (t1[2] * cos(az) + t2[2] * sin(az)) * sin(tilt),
    ]);
    let [px, pz] = tangentFrame(axis);
    const tw = rng.range(0, PI * 2), ct = cos(tw), st = sin(tw);
    const X = [px[0] * ct + pz[0] * st, px[1] * ct + pz[1] * st, px[2] * ct + pz[2] * st];
    const Z = cross(X, axis);
    const base = scale(d, Ri + 0.002);
    mats.set([X[0] * r, X[1] * r, X[2] * r, 0, axis[0] * L, axis[1] * L, axis[2] * L, 0, Z[0] * r, Z[1] * r, Z[2] * r, 0, base[0], base[1], base[2], 1], n * 16);
    variants[n] = rng.int(0, 2);
    n++;
  }
  return { matrices: mats.slice(0, n * 16), variants: variants.slice(0, n), count: n };
}
