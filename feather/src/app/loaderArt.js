// Feather — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
//
// Le calcul lui-même : le motif de la plume de cette graine se dépose dans le
// collier du follicule, rangée après rangée, de la pointe vers la base (la
// réaction-diffusion de gen/pattern.js, la vraie, avec la graine de la scène).
// On voit le vexille déroulé (son contour vient de gen/feather.js) se remplir
// sous une bande lumineuse — le collier — qui descend ; les barbes s'y
// dessinent à leur angle. Le dessin ne s'arrête jamais : la bande remonte
// doucement et repasse, comme une plume suivante.
//
// Contrat : createArt(S) → { data(d, S), draw(ctx, S) } ; S = { w, h, dpr, t,
// dt, p, step, stepIdx, done, error, lite }. Rien sous ~88 % de la hauteur.
import { featherTexture } from '../gen/pattern.js';
import { halfWidth, barbArc, barbTable, BARB_STRIDE } from '../gen/feather.js';

const hex = (h) => { const n = parseInt(String(h || '#888888').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export default function createArt() {
  let img = null, shape = null, nx = 96, nz = 144, rows = null, barbs = [], boxW = 1;
  let t0 = 0;

  function data(d) {
    if (!d?.shape) return;
    shape = d.shape;
    const L = d.look ?? {};
    const tex = featherTexture(d.pattern ?? { program: 'plain' }, d.pattern?.seed ?? d.seed, { nx, nz });
    const base = hex(L.base), mark = hex(L.mark), down = hex(L.down);
    const eye = (L.eye ?? []).map(hex);
    // image du vexille déroulé, dans une boîte de demi-largeur Wb (cm) : chaque
    // pixel lit le motif à sa coordonnée du tube (x_motif = 2·latéral / (W_g + W_d))
    let Wb = 0.01;
    for (let k = 0; k <= 64; k++) Wb = Math.max(Wb, halfWidth(shape, k / 64, 1), halfWidth(shape, k / 64, -1));
    if (shape.radial) Wb = shape.L;
    boxW = Wb;
    img = new OffscreenCanvas(nx, nz);
    const c = img.getContext('2d'), id = c.createImageData(nx, nz);
    const plumZ = shape.calamus + (1 - shape.calamus) * (shape.plum ?? 0.2);
    for (let j = 0; j < nz; j++) {
      const z = 1 - (j + 0.5) / nz; // (la pointe en haut)
      const wl = halfWidth(shape, z, 1), wr = halfWidth(shape, z, -1), W = Math.max(1e-3, wl + wr);
      for (let i = 0; i < nx; i++) {
        const lat = (-1 + ((i + 0.5) / nx) * 2) * Wb;
        const inside = shape.radial ? Math.hypot(lat / Wb, (z - 0.45) * 2.2) < 0.9 : (lat >= 0 ? lat < wl : -lat < wr);
        const px = Math.max(-1, Math.min(1, (2 * lat) / W));
        const ti = Math.min(nx - 1, Math.max(0, Math.floor((px * 0.5 + 0.5) * nx)));
        const o = (Math.min(nz - 1, Math.floor(z * nz)) * nx + ti) * 4, q = (j * nx + i) * 4;
        const m = tex.data[o] / 255, g = tex.data[o + 1] / 255, a = tex.data[o + 3] / 255;
        let col = base.map((v, k) => v + (mark[k] - v) * m);
        if (g > 0.02 && eye.length) {
          const idx = g > 0.66 ? 0 : g > 0.46 ? 1 : g > 0.26 ? 2 : g > 0.06 ? 3 : 4;
          col = eye[idx];
        }
        col = col.map((v) => v + (235 - v) * a * 0.9);
        const pl = Math.max(0, Math.min(1, (plumZ - z) / 0.08));
        col = col.map((v, k) => v + (down[k] - v) * pl * 0.85);
        id.data[q] = col[0]; id.data[q + 1] = col[1]; id.data[q + 2] = col[2];
        id.data[q + 3] = inside && z > shape.calamus ? 255 : 0;
      }
    }
    c.putImageData(id, 0, 0);
    rows = null;
    // barbes : quelques dizaines de traits à leur angle (même formule que la scène)
    barbs = [];
    if (!shape.radial) {
      // les vraies barbes de la plume (gabarit grossier : une sur deux ou trois)
      const T = barbTable(shape, d.seed ?? 'x', 7);
      for (let b = 0; b < T.length / BARB_STRIDE; b++) {
        const o = b * BARB_STRIDE, s0 = T[o], side = T[o + 1], ell = T[o + 2], al = T[o + 3], cu = T[o + 4];
        const pts = [];
        for (let k = 0; k <= 8; k++) { const [sg, hy] = barbArc(al, cu, (ell * k) / 8); pts.push([side * sg, s0 * shape.L + hy]); }
        barbs.push(pts);
      }
    } else {
      for (let i = 0; i < 70; i++) {
        const a = (i / 70) * Math.PI * 2 * 2.618, ell = shape.L * (0.7 + 0.3 * ((i * 0.618) % 1)), sp = 0.5 + 1.8 * ((i * 0.37) % 1);
        const pts = [];
        for (let k = 0; k <= 8; k++) { const [sg, hy] = barbArc(sp, shape.curl, (ell * k) / 8); pts.push([Math.cos(a) * sg, shape.calamus * shape.L + hy]); }
        barbs.push(pts);
      }
    }
  }

  function draw(ctx, S) {
    if (!img) return;
    if (!t0) t0 = S.t;
    const t = S.t - t0;
    const m = Math.min(S.w, S.h * 0.85);
    const H = m * 0.8, cx = S.w / 2, top = S.h * 0.44 - H / 2;
    const Lw = shape.radial ? shape.L * 2.4 : shape.L;
    const sc = H / Lw;
    const Wd = 2 * boxW * sc;
    // avancement : réel (p) et lent dans le temps, jamais figé ; puis la bande repasse
    const r = Math.min(1, 0.06 + 0.8 * S.p + 0.035 * t);
    const cyc = r >= 1 ? ((t * 0.08) % 1) : 0;
    const shown = r >= 1 ? 1 : r;
    const fade = 1 - S.done;
    ctx.save();
    ctx.globalAlpha = fade;
    // le vexille, révélé de la pointe vers la base
    const yCut = top + H * shown;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, S.w, yCut); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    if (shape.radial) ctx.globalAlpha = fade * 0.9;
    ctx.drawImage(img, cx - Wd / 2, top, Wd, H);
    ctx.restore();
    // barbes : traits fins, déposés en même temps que le motif
    ctx.strokeStyle = 'rgba(245, 238, 225, 0.3)';
    ctx.lineWidth = 0.7 * S.dpr;
    const yOf = (y) => top + H - (y / Lw) * H;
    for (const pts of barbs) {
      const yb = yOf(pts[0][1]);
      if (yb > yCut + 2) continue;
      ctx.beginPath();
      pts.forEach(([x, y], k) => { const X = cx + x * sc, Y = yOf(y); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    // le rachis
    if (!shape.radial) {
      ctx.strokeStyle = 'rgba(240, 232, 218, 0.55)';
      ctx.lineWidth = 1.4 * S.dpr;
      ctx.beginPath(); ctx.moveTo(cx, yOf(0)); ctx.lineTo(cx, Math.min(yOf(0), Math.max(yOf(shape.L), top))); ctx.stroke();
    }
    // le collier : une bande lumineuse là où le motif se dépose
    const yb = r >= 1 ? top + H * cyc : yCut;
    const g = ctx.createLinearGradient(0, yb - 14 * S.dpr, 0, yb + 14 * S.dpr);
    g.addColorStop(0, 'rgba(255, 236, 200, 0)'); g.addColorStop(0.5, `rgba(255, 236, 200, ${r >= 1 ? 0.12 : 0.32})`); g.addColorStop(1, 'rgba(255, 236, 200, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - Wd * 0.75, yb - 14 * S.dpr, Wd * 1.5, 28 * S.dpr);
    ctx.restore();
  }

  return { data, draw };
}
