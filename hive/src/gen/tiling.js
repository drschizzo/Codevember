// Pavages isoèdres à sommet libre des groupes p3, p4 et p6 (module pur).
//
// Le groupe G (rotations d'un groupe de triangle) est fixe. Ses centres de
// rotation découpent le plan en triangles de deux sortes, F et F* (images
// miroir l'une de l'autre) ; chaque coin porte une classe (0, 1, 2) et un ordre.
//
// La règle : un point libre, de poids barycentriques β dans les faces d'une
// sorte, est relié aux trois coins de sa face. Un coin d'ordre 2 n'est pas un
// sommet du pavage : l'arête le traverse (elle est symétrique autour de lui).
// Les alvéoles sont alors les polygones qui entourent les faces de l'autre
// sorte : types de Heesch C3C3C3C3C3C3 (p3), CC4C4C4C4 (p4), CC3C3C6C6 (p6).
//
// Quand β arrive sur un coin (β = e_a), les jonctions se rassemblent sur les
// centres de classe a : le pavage dégénère (losanges, carrés, triangles,
// cerfs-volants). Ce pavage dégénéré est commun aux deux sortes de faces : le
// point libre peut ressortir dans l'autre sorte. C'est la « porte ».

const SQ3 = Math.sqrt(3);

// Faces de référence, d'aire 1/2 (une alvéole a donc toujours l'aire 1).
function tri(pts, orders) {
  let a = 0;
  for (let i = 0; i < 3; i++) { const p = pts[i], q = pts[(i + 1) % 3]; a += p[0] * q[1] - q[0] * p[1]; }
  const k = Math.sqrt(0.5 / Math.abs(a / 2));
  return { corners: pts.map((p) => [p[0] * k, p[1] * k]), orders };
}

export const GROUPS = {
  // (3,3,3) : triangle équilatéral
  p3: tri([[0, 0], [1, 0], [0.5, SQ3 / 2]], [3, 3, 3]),
  // (2,4,4) : M (ordre 2, angle droit), A, B (ordre 4)
  p4: tri([[0, 0], [1, 0], [0, 1]], [2, 4, 4]),
  // (2,3,6) : M (ordre 2, 90°), B (ordre 3, 60°), A (ordre 6, 30°)
  p6: tri([[0, 0], [0, 1], [SQ3, 0]], [2, 3, 6]),
};
// p6 : sens direct
{
  const g = GROUPS.p6; const c = g.corners;
  const a = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[1][1] - c[0][1]) * (c[2][0] - c[0][0]);
  if (a < 0) { [c[1], c[2]] = [c[2], c[1]]; g.orders = [2, 6, 3]; }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Image miroir de p par rapport à la droite (a, b). */
export function reflect(p, a, b) {
  const d = sub(b, a), v = sub(p, a);
  const t = dot(v, d) / dot(d, d);
  return [2 * (a[0] + t * d[0]) - p[0], 2 * (a[1] + t * d[1]) - p[1]];
}

/** Face voisine à travers le côté opposé au coin de classe k (coins rangés par classe). */
export function flip(face, k) {
  const i = (k + 1) % 3, j = (k + 2) % 3;
  const out = face.slice();
  out[k] = reflect(face[k], face[i], face[j]);
  return out;
}

/** Point de poids β (par classe) dans une face. */
export function pointAt(face, beta) {
  return [
    beta[0] * face[0][0] + beta[1] * face[1][0] + beta[2] * face[2][0],
    beta[0] * face[0][1] + beta[1] * face[1][1] + beta[2] * face[2][1],
  ];
}

/**
 * Profil d'une arête : écart perpendiculaire à la corde (en part de corde), du
 * coin (t = 0) à la jonction (t = 1), nul aux deux bouts. Somme de sinus : a1
 * donne un ventre, a2 un S, a3 une double vague ; « hook » déporte le ventre.
 */
export function profile(pr, t) {
  if (!pr) return 0;
  const tt = pr.hook ? Math.pow(t, Math.exp(pr.hook)) : t;
  return (pr.a1 || 0) * Math.sin(Math.PI * tt) + (pr.a2 || 0) * Math.sin(2 * Math.PI * tt) + (pr.a3 || 0) * Math.sin(3 * Math.PI * tt);
}

