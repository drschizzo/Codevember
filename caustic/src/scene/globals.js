// Uniformes partagés par toute la scène (matériaux, pièces animées).
// Tout ce qui varie dans le temps passe par ici ou par des uniformes propres
// à un objet : modifier une valeur ne recompile jamais rien.
import { uniform } from 'three/tsl';

export const G = {
  phase: uniform(0),          // phase de la boucle [0, 1)
  phasePrev: uniform(0),      // phase de l'image précédente (vecteurs vitesse des pièces animées)
  frame: uniform(0),          // compteur d'images (tramages renouvelés, lissés par le TRAA)
  microDetail: uniform(1),    // intensité globale des micro-reliefs
  roughFloor: uniform(0.08),  // rugosité minimale : un reflet n'est jamais réduit à un point
  envI: uniform(1),           // intensité du studio (reflets calculés à la main : eau, vitre)
};
