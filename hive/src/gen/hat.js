// La tuile « chapeau » (Smith, Myers, Kaplan, Goodman-Strauss, 2023) : un polygone à
// 13 côtés qui ne pave le plan que sans période, et sa famille continue Tile(a, b)
// (module pur).
//
// Le pavage vient de la substitution de l'article : quatre métatuiles H, T, P, F ;
// à chaque niveau, 29 métatuiles du niveau précédent s'assemblent en une pièce d'où
// l'on découpe les quatre métatuiles suivantes. Une métatuile H de niveau n contient
// 25, 169, 1 156, 7 921… chapeaux.
//
// La famille : les arêtes du chapeau sont de deux sortes, a (longueur 1) et b
// (longueur √3). Chaque arête du pavage devient m·u, où u est sa direction d'origine
// et m = a ou b, deux nombres COMPLEXES. Le chapeau se referme séparément en a et en b,
// donc toute position est A·a + B·b et le pavage reste un pavage. Une tuile retournée
// n'est plus alors le reflet exact de l'autre : il y a deux formes, le chapeau T(a, b)
// et l'anti-chapeau, reflet de T(ā, b̄).
const PI = Math.PI, hr3 = Math.sqrt(3) / 2, SQ3 = Math.sqrt(3);
const pt = (x, y) => ({ x, y });
const hexPt = (x, y) => pt(x + 0.5 * y, hr3 * y);
const padd = (p, q) => pt(p.x + q.x, p.y + q.y), psub = (p, q) => pt(p.x - q.x, p.y - q.y);
const ident = [1, 0, 0, 0, 1, 0];
const inv = (T) => { const det = T[0] * T[4] - T[1] * T[3]; return [T[4] / det, -T[1] / det, (T[1] * T[5] - T[2] * T[4]) / det, -T[3] / det, T[0] / det, (T[2] * T[3] - T[0] * T[5]) / det]; };
const mul = (A, B) => [A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2], A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]];
const trot = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0]; };
const ttrans = (tx, ty) => [1, 0, tx, 0, 1, ty];
const rotAbout = (p, a) => mul(ttrans(p.x, p.y), mul(trot(a), ttrans(-p.x, -p.y)));
const transPt = (M, P) => pt(M[0] * P.x + M[1] * P.y + M[2], M[3] * P.x + M[4] * P.y + M[5]);
const matchSeg = (p, q) => [q.x - p.x, p.y - q.y, p.x, q.y - p.y, q.x - p.x, p.y];
const matchTwo = (p1, q1, p2, q2) => mul(matchSeg(p2, q2), inv(matchSeg(p1, q1)));
const intersect = (p1, q1, p2, q2) => { const d = (q2.y - p2.y) * (q1.x - p1.x) - (q2.x - p2.x) * (q1.y - p1.y); const uA = ((q2.x - p2.x) * (p1.y - p2.y) - (q2.y - p2.y) * (p1.x - p2.x)) / d; return pt(p1.x + uA * (q1.x - p1.x), p1.y + uA * (q1.y - p1.y)); };

const OUT = [hexPt(0, 0), hexPt(-1, -1), hexPt(0, -2), hexPt(2, -2), hexPt(2, -1), hexPt(4, -2), hexPt(5, -1), hexPt(4, 0), hexPt(3, 0), hexPt(2, 2), hexPt(0, 3), hexPt(0, 2), hexPt(-1, 2)];

// arêtes du chapeau : [direction unitaire, sorte (0 = a, 1 = b)] ; l'arête double est coupée en deux
export const HAT_EDGES = [];
for (let i = 0; i < 13; i++) {
  const p = OUT[i], q = OUT[(i + 1) % 13], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy);
  if (Math.abs(l - 2) < 1e-9) HAT_EDGES.push([[dx / 2, dy / 2], 0], [[dx / 2, dy / 2], 0]);
  else if (Math.abs(l - 1) < 1e-9) HAT_EDGES.push([[dx, dy], 0]);
  else HAT_EDGES.push([[dx / l, dy / l], 1]);
}
export const NE = HAT_EDGES.length; // 14

