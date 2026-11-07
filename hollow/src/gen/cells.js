// Pavages de la sphère unité en cellules convexes (ou étoilées), percées
// ensuite par shell.js. Chaque cellule : centre `c`, contour `pts` (sens
// trigonométrique vu de l'extérieur), et par arête un facteur de largeur de
// barreau `ins` (1 = barreau nominal). La cellule « oculus » (portal) est
// toujours centrée sur +z : c'est par elle que la caméra traverse la coquille.

const { sqrt, acos, atan2, cos, sin, PI, ceil, max, min, abs } = Math;

export const norm = (v) => { const l = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const angle = (a, b) => acos(max(-1, min(1, dot(a, b))));

// rotation de Rodrigues (axe unitaire)
function rotate(v, axis, ang) {
  const c = cos(ang), s = sin(ang), d = dot(axis, v), x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * d * (1 - c), v[1] * c + x[1] * s + axis[1] * d * (1 - c), v[2] * c + x[2] * s + axis[2] * d * (1 - c)];
}

// repère tangent orthonormé en un point de la sphère
export function tangentFrame(c) {
  const ref = abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(ref, c));
  return [e1, cross(c, e1)];
}

// ── Goldberg : dual d'une icosphère géodésique ───────────────────────────────
// freq : subdivisions par arête de l'icosaèdre (≈ 10 f² + 2 cellules)
// jitter : désordre des centres (0 = cristallin, 0,4 = presque Voronoï)
// portal : rayon angulaire visé pour l'oculus (rad)
export function goldbergCells({ freq = 6, jitter = 0, portal = 0.3 }, rng) {
  const t = (1 + sqrt(5)) / 2;
  const ico = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

  // subdivision avec fusion des sommets partagés (clé quantifiée)
  const verts = [], keyOf = new Map(), tris = [];
  const vid = (p) => {
    const q = norm(p), k = `${Math.round(q[0] * 1e5)},${Math.round(q[1] * 1e5)},${Math.round(q[2] * 1e5)}`;
    let i = keyOf.get(k);
    if (i === undefined) { i = verts.length; verts.push(q); keyOf.set(k, i); }
    return i;
  };
  for (const [ia, ib, ic] of faces) {
    const A = ico[ia], B = ico[ib], C = ico[ic], f = freq;
    const P = (i, j) => vid(add(A, add(scale(sub(B, A), i / f), scale(sub(C, A), j / f))));
    const row = [];
    for (let i = 0; i <= f; i++) { row[i] = []; for (let j = 0; j <= f - i; j++) row[i][j] = P(i, j); }
    for (let i = 0; i < f; i++) for (let j = 0; j < f - i; j++) {
      tris.push([row[i][j], row[i + 1][j], row[i][j + 1]]);
      if (j < f - i - 1) tris.push([row[i + 1][j], row[i + 1][j + 1], row[i][j + 1]]);
    }
  }

  // le sommet 0 de l'icosaèdre (centre d'un pentagone) devient le pôle +z, puis rotation libre autour de z
  const v0 = verts[0], ax = cross(v0, [0, 0, 1]), axL = sqrt(dot(ax, ax));
  const a0 = angle(v0, [0, 0, 1]), spin = rng.next() * PI * 2;
  for (let i = 0; i < verts.length; i++) {
    let v = axL > 1e-9 ? rotate(verts[i], scale(ax, 1 / axL), a0) : verts[i];
    verts[i] = rotate(v, [0, 0, 1], spin);
  }
  verts[0] = [0, 0, 1];

  // désordre : déplacement tangent gaussien (le pôle reste fixe)
  const spacing = 1.1 / freq;
  if (jitter > 0) for (let i = 1; i < verts.length; i++) {
    const [e1, e2] = tangentFrame(verts[i]);
    const g1 = rng.gauss() * jitter * spacing * 0.5, g2 = rng.gauss() * jitter * spacing * 0.5;
    verts[i] = norm(add(verts[i], add(scale(e1, g1), scale(e2, g2))));
  }

  // oculus : on écarte les centres du pôle (déformation radiale monotone,
  // sans repli) pour que la cellule polaire atteigne le rayon visé
  const theta1 = spacing;
  const thetaP = max(0, 1.5 * portal - theta1);
  if (thetaP > 0) for (let i = 1; i < verts.length; i++) {
    const v = verts[i], th = acos(max(-1, min(1, v[2]))), ph = atan2(v[1], v[0]);
    const th2 = min(PI, th + thetaP * (1 - th / PI) ** 3);
    verts[i] = [sin(th2) * cos(ph), sin(th2) * sin(ph), cos(th2)];
  }

  // triangles incidents à chaque sommet → contour de la cellule duale
  const inc = verts.map(() => []);
  const cent = tris.map(([a, b, c]) => norm(add(verts[a], add(verts[b], verts[c]))));
  tris.forEach(([a, b, c], ti) => { inc[a].push(ti); inc[b].push(ti); inc[c].push(ti); });
  const cells = [];
  for (let i = 0; i < verts.length; i++) {
    const c = verts[i], [e1, e2] = tangentFrame(c);
    const ring = inc[i].map((ti) => ({ p: cent[ti], a: atan2(dot(cent[ti], e2), dot(cent[ti], e1)) })).sort((x, y) => x.a - y.a);
    const pts = ring.map((r) => r.p);
    cells.push({ c, pts, ins: pts.map(() => 1), portal: i === 0 });
  }
  return cells;
}

