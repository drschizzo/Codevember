// Le banc des traversées : ce que l'on voit à l'écran, mesuré.
//
// bouquetState(u) (gen/bouquet.js) rend l'état de TOUTES les plumes à
// l'instant u — exactement ce que la scène envoie au GPU. featherLines() pose les barbes et le
// rachis d'une plume en lignes brisées, par la même formule que le vertex shader
// (barbPose). crossings() cherche où une ligne d'une plume traverse la surface
// d'une autre : on construit, dans le repère de la plume B, une carte de hauteur
// à partir de ses propres barbes posées, et un segment de la plume A dont les
// deux extrémités sont de part et d'autre de cette surface (de plus de 0,15 mm)
// la traverse. Rien n'est supposé sur l'ordre des plumes : une traversée est
// une traversée.
//
// Module pur (sans three.js) : tests, outils, worker.
import { qrot, barbPose, rachisPoint, bendOf, BARB_STRIDE, mix } from './feather.js';
import { bouquetState, surfaceDist } from './bouquet.js';

// quaternions (x, y, z, w)
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];

// Les lignes d'une plume dans le monde : ses barbes (nt points chacune) et son
// rachis. table : la table de barbes ; F : sa forme ; o : son état (sceneState).
// skipPlum : sans la base duveteuse (libre : elle se mêle au duvet du pied de la gerbe)
export function featherLines(F, table, o, lay, { nt = 8, every = 1, skipPlum = true } = {}) {
  if (!o.vis) return [];
  const k = (lay.kb ?? bendOf(F, lay.Rd)) * o.scale;
  const g = qrot(qinv(o.q), [0, -1, 0]);
  const S = { u: o.u, L: F.L, k, wear: o.wear, g, radial: F.radial, cal: F.calamus, over: F.over };
  const W = (p) => { const r = qrot(o.q, [p[0] * o.scale, p[1] * o.scale, p[2] * o.scale]); return [r[0] + o.p[0], r[1] + o.p[1], r[2] + o.p[2]]; };
  const lines = [];
  for (let b = 0; b < table.length / BARB_STRIDE; b += every) {
    const B = Array.from(table.subarray(b * BARB_STRIDE, (b + 1) * BARB_STRIDE));
    if (skipPlum && B[7] > 0.35) continue;
    const line = [];
    for (let i = 0; i <= nt; i++) {
      const r = barbPose(B, i / nt, 0, 0, S);
      if (r.hidden) continue;
      line.push(W(r.p));
    }
    // (une barbe agrafée fait partie d'une surface pleine ; une barbe libre —
    // les fils du paon, l'autruche — se mêle à ses voisines comme un cheveu)
    line.solid = B[11] > 0.5;
    if (line.length > 1) lines.push(line);
  }
  if (!F.radial) {
    const line = [];
    for (let i = 0; i <= 24; i++) { const r = rachisPoint(i / 24, S); if (!r.hidden) line.push(W(r.p)); }
    line.solid = true;
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

// Carte de hauteur d'une plume dans son propre repère (cellules de c cm) :
// la hauteur moyenne de ses barbes dans chaque cellule.
// (seules les parties pleines font une surface : barbes agrafées et rachis)
export function heightField(lines, o, c = 0.12) {
  const iq = qinv(o.q), cells = new Map();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const line of lines) if (line.solid !== false) for (const w of line) {
    const l = qrot(iq, [w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]]);
    const key = `${Math.floor(l[0] / c)},${Math.floor(l[1] / c)}`;
    const e = cells.get(key);
    if (e) { e[0] += l[2]; e[1]++; } else cells.set(key, [l[2], 1]);
    x0 = Math.min(x0, l[0]); x1 = Math.max(x1, l[0]); y0 = Math.min(y0, l[1]); y1 = Math.max(y1, l[1]);
  }
  for (const e of cells.values()) e[0] /= e[1];
  // centre et rayon (écarter vite les plumes lointaines)
  const ctr = qrot(o.q, [(x0 + x1) / 2, (y0 + y1) / 2, 0]).map((v, i) => v + o.p[i]);
  if (!cells.size) return { o, iq, c, cells, ctr: o.p, rad: 0 };
  return { o, iq, c, cells, ctr, rad: Math.hypot(x1 - x0, y1 - y0) / 2 + 0.3 };
}
const hAt = (H, x, y) => { const e = H.cells.get(`${Math.floor(x / H.c)},${Math.floor(y / H.c)}`); return e ? e[0] : null; };

// Les traversées des lignes de A à travers la surface de B : { count, depth (cm), at }
export function crossings(linesA, H, eps = 0.015, skip = null) {
  let count = 0, depth = 0, at = null;
  const o = H.o, rr = H.rad * H.rad;
  for (const line of linesA) {
    let prev = null;
    for (const w of line) {
      const dx = w[0] - H.ctr[0], dy = w[1] - H.ctr[1], dz = w[2] - H.ctr[2];
      if (dx * dx + dy * dy + dz * dz > rr || (skip && skip(w))) { prev = null; continue; }
      const l = qrot(H.iq, [w[0] - o.p[0], w[1] - o.p[1], w[2] - o.p[2]]);
      const h = hAt(H, l[0], l[1]);
      const d = h === null ? null : l[2] - h;
      if (d !== null && prev !== null && Math.abs(d) > eps && Math.abs(prev) > eps && (d > 0) !== (prev > 0)) {
        // (un segment de part et d'autre de la surface, dans son contour : il la traverse ;
        // au-delà de 1 cm d'écart, ce n'est plus la même nappe — une autre partie de la plume)
        const m = Math.min(Math.abs(d), Math.abs(prev));
        if (Math.max(Math.abs(d), Math.abs(prev)) < 1.0) { count++; if (m > depth) { depth = m; at = w; } }
      }
      prev = d;
    }
  }
  return { count, depth, at };
}

void mix;

// Toutes les traversées de la gerbe à la phase u (gen/bouquet.js) : chaque
// plume visible contre chaque autre, dans les deux sens, plus le socle (un
// point sous la peau). tables : { hero } ; rend { depth, count, pair, total, body }.
// collar : au pied de la gerbe (moins de collar·L au-dessus de la peau), les
// bases plumulacées des plumes et le duvet du socle se mêlent comme des
// cheveux — on n'y compte pas les traversées.
export function bouquetCrossings(R, lay, u, tables, { nt = 8, collar = 0.1 } = {}) {
  const skip = (w) => surfaceDist(lay.Rd, w) < collar * R.shape.L;
  const st = bouquetState(R, lay, u).filter((o) => o.vis);
  const geo = st.map((o) => { const lines = featherLines(R.shape, tables.hero, o, lay, { nt }); return { o, lines, H: heightField(lines, o) }; });
  let worst = { depth: 0, count: 0, pair: null }, total = 0, body = 0;
  for (const A of geo) {
    for (const B of geo) {
      if (A === B) continue;
      const c = crossings(A.lines, B.H, 0.015, skip);
      total += c.count;
      if (c.depth > worst.depth) worst = { depth: c.depth, count: c.count, pair: `${A.o.kind}${A.o.f} → ${B.o.kind}${B.o.f}` };
    }
    // (dans le socle, plus profond que la couche de duvet (1 mm), et dans le
    // cadre : l'ancienne qui a glissé sur le flanc n'est plus vue)
    for (const line of A.lines) for (const w of line) if (w[1] > -0.5 * R.shape.L) body = Math.max(body, -0.1 - surfaceDist(lay.Rd, w));
  }
  return { ...worst, total, body };
}