class Geom { constructor(shape, hat = false) { this.shape = shape; this.children = []; this.hat = hat; } add(T, geom) { this.children.push({ T, geom }); } }
const evalChild = (g, n, i) => transPt(g.children[n].T, g.children[n].geom.shape[i]);
const HAT = new Geom(OUT, true);

function init() {
  const Ho = [pt(0, 0), pt(4, 0), pt(4.5, hr3), pt(2.5, 5 * hr3), pt(1.5, 5 * hr3), pt(-0.5, hr3)];
  const H = new Geom(Ho);
  H.add(matchTwo(OUT[5], OUT[7], Ho[5], Ho[0]), HAT);
  H.add(matchTwo(OUT[9], OUT[11], Ho[1], Ho[2]), HAT);
  H.add(matchTwo(OUT[5], OUT[7], Ho[3], Ho[4]), HAT);
  H.add(mul(ttrans(2.5, hr3), mul([-0.5, -hr3, 0, hr3, -0.5, 0], [0.5, 0, 0, 0, -0.5, 0])), HAT);
  const T = new Geom([pt(0, 0), pt(3, 0), pt(1.5, 3 * hr3)]);
  T.add([0.5, 0, 0.5, 0, 0.5, hr3], HAT);
  const P = new Geom([pt(0, 0), pt(4, 0), pt(3, 2 * hr3), pt(-1, 2 * hr3)]);
  P.add([0.5, 0, 1.5, 0, 0.5, hr3], HAT);
  P.add(mul(ttrans(0, 2 * hr3), mul([0.5, hr3, 0, -hr3, 0.5, 0], [0.5, 0, 0, 0, 0.5, 0])), HAT);
  const F = new Geom([pt(0, 0), pt(3, 0), pt(3.5, hr3), pt(3, 2 * hr3), pt(-1, 2 * hr3)]);
  F.add([0.5, 0, 1.5, 0, 0.5, hr3], HAT);
  F.add(mul(ttrans(0, 2 * hr3), mul([0.5, hr3, 0, -hr3, 0.5, 0], [0.5, 0, 0, 0, 0.5, 0])), HAT);
  return { H, T, P, F };
}
// (métatuile voisine, son côté, la nouvelle, son côté) ou (deux voisines et leurs sommets)
const RULES = [['H'], [0, 0, 'P', 2], [1, 0, 'H', 2], [2, 0, 'P', 2], [3, 0, 'H', 2], [4, 4, 'P', 2], [0, 4, 'F', 3], [2, 4, 'F', 3], [4, 1, 3, 2, 'F', 0], [8, 3, 'H', 0], [9, 2, 'P', 0], [10, 2, 'H', 0], [11, 4, 'P', 2], [12, 0, 'H', 2], [13, 0, 'F', 3], [14, 2, 'F', 1], [15, 3, 'H', 4], [8, 2, 'F', 1], [17, 3, 'H', 0], [18, 2, 'P', 0], [19, 2, 'H', 2], [20, 4, 'F', 3], [20, 0, 'P', 2], [22, 0, 'H', 2], [23, 4, 'F', 3], [23, 0, 'F', 3], [16, 0, 'P', 2], [9, 4, 0, 2, 'T', 2], [4, 0, 'F', 3]];
function constructPatch(S) {
  const ret = new Geom([]);
  for (const r of RULES) {
    if (r.length === 1) ret.add(ident, S[r[0]]);
    else if (r.length === 4) {
      const ch = ret.children[r[0]], poly = ch.geom.shape;
      const P = transPt(ch.T, poly[(r[1] + 1) % poly.length]), Q = transPt(ch.T, poly[r[1]]);
      const n = S[r[2]], np = n.shape;
      ret.add(matchTwo(np[r[3]], np[(r[3] + 1) % np.length], P, Q), n);
    } else {
      const chP = ret.children[r[0]], chQ = ret.children[r[2]];
      const P = transPt(chQ.T, chQ.geom.shape[r[3]]), Q = transPt(chP.T, chP.geom.shape[r[1]]);
      const n = S[r[4]], np = n.shape;
      ret.add(matchTwo(np[r[5]], np[(r[5] + 1) % np.length], P, Q), n);
    }
  }
  return ret;
}
function constructMetatiles(patch) {
  const bps1 = evalChild(patch, 8, 2), bps2 = evalChild(patch, 21, 2);
  const rbps = transPt(rotAbout(bps1, -2 * PI / 3), bps2);
  const p72 = evalChild(patch, 7, 2), p252 = evalChild(patch, 25, 2);
  const llc = intersect(bps1, rbps, evalChild(patch, 6, 2), p72);
  let w = psub(evalChild(patch, 6, 2), llc);
  const Ho = [llc, bps1];
  w = transPt(trot(-PI / 3), w); Ho.push(padd(Ho[1], w));
  Ho.push(evalChild(patch, 14, 2));
  w = transPt(trot(-PI / 3), w); Ho.push(psub(Ho[3], w));
  Ho.push(evalChild(patch, 6, 2));
  const H = new Geom(Ho); for (const c of [0, 9, 16, 27, 26, 6, 1, 8, 10, 15]) H.add(patch.children[c].T, patch.children[c].geom);
  const P = new Geom([p72, padd(p72, psub(bps1, llc)), bps1, llc]); for (const c of [7, 2, 3, 4, 28]) P.add(patch.children[c].T, patch.children[c].geom);
  const F = new Geom([bps2, evalChild(patch, 24, 2), evalChild(patch, 25, 0), p252, padd(p252, psub(llc, bps1))]); for (const c of [21, 20, 22, 23, 24, 25]) F.add(patch.children[c].T, patch.children[c].geom);
  const AAA = Ho[2], BBB = padd(Ho[1], psub(Ho[4], Ho[5])), CCC = transPt(rotAbout(BBB, -PI / 3), AAA);
  const T = new Geom([BBB, CCC, AAA]); T.add(patch.children[11].T, patch.children[11].geom);
  return { H, T, P, F };
}

