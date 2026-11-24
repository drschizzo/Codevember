// Le ciel polaire du soleil de minuit, en studio HDR (shared/gen/envmap.js) :
// un dégradé du blanc bleuté de l'horizon au bleu du zénith, le reflet de la
// neige sous l'horizon, et l'auréole du soleil. L'auréole est dessinée à
// l'azimut 0 ; la scène fait tourner l'environnement pour la placer derrière
// le vrai soleil (stage.envYaw).
import { ENV_PRESETS } from '../../../shared/gen/envmap.js';

ENV_PRESETS.polar = {
  label: 'Ciel polaire',
  ambient: [0.0, 0.0, 0.0],
  floor: [0.55, 0.57, 0.6],
  sky: [[0.78, 0.86, 0.98], [0.16, 0.32, 0.72], [0.7, 0.72, 0.76]],
  lights: [
    // [azimut, élévation, ½ largeur, ½ hauteur, flou, r, g, b] : l'auréole du soleil bas
    [0, 0.19, 0.18, 0.12, 0.25, 4.5, 4.0, 3.2],
    [0, 0.19, 0.03, 0.03, 0.02, 40, 36, 30],
  ],
};
export const SKY_SUN_ELEVATION = 0.19;
