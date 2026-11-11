// Uniformes partagés par toute la scène.
import { uniform } from 'three/tsl';

export const G = {
  time: uniform(0),        // temps de la boucle (s), après le ralenti
  timePrev: uniform(0),    // celui de l'image précédente (vecteurs vitesse)
  phase: uniform(0),       // phase de la boucle [0, 1)
  frame: uniform(0),       // compteur d'images (tramages renouvelés, lissés par le TRAA)
  microDetail: uniform(1), // intensité globale des micro-reliefs
  roughFloor: uniform(0.06), // rugosité minimale
  uvLight: uniform(0),     // lumière noire (fluorescence du verre à l'uranium)
};
