// Cuisson d'un pavage : tout ce que le GPU lit pour dessiner les alvéoles.
//
// Pour l'alvéole suivie le long de la boucle (tiling.js), à RL instants par
// étape du chemin :
// - curves : deux courbes fermées de M points — l'axe de la paroi (le contour
//   de l'alvéole) et la face intérieure de la paroi (le contour rentré d'une
//   demi-épaisseur, coins arrondis) ; le vertex shader bâtit la paroi entre les
//   deux, et son bord roulé ;
// - sdf : la distance signée au contour sur une grille, lue au pixel par le
//   fond de l'alvéole, le miel (ménisque) et l'opercule.
// Les instances du pavage sont les images de cette alvéole par le groupe.
import { track, outline, elements, area } from './tiling.js';
import { hatPatch, hatParams, hatShape, NE } from './hat.js';

// demi-flottant (IEEE 754 binary16)
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v; const x = u32[0];
  const sign = (x >> 16) & 0x8000; let exp = ((x >> 23) & 0xff) - 112; let man = x & 0x7fffff;
  if (exp <= 0) { if (exp < -10) return sign; man = (man | 0x800000) >> (1 - exp); return sign | ((man + 0x1000) >> 13); }
  if (exp >= 31) return sign | 0x7c00;
  return (sign | (exp << 10) | (man >> 13)) + ((man >> 12) & 1);
}

/** Point du contour le plus proche de (x, y) : renvoie la distance, écrit le point dans out. */
function nearest(poly, n, x, y, out) {
  let best = Infinity, bx = 0, by = 0;
  let ax = poly[2 * n - 2], ay = poly[2 * n - 1];
  for (let i = 0; i < n; i++) {
    const cx = poly[2 * i], cy = poly[2 * i + 1];
    const dx = cx - ax, dy = cy - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * dx, py = ay + t * dy;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < best) { best = d; bx = px; by = py; }
    ax = cx; ay = cy;
  }
  if (out) { out[0] = bx; out[1] = by; }
  return Math.sqrt(best);
}

function inside(poly, n, x, y) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Contour rentré de d : chaque point glisse le long du gradient de la distance jusqu'à la ligne de niveau d. */
export function inset(poly, n, d, out, o) {
  const q = [0, 0];
  const sgn = area(poly) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const x0 = poly[2 * i], y0 = poly[2 * i + 1];
    // normale intérieure : voisins distincts les plus proches
    let a = i, b = i, k = 0;
    do { a = (a + n - 1) % n; k++; } while (k < n && Math.hypot(poly[2 * a] - x0, poly[2 * a + 1] - y0) < 1e-7);
    k = 0;
    do { b = (b + 1) % n; k++; } while (k < n && Math.hypot(poly[2 * b] - x0, poly[2 * b + 1] - y0) < 1e-7);
    let t1x = x0 - poly[2 * a], t1y = y0 - poly[2 * a + 1], t2x = poly[2 * b] - x0, t2y = poly[2 * b + 1] - y0;
    let l = Math.hypot(t1x, t1y) || 1; t1x /= l; t1y /= l; l = Math.hypot(t2x, t2y) || 1; t2x /= l; t2y /= l;
    let nx = -(t1y + t2y) * sgn, ny = (t1x + t2x) * sgn;
    l = Math.hypot(nx, ny);
    if (l < 1e-4) { nx = -t1y * sgn; ny = t1x * sgn; l = 1; } // (rebroussement)
    nx /= l; ny /= l;
    let x = x0 + nx * d * 0.5, y = y0 + ny * d * 0.5;
    if (!inside(poly, n, x, y)) { x = x0 + nx * d * 0.05; y = y0 + ny * d * 0.05; }
    for (let it = 0; it < 10; it++) {
      const D = nearest(poly, n, x, y, q);
      if (D >= d * 0.995 || D < 1e-9) break;
      const gx = (x - q[0]) / D, gy = (y - q[1]) / D;
      const step = (d - D) * 0.9;
      const xn = x + gx * step, yn = y + gy * step;
      // (au-delà de l'axe médian, la distance ne monte plus : on s'arrête)
      if (nearest(poly, n, xn, yn, null) <= D) break;
      x = xn; y = yn;
    }
    out[o + 4 * i + 2] = x; out[o + 4 * i + 3] = y;
  }
}

/**
 * spec : { group, path, profiles, amp, wall (demi-épaisseur, en unités d'alvéole),
 *          n (points par arête), RL (instants par étape), sdfN, rows:[r0, r1] (tranche à cuire) }
 */
