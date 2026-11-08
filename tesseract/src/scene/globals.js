// Uniformes partagés par toute la scène.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const G = {
  phase: uniform(0),          // phase de la boucle [0, 1)
  // projection 4D → 3D (voir project.js) : distance de l'œil 4D, gonflement
  // vers la 3-sphère ; et leurs valeurs à l'image précédente (vecteurs vitesse)
  d: uniform(3), inflate: uniform(0), dPrev: uniform(3), inflatePrev: uniform(0),
  // panneaux ajourés du côté de l'œil 4D (voir project.js) : quantité, seuils
  reveal: uniform(1), revealLo: uniform(0.3), revealHi: uniform(0.9), revealDensity: uniform(9),
  // coupe : les panneaux tournés vers la caméra s'ajourent aussi (vue sur l'intérieur)
  cutaway: uniform(0.6), viewPos: uniform(new THREE.Vector3()), // (position de la caméra du film : la passe d'ombre a la sienne)
  // voyage intérieur : la paroi que la caméra va traverser s'ajoure (position
  // de la caméra dans l'espace projeté, part du voyage, distances au plan de
  // la paroi : ouverte / encore fermée, et demi-largeur de la porte)
  camLocal: uniform(new THREE.Vector3(0, 0, 50)), pass: uniform(0), passNear: uniform(0.1), passFar: uniform(0.36), passLat: uniform(1.05),
  // les deux portes du voyage (centre projeté, ouverture) : la précédente se
  // referme, la suivante s'ouvre avant la traversée
  voyageK: uniform(0),
  door0: uniform(new THREE.Vector4(0, 0, 50, 0)), door1: uniform(new THREE.Vector4(0, 0, 50, 0)),
  // profondeur 4D (w) lue en couleur sur l'ossature et le fantôme : froid loin
  // de l'œil 4D, chaud tout près
  depthTint: uniform(0), depthCold: uniform(new THREE.Color('#3b7bff')), depthWarm: uniform(new THREE.Color('#ff8a3b')),
  microDetail: uniform(1),    // intensité globale des micro-reliefs
  roughFloor: uniform(0.08),  // rugosité minimale (reflets jamais réduits à un point)
  nestEnv: uniform(0.45),     // part du studio encore visible depuis l'intérieur d'une cellule
  crystalThick: uniform(1),   // épaisseur optique des cristaux massifs (× leur taille)
};
