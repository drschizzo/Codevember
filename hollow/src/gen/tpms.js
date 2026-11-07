// Surfaces minimales triplement périodiques (gyroïde, Schwarz P, diamant)
// taillées dans une coquille sphérique : une matière poreuse, creuse par
// essence. Maillage par « surface nets » sur une grille restreinte à la bande
// de la coquille, sommets reprojetés sur la surface (Newton), normales issues
// du gradient du champ de distance.
//
// Les arêtes vives entre la coquille et la surface minimale sont adoucies par
// un maximum lisse (rayon `bevel`) : un congé, comme sur une pièce usinée.
// Un alésage cylindrique ouvre l'oculus sur +z.

const { sin, cos, sqrt, abs, max, min, floor, ceil, PI, exp, log } = Math;
const TAU = PI * 2;

export const TPMS_RES = [176, 104, 60]; // résolution de grille par niveau de détail

// maximum lisse polynomial (k = largeur du congé)
const smax = (a, b, k) => {
  if (k <= 0) return max(a, b);
  const h = max(k - abs(a - b), 0) / k;
  return max(a, b) + h * h * k * 0.25;
};

export function tpmsField(spec) {
  const R = 1, Ri = 1 - spec.thickness, Rm = (R + Ri) / 2, half = spec.thickness / 2;
  const f = spec.freq * TAU / 2; // périodes sur le rayon
  const k = Math.max(spec.bevel * 2, 0.03); // congé d'au moins quelques mailles : pas d'arête en escalier
  const wall = spec.wall;
  const portalR = Math.tan(spec.portal) * R; // alésage vu depuis le centre
  const kind = spec.surface;
  // valeur implicite normalisée (≈ distance) de la surface minimale
  const T = (x, y, z) => {
    const X = x * f, Y = y * f, Z = z * f;
    let g;
    if (kind === 'schwarz') g = (cos(X) + cos(Y) + cos(Z)) / 1.9;
    else if (kind === 'diamond') g = (sin(X) * sin(Y) * sin(Z) + sin(X) * cos(Y) * cos(Z) + cos(X) * sin(Y) * cos(Z) + cos(X) * cos(Y) * sin(Z)) / 1.25;
    else g = (sin(X) * cos(Y) + sin(Y) * cos(Z) + sin(Z) * cos(X)) / 1.5;
    // feuille épaisse (sheet) ou réseau plein (network)
    return (spec.sheet ? abs(g) - wall : g - wall) / f;
  };
  // renvoie [distance, part de la coquille (0) ou de la surface minimale (1)]
  const field = (x, y, z, out) => {
    const r = sqrt(x * x + y * y + z * z);
    const s = abs(r - Rm) - half;
    const t = T(x, y, z);
    let d = smax(s, t, k);
    let w = s > t ? 0 : 1;
    // alésage de l'oculus : on retire le cylindre (demi-espace z > 0)
    const cyl = max(sqrt(x * x + y * y) - portalR * (z / R), -z);
    const cut = -cyl;
    if (cut > d - k) { d = smax(d, cut, k); if (cut > s && cut > t) w = 1; }
    if (out) { out[0] = d; out[1] = w; out[2] = r; out[3] = s; out[4] = t; }
    return d;
  };
  return { field, R, Ri, Rm, half };
}

export function buildTPMS(spec, lod) {
  const res = TPMS_RES[lod];
  const { field, Rm, half } = tpmsField(spec);
  const ext = 1.02, h = (2 * ext) / res, N = res + 1;
  const bandIn = Rm - half - 3 * h, bandOut = Rm + half + 3 * h;
  // grille de valeurs (seulement dans la bande, ailleurs : distance à la coquille)
  const V = new Float32Array(N * N * N);
  for (let k = 0; k < N; k++) {
    const z = -ext + k * h;
    for (let j = 0; j < N; j++) {
      const y = -ext + j * h, o = (k * N + j) * N;
      for (let i = 0; i < N; i++) {
        const x = -ext + i * h, r = sqrt(x * x + y * y + z * z);
        V[o + i] = r < bandIn || r > bandOut ? abs(r - Rm) - half : field(x, y, z);
      }
    }
  }
  const at = (i, j, k) => V[(k * N + j) * N + i];

  // un sommet par cellule traversée : moyenne des croisements d'arêtes
  const cellVert = new Int32Array(res * res * res).fill(-1);
  const pos = [], nor = [], tan = [], surf = [];
  const tmp = [0, 0, 0, 0, 0];
  const grad = (x, y, z) => {
    const e = h * 0.25;
    const gx = field(x + e, y, z) - field(x - e, y, z), gy = field(x, y + e, z) - field(x, y - e, z), gz = field(x, y, z + e) - field(x, y, z - e);
    const l = sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + (((b & 1) - (a & 1)) * t);
      sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
      n++;
    }
    let x = -ext + (i + sx / n) * h, y = -ext + (j + sy / n) * h, z = -ext + (k + sz / n) * h;
    // reprojection sur la surface (un pas de Newton, borné à la cellule)
    for (let it = 0; it < 1; it++) {
      const d = field(x, y, z), g = grad(x, y, z), s = max(-h * 0.5, min(h * 0.5, d));
      x -= g[0] * s; y -= g[1] * s; z -= g[2] * s;
    }
    field(x, y, z, tmp);
    const g = grad(x, y, z);
    cellVert[(k * res + j) * res + i] = pos.length / 3;
    pos.push(x, y, z); nor.push(g[0], g[1], g[2]);
    let tx = -g[1], ty = g[0];
    const l = sqrt(tx * tx + ty * ty);
    if (l < 1e-5) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
    tan.push(tx, ty, 0, 1);
    // finitions : faces de la coquille (externe / interne) ou paroi de la surface minimale
    const onShell = tmp[1] === 0, outer = tmp[2] > Rm;
    const edge = onShell ? 0 : 1;
    // proximité du bord : dans la zone du congé
    const prox = onShell ? max(0, 1 - (tmp[3] - tmp[4]) / (spec.bevel * 4 + 1e-6)) : 1;
    surf.push(onShell && outer ? 255 : 0, onShell && !outer ? 255 : 0, edge * 255, Math.round(min(1, prox) * 255));
  }

  // un quadrilatère par arête de grille qui traverse la surface
  const idx = [];
  const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= res || j >= res || k >= res ? -1 : cellVert[(k * res + j) * res + i]);
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < res; k++) for (let j = 1; j < res; j++) for (let i = 1; i < res; i++) {
    const v0 = at(i, j, k) < 0;
    if (v0 !== (at(i + 1, j, k) < 0)) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), v0);
    if (v0 !== (at(i, j + 1, k) < 0)) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), v0);
    if (v0 !== (at(i, j, k + 1) < 0)) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), v0);
  }
  // orientation : chaque triangle doit regarder du côté des normales du champ
  const P = new Float32Array(pos), Nn = new Float32Array(nor), I = new Uint32Array(idx);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const s = cx * (Nn[a] + Nn[b] + Nn[c]) + cy * (Nn[a + 1] + Nn[b + 1] + Nn[c + 1]) + cz * (Nn[a + 2] + Nn[b + 2] + Nn[c + 2]);
    if (s < 0) { const tmpI = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmpI; }
  }
  return { position: P, normal: Nn, tangent: new Float32Array(tan), surf: new Uint8Array(surf), index: I };
}
