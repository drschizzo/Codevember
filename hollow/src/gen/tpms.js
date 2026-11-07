// Surfaces minimales triplement périodiques (gyroïde, Schwarz P, diamant,
// Neovius, I-WP de Schoen, Fischer–Koch S)
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

// résolution de grille par niveau de détail (héros, moyen, lointain). Les ombres
// utilisent le niveau moyen (voir nest.js) : plus grossier, le maillage d'ombre
// se replie aux congés et laisse fuir la lumière en éclats triangulaires.
export const TPMS_RES = [224, 132, 76, 132];

// maximum lisse polynomial (k = largeur du congé)
const smax = (a, b, k) => {
  if (k <= 0) return max(a, b);
  const h = max(k - abs(a - b), 0) / k;
  return max(a, b) + h * h * k * 0.25;
};

// Paramètres effectifs du champ (partagés avec le shader, qui recalcule la normale) :
//  · fréquence (Fischer–Koch et I-WP contiennent des termes en 2X) ;
//  · paroi : une feuille d'au moins ≈ 0,065 d'épaisseur (≈ 4 mailles au niveau
//    moyen) — plus mince, elle se maille en dents de scie ;
//  · congé : le maximum lisse polynomial n'arrondit que sur ≈ k/4 ; k ≈ 0,09,
//    mais jamais plus large que la feuille.
export function tpmsParams(spec) {
  const f = (spec.freq * TAU / 2) * ({ fischer: 0.55, iwp: 0.75 }[spec.surface] ?? 1);
  const wall = spec.sheet ? Math.min(0.62, Math.max(spec.wall, 0.0325 * f)) : spec.wall;
  const sheetT = spec.sheet ? (2 * wall) / f : Infinity;
  const k = Math.min(Math.max(spec.bevel * 6, 0.09), sheetT * 1.6);
  return { f, wall, k };
}

