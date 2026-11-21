// Magma — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// L'arbre des orteils de cette graine, calculé ici par le même code que la
// scène (gen/toes.js), vu de dessus : chaque orteil apparaît à son instant
// réel d'arrivée, son front avance du col au nez, et sa couleur suit la vraie
// courbe de refroidissement de sa surface (gen/cooling.js) à travers la loi de
// Planck (gen/planck.js) : jaune au front, orange, rouge sombre, puis le gris
// argenté de la croûte froide. Le chargement avance le temps physique de la
// coulée ; à la fin, tout le champ est couvert.
import { growTree, STRIDE, halfWidth } from '../gen/toes.js';
import { solveCooling, coolAt } from '../gen/cooling.js';
import { blackbodyXYZ, xyzToRgb } from '../gen/planck.js';

// couleur affichée d'une surface à la température T (K) : radiance, exposée
// pour la nuit, puis une courbe douce ; la croûte froide garde un gris bleuté
const glow = (() => {
  const tab = [];
  for (let T = 700; T <= 1450; T += 10) {
    const rgb = xyzToRgb(blackbodyXYZ(T, 0.95)).map((v) => v / 1000 * 2.2);
    tab.push(rgb.map((v) => 1 - Math.exp(-v)));
  }
  return (T) => { const x = Math.min(tab.length - 1, Math.max(0, (T - 700) / 10)); const i = Math.floor(x), f = x - i, a = tab[i], b = tab[Math.min(tab.length - 1, i + 1)]; return a.map((v, k) => v + (b[k] - v) * f); };
})();

export default function createArt() {
  let tree = null, cool = null, tFlow = 1, order = [], box = null;
  let pending = null;
  const build = (d) => {
    try {
      tree = growTree({ seed: d.seed, ...d.toes });
      cool = cool ?? solveCooling({}, 128);
      tFlow = 1;
      order = [];
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < tree.n; k++) {
        const o = k * STRIDE, T = tree.T; tFlow = Math.max(tFlow, T[o + 8] + T[o + 9]); order.push(k);
        // emprise de l'arbre (axe de chaque orteil, élargi de sa demi-largeur)
        const c0 = Math.cos(T[o + 2]), s0 = Math.sin(T[o + 2]);
        for (let s = 0; s <= T[o + 4]; s += 0.1) {
          const vv = 0.5 * T[o + 3] * s * s, x = T[o] + s * c0 - vv * s0, z = T[o + 1] + s * s0 + vv * c0, r = halfWidth(T, k, s);
          box[0] = Math.min(box[0], x - r); box[1] = Math.min(box[1], z - r); box[2] = Math.max(box[2], x + r); box[3] = Math.max(box[3], z + r);
        }
      }
      // (le champ vu par la caméra suffit : on borne l'emprise au champ)
      box = [Math.max(box[0], -tree.F), Math.max(box[1], -tree.F), Math.min(box[2], tree.F), Math.min(box[3], tree.F)];
    } catch { tree = null; }
  };
  return {
    data(d) { if (d?.toes) pending = d; },
    draw(ctx, S) {
      if (pending) { build(pending); pending = null; }
      if (!tree) return;
      // l'arbre cadré dans 80 % de la largeur et 72 % de la hauteur, au-dessus de la barre
      const bw = box[2] - box[0], bh = box[3] - box[1];
      const sc = Math.min(S.w * 0.8 / bw, S.h * 0.72 / bh);
      const cx = S.w / 2 - (box[0] + bw / 2) * sc, cy = S.h * 0.45 - (box[1] + bh / 2) * sc;
      // temps physique de la coulée montré : suit l'avancement, ne s'arrête jamais
      const t = tFlow * Math.min(1.25, S.p * 1.1 + S.t * 0.004) + S.done * 400;
      ctx.save();
      ctx.globalAlpha = 1 - S.done * 0.85;
      ctx.lineCap = 'round';
      const T = tree.T;
      for (const k of order) {
        const o = k * STRIDE, t0 = T[o + 8];
        if (t < t0) continue;
        const L = T[o + 4], frac = Math.min(1, (t - t0) / T[o + 9]);
        const len = L * (1 - (1 - frac) ** 1.6);
        const age = t - t0, Ts = coolAt(cool, Math.max(0.05, age * 0.5 + 0.05));
        const c = glow(Ts);
        const grey = Math.min(1, Math.max(0, (age - 60) / 400));
        const col = c.map((v, i) => Math.round(255 * (v * (1 - grey) + [0.36, 0.37, 0.4][i] * grey * 0.9 + 0.05)));
        // l'orteil : une suite de disques le long de l'axe courbe
        const c0 = Math.cos(T[o + 2]), s0 = Math.sin(T[o + 2]);
        // (un liseré sombre sous chaque orteil : les lobes se lisent l'un sur l'autre)
        for (const [pad, fill] of [[1.6, 'rgba(5,5,6,0.55)'], [0, `rgb(${col[0]},${col[1]},${col[2]})`]]) {
          ctx.fillStyle = fill;
          ctx.beginPath();
          for (let s = 0; s <= len; s += 0.03) {
            const vv = 0.5 * T[o + 3] * s * s, x = T[o] + s * c0 - vv * s0, z = T[o + 1] + s * s0 + vv * c0;
            const r = halfWidth(T, k, s) * sc * 0.92 + pad;
            ctx.moveTo(cx + x * sc + r, cy + z * sc);
            ctx.arc(cx + x * sc, cy + z * sc, r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };
}
