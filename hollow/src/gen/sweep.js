// Rubans balayés le long de courbes de la sphère (anneaux de l'armillaire,
// lunettes d'oculus, brins de la vannerie) : section rectangulaire arrondie —
// face externe, flancs (la tranche), face interne.

import { norm, tangentFrame } from './cells.js';
import { OUT, IN, EDGE } from './mesh.js';

const { cos, sin, PI, max, min, ceil, abs } = Math;

// pas angulaire le long des anneaux, segments des coins, par niveau de détail
export const SWEEP_LOD = [{ step: 0.018, corner: 3 }, { step: 0.03, corner: 2 }, { step: 0.05, corner: 1 }, { step: 0.09, corner: 0 }];

// section : rectangle arrondi de largeur w (travers, longueur d'arc) et
// d'épaisseur t (vers le centre), parcouru face externe → flanc → face interne
// → flanc. Chaque point : [travers, profondeur, normale (travers, radiale), finition, prox]
export function section(w, t, corner) {
  const rc = min(w, t) * 0.32, P = [];
  const arc = (cu, cv, a0, a1, surf) => {
    const n = max(1, corner);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n), nu = cos(a), nv = sin(a);
      P.push([cu + nu * rc, cv + nv * rc, nu, nv, surf]);
    }
  };
  const hw = w / 2;
  // (corner = 0 : arêtes vives, un point par coin)
  if (!corner) {
    P.push([-hw, 0, 0, 1, OUT], [hw, 0, 0, 1, OUT], [hw, 0, 1, 0, EDGE], [hw, -t, 1, 0, EDGE], [hw, -t, 0, -1, IN], [-hw, -t, 0, -1, IN], [-hw, -t, -1, 0, EDGE], [-hw, 0, -1, 0, EDGE]);
    return P;
  }
  arc(hw - rc, -rc, PI / 2, PI / 4, OUT); arc(hw - rc, -rc, PI / 4, 0, EDGE);
  arc(hw - rc, -t + rc, 0, -PI / 4, EDGE); arc(hw - rc, -t + rc, -PI / 4, -PI / 2, IN);
  arc(-hw + rc, -t + rc, -PI / 2, -3 * PI / 4, IN); arc(-hw + rc, -t + rc, -3 * PI / 4, -PI, EDGE);
  arc(-hw + rc, -rc, PI, 3 * PI / 4, EDGE); arc(-hw + rc, -rc, 3 * PI / 4, PI / 2, OUT);
  return P;
}

// Ruban balayé : path(s) → [d (direction radiale), S (travers, tangent à la sphère)]
// pour s ∈ [0, 1] ; closed : boucle ; r : rayon de la face externe.
// lift(s) (facultatif) : décalage radial le long du ruban (dessus-dessous d'un tressage)
export function sweep(B, path, len, closed, r, w, t, lod, lift = null) {
  const L = SWEEP_LOD[lod], sec = section(w, t, L.corner), ns = sec.length;
  const n = max(closed ? 24 : 4, ceil(len / L.step)), rows = closed ? n : n + 1;
  const start = B.n;
  for (let j = 0; j < rows; j++) {
    const [d, S] = path(j / n), dl = lift ? lift(j / n) : 0;
    for (const [u, v, nu, nv, surf] of sec) {
      const p = norm([d[0] + S[0] * (u / r), d[1] + S[1] * (u / r), d[2] + S[2] * (u / r)]);
      const rr = r + v + dl;
      const prox = 1 - min(1, abs(u) / (w / 2));
      B.vert([p[0] * rr, p[1] * rr, p[2] * rr], norm([S[0] * nu + p[0] * nv, S[1] * nu + p[1] * nv, S[2] * nu + p[2] * nv]), surf[0], surf[1], surf[2], Math.round(prox * 255));
    }
  }
  for (let j = 0; j < (closed ? n : n); j++) {
    const a = start + j * ns, b = start + ((j + 1) % rows) * ns;
    for (let k = 0; k < ns; k++) {
      const k1 = (k + 1) % ns;
      B.triN(a + k, b + k, b + k1); B.triN(a + k, b + k1, a + k1);
    }
  }
  // (rubans ouverts : bouchons aux deux bouts)
  if (!closed) for (const j of [0, n]) {
    const o = start + j * ns, c = B.n;
    const [d] = path(j / n), T = norm(sub3(path(min(1, j / n + 0.01))[0], path(max(0, j / n - 0.01))[0]));
    const s = j === 0 ? -1 : 1;
    for (let k = 0; k < ns; k++) B.vert(posOf(B, o + k), [T[0] * s, T[1] * s, T[2] * s], EDGE[0], EDGE[1], EDGE[2], 255);
    const ctr = B.vert(scale3(d, r - t / 2), [T[0] * s, T[1] * s, T[2] * s], EDGE[0], EDGE[1], EDGE[2], 255);
    B.fan(c, ctr, ns);
  }
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const posOf = (B, i) => [B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]];

// petit cercle d'axe a, d'angle polaire beta
export const circle = (a, beta) => {
  const [e1, e2] = tangentFrame(a);
  return (s) => {
    const f = s * PI * 2, cf = cos(f), sf = sin(f);
    const q = [e1[0] * cf + e2[0] * sf, e1[1] * cf + e2[1] * sf, e1[2] * cf + e2[2] * sf];
    const d = [a[0] * cos(beta) + q[0] * sin(beta), a[1] * cos(beta) + q[1] * sin(beta), a[2] * cos(beta) + q[2] * sin(beta)];
    const S = [-a[0] * sin(beta) + q[0] * cos(beta), -a[1] * sin(beta) + q[1] * cos(beta), -a[2] * sin(beta) + q[2] * cos(beta)];
    return [d, S];
  };
};
// méridien d'azimut phi, de l'angle polaire t0 à t1
export const meridian = (phi, t0, t1) => (s) => {
  const t = t0 + (t1 - t0) * s, h = [cos(phi), sin(phi), 0];
  return [[h[0] * sin(t), h[1] * sin(t), cos(t)], [-sin(phi), cos(phi), 0]];
};

