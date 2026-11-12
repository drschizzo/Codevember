// Kelp — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// La coupe du platier de la scène, et sa mer calculée ici même : les
// équations de Saint-Venant sur le profil de la graine (le même profil, la
// même série de vagues que gen/sea.js, sur une grille plus grossière), en
// direct, deux fois plus vite que le temps réel. Une frange de laminaires en
// coupe se couche à l'air et se dresse dans l'eau. Dessous, la série telle
// qu'elle entre au large (trois vagues, chacune précédée du creux où la mer
// se retire), et un point qui avance avec la coupe.
import { makeProfile, makeForcing } from '../gen/sea.js';

const g = 9.81;

export default function createArt() {
  let sim = null, tSim = 0, plants = [], fam = 'digitata';
  const X0 = -5, X1 = 4, NX = 180, dx = (X1 - X0) / NX;

  function init(d) {
    const prof = makeProfile(d.profile ?? {});
    const forcing = makeForcing(d.waves ?? [], d.T ?? 32);
    const b = new Float64Array(NX), h = new Float64Array(NX), q = new Float64Array(NX), foam = new Float64Array(NX);
    for (let i = 0; i < NX; i++) { b[i] = prof(X0 + (i + 0.5) * dx); h[i] = Math.max(0, -b[i]); }
    sim = { b, h, q, foam, forcing, T: d.T ?? 32, h0: h[0] };
    tSim = 0;
    fam = d.family ?? 'digitata';
    // laminaires en coupe : des chaînes ancrées sur le bord du platier
    let s = 0; for (const c of String(d.seed ?? '')) s = (s * 31 + c.charCodeAt(0)) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const n = 9, L = fam === 'durvillaea' ? 1.6 : fam === 'egregia' ? 1.3 : fam === 'postelsia' ? 0.5 : 0.9;
    plants = Array.from({ length: n }, (_, k) => {
      const x = -2.7 + (k + rnd() * 0.6) * (2.6 / n), y = prof(x);
      const m = 10, seg = L / m;
      const pts = Array.from({ length: m + 1 }, (_, i) => [x - (fam === 'postelsia' ? 0 : i * seg * 0.9), y + (fam === 'postelsia' ? i * seg : 0.01)]);
      return { pts, prev: pts.map((p) => [...p]), seg, buoy: fam === 'durvillaea' ? 0.35 : fam === 'egregia' ? 0.25 : 0.08 };
    });
  }

  // un pas de Saint-Venant (Rusanov, reconstruction hydrostatique)
  function step(dt) {
    const { b, h, q } = sim, n = NX;
    const eIn = sim.forcing(tSim), c0 = Math.sqrt(g * sim.h0), cIn = Math.sqrt(g * Math.max(0.01, sim.h0 + eIn));
    const u1 = h[0] > 1e-4 ? q[0] / h[0] : 0, Rm = u1 - 2 * Math.sqrt(g * h[0]), Rp = 4 * cIn - 2 * c0;
    const cg = Math.max(0, (Rp - Rm) / 4), hg = (cg * cg) / g, ug = (Rp + Rm) / 2;
    const Fh = new Float64Array(n + 1), Fq = new Float64Array(n + 1), SL = new Float64Array(n + 1), SR = new Float64Array(n + 1);
    for (let j = 0; j <= n; j++) {
      const hl = j ? h[j - 1] : hg, ql = j ? q[j - 1] : hg * ug, bl = j ? b[j - 1] : b[0];
      const hr = j < n ? h[j] : h[n - 1], qr = j < n ? q[j] : -q[n - 1], br = j < n ? b[j] : b[n - 1];
      const bs = Math.max(bl, br), a = Math.max(0, hl + bl - bs), c = Math.max(0, hr + br - bs);
      const ul = hl > 1e-4 ? ql / hl : 0, ur = hr > 1e-4 ? qr / hr : 0;
      const s = Math.max(Math.abs(ul) + Math.sqrt(g * a), Math.abs(ur) + Math.sqrt(g * c));
      Fh[j] = 0.5 * (a * ul + c * ur) - 0.5 * s * (c - a);
      Fq[j] = 0.5 * (a * ul * ul + 0.5 * g * a * a + c * ur * ur + 0.5 * g * c * c) - 0.5 * s * (c * ur - a * ul);
      SL[j] = 0.5 * g * (hl * hl - a * a); SR[j] = 0.5 * g * (hr * hr - c * c);
    }
    for (let i = 0; i < n; i++) {
      h[i] -= (dt / dx) * (Fh[i + 1] - Fh[i]);
      q[i] -= (dt / dx) * (Fq[i + 1] + SL[i + 1] - Fq[i] - SR[i]);
      if (h[i] < 0.03 && b[i] > -0.35) { const k = Math.exp(-dt * 1.6 * (1 - h[i] / 0.03)); h[i] *= k; q[i] *= k; }
      if (h[i] < 1e-5) { h[i] = 0; q[i] = 0; continue; }
      q[i] /= 1 + (dt * g * 0.0012 * Math.abs(q[i])) / Math.max(h[i], 0.004) ** (7 / 3);
      const dh = Math.abs((h[Math.min(n - 1, i + 1)] + b[Math.min(n - 1, i + 1)]) - (h[Math.max(0, i - 1)] + b[Math.max(0, i - 1)]));
      sim.foam[i] = Math.min(1, sim.foam[i] * Math.exp(-dt / 2) + dh * 8 * dt * 10);
    }
    tSim += dt;
  }
  const surf = (x) => { const i = Math.max(0, Math.min(NX - 1, Math.floor((x - X0) / dx))); return [sim.h[i] + sim.b[i], sim.h[i] > 0.004 ? sim.q[i] / sim.h[i] : 0, sim.b[i]]; };

  // laminaires : Verlet, gravité, flottabilité, traînée vers le courant, longueur fixe
  function kelp(dt) {
    for (const P of plants) {
      const { pts, prev } = P;
      for (let i = 1; i < pts.length; i++) {
        const [eta, u, bed] = surf(pts[i][0]);
        const wet = pts[i][1] < eta ? 1 : 0;
        const vx = pts[i][0] - prev[i][0], vy = pts[i][1] - prev[i][1];
        prev[i] = [pts[i][0], pts[i][1]];
        const k = wet ? 0.08 : 0.02;
        // dans l'eau : flottabilité et courant ; à l'air : le poids
        pts[i][0] += vx * (1 - k) + (wet ? u * dt * k : 0);
        pts[i][1] += vy * (1 - k) + (wet ? P.buoy * 40 : -9.81) * dt * dt;
        if (pts[i][1] < bed + 0.01) pts[i][1] = bed + 0.01;
      }
      for (let it = 0; it < 4; it++) for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], c = pts[i], ddx = c[0] - a[0], ddy = c[1] - a[1], l = Math.hypot(ddx, ddy) || 1e-6;
        c[0] = a[0] + (ddx * P.seg) / l; c[1] = a[1] + (ddy * P.seg) / l;
      }
    }
  }

  return {
    data(d) { if (d.waves) init(d); },
    draw(ctx, S) {
      if (!sim) return;
      const W = S.w, H = S.h;
      // la mer avance deux fois plus vite que le temps réel (pas bornés)
      let left = Math.min(0.05, S.dt) * 2;
      while (left > 1e-6) { const dt = Math.min(left, 0.006); step(dt); kelp(dt); left -= dt; }
      const a = 1 - S.done;
      // la coupe : x → écran, hauteur exagérée ×2
      const XA = -3.6, XB = 2.6, sx = (x) => W * (0.08 + 0.84 * (x - XA) / (XB - XA)), sy = (y) => H * 0.46 - Math.max(-0.55, y) * H * 0.34;
      ctx.save(); ctx.globalAlpha = a;
      // roche
      ctx.save(); ctx.beginPath(); ctx.rect(W * 0.08, 0, W * 0.84, H * 0.7); ctx.clip();
      const rg = ctx.createLinearGradient(0, sy(0.4), 0, sy(-0.55));
      rg.addColorStop(0, 'rgba(92, 82, 76, 0.95)'); rg.addColorStop(1, 'rgba(92, 82, 76, 0)');
      ctx.beginPath(); ctx.moveTo(sx(X0), sy(-0.55));
      for (let i = 0; i < NX; i++) ctx.lineTo(sx(X0 + (i + 0.5) * dx), sy(sim.b[i]));
      ctx.lineTo(sx(X1), sy(-0.55)); ctx.closePath();
      ctx.fillStyle = rg; ctx.fill();
      // eau
      for (let i = 0, start = -1; i <= NX; i++) {
        const wet = i < NX && sim.h[i] > 0.004;
        if (wet && start < 0) start = i;
        if (!wet && start >= 0) {
          ctx.beginPath(); ctx.moveTo(sx(X0 + start * dx), sy(sim.b[start]));
          for (let k = start; k < i; k++) ctx.lineTo(sx(X0 + (k + 0.5) * dx), sy(sim.h[k] + sim.b[k]));
          for (let k = i - 1; k >= start; k--) ctx.lineTo(sx(X0 + (k + 0.5) * dx), sy(sim.b[k]));
          ctx.closePath(); ctx.fillStyle = 'rgba(46, 120, 128, 0.55)'; ctx.fill();
          ctx.beginPath();
          for (let k = start; k < i; k++) ctx.lineTo(sx(X0 + (k + 0.5) * dx), sy(sim.h[k] + sim.b[k]));
          ctx.strokeStyle = 'rgba(200, 236, 236, 0.85)'; ctx.lineWidth = 1.2 * S.dpr; ctx.stroke();
          start = -1;
        }
      }
      // écume
      ctx.fillStyle = 'rgba(240, 248, 248, 0.8)';
      for (let i = 0; i < NX; i++) if (sim.foam[i] > 0.15 && sim.h[i] > 0.004) {
        const x = sx(X0 + (i + 0.5) * dx), y = sy(sim.h[i] + sim.b[i]);
        ctx.globalAlpha = a * Math.min(1, sim.foam[i]); ctx.beginPath(); ctx.arc(x, y - 1 * S.dpr, (0.6 + 1.2 * sim.foam[i]) * S.dpr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // laminaires
      ctx.lineCap = 'round';
      for (const P of plants) {
        ctx.beginPath();
        P.pts.forEach((p, i) => (i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))));
        ctx.strokeStyle = 'rgba(196, 140, 58, 0.9)'; ctx.lineWidth = 2 * S.dpr; ctx.stroke();
      }
      // la série au large : la hauteur de la mer qui entre (les trois vagues de
      // la graine, chacune précédée de son creux) le long de la boucle ; le
      // point est l'instant de la coupe au-dessus
      const gx0 = W * 0.08, gw = W * 0.84, gy = H * 0.78, gh = H * 0.07;
      const gX = (t) => gx0 + (t / sim.T) * gw, gY = (e) => gy - e * gh / 0.8;
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = 'rgba(236, 226, 210, 0.5)'; ctx.lineWidth = 1 * S.dpr;
      ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx0 + gw, gy); ctx.stroke();
      ctx.globalAlpha = a;
      ctx.beginPath();
      for (let k = 0; k <= 240; k++) { const t = (k / 240) * sim.T, x = gX(t), y = gY(sim.forcing(t)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = 'rgba(160, 214, 214, 0.85)'; ctx.lineWidth = 1.5 * S.dpr; ctx.stroke();
      const tc = tSim % sim.T, xc = gX(tc), yc = gY(sim.forcing(tc));
      ctx.strokeStyle = 'rgba(255, 236, 200, 0.35)'; ctx.lineWidth = 1 * S.dpr;
      ctx.beginPath(); ctx.moveTo(xc, gy - gh * 1.4); ctx.lineTo(xc, gy + gh * 0.9); ctx.stroke();
      ctx.fillStyle = 'rgba(255, 236, 200, 0.95)';
      ctx.beginPath(); ctx.arc(xc, yc, 3 * S.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
  };
}
