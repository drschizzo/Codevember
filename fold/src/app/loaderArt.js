// Fold — dessin de l'écran de chargement (dans le worker de loaderWorker.js) :
// le patron de la grande feuille vu de dessus. Ses plis concentriques se
// marquent l'un après l'autre, montagne et vallée alternées, pendant que la
// page plie les siennes.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
export default function createArt() {
  let colors = ['#ff2f6d', '#12c4d6', '#f7b7cf'], n = 4;
  return {
    data(d) { if (d.colors) colors = d.colors; if (d.n) n = d.n; },
    draw(ctx, S) {
      const W = S.w, H = S.h, cx = W / 2, cy = H * 0.44, u = Math.min(W, H) * 0.36, K = 9, sides = n >= 32 ? 72 : n;
      ctx.globalAlpha = 1 - S.done;
      const ring = (r) => {
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) { const a = (i / sides) * Math.PI * 2 - Math.PI / 2 + Math.PI / sides; const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a) * 0.62; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.closePath();
      };
      // la feuille, puis ses plis : un de plus toutes les demi-secondes, en boucle
      ring(u); ctx.fillStyle = colors[0]; ctx.fill();
      const shown = (S.t * 2.2) % (K + 4);
      ctx.lineWidth = Math.max(1, u * 0.012);
      for (let k = 1; k < K; k++) {
        const a = Math.max(0, Math.min(1, shown - k));
        if (a <= 0) continue;
        ring(u * (k / K));
        ctx.globalAlpha = (1 - S.done) * a;
        ctx.strokeStyle = k & 1 ? colors[1] : '#ffffff'; ctx.stroke();
      }
      ctx.globalAlpha = 1 - S.done;
      if (n < 32) { // les diagonales
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath();
        for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2 - Math.PI / 2 + Math.PI / sides; ctx.moveTo(cx, cy); ctx.lineTo(cx + u * Math.cos(a), cy + u * Math.sin(a) * 0.62); }
        ctx.stroke();
      }
    },
  };
}
