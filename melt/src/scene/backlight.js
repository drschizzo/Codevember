// Lumière d'en dessous, vue à travers la glace ou l'eau : on suit le rayon de
// l'œil à travers l'objet (deux réfractions) et on lit la lumière du dessous
// dans la direction où il ressort. Ce qui compte est sa DÉVIATION par
// rapport au rayon non dévié (le fond) :
//
//  - Rheinberg (microscope) : le condenseur porte un disque central coloré
//    (le champ) et un anneau d'une autre couleur. Un rayon peu dévié voit le
//    champ ; dévié de δ₁ à δ₂, il voit l'anneau — plus lumineux près de son
//    bord intérieur ; au-delà de l'ouverture de l'objectif (δ₂), le noir. Une
//    plaque plane a donc la couleur du fond, ses pentes s'allument dans celle
//    de l'anneau, ses arêtes et le bord des gouttes sont noirs.
//  - Verre (table lumineuse en dégradé coloré, comme les photographes de
//    flocons au laboratoire) : la couleur vue dépend du SENS de la déviation —
//    vers le haut de l'image, une teinte chaude ; vers le bas, une froide ; le
//    fond reste blanc. Le relief du cristal se lit en couleurs, comme en
//    strioscopie ; au-delà de δ₂ (réflexion presque totale), le noir.
import * as THREE from 'three/webgpu';
import { uniform, smoothstep, mix, vec3, acos, clamp, dot, length, max as tmax, float } from 'three/tsl';

export function createBacklight() {
  return {
    field: uniform(new THREE.Color(1, 1, 1)), ring: uniform(new THREE.Color(0.3, 0.3, 0.3)),
    warm: uniform(new THREE.Color(1, 0.6, 0.3)), cool: uniform(new THREE.Color(0.35, 0.6, 1)),
    d1: uniform(0.04), d2: uniform(0.3), soft: uniform(0.03), gain: uniform(1), mode: uniform(1), // (0 verre, 1 Rheinberg)
  };
}

// D : direction de sortie, V : direction de l'œil vers le point (repère de vue, unitaires)
export function backlight(B, D, V) {
  const d = acos(clamp(dot(D, V), -1, 1));
  const dark = smoothstep(B.d2.sub(B.soft.mul(2)), B.d2.add(B.soft.mul(2)), d);
  // Rheinberg : champ, puis anneau (plus vif près de son bord intérieur)
  const s1 = smoothstep(B.d1.sub(B.soft), B.d1.add(B.soft), d);
  const x = clamp(d.sub(B.d1).div(B.d2.sub(B.d1)), 0, 1);
  const ringI = float(1.7).sub(x.mul(x).mul(1.5)); // (vif au bord intérieur de l'anneau, sombre vers l'ouverture)
  const rb = mix(B.field, B.ring.mul(ringI), s1);
  // verre : teinte selon le sens de la déviation (composante verticale à l'écran)
  const dv = D.sub(V);
  const t = clamp(dv.y.mul(5), -1, 1);
  // (teinte légère : le cristal reste de la glace claire, ses pentes s'irisent
  // d'un côté ou de l'autre ; les plus fortes s'assombrissent)
  const dl = length(dv.xy);
  const k = clamp(dl.mul(9), 0, 1);
  // (la lumière déviée tombe encore sur la table : seules les très fortes
  // déviations — arêtes, bord des gouttes — sortent du champ et s'assombrissent)
  const tint = mix(B.field, mix(B.cool, B.warm, smoothstep(-1, 1, t)), k.mul(0.5))
    .mul(float(1).sub(smoothstep(0.12, 0.45, dl).mul(0.8)).sub(k.mul(0.12)));
  return mix(tint, rb, B.mode).mul(dark.oneMinus()).mul(B.gain);
}

// réglages par support
export function setBacklight(B, sub) {
  if (sub.kind === 'glass') {
    B.mode.value = 0;
    B.field.value.set(sub.color);
    B.warm.value.set(sub.warm ?? '#ffb36b'); B.cool.value.set(sub.cool ?? '#6fa6ff');
    B.d1.value = 0.04; B.d2.value = 0.6; B.soft.value = 0.05; B.gain.value = 1.4;
  } else {
    B.mode.value = 1;
    B.field.value.set(sub.color).multiplyScalar(1.6);
    B.ring.value.set(sub.color2).multiplyScalar(1.3);
    B.d1.value = 0.035; B.d2.value = 0.22; B.soft.value = 0.02; B.gain.value = 1.2;
  }
}