// ── Fentes : grille latitude × longitude, éventuellement en spirale ──────────
// rows, cols : bandes et secteurs ; twist : décalage d'un rang au suivant
// (fraction de secteur) ; barLat / barLon : facteurs de largeur des barreaux
// horizontaux et verticaux ; portal : rayon de la calotte polaire +z ;
// bottom : rayon de la calotte -z.
export function slotCells({ rows = 6, cols = 12, twist = 0, portal = 0.3, bottom = 0.25, barLat = 1, barLon = 1 }) {
  const th0 = portal, th1 = PI - bottom;
  const thetas = Array.from({ length: rows + 1 }, (_, i) => th0 + (th1 - th0) * i / rows);
  const D = (PI * 2) / cols;
  const off = (r) => twist * r * D;
  const P = (th, ph) => [sin(th) * cos(ph), sin(th) * sin(ph), cos(th)];
  // longitudes présentes sur chaque cercle : celles du rang au-dessus et du rang en dessous
  const lons = thetas.map((_, i) => {
    const s = [];
    if (i > 0) for (let j = 0; j < cols; j++) s.push(off(i - 1) + j * D);
    if (i < rows) for (let j = 0; j < cols; j++) s.push(off(i) + j * D);
    const m = s.map((v) => ((v % (PI * 2)) + PI * 2) % (PI * 2)).sort((a, b) => a - b);
    return m.filter((v, k) => k === 0 || v - m[k - 1] > 1e-7);
  });
  // longitudes du cercle i comprises dans [a, b] (dans l'ordre croissant)
  const span = (i, a, b) => lons[i]
    .map((v) => a + ((((v - a) % (PI * 2)) + PI * 2) % (PI * 2)))
    .map((v) => (v > a + PI * 2 - 1e-7 ? v - PI * 2 : v))
    .filter((v) => v <= b + 1e-7)
    .sort((x, y) => x - y);

  const cells = [];
  // calotte +z (l'oculus) : tout le cercle 0
  {
    const pts = lons[0].map((ph) => P(thetas[0], ph));
    cells.push({ c: [0, 0, 1], pts, ins: pts.map(() => barLat), portal: true });
  }
  for (let r = 0; r < rows; r++) for (let j = 0; j < cols; j++) {
    const a = off(r) + j * D, b = a + D;
    const bot = span(r + 1, a, b), top = span(r, a, b).reverse();
    const pts = [], ins = [];
    // bas (est), montant est, haut (ouest), montant ouest
    bot.forEach((ph, k) => { pts.push(P(thetas[r + 1], ph)); ins.push(k < bot.length - 1 ? barLat : barLon); });
    top.forEach((ph, k) => { pts.push(P(thetas[r], ph)); ins.push(k < top.length - 1 ? barLat : barLon); });
    const thc = (thetas[r] + thetas[r + 1]) / 2;
    cells.push({ c: P(thc, (a + b) / 2), pts, ins, portal: false });
  }
  // calotte -z
  {
    const pts = lons[rows].map((ph) => P(thetas[rows], ph)).reverse();
    cells.push({ c: [0, 0, -1], pts, ins: pts.map(() => barLat), portal: false, cap: true });
  }
  return cells;
}

// longueur d'échantillonnage commune aux deux cellules d'une arête : même
// nombre de points des deux côtés, donc maillage étanche
export const edgeSteps = (a, b, spacing) => max(1, ceil(angle(a, b) / spacing));

