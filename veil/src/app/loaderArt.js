// Veil — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le geste du film, en coupe, avec les vraies pièces de la graine : la coupe
// du voile (une chaîne de 80 maillons simulée ici, à pas fixe) pend en hamac
// au bout de ses deux cordons ; elle descend, son ventre touche la statue
// absente, les cordons lâchent, l'étoffe tombe et l'épouse. La statue n'est
// qu'un pointillé éteint (une coupe de son vrai champ de distance, forms.js),
// qui s'allume là où l'étoffe la touche. Puis elle s'efface en s'enfonçant
// dans le socle, l'étoffe s'affaisse sur le dessus, les cordons reprennent
// les bouts, ouvrent le tas et remontent le hamac vers la statue suivante.
// Le socle a la forme de celui de la graine ; l'étoffe a sa couleur et son
// dessin (rayures, vichy, bordure : en tirets le long de la coupe).
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; d = { forms, L,
// color, color2, motif, plinth } ; rien sous ~88 % de la hauteur, < 3 ms par image.
import { buildForm, plinthDims } from '../gen/forms.js';

const GX = 120, GY = 150, X0 = -0.45, X1 = 0.45, Y0 = -0.06, Y1 = 0.95;
const dx = (X1 - X0) / (GX - 1), dy = (Y1 - Y0) / (GY - 1);

// coupe d'une forme dans le plan z = 0 : grille de distances et points du contour
function slice(spec) {
  const f = buildForm(spec);
  const D = new Float32Array(GX * GY);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const x = X0 + i * dx, y = Y0 + j * dy;
    // (la coupe garde le plus proche de z dans une épaisseur : un profil lisible)
    D[j * GX + i] = Math.min(f(x, y, 0), f(x, y, 0.05) + 0.01, f(x, y, -0.05) + 0.01);
  }
  const edge = [];
  for (let j = 1; j < GY; j++) for (let i = 1; i < GX; i++) {
    const a = D[j * GX + i] < 0, b = D[j * GX + i - 1] < 0, c = D[(j - 1) * GX + i] < 0;
    if (a !== b || a !== c) edge.push([X0 + i * dx, Y0 + j * dy]);
  }
  let top = 0;
  for (const e of edge) top = Math.max(top, e[1]);
  return { D, edge, top, lit: new Float32Array(edge.length) };
}
const sample = (D, x, y) => {
  const u = (x - X0) / dx, v = (y - Y0) / dy;
  if (u < 0 || v < 0 || u >= GX - 1 || v >= GY - 1) return 1;
  const i = u | 0, j = v | 0, s = u - i, t = v - j;
  const a = D[j * GX + i], b = D[j * GX + i + 1], c = D[(j + 1) * GX + i], d = D[(j + 1) * GX + i + 1];
  return (a + (b - a) * s) * (1 - t) + (c + (d - c) * s) * t;
};
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Le cycle d'une statue (s) : descente, chute, repos, effacement, reprise
const T = { lower: 1.1, fall: 1.4, rest: 0.8, sink: 1.0, grab: 1.2 };
const CYCLE = T.lower + T.fall + T.rest + T.sink + T.grab;
const RA = 0.42; // (les prises, à ±42 cm de l'axe, comme dans le film)

