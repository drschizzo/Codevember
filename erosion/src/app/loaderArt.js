// Erosion — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le calcul lui-même : la table vue d'en haut, en perspective légère, ombrée
// en lumière rasante, qui se creuse en direct. main.js relaie les aperçus de
// la simulation sur le GPU (128 × 64 : variation du lit Δb et hauteur d'eau)
// au fil des états enregistrés ; entre deux aperçus, le dessin glisse de l'un
// à l'autre. Les couleurs viennent du sable de la graine (strates, dépôts) ;
// l'eau est un reflet clair. Avant le premier aperçu : le sable neuf, strié.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Pas de texte, rien sous ~88 % de
// la hauteur, < 3 ms par image.
const W = 128, H = 64;

const hex = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export default function createArt() {
  let tones = [[216, 205, 185], [179, 166, 144], [236, 227, 210], [141, 132, 120]];
  let deposit = [214, 202, 180];
  let cur = new Float32Array(W * H * 2), prev = new Float32Array(W * H * 2), target = new Float32Array(W * H * 2);
  let blend = 1, family = '';
  let img = null, cv = null, cx = null;
  const ensure = () => {
    if (cv) return;
    cv = new OffscreenCanvas(W, H); cx = cv.getContext('2d'); img = cx.createImageData(W, H);
  };
  return {
    data(d) {
      if (d.tones) {
        tones = d.tones.map(hex); deposit = hex(d.deposit); family = d.family;
        cur.fill(0); prev.fill(0); target.fill(0); blend = 1;
      }
      if (d.preview) {
        prev.set(cur); target.set(d.preview); blend = 0;
      }
    },
    draw(ctx, S) {
      ensure();
      blend = Math.min(1, blend + S.dt * 2.2);
      const e = blend * blend * (3 - 2 * blend);
      for (let i = 0; i < W * H * 2; i++) cur[i] = prev[i] + (target[i] - prev[i]) * e;
      // carte ombrée : lumière rasante qui tourne lentement
      const la = S.t * 0.12 + 2.2, L = [Math.cos(la) * 0.85, Math.sin(la) * 0.85, 0.5];
      const ll = Math.hypot(...L);
      const px = img.data, cell = 1.28 / W;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const c = j * W + i;
        const z = (q) => cur[2 * q];
        const iL = Math.max(0, i - 1), iR = Math.min(W - 1, i + 1), jT = Math.max(0, j - 1), jB = Math.min(H - 1, j + 1);
        const gx = (z(j * W + iR) - z(j * W + iL)) / ((iR - iL) * cell) * 3;
        const gy = (z(jB * W + i) - z(jT * W + i)) / ((jB - jT) * cell) * 3;
        const n = [-gx, -gy, 1], nl = Math.hypot(...n);
        let sh = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll));
        sh = 0.18 + 0.95 * sh;
        const db = z(c);
        // creusé : les strates (par la profondeur) ; exhaussé : le dépôt
        let col;
        if (db > 0.0004) col = deposit;
        else { const k = Math.floor(Math.max(0, -db) / 0.005); col = tones[[0, 1, 2, 1, 3][k % 5]]; }
        let r = col[0] * sh, g = col[1] * sh, b = col[2] * sh;
        const wd = cur[2 * c + 1];
        if (wd > 0.0002) { const a = Math.min(0.8, wd / 0.012); r = r * (1 - a) + 205 * a * sh; g = g * (1 - a) + 214 * a * sh; b = b * (1 - a) + 220 * a * sh; }
        const o = c * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      // la table, en légère perspective, centrée
      const m = Math.min(S.w * 0.72, S.h * 1.1), w = m, h = m / 2;
      const x0 = (S.w - w) / 2, y0 = S.h * 0.44 - h / 2;
      ctx.save();
      ctx.globalAlpha = 1 - S.done * 0.9;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // (perspective : la table s'éloigne vers le haut)
      const rows = 32;
      for (let k = 0; k < rows; k++) {
        const a = k / rows, b2 = (k + 1) / rows;
        const sx = (t) => 0.86 + 0.14 * t; // (rangée lointaine plus étroite)
        const ya = y0 + h * a, yb = y0 + h * b2;
        const s = sx(a), ww = w * s;
        ctx.drawImage(cv, 0, H * a, W, H / rows, (S.w - ww) / 2, ya, ww, yb - ya + 0.5);
      }
      // paroi du bac
      ctx.strokeStyle = 'rgba(230, 228, 222, 0.22)';
      ctx.lineWidth = 1 * S.dpr;
      ctx.beginPath();
      ctx.moveTo((S.w - w * 0.86) / 2, y0); ctx.lineTo((S.w + w * 0.86) / 2, y0); ctx.lineTo((S.w + w) / 2, y0 + h); ctx.lineTo((S.w - w) / 2, y0 + h); ctx.closePath();
      ctx.stroke();
      ctx.restore();
    },
  };
}