// ── Voronoï sphérique ─────────────────────────────────────────────────────────
// Germes : spirale de Fibonacci (phyllotaxie), bruit bleu, ou densité
// graduée. Triangulation de Delaunay = enveloppe convexe des germes
// (incrémentale) ; les sommets de Voronoï sont les normales des faces (centres
// des cercles circonscrits sur la sphère). Les cellules sont convexes.
// La calotte autour de +z reste vide, sauf le germe du pôle : l'oculus.
export function voronoiCells({ count = 200, distribution = 'fibonacci', spiral = 0, portal = 0.3, jitter = 0 }, rng) {
  const cap = Math.cos(2 * portal + 0.04);
  const pts = [[0, 0, 1]];
  const GA = PI * (3 - sqrt(5));
  if (distribution === 'random') {
    // bruit bleu : meilleur de k candidats (le plus éloigné des germes existants)
    const k = 14;
    while (pts.length < count) {
      let best = null, bd = -1;
      for (let i = 0; i < k; i++) {
        const d = rng.dir();
        if (d[2] > cap) continue;
        let m = 9;
        for (const p of pts) { const v = 1 - dot(p, d); if (v < m) m = v; }
        if (m > bd) { bd = m; best = d; }
      }
      if (best) pts.push(best);
    }
  } else {
    const gamma = distribution === 'gradient' ? 1.7 : 1;
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      const z = 1 - 2 * u ** gamma;
      if (z > cap) continue;
      const r = sqrt(max(0, 1 - z * z)), ph = i * GA + spiral * z * PI;
      pts.push([r * cos(ph), r * sin(ph), z]);
    }
  }
  if (jitter > 0) {
    const s = jitter * sqrt(4 * PI / pts.length) * 0.35;
    for (let i = 1; i < pts.length; i++) {
      const [e1, e2] = tangentFrame(pts[i]);
      pts[i] = norm(add(pts[i], add(scale(e1, rng.gauss() * s), scale(e2, rng.gauss() * s))));
      if (pts[i][2] > cap - 0.01) { // rabattu sous la calotte de l'oculus
        const z = cap - 0.01, r = sqrt(1 - z * z), l = Math.hypot(pts[i][0], pts[i][1]) || 1;
        pts[i] = [(pts[i][0] / l) * r, (pts[i][1] / l) * r, z];
      }
    }
  }
  const faces = hull(pts);
  const inc = pts.map(() => []);
  const cent = faces.map((f) => {
    const n = norm(cross(sub(pts[f[1]], pts[f[0]]), sub(pts[f[2]], pts[f[0]])));
    return dot(n, pts[f[0]]) < 0 ? scale(n, -1) : n;
  });
  faces.forEach((f, fi) => f.forEach((v) => inc[v].push(fi)));
  return pts.map((c, i) => {
    const [e1, e2] = tangentFrame(c);
    const ring = inc[i].map((fi) => ({ p: cent[fi], a: atan2(dot(cent[fi], e2), dot(cent[fi], e1)) })).sort((x, y) => x.a - y.a);
    const poly = ring.map((r) => r.p);
    return { c, pts: poly, ins: poly.map(() => 1), portal: i === 0 };
  });
}

// enveloppe convexe incrémentale (points sur la sphère). Les faces sont
// orientées par rapport à un point intérieur fixe : le barycentre du
// tétraèdre initial (l'origine n'est pas toujours dans ce tétraèdre).
function hull(P) {
  const n = P.length;
  const faces = [];      // [a, b, c, normale, vivante]
  const edge = new Map(); // arête orientée a→b → face
  const key = (a, b) => a * n + b;
  let inner = [0, 0, 0];
  const addFace = (a, b, c) => {
    let nn = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    if (dot(nn, sub(P[a], inner)) < 0) { [b, c] = [c, b]; nn = scale(nn, -1); }
    const f = { v: [a, b, c], n: nn, alive: true };
    const id = faces.length;
    faces.push(f);
    edge.set(key(a, b), id); edge.set(key(b, c), id); edge.set(key(c, a), id);
  };
  // tétraèdre initial : le pôle, le plus éloigné, le plus loin de la droite, le plus loin du plan
  const i0 = 0;
  let i1 = 1, i2 = -1, i3 = -1, best = -1;
  for (let i = 1; i < n; i++) { const d = 1 - dot(P[i], P[i0]); if (d > best) { best = d; i1 = i; } }
  best = -1;
  const ax = sub(P[i1], P[i0]);
  for (let i = 1; i < n; i++) { if (i === i1) continue; const c = cross(ax, sub(P[i], P[i0])); const d = dot(c, c); if (d > best) { best = d; i2 = i; } }
  best = -1;
  const pn = cross(sub(P[i1], P[i0]), sub(P[i2], P[i0]));
  for (let i = 1; i < n; i++) { if (i === i1 || i === i2) continue; const d = abs(dot(pn, sub(P[i], P[i0]))); if (d > best) { best = d; i3 = i; } }
  inner = scale(add(add(P[i0], P[i1]), add(P[i2], P[i3])), 0.25);
  addFace(i0, i1, i2); addFace(i0, i1, i3); addFace(i0, i2, i3); addFace(i1, i2, i3);
  for (let p = 0; p < n; p++) {
    if (p === i0 || p === i1 || p === i2 || p === i3) continue;
    const visible = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      if (f.alive && dot(f.n, sub(P[p], P[f.v[0]])) > 1e-12) visible.push(fi);
    }
    if (!visible.length) continue;
    const vis = new Set(visible);
    const horizon = [];
    for (const fi of visible) {
      const [a, b, c] = faces[fi].v;
      for (const [u, w] of [[a, b], [b, c], [c, a]]) if (!vis.has(edge.get(key(w, u)))) horizon.push([u, w]);
    }
    for (const fi of visible) {
      const f = faces[fi]; f.alive = false;
      const [a, b, c] = f.v;
      for (const [u, w] of [[a, b], [b, c], [c, a]]) if (edge.get(key(u, w)) === fi) edge.delete(key(u, w));
    }
    for (const [u, w] of horizon) addFace(u, w, p);
  }
  return faces.filter((f) => f.alive).map((f) => f.v);
}
