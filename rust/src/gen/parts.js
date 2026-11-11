// Pièces de construction métallique : tôles découpées à chants arrondis,
// profilés laminés (cornières, plats, fers en T), corps de révolution, rivets
// à tête ronde, boulons à six pans chanfreinés, rondelles, écrous, filets.
//
// Toutes les primitives écrivent dans un `Buffers` (gen/mesh.js), dans un
// repère local { o, X, Y, Z } : une tôle a son contour dans le plan (X, Y) et
// son épaisseur selon Z ; un corps de révolution a son axe selon Z.
//
// Aucune arête vive sur une pièce laminée ou forgée : les chants des tôles sont
// arrondis (rayon r aux normales calculées), les profilés ont leurs congés de
// laminage, les têtes de rivet leur petit bourrelet. Seules les coupes à la
// scie (bouts de barre) restent vives, comme en vrai.
import { add, sub, mul, norm, cross, dot } from './mesh.js';

const { PI, cos, sin, abs, sqrt, atan2, max, min } = Math;

// ── Repères ──────────────────────────────────────────────────────────────────
// repère orthonormé d'axe Z (X choisi d'après une direction indicative)
export function frame(o, Z, Xhint = null) {
  Z = norm(Z);
  let X = Xhint ?? (abs(Z[1]) < 0.99 ? cross([0, 1, 0], Z) : [1, 0, 0]);
  X = norm(sub(X, mul(Z, dot(X, Z))));
  const Y = cross(Z, X);
  return { o, X, Y, Z };
}
// point / vecteur d'un repère vers le monde
export const P = (F, p) => add(F.o, add(add(mul(F.X, p[0]), mul(F.Y, p[1])), mul(F.Z, p[2] ?? 0)));
export const V = (F, v) => add(add(mul(F.X, v[0]), mul(F.Y, v[1])), mul(F.Z, v[2] ?? 0));
const use = (B, F) => B.frame(F.o, F.X, F.Y, F.Z);

// ── Polygones 2D ─────────────────────────────────────────────────────────────
export const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const ccw = (pts) => (area2(pts) < 0 ? pts.slice().reverse() : pts);

// triangulation par oreilles d'un polygone simple (sens direct) → indices
export function earClip(pts) {
  const n = pts.length, idx = Array.from({ length: n }, (_, i) => i), out = [];
  const crs = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => crs(a, b, p) >= -1e-12 && crs(b, c, p) >= -1e-12 && crs(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (crs(a, b, c) <= 1e-14) continue;
      let ok = true;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; if (inside(pts[j], a, b, c)) { ok = false; break; } }
      if (!ok) continue;
      out.push(i0, i1, i2); idx.splice(k, 1); cut = true; break;
    }
    if (!cut) break; // (polygone dégénéré : on s'arrête proprement)
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// polygone à coins arrondis : chaque sommet reçoit un congé de rayon r[i]
// (borné par la moitié des côtés voisins), k pas par congé
export function roundPoly(pts, r, k = 6) {
  pts = ccw(pts);
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const ri = Array.isArray(r) ? r[i] : r;
    const d0 = [p0[0] - p1[0], p0[1] - p1[1]], d2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l0 = Math.hypot(...d0), l2 = Math.hypot(...d2);
    const u0 = [d0[0] / l0, d0[1] / l0], u2 = [d2[0] / l2, d2[1] / l2];
    const ang = Math.acos(Math.max(-1, Math.min(1, u0[0] * u2[0] + u0[1] * u2[1])));
    if (ri <= 0 || ang > PI - 0.01) { out.push(p1); continue; }
    let t = ri / Math.tan(ang / 2);
    t = Math.min(t, l0 * 0.48, l2 * 0.48);
    const rr = t * Math.tan(ang / 2);
    const a = [p1[0] + u0[0] * t, p1[1] + u0[1] * t], b = [p1[0] + u2[0] * t, p1[1] + u2[1] * t];
    const bis = norm([u0[0] + u2[0], u0[1] + u2[1], 0]);
    const cdist = rr / Math.sin(ang / 2);
    const c = [p1[0] + bis[0] * cdist, p1[1] + bis[1] * cdist];
    let a0 = atan2(a[1] - c[1], a[0] - c[0]), a1 = atan2(b[1] - c[1], b[0] - c[0]);
    // sens : du point a au point b par le petit arc
    let da = a1 - a0; while (da > PI) da -= 2 * PI; while (da < -PI) da += 2 * PI;
    for (let j = 0; j <= k; j++) { const t2 = a0 + (da * j) / k; out.push([c[0] + rr * cos(t2), c[1] + rr * sin(t2)]); }
  }
  return out;
}

