// L'ajourage des parois : à chaque image, l'ouverture de chaque face de chaque
// cellule (0 : pleine ; 1 : effacée). Elle est constante sur une face : on la
// calcule ici, une fois par face (48 valeurs), et le vertex shader des
// panneaux la lit (voir project.js) au lieu de la recalculer à chaque sommet.
//
// Quatre raisons d'ouvrir une face, la plus forte l'emporte :
//  • la coque : plié, le tesseract est enveloppé par sa cellule extérieure et
//    par les faces latérales qui la touchent ; une face s'ajoure d'autant plus
//    que la coordonnée w de son centre est grande (proche de l'œil 4D) ;
//  • la coupe côté caméra : une face tournée vers la caméra s'ajoure aussi ;
//  • le passage (voyage intérieur) : la paroi que la caméra approche se perce
//    (distance de la caméra au plan de la face, et à son centre dans ce plan) ;
//  • les portes (voyage intérieur) : la paroi entre la pièce où l'on se tient
//    et la suivante s'ouvre à la fin de la halte, reste ouverte pendant la
//    traversée et se referme derrière soi.
import { apply, normalOf, project, smoothstep } from '../math4.js';
import { panelSeat } from '../gen/cell.js';

// passage : distances (à l'échelle de la face projetée) au plan de la face
// où elle est encore pleine / déjà effacée, et demi-largeur de l'ouverture
const PASS = { far: 0.36, near: 0.1, lat: 1.05 };
// porte : rayon de l'iris grand ouvert (part du demi-côté de la paroi : la
// caméra la franchit à l'écart de son centre, sur une diagonale) et rotation
// de ses lames pendant qu'il s'ouvre
const DOOR = { radius: 0.8, spin: 0.9 };
// part de la lumière du studio qu'une face laisse passer, pleine, selon sa
// nature (voir cellOpenness)
const FACE_CLEAR = { open: 1, glass: 0.85, bars: 0.7, leaded: 0.6, comb: 0.5, grid: 0.5, target: 0.45, oculus: 0.4, twist: 0.4, louvre: 0.35, perf: 0.3 };

// Disposition des faces de chaque cellule, dans ses coordonnées locales :
// layout[c][f] = { anchor, grid } — anchor, le centre de la face sur le plan
// des panneaux (même ancrage que leur géométrie, voir gen/cell.js) ; grid,
// la trame d'une tôle perforée [n trous par côté, demi-côté a] ou [0, 0] ;
// clear, la part du studio qu'elle laisse passer quand elle est pleine
export function faceLayout(R) {
  return R.cells.map((cell) => cell.faces.map((kind, f) => {
    const seat = panelSeat(R.frame, kind === 'glass' || kind === 'leaded' ? cell.glassT : cell.panelT);
    const anchor = [0, 0, 0];
    anchor[f >> 1] = (f & 1 ? 1 : -1) * seat.plane;
    return { anchor, grid: kind === 'perf' ? [cell.perf.n, seat.ext] : [0, 0], clear: FACE_CLEAR[kind] ?? 0 };
  }));
}

