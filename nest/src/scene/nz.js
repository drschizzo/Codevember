// Lecture du volume de bruit sautée quand son détail est effacé.
//
// Le volume de bruit commun (128³, sans mipmaps : three.js ne téléverse pas les
// niveaux d'une texture 3D) lu à une fréquence plus fine que le pixel sature le
// cache de textures : chaque pixel saute loin dans 16 Mo. Le papier du nid le
// lisait jusqu'à pos × 1500 ; vu de loin, ces lectures étaient multipliées par
// un fondu nul, mais faites quand même (Spore : une lecture, 1,2 ms à basse
// fréquence, 6,5 ms à haute fréquence).
//
// nzIf(p, w) : NZ(p) si w > 0 (w : le poids qui multipliera la lecture — un
// fondu, une partie de l'objet, une saison), sinon 0 sans lire. Le résultat
// multiplié par w est identique à NZ(p) · w.
import { Fn, If, vec4 } from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export const nzIf = (p, w) => Fn(() => {
  const r = vec4(0).toVar();
  // (niveau 0 : dans une branche, un échantillonnage implicite est interdit ;
  // les dérivées qui font w restent hors de la branche)
  If(w.greaterThan(1e-4), () => { r.assign(NZ(p).level(0)); });
  return r;
})();