export function tpmsField(spec) {
  const R = 1, Ri = 1 - spec.thickness, Rm = (R + Ri) / 2, half = spec.thickness / 2;
  const { f, wall, k } = tpmsParams(spec);
  const portalR = Math.tan(spec.portal) * R; // alésage vu depuis le centre
  const portalCos = Math.cos(spec.portal);
  const kind = spec.surface;
  // valeur implicite normalisée (≈ distance) de la surface minimale
  const T = (x, y, z) => {
    const X = x * f, Y = y * f, Z = z * f;
    let g;
    if (kind === 'schwarz') g = (cos(X) + cos(Y) + cos(Z)) / 1.9;
    else if (kind === 'diamond') g = (sin(X) * sin(Y) * sin(Z) + sin(X) * cos(Y) * cos(Z) + cos(X) * sin(Y) * cos(Z) + cos(X) * cos(Y) * sin(Z)) / 1.25;
    else if (kind === 'neovius') g = (3 * (cos(X) + cos(Y) + cos(Z)) + 4 * cos(X) * cos(Y) * cos(Z)) / 6;
    else if (kind === 'iwp') g = (2 * (cos(X) * cos(Y) + cos(Y) * cos(Z) + cos(Z) * cos(X)) - (cos(2 * X) + cos(2 * Y) + cos(2 * Z))) / 3;
    else if (kind === 'fischer') g = (cos(2 * X) * sin(Y) * cos(Z) + cos(X) * cos(2 * Y) * sin(Z) + sin(X) * cos(Y) * cos(2 * Z)) / 1.4;
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
    const cyl = max((sqrt(x * x + y * y) - portalR * (z / R)) * portalCos, -z); // (vraie distance au cône)
    const cut = -cyl;
    if (cut > d - k) { d = smax(d, cut, k); if (cut > s && cut > t) w = 1; }
    if (out) { out[0] = d; out[1] = w; out[2] = r; out[3] = s; out[4] = t; }
    return d;
  };
  // Valeur et gradient analytique (dérivées exactes de la surface, du maximum
  // lisse et de l'alésage) : une évaluation au lieu de six pour une normale.
  const g3 = new Float64Array(3);
  const Tg = (x, y, z, G) => {
    const X = x * f, Y = y * f, Z = z * f;
    const cX = cos(X), cY = cos(Y), cZ = cos(Z), sX = sin(X), sY = sin(Y), sZ = sin(Z);
    let g, gx, gy, gz;
    if (kind === 'schwarz') { g = (cX + cY + cZ) / 1.9; gx = -sX / 1.9; gy = -sY / 1.9; gz = -sZ / 1.9; }
    else if (kind === 'diamond') {
      g = (sX * sY * sZ + sX * cY * cZ + cX * sY * cZ + cX * cY * sZ) / 1.25;
      gx = (cX * sY * sZ + cX * cY * cZ - sX * sY * cZ - sX * cY * sZ) / 1.25;
      gy = (sX * cY * sZ - sX * sY * cZ + cX * cY * cZ - cX * sY * sZ) / 1.25;
      gz = (sX * sY * cZ - sX * cY * sZ - cX * sY * sZ + cX * cY * cZ) / 1.25;
    } else if (kind === 'neovius') {
      g = (3 * (cX + cY + cZ) + 4 * cX * cY * cZ) / 6;
      gx = (-3 * sX - 4 * sX * cY * cZ) / 6; gy = (-3 * sY - 4 * cX * sY * cZ) / 6; gz = (-3 * sZ - 4 * cX * cY * sZ) / 6;
    } else if (kind === 'iwp') {
      const c2X = cos(2 * X), c2Y = cos(2 * Y), c2Z = cos(2 * Z);
      g = (2 * (cX * cY + cY * cZ + cZ * cX) - (c2X + c2Y + c2Z)) / 3;
      gx = (-2 * sX * (cY + cZ) + 2 * sin(2 * X)) / 3; gy = (-2 * sY * (cX + cZ) + 2 * sin(2 * Y)) / 3; gz = (-2 * sZ * (cX + cY) + 2 * sin(2 * Z)) / 3;
    } else if (kind === 'fischer') {
      const c2X = cos(2 * X), c2Y = cos(2 * Y), c2Z = cos(2 * Z), s2X = sin(2 * X), s2Y = sin(2 * Y), s2Z = sin(2 * Z);
      g = (c2X * sY * cZ + cX * c2Y * sZ + sX * cY * c2Z) / 1.4;
      gx = (-2 * s2X * sY * cZ - sX * c2Y * sZ + cX * cY * c2Z) / 1.4;
      gy = (c2X * cY * cZ - 2 * cX * s2Y * sZ - sX * sY * c2Z) / 1.4;
      gz = (-c2X * sY * sZ + cX * c2Y * cZ - 2 * sX * cY * s2Z) / 1.4;
    } else {
      g = (sX * cY + sY * cZ + sZ * cX) / 1.5;
      gx = (cX * cY - sZ * sX) / 1.5; gy = (cY * cZ - sX * sY) / 1.5; gz = (cZ * cX - sY * sZ) / 1.5;
    }
    // (d/dx = f·d/dX, puis division par f : le facteur s'annule)
    const sg = spec.sheet ? (g < 0 ? -1 : 1) : 1;
    G[0] = gx * sg; G[1] = gy * sg; G[2] = gz * sg;
    return (spec.sheet ? abs(g) - wall : g - wall) / f;
  };
  // maximum lisse : valeur, et poids des deux gradients
  const smaxW = (a, b) => {
    const h = max(k - abs(a - b), 0) / k;
    return [max(a, b) + h * h * k * 0.25, a > b ? 1 - h / 2 : h / 2];
  };
  const tg = new Float64Array(3);
  const fieldGrad = (x, y, z, G) => {
    const r = sqrt(x * x + y * y + z * z) || 1e-9;
    const s = abs(r - Rm) - half, ss = r > Rm ? 1 / r : -1 / r;
    const t = Tg(x, y, z, tg);
    let [d, wa] = smaxW(s, t);
    G[0] = wa * x * ss + (1 - wa) * tg[0]; G[1] = wa * y * ss + (1 - wa) * tg[1]; G[2] = wa * z * ss + (1 - wa) * tg[2];
    const rho = sqrt(x * x + y * y) || 1e-9;
    const c1 = (rho - portalR * (z / R)) * portalCos;
    const cut = -max(c1, -z);
    if (cut > d - k) {
      // gradient de -cyl
      let cx, cy, cz;
      if (c1 > -z) { cx = -(x / rho) * portalCos; cy = -(y / rho) * portalCos; cz = (portalR / R) * portalCos; } else { cx = 0; cy = 0; cz = 1; }
      const [d2, wd] = smaxW(d, cut);
      G[0] = wd * G[0] + (1 - wd) * cx; G[1] = wd * G[1] + (1 - wd) * cy; G[2] = wd * G[2] + (1 - wd) * cz;
      d = d2;
    }
    return d;
  };
  return { field, fieldGrad, g3, R, Ri, Rm, half, k };
}