// D'où vient le contour de la rangée r : un pavage de groupe (une étape du chemin par bloc
// de RL rangées) ou le chapeau (deux blocs : le chapeau, puis l'anti-chapeau).
function provider(spec, M, RL) {
  if (spec.group === 'hat') {
    const ne = Math.floor(M / NE);
    return {
      L: 2, relay: { c: 1, s: 0, tx: 0, ty: 0, err: 0 },
      row(r, tmp) {
        const v = Math.floor(r / RL), P = hatParams(spec.loop, (r - v * RL) / (RL - 1));
        const S = hatShape(P.a, P.b, v);
        let o = 0;
        for (let e = 0; e < NE; e++) {
          const f = (e + 1) % NE;
          for (let i = 0; i < ne; i++) { const t = i / ne; tmp[o++] = S[2 * e] + (S[2 * f] - S[2 * e]) * t; tmp[o++] = S[2 * e + 1] + (S[2 * f + 1] - S[2 * e + 1]) * t; }
        }
        while (o < 2 * M) { tmp[o++] = S[0]; tmp[o++] = S[1]; } // (points en trop : confondus avec le premier)
        // (sens direct, comme les autres pavages : les faces des parois en dépendent)
        if (area(tmp) < 0) for (let i = 0, j = M - 1; i < j; i++, j--) { const x = tmp[2 * i], y = tmp[2 * i + 1]; tmp[2 * i] = tmp[2 * j]; tmp[2 * i + 1] = tmp[2 * j + 1]; tmp[2 * j] = x; tmp[2 * j + 1] = y; }
        return { leg: v, extra: [P.a[0], P.a[1], P.b[0], P.b[1]] };
      },
    };
  }
  const { group, path, profiles, amp = 1 } = spec, n = M / 6;
  const tr = track(group, path);
  return {
    L: path.legs.length, relay: tr.relay,
    row(r, tmp) {
      const leg = Math.floor(r / RL), s = (r - leg * RL) / (RL - 1), g = path.legs[leg];
      const ea = [0, 0, 0], eb = [0, 0, 0]; ea[g.a] = 1; eb[g.b] = 1;
      const u = 1 - s;
      outline(tr.centers[leg], [0, 1, 2].map((k) => u * u * ea[k] + 2 * u * s * g.q[k] + s * s * eb[k]), profiles, n, amp, tmp);
      return { leg, extra: [0, 0, 0, 0] };
    },
  };
}

export function bakeTiling(spec) {
  const { wall = 0.04, n = 16, RL = 48, sdfN = 64 } = spec;
  const M = 6 * n;
  const prov = provider(spec, M, RL);
  const L = prov.L, rows = L * RL;
  const r0 = spec.rows ? spec.rows[0] : 0, r1 = spec.rows ? spec.rows[1] : rows;
  // boîtes par bloc (carrées), sur un échantillonnage grossier du bloc entier
  const boxes = new Float32Array(L * 4);
  const tmp = new Float64Array(2 * M);
  for (let l = 0; l < L; l++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 17; k++) {
      prov.row(l * RL + Math.round(k / 16 * (RL - 1)), tmp);
      for (let i = 0; i < M; i++) { x0 = Math.min(x0, tmp[2 * i]); x1 = Math.max(x1, tmp[2 * i]); y0 = Math.min(y0, tmp[2 * i + 1]); y1 = Math.max(y1, tmp[2 * i + 1]); }
    }
    const size = Math.max(x1 - x0, y1 - y0) + 0.16;
    boxes[4 * l] = (x0 + x1) / 2 - size / 2; boxes[4 * l + 1] = (y0 + y1) / 2 - size / 2; boxes[4 * l + 2] = size; boxes[4 * l + 3] = 0;
  }
  const nr = r1 - r0;
  const W = M + 3; // (colonne M : le centre de l'alvéole ; M + 1 : sa boîte à cet instant ; M + 2 : (a, b) du chapeau)
  const curves = new Float32Array(nr * W * 4);
  const sdf = new Uint16Array(nr * sdfN * sdfN * 2); // (distance signée, ménisque)
  const lam = spec.capillary ?? 0.11, segL = new Float64Array(M), midX = new Float64Array(M), midY = new Float64Array(M);
  for (let r = r0; r < r1; r++) {
    const { leg, extra } = prov.row(r, tmp);
    const o = (r - r0) * W * 4;
    curves.set(extra, o + 4 * M + 8);
    for (let i = 0; i < M; i++) { curves[o + 4 * i] = tmp[2 * i]; curves[o + 4 * i + 1] = tmp[2 * i + 1]; }
    inset(tmp, M, wall, curves, o);
    {
      // centre de gravité de l'alvéole
      let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < M; i++) { const j = (i + 1) % M; const w = tmp[2 * i] * tmp[2 * j + 1] - tmp[2 * j] * tmp[2 * i + 1]; A += w; cx += (tmp[2 * i] + tmp[2 * j]) * w; cy += (tmp[2 * i + 1] + tmp[2 * j + 1]) * w; }
      cx /= 3 * A; cy /= 3 * A;
      curves.set([cx, cy, cx, cy], o + 4 * M);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let i = 0; i < M; i++) { bx0 = Math.min(bx0, tmp[2 * i]); bx1 = Math.max(bx1, tmp[2 * i]); by0 = Math.min(by0, tmp[2 * i + 1]); by1 = Math.max(by1, tmp[2 * i + 1]); }
      curves.set([bx0, by0, bx1, by1], o + 4 * M + 4);
    }
    const bx = boxes[4 * leg], by = boxes[4 * leg + 1], bs = boxes[4 * leg + 2];
    const so = (r - r0) * sdfN * sdfN * 2;
    // le ménisque : la somme, sur tout le contour, d'un noyau exponentiel de la
    // distance (portée : la longueur capillaire). Contre une paroi droite il vaut
    // 1 ; il décroît vers le centre, et il est lisse partout — la distance au
    // contour, elle, fait un pli le long de l'axe médian de l'alvéole
    for (let i = 0; i < M; i++) {
      const j = (i + 1) % M, dx = tmp[2 * j] - tmp[2 * i], dy = tmp[2 * j + 1] - tmp[2 * i + 1];
      segL[i] = Math.hypot(dx, dy); midX[i] = (tmp[2 * i] + tmp[2 * j]) / 2; midY[i] = (tmp[2 * i + 1] + tmp[2 * j + 1]) / 2;
    }
    for (let j = 0; j < sdfN; j++) {
      const y = by + (j + 0.5) / sdfN * bs;
      for (let i = 0; i < sdfN; i++) {
        const x = bx + (i + 0.5) / sdfN * bs;
        const d = nearest(tmp, M, x, y, null);
        let h = 0;
        for (let k = 0; k < M; k++) { const rr = Math.hypot(x - midX[k], y - midY[k]); if (rr < 6 * lam) h += segL[k] * Math.exp(-Math.max(rr, wall) / lam); }
        sdf[so + 2 * (j * sdfN + i)] = toHalf(inside(tmp, M, x, y) ? d : -d);
        sdf[so + 2 * (j * sdfN + i) + 1] = toHalf(Math.min(2, h / (2 * lam * Math.exp(-wall / lam) * 1.3)));
      }
    }
  }
  return { curves, sdf, boxes, M, W, rows, r0, r1, RL, L, sdfN, relay: prov.relay, wall };
}

