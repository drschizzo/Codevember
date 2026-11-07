// Ornements des jonctions : là où les barreaux se rejoignent, un rivet, une
// pierre sertie dans son chaton, ou une épine (radiolaire). Les rivets et les
// chatons font partie du maillage de la coquille ; les pierres et les épines
// sont des instances (nid : une série d'instances par nature d'ornement).
//
// Toutes les géométries d'ornement sont unitaires ; les matrices d'instance
// (ordre colonnes, comme three.js) les posent, les orientent et les dimensionnent.

import { norm, tangentFrame, cross } from './cells.js';
import { revolve, EDGE } from './mesh.js';

const { cos, sin, PI, max, min, round } = Math;

// jonctions des barreaux (sommets des cellules), sans doublon, hors de l'oculus
export function junctions(prepared, spec) {
  const seen = new Set(), out = [];
  const cap = cos(spec.portal * 0.9);
  for (const info of prepared) for (const v of info.pts) {
    const k = `${round(v[0] * 1e4)},${round(v[1] * 1e4)},${round(v[2] * 1e4)}`;
    if (seen.has(k) || v[2] > cap) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// rayon d'un ornement de jonction (une pierre déborde du barreau, comme un pavé serti)
export const jewelRadius = (spec) => (spec.rivets || 0) * (spec.setting === 'gem' ? Math.max(spec.bar * 0.75, 0.022) : spec.bar * 0.5);

// Rivet (dôme) ou chaton (anneau qui tient la pierre), dans le maillage de la coquille
export function appendJewelMounts(B, points, spec, top, lod) {
  const rr = jewelRadius(spec), segs = [14, 10, 6][lod];
  const gem = spec.setting === 'gem';
  for (const v of points) {
    const base = [v[0] * top, v[1] * top, v[2] * top];
    if (gem) {
      // chaton : collerette au bord arrondi, ouverte au centre (la pierre y repose)
      revolve(B, base, v, [[rr * 1.02, -rr * 0.2], [rr * 1.04, rr * 0.18], [rr * 0.98, rr * 0.3], [rr * 0.86, rr * 0.32], [rr * 0.78, rr * 0.2], [rr * 0.74, 0]], segs);
    } else {
      // dôme (le dernier anneau se referme sur le sommet)
      const prof = [];
      const rings = [4, 3, 2][lod];
      for (let j = 0; j <= rings; j++) {
        const a = (PI / 2) * (j / rings);
        prof.push([rr * cos(a) + 1e-5, rr * 0.75 * sin(a) - rr * 0.15]);
      }
      revolve(B, base, v, prof, segs);
    }
  }
}

// ── Pierre taille brillant (rondiste de rayon 1 à y = 0, table en haut) ──────
// Proportions d'un brillant : table 56 %, couronne 0,16 du diamètre,
// pavillon 0,43. Facettes à plat (sommets non partagés).
export function gemGeometry() {
  const pos = [], nor = [];
  const ring = (n, r, y, off) => Array.from({ length: n }, (_, i) => { const a = ((i + off) / n) * PI * 2; return [r * cos(a), y, r * sin(a)]; });
  const table = ring(8, 0.56, 0.32, 0.5), star = ring(8, 0.8, 0.22, 0), girdle = ring(16, 1, 0, 0), girdleLo = ring(16, 1, -0.03, 0);
  const pav = ring(8, 0.45, -0.48, 0.5), culet = [0, -0.86, 0];
  const face = (a, b, c) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = norm(cross(u, v));
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 + 0.2, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { [b, c] = [c, b]; n = n.map((x) => -x); }
    pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n);
  };
  const T = [0, 0.32, 0];
  for (let i = 0; i < 8; i++) face(T, table[i], table[(i + 1) % 8]);           // table
  for (let i = 0; i < 8; i++) {
    const g0 = girdle[2 * i], g1 = girdle[2 * i + 1], g2 = girdle[(2 * i + 2) % 16];
    face(table[(i + 7) % 8], table[i], star[i]);                               // étoiles
    face(table[(i + 7) % 8], star[i], g0);                                     // bezels (deux moitiés)
    face(table[i], g0, star[i]);
    face(star[i], g0, g1); face(star[i], g1, g2);                              // demi-facettes de rondiste
    face(table[i], star[i], g2);
  }
  for (let i = 0; i < 16; i++) { const a = girdle[i], b = girdle[(i + 1) % 16], c = girdleLo[i], d = girdleLo[(i + 1) % 16]; face(a, c, d); face(a, d, b); }
  for (let i = 0; i < 8; i++) {
    const g0 = girdleLo[2 * i], g1 = girdleLo[2 * i + 1], g2 = girdleLo[(2 * i + 2) % 16];
    face(g0, g1, pav[i]); face(g1, g2, pav[i]);                                // pavillon : facettes basses
    face(pav[i], g2, culet); face(pav[i], culet, g0);
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor) };
}