export const buildTPMS = (spec, lod) => buildImplicit(tpmsField(spec), lod);

// Maillage d'un champ implicite taillé dans la coquille (surfaces minimales,
// corail…) : F = { field(x, y, z, out), fieldGrad(x, y, z, G), Rm, half, k }.
// field remplit out = [distance, part, rayon, distance à la coquille, distance au motif].
export function buildImplicit(F, lod) {
  const res = TPMS_RES[lod];
  const { field, fieldGrad, Rm, half, k: fillet } = F;
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
  // normale : gradient analytique (une évaluation)
  const G = new Float64Array(3);
  const grad = (x, y, z) => {
    fieldGrad(x, y, z, G);
    const l = sqrt(G[0] * G[0] + G[1] * G[1] + G[2] * G[2]) || 1;
    return [G[0] / l, G[1] / l, G[2] / l];
  };
  // Projection sur la surface le long de la normale locale, dans ±r : racine
  // encadrée (robuste aux feuilles minces, où Newton sauterait de l'autre côté),
  // trouvée par fausse position (Illinois) — quelques évaluations au lieu de
  // dix-huit dichotomies. Renvoie null s'il n'y a pas de surface à portée.
  // (smooth : direction par différences centrées — lissée sur ≈ h/5 —, pour la
  // première projection, partie d'un point encore loin de la surface, près des
  // plis du champ ; ensuite le gradient exact suffit)
  const project = (x, y, z, r, smooth = false) => {
    let f0 = fieldGrad(x, y, z, G);
    if (smooth) {
      const e = h * 0.2;
      G[0] = field(x + e, y, z) - field(x - e, y, z); G[1] = field(x, y + e, z) - field(x, y - e, z); G[2] = field(x, y, z + e) - field(x, y, z - e);
    }
    const l = sqrt(G[0] * G[0] + G[1] * G[1] + G[2] * G[2]) || 1;
    const gx = G[0] / l, gy = G[1] / l, gz = G[2] / l;
    const at = (t) => field(x + gx * t, y + gy * t, z + gz * t);
    let a, b, fa, fb;
    // racine la plus proche : d'abord du côté où le champ change de signe
    const fhi = at(r);
    if ((f0 < 0) !== (fhi < 0)) { a = 0; fa = f0; b = r; fb = fhi; } else {
      const flo = at(-r);
      if ((f0 < 0) !== (flo < 0)) { a = -r; fa = flo; b = 0; fb = f0; } else return null;
    }
    let t = 0, side = 0;
    for (let it = 0; it < 12; it++) {
      t = (a * fb - b * fa) / (fb - fa);
      const ft = at(t);
      if (ft === 0 || b - a < r * 2e-5) break;
      if ((ft < 0) === (fb < 0)) { b = t; fb = ft; if (side === -1) fa /= 2; side = -1; } else { a = t; fa = ft; if (side === 1) fb /= 2; side = 1; }
    }
    return [x + gx * t, y + gy * t, z + gz * t];
  };
  // cellules de la grille qui peuvent couper la coquille : pour chaque rangée
  // (j, k), les intervalles de i dans la bande (ailleurs, rien ne change de signe)
  const bandLo = bandIn - h * 2, bandHi = bandOut + h * 2;
  const rows = (j, k, fn) => {
    const y0 = -ext + j * h, z0 = -ext + k * h;
    const span2 = (a) => [a <= 0 && a + h >= 0 ? 0 : min(a * a, (a + h) * (a + h)), max(a * a, (a + h) * (a + h))];
    const [ya, yb] = span2(y0), [za, zb] = span2(z0);
    const out2 = bandHi * bandHi - (ya + za);
    if (out2 <= 0) return;
    const xo = sqrt(out2), xi = sqrt(max(0, bandLo * bandLo - (yb + zb)));
    const ix = (x) => Math.floor((x + ext) / h);
    const a0 = max(0, ix(-xo) - 1), b1 = min(res - 1, ix(xo) + 1);
    const a1 = ix(-xi) + 1, b0 = ix(xi) - 1;
    if (xi <= h || a1 >= b0) { for (let i = a0; i <= b1; i++) fn(i); return; }
    for (let i = a0; i <= min(a1, b1); i++) fn(i);
    for (let i = max(b0, a0); i <= b1; i++) fn(i);
  };
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float32Array(8);
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) rows(j, k, (i) => {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) return;
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
    // reprojection sur la surface (Newton) : les sommets se posent vraiment
    // sur la surface, sinon les arêtes vives sortent en escalier
    {
      const q = project(x, y, z, h, true);
      if (q) { x = q[0]; y = q[1]; z = q[2]; }
    }
    field(x, y, z, tmp);
    const g = grad(x, y, z);
    cellVert[(k * res + j) * res + i] = pos.length / 3;
    pos.push(x, y, z); nor.push(g[0], g[1], g[2]);
    let tx = -g[1], ty = g[0];
    const l = sqrt(tx * tx + ty * ty);
    if (l < 1e-5) { tx = 1; ty = 0; } else { tx /= l; ty /= l; }
    tan.push(tx, ty, 0, 1);
    // finitions : faces de la coquille (externe / interne) ou paroi de la surface
    // minimale. Poids continu à travers le congé : la frontière entre les deux
    // finitions est une courbe lisse, pas un escalier qui suit la grille.
    const e = min(1, max(0, 0.5 + (tmp[4] - tmp[3]) / (fillet * 0.4 + 1e-6)));
    const outer = tmp[2] > Rm;
    const prox = 1 - abs(e - 0.5) * 2; // (proximité de l'arête : au milieu du congé)
    surf.push(Math.round((outer ? 1 - e : 0) * 255), Math.round((outer ? 0 : 1 - e) * 255), Math.round(e * 255), Math.round(max(prox, e) * 255));
  });

  // un quadrilatère par arête de grille qui traverse la surface
  const idx = [];
  const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= res || j >= res || k >= res ? -1 : cellVert[(k * res + j) * res + i]);
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < res; k++) for (let j = 1; j < res; j++) rows(j, k, (i) => {
    if (i < 1) return;
    const v0 = at(i, j, k) < 0;
    if (v0 !== (at(i + 1, j, k) < 0)) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), v0);
    if (v0 !== (at(i, j + 1, k) < 0)) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), v0);
    if (v0 !== (at(i, j, k + 1) < 0)) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), v0);
  });
  const P = new Float32Array(pos), Nn = new Float32Array(nor), I = new Uint32Array(idx);
  const nv = P.length / 3;
  // Relaxation : chaque sommet glisse vers la moyenne de ses voisins, puis est
  // reprojeté sur la surface. Les sommets se répartissent régulièrement le
  // long des arêtes au lieu de suivre la grille (plus de dents de scie).
  {
    const deg = new Uint32Array(nv + 1);
    for (let t = 0; t < I.length; t++) deg[I[t] + 1] += 2;
    for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
    const adj = new Uint32Array(deg[nv]), fill = deg.slice(0, nv);
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      adj[fill[a]++] = b; adj[fill[b]++] = a;
    }
    const Q = new Float32Array(P.length);
    for (let pass = 0; pass < [3, 2, 1, 0][lod]; pass++) { // (grilles grossières : moins de passes, sinon des triangles se retournent)
      for (let i = 0; i < nv; i++) {
        let sx = 0, sy = 0, sz = 0;
        const n0 = deg[i], n1 = deg[i + 1], n = n1 - n0;
        if (!n) { Q[i * 3] = P[i * 3]; Q[i * 3 + 1] = P[i * 3 + 1]; Q[i * 3 + 2] = P[i * 3 + 2]; continue; }
        for (let j = n0; j < n1; j++) { const o = adj[j] * 3; sx += P[o]; sy += P[o + 1]; sz += P[o + 2]; }
        // moitié du chemin vers la moyenne (pas de rétrécissement : on reprojette)
        Q[i * 3] = (P[i * 3] + sx / n) / 2; Q[i * 3 + 1] = (P[i * 3 + 1] + sy / n) / 2; Q[i * 3 + 2] = (P[i * 3 + 2] + sz / n) / 2;
      }
      for (let i = 0; i < nv; i++) {
        // le sommet lissé est reposé sur la surface ; s'il n'y en a pas à moins
        // d'une demi-maille (arête fine), il garde sa place
        const q = project(Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2], h * 0.5);
        if (q) { P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
      }
    }
    for (let i = 0; i < nv; i++) {
      const g = grad(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      Nn[i * 3] = g[0]; Nn[i * 3 + 1] = g[1]; Nn[i * 3 + 2] = g[2];
    }
  }
  // orientation : chaque triangle doit regarder du côté des normales du champ
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const s = cx * (Nn[a] + Nn[b] + Nn[c]) + cy * (Nn[a + 1] + Nn[b + 1] + Nn[c + 1]) + cz * (Nn[a + 2] + Nn[b + 2] + Nn[c + 2]);
    if (s < 0) { const tmpI = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmpI; }
  }
  // Normales : celles du champ (lisses), sauf là où le gradient est instable
  // (feuilles minces, raccords des congés) — on prend alors la normale du
  // maillage (moyenne des faces pondérée par l'aire).
  const M = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { M[o] += cx; M[o + 1] += cy; M[o + 2] += cz; }
  }
  for (let o = 0; o < P.length; o += 3) {
    const l = Math.hypot(M[o], M[o + 1], M[o + 2]);
    if (l < 1e-20) continue;
    const mx = M[o] / l, my = M[o + 1] / l, mz = M[o + 2] / l;
    const d = mx * Nn[o] + my * Nn[o + 1] + mz * Nn[o + 2];
    const w = d > 0.9 ? 0 : d < 0.6 ? 1 : (0.9 - d) / 0.3; // fondu entre les deux
    let nx = Nn[o] * (1 - w) + mx * w, ny = Nn[o + 1] * (1 - w) + my * w, nz = Nn[o + 2] * (1 - w) + mz * w;
    const nl = Math.hypot(nx, ny, nz) || 1;
    Nn[o] = nx / nl; Nn[o + 1] = ny / nl; Nn[o + 2] = nz / nl;
  }
  return { position: P, normal: Nn, tangent: new Float32Array(tan), surf: new Uint8Array(surf), index: I };
}
