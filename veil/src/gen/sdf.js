// Champs de distance signés (négatifs dans la matière), en JS pur : ils
// servent à la simulation (workers), aux tests et au dessin de l'écran de
// chargement. Aucune dépendance (ni three, ni TSL).
//
// Les primitives renvoient une distance exacte ou une borne (ellipsoïde :
// approximation d'Inigo Quilez, assez bonne près de la surface, là où le
// contact se joue). Les unions douces sont polynomiales (smin quadratique).

const { sqrt, abs, max, min, hypot } = Math;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export function sdSphere(x, y, z, cx, cy, cz, r) {
  return hypot(x - cx, y - cy, z - cz) - r;
}

// ellipsoïde (approximation de la distance, IQ) ; rayons rx, ry, rz
export function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = x - cx, py = y - cy, pz = z - cz;
  const k0 = hypot(px / rx, py / ry, pz / rz);
  const k1 = hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  if (k1 < 1e-12) return -min(rx, ry, rz);
  return (k0 * (k0 - 1)) / k1;
}

// capsule de a à b, rayon r (ou cône arrondi de ra à rb)
export function sdCapsule(x, y, z, ax, ay, az, bx, by, bz, ra, rb = ra) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const L2 = bax * bax + bay * bay + baz * baz;
  const h = clamp((pax * bax + pay * bay + paz * baz) / L2, 0, 1);
  return hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}

// boîte arrondie centrée en (cx, cy, cz), demi-côtés (hx, hy, hz), rayon r
export function sdRoundBox(x, y, z, cx, cy, cz, hx, hy, hz, r) {
  const qx = abs(x - cx) - hx + r, qy = abs(y - cy) - hy + r, qz = abs(z - cz) - hz + r;
  return hypot(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, max(qy, qz)), 0) - r;
}

// cylindre vertical arrondi (axe y), de y0 à y1, rayon R, congé r
export function sdRoundCyl(x, y, z, cx, cz, y0, y1, R, r) {
  const dx = hypot(x - cx, z - cz) - R + r;
  const hy = (y1 - y0) / 2, dy = abs(y - (y0 + y1) / 2) - hy + r;
  return min(max(dx, dy), 0) + hypot(max(dx, 0), max(dy, 0)) - r;
}

// solide de révolution d'axe y : profil rayon(y) donné par des points
// [[y, r], …] croissants en y (interpolation de Catmull-Rom), fond et col
// fermés. Distance approchée (2D vers la polyligne du profil échantillonné).
export function makeLathe(cx, cz, prof, samples = 48) {
  const P = [];
  const n = prof.length;
  const at = (i) => prof[Math.max(0, Math.min(n - 1, i))];
  P.push([0, prof[0][0]]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const m = Math.ceil(samples / (n - 1));
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      P.push([max(0, cr(p0[1], p1[1], p2[1], p3[1])), cr(p0[0], p1[0], p2[0], p3[0])]);
    }
  }
  P.push([prof[n - 1][1], prof[n - 1][0]]);
  P.push([0, prof[n - 1][0]]);
  const y0 = prof[0][0], y1 = prof[n - 1][0];
  let rmax = 0;
  for (const p of P) rmax = max(rmax, p[0]);
  const f = (x, y, z) => {
    const rr = hypot(x - cx, z - cz);
    // borne rapide
    const bx = rr - rmax, by = max(y0 - y, y - y1);
    if (bx > 0.03 || by > 0.03) return hypot(max(bx, 0), max(by, 0));
    let d2 = Infinity, inside = false;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay] = P[i], [qx, qy] = P[i + 1];
      const ex = qx - ax, ey = qy - ay;
      const h = clamp(((rr - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
      const dx = rr - ax - ex * h, dy = y - ay - ey * h;
      d2 = min(d2, dx * dx + dy * dy);
      // parité (rayon horizontal vers +r)
      if ((ay > y) !== (qy > y) && rr < ax + ((y - ay) / (qy - ay)) * (qx - ax)) inside = !inside;
    }
    return inside ? -sqrt(d2) : sqrt(d2);
  };
  f.bounds = { y0, y1, rmax };
  return f;
}

// union douce (k : rayon du raccord)
export function smin(a, b, k) {
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}
// soustraction douce de b à a
export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// repère : rotation d'Euler (ordre Y puis X puis Z) autour d'un pivot. Renvoie
// une fonction qui ramène un point du monde dans le repère local.
export function makeFrame({ pivot = [0, 0, 0], rx = 0, ry = 0, rz = 0 } = {}) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // M = Ry · Rx · Rz (local → monde) ; on applique l'inverse (transposée)
  const M = [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
  const [px, py, pz] = pivot;
  const out = [0, 0, 0];
  return (x, y, z) => {
    const dx = x - px, dy = y - py, dz = z - pz;
    out[0] = M[0] * dx + M[3] * dy + M[6] * dz + px;
    out[1] = M[1] * dx + M[4] * dy + M[7] * dz + py;
    out[2] = M[2] * dx + M[5] * dy + M[8] * dz + pz;
    return out;
  };
}

// gradient par différences centrées (normale de contact)
export function gradient(f, x, y, z, e = 1e-4, out = [0, 0, 0]) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  const l = hypot(gx, gy, gz) || 1;
  out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  return out;
}