export default function createArt() {
  let shapes = [], L = 1.0, color = '#ece6da', color2 = null, motif = 'uni', mScale = 0.08, plinth = null, ready = false;
  const M = 80;
  let P = [], Q = [], held = true;
  let k = 0, tc = 0, yHang = 1.0;
  let grabFrom = null;
  const hold = (x, y) => { P[0][0] = -x; P[0][1] = y; P[M - 1][0] = x; P[M - 1][1] = y; };
  const reset = () => {
    // (le hamac au repos : une chaînette entre les deux prises)
    P = []; Q = [];
    // (une vraie chaînette de longueur L entre les prises : sinon le hamac
    // ondule au départ) — a tel que 2a·sh(RA/a) = L, par dichotomie
    let lo = 0.01, hi = 50;
    for (let it = 0; it < 60; it++) { const a = (lo + hi) / 2; if (2 * a * Math.sinh(RA / a) > L) lo = a; else hi = a; }
    const a = (lo + hi) / 2, S0 = a * Math.sinh(-RA / a);
    for (let i = 0; i < M; i++) {
      // (abscisse curviligne régulière : x tel que a·sh(x/a) − S0 = i·h)
      const sArc = (i / (M - 1)) * L + S0, x = a * Math.asinh(sArc / a);
      const y = yHang + a * (Math.cosh(x / a) - Math.cosh(RA / a));
      P.push([x, y]); Q.push([x, y]);
    }
  };
  // contact : la coupe de la statue, enfoncée de drop et resserrée de sc
  const formD = (sh, x, y, drop, sc) => (y < 0 && drop > 0 ? 1 : sample(sh.D, x / sc, y + drop) * sc);
  return {
    data(d) {
      L = (d.L ?? 1) * Math.SQRT2 * 0.92; // (la coupe passe par la diagonale du voile, de coin à coin) color = d.color ?? color; color2 = d.color2 ?? null;
      motif = d.motif ?? 'uni'; mScale = d.mScale ?? 0.08;
      try { plinth = d.plinth ? plinthDims(d.plinth) : null; } catch (e) { plinth = null; }
      try { shapes = (d.forms ?? []).map(slice); } catch (e) { shapes = []; }
      yHang = Math.max(0.75, ...shapes.map((s) => s.top + 0.12)) + Math.sqrt(Math.max(0, L * L - 4 * RA * RA)) * 0.5 * 0.95; // (le ventre du hamac 12 cm au-dessus de la plus haute)
      k = 0; tc = 0; held = true; reset(); ready = true;
    },
    draw(ctx, S) {
      if (!ready || !shapes.length) return;
      const sh = shapes[k];
      tc += Math.min(S.dt, 1 / 20);
      if (tc > CYCLE) { tc -= CYCLE; sh.lit.fill(0); k = (k + 1) % shapes.length; held = true; grabFrom = null; }
      const s2 = shapes[k];
      // l'horaire du cycle
      const t1 = T.lower, t2 = t1 + T.fall, t3 = t2 + T.rest, t4 = t3 + T.sink;
      // hauteur des prises pendant la descente : jusqu'à ce que le ventre
      // touche le sommet (on la règle d'après la flèche du hamac au départ)
      const sag0 = yHang - Math.min(...P.map((p) => p[1])) + (P[0][1] - yHang); // (flèche du hamac sous ses prises)
      const yRel = s2.top + sag0 + 0.01;
      let drop = 0, sc = 1;
      if (tc < t1) { held = true; const e = smooth(tc / t1); hold(RA, yHang + (yRel - yHang) * e); }
      else if (tc < t4) held = false;
      if (tc >= t3 && tc < t4) { const e = smooth((tc - t3) / T.sink); drop = (s2.top + 0.03) * e; sc = 1 - 0.6 * e; }
      if (tc >= t4) {
        drop = 1; sc = 0.4;
        // reprise : les bouts tirés au ras du socle vers l'extérieur, puis montés
        if (!grabFrom) grabFrom = [P[0][0], P[0][1], P[M - 1][0], P[M - 1][1]];
        held = true;
        const u = (tc - t4) / T.grab, eo = smooth(u / 0.35), eu = smooth((u - 0.25) / 0.75);
        const xa = grabFrom[0] + (-RA - grabFrom[0]) * eo, xb = grabFrom[2] + (RA - grabFrom[2]) * eo;
        const ya = grabFrom[1] + (yHang - grabFrom[1]) * eu, yb = grabFrom[3] + (yHang - grabFrom[3]) * eu;
        P[0][0] = xa; P[0][1] = ya; P[M - 1][0] = xb; P[M - 1][1] = yb;
      }
      // chaîne (dynamique des positions à pas fixe, 8 sous-pas)
      const h = L / (M - 1), sub = 8, dt = Math.min(1 / 30, S.dt) / sub;
      const pa = plinth ? plinth.a : 0.3;
      const pin0 = [P[0][0], P[0][1]], pin1 = [P[M - 1][0], P[M - 1][1]];
      for (let s = 0; s < sub; s++) {
        for (let i = 0; i < M; i++) {
          const p = P[i], q = Q[i];
          const vx = (p[0] - q[0]) * 0.982, vy = (p[1] - q[1]) * 0.982;
          q[0] = p[0]; q[1] = p[1];
          p[0] += vx; p[1] += vy - 9.81 * dt * dt;
        }
        if (held) { P[0][0] = pin0[0]; P[0][1] = pin0[1]; P[M - 1][0] = pin1[0]; P[M - 1][1] = pin1[1]; }
        for (let it = 0; it < 3; it++) for (let i = 0; i + 1 < M; i++) {
          const a = P[i], b = P[i + 1];
          const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1e-9, d = (l - h) / l / 2;
          const wa = held && i === 0 ? 0 : 1, wb = held && i + 1 === M - 1 ? 0 : 1, w = (wa + wb) || 1;
          a[0] += ex * d * 2 * wa / w; a[1] += ey * d * 2 * wa / w;
          b[0] -= ex * d * 2 * wb / w; b[1] -= ey * d * 2 * wb / w;
        }
        for (let i = 0; i < M; i++) {
          if (held && (i === 0 || i === M - 1)) continue;
          const p = P[i];
          if (drop < 1) {
            const f = formD(s2, p[0], p[1], drop, sc);
            if (f < 0.006) {
              const e = 0.004;
              const gx = formD(s2, p[0] + e, p[1], drop, sc) - formD(s2, p[0] - e, p[1], drop, sc);
              const gy = formD(s2, p[0], p[1] + e, drop, sc) - formD(s2, p[0], p[1] - e, drop, sc);
              const g = Math.hypot(gx, gy) || 1;
              p[0] += (gx / g) * (0.006 - f); p[1] += (gy / g) * (0.006 - f);
              Q[i][0] += (p[0] - Q[i][0]) * 0.6; // (frottement)
            }
          }
          if (p[1] < 0.004 && p[1] > -0.03 && Math.abs(p[0]) < pa) { p[1] = 0.004; Q[i][0] += (p[0] - Q[i][0]) * 0.5; Q[i][1] = p[1]; } // dessus du socle
        }
      }
      // ── dessin ──
      const { w, h: H, dpr } = S;
      const sc2 = Math.min(w * 0.6, H * 0.78) / (Y1 - Y0 + 0.45);
      const ox = w / 2, oy = H * 0.66; // (le titre et la barre du chargeur occupent le bas)
      const X = (x) => ox + x * sc2, Y = (y) => oy - y * sc2;
      const fade = 1 - S.done;
      // le socle (sa silhouette, de la graine)
      ctx.lineWidth = dpr; ctx.strokeStyle = `rgba(255, 244, 228, ${0.32 * fade})`;
      ctx.fillStyle = `rgba(255, 244, 228, ${0.035 * fade})`;
      const parts = plinth ? plinth.parts : [{ t: 'box', c: [0, -0.2, 0], h: [0.3, 0.2, 0.3] }];
      for (const q of parts) {
        let x0, x1, y0, y1;
        if (q.t === 'box') { x0 = -q.h[0]; x1 = q.h[0]; y0 = q.c[1] - q.h[1]; y1 = q.c[1] + q.h[1]; }
        else { x0 = -q.R; x1 = q.R; y0 = q.y0; y1 = q.y1; }
        y0 = Math.max(y0, -0.2);
        if (y1 < -0.2) continue;
        ctx.beginPath(); ctx.rect(X(x0), Y(y1), (x1 - x0) * sc2, (y1 - y0) * sc2); ctx.fill(); ctx.stroke();
      }
      // la statue : pointillé éteint, qui s'allume sous l'étoffe ; elle
      // s'enfonce et se resserre en s'effaçant
      const showForm = drop < 1;
      for (let i = 0; i < s2.edge.length; i++) {
        const e = s2.edge[i];
        const ex = e[0] * sc, ey = e[1] - drop;
        let near = 1;
        for (let j = 0; j < M; j += 2) { const d = Math.hypot(P[j][0] - ex, P[j][1] - ey); if (d < near) near = d; }
        s2.lit[i] = Math.max(s2.lit[i] * (1 - S.dt * 0.35), near < 0.025 ? 1 : 0);
        if (!showForm || ey < 0) continue;
        ctx.fillStyle = `rgba(255, 240, 220, ${(0.2 + 0.75 * s2.lit[i]) * fade})`;
        ctx.fillRect(X(ex) - 0.9 * dpr, Y(ey) - 0.9 * dpr, 1.8 * dpr, 1.8 * dpr);
      }
      // les cordons, tant qu'ils tiennent (sinon ils remontent hors champ)
      if (held) {
        ctx.strokeStyle = `rgba(255, 244, 228, ${0.3 * fade})`; ctx.lineWidth = dpr;
        ctx.beginPath();
        for (const p of [P[0], P[M - 1]]) { ctx.moveTo(X(p[0]), 0); ctx.lineTo(X(p[0]), Y(p[1])); }
        ctx.stroke();
      }
      // l'étoffe : sa couleur, et son dessin en tirets le long de la coupe
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const path = () => { ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); };
      ctx.globalAlpha = 0.18 * fade; ctx.strokeStyle = color; ctx.lineWidth = 7 * dpr; path(); ctx.stroke(); // (halo)
      ctx.globalAlpha = 0.95 * fade; ctx.lineWidth = 2.4 * dpr; path(); ctx.stroke();
      if (color2 && motif !== 'uni' && motif !== 'damas') {
        const seg = Math.max(2, Math.round(mScale / h));
        ctx.strokeStyle = color2; ctx.lineWidth = 2.4 * dpr;
        ctx.beginPath();
        for (let i = 0; i + 1 < M; i++) {
          const on = motif === 'bordure' ? i < 3 || i > M - 5 : motif === 'semis' ? i % seg === 0 : (Math.floor(i / seg) % 2 === 0);
          if (!on) continue;
          ctx.moveTo(X(P[i][0]), Y(P[i][1])); ctx.lineTo(X(P[i + 1][0]), Y(P[i + 1][1]));
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
