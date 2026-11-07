// Diaphragme de l'oculus : N lames minces glissées sous la coquille, qui
// ferment l'oculus quand la coquille remonte du cœur et pivotent pour l'ouvrir
// à l'approche de la caméra (l'animation est dans scene/rig.js : rotation de
// chaque lame autour de l'axe radial de son pivot, ce qui la garde sur sa
// sphère).
//
// Les lames sont décrites dans le plan gnomonique du pôle +z (ρ = tan de
// l'angle au pôle, φ = azimut). Chaque lame est un secteur spiralé : en
// coordonnées (ρ, s), un rectangle ρ ∈ [0, ρ_o], s ∈ [0, 1], placé à
// φ = φ_i + courbure·ρ + s·(largeur + recouvrement). Les lames se recouvrent
// en tuiles : leur rayon décroît de leur bord d'attaque (s = 0) à leur bord de
// fuite (s = 1), si bien que chaque lame passe sous la suivante, en boucle.
//
// Pose fermée à la génération ; l'angle d'ouverture (le plus petit qui dégage
// tout le trou) est cherché ici et stocké avec la lame.

import { norm } from './cells.js';
import { RIG, EDGE, IN } from './mesh.js';

const { cos, sin, atan2, sqrt, PI, max, min, ceil } = Math;

// résolution (ρ, s) par niveau de détail
const RES = [[22, 10], [14, 7], [9, 4], [6, 3]];

