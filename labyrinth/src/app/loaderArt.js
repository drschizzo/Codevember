// Labyrinth — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le calcul de la graine, rejoué : l'algorithme de Wilson creuse le labyrinthe
// (une marche aléatoire erre, ses boucles s'effacent, elle se greffe à l'arbre
// en devenant couloir), puis la recherche en largeur part de l'entrée (un
// front qui se divise à chaque carrefour), puis le chemin s'allume et une
// bille le parcourt, sans fin. Le labyrinthe est exactement celui de la scène
// (même module, même graine) ; seul le tempo est celui de l'écran.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Rien sous ~88 % de la hauteur.
import { buildMaze } from '../gen/maze.js';

const TAU = Math.PI * 2;

export default function createArt() {
  let M = null, ev = [], tree = [], t0 = 0, dist = null, maxD = 1, pathPts = null, scale = 1, extentR = 1;
  function setup(d) {
    const spec = { topo: 'grid', nx: 11, ny: 9, c: 22, r0: 22, ...(d.maze || {}), seed: d.maze?.seed ?? d.seed ?? '' };
    if (spec.topo === 'grid' && !spec.ny) spec.ny = spec.nx;
    ev = [];
    try {
      M = buildMaze(spec, { walk: (u, v) => ev.push([0, u, v]), graft: (E) => ev.push([1, E]) });
    } catch { M = null; return; }
    // distances depuis l'entrée (le front de la recherche)
    const s = M.path[0], N = M.cells.length;
    dist = new Int32Array(N).fill(-1); dist[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) for (const v of M.links[q[h]]) if (dist[v] < 0) { dist[v] = dist[q[h]] + 1; q.push(v); }
    maxD = Math.max(1, ...dist);
    pathPts = M.path.map((i) => [M.cells[i].x, M.cells[i].y]);
    extentR = M.topo === 'polar' ? M.radii[M.radii.length - 1] : Math.max(M.extent.hx, M.extent.hy * 1.15);
    tree = []; t0 = -1;
  }
  setup({});

  // relecture des événements de Wilson jusqu'à k (état incrémental)
  let cursor = 0, walk = [], carved = [];
  const replay = (k) => {
    if (k < cursor) { cursor = 0; walk = []; carved = []; }
    for (; cursor < Math.min(k, ev.length); cursor++) {
      const e = ev[cursor];
      if (e[0] === 0) {
        const [, u, v] = e;
        if (!walk.length) walk.push(u);
        const j = walk.indexOf(v);
        if (j >= 0) walk.length = j + 1; else walk.push(v); // (boucle effacée)
      } else { for (const ed of e[1]) carved.push(ed); walk = []; }
    }
  };

  return {
    data(d) { setup(d); cursor = 0; walk = []; carved = []; },
    draw(ctx, S) {
      if (!M) return;
      if (t0 < 0) t0 = S.t;
      const t = S.t - t0;
      const m = Math.min(S.w, S.h * 0.88), cx = S.w / 2, cy = S.h * 0.44;
      scale = (m * 0.4) / extentR;
      const P = (i) => [cx + M.cells[i].x * scale, cy - M.cells[i].y * scale];
      // un couloir : droit, ou en arc entre deux cellules du même anneau
      const corridor = (a, b, move) => {
        const A = M.cells[a], B = M.cells[b];
        const [x0, y0] = P(a);
        if (move) ctx.moveTo(x0, y0);
        if (M.topo === 'polar' && A.k === B.k && A.k > 0) {
          const r = Math.hypot(A.x, A.y) * scale, a0 = -Math.atan2(A.y, A.x);
          let d = -Math.atan2(B.y, B.x) - a0;
          d = ((d + 3 * Math.PI) % TAU) - Math.PI;
          ctx.arc(cx, cy, r, a0, a0 + d, d < 0);
        } else { const [x1, y1] = P(b); ctx.lineTo(x1, y1); }
      };
      const fade = 1 - S.done;
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 1. Wilson : ~2,6 s
      const kW = Math.floor(Math.min(1, t / 2.6) ** 1.15 * ev.length);
      replay(kW);
      const cw = M.c * scale * 0.62;
      // trame des cellules (points)
      ctx.fillStyle = 'rgba(236, 226, 210, 0.16)';
      for (let i = 0; i < M.cells.length; i++) { const [x, y] = P(i); ctx.beginPath(); ctx.arc(x, y, 1.2 * S.dpr, 0, TAU); ctx.fill(); }
      // couloirs creusés
      const tF = Math.max(0, t - 2.7), front = Math.min(1, tF / 1.4) * maxD;
      ctx.lineWidth = cw;
      // (couleurs opaques, mêlées au fond à l'avance : les jonctions ne s'éclaircissent pas)
      for (const [a, b] of carved) {
        const lit = dist && front > 0 ? Math.max(0, Math.min(1, front - Math.max(dist[a], dist[b]) + 1)) : 0;
        const al = 0.5 + 0.35 * lit;
        ctx.strokeStyle = `rgb(${Math.round(5 + (150 + 86 * lit - 5) * al)}, ${Math.round(5 + (132 + 72 * lit - 5) * al)}, ${Math.round(6 + (108 + 36 * lit - 6) * al)})`;
        ctx.beginPath(); corridor(a, b, true); ctx.stroke();
      }
      // la marche en cours (ambre, fine)
      if (walk.length > 1 && kW < ev.length) {
        ctx.strokeStyle = 'rgba(255, 196, 120, 0.95)'; ctx.lineWidth = 2 * S.dpr;
        ctx.beginPath(); walk.forEach((c, i) => { if (i) corridor(walk[i - 1], c, false); else { const [x, y] = P(c); ctx.moveTo(x, y); } }); ctx.stroke();
        const [hx, hy] = P(walk[walk.length - 1]); ctx.fillStyle = 'rgba(255, 220, 170, 1)'; ctx.beginPath(); ctx.arc(hx, hy, 3 * S.dpr, 0, TAU); ctx.fill();
      }
      // 3. le chemin, puis la bille qui le parcourt (aller-retour sans fin)
      const tP = Math.max(0, t - 4.2);
      if (tP > 0) {
        const L = pathPts.length, k = Math.min(L, 1 + Math.floor(Math.min(1, tP / 0.9) * (L - 1)));
        ctx.strokeStyle = 'rgba(255, 250, 240, 0.95)'; ctx.lineWidth = Math.max(1.5 * S.dpr, cw * 0.18);
        ctx.beginPath();
        for (let i = 0; i < k; i++) { if (i) corridor(M.path[i - 1], M.path[i], false); else { const [x, y] = P(M.path[0]); ctx.moveTo(x, y); } }
        ctx.stroke();
        if (tP > 0.9) {
          const u = ((tP - 0.9) / (0.35 * L)) % 2, f = (u < 1 ? u : 2 - u) * (L - 1), i = Math.min(L - 2, Math.floor(f)), w = f - i;
          const x = cx + (pathPts[i][0] + (pathPts[i + 1][0] - pathPts[i][0]) * w) * scale, y = cy - (pathPts[i][1] + (pathPts[i + 1][1] - pathPts[i][1]) * w) * scale;
          const g = ctx.createRadialGradient(x - cw * 0.12, y - cw * 0.12, 0, x, y, cw * 0.36);
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c9ccd2'); g.addColorStop(1, '#55585e');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, cw * 0.34, 0, TAU); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
