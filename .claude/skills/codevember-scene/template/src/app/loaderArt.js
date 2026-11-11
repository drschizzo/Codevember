// {{TITLE}} — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// À RÉÉCRIRE pour le thème : montrer le calcul ou le sujet de la scène (Melt :
// le cristal de la graine qui pousse ; Orrery : la recherche d'orbite), à
// partir de ce que main.js envoie par loader.art(). Ici, un gabarit : des
// points tirés de la graine qui se rassemblent en anneau au fil du chargement.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S), step?(S), end?(S) } ;
// S = { w, h, dpr, t, dt, p (avancement 0–1), step, stepIdx, done (0 → 1
// pendant le fondu final), error, lite }. Pas de texte, rien sous ~88 % de la
// hauteur (le nom et le fil d'avancement), < 3 ms par image.
export default function createArt() {
  let pts = [];
  const seedPts = (seed) => {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    pts = Array.from({ length: 120 }, (_, i) => ({ a: (i / 120) * Math.PI * 2, r: 0.2 + rnd() * 0.8, b: rnd() * Math.PI * 2 }));
  };
  seedPts('');
  return {
    data(d) { seedPts(d.seed ?? ''); },
    draw(ctx, S) {
      const m = Math.min(S.w, S.h), cx = S.w / 2, cy = S.h * 0.46, R = m * 0.2 * (1 + 0.3 * S.done);
      const k = Math.min(1, S.p * 1.2);
      ctx.globalAlpha = 1 - S.done;
      ctx.fillStyle = 'rgba(236, 226, 210, 0.8)';
      for (const q of pts) {
        const a = q.a + S.t * 0.15, r = R * (k + (1 - k) * q.r * (0.7 + 0.3 * Math.sin(S.t + q.b)));
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.4 * S.dpr, 0, Math.PI * 2); ctx.fill();
      }
    },
  };
}
