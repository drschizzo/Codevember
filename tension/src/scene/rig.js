// Déformation des sommets dans le vertex shader (pièces animées).
//
// materials.js appelle rigPosition(M, full) : `full` vaut vrai pour le rendu
// (il faut alors aussi tourner normalLocal / tangentLocal et donner
// positionPrevious, la pose à l'image précédente : sans elle, l'anticrénelage
// temporel garde des images fantômes des pièces qui bougent) et faux pour la
// carte d'ombre (la position seule).
//
// Par défaut, aucune déformation : l'objet bouge par sa matrice, et three.js
// calcule seul ses vecteurs vitesse. Pour une pièce articulée, donner
// M.rig = (full) => nœud de position (voir membrane/src/scene/rig.js et
// hollow/src/scene/rig.js : pivot, axe, amplitude par sommet, en attributs).
import { positionLocal } from 'three/tsl';

export function rigPosition(M, full) {
  return M?.rig ? M.rig(full) : positionLocal;
}
