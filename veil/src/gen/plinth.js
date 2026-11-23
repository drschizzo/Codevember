// Maillages du décor réel : le socle (mêmes cotes que son champ de distance,
// forms.js : plinthDims) et le cyclorama (un sol qui se relève en paroi, sans
// horizon). Fonctions pures, appelées dans le worker.
import { Buffers, roundedBox, lathe, OUT, EDGE } from '../../../shared/gen/mesh.js';
import { plinthDims } from './forms.js';

// cylindre vertical à congés (profil en révolution), comme sdRoundCyl
function roundCyl(B, y0, y1, R, r, M = 72) {
  const prof = [];
  const push = (rr, z, nr, nz, s) => prof.push({ r: rr, z, nr, nz, s });
  push(0, y0, 0, -1, OUT);
  push(R - r, y0, 0, -1, OUT);
  for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2); push(R - r + r * Math.cos(a), y0 + r + r * Math.sin(a), Math.cos(a), Math.sin(a), EDGE); }
  push(R, y0 + r, 1, 0, OUT);
  push(R, y1 - r, 1, 0, OUT);
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); push(R - r + r * Math.cos(a), y1 - r + r * Math.sin(a), Math.cos(a), Math.sin(a), EDGE); }
  push(R - r, y1, 0, 1, OUT);
  push(0, y1, 0, 1, OUT);
  B.frame([0, 0, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0]); // (z du profil → y du monde)
  lathe(B, prof, M);
  B.noFrame();
}

export function buildPlinth(P) {
  const D = plinthDims(P);
  const B = new Buffers();
  D.parts.forEach((q, i) => {
    B.piece = (i * 53) & 255;
    if (q.t === 'box') roundedBox(B, q.c, q.h, q.r, 24, EDGE, OUT);
    else roundCyl(B, q.y0, q.y1, q.R, q.r);
  });
  // selle de sculpteur : les trois jambes du trépied (hors contact du voile)
  if (P.kind === 'stand') {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const c = [Math.cos(a) * 0.16, -D.H + 0.012, Math.sin(a) * 0.16];
      roundedBox(B, c, [0.05, 0.012, 0.05], 0.008, 12, EDGE, OUT);
    }
  }
  return B.out();
}

// Cyclorama : sol plat jusqu'à zw, gorge de rayon rc, paroi verticale ; dans
// le repère de la caméra (−z vers le fond), tourné ensuite vers elle.
export function buildCyclo({ y = -1, zw = -2.6, rc = 1.6, top = 7, front = 6, half = 9 }) {
  const B = new Buffers(1 << 15);
  const prof = []; // (z, y, nz, ny)
  for (let k = 0; k <= 24; k++) { const z = front + (zw - front) * (k / 24); prof.push([z, y, 0, 1]); }
  for (let k = 1; k <= 16; k++) { const a = (k / 16) * (Math.PI / 2); prof.push([zw - Math.sin(a) * rc, y + rc - Math.cos(a) * rc, Math.sin(a), Math.cos(a)]); }
  for (let k = 1; k <= 12; k++) { prof.push([zw - rc, y + rc + (top - rc - y) * (k / 12), 1, 0]); }
  const rows = prof.map(([z, yy, nz, ny]) => {
    const row = [];
    for (let i = 0; i <= 48; i++) { const x = -half + (2 * half * i) / 48; row.push(B.vert([x, yy, z], [0, ny, nz], OUT, [1, 0, 0])); }
    return row;
  });
  B.grid(rows);
  return B.out();
}
