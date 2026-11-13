// Studios HDR propres au projet, ajoutés à ceux de shared/gen/envmap.js (le
// calcul des pixels est commun). Importé par le worker de génération et, par
// scene/env.js, par le fil principal : les deux voient les mêmes préréglages.
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

Object.assign(ENV_PRESETS, {
  // ── Spore ──
  // grève : ciel pâle et sable clair, un soleil bas
  shore: {
    label: 'Grève', ambient: [0, 0, 0], floor: [0, 0, 0], sky: [[0.78, 0.76, 0.7], [0.5, 0.6, 0.75], [0.55, 0.5, 0.42]],
    lights: [[-2.3, 0.35, 0.06, 0.06, 0.03, 40, 38, 34], [0.8, 0.5, 1.0, 0.4, 0.4, 0.4, 0.42, 0.45]],
  },
  // charbon : noir, une grande boîte au-dessus et une bande de contre-jour
  charcoal: {
    label: 'Brûlis', ambient: [0.004, 0.004, 0.005], floor: [0.004, 0.004, 0.004],
    lights: [[-1.6, 1.25, 0.7, 0.25, 0.2, 0.7, 0.7, 0.72], [1.45, 0.3, 0.6, 0.1, 0.12, 2.0, 2.0, 2.1], [-0.4, 0.15, 0.05, 0.4, 0.02, 0.35, 0.36, 0.38]],
  },
});

export { ENV_PRESETS, envPixels };
