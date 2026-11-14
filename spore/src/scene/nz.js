// Lecture du volume de bruit filtrée par l'empreinte du pixel.
//
// Le volume de bruit (128³, sans mipmaps : three.js ne téléverse pas les
// niveaux d'une texture 3D) lu à une fréquence plus fine que le pixel fait
// deux dégâts : un bruit replié (le TRAA le fait fourmiller) et un cache de
// textures saturé — chaque pixel saute loin dans 16 Mo. Mesuré sur le bois :
// une même lecture coûtait 1,2 ms à basse fréquence, 6,5 ms à g × 420.
//
// nzAA(p) : la valeur de NZ(p), fondue vers 0 (la moyenne du bruit) quand une
// cellule de bruit devient plus petite que [lo, hi] pixel, et non lue du tout
// une fois fondue. p est en cellules de bruit (comme NZ) ; foot : la partie
// spatiale de p dont on mesure l'empreinte (par défaut p ; à donner quand p
// contient un terme qui défile dans le temps, dont la dérivée n'est pas un
// détail à filtrer) ; gate : condition (nœud booléen) hors de laquelle on ne
// lit pas — la partie d'un objet qui porte ce détail (les dérivées restent
// calculées hors branche).
import { Fn, If, vec4, float, fwidth, smoothstep, max as tmax } from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export const nzAA = (p, lo = 0.25, hi = 0.6, foot = p, gate = null) => {
  // (dérivées hors de toute branche : WGSL les exige en flot uniforme)
  const w = fwidth(foot), cells = tmax(w.x, tmax(w.y, w.z));
  const fade = float(1).sub(smoothstep(lo, hi, cells));
  return Fn(() => {
    const r = vec4(0).toVar();
    // (lecture au niveau 0 : dans une branche, un échantillonnage implicite est interdit)
    const go = fade.greaterThan(0.002);
    If(gate ? go.and(gate) : go, () => { r.assign(NZ(p).level(0)); });
    return r.mul(fade);
  })();
};
