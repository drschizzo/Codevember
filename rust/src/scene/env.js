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
  // abysses : obscurité bleu-vert, bandes cyan et une lueur d'eau au-dessus
  abyss: {
    label: 'Abysses', ambient: [0.002, 0.006, 0.009], floor: [0.001, 0.003, 0.004],
    lights: [
      [-1.6, 1.2, 1.4, 0.25, 0.4, 0.25, 0.9, 1.1],
      [0.7, 0.15, 0.04, 0.5, 0.02, 0.4, 1.8, 2.0],
      [-2.4, 0.1, 0.03, 0.4, 0.015, 0.2, 1.1, 1.4],
    ],
  },
  // halle d'atelier : grande boîte à lumière au plafond, verrière, murs gris
  hall: {
    label: 'Halle', ambient: [0.05, 0.048, 0.045], floor: [0.07, 0.066, 0.06],
    lights: [
      [-0.7, 1.25, 1.4, 0.22, 0.25, 4.2, 4.1, 3.9],
      [2.3, 0.35, 0.5, 0.18, 0.12, 1.3, 1.3, 1.35],
      [-2.4, 0.3, 0.35, 0.16, 0.1, 0.9, 0.92, 1.0],
      [0.9, 0.12, 0.05, 0.4, 0.02, 1.1, 1.12, 1.18],
    ],
  },
  // quai : nuit froide, bandes de projecteurs lointains, reflets d'eau
  dock: {
    label: 'Quai', ambient: [0.008, 0.011, 0.016], floor: [0.012, 0.014, 0.018],
    lights: [
      [2.7, 0.3, 0.07, 0.5, 0.02, 2.4, 2.8, 3.4],
      [-2.2, 0.55, 0.3, 0.1, 0.05, 1.6, 1.7, 1.8],
      [1.0, 0.75, 0.6, 0.2, 0.2, 0.5, 0.6, 0.75],
      [-0.6, 0.05, 1.2, 0.05, 0.1, 0.25, 0.32, 0.42],
    ],
  },
  // plein soleil : ciel clair, disque solaire adouci, sol clair qui renvoie
  sun: {
    label: 'Soleil', ambient: [0.16, 0.2, 0.27], floor: [0.24, 0.21, 0.17],
    lights: [
      [-1.15, 1.1, 0.06, 0.06, 0.04, 26, 25, 23],
      [0, 1.35, 3.2, 0.25, 0.4, 0.35, 0.42, 0.55],
      [1.8, 0.15, 1.2, 0.12, 0.25, 0.3, 0.3, 0.32],
    ],
  },
  // nuit d'usine : noir, une bande haute et une lueur lointaine
  factory: {
    label: 'Usine', ambient: [0.004, 0.004, 0.005], floor: [0.006, 0.006, 0.006],
    lights: [
      [0.0, 1.35, 0.5, 0.08, 0.08, 2.6, 2.5, 2.4],
      [2.8, 0.2, 0.05, 0.35, 0.02, 1.2, 1.0, 0.85],
      [-2.7, 0.25, 0.04, 0.3, 0.02, 0.6, 0.7, 0.9],
    ],
  },
  // ciel couvert : dôme laiteux, plus clair en haut, pas de source nette
  overcast: {
    label: 'Couvert', ambient: [0.5, 0.53, 0.56], floor: [0.12, 0.125, 0.13],
    lights: [
      [0, 1.3, 3.2, 0.5, 0.6, 0.9, 0.95, 1.0],
      [-1.6, 0.4, 1.0, 0.3, 0.4, 0.25, 0.26, 0.28],
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
