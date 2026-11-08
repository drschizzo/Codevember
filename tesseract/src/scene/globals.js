// Uniformes partagés par toute la scène.
import { uniform } from 'three/tsl';

export const G = {
  phase: uniform(0),          // phase de la boucle [0, 1)
  // projection 4D → 3D (voir project.js) : distance de l'œil 4D, gonflement
  // vers la 3-sphère ; et leurs valeurs à l'image précédente (vecteurs vitesse)
  d: uniform(3), inflate: uniform(0), dPrev: uniform(3), inflatePrev: uniform(0),
  // panneaux ajourés du côté de l'œil 4D (voir project.js) : quantité, seuils
  reveal: uniform(1), revealLo: uniform(0.3), revealHi: uniform(0.9), revealDensity: uniform(9),
  microDetail: uniform(1),    // intensité globale des micro-reliefs
  roughFloor: uniform(0.08),  // rugosité minimale (reflets jamais réduits à un point)
};