// ── Épine (radiolaire) : cône effilé le long de +y, base de rayon 1 ─────────
export function spineGeometry() {
  const S = 10, Y = 14, pos = [], nor = [], tan = [], surf = [], idx = [];
  const radius = (t) => (1 - t) ** 1.6 * (1 + 0.6 * max(0, 0.12 - t) / 0.12);
  for (let j = 0; j <= Y; j++) {
    const t = j / Y, r = radius(t), dr = (radius(min(1, t + 0.02)) - radius(max(0, t - 0.02))) / 0.04;
    for (let i = 0; i < S; i++) {
      const a = (i / S) * PI * 2, c = cos(a), s = sin(a);
      pos.push(c * r, t, s * r);
      const n = norm([c, -dr * 0.02, s]); // (cône long et fin : la pente compte peu)
      nor.push(...n);
      tan.push(0, 1, 0, 1);
      surf.push(...EDGE, 255);
    }
  }
  for (let j = 0; j < Y; j++) for (let i = 0; i < S; i++) {
    const a = j * S + i, b = j * S + ((i + 1) % S), c = a + S, d = b + S;
    idx.push(a, c, d, a, d, b);
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), tangent: new Float32Array(tan), surf: new Uint8Array(surf), bev: new Float32Array(pos.length / 3 * 4), index: new Uint32Array(idx) };
}

// matrice colonne : repère (X, Y = axe, Z) dimensionné (rx, ry, rz), origine o
const frame = (X, Y, Z, rx, ry, rz, o) => [X[0] * rx, X[1] * rx, X[2] * rx, 0, Y[0] * ry, Y[1] * ry, Y[2] * ry, 0, Z[0] * rz, Z[1] * rz, Z[2] * rz, 0, o[0], o[1], o[2], 1];

// pierres posées dans les chatons
export function placeGems(points, spec, top, rng) {
  const rr = jewelRadius(spec), s = rr * 0.8;
  const m = new Float32Array(points.length * 16);
  points.forEach((v, i) => {
    const [t1, t2] = tangentFrame(v), a = rng.range(0, PI);
    const X = [t1[0] * cos(a) + t2[0] * sin(a), t1[1] * cos(a) + t2[1] * sin(a), t1[2] * cos(a) + t2[2] * sin(a)];
    const Z = cross(X, v);
    const h = top + rr * 0.2;
    m.set(frame(X, v, Z, s, s, s, [v[0] * h, v[1] * h, v[2] * h]), i * 16);
  });
  return { matrices: m, count: points.length };
}

// épines : sur une partie des jonctions, légèrement inclinées ; jamais assez
// longues pour atteindre la coquille suivante (rapport ≈ 0,6 : marge de 0,3)
export function placeSpines(points, spec, top, rng) {
  const out = [];
  for (const v of points) {
    if (!rng.chance(spec.spineDensity ?? 0.6)) continue;
    const L = spec.spines * rng.range(0.45, 1);
    const r = spec.bar * rng.range(0.22, 0.36);
    const [t1, t2] = tangentFrame(v), a = rng.range(0, PI * 2), tilt = rng.range(0, 0.25);
    const Y = norm([v[0] + (t1[0] * cos(a) + t2[0] * sin(a)) * tilt, v[1] + (t1[1] * cos(a) + t2[1] * sin(a)) * tilt, v[2] + (t1[2] * cos(a) + t2[2] * sin(a)) * tilt]);
    const [X, Z] = tangentFrame(Y);
    const h = top - 0.01;
    out.push(frame(X, Y, Z, r, L, r, [v[0] * h, v[1] * h, v[2] * h]));
  }
  const m = new Float32Array(out.length * 16);
  out.forEach((f, i) => m.set(f, i * 16));
  return { matrices: m, count: out.length };
}

