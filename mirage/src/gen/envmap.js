// Studios HDR propres au projet, ajoutés à ceux de shared/gen/envmap.js (le
// calcul des pixels est commun). Importé par le worker de génération et, par
// scene/env.js, par le fil principal : les deux voient les mêmes préréglages.
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

Object.assign(ENV_PRESETS, {
  // ── Mirage : des pièces assez claires pour que l'argent poli se lise comme
  // de l'argent (un miroir ne montre que ce qui l'entoure) ──
  cabinetM: {
    label: 'Cabinet', ambient: [0.075, 0.052, 0.036], floor: [0.05, 0.03, 0.018],
    lights: [
      [-2.4, 1.05, 0.55, 0.3, 0.12, 5.5, 4.6, 3.4],
      [0.7, 0.25, 0.22, 0.45, 0.05, 1.6, 1.75, 2.0],
      [2.3, 0.45, 0.35, 0.18, 0.08, 1.3, 1.0, 0.7],
      [-0.6, 1.45, 1.6, 0.12, 0.2, 0.9, 0.75, 0.6],
    ],
  },
  atelierM: {
    label: 'Atelier', ambient: [0.16, 0.16, 0.165], floor: [0.07, 0.065, 0.06],
    lights: [
      [0, 1.2, 2.2, 0.035, 0.02, 5, 5, 5.1],
      [0, 0.95, 2.2, 0.035, 0.02, 4, 4, 4.1],
      [-2.2, 0.35, 0.6, 0.35, 0.1, 2.4, 2.45, 2.6],
      [1.2, 0.2, 0.05, 0.5, 0.02, 2.0, 2.0, 2.1],
    ],
  },
  salonM: {
    label: 'Salon', ambient: [0.36, 0.35, 0.33], floor: [0.25, 0.24, 0.22],
    lights: [
      [-1.7, 0.5, 0.5, 0.55, 0.06, 4.5, 4.6, 4.8],
      [-0.9, 0.5, 0.18, 0.55, 0.06, 3.2, 3.3, 3.5],
      [1.6, 1.1, 1.4, 0.3, 0.4, 1.2, 1.18, 1.1],
    ],
  },
  nuitM: {
    label: 'Nuit', ambient: [0.008, 0.01, 0.018], floor: [0.006, 0.006, 0.01],
    lights: [
      [-2.0, 0.55, 0.32, 0.5, 0.04, 0.35, 0.55, 1.1],
      [2.3, 0.75, 0.14, 0.1, 0.06, 6.0, 4.2, 2.4],
      [0.4, 1.3, 1.5, 0.1, 0.25, 0.12, 0.13, 0.18],
    ],
  },
});

export { ENV_PRESETS, envPixels };
