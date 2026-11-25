// Hive — dessin de l'écran de chargement (dans le worker de loaderWorker.js) :
// le pavage de la langue de devant, celui de la graine, tracé au trait. Les
// alvéoles paraissent une à une du centre vers le bord (les éléments du groupe,
// dans l'ordre où on les énumère), et le dessin parcourt sa boucle pendant que
// la scène se prépare : on voit le sommet libre passer par ses deux portes.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// p (avancement 0–1), done (0 → 1 pendant le fondu final), … }.
import { track, tileAt, elements, applyIso } from '../gen/tiling.js';
import { hatPatch, hatParams, hatTile } from '../gen/hat.js';

export default function createArt() {
  let T = null, tr = null, els = [], N = 8, hat = null;
  return {
    data(d) {
      T = d.tiling ?? null;
      hat = null;
      if (!T) return;
      if (T.group === 'hat') {
        // le chapeau : les tuiles d'une métatuile de niveau 2, du centre vers le bord
        const H = hatPatch(2), P0 = hatParams(T.loop, 0);
        const c = H.tiles.map((t) => { const q = hatTile(t, P0.a, P0.b); return [q[0], q[1]]; });
        let cx = 0, cy = 0; for (const q of c) { cx += q[0]; cy += q[1]; } cx /= c.length; cy /= c.length;
        hat = H.tiles.map((t, i) => ({ t, r: Math.hypot(c[i][0] - cx, c[i][1] - cy) })).sort((a, b) => a.r - b.r);
        return;
      }
      tr = track(T.group, T.path);
      els = elements(T.group, 4.6).map((g) => ({ g, r: Math.hypot(g.tx, g.ty) })).sort((a, b) => a.r - b.r);
    },
    draw(ctx, S) {
      if (!T) return;
      const m = Math.min(S.w, S.h), cx = S.w / 2, cy = S.h * 0.45, k = m * 0.085 * (1 + 0.12 * S.done);
      const psi = (S.t * 0.07) % 1;
      if (hat) {
        const P = hatParams(T.loop, psi), mid = hatTile(hat[0].t, P.a, P.b);
        const shown = Math.max(1, Math.floor(hat.length * Math.min(1, 0.08 + S.p * 1.05))), R = m * 0.36;
        ctx.lineJoin = 'round'; ctx.lineWidth = 1.3 * S.dpr;
        for (let e = 0; e < shown; e++) {
          const Q = hatTile(hat[e].t, P.a, P.b), d = Math.hypot(Q[0] - mid[0], Q[1] - mid[1]) * k;
          if (d > R) continue;
          ctx.globalAlpha = (1 - S.done) * (e > shown - 4 ? 0.5 : 1) * Math.min(1, (R - d) / (m * 0.08));
          ctx.beginPath();
          for (let i = 0; i < Q.length; i += 2) { const x = cx + (Q[i] - mid[0]) * k, y = cy - (Q[i + 1] - mid[1]) * k; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          ctx.closePath(); ctx.strokeStyle = 'rgba(236, 226, 205, 0.85)'; ctx.stroke();
          if (hat[e].t.mir) { ctx.fillStyle = 'rgba(214, 150, 50, 0.22)'; ctx.fill(); } // (les anti-chapeaux, un sur huit)
        }
        ctx.globalAlpha = 1;
        return;
      }
      const P = tileAt(T.group, T.path, tr, T.profiles, psi, N, T.amp);
      const shown = Math.max(1, Math.floor(els.length * Math.min(1, 0.08 + S.p * 1.05)));
      // centre du dessin : celui de la première alvéole
      let ox = 0, oy = 0; for (let i = 0; i < P.length; i += 2) { ox += P[i]; oy += P[i + 1]; } ox /= P.length / 2; oy /= P.length / 2;
      const R = m * 0.36;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1.3 * S.dpr;
      for (let e = 0; e < shown; e++) {
        const g = els[e].g;
        const c = applyIso(g, [ox, oy]);
        const dx = (c[0] - ox) * k, dy = (c[1] - oy) * k, d = Math.hypot(dx, dy);
        if (d > R) continue;
        const fresh = e > shown - 4 ? 0.5 : 1; // (les dernières posées sont plus pâles)
        ctx.globalAlpha = (1 - S.done) * fresh * Math.min(1, (R - d) / (m * 0.08));
        ctx.beginPath();
        for (let i = 0; i < P.length; i += 2) {
          const q = applyIso(g, [P[i], P[i + 1]]);
          const x = cx + (q[0] - ox) * k, y = cy - (q[1] - oy) * k;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(236, 226, 205, 0.85)';
        ctx.stroke();
        if (e % 5 === 0) { ctx.fillStyle = 'rgba(214, 150, 50, 0.16)'; ctx.fill(); } // (un peu de miel)
      }
      ctx.globalAlpha = 1;
    },
  };
}
