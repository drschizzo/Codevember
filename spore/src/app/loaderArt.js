// Spore — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le plasmodium de la scène pousse en direct, calculé ici même par le vrai
// modèle (gen/plasmodium.js), en plus petit : les spores de la graine tombent
// et germent, le front s'étend depuis elles, et le réseau de Tero s'organise
// derrière lui — les veines utiles s'épaississent, les autres s'effacent. Un
// pas de Kirchhoff par image (quelques millisecondes). Quand la scène est
// prête, le réseau se vide en perles, et le dessin s'efface.
import { seedsOf, arrivalField, buildGraph, networkSteps, sampleT, territoryOf, S0, S1 } from '../gen/plasmodium.js';

export default function createArt() {
  let st = null, id = 0;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  function setup(d) {
    const P = { ...d.P, festoon: d.P.festoon };
    const seeds = seedsOf(P, P.seed);
    const F = arrivalField(P, d.L, seeds);
    const live = seeds.filter((g) => sampleT(F, g.x, g.z) < 0.3);
    const Gr = buildGraph(P, F, 0.075, `${P.seed}:loader`);
    const gen = networkSteps(P, Gr, live, { steps: 110, seed: `${P.seed}:loader`, snaps: false });
    // un calque du front (rempli à mesure qu'il avance)
    const Tr = territoryOf(P);
    return { P, F, Gr, gen, seeds: live, Tr, s: S0, D: null, act: null, col: hex(d.color || '#f2df9a'), done: false, beads: null, t0: 0 };
  }

  return {
    data(d) { id++; try { st = setup(d); } catch (e) { st = null; } },
    draw(ctx, S) {
      const { w, h, t, dpr } = S;
      if (!st) return;
      // le modèle avance avec le chargement réel (jamais plus de ~3 ms par
      // image) : à la fin du chargement, le réseau est fait
      const target = S0 + (S1 - S0) * Math.min(1, 0.06 + S.p * 1.15 + S.done);
      if (!st.done && st.s < target) {
        const t0 = performance.now();
        do {
          const r = st.gen.next();
          if (r.done) { st.done = true; break; }
          st.s = r.value.s; st.D = r.value.D; st.act = r.value.active;
        } while (performance.now() - t0 < 3 && st.s < target);
      }
      const { Tr, Gr, F } = st;
      const m = Math.min(w, h * 1.6), sc = (m * 0.36) / Tr.rx, cx = w / 2 - Tr.cx * sc, cy = h * 0.45 - Tr.cz * sc;
      const X = (x) => cx + x * sc, Y = (z) => cy + z * sc;
      const alpha = 1 - S.done;
      const [r, g, b] = st.col;
      ctx.globalAlpha = alpha;
      // le bois : un fil très sombre
      ctx.strokeStyle = 'rgba(255, 240, 220, 0.035)';
      ctx.lineWidth = dpr;
      for (let k = -14; k <= 14; k++) { const y = Y(k * 0.09 + 0.02 * Math.sin(k * 7.1)); ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w * 0.3, y + 4 * dpr * Math.sin(k), w * 0.7, y - 4 * dpr * Math.cos(k), w, y); ctx.stroke(); }
      // les spores qui tombent, puis germent (au début)
      const fall = Math.min(1, t / 1.2);
      for (const q of st.seeds) {
        const yy = Y(q.z) - (1 - fall) * h * 0.25;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.9})`;
        ctx.beginPath(); ctx.arc(X(q.x), yy, 1.6 * dpr, 0, Math.PI * 2); ctx.fill();
      }
      // le front : la nappe là où T ≤ s (échantillonnée en points)
      const s = st.s, step = Math.max(3 * dpr, sc * 0.03);
      for (let py = Y(Tr.z0); py < Y(Tr.z1); py += step) {
        for (let px = X(Tr.x0); px < X(Tr.x1); px += step) {
          const T = sampleT(F, (px - cx) / sc, (py - cy) / sc);
          if (T > s) continue;
          const age = s - T, a = age < 0.03 ? 0.42 : Math.max(0.05, 0.42 - (age - 0.03) * 5);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a * 0.55})`;
          ctx.fillRect(px - step / 2, py - step / 2, step, step);
        }
      }
      // les veines : épaisseur ∝ D^¼ (Poiseuille)
      if (st.D) {
        let Dm = 1e-9; for (let k = 0; k < Gr.m; k++) Dm = Math.max(Dm, st.D[k]);
        ctx.lineCap = 'round';
        for (let k = 0; k < Gr.m; k++) {
          const Dk = st.D[k] / Dm; if (Dk < 0.02) continue;
          const a = Gr.ea[k], bb = Gr.eb[k];
          const wv = Math.max(0.6, 4.2 * Dk ** 0.25) * dpr * (1 - 0.8 * S.done);
          ctx.strokeStyle = `rgba(${Math.min(255, r + 20)}, ${Math.min(255, g + 15)}, ${b}, ${Math.min(0.95, 0.25 + Dk ** 0.25)})`;
          ctx.lineWidth = wv;
          ctx.beginPath(); ctx.moveTo(X(Gr.x[a]), Y(Gr.z[a])); ctx.lineTo(X(Gr.x[bb]), Y(Gr.z[bb])); ctx.stroke();
        }
        // la fin : le réseau se vide en perles (les nœuds les plus chargés)
        if (S.done > 0 || st.done) {
          if (!st.beads) {
            const load = new Float64Array(Gr.n);
            for (let k = 0; k < Gr.m; k++) { const v = (st.D[k] / Dm) ** 0.5; load[Gr.ea[k]] += v; load[Gr.eb[k]] += v; }
            st.beads = [...Array(Gr.n).keys()].filter((i) => load[i] > 1.4 && (i * 7919) % 5 === 0).slice(0, 90);
          }
          const k = Math.min(1, S.done * 2 + (st.done ? 0.25 : 0));
          for (const i of st.beads) {
            ctx.fillStyle = `rgba(${Math.min(255, r + 25)}, ${Math.min(255, g + 20)}, ${Math.min(255, b + 20)}, 0.9)`;
            ctx.beginPath(); ctx.arc(X(Gr.x[i]), Y(Gr.z[i]), (1 + 2.6 * k) * dpr, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
