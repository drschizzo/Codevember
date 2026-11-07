// Écailles : une coquille faite de plaques bombées qui se recouvrent en
// tuiles, disposées en phyllotaxie (spirale de Fibonacci, comme une pomme de
// pin). Chaque écaille est une pièce animée articulée sur son bord haut (côté
// oculus) : elle se soulève et respire (scene/rig.js), plus ouverte près du
// cœur ; une onde parcourt la coquille du pôle vers le bas.
//
// Écaille : contour en écusson, pointe vers le bas (s'éloignant de l'oculus),
// dôme d'épaisseur variable ; face externe, face interne, tranche.
// La calotte de l'oculus reste libre, cerclée d'une lunette fixe.

import { norm, cross, dot, tangentFrame } from './cells.js';
import { Buffers, OUT, IN, EDGE, RIG } from './mesh.js';
import { sweep, circle } from './sweep.js';
import { appendIris } from './iris.js';

const { cos, sin, sqrt, PI, max } = Math;
const Z = [0, 0, 1];
const RES = [[28, 4], [18, 3], [12, 2], [8, 1]]; // points du contour, anneaux du dôme

export function buildScales(spec, lod) {
  const B = new Buffers(1 << 16);
  const [no, nr] = RES[lod];
  const n = spec.count, GA = PI * (3 - sqrt(5));
  const cap = cos(spec.portal + 0.05);
  const spacing = sqrt((4 * PI) / n);
  const a = spacing * 0.72 * spec.size;   // demi-longueur (vers le bas)
  const b = spacing * 0.52 * spec.size;   // demi-largeur
  const t = spec.thickness, dome = spec.dome * t;
  const rb = 1 - t * 1.4;                 // rayon de la face interne au repos

  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    if (z > cap) continue;
    const rr = sqrt(max(0, 1 - z * z)), ph = i * GA;
    const c = [rr * cos(ph), rr * sin(ph), z];
    // repère : u vers le bas (sud), v vers l'est, normale c
    const east = Math.abs(z) > 0.999 ? tangentFrame(c)[0] : norm(cross(Z, c));
    const u = cross(east, c);
    // contour (écusson) : pointe en bas ; plus pointu avec spec.pointed
    const outline = [];
    for (let k = 0; k < no; k++) {
      const f = (k / no) * PI * 2, cf = cos(f), sf = sin(f);
      const tip = 1 + spec.pointed * 0.45 * max(0, cf) ** 3;
      outline.push([a * cf * tip + a * 0.15, b * sf * (1 - 0.15 * max(0, cf))]);
    }
    // point local (du, dv, hauteur) → position sur la sphère
    const at = (du, dv, h) => {
      const d = norm([c[0] + u[0] * du + east[0] * dv, c[1] + u[1] * du + east[1] * dv, c[2] + u[2] * du + east[2] * dv]);
      return [d[0] * (rb + h), d[1] * (rb + h), d[2] * (rb + h)];
    };
    // charnière : bord haut (−u), axe −est (la pointe se soulève vers l'extérieur)
    const hinge = at(-a * 0.85, 0, t * 0.5);
    const wave = ((1 - z) * 1.3) % 1;
    B.rig(hinge, [-east[0], -east[1], -east[2]], spec.lift, RIG.hinge, wave);
    const v0 = B.n, i0 = B.ni;
    // faces : anneaux concentriques (fraction s du contour) et un centre
    const face = (top) => {
      const S = top ? OUT : IN, start = B.n;
      for (let j = 0; j < nr; j++) {
        const s = 1 - j / nr;
        const h = top ? t * 0.35 + dome * (1 - s * s) : 0;
        for (const [du, dv] of outline) {
          const p = at(du * s, dv * s, h), d = norm(p);
          B.vert(p, top ? d : [-d[0], -d[1], -d[2]], S[0], S[1], S[2], Math.round(s * 255));
        }
        if (j > 0) B.strip(start + (j - 1) * no, start + j * no, no);
      }
      const p = at(0, 0, top ? t * 0.35 + dome : 0), d = norm(p);
      const C = B.vert(p, top ? d : [-d[0], -d[1], -d[2]], S[0], S[1], S[2], 0);
      B.fan(start + (nr - 1) * no, C, no);
    };
    face(true);
    face(false);
    B.smooth(v0, i0);
    // tranche : du bord du dessus au bord du dessous
    const rim = B.n;
    for (let k = 0; k < no; k++) {
      const [du, dv] = outline[k], [pu, pv] = outline[(k + no - 1) % no], [qu, qv] = outline[(k + 1) % no];
      const tu = qu - pu, tv = qv - pv;
      const nl = norm([u[0] * tv - east[0] * tu, u[1] * tv - east[1] * tu, u[2] * tv - east[2] * tu]);
      const out = dot(nl, [u[0] * du + east[0] * dv, u[1] * du + east[1] * dv, u[2] * du + east[2] * dv]) < 0 ? nl.map((x) => -x) : nl;
      B.vert(at(du, dv, t * 0.35), out, EDGE[0], EDGE[1], EDGE[2], 255);
      B.vert(at(du, dv, 0), out, EDGE[0], EDGE[1], EDGE[2], 255);
    }
    for (let k = 0; k < no; k++) {
      const p = rim + 2 * k, q = rim + 2 * ((k + 1) % no);
      B.triN(p, p + 1, q + 1); B.triN(p, q + 1, q);
    }
  }
  B.rig(null);
  // lunette de l'oculus (fixe)
  const wl = spacing * 0.5;
  sweep(B, circle(Z, spec.portal + wl / 2), 2 * PI * sin(spec.portal), true, 1, wl, t * 2, lod);
  if (spec.iris?.blades) appendIris(B, { ...spec, thickness: t * 2 + 0.004 }, Math.tan(spec.portal), lod);
  const out = B.result();
  if (lod === 3) delete out.bev;
  return out;
}