/** Point d'un rayon coin → jonction. */
function spoke(c, J, pr, t, amp) {
  const wx = J[0] - c[0], wy = J[1] - c[1];
  const f = profile(pr, t) * amp;
  return [c[0] + t * wx - f * wy, c[1] + t * wy + f * wx];
}

/**
 * Contour d'une alvéole : la face centrale (coins par classe), les poids β des
 * jonctions dans les trois faces voisines. n points par arête, 6 arêtes.
 * Renvoie un Float64Array de 6·n couples (x, y), fermé implicitement.
 */
export function outline(center, beta, profiles, n = 16, amp = 1, out = null) {
  out = out || new Float64Array(12 * n);
  let o = 0;
  // ordre des coins qui fait tourner le contour dans le sens direct
  const a = (center[1][0] - center[0][0]) * (center[2][1] - center[0][1]) - (center[1][1] - center[0][1]) * (center[2][0] - center[0][0]);
  const order = a > 0 ? [0, 1, 2] : [0, 2, 1];
  for (let e = 0; e < 3; e++) {
    const ka = order[e], kb = order[(e + 1) % 3], kc = 3 - ka - kb;
    const J = pointAt(flip(center, kc), beta);
    const ca = center[ka], cb = center[kb];
    for (let i = 0; i < n; i++) { const p = spoke(ca, J, profiles[ka], i / n, amp); out[o++] = p[0]; out[o++] = p[1]; }
    for (let i = 0; i < n; i++) { const p = spoke(cb, J, profiles[kb], 1 - i / n, amp); out[o++] = p[0]; out[o++] = p[1]; }
  }
  return out;
}

export function area(poly) {
  let a = 0; const n = poly.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += poly[2 * i] * poly[2 * j + 1] - poly[2 * j] * poly[2 * i + 1]; }
  return a / 2;
}

// ---------------------------------------------------------------------------
// Le chemin du point libre : une suite d'étapes, chacune d'un coin à un autre
// dans une sorte de face, les sortes alternant. β(s) est une courbe de Bézier
// quadratique en poids barycentriques, de e_a à e_b, par un point de contrôle
// intérieur q. Le temps de chaque étape est adouci : vitesse nulle aux portes.

const ease = (x) => x * x * x * (x * (6 * x - 15) + 10);

/**
 * path = { legs: [{ a, b, q:[q0,q1,q2] }], shift } ; les étapes ont la même durée.
 * Renvoie { leg, s, beta } pour une phase ψ ∈ [0, 1).
 */
export function pathAt(path, psi) {
  const L = path.legs.length;
  let x = (psi - Math.floor(psi)) * L;
  let leg = Math.min(L - 1, Math.floor(x));
  const s = ease(x - leg);
  const g = path.legs[leg];
  const ea = [0, 0, 0], eb = [0, 0, 0]; ea[g.a] = 1; eb[g.b] = 1;
  const u = 1 - s, w0 = u * u, w1 = 2 * u * s, w2 = s * s;
  const beta = [0, 1, 2].map((k) => w0 * ea[k] + w1 * g.q[k] + w2 * eb[k]);
  return { leg, s, beta };
}

/**
 * Suit une alvéole le long du chemin : la face centrale de chaque étape. À la
 * porte de classe a, l'alvéole vaut (face centrale) ∪ (face voisine à travers
 * le côté opposé au coin a) ; cette voisine devient la face centrale.
 * Renvoie { centers: [face par étape], relay } ; relay est l'isométrie directe
 * qui envoie la face centrale de départ sur celle d'arrivée (le relais).
 */
export function track(group, path) {
  const F0 = GROUPS[group].corners.map((p) => p.slice());
  // le point libre commence dans F : la face centrale est une F* voisine.
  // On prend celle qui fait face au coin d'arrivée de la dernière étape, pour
  // que la suite se referme proprement ; n'importe laquelle convient.
  let c = flip(F0, path.legs[0].a);
  const centers = [];
  for (const g of path.legs) { centers.push(c); c = flip(c, g.b); }
  return { centers, relay: isometry(centers[0], c), end: c };
}

