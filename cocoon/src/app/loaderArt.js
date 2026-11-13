// Cocoon — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// Le cocon de la graine s'enroule pendant que la scène se prépare : le chemin
// du ruban est calculé ici même par le module du bobinage (gen/winding.js, la
// même famille, la même cage, le même ruban, en plus grossier), projeté
// en perspective sur une cage qui tourne lentement ; les brins de devant sont
// clairs, ceux de derrière s'effacent ; au centre, la lueur de la lampe baisse
// à mesure que le ruban la couvre. À la fin, le cocon luit, puis s'efface.
import { buildPath } from '../gen/winding.js';
import { wallPoint } from '../gen/profile.js';

export default function createArt() {
  let pts = null, n = 0, shown = 0, lastT = 0, col = [236, 226, 204], lamp = [255, 214, 160], R = 0.13;

  function prepare(d) {
    pts = null; n = 0; shown = 0;
    if (!d?.family) return;
    try {
      const spec = { family: d.family, cage: d.cage, band: d.band, wind: d.wind, step: 0.008 };
      const { P, path } = buildPath(spec);
      R = P.rMax;
      // au plus ~3 000 points (un toutes les ~1 cm)
      const k = Math.max(1, Math.floor(path.sig.length / 3000));
      n = Math.floor(path.sig.length / k);
      pts = new Float32Array(n * 3);
      const q = [0, 0, 0];
      for (let i = 0; i < n; i++) { wallPoint(P, path.sig[i * k], path.phi[i * k], 0.002, q); pts.set(q, i * 3); }
    } catch { pts = null; }
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (d.thread) col = hex(d.thread).map((v) => Math.round(v * 0.6 + 255 * 0.4));
    if (d.lamp) lamp = hex(d.lamp);
  }

  return {
    data(d) { prepare(d); },
    draw(ctx, S) {
      const { w, h, t, dpr } = S;
      const m = Math.min(w, h), cx = w / 2, cy = h * 0.44;
      const sc = (m * 0.3) / R;
      ctx.globalAlpha = 1 - S.done;
      // le ruban avance avec le chargement réel, et un peu avec le temps (jamais figé)
      const target = n * Math.min(1, Math.max(S.p * 0.97, Math.min(0.35, t * 0.05)) + S.done * 0.03);
      shown += (target - shown) * Math.min(1, (t - lastT) * 3 || 0.1);
      lastT = t;
      const cover = n ? shown / n : 0;
      // lueur de la lampe : elle baisse quand le cocon se ferme
      const gl = 0.9 * (1 - 0.7 * Math.min(1, cover * 1.3)) + 0.2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.42);
      g.addColorStop(0, `rgba(${lamp[0]}, ${lamp[1]}, ${lamp[2]}, ${0.5 * gl})`);
      g.addColorStop(0.25, `rgba(${lamp[0]}, ${lamp[1]}, ${lamp[2]}, ${0.12 * gl})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(255, 244, 228, ${0.9 * gl})`;
      ctx.beginPath(); ctx.arc(cx, cy, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
      if (!pts) return;
      // projection : cage qui tourne lentement, vue un peu d'en haut
      const a = t * 0.25, ca = Math.cos(a), sa = Math.sin(a), el = 0.32, ce = Math.cos(el), se = Math.sin(el);
      const N = Math.floor(shown);
      ctx.lineWidth = 1.4 * dpr;
      ctx.lineCap = 'round';
      // deux passes : derrière (pâle), devant (clair)
      for (const front of [false, true]) {
        ctx.strokeStyle = front ? `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.92)` : `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.22)`;
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < N; i++) {
          const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
          const X = ca * x + sa * z, Z0 = -sa * x + ca * z;
          const Y = ce * y - se * Z0, Z = se * y + ce * Z0;
          if ((Z > 0) !== front) { pen = false; continue; }
          const p = 1 / (1 - Z * 1.2);
          const px = cx + X * sc * p, py = cy - Y * sc * p;
          if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
        }
        ctx.stroke();
      }
      // le point de pose : une étincelle au bout du ruban
      if (N > 0 && N < n) {
        const i = N - 1, x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
        const X = ca * x + sa * z, Z0 = -sa * x + ca * z, Y = ce * y - se * Z0, Z = se * y + ce * Z0, p = 1 / (1 - Z * 1.2);
        ctx.fillStyle = 'rgba(255, 250, 235, 0.95)';
        ctx.beginPath(); ctx.arc(cx + X * sc * p, cy - Y * sc * p, 2.4 * dpr, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}
