// Moucharabieh : entrelacs étoilés construits par la méthode de Hankin sur un
// pavage de base (alvéoles de Goldberg : pentagones et hexagones, donc des
// étoiles à 5 et 6 branches).
//
// Au milieu m_k de chaque arête d'une cellule partent deux rayons, inclinés de
// l'angle de contact θ vers l'intérieur ; le rayon de m_k qui file vers le
// sommet V_{k+1} croise celui de m_{k+1} en X_k. Les lignes m–X–m dessinent une
// étoile par cellule, dont les pointes touchent celles des cellules voisines
// au milieu des arêtes (la ligne se poursuit d'une cellule à l'autre).
//
// Chaque cellule est redécoupée en cellules convexes — le polygone central
// (X_0 … X_{n−1}), une pointe d'étoile par arête (X_{k−1}, m_k, X_k) et un
// cerf-volant par sommet (m_k, V_{k+1}, m_{k+1}, X_k) — que shell.js perce
// comme n'importe quel pavage : barreaux le long de toutes les lignes.
// L'oculus reste une seule cellule (les milieux de ses arêtes y sont ajoutés,
// pour que le maillage reste étanche avec ses voisines).

import { norm, dot, add, scale, tangentFrame } from './cells.js';

const { cos, sin, abs } = Math;

const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const convex = (P) => {
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 1e-12) return false;
  }
  return true;
};

// spec : theta (angle de contact, rad), frame (largeur relative des barreaux
// du pavage de base), star (largeur relative des barreaux du polygone central),
// solidStar (polygones centraux pleins)
export function girihCells(base, spec) {
  const theta = spec.theta, wFrame = spec.frame ?? 1.3, wStar = spec.star ?? 1;
  // milieu d'une arête : calculé de la même façon des deux côtés (clé du maillage étanche)
  const mid = (a, b) => norm(add(a, b));
  const out = [];
  for (const cell of base) {
    const V = cell.pts, n = V.length;
    const M = V.map((v, k) => mid(v, V[(k + 1) % n]));
    if (cell.portal) {
      const pts = [];
      for (let k = 0; k < n; k++) pts.push(V[k], M[k]);
      out.push({ c: cell.c, pts, ins: pts.map(() => 1), portal: true });
      continue;
    }
    const c = cell.c, [e1, e2] = tangentFrame(c);
    const g = (p) => { const w = dot(p, c); return [dot(p, e1) / w, dot(p, e2) / w]; };
    const g3 = (q) => norm(add(c, add(scale(e1, q[0]), scale(e2, q[1]))));
    let V2 = V.map(g), M2 = M.map(g);
    // (sens trigo exigé)
    let Vs = V, Ms = M;
    if (area2(V2) < 0) {
      Vs = [...V].reverse(); V2 = [...V2].reverse();
      Ms = Vs.map((v, k) => mid(v, Vs[(k + 1) % n])); M2 = Ms.map(g);
    }
    // X_k : croisement des rayons de m_k et m_{k+1} vers V_{k+1}
    const X2 = [];
    let ok = true;
    for (let k = 0; k < n; k++) {
      const a = V2[k], b = V2[(k + 1) % n], c2 = V2[(k + 2) % n];
      const d0 = [b[0] - a[0], b[1] - a[1]], l0 = Math.hypot(...d0);
      const d1 = [c2[0] - b[0], c2[1] - b[1]], l1 = Math.hypot(...d1);
      const u0 = [d0[0] / l0, d0[1] / l0], n0 = [-u0[1], u0[0]];
      const u1 = [d1[0] / l1, d1[1] / l1], n1 = [-u1[1], u1[0]];
      const ra = [u0[0] * cos(theta) + n0[0] * sin(theta), u0[1] * cos(theta) + n0[1] * sin(theta)];
      const rb = [-u1[0] * cos(theta) + n1[0] * sin(theta), -u1[1] * cos(theta) + n1[1] * sin(theta)];
      const p = M2[k], q = M2[(k + 1) % n];
      const den = ra[0] * -rb[1] - ra[1] * -rb[0];
      if (abs(den) < 1e-9) { ok = false; break; }
      const s = ((q[0] - p[0]) * -rb[1] - (q[1] - p[1]) * -rb[0]) / den;
      if (!(s > 0)) { ok = false; break; }
      X2.push([p[0] + ra[0] * s, p[1] + ra[1] * s]);
    }
    const pieces = [];
    if (ok) {
      pieces.push({ P: X2, w: X2.map(() => wStar), solid: !!spec.solidStar });               // polygone central
      for (let k = 0; k < n; k++) {
        const km = (k + n - 1) % n;
        pieces.push({ P: [X2[km], M2[k], X2[k]], w: [1, 1, wStar] });                          // pointe d'étoile
        pieces.push({ P: [M2[k], V2[(k + 1) % n], M2[(k + 1) % n], X2[k]], w: [wFrame, wFrame, 1, 1] }); // cerf-volant
      }
      ok = pieces.every((pc) => area2(pc.P) > 1e-10 && convex(pc.P));
    }
    if (!ok) { // (cellule trop irrégulière pour cet angle : gardée entière, milieux compris)
      const pts = [];
      for (let k = 0; k < n; k++) pts.push(Vs[k], Ms[k]);
      out.push({ c, pts, ins: pts.map(() => wFrame), portal: false });
      continue;
    }
    // retour sur la sphère : les sommets d'origine et les milieux sont repris
    // tels quels (partagés avec les voisines), les X sont propres à la cellule
    const X3 = X2.map(g3);
    const back = (q) => {
      for (let k = 0; k < n; k++) {
        if (q === V2[k]) return Vs[k];
        if (q === M2[k]) return Ms[k];
        if (q === X2[k]) return X3[k];
      }
      return g3(q);
    };
    for (const pc of pieces) {
      const pts = pc.P.map(back);
      const cc = norm(pts.reduce((m, p) => add(m, p), [0, 0, 0]));
      out.push({ c: cc, pts, ins: pc.w, portal: false, solid: pc.solid });
    }
  }
  return out;
}

