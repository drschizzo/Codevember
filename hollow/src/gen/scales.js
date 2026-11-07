// Écailles : une coquille faite de plaques bombées qui se recouvrent en
// tuiles, disposées en phyllotaxie (spirale de Fibonacci, comme une pomme de
// pin). Chaque écaille est une pièce animée articulée sur son bord haut (côté
// oculus) : elle se soulève et respire (scene/rig.js), plus ouverte près du
// cœur ; une onde parcourt la coquille du pôle vers le bas.
//
// Écaille : contour en écusson, pointe vers le bas (s'éloignant de l'oculus),
// dôme d'épaisseur variable ; face externe, face interne, tranche.
// Vers l'oculus, les écailles rapetissent en spirale jusqu'à une couronne :
// un jonc fin bordé de perles, sous lequel se glisse la première rangée.

import { norm, cross, dot, tangentFrame } from './cells.js';
import { Buffers, OUT, IN, EDGE, RIG, revolve } from './mesh.js';
import { sweep, circle } from './sweep.js';
import { appendIris } from './iris.js';

const { cos, sin, sqrt, PI, max } = Math;
const Z = [0, 0, 1];
const RES = [[28, 4], [18, 3], [12, 2], [8, 1]]; // points du contour, anneaux du dôme

export function buildScales(spec, lod) {
  const B = new Buffers(1 << 16);
  const [no, nr] = RES[lod];
  const n = spec.count, GA = PI * (3 - sqrt(5));
  const t0 = spec.thickness;
  const rb = 1 - t0 * 1.4;                // rayon de la face interne au repos
  // ── Couronne de l'oculus : un jonc fin bordé de perles, sous lequel se
  // glisse la première rangée d'écailles
  const wl = 0.05, jonc = spec.portal + wl / 2;
  const beadR = 0.011, beadAt = spec.portal + wl + beadR * 1.2;
  // ── Placement : spirale de Fibonacci à densité variable. Les écailles
  // rapetissent vers l'oculus (taille relative `size(θ)`, du sommet `apex` à 1),
  // comme au sommet d'une pomme de pin ; la densité suit 1 / taille², et la
  // spirale reste continue (angle d'or). θ_i inverse l'aire cumulée pondérée.
  const theta0 = beadAt + beadR * 0.5;
  const apex = spec.apex ?? 0.42;
  const size = (th) => { const k = Math.min(1, Math.max(0, (th - theta0) / 0.95)); return apex + (1 - apex) * k * k * (3 - 2 * k); };
  const M = 2048, F = new Float64Array(M + 1), TH = (j) => theta0 + ((PI - theta0) * j) / M;
  for (let j = 0; j < M; j++) { const th = (TH(j) + TH(j + 1)) / 2; F[j + 1] = F[j] + (sin(th) / size(th) ** 2) * ((PI - theta0) / M); }
  const total = F[M];
  const thetaOf = (q) => { // aire cumulée → angle polaire
    let lo = 0, hi = M;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (F[m] < q) lo = m; else hi = m; }
    return TH(lo) + ((q - F[lo]) / Math.max(1e-12, F[hi] - F[lo])) * (TH(hi) - TH(lo));
  };
  // écart entre écailles de taille 1 (aire pondérée totale répartie sur n)
  const spacing = sqrt((2 * PI * total) / n);

  for (let i = 0; i < n; i++) {
    const th = thetaOf(((i + 0.5) / n) * total), sz = size(th);
    const z = cos(th), rr = sin(th), ph = i * GA;
    const c = [rr * cos(ph), rr * sin(ph), z];
    const a = spacing * 0.72 * spec.size * sz;   // demi-longueur (vers le bas)
    const b = spacing * 0.52 * spec.size * sz;   // demi-largeur
    const t = t0 * (0.55 + 0.45 * sz), dome = spec.dome * t;
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
  // jonc et rang de perles (fixes)
  sweep(B, circle(Z, jonc), 2 * PI * sin(jonc), true, 1 + t0 * 0.9, wl, t0 * 3.2, lod);
  if (lod < 3) {
    const nb = Math.round((2 * PI * sin(beadAt)) / (beadR * 2.3)), segs = [12, 9, 6][lod], rings = [8, 6, 4][lod];
    const prof = [];
    for (let j = 0; j <= rings; j++) { const q = -PI / 2 + (PI * j) / rings; prof.push([beadR * cos(q) + 1e-5, beadR * sin(q) + beadR]); }
    for (let k = 0; k < nb; k++) {
      const [d] = circle(Z, beadAt)(k / nb), r0 = rb + t0 * 0.6;
      revolve(B, [d[0] * r0, d[1] * r0, d[2] * r0], d, prof, segs);
    }
  }
  if (spec.iris?.blades) appendIris(B, { ...spec, thickness: t0 * 2.3 + 0.004 }, Math.tan(spec.portal), lod);
  const out = B.result();
  if (lod === 3) delete out.bev;
  return out;
}

