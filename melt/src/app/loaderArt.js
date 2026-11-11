// Melt — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// Le cristal de la scène pousse en direct, calculé ici même par le modèle de
// Gravner et Griffeath (en plus petit) à partir de la graine de la scène :
// d'abord une gouttelette gelée qui attend, puis l'étoile qui s'étend ; à la
// fin, elle scintille, et s'approche en s'effaçant quand la scène apparaît.
import { growSteps, cellXY } from '../gen/growth.js';

export default function createArt() {
  let layer = null, lctx = null, gen = null, col = null, extent = 0, grown = false, id = 0;
  let glints = [];
  const ensure = (n) => {
    if (layer && layer.width === n) return;
    layer = new OffscreenCanvas(n, n); lctx = layer.getContext('2d');
  };

  function paint(L, a, c) {
    const n = layer.width, sc = (n * 0.47) / L.R;
    lctx.clearRect(0, 0, n, n);
    let r2 = 0;
    for (let k = 0; k < L.order.length; k++) {
      const i = L.order[k];
      if (!a[i]) continue;
      const [x, y] = cellXY(L, i);
      r2 = Math.max(r2, x * x + y * y);
      // (la masse de glace dessine les nervures : plus épais, plus clair)
      const v = Math.min(1, Math.max(0, (c[i] - 0.6) * 1.6));
      lctx.fillStyle = `rgba(${Math.round(120 + 125 * v)}, ${Math.round(150 + 100 * v)}, ${Math.round(190 + 62 * v)}, ${0.35 + 0.6 * v})`;
      lctx.fillRect(n / 2 + x * sc - sc * 0.53, n / 2 + y * sc - sc * 0.53, sc * 1.06, sc * 1.06);
    }
    extent = Math.sqrt(r2) / L.R;
  }

  return {
    data(d) {
      id++;
      grown = false; glints = []; extent = 0;
      col = d.column || null;
      gen = col ? null : growSteps({ ...d.growth, then: d.then, R: 72, sigma: 4e-5, seed: d.seed }, 10);
    },
    draw(ctx, S) {
      const { w, h, t, dpr } = S;
      const m = Math.min(w, h), cx = w / 2, cy = h * 0.46;
      ensure(Math.round(Math.min(520 * dpr, m * 0.62)));
      // une étape de croissance par image (le calcul a lieu ici, dans le worker)
      if (gen && !grown) {
        const t0 = performance.now();
        let r;
        do r = gen.next(); while (!r.done && performance.now() - t0 < 2.5);
        if (r.done) grown = true; else paint(r.value.L, r.value.a, r.value.c);
      }
      const n = layer.width;
      const zoom = 1 + 0.5 * S.done * S.done, alpha = 1 - S.done;
      ctx.globalAlpha = alpha;
      // halo froid
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, m * 0.42);
      halo.addColorStop(0, 'rgba(120, 160, 210, 0.10)'); halo.addColorStop(1, 'rgba(120, 160, 210, 0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      if (col) { // la colonne : un prisme qui s'allonge
        const k = Math.min(1, t / 3), L = m * 0.3 * (0.15 + 0.85 * (1 - (1 - k) ** 3)) * zoom, wd = (m * 0.3) / (col.aspect || 8) * zoom;
        ctx.fillStyle = 'rgba(206, 224, 245, 0.85)';
        ctx.fillRect(cx - L, cy - wd / 2, 2 * L, wd);
        ctx.fillStyle = `rgba(14, 18, 26, ${0.6 * (col.hollow || 0)})`;
        ctx.fillRect(cx - L * 0.8, cy - wd * 0.18, 1.6 * L, wd * 0.36);
      } else if (gen) {
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.rotate(0.04 * Math.sin(t * 0.3));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * 0.35; ctx.filter = `blur(${4 * dpr}px)`;
        ctx.drawImage(layer, -n / 2, -n / 2);
        ctx.filter = 'none'; ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(layer, -n / 2, -n / 2);
        ctx.restore();
      }
      // la gouttelette gelée du départ, tant que le cristal n'a pas pris
      const drop = Math.max(0, 1 - extent * 6);
      if (drop > 0.01 && !col) {
        const r = m * 0.012 * (1 + 0.15 * Math.sin(t * 2.4));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
        g.addColorStop(0, `rgba(230, 240, 255, ${0.9 * drop * alpha})`); g.addColorStop(0.3, `rgba(170, 200, 240, ${0.35 * drop * alpha})`); g.addColorStop(1, 'rgba(170, 200, 240, 0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 4, 0, Math.PI * 2); ctx.fill();
      }
      // scintillements sur le cristal achevé (ou pendant la préparation de la lumière)
      if ((grown || S.stepIdx >= 2) && extent > 0.1 && glints.length < 14 && Math.random() < S.dt * 10) {
        const a = Math.floor(Math.random() * 6) * (Math.PI / 3) + (Math.random() - 0.5) * 0.25, r = Math.random() * extent * n * 0.47;
        glints.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, t: 0, l: 0.5 + Math.random() * 0.7 });
      }
      ctx.save(); ctx.translate(cx, cy); ctx.scale(zoom, zoom); ctx.globalCompositeOperation = 'lighter';
      glints = glints.filter((g) => (g.t += S.dt) < g.l);
      for (const g of glints) {
        const k = Math.sin((g.t / g.l) * Math.PI), s = 7 * dpr * k;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.8 * k * alpha})`; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(g.x - s, g.y); ctx.lineTo(g.x + s, g.y); ctx.moveTo(g.x, g.y - s); ctx.lineTo(g.x, g.y + s); ctx.stroke();
      }
      ctx.restore();
    },
  };
}