/** Isométrie directe [cos, sin, tx, ty] qui envoie la face f sur la face g (coins par classe). */
export function isometry(f, g) {
  const a = sub(f[1], f[0]), b = sub(g[1], g[0]);
  const ang = Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]);
  const c = Math.cos(ang), s = Math.sin(ang);
  const tx = g[0][0] - (c * f[0][0] - s * f[0][1]);
  const ty = g[0][1] - (s * f[0][0] + c * f[0][1]);
  // contrôle : le troisième coin
  const x = c * f[2][0] - s * f[2][1] + tx, y = s * f[2][0] + c * f[2][1] + ty;
  const err = Math.hypot(x - g[2][0], y - g[2][1]);
  return { c, s, tx, ty, err };
}

export const applyIso = (m, p) => [m.c * p[0] - m.s * p[1] + m.tx, m.s * p[0] + m.c * p[1] + m.ty];
export function isoPow(m, n) {
  let r = { c: 1, s: 0, tx: 0, ty: 0 };
  const inv = { c: m.c, s: -m.s, tx: -(m.c * m.tx + m.s * m.ty), ty: -(-m.s * m.tx + m.c * m.ty) };
  const b = n >= 0 ? m : inv;
  for (let i = 0; i < Math.abs(n); i++) r = isoMul(b, r);
  return r;
}
export function isoMul(a, b) { // a ∘ b
  return { c: a.c * b.c - a.s * b.s, s: a.s * b.c + a.c * b.s, tx: a.c * b.tx - a.s * b.ty + a.tx, ty: a.s * b.tx + a.c * b.ty + a.ty };
}

/** Contour de l'alvéole suivie à la phase ψ (réelle : au-delà de 1, le relais s'applique). */
export function tileAt(group, path, tr, profiles, psi, n = 16, amp = 1) {
  const k = Math.floor(psi);
  const st = pathAt(path, psi - k);
  const poly = outline(tr.centers[st.leg], st.beta, profiles, n, amp);
  if (k !== 0) {
    const m = isoPow(tr.relay, k);
    for (let i = 0; i < poly.length; i += 2) { const p = applyIso(m, [poly[i], poly[i + 1]]); poly[i] = p[0]; poly[i + 1] = p[1]; }
  }
  return poly;
}

// ---------------------------------------------------------------------------
// Les éléments du groupe : toutes les isométries directes qui envoient la face
// de référence F* sur une face F* (de même sorte), dans un disque.

/** Liste d'isométries g telles que g·(alvéole suivie) couvre le disque de rayon R. */
export function elements(group, R) {
  const F0 = GROUPS[group].corners.map((p) => p.slice());
  const ref = flip(F0, 0);
  const seen = new Map();
  const key = (f) => f.map((p) => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4)).join(';');
  const out = [];
  const queue = [ref];
  seen.set(key(ref), 1);
  while (queue.length) {
    const f = queue.pop();
    out.push(isometry(ref, f));
    // voisines de même sorte : deux retournements successifs
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      const g = flip(flip(f, i), j);
      const cx = (g[0][0] + g[1][0] + g[2][0]) / 3, cy = (g[0][1] + g[1][1] + g[2][1]) / 3;
      if (cx * cx + cy * cy > R * R) continue;
      const k = key(g);
      if (!seen.has(k)) { seen.set(k, 1); queue.push(g); }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contrôles

/** Le polygone est-il simple ? (aucun couple d'arêtes non voisines ne se coupe) */
export function isSimple(poly) {
  const n = poly.length / 2;
  const X = (i) => poly[2 * (i % n)], Y = (i) => poly[2 * (i % n) + 1];
  for (let i = 0; i < n; i++) {
    const ax = X(i), ay = Y(i), bx = X(i + 1), by = Y(i + 1);
    if (ax === bx && ay === by) continue;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const cx = X(j), cy = Y(j), dx = X(j + 1), dy = Y(j + 1);
      if (cx === dx && cy === dy) continue;
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (d1 * d2 < -1e-18 && d3 * d4 < -1e-18) return false;
    }
  }
  return true;
}

/** Plus petite distance entre deux portions du contour éloignées de plus de `gap` points. */
export function clearance(poly, gap) {
  const n = poly.length / 2;
  let best = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + gap; j < n; j++) {
    if (n - j + i < gap) continue;
    const d = Math.hypot(poly[2 * i] - poly[2 * j], poly[2 * i + 1] - poly[2 * j + 1]);
    if (d < best) best = d;
  }
  return best;
}
