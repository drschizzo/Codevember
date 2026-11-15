// Echo — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// Le plan de la pièce de cette graine, vu de dessus comme une planche du
// Traité de la lumière de Huygens : la table, les vases, la lampe, le
// réflecteur et l'œil ; et les fronts qui partent de l'ampoule, puis leurs
// échos, tracés par les mêmes règles que la scène (source image derrière la
// glace, cône qui se referme sur le foyer, pinceaux des facettes). Le dessin
// s'encre au fil du chargement (avancement réel).
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Rien sous ~88 % de la hauteur.
export default function createArt() {
  let plan = null;
  const ink = (a) => `rgba(232, 226, 214, ${a})`;
  const warm = (a) => `rgba(255, 214, 160, ${a})`;
  return {
    data(d) { plan = d.plan ?? null; },
    draw(ctx, S) {
      if (!plan) return;
      const m = Math.min(S.w, S.h * 1.5);
      const k = m * 0.3; // (pixels par mètre)
      const cx = S.w / 2 - plan.cx * k, cy = S.h * 0.44 - plan.cz * k;
      const X = (p) => cx + p[0] * k, Y = (p) => cy + p[2] * k;
      const a0 = (1 - S.done) * Math.min(1, 0.25 + S.p * 1.2);
      ctx.save();
      ctx.lineCap = 'round';
      // la table et les vases (traits d'encre)
      ctx.strokeStyle = ink(0.6 * a0); ctx.lineWidth = 1.2 * S.dpr;
      ctx.strokeRect(X([-plan.tw / 2, 0, 0]), Y([0, 0, -plan.td / 2]), plan.tw * k, plan.td * k);
      for (const o of plan.objects) {
        ctx.beginPath(); ctx.arc(X(o), Y(o), o[3] * k, 0, Math.PI * 2);
        ctx.fillStyle = ink(0.12 * a0); ctx.fill(); ctx.stroke();
      }
      // le mur
      ctx.beginPath(); ctx.moveTo(X([-1.2, 0, 0]), Y([0, 0, plan.wz])); ctx.lineTo(X([1.2, 0, 0]), Y([0, 0, plan.wz]));
      ctx.strokeStyle = ink(0.3 * a0); ctx.stroke();
      // le réflecteur
      ctx.lineWidth = 2.2 * S.dpr; ctx.strokeStyle = ink(0.85 * a0);
      if (plan.mirror) { ctx.beginPath(); ctx.moveTo(X(plan.mirror[0]), Y(plan.mirror[0])); ctx.lineTo(X(plan.mirror[1]), Y(plan.mirror[1])); ctx.stroke(); }
      if (plan.cap) { ctx.beginPath(); plan.cap.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.stroke(); }
      if (plan.ball) { ctx.beginPath(); ctx.arc(X(plan.ball), Y(plan.ball), plan.ball[3] * k, 0, Math.PI * 2); ctx.stroke(); }
      // l'œil
      ctx.fillStyle = ink(0.7 * a0);
      ctx.beginPath(); ctx.arc(X(plan.eye), Y(plan.eye), 3 * S.dpr, 0, Math.PI * 2); ctx.fill();
      // les fronts : un nouveau toutes les 1,6 s, à 0,35 m/s (dessin), et leurs échos
      const v = 0.35, period = 1.6, life = 4.8;
      ctx.lineWidth = 1.6 * S.dpr;
      for (let n = 0; n < life / period; n++) {
        const age = ((S.t / period) % 1 + n) * period;
        const r = age * v, fade = Math.max(0, 1 - age / life) * a0;
        // direct
        ctx.strokeStyle = warm(0.75 * fade);
        ctx.beginPath(); ctx.arc(X(plan.s), Y(plan.s), r * k, 0, Math.PI * 2); ctx.stroke();
        // écho de la glace : un cercle centré sur la source image, devant la glace,
        // dans le cône qui passe par la glace
        if (plan.sv && r > plan.dm) {
          ctx.save();
          ctx.beginPath(); ctx.moveTo(X(plan.sv), Y(plan.sv));
          for (const q of plan.cone) ctx.lineTo(X(q), Y(q));
          ctx.closePath(); ctx.clip();
          ctx.strokeStyle = warm(0.9 * fade);
          ctx.beginPath(); ctx.arc(X(plan.sv), Y(plan.sv), r * k, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        // écho du miroir ardent : un arc qui se referme sur le foyer
        if (plan.f2 && r > plan.dm) {
          const rr = 2 * plan.a - r; // (chemin restant jusqu'au foyer)
          ctx.save();
          ctx.beginPath(); ctx.moveTo(X(plan.f2), Y(plan.f2));
          for (const q of plan.cone) ctx.lineTo(X(q), Y(q));
          ctx.closePath(); ctx.clip();
          ctx.strokeStyle = warm(0.95 * fade);
          if (rr > 0) { ctx.beginPath(); ctx.arc(X(plan.f2), Y(plan.f2), rr * k, 0, Math.PI * 2); ctx.stroke(); }
          ctx.restore();
          if (Math.abs(rr) < 0.03) { ctx.fillStyle = warm(fade); ctx.beginPath(); ctx.arc(X(plan.f2), Y(plan.f2), 4 * S.dpr, 0, Math.PI * 2); ctx.fill(); }
        }
        // pinceaux de la boule : de courts traits qui partent de la boule
        if (plan.ball && r > plan.dm) {
          ctx.strokeStyle = warm(0.8 * fade);
          const rb = r - plan.dm;
          for (let i = 0; i < 28; i++) {
            const an = (i / 28) * Math.PI * 2 + 0.37 * i;
            ctx.beginPath();
            ctx.moveTo(X(plan.ball) + Math.cos(an) * Math.max(0, rb - 0.06) * k, Y(plan.ball) + Math.sin(an) * Math.max(0, rb - 0.06) * k);
            ctx.lineTo(X(plan.ball) + Math.cos(an) * rb * k, Y(plan.ball) + Math.sin(an) * rb * k);
            ctx.stroke();
          }
        }
      }
      // la lampe
      ctx.fillStyle = warm(a0);
      ctx.beginPath(); ctx.arc(X(plan.s), Y(plan.s), 4 * S.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  };
}