const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

/**
 * Le pavage d'une métatuile H de niveau donné, dans les unités du chapeau (a = 1, b = √3).
 * Chaque tuile : { c, s (rotation), mir (0 ou 1), A, B } — son premier sommet est en
 * A·a + B·b, et son contour en sort par les arêtes m·rot·u (u conjugué si retournée).
 * err : écart de fermeture des coefficients (nul : le pavage est sans trou).
 */
export function hatPatch(level = 3) {
  let S = init();
  for (let l = 0; l < level; l++) S = constructMetatiles(constructPatch(S));
  const Ms = [];
  const walk = (g, M) => { for (const ch of g.children) { const N = mul(M, ch.T); if (ch.geom.hat) Ms.push(N); else walk(ch.geom, N); } };
  walk(S.H, ident);
  // graphe des sommets, pour propager (A, B)
  const V = new Map(), adj = [];
  const id = (x, y) => { const k = Math.round(x * 2e3) + ',' + Math.round(y * 2e3); let v = V.get(k); if (v === undefined) { v = adj.length; V.set(k, v); adj.push([]); } return v; };
  const tiles = Ms.map((M) => {
    // (les chapeaux de la substitution sont à l'échelle 1/2 : on double)
    const sc = Math.hypot(M[0], M[3]), c = M[0] / sc, s = M[3] / sc, mir = M[0] * M[4] - M[1] * M[3] < 0 ? 1 : 0;
    let x = 2 * (M[0] * OUT[0].x + M[1] * OUT[0].y + M[2]), y = 2 * (M[3] * OUT[0].x + M[4] * OUT[0].y + M[5]);
    const first = id(x, y);
    let v = first;
    for (const [u, t] of HAT_EDGES) {
      const uy = mir ? -u[1] : u[1], d = [c * u[0] - s * uy, s * u[0] + c * uy], len = t ? SQ3 : 1;
      x += d[0] * len; y += d[1] * len;
      const w = id(x, y);
      adj[v].push([w, d, t]); adj[w].push([v, [-d[0], -d[1]], t]);
      v = w;
    }
    return { c, s, mir, first };
  });
  const C = new Float64Array(adj.length * 4), seen = new Uint8Array(adj.length);
  let err = 0;
  const queue = [tiles[0].first]; seen[tiles[0].first] = 1;
  while (queue.length) {
    const v = queue.pop();
    for (const [w, d, t] of adj[v]) {
      const ax = C[4 * v] + (t ? 0 : d[0]), ay = C[4 * v + 1] + (t ? 0 : d[1]), bx = C[4 * v + 2] + (t ? d[0] : 0), by = C[4 * v + 3] + (t ? d[1] : 0);
      if (seen[w]) err = Math.max(err, Math.abs(C[4 * w] - ax), Math.abs(C[4 * w + 1] - ay), Math.abs(C[4 * w + 2] - bx), Math.abs(C[4 * w + 3] - by));
      else { seen[w] = 1; C.set([ax, ay, bx, by], 4 * w); queue.push(w); }
    }
  }
  for (const T of tiles) { T.A = [C[4 * T.first], C[4 * T.first + 1]]; T.B = [C[4 * T.first + 2], C[4 * T.first + 3]]; delete T.first; }
  return { tiles, err, connected: seen.every((s) => s) };
}

