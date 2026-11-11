// Environnement de studio HDR (demi-flottants) : les pixels, calculés hors du
// fil principal (worker de génération, voir gen/worker.js) — à 1024 × 512, le
// calcul tenait la page plusieurs secondes. Ce module ne dépend de rien.
// La texture elle-même est faite par scene/env.js.
import { smoothstep as ss } from '../math4.js';

// [azimut, élévation, ½ largeur, ½ hauteur, flou, r, g, b] (azimut / élévation en radians)
export const ENV_PRESETS = {
  studio: {
    label: 'Studio', ambient: [0.012, 0.012, 0.014], floor: [0.03, 0.028, 0.026],
    lights: [
      [-2.3, 0.85, 0.5, 0.26, 0.06, 6.5, 6.4, 6.2],
      [0.6, 0.1, 0.05, 0.6, 0.015, 2.2, 2.3, 2.5],
      [-0.95, 0.15, 0.04, 0.5, 0.015, 1.6, 1.7, 1.9],
      [2.4, 0.3, 0.22, 0.14, 0.03, 1.2, 1.2, 1.25],
      [0.0, -0.6, 0.9, 0.12, 0.2, 0.25, 0.25, 0.26],
    ],
  },
  atelier: {
    label: 'Atelier', ambient: [0.014, 0.011, 0.009], floor: [0.05, 0.032, 0.018],
    lights: [
      [-2.45, 1.0, 0.42, 0.22, 0.05, 7.0, 6.0, 4.6],
      [0.55, 0.12, 0.05, 0.55, 0.02, 0.7, 0.95, 1.5],
      [-0.9, 0.2, 0.04, 0.45, 0.02, 0.45, 0.62, 1.0],
      [2.2, 0.35, 0.18, 0.12, 0.03, 1.4, 1.05, 0.7],
    ],
  },
  night: {
    label: 'Nuit', ambient: [0.004, 0.005, 0.009], floor: [0.006, 0.008, 0.016],
    lights: [
      [-2.0, 0.7, 0.06, 0.6, 0.02, 0.9, 1.6, 3.6],
      [0.8, 0.2, 0.04, 0.5, 0.015, 2.6, 0.8, 1.9],
      [2.6, 0.9, 0.3, 0.12, 0.05, 1.0, 1.2, 1.6],
      [-0.4, -0.2, 0.02, 0.3, 0.01, 0.5, 1.4, 1.6],
    ],
  },
  softbox: {
    label: 'Boîte à lumière', ambient: [0.05, 0.05, 0.052], floor: [0.08, 0.075, 0.07],
    lights: [
      [-1.8, 0.9, 1.1, 0.5, 0.25, 3.2, 3.15, 3.0],
      [1.4, 0.4, 0.6, 0.4, 0.2, 1.6, 1.6, 1.65],
      [0.6, 0.1, 0.05, 0.6, 0.02, 1.4, 1.45, 1.5],
    ],
  },
  // cyclorama blanc : tout baigne dans une lumière laiteuse, quelques bandes nettes
  cyclo: {
    label: 'Cyclorama blanc', ambient: [0.42, 0.42, 0.43], floor: [0.55, 0.55, 0.54],
    lights: [
      [-1.9, 0.8, 1.2, 0.6, 0.3, 2.4, 2.4, 2.45],
      [0.7, 0.15, 0.05, 0.7, 0.02, 3.0, 3.0, 3.1],
      [-0.6, 0.2, 0.04, 0.6, 0.02, 2.2, 2.25, 2.3],
      [2.5, 0.4, 0.5, 0.3, 0.2, 1.4, 1.4, 1.42],
    ],
  },
  // abysses : obscurité bleu-vert, bandes cyan et une lueur d'eau au-dessus
  abyss: {
    label: 'Abysses', ambient: [0.002, 0.006, 0.009], floor: [0.001, 0.003, 0.004],
    lights: [
      [-1.6, 1.2, 1.4, 0.25, 0.4, 0.25, 0.9, 1.1],
      [0.7, 0.15, 0.04, 0.5, 0.02, 0.4, 1.8, 2.0],
      [-2.4, 0.1, 0.03, 0.4, 0.015, 0.2, 1.1, 1.4],
    ],
  },
};

// flottant → demi-flottant (même table que THREE.DataUtils.toHalfFloat)
const _buf = new ArrayBuffer(4), _f32 = new Float32Array(_buf), _u32 = new Uint32Array(_buf);
const _base = new Uint32Array(512), _shift = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
  const e = i - 127;
  if (e < -27) { _base[i] = 0x0000; _base[i | 0x100] = 0x8000; _shift[i] = 24; _shift[i | 0x100] = 24; }
  else if (e < -14) { _base[i] = 0x0400 >> (-e - 14); _base[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000; _shift[i] = -e - 1; _shift[i | 0x100] = -e - 1; }
  else if (e <= 15) { _base[i] = (e + 15) << 10; _base[i | 0x100] = ((e + 15) << 10) | 0x8000; _shift[i] = 13; _shift[i | 0x100] = 13; }
  else if (e < 128) { _base[i] = 0x7c00; _base[i | 0x100] = 0xfc00; _shift[i] = 24; _shift[i | 0x100] = 24; }
  else { _base[i] = 0x7c00; _base[i | 0x100] = 0xfc00; _shift[i] = 13; _shift[i | 0x100] = 13; }
}
function half(v) {
  _f32[0] = Math.max(-65504, Math.min(65504, v));
  const f = _u32[0], e = (f >> 23) & 0x1ff;
  return _base[e] + ((f & 0x007fffff) >> _shift[e]);
}

// pixels RGBA (demi-flottants) de la carte équirectangulaire W × W/2
// (W : 512 en mobile, quatre fois moins de pixels à calculer et à préfiltrer,
// pour des reflets à peine plus doux)
export function envPixels(key = 'studio', warmth = 0, W = 1024) {
  const H = W / 2;
  const data = new Uint16Array(W * H * 4);
  {
    const P = ENV_PRESETS[key] || ENV_PRESETS.studio;
    // teinte globale (chaud / froid) appliquée aux sources
    const wr = 1 + warmth * 0.18, wb = 1 - warmth * 0.18;
    for (let j = 0; j < H; j++) {
      const elev = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(elev); // rangée 0 = nadir
      for (let i = 0; i < W; i++) {
        const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
        const up = Math.max(0, y);
        let r = P.ambient[0] * (1 + up), g = P.ambient[1] * (1 + up), b = P.ambient[2] * (1 + up);
        const fl = ss(-0.05, -0.5, y);
        r += fl * P.floor[0]; g += fl * P.floor[1]; b += fl * P.floor[2];
        for (const [az, el, w, h, sf, lr, lg, lb] of P.lights) {
          let d = Math.abs(phi - az); d = Math.min(d, Math.PI * 2 - d);
          const k = ss(w + sf, w - sf, d * Math.cos(elev)) * ss(h + sf, h - sf, Math.abs(elev - el));
          if (k > 0) { r += k * lr * wr; g += k * lg; b += k * lb * wb; }
        }
        const o = (j * W + i) * 4;
        data[o] = half(r); data[o + 1] = half(g); data[o + 2] = half(b); data[o + 3] = half(1);
      }
    }
  }
  return data;
}
