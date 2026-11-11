// Mirage — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le mirascope en coupe, et le calcul lui-même : des rayons partent d'un
// point de l'objet au fond, se réfléchissent sur la coupe du haut, puis sur
// celle du bas, et se croisent au-dessus de l'ouverture — là où l'image réelle
// se forme (le même module que les tests, gen/mirascope.js). Les rayons
// arrivent au fil du chargement ; ensuite le couvercle se lève et se repose
// sans fin, et le point de croisement descend dans la cavité et se défait.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
import { traceCavity, PARAB } from '../gen/mirascope.js';

export default function createArt() {
  let f = 0.05, liftMax = 0.03;
  return {
    data(d) { f = d.f ?? 0.05; liftMax = d.liftMax ?? 0.03; },
    draw(ctx, S) {
      const { w, h, dpr } = S, fade = 1 - S.done;
      const R = PARAB.rimK * f, rh = PARAB.holeK * f;
      const L = liftMax * Math.max(0, Math.sin(S.t * 0.5)) ** 2;
      const sc = Math.min(w / (2.6 * R), (h * 0.6) / (f + liftMax + 0.04)), cx = w / 2, cy = h * 0.72;
      const X = (x) => cx + x * sc, Y = (y) => cy - y * sc;
      ctx.globalAlpha = fade;
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = 'rgba(236, 226, 210, 0.85)';
      // les deux coupes en coupe
      for (const side of [-1, 1]) {
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) { const r = (R * k) / 40, y = (r * r) / (4 * f); k ? ctx.lineTo(X(side * r), Y(y)) : ctx.moveTo(X(side * r), Y(y)); }
        ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) { const r = rh + ((R - rh) * k) / 40, y = f + L - (r * r) / (4 * f); k ? ctx.lineTo(X(side * r), Y(y)) : ctx.moveTo(X(side * r), Y(y)); }
        ctx.stroke();
      }
      // l'objet (un point lumineux au fond) et ses rayons : ceux qui sortent
      // par l'ouverture après deux réflexions (or) se croisent au-dessus d'elle,
      // là où l'image se forme ; couvercle levé, ils se font rares
      const P = [0.006, 0.004, 0];
      const NR = 26, n = Math.ceil(NR * Math.min(1, S.p * 1.15));
      let cx2 = 0, cy2 = 0, k2 = 0;
      for (let i = 0; i < n; i++) {
        const a = -1.25 + (2.5 * (i + 0.5)) / NR, dir = [Math.sin(a), Math.cos(a), 0];
        const res = traceCavity(P, dir, f, L, 6);
        const good = res.fate === 'sortie' && res.bounces === 2 && res.dir[1] > 0;
        if (!good && res.bounces > 2) continue; // (les rayons piégés : on ne les dessine pas)
        const ext = good ? Math.min(0.06, Math.max(0.01, (f + P[1] + 0.014 - res.p[1]) / Math.max(res.dir[1], 0.2))) : 0.02; // (jusqu'au-delà du croisement)
        const pts = res.path.concat(res.fate === 'sortie' ? [[res.p[0] + res.dir[0] * ext, res.p[1] + res.dir[1] * ext, 0]] : []);
        ctx.lineWidth = (good ? 1.4 : 1) * dpr;
        ctx.strokeStyle = good ? 'rgba(240, 206, 150, 0.55)' : 'rgba(150, 180, 220, 0.16)';
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        if (good) { // (point de l'axe du rayon sortant le plus proche de l'image théorique)
          const t = ((-P[0] - res.p[0]) * res.dir[0] + (f + P[1] - res.p[1]) * res.dir[1]);
          cx2 += res.p[0] + res.dir[0] * t; cy2 += res.p[1] + res.dir[1] * t; k2++;
        }
      }
      ctx.fillStyle = 'rgba(240, 214, 170, 0.95)';
      ctx.beginPath(); ctx.arc(X(P[0]), Y(P[1]), 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
      // l'image : un point qui s'allume là où les rayons se croisent, et pâlit
      // quand ils se font rares
      if (k2) {
        ctx.globalAlpha = fade * Math.min(1, k2 / 12);
        ctx.fillStyle = 'rgba(255, 236, 200, 0.95)';
        ctx.beginPath(); ctx.arc(X(cx2 / k2), Y(cy2 / k2), 4 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = fade;
      }
    },
  };
}
