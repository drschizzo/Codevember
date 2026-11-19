// Melt — dessin de l'écran de chargement (dans le worker de loaderWorker.js).
// Le premier objet de la graine fond pendant que la scène se prépare. La
// figurine est celle de la scène (objects.js : mêmes ellipsoïdes fondus, même
// volume), tranchée en courbes de niveau horizontales (carrés marchants sur
// son champ de distance), empilées comme une maquette topographique qui tourne
// lentement en perspective sur son assiette. La ceinture de chaleur descend
// avec le chargement réel : les tranches qu'elle passe s'échauffent,
// s'affaissent et s'effacent, des gouttes coulent, et la cire s'étale sur
// l'assiette en anneaux qui grandissent avec le volume fondu. Traits clairs
// devant, pâles derrière, dans les teintes de la cire.
import { sdObject, scaleOf, heightOf, OBJECTS } from '../objects.js';
import { WAXES } from '../recipe.js';

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// carrés marchants : segments de la courbe f = 0 sur une grille (pas h) ; rend [x0, z0, x1, z1, …]
function contour(f, nx, nz, x0, z0, h) {
  const out = [];
  const at = (i, k) => f[k * nx + i];
  const lerp = (a, b) => a / (a - b);
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
    const a = at(i, k), b = at(i + 1, k), c = at(i + 1, k + 1), d = at(i, k + 1);
    const pts = [];
    if ((a < 0) !== (b < 0)) pts.push(x0 + (i + lerp(a, b)) * h, z0 + k * h);
    if ((b < 0) !== (c < 0)) pts.push(x0 + (i + 1) * h, z0 + (k + lerp(b, c)) * h);
    if ((c < 0) !== (d < 0)) pts.push(x0 + (i + 1 - lerp(c, d)) * h, z0 + (k + 1) * h);
    if ((d < 0) !== (a < 0)) pts.push(x0 + i * h, z0 + (k + 1 - lerp(d, a)) * h);
    if (pts.length >= 4) out.push(pts[0], pts[1], pts[2], pts[3]);
    if (pts.length === 8) out.push(pts[4], pts[5], pts[6], pts[7]);
  }
  return out;
}