// normales 2D sortantes aux sommets d'un contour (sens direct), lissées
export function outlineNormals(pts) {
  const n = pts.length, N = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
    const e0 = norm([b[1] - a[1], -(b[0] - a[0]), 0]), e1 = norm([c[1] - b[1], -(c[0] - b[0]), 0]);
    N.push(norm(add(e0, e1)));
  }
  return N;
}

// ── Tôle découpée ────────────────────────────────────────────────────────────
// contour (sens direct, plan XY du repère), épaisseur t selon Z centrée,
// chants arrondis de rayon r. Les faces reçoivent la finition s.
export function slab(B, F, outline, t, r, s, { z0 = null } = {}) {
  use(B, F);
  const pts = ccw(outline), n = pts.length, N = outlineNormals(pts);
  r = Math.min(r, t / 2 - 1e-5);
  const zc = z0 ?? 0;
  const ring = (beta, zmid) => pts.map((p, i) => {
    const off = -r + r * sin(beta), z = zmid + r * cos(beta);
    const nn = norm([N[i][0] * sin(beta), N[i][1] * sin(beta), cos(beta)]);
    return B.vert([p[0] + N[i][0] * off, p[1] + N[i][1] * off, z], nn, s, [-N[i][1], N[i][0], 0]);
  });
  const rows = [];
  const K = 3;
  for (let j = 0; j <= K; j++) rows.push(ring((PI / 2) * (j / K), zc + t / 2 - r));
  for (let j = 0; j <= K; j++) rows.push(ring(PI / 2 + (PI / 2) * (j / K), zc - t / 2 + r));
  B.grid(rows, true);
  // faces planes (contour rentré de r)
  const inset = pts.map((p, i) => [p[0] - N[i][0] * r, p[1] - N[i][1] * r]);
  const tri = earClip(inset);
  for (const [z, nz] of [[zc + t / 2, 1], [zc - t / 2, -1]]) {
    const ids = inset.map((p) => B.vert([p[0], p[1], z], [0, 0, nz], s, [1, 0, 0]));
    for (let i = 0; i < tri.length; i += 3) B.tri(ids[tri[i]], ids[tri[i + 1]], ids[tri[i + 2]]);
  }
  B.noFrame();
}

// ── Profilé extrudé ──────────────────────────────────────────────────────────
// profil fermé (sens direct, plan XY), extrudé selon Z de z0 à z1 ; normales
// lissées sous `smooth` radians d'angle entre côtés (congés), vives au-delà.
// Bouts coupés à la scie : faces planes.
export function prism(B, F, prof, z0, z1, s, { smooth = 0.6, nz = 1, caps = true, capS = null } = {}) {
  use(B, F);
  const pts = ccw(prof), n = pts.length;
  const en = []; // normale de chaque côté i → i+1
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; en.push(norm([b[1] - a[1], -(b[0] - a[0]), 0])); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const prevN = en[(i + n - 1) % n], nextN = en[(i + 1) % n], N0 = en[i];
    const na = Math.acos(Math.max(-1, Math.min(1, dot(prevN, N0)))) < smooth ? norm(add(prevN, N0)) : N0;
    const nb = Math.acos(Math.max(-1, Math.min(1, dot(nextN, N0)))) < smooth ? norm(add(nextN, N0)) : N0;
    const rows = [];
    for (let k = 0; k <= nz; k++) {
      const z = z0 + ((z1 - z0) * k) / nz;
      rows.push([B.vert([a[0], a[1], z], na, s, [0, 0, 1]), B.vert([b[0], b[1], z], nb, s, [0, 0, 1])]);
    }
    B.grid(rows);
  }
  if (caps) {
    const tri = earClip(pts);
    for (const [z, d] of [[z0, -1], [z1, 1]]) {
      const ids = pts.map((p) => B.vert([p[0], p[1], z], [0, 0, d], capS ?? s, [1, 0, 0]));
      for (let i = 0; i < tri.length; i += 3) B.tri(ids[tri[i]], ids[tri[i + 1]], ids[tri[i + 2]]);
    }
  }
  B.noFrame();
}

