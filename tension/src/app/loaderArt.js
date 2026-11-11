// Tension — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Pendant que le worker de génération cherche l'allure et le cycle limite, on
// regarde la structure de la graine SE TENDRE : la même topologie (barres
// rigides, câbles unilatéraux) part d'un tas de barres en désordre, câbles
// lâches, et une petite relaxation (gen/sim.js, sans gravité) tire les câbles
// jusqu'à la forme précontrainte — le prisme se tord, la chaîne s'aligne, la
// roue s'arrondit. Quand le pas est calculé, sa chronophotographie (à la
// Marey : poses successives de profil, en traits fins) se dessine par-dessus.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p (avancement 0–1), step, done (0 → 1 pendant le fondu), lite }.
import { buildTopology } from '../gen/topology.js';
import { createSim } from '../gen/sim.js';

export default function createArt() {
  let sim = null, T = null, seedHash = 1, chrono = null, chronoT = 0, spec = null, debugSend = null, sent = false;

  const hashOf = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const rnd = () => ((seedHash = Math.imul(seedHash ^ (seedHash >>> 15), 2246822507) ^ Math.imul(seedHash ^ (seedHash >>> 13), 3266489909)) >>> 0) / 4294967296;

  function start(d) {
    spec = d.sim;
    seedHash = hashOf(d.seed) || 1;
    T = buildTopology(spec);
    // désordre de départ : les nœuds jetés autour de leur place, câbles lâches
    // (la roue garde à peu près son cercle : ses barres sont articulées aux nœuds)
    const k0 = T.family === 'cerceau' ? 0.85 : 0.55, sc = T.family === 'cerceau' ? 0.35 : 0.7;
    const nodes = T.nodes.map((n) => ({ ...n, p: n.p.map((v) => v * k0 + (rnd() - 0.5) * sc) }));
    const T2 = { ...T, nodes, bars: T.bars.map((b) => ({ ...b, L: Math.hypot(...[0, 1, 2].map((a) => T.nodes[b.i].p[a] - T.nodes[b.j].p[a])) })) };
    sim = createSim(T2, { gravity: 0, floor: false, damp: 3, h: 1 / 2000, struct: 0, inner: 20 });
    // les câbles se tendent progressivement (la bobine enroule)
    sim.cables.forEach((c, i) => { c.target = Math.hypot(...[0, 1, 2].map((a) => T.nodes[T.cables[i].i].p[a] - T.nodes[T.cables[i].j].p[a])) * 0.96; c.rest = c.L0 * 1.35; });
    chrono = null; chronoT = 0;
  }

  return {
    data(d) {
      if (d.debugSend) { debugSend = d.debugSend; sent = false; return; } // (?debug : une image du dessin vers le collecteur, pour la vignette de l'accueil)
      if (d.chrono) { chrono = d.chrono; chronoT = 0; return; }
      if (d.sim) start(d);
    },
    draw(ctx, S) {
      const m = Math.min(S.w, S.h), cx = S.w / 2, cy = S.h * 0.44;
      ctx.globalAlpha = 1 - S.done;
      const ink = 'rgba(236, 228, 214, ';
      if (sim) {
        // quelques pas de relaxation par image ; la longueur au repos tend vers la cible
        const k = Math.min(1, S.dt * 1.2);
        sim.cables.forEach((c) => { c.rest += (c.target - c.rest) * k * 0.6; });
        sim.run(Math.min(0.05, S.dt * 0.8));
        // projection : la structure tourne lentement, vue un peu d'en haut
        const yaw = S.t * 0.22 + 0.4, pit = 0.42;
        const c0 = sim.com();
        const span = T.family === 'chenille' ? 6 : T.family === 'cerceau' ? 3.3 : 2.4;
        const sc = (m * (chrono ? 0.16 : 0.3)) / span;
        const oy = chrono ? -m * 0.2 : 0;
        const proj = (i) => {
          let x = sim.x[i * 3] - c0[0], y = sim.x[i * 3 + 1] - c0[1], z = sim.x[i * 3 + 2] - c0[2];
          const X = Math.cos(yaw) * x + Math.sin(yaw) * z, Z = -Math.sin(yaw) * x + Math.cos(yaw) * z;
          const Y = Math.cos(pit) * y - Math.sin(pit) * Z;
          return [cx + X * sc, cy + oy - Y * sc];
        };
        const P = T.nodes.map((_, i) => proj(i));
        // câbles : trait fin ; tendus = plus clairs
        ctx.lineCap = 'round';
        sim.cables.forEach((c) => {
          const a = P[c.i], b = P[c.j];
          const d = Math.hypot(...[0, 1, 2].map((q) => sim.x[c.i * 3 + q] - sim.x[c.j * 3 + q]));
          const taut = Math.max(0, Math.min(1, (d - c.rest) / (0.02 * c.rest) + 0.5));
          ctx.strokeStyle = `${ink}${0.18 + 0.45 * taut})`;
          ctx.lineWidth = 0.8 * S.dpr;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]);
          if (d < c.rest) { // (mou : il pend un peu, à l'écran)
            const sag = Math.min(0.25, Math.sqrt(Math.max(0, 3 * d * (c.rest - d) / 8))) * sc;
            ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag * 2, b[0], b[1]);
          } else ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        });
        // barres : trait épais, embouts
        ctx.strokeStyle = `${ink}0.92)`;
        ctx.lineWidth = 2.6 * S.dpr;
        for (const b of sim.bars) { const a = P[b.i], q = P[b.j]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
        ctx.fillStyle = 'rgba(232, 196, 138, 0.95)';
        for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 2.4 * S.dpr, 0, Math.PI * 2); ctx.fill(); }
      }
      if (chrono) {
        // chronophotographie : les poses du pas, de profil, de gauche à droite
        chronoT += S.dt;
        const K = chrono.poses.length;
        let xmin = Infinity, xmax = -Infinity, ymax = 0;
        for (const q of chrono.poses) for (let i = 0; i < q.length; i += 2) { xmin = Math.min(xmin, q[i]); xmax = Math.max(xmax, q[i]); ymax = Math.max(ymax, q[i + 1]); }
        const W = Math.min(S.w * 0.84, m * 1.6), sc = W / Math.max(1e-3, xmax - xmin), base = S.h * 0.78;
        const x0 = (S.w - W) / 2;
        const shown = Math.min(K, Math.floor(chronoT * 14) + 1);
        ctx.lineCap = 'round';
        for (let k = 0; k < shown; k++) {
          const q = chrono.poses[k], al = k === shown - 1 ? 0.9 : 0.1 + 0.45 * (k / Math.max(1, shown - 1)) ** 1.5; // (les poses anciennes s'effacent : on lit le sens du mouvement)
          const X = (i) => x0 + (q[i * 2] - xmin) * sc, Y = (i) => base - q[i * 2 + 1] * sc;
          ctx.strokeStyle = `${ink}${al * 0.35})`; ctx.lineWidth = 0.7 * S.dpr;
          for (const [i, j] of chrono.cables) { ctx.beginPath(); ctx.moveTo(X(i), Y(i)); ctx.lineTo(X(j), Y(j)); ctx.stroke(); }
          ctx.strokeStyle = `${ink}${al})`; ctx.lineWidth = 1.6 * S.dpr;
          for (const [i, j] of chrono.bars) { ctx.beginPath(); ctx.moveTo(X(i), Y(i)); ctx.lineTo(X(j), Y(j)); ctx.stroke(); }
        }
        ctx.strokeStyle = `${ink}0.25)`; ctx.lineWidth = 1 * S.dpr;
        ctx.beginPath(); ctx.moveTo(x0 - 20 * S.dpr, base + 2 * S.dpr); ctx.lineTo(x0 + W + 20 * S.dpr, base + 2 * S.dpr); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (debugSend && chrono && !sent && chronoT > 1.6) {
        sent = true;
        ctx.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }).then((b) => fetch(debugSend, { method: 'POST', body: b })).catch(() => {});
      }
    },
  };
}
