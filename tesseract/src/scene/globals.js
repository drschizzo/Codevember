// Uniformes partagés par toute la scène.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// Mode allégé (mobile) : fixé au chargement, avant la construction du premier
// matériau (voir materials.js, setLite). Simple drapeau JS : il change ce que
// les shaders contiennent, pas une valeur qu'ils lisent.
export const MODE = { lite: false };

export const G = {
  phase: uniform(0),          // phase de la boucle [0, 1)
  // projection 4D → 3D (voir project.js) : distance de l'œil 4D, gonflement
  // vers la 3-sphère ; et leurs valeurs à l'image précédente (vecteurs vitesse)
  d: uniform(3), inflate: uniform(0), dPrev: uniform(3), inflatePrev: uniform(0),
  // ajourage : densité de la trame de trous (les ouvertures des faces sont
  // calculées en JS, voir reveal.js)
  revealDensity: uniform(9),
  dither: uniform(1),         // bord des trous tramé (1 sous anticrénelage temporel)
  // part du voyage intérieur (éclairage des pièces)
  voyageK: uniform(0),
  // profondeur 4D (w) lue en couleur sur l'ossature et le fantôme : froid loin
  // de l'œil 4D, chaud tout près
  depthTint: uniform(0), depthCold: uniform(new THREE.Color('#3b7bff')), depthWarm: uniform(new THREE.Color('#ff8a3b')),
  microDetail: uniform(1),    // intensité globale des micro-reliefs
  patina: uniform(1),
  // passage de la caméra à l'entrée et à la sortie du voyage (voir project.js,
  // revealMask) : ouverture, direction du rayon (espace projeté), rayon du trou
  // près du centre et sa croissance au loin
  tunnel: uniform(0), tunnelDir: uniform(new THREE.Vector3(1, 0, 0)), tunnelR: uniform(0.3), tunnelTan: uniform(0.3),         // patine des parois (encrassement aux jonctions, marbrure)
  roughFloor: uniform(0.08),  // rugosité minimale (reflets jamais réduits à un point)
  nestEnv: uniform(0.45),     // part du studio encore visible depuis l'intérieur d'une cellule
  crystalThick: uniform(1),   // épaisseur optique des cristaux massifs (× leur taille)
};
