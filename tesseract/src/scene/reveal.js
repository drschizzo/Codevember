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
// porte : rayon (espace projeté) autour de son centre où elle est effacée / pleine
const DOOR = { near: 0.12, far: 0.32 };

// Disposition des faces de chaque cellule, dans ses coordonnées locales :
// layout[c][f] = { anchor, grid } — anchor, le centre de la face sur le plan
// des panneaux (même ancrage que leur géométrie, voir gen/cell.js) ; grid,
// la trame d'une tôle perforée [n trous par côté, demi-côté a] ou [0, 0]
export function faceLayout(R) {
  return R.cells.map((cell) => cell.faces.map((kind, f) => {
    const seat = panelSeat(R.frame, kind === 'glass' || kind === 'leaded' ? cell.glassT : cell.panelT);
    const anchor = [0, 0, 0];
    anchor[f >> 1] = (f & 1 ? 1 : -1) * seat.plane;
    return { anchor, grid: kind === 'perf' ? [cell.perf.n, seat.ext] : [0, 0] };
  }));
}

// Portes du voyage pour l'état st : [précédente, suivante], chacune
// { p : centre projeté de la paroi commune, open : ouverture }
export function voyageDoors(st, R, frames, T, d, inflate) {
  const n = R.moves.length, f = st.f ?? 0;
  const door = (i, open) => {
    const a = frames.rooms[i], b = frames[i]?.cell;
    if (b === undefined || open <= 0) return null;
    const x = normalOf(a).map((v, k) => v + normalOf(b)[k]);
    return { p: project(apply(T[a], x), d, inflate), open };
  };
  if (st.phase === 'dwell') {
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
      for (const door of doors) if (door) open = Math.max(open, smoothstep(DOOR.far, DOOR.near, dist3(pl, door.p)) * door.open);
      out[c][f] = open;
    }
  }
}
