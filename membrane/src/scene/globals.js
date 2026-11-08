// Uniformes partagés par toute la scène.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const G = {
  phase: uniform(0),          // phase de la boucle [0, 1)
  microDetail: uniform(1),    // intensité globale des micro-reliefs
  roughFloor: uniform(0.06),  // rugosité minimale (reflets jamais réduits à un point)
  backdropBlur: uniform(1),   // flou de ce que l'on voit au travers des membranes (× réglage de la membrane)
  grazing: uniform(1),        // épaississement optique en incidence rasante (silhouettes)
  sssBoost: uniform(1),       // intensité globale de la translucidité
  armEnv: uniform(0.6),       // part du studio que l'armature voit au travers de sa membrane
  bgColor: uniform(new THREE.Color(0, 0, 0)),
  coreColor: uniform(new THREE.Color(1, 0.7, 0.45)), coreGlow: uniform(8),
};
