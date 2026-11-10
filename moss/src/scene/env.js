// Environnement de studio HDR (demi-flottants), calculé en JS : c'est lui que
// les métaux, le vernis et le verre reflètent. Fond très sombre et sources
// formées — boîtes à lumière, bandes, fenêtre, rebond du plateau — dont les
// bords adoucis donnent des reflets nets mais pas crénelés.
import * as THREE from 'three/webgpu';
import { smoothstep as ss } from '../rng.js';

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
  // ── dehors (Moss) : ciel en dégradé (horizon, zénith, sol) et sources ──
  forest: {
    label: 'Sous-bois', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.10, 0.16, 0.07], [0.22, 0.32, 0.14], [0.05, 0.04, 0.025]],
    lights: [[-2.2, 1.05, 0.25, 0.2, 0.1, 3.2, 3.1, 2.7], [0.8, 0.9, 0.35, 0.25, 0.15, 1.2, 1.5, 0.9], [2.4, 0.6, 0.2, 0.15, 0.1, 0.8, 1.0, 0.6]],
  },
  overcast: {
    label: 'Ciel couvert', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.6, 0.64, 0.62], [0.95, 0.97, 0.96], [0.14, 0.14, 0.12]],
    lights: [[0, 1.4, 3.2, 0.3, 0.4, 0.6, 0.62, 0.62]],
  },
  fogwhite: {
    label: 'Brouillard', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.8, 0.82, 0.84], [0.95, 0.96, 0.98], [0.3, 0.3, 0.28]],
    lights: [[-2.6, 0.75, 0.15, 0.12, 0.08, 4, 3.9, 3.6]],
  },
  clearsky: {
    label: 'Ciel clair', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.55, 0.68, 0.85], [0.18, 0.34, 0.68], [0.3, 0.26, 0.2]],
    lights: [[-1.9, 1.15, 0.05, 0.05, 0.02, 60, 58, 52]],
  },
  dusk: {
    label: 'Soir', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.9, 0.55, 0.3], [0.18, 0.2, 0.3], [0.05, 0.04, 0.03]],
    lights: [[0.25, 0.22, 0.08, 0.06, 0.05, 30, 20, 10]],
  },
  nightsky: {
    label: 'Nuit claire', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.03, 0.04, 0.07], [0.008, 0.012, 0.03], [0.01, 0.01, 0.01]],
    lights: [[-1.2, 0.9, 0.03, 0.03, 0.01, 6, 7, 9], [2.4, 0.1, 1.0, 0.12, 0.25, 0.5, 0.35, 0.25]],
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

// (une nouvelle texture à chaque changement : le pré-filtrage PMREM est
// associé à la texture)
// (W : largeur de la carte ; 512 en mobile, quatre fois moins de pixels à
// calculer et à préfiltrer, pour des reflets à peine plus doux)
export function makeEnvironment(key = 'studio', warmth = 0, W = 1024) {
  const H = W / 2;
  const data = new Uint16Array(W * H * 4);
  {
    const P = ENV_PRESETS[key] || ENV_PRESETS.studio;
    const half = THREE.DataUtils.toHalfFloat;
    // teinte globale (chaud / froid) appliquée aux sources
    const wr = 1 + warmth * 0.18, wb = 1 - warmth * 0.18;
    for (let j = 0; j < H; j++) {
      const elev = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(elev); // rangée 0 = nadir
      for (let i = 0; i < W; i++) {
        const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
        const up = Math.max(0, y);
        let r = P.ambient[0] * (1 + up), g = P.ambient[1] * (1 + up), b = P.ambient[2] * (1 + up);
        if (P.sky) { // dégradé de ciel : horizon → zénith, sol sous l'horizon
          const [hz, zn, gd] = P.sky, t = Math.pow(up, 0.6), gr = ss(0.0, -0.15, y);
          for (let c = 0; c < 3; c++) { const v = (hz[c] + (zn[c] - hz[c]) * t) * (1 - gr) + gd[c] * gr; if (c === 0) r += v; else if (c === 1) g += v; else b += v; }
        }
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
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
