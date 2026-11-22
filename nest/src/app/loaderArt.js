// Nest — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le nid de cette graine en coupe, comme un nid scié de muséum : sous la
// poutre, les cloches emboîtées (mêmes proportions, même famille que la scène)
// se tracent bande après bande, de l'attache vers le trou de vol, chaque bande
// de la couleur d'une source du village (les volets, les bancs, les portes).
// Le chargement avance la saison : une cloche se ferme, la suivante la
// recouvre. Le dessin ne s'arrête jamais (les bandes fraîches sèchent).
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p (avancement 0–1), done (0 → 1 pendant le fondu), … }. Rien sous ~88 %
// de la hauteur, < 3 ms par image.
const LAM = [0.17, 0.3, 0.46, 0.63, 0.82, 1.0];

export default function createArt() {
  let D = { seed: '', palette: ['#bdb5a5', '#776d60', '#6f86b8'], a: 1.25, b: 1.45, topK: 1, yBeam: 1.25 };
  let strips = [];
  const hashOf = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const build = () => {
    let h = hashOf(D.seed) || 1;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    strips = [];
    LAM.forEach((lam, k) => {
      // une cloche : une dizaine de bandes, chacune un peu plus loin que la précédente
      const n = 14 + Math.round(lam * 18);
      for (let i = 0; i < n; i++) strips.push({ k, lam, off: i / n, col: D.palette[Math.floor(rnd() * D.palette.length)], w: 0.6 + rnd() * 0.8, j: rnd() });
    });
  };
  build();
  // profil d'une cloche (moitié droite) : de l'attache (sous la poutre) au trou de vol
  const profile = (lam, r, q) => {
    const flat = Math.min(1, Math.max(0, (lam - 0.25) / 0.65)) * D.topK;
    const a = D.a * lam * r, b = D.b * lam * r;
    const yTop = b * (0.985 - (0.985 - D.yBeam / D.b) * flat);
    const th0 = Math.acos(Math.min(1, yTop / b)), th = th0 + (Math.PI - 0.12 / Math.sqrt(lam) - th0) * q;
    const top = 2 + 1.2 * flat;
    const s = Math.sin(th), c = Math.cos(th);
    let rr = 1 / Math.sqrt((s * s) / (a * a) + (c * c) / (b * b));
    if (c > 0) for (let i = 0; i < 6; i++) { const u = (rr * c) / b, f = (rr * rr * s * s) / (a * a) + u ** top - 1, df = (2 * rr * s * s) / (a * a) + (top * u ** (top - 1) * c) / b; rr -= f / df; }
    return [rr * s, D.yBeam - yTop + rr * c];
  };
  return {
    data(d) { if (d?.palette) { D = { ...D, ...d }; build(); } },
    draw(ctx, S) {
      const sc = Math.min(S.w * 0.3 / (D.a * 1.2), S.h * 0.7 / (D.b * 2.05)), cx = S.w / 2, cy = S.h * 0.1;
      const X = (x) => cx + x * sc, Y = (y) => cy + (D.yBeam - y) * sc;
      ctx.save();
      ctx.globalAlpha = 1 - S.done * 0.85;
      // la poutre
      ctx.fillStyle = 'rgba(150, 142, 130, 0.35)';
      ctx.fillRect(S.w * 0.18, cy - 0.16 * sc, S.w * 0.64, 0.16 * sc);
      // la saison : l'avancement du chargement, puis une lente respiration
      const season = Math.min(1, S.p * 1.05) * LAM.length + Math.min(0.4, S.t * 0.01);
      ctx.lineCap = 'round';
      for (const st of strips) {
        const g = Math.min(1, Math.max(0, (season - st.k - st.off * 0.85) / 0.35));
        if (g <= 0) continue;
        // une cloche recouverte par la suivante s'efface (rongée de l'intérieur)
        const fadeOut = Math.min(1, Math.max(0, season - st.k - 1.6));
        const r = 1 + st.off * 0.07 / Math.sqrt(st.lam);
        ctx.strokeStyle = st.col;
        ctx.globalAlpha = (1 - S.done * 0.85) * (1 - fadeOut * 0.7) * (0.55 + 0.45 * st.w);
        ctx.lineWidth = Math.max(1, 2.2 * st.w * S.dpr);
        // fraîche : plus sombre au front (la pâte humide)
        for (const side of [1, -1]) {
          ctx.beginPath();
          const N = 48;
          for (let i = 0; i <= N * g; i++) {
            const [x, y] = profile(st.lam, r, i / N);
            // (le bord des écailles : des festons, plus marqués sur la bande du dehors)
            const wob = (0.004 + 0.014 * st.off) * Math.abs(Math.sin(i * 0.55 * (1 + st.lam) + st.j * 3));
            i ? ctx.lineTo(X(side * (x + wob)), Y(y)) : ctx.moveTo(X(side * (x + wob)), Y(y));
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}
