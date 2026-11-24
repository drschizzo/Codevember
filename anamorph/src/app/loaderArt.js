// Anamorph — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Il montre le calcul de CETTE graine : les deux silhouettes cibles (le contour
// seul), puis, à mesure que le worker de génération pose les pièces de
// ferraille (src/gen/pieces.js), l'ombre de chaque pièce sur chacune des deux
// figures, en trait clair. Les traits s'accumulent et remplissent les deux
// animaux à la fois : c'est exactement ce que fait l'algorithme, une pièce
// après l'autre, pour deux heures du jour en même temps. Pendant la recherche
// du placement (avant les pièces), un petit soleil fait le tour des figures.
//
// Données (loader.art) : { seed, figs: [noms], reset } au départ, puis
// { strokes: [[k, a0, b0, a1, b1, demi-largeur], …], cov } au fil du calcul
// (repère de figure : a du pied vers le bout, b en travers ; en unités de figure).
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
import { figurePolygon } from '../gen/silhouettes.js';

const INK = '236, 226, 210';

export default function createArt() {
  let figs = [], polys = [], strokes = [], born = 0;
  return {
    data(d, S) {
      if (d.reset || d.figs) {
        figs = d.figs ?? figs;
        polys = figs.map((n) => { try { return figurePolygon(n, 2); } catch { return []; } });
        if (d.reset) strokes = [];
      }
      if (d.strokes) for (const s of d.strokes) strokes.push({ s, t: S.t + (born++ % 6) * 0.04 });
    },
    draw(ctx, S) {
      if (!polys.length) return;
      const n = polys.length;
      const H = Math.min(S.h * 0.5, (S.w * 0.8) / n / 0.75); // hauteur d'une figure (une figure fait ~0,6 H de large)
      const cy = S.h * 0.44 + H / 2; // pied des figures
      const cx = (k) => S.w / 2 + (k - (n - 1) / 2) * H * 0.85;
      const X = (k, b) => cx(k) + b * H, Y = (a) => cy - a * H;
      const fade = 1 - S.done;
      ctx.lineCap = 'round';
      // les contours
      ctx.lineWidth = 1 * S.dpr;
      ctx.strokeStyle = `rgba(${INK}, ${0.32 * fade})`;
      polys.forEach((P, k) => {
        ctx.beginPath();
        P.forEach(([a, b], i) => (i ? ctx.lineTo(X(k, b), Y(a)) : ctx.moveTo(X(k, b), Y(a))));
        ctx.closePath();
        ctx.stroke();
      });
      // le soleil, pendant la recherche du placement (avant les pièces)
      if (!strokes.length) {
        const a = S.t * 0.9, r = H * 0.62;
        ctx.fillStyle = `rgba(${INK}, ${0.7 * fade})`;
        ctx.beginPath(); ctx.arc(S.w / 2 + Math.cos(a) * r * 1.6, cy - H / 2 + Math.sin(a) * r * 0.5, 3 * S.dpr, 0, Math.PI * 2); ctx.fill();
        return;
      }
      // l'ombre de chaque pièce posée, sur chaque figure
      for (const { s: [k, a0, b0, a1, b1, w], t } of strokes) {
        const age = Math.min(1, (S.t - t) / 0.35);
        if (age <= 0) continue;
        ctx.strokeStyle = `rgba(${INK}, ${(0.16 + 0.5 * (1 - age)) * fade})`;
        ctx.lineWidth = Math.max(1.2 * S.dpr, 2 * w * H);
        ctx.beginPath(); ctx.moveTo(X(k, b0), Y(a0)); ctx.lineTo(X(k, b1), Y(a1)); ctx.stroke();
      }
    },
  };
}
