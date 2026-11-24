// Studios HDR propres à Burrow : la pièce vue depuis le sablier. Murs clairs ou
// sombres selon l'humeur, la fenêtre à gauche (azimut π : vers −x), le plafond,
// le rebond de la table. Ils s'ajoutent à ceux de shared/ (sans les modifier).
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

// [azimut, élévation, ½ largeur, ½ hauteur, flou, r, g, b]
const room = (label, wall, floor, win, extra = []) => ({
  label, ambient: wall, floor,
  lights: [
    [Math.PI, 0.42, 0.42, 0.55, 0.06, ...win.map((c) => c * 0.45)], // la fenêtre
    [Math.PI, 0.42, 0.012, 0.55, 0.004, ...win.map((c) => -c * 0.38)], // son meneau (vertical)
    [0, 1.45, 3.2, 0.18, 0.4, ...wall.map((c) => c * 0.6)], // le plafond
    // les portes-fenêtres derrière la caméra (azimut π/2 : vers +z) : ce que
    // reflètent les verres des tranches, des rectangles séparés par les trumeaux
    ...[-0.55, 0, 0.55].map((d) => [Math.PI / 2 + d, 0.25, 0.2, 0.55, 0.05, ...win.map((c) => c * 0.55)]),
    ...extra,
  ],
});
Object.assign(ENV_PRESETS, {
  roomPale: room('Pièce claire', [0.07, 0.07, 0.075], [0.09, 0.085, 0.08], [6, 6, 6.2]),
  roomWinter: room('Pièce d’hiver', [0.04, 0.05, 0.07], [0.05, 0.055, 0.065], [5, 5.6, 6.8], [[0.6, 0.05, 1.2, 0.08, 0.2, 0.6, 0.75, 1.0]]),
  roomGreen: room('Verrière', [0.08, 0.095, 0.085], [0.07, 0.08, 0.07], [4, 4.3, 4], [[0, 1.2, 3.2, 0.4, 0.3, 2.2, 2.4, 2.2]]),
  roomDark: room('Cabinet', [0.012, 0.011, 0.012], [0.02, 0.018, 0.016], [0.4, 0.38, 0.36], [[-0.9, 0.5, 0.18, 0.12, 0.05, 2.6, 2.3, 1.9]]),
  roomWhite: room('Midi', [0.12, 0.12, 0.12], [0.16, 0.155, 0.15], [7, 7, 6.8]),
  roomSlate: room('Nord', [0.05, 0.048, 0.046], [0.04, 0.038, 0.036], [3.6, 3.8, 4.1]),
});

export { ENV_PRESETS, envPixels };
