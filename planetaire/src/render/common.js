// Briques TSL partagées par le rendu et la machine.
import * as THREE from 'three/webgpu';
import { mrt, vec4, normalize, cameraPosition, positionWorld, length, uv } from 'three/tsl';

// options d'un matériau additif (lumière pure, sans écriture de profondeur)
export const additive = (extra = {}) => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });

// sortie MRT sans vecteur vitesse : l'objet ne participe pas au flou de mouvement
export const noVelocity = () => mrt({ velocity: vec4(0) });

// direction du point vers la caméra
export const toCamera = () => normalize(cameraPosition.sub(positionWorld));

// distance au centre d'un sprite, 0 au centre, 1 au bord
export const spriteRadius = () => length(uv().sub(0.5)).mul(2.0);