/** Les instances : isométries du groupe dans un disque (c, s, tx, ty), et le centre de l'alvéole de référence. */
export function bakeInstances(group, path, profiles, R, amp = 1) {
  const tr = track(group, path);
  const els = elements(group, R);
  const iso = new Float32Array(els.length * 4);
  els.forEach((g, i) => { iso[4 * i] = g.c; iso[4 * i + 1] = g.s; iso[4 * i + 2] = g.tx; iso[4 * i + 3] = g.ty; });
  const c = tr.centers[0];
  const ref = [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3];
  return { iso, count: els.length, ref, relay: tr.relay };
}

/**
 * Les instances d'un pavage chapeau : rotation (c, s) et forme (0 chapeau, 1 anti-chapeau),
 * coefficients (A, B) de leur premier sommet, recentrés sur une tuile du milieu (elle reste
 * à l'origine pendant toute la boucle) et tournés de `rot`. pos : leur place à ψ = 0.
 */
export function bakeHatInstances({ level = 4, rot = 0, loop }) {
  const H = hatPatch(level), n = H.tiles.length;
  const P0 = hatParams(loop, 0);
  const at = (T) => [T.A[0] * P0.a[0] - T.A[1] * P0.a[1] + T.B[0] * P0.b[0] - T.B[1] * P0.b[1], T.A[0] * P0.a[1] + T.A[1] * P0.a[0] + T.B[0] * P0.b[1] + T.B[1] * P0.b[0]];
  let cx = 0, cy = 0; for (const T of H.tiles) { const p = at(T); cx += p[0]; cy += p[1]; } cx /= n; cy /= n;
  let mid = H.tiles[0], best = Infinity; for (const T of H.tiles) { const p = at(T), d = Math.hypot(p[0] - cx, p[1] - cy); if (d < best) { best = d; mid = T; } }
  const A0 = mid.A.slice(), B0 = mid.B.slice(), rc = Math.cos(rot), rs = Math.sin(rot);
  const iso = new Float32Array(n * 4), hat = new Float32Array(n * 4), pos = new Float32Array(n * 2);
  H.tiles.forEach((T, i) => {
    const ax = T.A[0] - A0[0], ay = T.A[1] - A0[1], bx = T.B[0] - B0[0], by = T.B[1] - B0[1];
    const A = [rc * ax - rs * ay, rs * ax + rc * ay], B = [rc * bx - rs * by, rs * bx + rc * by];
    iso.set([rc * T.c - rs * T.s, rs * T.c + rc * T.s, T.mir, 0], 4 * i);
    hat.set([A[0], A[1], B[0], B[1]], 4 * i);
    pos.set(at({ A, B }), 2 * i);
  });
  return { iso, hat, pos, count: n, err: H.err, ab0: [P0.a[0], P0.a[1], P0.b[0], P0.b[1]], relay: { c: 1, s: 0, tx: 0, ty: 0 } };
}
