// Melt — dessin de l'écran de chargement (dans le worker de loaderWorker.js) :
// la cloche du moule vue en coupe. Un filet de cire y tombe par le haut, et le
// niveau monte, veines comprises : c'est le moule qui se remplit pendant que
// la page taille les siens.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
const WAX = { rose: ['#c75a60', '#efe0cc'], canard: ['#2f8f9c', '#ebe2cf'], miel: ['#d9a13a', '#f3ecda'], sauge: ['#7fa56f', '#efe8d6'], prune: ['#8c4a86', '#f0b78a'], noir: ['#3a3a3f', '#bfe9d6'] };

export default function createArt() {
  let wax = 'rose';
  return {
    data(d) { if (d.wax && WAX[d.wax]) wax = d.wax; },
    draw(ctx, S) {
      const W = S.w, H = S.h, cx = W / 2, u = Math.min(W, H), bw = u * 0.15, bh = u * 0.34, top = H * 0.26, bot = top + bh;
      const [ca, cb] = WAX[wax];
      ctx.globalAlpha = 1 - S.done;
      // contour de la cloche : épaules rondes, goulot
      const bell = () => {
        ctx.beginPath();
        ctx.moveTo(cx - bw, bot); ctx.lineTo(cx - bw, top + bh * 0.3);
        ctx.quadraticCurveTo(cx - bw, top + bh * 0.06, cx - bw * 0.3, top); ctx.lineTo(cx + bw * 0.3, top);
        ctx.quadraticCurveTo(cx + bw, top + bh * 0.06, cx + bw, top + bh * 0.3); ctx.lineTo(cx + bw, bot); ctx.closePath();
      };
      // la cire monte (boucle lente tant que le calcul dure)
      const lvl = (S.t * 0.22) % 1.25, y = bot - bh * Math.min(1, lvl);
      ctx.save(); bell(); ctx.clip();
      ctx.fillStyle = ca; ctx.fillRect(cx - bw, y, bw * 2, bot - y);
      ctx.strokeStyle = cb; ctx.lineWidth = Math.max(1.5, u * 0.012);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const x = cx - bw + (i / 24) * bw * 2, yy = bot - (k + 0.5) * bh * 0.24 + Math.sin(i * 0.5 + k * 2 + S.t * 0.8) * bh * 0.04;
          if (yy > y) (i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy));
        }
        ctx.stroke();
      }
      ctx.restore();
      // le filet
      if (lvl < 1) { ctx.fillStyle = ca; const w = Math.max(1.5, u * 0.008); ctx.fillRect(cx - w / 2, top - u * 0.16, w, y - top + u * 0.16); }
      ctx.strokeStyle = 'rgba(210, 212, 218, 0.9)'; ctx.lineWidth = Math.max(1.2, u * 0.006);
      bell(); ctx.stroke();
      ctx.fillStyle = 'rgba(210, 212, 218, 0.5)';
      ctx.fillRect(cx - bw * 1.5, bot + u * 0.012, bw * 3, 1.2 * S.dpr);
    },
  };
}
