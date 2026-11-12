// Mirage — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// La mise en abyme en coupe, et le calcul lui-même : le mirascope, au fond le
// petit, au fond du petit un plus petit encore. Des rayons partent du dôme du
// petit, se réfléchissent sur la coupe du haut, puis sur celle du bas, et se
// croisent au-dessus de l'ouverture — là où l'image du petit se forme, tournée
// d'un demi-tour (le même module que les tests, gen/mirascope.js). Les rayons
// arrivent au fil du chargement ; l'image du petit se dessine à leur
// croisement ; puis le dessin plonge lentement vers elle, sans fin.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
import { traceCavity, PARAB } from '../gen/mirascope.js';
import { K, MINI, TABLE_Y } from '../gen/abyme.js';

export default function createArt() {
  let f = 0.05;
  // profil d'un mirascope (repère du niveau) : les deux coupes et le pied
  const R0 = PARAB.rimK * 0.05, RH = PARAB.holeK * 0.05;
  const cut = (ctx, X, Y, s, ox, oy, flip, alpha) => {
    const P = (r, y) => [X(ox + flip * r * s), Y(oy + y * s)];
    ctx.globalAlpha = alpha;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let k = 0; k <= 32; k++) { const r = (R0 * k) / 32, [x, y] = P(side * r, (r * r) / (4 * f)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k <= 32; k++) { const r = RH + ((R0 - RH) * k) / 32, [x, y] = P(side * r, f - (r * r) / (4 * f)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    // le pied (seulement le petit : le grand est sur sa machinerie)
    ctx.beginPath();
    const a = P(-0.0105, 0.0004), b = P(-0.0105, TABLE_Y + 0.004), c = P(-0.028, TABLE_Y + 0.004), d = P(-0.028, TABLE_Y), e = P(0.028, TABLE_Y), g = P(0.028, TABLE_Y + 0.004), h = P(0.0105, TABLE_Y + 0.004), i = P(0.0105, 0.0004);
    [a, b, c, d, e, g, h, i].forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  return {
    data(d) { f = d.f ?? 0.05; },
    draw(ctx, S) {
      const { w, h, dpr } = S, fade = 1 - S.done;
      // la plongée : on s'approche de l'image du petit, sans fin — autour du
      // point fixe de la chaîne (y* = (f + MINI.y) / (1 − K) : l'image du petit
      // est le grand réduit de K autour de lui) ; un niveau toutes les 14 s, et
      // au bout le dessin est celui du début (miroir près : le dessin est
      // symétrique, et les rayons s'effacent pendant la plongée)
      const ph = (S.t / 14) % 1, q = ph * ph * (3 - 2 * ph), z = Math.pow(1 / K, q);
      const imgY = f + MINI.y + K * 0.026, ys = (f + MINI.y) / (1 - K);
      const sc0 = Math.min(w / (2.8 * R0), (h * 0.6) / (f + 0.05)), cx = w / 2, cy = h * 0.66;
      const X = (x) => cx + x * sc0 * z, Y = (y) => cy - (y - ys) * sc0 * z - ys * sc0;
      const rays = 1 - q;
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = 'rgba(236, 226, 210, 0.85)';
      // le grand, le petit au fond, le plus petit au fond du petit
      cut(ctx, X, Y, 1, 0, 0, 1, fade);
      cut(ctx, X, Y, K, 0, MINI.y, 1, fade);
      cut(ctx, X, Y, K * K, 0, MINI.y + K * MINI.y, 1, fade * 0.8);
      // les rayons : d'un point du dôme du petit (de côté), deux réflexions,
      // croisement au-dessus de l'ouverture
      const P = [K * 0.03, MINI.y + K * (f - (0.03 * 0.03) / (4 * f) + 0.0025), 0];
      const NR = 22, n = Math.ceil(NR * Math.min(1, S.p * 1.15));
      let sx = 0, sy = 0, k2 = 0;
      ctx.lineWidth = 1.2 * dpr;
      for (let i = 0; i < n; i++) {
        const a = -1.1 + (2.2 * (i + 0.5)) / NR, dir = [Math.sin(a), Math.cos(a), 0];
        const res = traceCavity(P, dir, f, 0, 6);
        const good = res.fate === 'sortie' && res.bounces === 2 && res.dir[1] > 0;
        if (!good) continue;
        const ext = Math.min(0.09, Math.max(0.008, (imgY + 0.008 - res.p[1]) / Math.max(res.dir[1], 0.2)));
        const pts = res.path.concat([[res.p[0] + res.dir[0] * ext, res.p[1] + res.dir[1] * ext, 0]]);
        ctx.globalAlpha = fade * 0.55 * rays;
        ctx.strokeStyle = 'rgba(240, 206, 150, 1)';
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        const t = (-P[0] - res.p[0]) * res.dir[0] + (f + P[1] - res.p[1]) * res.dir[1];
        sx += res.p[0] + res.dir[0] * t; sy += res.p[1] + res.dir[1] * t; k2++;
      }
      ctx.fillStyle = 'rgba(240, 214, 170, 0.95)';
      ctx.globalAlpha = fade * rays;
      ctx.beginPath(); ctx.arc(X(P[0]), Y(P[1]), 2.6 * dpr, 0, Math.PI * 2); ctx.fill();
      // l'image du petit, là où les rayons se croisent : un petit mirascope en
      // or pâle, tourné d'un demi-tour, qui s'allume avec ses rayons
      if (k2) {
        const ix = sx / k2, iy = sy / k2;
        ctx.globalAlpha = fade * rays;
        ctx.beginPath(); ctx.arc(X(ix), Y(iy), 3 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 226, 180, 1)';
        ctx.lineWidth = 1.2 * dpr;
        cut(ctx, X, Y, K, 0, f + MINI.y, -1, fade * Math.min(1, k2 / 14) * (0.7 + 0.3 * q));
        cut(ctx, X, Y, K * K, 0, f + MINI.y + K * (f + MINI.y), 1, fade * Math.min(1, k2 / 14) * 0.6);
      }
      ctx.globalAlpha = 1;
    },
  };
}