/** Contour (14 sommets) du chapeau (mir = 0) ou de l'anti-chapeau (mir = 1) pour a, b complexes ; premier sommet à l'origine. */
export function hatShape(a, b, mir = 0) {
  const out = new Float64Array(2 * NE);
  let x = 0, y = 0;
  for (let e = 0; e < NE; e++) {
    out[2 * e] = x; out[2 * e + 1] = y;
    const [u, t] = HAT_EDGES[e], v = cmul(t ? b : a, mir ? [u[0], -u[1]] : u);
    x += v[0]; y += v[1];
  }
  return out;
}
const polyArea = (P) => { let s = 0; const n = P.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += P[2 * i] * P[2 * j + 1] - P[2 * j] * P[2 * i + 1]; } return s / 2; };

/**
 * La boucle : un lacet fermé dans le plan du rapport b/a. loop = { r0, dr, dphi } :
 * ln|b/a| = r0 + dr·cos(2πψ), arg(b/a) = dphi·sin(2πψ). (a, b) sont normalisés pour que
 * l'aire moyenne d'une tuile (7 chapeaux pour 1 anti-chapeau) vaille 1.
 */
export function hatParams(loop, psi) {
  const t = 2 * PI * psi, r = Math.exp(loop.r0 + loop.dr * Math.cos(t)), ph = loop.dphi * Math.sin(t);
  let a = [1, 0], b = [r * Math.cos(ph), r * Math.sin(ph)];
  const A0 = Math.abs(polyArea(hatShape(a, b, 0))), A1 = Math.abs(polyArea(hatShape(a, b, 1)));
  const k = 1 / Math.sqrt((7 * A0 + A1) / 8);
  return { a: [k, 0], b: [b[0] * k, b[1] * k], area: [A0 * k * k, A1 * k * k] };
}

/** Contour de la tuile i du pavage pour (a, b) : Float64Array de 28. */
export function hatTile(T, a, b) {
  const S = hatShape(a, b, T.mir), p0 = [cmul(T.A, a)[0] + cmul(T.B, b)[0], cmul(T.A, a)[1] + cmul(T.B, b)[1]];
  const out = new Float64Array(2 * NE);
  for (let e = 0; e < NE; e++) { out[2 * e] = p0[0] + T.c * S[2 * e] - T.s * S[2 * e + 1]; out[2 * e + 1] = p0[1] + T.s * S[2 * e] + T.c * S[2 * e + 1]; }
  return out;
}