// profil de cornière à ailes égales (a : aile, t : épaisseur), talon à
// l'origine, ailes selon +X et +Y ; congé de laminage r1 à la racine, bouts
// d'ailes arrondis r2
export function angleProfile(a, t, r1 = t, r2 = t / 2) {
  // (roundPoly arrondit aussi le coin rentrant : c'est le congé de racine)
  return roundPoly([[0, 0], [a, 0], [a, t], [t, t], [t, a], [0, a]], [t * 0.25, r2, r2, r1, r2, r2], 4);
}

// ── Révolution ───────────────────────────────────────────────────────────────
// profil [[r, z], …] (du bas vers le haut, à r ≥ 0), axe Z du repère ; arêtes
// vives au-delà de `smooth` ; M pas angulaires
export function revolve(B, F, prof, s, { M = 32, smooth = 0.5, a0 = 0, a1 = 2 * PI } = {}) {
  use(B, F);
  const n = prof.length, full = abs(a1 - a0 - 2 * PI) < 1e-9;
  // (normale sortante : d'après le sens du profil fermé par l'axe)
  const closed = [...prof, [0, prof[n - 1][1]], [0, prof[0][1]]];
  let ar = 0;
  for (let i = 0; i < closed.length; i++) { const a = closed[i], b = closed[(i + 1) % closed.length]; ar += a[0] * b[1] - b[0] * a[1]; }
  const sg = ar >= 0 ? 1 : -1;
  const en = [];
  for (let i = 0; i + 1 < n; i++) { const a = prof[i], b = prof[i + 1]; const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(d[0], d[1]) || 1; en.push([(sg * d[1]) / l, (-sg * d[0]) / l]); }
  for (let i = 0; i + 1 < n; i++) {
    const a = prof[i], b = prof[i + 1];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const N0 = en[i];
    const nrm = (j, side) => {
      const other = en[i + side];
      if (!other) return N0;
      const c = N0[0] * other[0] + N0[1] * other[1];
      return Math.acos(Math.max(-1, Math.min(1, c))) < smooth ? (() => { const m = [N0[0] + other[0], N0[1] + other[1]]; const l = Math.hypot(...m) || 1; return [m[0] / l, m[1] / l]; })() : N0;
    };
    const na = nrm(i, -1), nb = nrm(i, 1);
    const cols = full ? M : M + 1;
    const rows = [[a, na], [b, nb]].map(([q, nq]) => Array.from({ length: cols }, (_, k) => {
      const ph = a0 + ((a1 - a0) * k) / M, c = cos(ph), sn = sin(ph);
      return B.vert([c * q[0], sn * q[0], q[1]], [c * nq[0], sn * nq[0], nq[1]], typeof s === 'function' ? s(i) : s, [-sn, c, 0]);
    }));
    B.grid(rows, full);
  }
  B.noFrame();
}

// ── Rivet à tête ronde (bouterolle) ──────────────────────────────────────────
// p : centre de la base, n : normale de la tôle, d : diamètre de la tige
export function rivet(B, p, n, d, s, M = 14) {
  const R = 0.8 * d, H = 0.62 * d, prof = [[0, -0.0005]];
  prof.push([R + 0.06 * d, -0.0005], [R + 0.05 * d, 0.03 * d], [R * 0.995, 0.07 * d]);
  for (let j = 1; j <= 6; j++) { const a = (PI / 2) * (j / 6); prof.push([R * cos(a) * 0.99 + 1e-6, 0.07 * d + (H - 0.07 * d) * sin(a)]); }
  prof[prof.length - 1][0] = 0;
  revolve(B, frame(p, n), prof, s, { M, smooth: 0.9 });
}

