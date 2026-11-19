// Fold — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// La grande feuille de la graine se plie pendant que la scène se prépare : son
// patron est tiré par le module de la scène (sim/fold.js, le même patron, en
// plus grossier) et plié en direct par le même solveur (barres, charnières,
// coup de pouce qui choisit la selle). On n'en dessine que les pliures, en
// perspective, sur une feuille qui tourne lentement : montagnes dans la teinte
// pâle d'une face, vallées dans celle de l'autre, le bord en ivoire ; ce qui
// est derrière s'efface. Le pli avance avec le chargement réel.
import { pleatedU, createSolver } from '../sim/fold.js';
import { PATTERNS } from '../recipe.js';

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export default function createArt() {
  let S = null, so = null, push = null, amp = 2, crease = null, edge = null, shown = 0, lastT = 0;
  let mount = [255, 190, 205], vall = [190, 232, 240];

  function prepare(d) {
    S = so = null; shown = 0;
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const pale = (h) => hex(h).map((v) => Math.round(v * 0.55 + 255 * 0.45));
    if (d.colors) { mount = pale(d.colors[0]); vall = pale(d.colors[1]); }
    const sh = d.sheet;
    if (!sh) return;
    try {
      const P = PATTERNS[sh.pattern] ?? PATTERNS.carre;
      S = pleatedU({ n: sh.n, rings: Math.min(9, Math.round(sh.rings / 2)), sub: 2, m: 6, hole: sh.hole, twist: P.twist ?? 0, star: P.star ?? 0, kind: P.kind ?? 'rings', lobes: P.lobes ?? 2 });
      so = createSolver(S);
      amp = sh.amp ?? 2;
      const eps = P.eps ?? 0.02, q = S.q;
      push = (f) => {
        for (let i = 0; i < S.N; i++) {
          const X = S.P[3 * i], Z = S.P[3 * i + 2];
          f[3 * i + 1] += eps * (X * X + Z * Z) * (S.soleil ? 3 : Math.cos(q * Math.atan2(Z, X)));
        }
      };
      // les pliures (charnières marquées) et le bord (arêtes d'un seul triangle)
      const H = S.hinges, cr = [], key = (a, b) => (a < b ? a * S.N + b : b * S.N + a), inner = new Set();
      for (let h = 0; h < H.length; h += 6) { inner.add(key(H[h], H[h + 1])); if (H[h + 4]) cr.push(H[h], H[h + 1], H[h + 4] > 0 ? 1 : 0); }
      const ed = [];
      for (let b = 0; b < S.bars.length; b += 3) if (!inner.has(key(S.bars[b], S.bars[b + 1]))) ed.push(S.bars[b], S.bars[b + 1]);
      crease = cr; edge = ed;
    } catch { S = so = null; }
  }

  return {
    data(d) { prepare(d); },
    draw(ctx, S0) {
      const { w, h, t, dpr } = S0;
      if (!S || !so) return;
      const m = Math.min(w, h), cx = w / 2, cy = h * (S.soleil ? 0.56 : 0.44), sc = S.soleil ? Math.min(h * 0.42, w * 0.32) : Math.min(h * 0.5, w * 0.36); // (en portrait, la largeur borne : les coins restent dans l’écran)
      ctx.globalAlpha = 1 - S0.done;
      // le pli suit le chargement réel, et un peu le temps (jamais figé)
      const target = Math.min(1, Math.max(S0.p * 0.97, Math.min(0.4, t * 0.06)) + S0.done * 0.03);
      shown += (target - shown) * Math.min(1, (t - lastT) * 2 || 0.1);
      lastT = t;
      so.setFold(amp * (0.08 + 0.92 * smooth(shown)));
      so.step(8, push);
      const x = so.x;
      if (!Number.isFinite(x[0])) { so = createSolver(S); return; }
      // projection : la feuille tourne lentement, vue d'un peu au-dessus
      const a = t * 0.18, ca = Math.cos(a), sa = Math.sin(a), el = 0.62, ce = Math.cos(el), se = Math.sin(el);
      const N = S.N, px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const X0 = x[3 * i], Y0 = x[3 * i + 1], Z0 = x[3 * i + 2];
        const X = ca * X0 + sa * Z0, Zr = -sa * X0 + ca * Z0;
        const Y = ce * Y0 - se * Zr, Z = se * Y0 + ce * Zr;
        const p = 1 / (1 - Z * 0.22);
        px[i] = cx + X * sc * p; py[i] = cy - Y * sc * p; pz[i] = Z;
      }
      ctx.lineCap = 'round';
      // deux passes : derrière (pâle), devant (clair)
      for (const front of [false, true]) {
        const al = front ? 0.92 : 0.28;
        for (const mt of [0, 1]) {
          const c = mt ? mount : vall;
          ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${al})`;
          ctx.lineWidth = (mt ? 1.7 : 1.35) * dpr;
          ctx.beginPath();
          for (let k = 0; k < crease.length; k += 3) {
            if (crease[k + 2] !== mt) continue;
            const i = crease[k], j = crease[k + 1];
            if ((pz[i] + pz[j] > 0) !== front) continue;
            ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]);
          }
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(240, 232, 218, ${front ? 0.95 : 0.3})`;
        ctx.lineWidth = 1.8 * dpr;
        ctx.beginPath();
        for (let k = 0; k < edge.length; k += 2) {
          const i = edge[k], j = edge[k + 1];
          if ((pz[i] + pz[j] > 0) !== front) continue;
          ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]);
        }
        ctx.stroke();
      }
      // la tige qui tient la feuille par son centre
      ctx.strokeStyle = 'rgba(240, 232, 218, 0.35)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + m * (S.soleil ? 0.3 : 0.4)); ctx.stroke();
    },
  };
}