// spec.iris : { blades, curl, overlap } ; hole : rayon gnomonique du trou de l'oculus
export function appendIris(B, spec, hole, lod) {
  const { blades: N, curl, overlap } = spec.iris;
  const Ri = 1 - spec.thickness;
  const rc = hole * 1.06;          // disque couvert en pose fermée
  const ro = hole * 1.75;          // extrémité des lames (sous la coquille)
  const span = (2 * PI) / N, width = span * (1 + overlap);
  const tb = min(0.012, spec.thickness * 0.3);     // épaisseur d'une lame
  const r0 = Ri - 0.004, drop = tb * 1.4;          // rayon du bord d'attaque, baisse jusqu'au bord de fuite
  const [nr, ns] = RES[lod];

  // extrémité arrondie : la lame raccourcit vers ses deux bords
  const rhoEnd = (s) => rc + (ro - rc) * (0.55 + 0.45 * sin(PI * s));
  const at = (i, rho, s) => {
    const phi = (2 * PI * i) / N + curl * min(rho, rc) / rc + s * width;
    return [rho * cos(phi), rho * sin(phi)];
  };
  const radius = (s, bottom) => r0 - drop * s - (bottom ? tb : 0);
  // « proximité » (surf.w) : 0 au bord extérieur, 1 à la pointe. À la naissance
  // de la coquille, les lames poussent dans la carte d'ombre depuis le bord,
  // comme les barreaux : le diaphragme s'y referme peu à peu, sans saut.
  const grow = (rho) => Math.round(Math.min(1, Math.max(0, 1 - rho / ro)) * 255);
  const to3 = (g, r) => { const d = norm([g[0], g[1], 1]); return [d[0] * r, d[1] * r, d[2] * r]; };

  // pivot : dans la partie cachée de la lame, à mi-largeur
  const pivotOf = (i) => at(i, (rc + ro) / 2, 0.5);
  // contour de la lame (pour la recherche de l'ouverture)
  const outline = (i) => {
    const P = [];
    for (let k = 0; k <= 12; k++) { const s = k / 12; P.push(at(i, rhoEnd(s), s)); }
    for (let k = 1; k <= 12; k++) { const rho = rhoEnd(1) * (1 - k / 12); P.push(at(i, rho, 1)); }
    for (let k = 1; k < 12; k++) { const rho = rhoEnd(0) * (k / 12); P.push(at(i, rho, 0)); }
    return P;
  };
  // plus petite rotation (et son sens) qui dégage le trou, avec une marge
  const clear = hole * 1.04;
  const opening = (() => {
    const P = outline(0), c = pivotOf(0);
    let best = null;
    for (const sg of [1, -1]) for (let k = 1; k <= 180; k++) {
      const a = sg * (k / 180) * PI, ca = cos(a), sa = sin(a);
      let ok = true;
      for (const p of P) {
        const x = p[0] - c[0], y = p[1] - c[1];
        const qx = c[0] + x * ca - y * sa, qy = c[1] + x * sa + y * ca;
        if (qx * qx + qy * qy < clear * clear) { ok = false; break; }
      }
      if (ok) { if (!best || Math.abs(a) < Math.abs(best)) best = a; break; }
    }
    return best ?? PI / 2;
  })();
  // (la rotation dans le plan gnomonique autour du pivot ≈ rotation autour de
  // l'axe radial du pivot ; même sens : l'axe pointe vers l'extérieur)

  for (let i = 0; i < N; i++) {
    const pv = pivotOf(i), axis = norm([pv[0], pv[1], 1]);
    B.rig([0, 0, 0], axis, opening, RIG.iris, i / N);
    // grille (ρ, s) ; ρ suit l'extrémité arrondie
    const grid = (bottom) => {
      const start = B.n;
      for (let a = 0; a <= nr; a++) for (let b = 0; b <= ns; b++) {
        const s = b / ns, rho = (rhoEnd(s) * a) / nr;
        const p = to3(at(i, rho, s), radius(s, bottom));
        const n = norm(p);
        B.vert(p, bottom ? [-n[0], -n[1], -n[2]] : n, bottom ? IN[0] : EDGE[0], bottom ? IN[1] : EDGE[1], bottom ? IN[2] : EDGE[2], grow(rho));
      }
      for (let a = 0; a < nr; a++) for (let b = 0; b < ns; b++) {
        const v = start + a * (ns + 1) + b;
        B.triN(v, v + ns + 1, v + ns + 2); B.triN(v, v + ns + 2, v + 1);
      }
    };
    grid(false);
    grid(true);
    // tranche : le long du contour (bord d'attaque, extrémité, bord de fuite)
    const rim = [];
    for (let a = 0; a <= nr; a++) rim.push([(rhoEnd(0) * a) / nr, 0]);
    for (let b = 1; b <= ns * 2; b++) { const s = b / (ns * 2); rim.push([rhoEnd(s), s]); }
    for (let a = nr - 1; a >= 0; a--) rim.push([(rhoEnd(1) * a) / nr, 1]);
    const top = [], bot = [];
    for (let k = 0; k < rim.length; k++) {
      const [rho, s] = rim[k];
      const g = at(i, rho, s);
      // normale : dans le plan tangent, vers l'extérieur de la lame
      const pa = at(i, rim[max(0, k - 1)][0], rim[max(0, k - 1)][1]), pb = at(i, rim[min(rim.length - 1, k + 1)][0], rim[min(rim.length - 1, k + 1)][1]);
      const tx = pb[0] - pa[0], ty = pb[1] - pa[1], l = sqrt(tx * tx + ty * ty) || 1;
      const p1 = to3(g, radius(s, false)), p2 = to3(g, radius(s, true));
      const d = norm(p1), nw = [ty / l, -tx / l, 0];
      const k0 = nw[0] * d[0] + nw[1] * d[1] + nw[2] * d[2];
      const n = norm([nw[0] - d[0] * k0, nw[1] - d[1] * k0, nw[2] - d[2] * k0]);
      top.push(B.vert(p1, n, EDGE[0], EDGE[1], EDGE[2], grow(rho)));
      bot.push(B.vert(p2, n, EDGE[0], EDGE[1], EDGE[2], grow(rho)));
    }
    for (let k = 0; k + 1 < rim.length; k++) { B.triN(top[k], bot[k], bot[k + 1]); B.triN(top[k], bot[k + 1], top[k + 1]); }
  }
  B.rig(null);
}

// rayon gnomonique du trou de l'oculus (cellule polaire préparée)
export const portalHole = (info) => (info && !info.closed ? info.rho : 0.3);