// ── Six pans chanfreinés (tête de boulon, écrou) ─────────────────────────────
// hauteur h selon +Z depuis la base ; ouverture (sur plats) af ; chanfrein
// conique à 30° en haut (et en bas si both) qui dessine les arcs sur les pans
export function hexPrism(B, F, af, h, s, { both = false, segs = 5 } = {}) {
  use(B, F);
  const Rc = af / sqrt(3); // rayon aux sommets
  const rC = af / 2 * 0.95; // début du chanfrein
  const tanA = Math.tan(PI / 6);
  const ztop = (r) => h - max(0, r - rC) * tanA;
  const zbot = (r) => (both ? max(0, r - rC) * tanA : 0);
  // pans
  for (let k = 0; k < 6; k++) {
    const a0 = (PI / 3) * k + PI / 6, a1 = a0 + PI / 3;
    const c0 = [Rc * cos(a0), Rc * sin(a0)], c1 = [Rc * cos(a1), Rc * sin(a1)];
    const nrm = [cos(a0 + PI / 6), sin(a0 + PI / 6), 0];
    const rows = [[], []];
    for (let j = 0; j <= segs; j++) {
      const t = j / segs, x = c0[0] + (c1[0] - c0[0]) * t, y = c0[1] + (c1[1] - c0[1]) * t, r = Math.hypot(x, y);
      rows[0].push(B.vert([x, y, zbot(r)], nrm, s, [0, 0, 1]));
      rows[1].push(B.vert([x, y, ztop(r)], nrm, s, [0, 0, 1]));
    }
    B.grid(rows);
  }
  // dessus (et dessous) : anneaux concentriques ; normale du cône dans le chanfrein
  const cap = (top) => {
    const rings = [];
    const radii = [0, rC * 0.5, rC * 0.97, rC, (rC + Rc) / 2, Rc];
    for (const rr of radii) {
      const row = [];
      for (let k = 0; k < 36; k++) {
        const ph = (2 * PI * k) / 36;
        // rayon borné par l'hexagone dans cette direction
        const sector = ((ph - PI / 6) % (PI / 3) + PI / 3) % (PI / 3) - PI / 6;
        const rHex = (af / 2) / cos(sector);
        const r = Math.min(rr, rHex);
        const ch = r > rC;
        const z = top ? ztop(r) : zbot(r);
        const nn = ch ? norm([cos(ph) * tanA * (top ? 1 : 1), sin(ph) * tanA, top ? 1 : -1]) : [0, 0, top ? 1 : -1];
        row.push(B.vert([cos(ph) * r, sin(ph) * r, z], nn, s));
      }
      rings.push(row);
    }
    B.grid(rings, true);
  };
  cap(true);
  if (both) cap(false);
  B.noFrame();
}

// rondelle plate : diamètre extérieur D, intérieur d, épaisseur t
export function washer(B, p, n, D, d, t, s) {
  const e = t * 0.35, R = D / 2, r = d / 2;
  revolve(B, frame(p, n), [[r, 0], [R - e, 0], [R, e], [R, t - e], [R - e, t], [r + e * 0.5, t], [r, t - e * 0.5], [r, 0]], s, { M: 24, smooth: 0.9 });
}

// bout de tige filetée : rayon d/2, longueur L, pas p (filet en anneaux)
export function threadEnd(B, p, n, d, L, pitch, s) {
  const prof = [[0, 0]];
  const R = d / 2, r = R * 0.86;
  const nT = Math.max(2, Math.floor((L - d * 0.15) / pitch));
  prof.push([R * 0.995, 0]);
  for (let i = 0; i < nT; i++) { const z = i * pitch; prof.push([R, z + pitch * 0.2], [r, z + pitch * 0.55]); }
  const zt = nT * pitch;
  prof.push([R * 0.95, zt + pitch * 0.2], [R * 0.82, zt + d * 0.12], [R * 0.5, zt + d * 0.16], [0, zt + d * 0.17]);
  revolve(B, frame(p, n), prof, s, { M: 16, smooth: 1.2 });
}

