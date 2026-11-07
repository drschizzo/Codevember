// Uniformes partagés par toute la scène (matériaux, pièces animées, poussière).
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const G = {
  D: uniform(4),            // distance caméra–centre (échelle de la plongée)
  envFalloff: uniform(0.6), // occultation de l'environnement vers le centre
  phase: uniform(0),        // phase de la boucle [0, 1)
  microDetail: uniform(1),  // intensité globale des micro-reliefs
  roughFloor: uniform(0.12), // douceur des reflets : rugosité minimale (sources ponctuelles → reflets étendus)
  // halo du cœur : près du cœur, les coquilles baignent dans sa lumière et s'y
  // fondent — une coquille qui naît émerge du rayonnement, sans apparaître
  coreR: uniform(0.2), coreColor: uniform(new THREE.Color(1, 0.8, 0.6)), coreGlow: uniform(10), halo: uniform(2.4),
  // plongée : rapport entre couches, profondeur de naissance (voir nest.js).
  // La profondeur relative d'un objet du nid se déduit de son échelle (D·kˣ).
  ratio: uniform(0.62), XB: uniform(7),
  // image précédente : avancée de la plongée depuis (la profondeur d'un objet
  // était x + dTau), et phase d'alors (mouvement propre des pièces animées)
  dTau: uniform(0), phasePrev: uniform(0),
};

