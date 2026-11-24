// Burrow — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// La vraie première tranche de la graine (gen/slab.js), vue de face : ses
// couches de sable, puis les galeries qui se creusent dans l'ordre réel et le
// tumulus qui monte avec le sable sorti du fond, ses couches à l'envers. Le
// creusement recommence tant que la scène n'est pas prête.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// p, done, … }. Pas de texte, rien sous ~88 % de la hauteur.
import { buildSlab } from '../gen/slab.js';

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export default function createArt() {
  let G = null, img = null, cv = null, cx = null, lastAge = -1;
  const K = 2; // (une cellule du dessin = 2 × 2 cellules de la tranche)
  function prepare(seed, sands, slab0) {
    const S = buildSlab(`${seed}-0`, slab0 ?? {});
    const w = Math.floor(S.nx / K), h = Math.floor(S.ny / K);
    const pal = (sands ?? ['#221f1d', '#b86a2c', '#e8dfcc', '#8a2f1a', '#d6a447', '#5e5a54', '#efdcab', '#a8471f']).map(hex);
    const layer = new Uint8Array(w * h), dig = new Float32Array(w * h).fill(9), app = new Float32Array(w * h).fill(9), grain = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const id = i * K + S.nx * (j * K), o = i + w * (h - 1 - j);
      layer[o] = S.layer[id] === 255 ? 0 : S.colorOrder[S.layer[id]];
      if (S.mound[id] >= 0) app[o] = S.mound[id];
      else if (S.layer[id] !== 255) { app[o] = 0; if (S.dug[id] >= 0) dig[o] = S.dug[id]; }
      grain[o] = 0.85 + 0.3 * ((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 + 1) % 1;
    }
    G = { w, h, pal, layer, dig, app, grain };
    cv = new OffscreenCanvas(w, h); cx = cv.getContext('2d');
    img = cx.createImageData(w, h);
    lastAge = -1;
  }
  function paint(age) {
    const { w, h, pal, layer, dig, app, grain } = G, d = img.data;
    for (let o = 0; o < w * h; o++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (app[o] <= age) {
        const c = pal[layer[o] % pal.length], k = grain[o] * (dig[o] <= age ? 0.32 : 1);
        r = c[0] * k; g = c[1] * k; b = c[2] * k; a = 255;
      }
      d[o * 4] = r; d[o * 4 + 1] = g; d[o * 4 + 2] = b; d[o * 4 + 3] = a;
    }
    cx.putImageData(img, 0, 0);
  }
  return {
    data(d) { prepare(d.seed ?? 'a1', d.sands, d.slab0); },
    draw(ctx, S) {
      if (!G) return;
      // un creusement qui dure ~9 s, une pause, et recommence
      const age = Math.min(1, ((S.t / 10) % 1) * 1.15);
      const q = Math.round(age * 400) / 400;
      if (q !== lastAge) { paint(q); lastAge = q; }
      const m = Math.min(S.w * 0.7, S.h * 0.75 * (G.w / G.h));
      const W = m, H = m * (G.h / G.w);
      const x = (S.w - W) / 2, y = S.h * 0.44 - H / 2;
      ctx.globalAlpha = 1 - S.done;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cv, x, y, W, H);
      // le verre : un filet clair autour de la tranche
      ctx.strokeStyle = 'rgba(236, 228, 214, 0.35)';
      ctx.lineWidth = 1.5 * S.dpr;
      ctx.strokeRect(x - 3 * S.dpr, y - 3 * S.dpr, W + 6 * S.dpr, H + 6 * S.dpr);
      ctx.globalAlpha = 1;
    },
  };
}
