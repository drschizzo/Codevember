// Studios HDR propres au projet, ajoutés à ceux de shared/gen/envmap.js (le
// calcul des pixels est commun). Importé par le worker de génération et, par
// scene/env.js, par le fil principal : les deux voient les mêmes préréglages.
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

Object.assign(ENV_PRESETS, {
  // ── Erosion ──
  // hall d'essais : grandes boîtes zénithales, murs gris moyen
  lab: {
    label: 'Laboratoire', ambient: [0.16, 0.16, 0.165], floor: [0.12, 0.12, 0.12],
    lights: [
      [-2.2, 1.2, 1.4, 0.18, 0.12, 2.6, 2.6, 2.55],
      [0.9, 1.2, 1.4, 0.18, 0.12, 2.4, 2.45, 2.5],
      [-0.6, 0.25, 0.6, 0.15, 0.1, 0.6, 0.6, 0.62],
    ],
  },
  // atelier sombre, une grande fenêtre basse (le soleil couchant y entre)
  window: {
    label: 'Fenêtre', ambient: [0.02, 0.017, 0.014], floor: [0.03, 0.022, 0.016],
    lights: [
      [-0.35, 0.3, 0.55, 0.32, 0.06, 3.2, 2.5, 1.7],
      [2.6, 0.5, 0.3, 0.2, 0.1, 0.2, 0.25, 0.35],
    ],
  },
  // pièce noire : presque rien, un rebond lointain
  dark: {
    label: 'Noir', ambient: [0.006, 0.006, 0.007], floor: [0.008, 0.008, 0.008],
    lights: [[1.57, 0.12, 0.3, 0.1, 0.1, 0.5, 0.48, 0.45], [0, 0.4, 0.25, 0.12, 0.1, 0.3, 0.3, 0.32]],
  },
});

export { ENV_PRESETS, envPixels };
