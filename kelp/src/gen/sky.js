// Le ciel (module pur) : une carte équirectangulaire HDR calculée dans un
// worker — dégradé du zénith à l'horizon, voile de brume, auréole du soleil
// (diffusion de Mie), nuages pour les ciels couverts, lune et étoiles la
// nuit ; sous l'horizon, la mer lointaine qui reflète le ciel (Fresnel
// rasant). Les métaux humides, l'eau et la peau mouillée des laminaires le
// reflètent ; scene/sky.js en fait la texture et le fond.
import { createNoise3 } from '../rng.js';

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

// direction du soleil dans le monde : azimut compté depuis l'arrière de la
// caméra (0 : dans le dos, π : en face), la caméra regardant vers −z tournée
// de `yaw` vers le large (−x)
export function sunDir(R) {
  const yaw = R.camera.yaw, el = R.sun.el, az = R.sun.az;
  const bx = Math.sin(yaw), bz = Math.cos(yaw); // (derrière la caméra)
  const c = Math.cos(az), s = Math.sin(az);
  const hx = bx * c - bz * s, hz = bx * s + bz * c;
  return [Math.cos(el) * hx, Math.sin(el), Math.cos(el) * hz];
}

// pixels RGBA demi-flottants, W × W/2
export function skyPixels(R, W = 1024) {
  const H = W / 2, out = new Uint16Array(W * H * 4);
  const S = R.sky, sd = sunDir(R), sc = hex(R.sun.color);
  const zen = S.zenith, hor = S.horizon, haze = S.haze, cloud = S.cloud, I = S.intensity;
  const N = createNoise3(`sky:${R.seed}`);
  const night = R.sun.moon;
  for (let j = 0; j < H; j++) {
    const el = ((j + 0.5) / H) * Math.PI - Math.PI / 2, ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i < W; i++) {
      const az = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const dx = Math.cos(az) * ce, dy = se, dz = Math.sin(az) * ce;
      const e = Math.max(0, el);
      // ciel clair : dégradé et brume d'horizon
      const g = e ** 0.42;
      let r = hor[0] + (zen[0] - hor[0]) * g, gg = hor[1] + (zen[1] - hor[1]) * g, b = hor[2] + (zen[2] - hor[2]) * g;
      const hz = Math.exp(-e / 0.08) * haze;
      r += hz * hor[0] * 0.6; gg += hz * hor[1] * 0.6; b += hz * hor[2] * 0.6;
      // auréole du soleil (Mie) et disque
      const cs = Math.max(-1, Math.min(1, dx * sd[0] + dy * sd[1] + dz * sd[2])), th = Math.acos(cs);
      const sunUp = sst(-0.12, 0.02, sd[1]);
      const aur = (night ? 0.5 : 1) * sunUp * (2.2 * Math.exp(-th / 0.06) + 0.7 * Math.exp(-th / 0.35) * (0.5 + haze)) * (1 - 0.6 * cloud);
      r += sc[0] * aur; gg += sc[1] * aur; b += sc[2] * aur;
      if (th < 0.0055 && sd[1] > -0.01) { const d = (night ? 12 : 40) * (1 - cloud * 0.95); r += sc[0] * d; gg += sc[1] * d; b += sc[2] * d; }
      // nuages : un voile en fBm, plus dense vers l'horizon, ombré selon le
      // soleil (plus épais du côté du soleil : plus sombre), un liseré
      // lumineux à contre-jour (diffusion vers l'avant), le dessous réchauffé
      // par l'horizon ; et des cirrus étirés, plus hauts
      if (cloud > 0 && el > 0) {
        const p = 1 / Math.max(0.08, se);
        const u = dx * p * 1.2, v = dz * p * 1.2;
        const n = N.fbm(u, 3.3, v, 5) * 0.5 + 0.5;
        const sx = sd[0] / Math.max(0.05, Math.hypot(sd[0], sd[2])), sz = sd[2] / Math.max(0.05, Math.hypot(sd[0], sd[2]));
        const n2 = N.fbm(u + sx * 0.08, 3.3, v + sz * 0.08, 4) * 0.5 + 0.5;
        const cov = sst(1 - cloud, 1.05 - cloud * 0.6, n) * sst(0, 0.06, e);
        // (un ciel couvert est doux : l'ombrage et le liseré s'effacent quand le voile se ferme)
        const open = 1 - sst(0.55, 0.95, cloud);
        const shade = Math.max(0.45, Math.min(1.25, 1 - (n2 - n) * 5 * open));
        const lit = (0.55 + 0.55 * Math.exp(-th / 0.5) * sunUp) * shade;
        const rim = sunUp * Math.exp(-th / 0.3) * cov * (1 - cov) * 4 * open;
        const cl = (night ? 0.02 : 0.95) * lit;
        const warm = (1 - sst(0, 0.25, e)) * 0.35;
        const cr = cl * (0.85 + 0.15 * sc[0]) * (1 - warm) + hor[0] * warm + sc[0] * rim * 1.5;
        const cg = cl * (0.85 + 0.15 * sc[1]) * (1 - warm) + hor[1] * warm + sc[1] * rim * 1.5;
        const cb = cl * (0.88 + 0.12 * sc[2]) * (1 - warm) + hor[2] * warm + sc[2] * rim * 1.5;
        r += (cr - r) * cov; gg += (cg - gg) * cov; b += (cb - b) * cov;
        if (!night && e > 0.03 && open > 0.05) {
          const ci = N.fbm(dx * p * 0.5 + 9.1, 7.7, dz * p * 4.0, 4) * 0.5 + 0.5;
          const cc = sst(0.62, 0.82, ci) * 0.3 * Math.min(1, cloud * 3) * sst(0.03, 0.2, e) * open;
          const cl2 = 0.9 + 0.8 * Math.exp(-th / 0.4) * sunUp;
          r += (cl2 * sc[0] - r) * cc; gg += (cl2 * sc[1] - gg) * cc; b += (cl2 * (0.9 + 0.1 * sc[2]) - b) * cc;
        }
      }
      // étoiles (la nuit)
      if (false && night && el > 0.05) { // (les étoiles sont dessinées au pixel par le ciel de la scène : stage.js)
        const fx = Math.floor((az + 4) * 260), fy = Math.floor((el + 2) * 260);
        const hsh = Math.sin(fx * 12.9898 + fy * 78.233) * 43758.5453, f = hsh - Math.floor(hsh);
        if (f > 0.9975) { const k = (f - 0.9975) * 400 * 0.6; r += k; gg += k; b += k * 1.1; }
      }
      // sous l'horizon : la mer au loin, qui reflète le ciel en incidence rasante
      if (el < 0) {
        const f = 0.02 + 0.98 * (1 - Math.min(1, -se * 1.0)) ** 5;
        const deep = R.water.tint;
        const k = Math.exp(el / 0.02);
        r = hor[0] * f * 0.9 + deep[0] * 0.08 * (1 - f) + hor[0] * k * 0.4;
        gg = hor[1] * f * 0.9 + deep[1] * 0.08 * (1 - f) + hor[1] * k * 0.4;
        b = hor[2] * f * 0.9 + deep[2] * 0.08 * (1 - f) + hor[2] * k * 0.4;
        // le chemin du soleil sur la mer
        const rx = dx, ry = -dy, rz = dz, cr = rx * sd[0] + ry * sd[1] + rz * sd[2];
        const glit = sunUp * Math.exp(-(1 - cr) / 0.004) * (1 - cloud) * (night ? 0.3 : 3);
        r += sc[0] * glit; gg += sc[1] * glit; b += sc[2] * glit;
      }
      const o = (j * W + i) * 4;
      out[o] = half(r * I); out[o + 1] = half(gg * I); out[o + 2] = half(b * I); out[o + 3] = half(1);
    }
  }
  // une version réduite (128 × 64, moyenne par blocs) : les reflets flous de l'eau
  const w2 = 128, h2 = 64, k = W / w2, small = new Uint16Array(w2 * h2 * 4), acc = new Float64Array(w2 * h2 * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = (j * W + i) * 4, q = (Math.floor(j / k) * w2 + Math.floor(i / k)) * 4;
    for (let c = 0; c < 4; c++) acc[q + c] += fromHalf(out[o + c]);
  }
  for (let q = 0; q < acc.length; q++) small[q] = half(acc[q] / (k * k));
  return { pixels: out, W, H, small, sw: w2, sh: h2, sun: sd };
}

function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
  return e === 0 ? s * (m / 1024) * 2 ** -14 : e === 31 ? 0 : s * 2 ** (e - 15) * (1 + m / 1024);
}

const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function half(v) {
  _f[0] = v; const x = _u[0];
  const sgn = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return sgn;
  if (e >= 31) return sgn | 0x7c00;
  return sgn | (e << 10) | (m >> 13);
}