export default function createArt() {
  let slices = null, Hh = 1, Rp = 1, shown = 0, lastT = 0;
  let body = [236, 214, 196], vein = [246, 236, 220];

  function prepare(d) {
    slices = null; shown = 0;
    const key = d?.objects?.[0];
    const W = WAXES[d?.wax];
    if (W) {
      const s = (v) => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.2));
      const pale = (c, k) => c.map((v) => Math.round(s(v) * k + 255 * (1 - k)));
      body = pale(W.a, 0.5); vein = pale(W.b, 0.6);
    }
    if (!key) return;
    try {
      const sc = scaleOf(key), prims = OBJECTS[key].prims, h = 0.8, x0 = -18, z0 = -20, nx = 46, nz = 51, dy = 1.6;
      Hh = heightOf(key, sc);
      const f = new Float32Array(nx * nz), list = [];
      let vol = 0;
      for (let y = 0.6; y < Hh; y += dy) {
        let area = 0;
        for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const v = sdObject(prims, sc, x0 + i * h, y, z0 + k * h); f[k * nx + i] = v; if (v < 0) area++; }
        const seg = contour(f, nx, nz, x0, z0, h);
        vol += area * h * h * dy;
        if (seg.length) list.push({ y, seg: new Float32Array(seg) });
      }
      // la flaque, mince, a le volume de la figurine
      Rp = Math.sqrt(vol / (Math.PI * Hh * 0.12));
      slices = list;
    } catch { slices = null; }
  }

  return {
    data(d) { prepare(d); },
    draw(ctx, S) {
      const { w, h, t, dpr } = S;
      const m = Math.min(w, h), cx = w / 2, cy = h * 0.68;
      ctx.globalAlpha = 1 - S.done;
      if (!slices?.length) return;
      const sc = (m * 0.56) / Math.max(Hh, Rp * 1.5);
      // la fonte suit le chargement réel, et un peu le temps (jamais figée) ;
      // lente au début : la figurine reste lisible
      const target = Math.min(1, Math.max(S.p * 0.97, Math.min(0.35, t * 0.05)) + S.done * 0.03);
      shown += (target - shown) * Math.min(1, (t - lastT) * 2 || 0.1);
      lastT = t;
      const melt = Math.pow(shown, 1.5);
      const yf = Hh * (1 - melt) + 0.2; // hauteur de la ceinture
      const a = t * 0.3, ca = Math.cos(a), sa = Math.sin(a), el = 0.36, ce = Math.cos(el), se = Math.sin(el);
      const q = [0, 0, 0];
      const proj = (X0, Y0, Z0, out) => {
        const X = ca * X0 + sa * Z0, Zr = -sa * X0 + ca * Z0, Y = ce * Y0 - se * Zr, Z = se * Y0 + ce * Zr, p = 1 / (1 - (Z / Hh) * 0.35);
        out[0] = cx + X * sc * p; out[1] = cy - Y * sc * p; out[2] = Z;
      };
      const ring = (r, y, wob, ph) => {
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const u = (i / 72) * Math.PI * 2, rr = r * (1 + wob * Math.sin(u * 3 + ph) + wob * 0.6 * Math.sin(u * 5 - ph * 1.7));
          proj(Math.cos(u) * rr, y, Math.sin(u) * rr, q);
          i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
        }
        ctx.stroke();
      };
      ctx.lineCap = 'round';
      // l'assiette
      ctx.strokeStyle = 'rgba(240, 232, 218, 0.38)'; ctx.lineWidth = 1 * dpr;
      ring(Rp * 1.1, 0, 0, 0);
      // la flaque : des anneaux concentriques, au volume fondu
      const Rm = Rp * Math.sqrt(Math.min(1, melt * 1.05));
      if (Rm > 0.5) {
        for (let i = 1; i <= 6; i++) {
          ctx.strokeStyle = `rgba(${vein[0]}, ${vein[1]}, ${vein[2]}, ${0.25 + 0.5 * (i / 6)})`; ctx.lineWidth = 1.1 * dpr;
          ring(Rm * (i / 6), 0.3 + Hh * 0.04 * (1 - i / 6), 0.05 * (i / 6), i * 1.3 + t * 0.2);
        }
      }
      // les tranches : intactes sous la ceinture, échauffées à son passage, affaissées et effacées au-dessus
      for (const front of [false, true]) {
        for (const s of slices) {
          const over = (s.y - yf) / (Hh * 0.12);
          if (over > 1) continue;
          const g = ease(over), hot = Math.max(0, 1 - Math.abs(s.y - yf) / (Hh * 0.08));
          const y = s.y - g * s.y * 0.35, shrink = 1 - 0.15 * g;
          const c = hot > 0 ? [0, 1, 2].map((j) => Math.round(body[j] + ([255, 236, 206][j] - body[j]) * hot)) : body;
          ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(front ? 0.9 : 0.16) * (1 - g)})`;
          ctx.lineWidth = 1.15 * dpr * (1 + 0.4 * hot);
          ctx.beginPath();
          const sg = s.seg;
          for (let k = 0; k < sg.length; k += 4) {
            proj(sg[k] * shrink, y, sg[k + 1] * shrink, q);
            const ax = q[0], ay = q[1], az = q[2];
            proj(sg[k + 2] * shrink, y, sg[k + 3] * shrink, q);
            if ((az + q[2] > 0) !== front) continue;
            ctx.moveTo(ax, ay); ctx.lineTo(q[0], q[1]);
          }
          ctx.stroke();
        }
      }
      // la ceinture
      if (melt < 0.98) {
        ctx.strokeStyle = 'rgba(255, 226, 190, 0.7)'; ctx.lineWidth = 1.3 * dpr;
        ring(Rp * 0.62, yf, 0, 0);
      }
      // les gouttes : elles partent du front et tombent jusqu'à la flaque
      let fr = slices[0];
      for (const s of slices) if (Math.abs(s.y - yf) < Math.abs(fr.y - yf)) fr = s;
      if (melt > 0.02 && melt < 0.98) {
        const sg = fr.seg, ns = sg.length / 4, nd = 9;
        for (let i = 0; i < nd; i++) {
          const cyc = t * 0.7 + i / nd, u = cyc % 1, k = 4 * Math.floor(((i * 0.618 + Math.floor(cyc) * 0.37) % 1) * ns);
          const y = yf * (1 - u * u);
          proj(sg[k], y, sg[k + 1], q);
          const hx = q[0], hy = q[1];
          proj(sg[k], Math.min(yf, y + Hh * 0.05), sg[k + 1], q);
          ctx.strokeStyle = `rgba(255, 236, 206, ${0.8 * (1 - u * 0.5)})`; ctx.lineWidth = 1.6 * dpr;
          ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(hx, hy); ctx.stroke();
        }
      }
    },
  };
}
