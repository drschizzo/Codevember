// L'écran de chargement : le cristal de la scène pousse en direct, calculé
// ici même par le modèle de Gravner et Griffeath (en plus petit), dessiné sur
// un OffscreenCanvas. Il tourne dans un worker : il reste fluide pendant que
// le fil principal compile les shaders.
import { growSteps, cellXY } from '../gen/growth.js';

let cv = null, ctx = null, run = 0;
self.onmessage = async ({ data }) => {
  if (data.canvas) { cv = data.canvas; ctx = cv.getContext('2d'); return; }
  if (data.stop) { run++; return; }
  if (!ctx) return;
  const id = ++run;
  const { growth, then, column, seed, dpr = 1 } = data;
  const W = cv.width, H = cv.height;
  if (column) { // (la colonne : un prisme qui s'allonge, sans modèle de croissance)
    for (let f = 0; f <= 60 && id === run; f++) {
      ctx.clearRect(0, 0, W, H);
      const L = (W * 0.36) * (f / 60), w = W * 0.36 / 9;
      ctx.fillStyle = 'rgba(214, 228, 245, 0.85)';
      ctx.fillRect(W / 2 - L, H / 2 - w / 2, 2 * L, w);
      await new Promise((r) => setTimeout(r, 30));
    }
    return;
  }
  const it = growSteps({ ...growth, then, R: 64, sigma: 4e-5, seed }, 12);
  for (let r = it.next(); !r.done && id === run; r = it.next()) {
    const { L, a, c } = r.value;
    ctx.clearRect(0, 0, W, H);
    const sc = (W * 0.42) / L.R;
    for (let k = 0; k < L.order.length; k++) {
      const i = L.order[k];
      if (!a[i]) continue;
      const [x, y] = cellXY(L, i);
      const v = Math.min(1, 0.45 + 0.4 * c[i]);
      ctx.fillStyle = `rgba(${Math.round(190 * v + 40)}, ${Math.round(210 * v + 35)}, ${Math.round(235 * v + 20)}, 0.9)`;
      ctx.fillRect(W / 2 + x * sc - sc * 0.55, H / 2 + y * sc - sc * 0.55, sc * 1.1, sc * 1.1);
    }
    await new Promise((res) => setTimeout(res, 16));
  }
};