// Portes du voyage pour l'état st : [précédente, suivante], chacune un iris
// dans la paroi commune à deux pièces — p : son centre projeté ; n : sa
// normale ; u, v : deux axes de son plan (tournés avec ses lames, de spin) ;
// r : son rayon (il s'ouvre) ; half : demi-côté de la paroi ; open : son ouverture
export function voyageDoors(st, R, frames, T, d, inflate) {
  const n = R.moves.length, f = st.f ?? 0;
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const door = (i, open) => wall(frames.rooms[i], frames[i]?.cell, open);
  const wall = (a, b, open) => {
    if (b === undefined || open <= 0) return null;
    const na = normalOf(a), nb = normalOf(b), x = na.map((v, k) => v + nb[k]);
    const p = project(apply(T[a], x), d, inflate);
    // demi-côté de la paroi : du centre au milieu d'un de ses bords (un axe
    // qui n'est celui d'aucune des deux pièces)
    const k = [0, 1, 2, 3].find((j) => na[j] === 0 && nb[j] === 0);
    const e = x.slice(); e[k] += 1;
    const edge = sub(project(apply(T[a], e), d, inflate), p), half = Math.hypot(...edge);
    const nrm = unit(sub(project(apply(T[b], nb), d, inflate), project(apply(T[a], na), d, inflate)));
    const u = unit(sub(edge, nrm.map((c) => c * (edge[0] * nrm[0] + edge[1] * nrm[1] + edge[2] * nrm[2]))));
    const ease = open * open * (3 - 2 * open);
    // (les lames tournent en s'ouvrant : les axes du plan tournent avec elles)
    const v = cross(nrm, u), spin = DOOR.spin * (1 - ease), cs = Math.cos(spin), sn = Math.sin(spin);
    return {
      p, n: nrm, u: u.map((c, j) => c * cs + v[j] * sn), v: v.map((c, j) => c * cs - u[j] * sn),
      r: DOOR.radius * half * ease, half, spin, open,
    };
  };
  if (st.phase === 'dwell') {
    // L'enfilade : un tour en ligne droite (quatre pièces sur un grand cercle)
    // aligne ses quatre portes. À la dernière halte, revenu dans la première
    // pièce, elles s'ouvrent toutes, l'une après l'autre : on regarde le long
    // du cercle entier, et l'on voit que le couloir se referme sur lui-même.
    const r = frames.rooms;
    if (st.room === n && n === 4 && r[2] === (r[0] ^ 1) && r[3] === (r[1] ^ 1) && R.voyage?.enfilade !== false) {
      const close = 1 - smoothstep(0.7, 0.92, f), op = (t) => smoothstep(t, t + 0.2, f) * close;
      return [wall(r[3], r[0], close), wall(r[0], r[1], op(0.08)), wall(r[1], r[2], op(0.16)), wall(r[2], r[3], op(0.24))];
    }
    return [
      st.room > 0 ? door(st.room - 1, 1 - smoothstep(0, 0.35, f)) : null,
      st.room < n ? door(st.room, smoothstep(0.45, 0.95, f)) : null,
    ];
  }
  if (st.phase === 'travel') return [null, door(st.room, 1)];
  return [null, null];
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// point p transformé par la matrice affine m (tableau colonne-major de three)
const toSpace = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
// point local l → 4D par la matrice ligne-major A (math4.cellMatrix)
const map4 = (A, l) => [0, 1, 2, 3].map((r) => A[r * 4] * l[0] + A[r * 4 + 1] * l[1] + A[r * 4 + 2] * l[2] + A[r * 4 + 3]);

// Ouvertures des faces, écrites dans out[c] (tableaux de six nombres).
//   A : matrice de chaque cellule ; layout : faceLayout(R)
//   d, inflate : projection ; toWorld : matrice monde du groupe (Matrix4)
//   viewPos : caméra (monde) ; camLocal : caméra (espace projeté)
//   shell : { amount, lo, hi } ; cutaway ; pass (0 ou 1) ; doors : voyageDoors
export function computeOpenings(out, { A, layout, d, inflate, toWorld, viewPos, camLocal, shell, cutaway, pass, doors }) {
  for (let c = 0; c < 8; c++) {
    const pc = project(map4(A[c], [0, 0, 0]), d, inflate), wc = toSpace(toWorld.elements, pc);
    for (let f = 0; f < 6; f++) {
      const y = map4(A[c], layout[c][f].anchor), pl = project(y, d, inflate);
      let open = smoothstep(shell.lo, shell.hi, y[3]) * shell.amount;
      // coupe : la face (de la cellule vers son centre, une fois projetée)
      // regarde-t-elle la caméra ?
      if (cutaway > 0) {
        const wa = toSpace(toWorld.elements, pl);
        const nx = wa[0] - wc[0], ny = wa[1] - wc[1], nz = wa[2] - wc[2];
        const vx = viewPos.x - wa[0], vy = viewPos.y - wa[1], vz = viewPos.z - wa[2];
        const facing = (nx * vx + ny * vy + nz * vz) / (Math.hypot(nx, ny, nz) * Math.hypot(vx, vy, vz) || 1);
        open = Math.max(open, smoothstep(0.2, 0.85, facing) * cutaway);
      }
      if (pass) {
        // (à l'échelle de la face : loin du centre, la projection agrandit tout)
        const half = dist3(pl, pc), sf = Math.min(8, Math.max(0.6, half / 0.83));
        const nl = [(pl[0] - pc[0]) / (half || 1), (pl[1] - pc[1]) / (half || 1), (pl[2] - pc[2]) / (half || 1)];
        const rel = [camLocal.x - pl[0], camLocal.y - pl[1], camLocal.z - pl[2]];
        const dn = rel[0] * nl[0] + rel[1] * nl[1] + rel[2] * nl[2];
        const lat = Math.hypot(rel[0] - nl[0] * dn, rel[1] - nl[1] * dn, rel[2] - nl[2] * dn);
        open = Math.max(open, smoothstep(PASS.far * sf, PASS.near * sf, Math.abs(dn)) * smoothstep(PASS.lat * sf, PASS.lat * sf * 0.75, lat));
      }
      out[c][f] = open;
    }
  }
}

// Part du studio que voit l'objet exposé de chaque cellule (0 : enfermé ;
// 1 : à l'air libre) : la moyenne, sur les six faces, de ce que chacune
// laisse passer selon sa nature et son ajourage (open : computeOpenings).
export function cellOpenness(layout, open, out) {
  for (let c = 0; c < 8; c++) {
    let sum = 0;
    for (let f = 0; f < 6; f++) { const k = layout[c][f].clear; sum += k + (1 - k) * open[c][f]; }
    out[c] = sum / 6;
  }
  return out;
}
