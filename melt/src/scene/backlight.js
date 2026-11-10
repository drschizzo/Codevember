// Lumière d'en dessous (table lumineuse, éclairage de Rheinberg), en
// fonction de la déviation δ d'un rayon par l'objet traversé.
//
// Un rayon qui traverse sans être dévié (le fond, une face plane) voit le
// champ lumineux (couleur A). Un rayon dévié de δ₁ à δ₂ voit l'anneau
// (couleur B : sur la table lumineuse, le bord plus sombre du champ ; en
// Rheinberg, le filtre annulaire coloré). Au-delà, le noir : c'est ce qui
// dessine les arêtes et les nervures des cristaux photographiés par
// transparence.
import * as THREE from 'three/webgpu';
import { uniform, smoothstep, mix, vec3, acos, clamp } from 'three/tsl';

export function createBacklight() {
  return {
    field: uniform(new THREE.Color(1, 1, 1)), ring: uniform(new THREE.Color(0.3, 0.3, 0.3)),
    d1: uniform(0.12), d2: uniform(0.5), soft: uniform(0.05), gain: uniform(1),
  };
}

// cosd : cosinus de la déviation
export function backlight(B, cosd) {
  const d = acos(clamp(cosd, -1, 1));
  const s1 = smoothstep(B.d1.sub(B.soft), B.d1.add(B.soft), d);
  const s2 = smoothstep(B.d2.sub(B.soft.mul(2)), B.d2.add(B.soft.mul(2)), d);
  return mix(mix(B.field, B.ring, s1), vec3(0), s2).mul(B.gain);
}

// réglages par support
export function setBacklight(B, sub) {
  if (sub.kind === 'glass') {
    B.field.value.set(sub.color).multiplyScalar(1.0);
    B.ring.value.set(sub.color2).multiplyScalar(0.35);
    B.d1.value = 0.1; B.d2.value = 0.42; B.soft.value = 0.05; B.gain.value = 1.5;
  } else {
    B.field.value.set(sub.color).multiplyScalar(1.6);
    B.ring.value.set(sub.color2).multiplyScalar(2.2);
    B.d1.value = 0.06; B.d2.value = 0.6; B.soft.value = 0.03; B.gain.value = 1.2;
  }
}
