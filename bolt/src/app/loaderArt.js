// Bolt — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le calcul lui-même, à plat : un traceur qui pousse par claquage diélectrique
// (le même modèle que gen/dbm.js, en deux dimensions, avec la graine et le η
// de la scène) du nuage vers la tasse — ou de la théière vers le nuage, si
// l'éclair de cette graine est ascendant. Il avance avec le chargement réel
// (S.p) ; à la fin, le canal qui a touché s'allume et les branches meurent.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Pas de texte, rien sous ~88 % de
// la hauteur, < 3 ms par image.
export default function createArt() {
  let tree = null, shown = 0, upward = false, bw = false;

  function grow(seed, eta, up) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    const H = 46, W = 60, tx = Math.round((rnd() - 0.5) * 10);       // grille : racine en (0, 0), cible en (tx, H)
    const key = (x, y) => (x + 200) * 512 + (y + 200);
    const sx = [0], sy = [0], par = [-1], run = [0];
    const agg = new Map([[key(0, 0), 0]]);
    const cx = [], cy = [], cp = [], cphi = [], cidx = new Map();
    const add = (x, y, from) => {
      const k = key(x, y);
      if (agg.has(k) || cidx.has(k) || Math.abs(x) > W / 2 || y < 0 || y > H) return;
      let phi = 0;
      for (let j = 0; j < sx.length; j++) phi += 1 - 0.5 / Math.hypot(x - sx[j], y - sy[j]);
      cidx.set(k, cx.length); cx.push(x); cy.push(y); cp.push(from); cphi.push(phi);
    };
    const nb = (i) => { for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) if ((dx || dy) && !(dy === 0 && run[i] >= 2)) add(sx[i] + dx, sy[i] + dy, i); };
    nb(0);
    let hit = -1;
    for (let it = 0; it < 900 && hit < 0 && cx.length; it++) {
      let pMin = 1e9, pMax = -1e9, gMin = 1e9, gMax = -1e9;
      const g = cx.map((x, i) => {
        if (sx.length - cp[i] > 30) return NaN; // (seules les pointes récentes poussent)
        const f = cy[i] / H, wgt = 0.25 + 1.9 * f * f, v = -Math.hypot((x - tx) * wgt, cy[i] - H);
        pMin = Math.min(pMin, cphi[i]); pMax = Math.max(pMax, cphi[i]); gMin = Math.min(gMin, v); gMax = Math.max(gMax, v);
        return v;
      });
      let sum = 0;
      const P = g.map((v, i) => { if (Number.isNaN(v)) return 0; const q = (0.5 * (cphi[i] - pMin) / (pMax - pMin || 1) + 0.5 * (v - gMin) / (gMax - gMin || 1)) ** eta; sum += q; return q; });
      if (!sum) break;
      let r = rnd() * sum, pick = 0;
      for (let i = 0; i < P.length; i++) { r -= P[i]; if (r <= 0) { pick = i; break; } }
      const x = cx[pick], y = cy[pick], from = cp[pick], last = cx.length - 1;
      cidx.delete(key(x, y));
      if (pick !== last) { cx[pick] = cx[last]; cy[pick] = cy[last]; cp[pick] = cp[last]; cphi[pick] = cphi[last]; cidx.set(key(cx[pick], cy[pick]), pick); }
      cx.pop(); cy.pop(); cp.pop(); cphi.pop();
      const id = sx.length;
      sx.push(x); sy.push(y); par.push(from); run.push(y === sy[from] ? run[from] + 1 : 0);
      agg.set(key(x, y), id);
      for (let i = 0; i < cx.length; i++) cphi[i] += 1 - 0.5 / Math.hypot(cx[i] - x, cy[i] - y);
      nb(id);
      if (Math.hypot(x - tx, y - H) <= 1.5) hit = id;
    }
    const main = new Uint8Array(sx.length);
    for (let i = hit; i >= 0; i = par[i]) main[i] = 1;
    // décalage des sites (pas d'escaliers) : un tremblé fixe par nœud
    const jx = sx.map(() => (rnd() - 0.5) * 0.7), jy = sx.map(() => (rnd() - 0.5) * 0.5);
    return { sx, sy, par, main, jx, jy, H, W, tx, n: sx.length, hit, up };
  }

  return {
    data(d) { upward = d.family === 'upward'; bw = !!d.bw; tree = grow(d.seed ?? '', Math.min(5, Math.max(2, d.eta ?? 3.2)), upward); shown = 0; },
    draw(ctx, S) {
      if (!tree) return;
      const T = tree, m = Math.min(S.w, S.h), u = (m * 0.6) / T.H, cx0 = S.w / 2, top = S.h * 0.46 - (T.H * u) / 2;
      // (ascendant : la même croissance, retournée — la racine est en bas)
      const X = (i) => cx0 + (T.sx[i] + T.jx[i] - T.tx * 0.5) * u, Y = (i) => (T.up ? top + (T.H - T.sy[i] - T.jy[i]) * u : top + (T.sy[i] + T.jy[i]) * u);
      // l'avancement suit le chargement, sans jamais s'arrêter ni reculer
      const want = S.done > 0 ? T.n : Math.min(T.n - 1, Math.floor(T.n * (0.04 + 0.9 * S.p)));
      shown = Math.min(want, shown + Math.max(1, (want - shown) * 0.12 + S.dt * 14));
      const n = Math.floor(shown), fade = 1 - S.done, blue = bw ? '225, 225, 225' : '178, 198, 255';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // le nuage (base plate, bourgeons) et la tasse : deux traits
      const cloudY = T.up ? top + T.H * u : top, cupY = T.up ? top : top + T.H * u;
      ctx.strokeStyle = `rgba(${blue}, ${0.5 * fade})`; ctx.lineWidth = 1.5 * S.dpr;
      ctx.beginPath();
      const cw = T.W * u * 0.42, by = T.up ? cloudY + 2 * u : cloudY - 2 * u, sg = T.up ? 1 : -1;
      ctx.moveTo(cx0 - cw, by); ctx.lineTo(cx0 + cw, by);
      for (let k = 0; k < 5; k++) { const a = cx0 + cw - (2 * cw * (k + 0.5)) / 5, r = cw * (0.2 + 0.07 * Math.sin(k * 2.3 + S.t * 0.3)); ctx.moveTo(a + r, by); ctx.arc(a, by, r, 0, Math.PI, sg < 0); }
      ctx.stroke();
      ctx.beginPath();
      const tx = cx0 + T.tx * 0.5 * u, cr = 6 * u, cyy = cupY + (T.up ? -1 : 1) * 0.8 * u;
      ctx.moveTo(tx - cr, cyy); ctx.lineTo(tx + cr, cyy); ctx.bezierCurveTo(tx + cr, cyy + cr * 1.5, tx - cr, cyy + cr * 1.5, tx - cr, cyy);
      ctx.moveTo(tx - cr * 1.6, cyy + cr * 1.25); ctx.lineTo(tx + cr * 1.6, cyy + cr * 1.25);
      ctx.stroke();
      // branches, puis canal
      const flash = S.done > 0 ? Math.max(0, 1 - S.done * 1.6) : 0;
      for (const pass of [0, 1]) {
        ctx.beginPath();
        for (let i = 1; i <= n && i < T.n; i++) { if ((T.main[i] && S.done > 0 ? 1 : 0) !== pass) continue; ctx.moveTo(X(T.par[i]), Y(T.par[i])); ctx.lineTo(X(i), Y(i)); }
        if (pass === 0) { ctx.strokeStyle = `rgba(${blue}, ${(S.done > 0 ? 0.5 * Math.max(0, 1 - S.done * 3) : 0.85) * (S.done > 0 ? 1 : fade)})`; ctx.lineWidth = 1.7 * S.dpr; }
        else { ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + 0.75 * flash})`; ctx.lineWidth = (1.4 + 2.6 * flash) * S.dpr; ctx.shadowColor = `rgba(${blue}, 0.9)`; ctx.shadowBlur = 14 * S.dpr * flash; }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // les pointes : les derniers bonds, blancs
      if (S.done === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        for (let i = Math.max(1, n - 5); i <= n && i < T.n; i++) { ctx.globalAlpha = (1 - (n - i) / 6) * fade; ctx.beginPath(); ctx.arc(X(i), Y(i), 2.4 * S.dpr, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    },
  };
}