// boulon complet à travers un assemblage : tête en p1 (normale n1 sortant de
// la tôle), écrou en p2 (normale n2) ; d : diamètre
export function bolt(B, p1, n1, p2, n2, d, s, { nutS = null, washers = true, headHex = true } = {}) {
  const af = 1.5 * d, wt = 0.15 * d, D = 2.1 * d;
  let q1 = p1, q2 = p2;
  if (washers) { washer(B, p1, n1, D, d * 1.08, wt, s); washer(B, p2, n2, D, d * 1.08, wt, nutS ?? s); q1 = add(p1, mul(n1, wt)); q2 = add(p2, mul(n2, wt)); }
  const rot = (n) => { const F = frame([0, 0, 0], n); return F.X; };
  if (headHex) hexPrism(B, frame(q1, n1, rot(n1)), af, 0.65 * d, s);
  hexPrism(B, frame(q2, n2, rot(n2)), af, 0.85 * d, nutS ?? s, { both: true });
  threadEnd(B, add(q2, mul(n2, 0.84 * d)), n2, d, 0.45 * d + 0.012, Math.max(0.0025, d * 0.12), nutS ?? s);
}

// goujon à deux écrous (presse-étoupe) : un écrou en p, normale n, tige L
export function stud(B, p, n, d, L, s) {
  washer(B, p, n, 2 * d, d * 1.08, 0.15 * d, s);
  const q = add(p, mul(n, 0.15 * d));
  hexPrism(B, frame(q, n), 1.5 * d, 0.85 * d, s, { both: true });
  threadEnd(B, add(q, mul(n, 0.84 * d)), n, d, L, Math.max(0.0025, d * 0.12), s);
}

