// Studios HDR propres à Echo, ajoutés à ceux de shared/gen/envmap.js : ce sont
// des pièces (une fenêtre, un plafond, les murs d'en face), pas des studios.
// Les métaux, la glace biseautée et les émaux les reflètent.
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

Object.assign(ENV_PRESETS, {
  // crépuscule : une fenêtre bleue à gauche, la pièce grise
  echoDusk: {
    label: 'Crépuscule', ambient: [0.044, 0.052, 0.072], floor: [0.02, 0.019, 0.018],
    lights: [[-2.2, 0.35, 0.35, 0.42, 0.06, 0.55, 0.7, 1.05], [1.4, 0.2, 0.7, 0.4, 0.3, 0.05, 0.055, 0.065]],
  },
  // nuit : presque rien, la fenêtre à peine
  echoNight: {
    label: 'Nuit', ambient: [0.012, 0.012, 0.018], floor: [0.006, 0.005, 0.005],
    lights: [[-2.0, 0.4, 0.3, 0.4, 0.06, 0.1, 0.13, 0.22]],
  },
  echoDark: {
    label: 'Noir', ambient: [0.006, 0.006, 0.007], floor: [0.003, 0.003, 0.003],
    lights: [[1.2, 0.5, 0.4, 0.2, 0.2, 0.02, 0.02, 0.022]],
  },
  // aube grise : une grande fenêtre laiteuse
  echoDawn: {
    label: 'Aube', ambient: [0.080, 0.084, 0.096], floor: [0.03, 0.03, 0.03],
    lights: [[-2.3, 0.4, 0.45, 0.45, 0.08, 0.9, 0.95, 1.05], [2.4, 0.2, 0.3, 0.3, 0.1, 0.5, 0.36, 0.28]],
  },
  // jour pâle : l'atelier blanc
  echoDay: {
    label: 'Jour', ambient: [0.240, 0.250, 0.270], floor: [0.1, 0.1, 0.1],
    lights: [[-2.5, 0.6, 0.6, 0.5, 0.15, 1.6, 1.7, 1.85], [0.8, 1.2, 1.2, 0.2, 0.2, 0.5, 0.52, 0.55]],
  },
});

export { ENV_PRESETS, envPixels };
