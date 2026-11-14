// Melt — dessin de l'écran de chargement (dans le worker de loaderWorker.js) :
// une trémie de bismuth vue de face, dont les gradins apparaissent un à un, du
// bord vers le centre ; chacun prend la couleur de son oxyde, calculée par la
// même optique des couches minces que la scène (Airy, Bi₂O₃ sur bismuth).
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
function filmR(th, lam) {
  const n1 = 2.2, n2r = 1.9, n2i = 3.4;
  const r01 = (1 - n1) / (1 + n1);
  // r12 = (n1 − n2) / (n1 + n2), complexe
  const ar = n1 - n2r, ai = -n2i, br = n1 + n2r, bi = n2i, bd = br * br + bi * bi;
  const r12r = (ar * br + ai * bi) / bd, r12i = (ai * br - ar * bi) / bd;
  const dl = (4 * Math.PI * n1 * th) / lam, er = Math.cos(dl), ei = Math.sin(dl);
  const xr = r12r * er - r12i * ei, xi = r12r * ei + r12i * er; // r12·e
  const nr = r01 + xr, ni = xi, dr = 1 + r01 * xr, di = r01 * xi;
  const dd = dr * dr + di * di;
  const rr = (nr * dr + ni * di) / dd, ri = (ni * dr - nr * di) / dd;
  return rr * rr + ri * ri;
}
const film = (th) => [610, 530, 460].map((l) => Math.min(255, Math.round(255 * Math.pow(filmR(th, l), 0.8) * 1.15)));

export default function createArt() {
  let rate = 1, spiral = false;
  return {
    data(d) { if (d.oxRate != null) rate = d.oxRate; if (d.habit != null) spiral = d.habit === 'spirale'; },
    draw(ctx, S) {
      const W = S.w, H = S.h, cx = W / 2, cy = H * 0.44, half = Math.min(W, H) * 0.22;
      const steps = 8, shown = Math.min(steps, 1 + Math.floor((S.t * 2.2) % (steps + 3)));
      ctx.globalAlpha = 1 - S.done;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.12);
      for (let k = 0; k < shown; k++) {
        const r = half * (1 - k / steps), age = Math.max(0, S.t * 0.6 - k * 0.12);
        const th = rate * (60 + 110 * Math.sqrt(age)) + 22 * k;
        const [R, G, B] = film(th);
        ctx.strokeStyle = `rgb(${R}, ${G}, ${B})`;
        ctx.lineWidth = Math.max(1.5, half * 0.07) * (1 - k / (steps + 2));
        if (spiral) ctx.rotate(0.07);
        ctx.strokeRect(-r, -r, 2 * r, 2 * r);
      }
      ctx.restore();
      // le reflet dans le bain
      ctx.globalAlpha = (1 - S.done) * 0.2;
      ctx.fillStyle = 'rgba(200, 205, 215, 1)';
      ctx.fillRect(cx - half * 1.4, cy + half * 1.25, half * 2.8, 1.2 * S.dpr);
    },
  };
}