// ── Tube à section variable le long d'une courbe ─────────────────────────────
// pts : centres ; rad(i) → [rx, ry] (section elliptique, ry selon `up`)
export function loft(B, pts, rad, s, { nr = 14, up = [0, 0, 1], caps = false } = {}) {
  const M = pts.length;
  const T = pts.map((_, i) => norm(sub(pts[Math.min(M - 1, i + 1)], pts[Math.max(0, i - 1)])));
  const rows = [];
  for (let i = 0; i < M; i++) {
    const Y = norm(sub(up, mul(T[i], dot(up, T[i])))), X = cross(Y, T[i]);
    const [rx, ry] = rad(i), row = [];
    for (let k = 0; k < nr; k++) {
      const a = (2 * PI * k) / nr, c = cos(a), sn = sin(a);
      const pp = add(pts[i], add(mul(X, rx * c), mul(Y, ry * sn)));
      const nn = norm(add(mul(X, c / rx), mul(Y, sn / ry)));
      row.push(B.vert(pp, nn, s, T[i]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  if (caps) for (const [i, d] of [[0, -1], [M - 1, 1]]) {
    const c = B.vert(pts[i], mul(T[i], d), s);
    const ring = [];
    const Y = norm(sub(up, mul(T[i], dot(up, T[i])))), X = cross(Y, T[i]);
    const [rx, ry] = rad(i);
    for (let k = 0; k < nr; k++) { const a = (2 * PI * k) / nr; ring.push(B.vert(add(pts[i], add(mul(X, rx * cos(a)), mul(Y, ry * sin(a)))), mul(T[i], d), s)); }
    for (let k = 0; k < nr; k++) B.tri(c, ring[k], ring[(k + 1) % nr]);
  }
}

// ── Maillon de chaîne (tore étiré) ───────────────────────────────────────────
export function chainLink(B, F, L, R, r, s, nu = 24, nv = 8) {
  use(B, F);
  const rows = [];
  const half = (L - 2 * R) / 2;
  for (let j = 0; j <= nv; j++) {
    const th = (2 * PI * j) / nv, row = [];
    for (let i = 0; i < nu; i++) {
      const ph = (2 * PI * i) / nu;
      const cx = cos(ph) * R + (cos(ph) >= 0 ? half : -half), cy = sin(ph) * R;
      const d = [cos(ph), sin(ph), 0];
      const nn = [cos(th) * d[0], cos(th) * d[1], sin(th)];
      row.push(B.vert([cx + nn[0] * r, cy + nn[1] * r, nn[2] * r], nn, s, [-sin(ph), cos(ph), 0]));
    }
    rows.push(row);
  }
  B.grid(rows, true);
  B.noFrame();
}

export { PI, cos, sin, abs, sqrt, atan2, max, min };

// ── Profil balayé le long d'un contour fermé (hiloire, cerclage) ─────────────
// path : contour 2D fermé (plan XY du repère) ; prof : points [u, v] du profil
// (u vers l'extérieur du contour, v selon Z), fermé, sens quelconque
export function ringSweep(B, F, path, prof, s, { smooth = 0.6 } = {}) {
  use(B, F);
  const pts = ccw(path), N = outlineNormals(pts), n = pts.length;
  const pr = area2(prof) < 0 ? prof.slice().reverse() : prof, m = pr.length;
  const en = [];
  for (let i = 0; i < m; i++) { const a = pr[i], b = pr[(i + 1) % m]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; en.push([(b[1] - a[1]) / l, -(b[0] - a[0]) / l]); }
  for (let i = 0; i < m; i++) {
    const a = pr[i], b = pr[(i + 1) % m], N0 = en[i];
    const sm = (o) => { const c = N0[0] * o[0] + N0[1] * o[1]; if (Math.acos(Math.max(-1, Math.min(1, c))) < smooth) { const q = [N0[0] + o[0], N0[1] + o[1]], l = Math.hypot(...q); return [q[0] / l, q[1] / l]; } return N0; };
    const na = sm(en[(i + m - 1) % m]), nb = sm(en[(i + 1) % m]);
    const rows = [[a, na], [b, nb]].map(([q, nq]) => pts.map((p, k) => {
      const o2 = N[k];
      return B.vert([p[0] + o2[0] * q[0], p[1] + o2[1] * q[0], q[1]], norm([o2[0] * nq[0], o2[1] * nq[0], nq[1]]), s, [-o2[1], o2[0], 0]);
    }));
    // (rangées dans le sens du contour : on les transpose en grille fermée)
    const grid = [rows[0], rows[1]];
    B.grid(grid, true);
  }
  B.noFrame();
}

// anneau de levage (piton) vissé en p selon n ; le plan de l'anneau contient n et t
export function eyeBolt(B, p, n, t, d, s) {
  washer(B, p, n, 2.2 * d, d, 0.25 * d, s);
  revolve(B, frame(add(p, mul(n, 0.25 * d)), n), [[0, 0], [0.95 * d, 0], [d, 0.1 * d], [0.85 * d, 0.45 * d], [0.5 * d, 0.6 * d], [0, 0.62 * d]], s, { M: 20, smooth: 0.8 });
  const c = add(p, mul(n, 0.25 * d + 1.55 * d));
  const Fr = { o: c, X: norm(t), Y: n, Z: norm(cross(t, n)) };
  use(B, Fr);
  const R = 1.05 * d, r = 0.32 * d, rows = [];
  for (let j = 0; j <= 10; j++) {
    const th = (2 * PI * j) / 10, row = [];
    for (let i = 0; i < 28; i++) { const ph = (2 * PI * i) / 28, dd = [cos(ph), sin(ph), 0], nn = [cos(th) * dd[0], cos(th) * dd[1], sin(th)]; row.push(B.vert([dd[0] * R + nn[0] * r, dd[1] * R + nn[1] * r, nn[2] * r], nn, s)); }
    rows.push(row);
  }
  B.grid(rows, true);
  B.noFrame();
  return add(c, mul(n, R)); // point d'accroche (haut de l'anneau)
}

// oreille de levage : plaque percée (le trou est réel : couronne de
// révolution) dont le pied est fixé à la pièce, et la manille (anneau) qui
// passe dans le trou et porte sur son bord haut quand on lève.
// base : point du bord d'où sort l'oreille ; up : direction de l'oreille ;
// nrm : normale de la plaque (axe du trou) ; inset : longueur du pied
// engagée dans la pièce ; t : épaisseur. Renvoie le haut de la manille.
export function padeye(B, base, up, nrm, s, { inset = 0.04, t = 0.012, ringS = s } = {}) {
  up = norm(up); nrm = norm(nrm);
  const side = cross(up, nrm);
  slab(B, { o: base, X: side, Y: up, Z: nrm }, roundPoly([[-0.04, -inset], [0.04, -inset], [0.04, 0], [0.023, 0.03], [-0.023, 0.03], [-0.04, 0]], [0.004, 0.004, 0.01, 0.004, 0.004, 0.01], 3), t, Math.min(0.003, t / 2 - 1e-4), s);
  const hc = add(base, mul(up, 0.055));
  revolve(B, { o: add(hc, mul(nrm, -t / 2)), X: up, Y: side, Z: nrm }, [[0.013, 0], [0.034, 0], [0.034, t], [0.013, t], [0.013, 0]], s, { M: 32, smooth: 0.5 });
  const Rr = 0.03, c = add(hc, mul(up, 0.006 + Rr));
  use(B, { o: c, X: up, Y: nrm, Z: side });
  const rows = [];
  for (let j = 0; j <= 10; j++) {
    const th = (2 * PI * j) / 10, row = [];
    for (let i = 0; i < 32; i++) { const ph = (2 * PI * i) / 32, dd = [cos(ph), sin(ph), 0], nn = [cos(th) * dd[0], cos(th) * dd[1], sin(th)]; row.push(B.vert([dd[0] * Rr + nn[0] * 0.006, dd[1] * Rr + nn[1] * 0.006, nn[2] * 0.006], nn, ringS)); }
    rows.push(row);
  }
  B.grid(rows, true);
  B.noFrame();
  return add(c, mul(up, Rr + 0.006));
}

// tôle percée : contour extérieur et ouverture (tous deux convexes autour de
// l'origine du repère), épaisseur t selon Z centrée. Faces planes cousues
// rayon par rayon (même angle sur les deux contours), chants droits arrondis
// par leurs normales.
export function slabRing(B, F, outer, inner, t, s, N = 160) {
  use(B, F);
  const at = (poly, a) => { // intersection du rayon d'angle a avec le contour
    const d = [cos(a), sin(a)];
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], e = [q[0] - p[0], q[1] - p[1]];
      const den = d[0] * e[1] - d[1] * e[0]; if (abs(den) < 1e-12) continue;
      const tt = (p[0] * e[1] - p[1] * e[0]) / den, u = (p[0] * d[1] - p[1] * d[0]) / den;
      if (tt > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, tt);
    }
    return [d[0] * best, d[1] * best];
  };
  const O = [], I = [];
  for (let k = 0; k < N; k++) { const a = (2 * PI * k) / N; O.push(at(outer, a)); I.push(at(inner, a)); }
  for (const [z, nz] of [[t / 2, 1], [-t / 2, -1]]) {
    const ro = O.map((p) => B.vert([p[0], p[1], z], [0, 0, nz], s, [1, 0, 0])), ri = I.map((p) => B.vert([p[0], p[1], z], [0, 0, nz], s, [1, 0, 0]));
    B.grid([ro, ri], true);
  }
  // chants (normales sortantes de la matière : vers l'extérieur sur le contour
  // extérieur, vers le centre de l'ouverture sur le contour intérieur)
  for (const [P2, sg] of [[O, 1], [I, -1]]) {
    const Nn = P2.map((p, k) => { const a = P2[(k + N - 1) % N], b = P2[(k + 1) % N]; const tn = norm([b[0] - a[0], b[1] - a[1], 0]); return [tn[1] * sg, -tn[0] * sg, 0]; });
    const rows = [-t / 2, t / 2].map((z) => P2.map((p, k) => B.vert([p[0], p[1], z], Nn[k], s, [0, 0, 1])));
    B.grid(rows, true);
  }
  B.noFrame();
}
