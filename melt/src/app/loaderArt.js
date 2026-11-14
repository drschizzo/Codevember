// Melt — dessin de l'écran de chargement (dans le worker de loaderWorker.js) :
// la simulation du lac, en direct. Le profil de la glace que le worker calcule
// (gen/lake.js), dessiné en silhouette avec son reflet dans la surface, et la
// saison qui tourne (un arc qui suit la phase, chaud l'été, froid l'hiver).
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; pas de texte, rien
// sous ~88 % de la hauteur, < 3 ms par image.
export default function createArt() {
  let prof = null, target = null, u = 0, T = 4, T0 = 1.5, T1 = 9, a = 0.014;
  return {
    data(d) {
      if (d.T0 != null) { T0 = d.T0; T1 = d.T1; a = d.a ?? a; }
      if (d.prof) { target = d.prof; if (!prof || prof.length !== target.length) prof = target.slice(); u = d.u ?? u; T = d.T ?? T; }
      if (d.seed != null && !d.prof) { prof = null; target = null; }
    },
    draw(ctx, S) {
      const W = S.w, H = S.h, cx = W / 2, y0 = H * 0.36; // la surface
      const scale = (H * 0.46) / 0.16; // 16 cm de domaine sur 46 % de la hauteur
      ctx.globalAlpha = 1 - S.done;
      // la surface
      ctx.strokeStyle = 'rgba(200, 214, 230, 0.35)'; ctx.lineWidth = 1 * S.dpr;
      ctx.beginPath(); ctx.moveTo(cx - W * 0.22, y0); ctx.lineTo(cx + W * 0.22, y0); ctx.stroke();
      // la saison
      const w = (T - T0) / Math.max(0.1, T1 - T0);
      ctx.strokeStyle = `rgba(${Math.round(150 + 105 * w)}, ${Math.round(190 + 30 * w)}, ${Math.round(255 - 120 * w)}, 0.7)`;
      ctx.lineWidth = 2 * S.dpr;
      ctx.beginPath(); ctx.arc(cx, y0, H * 0.3, Math.PI * 1.08, Math.PI * (1.08 + 0.84 * u)); ctx.stroke();
      if (!target) {
        // avant le premier relevé : la colonne neuve, qui respire
        const r = a * scale * (0.95 + 0.05 * Math.sin(S.t * 2));
        ctx.fillStyle = 'rgba(236, 242, 250, 0.85)';
        ctx.fillRect(cx - r, y0, 2 * r, H * 0.08);
        ctx.globalAlpha *= 0.35; ctx.fillRect(cx - r, y0 - H * 0.08, 2 * r, H * 0.08);
        return;
      }
      for (let j = 0; j < prof.length; j++) prof[j] += (target[j] - prof[j]) * 0.25;
      const n = prof.length, dz = (0.16 / n) * scale;
      for (const [dir, alpha] of [[1, 0.9], [-1, 0.3]]) { // la glace, puis son reflet
        ctx.fillStyle = `rgba(236, 242, 250, ${alpha})`;
        ctx.beginPath();
        let started = false;
        for (let j = n - 1; j >= 0; j--) {
          const r = prof[j] * 1e-3 * scale, y = y0 + dir * (n - 1 - j) * dz;
          if (!started) { ctx.moveTo(cx - r, y); started = true; } else ctx.lineTo(cx - r, y);
        }
        for (let j = 0; j < n; j++) { const r = prof[j] * 1e-3 * scale, y = y0 + dir * (n - 1 - j) * dz; ctx.lineTo(cx + r, y); }
        ctx.closePath(); ctx.fill();
      }
    },
  };
}
