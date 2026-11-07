// Matériaux de la machine : laiton patiné et satiné (il ne doit pas voler la
// vedette au disque), acier brossé, acier bleui, rubis, verre.
//
// Le laiton est un vrai métal : presque pas de diffus, il lit ses reflets (les
// softbox de l'environnement, la lampe, l'étoile). Chaque pièce tournée porte
// les sillons concentriques de l'outil, plus de fines rayures ; un vernis
// (clearcoat) pose un second reflet, net, sur le métal satiné.
import * as THREE from 'three/webgpu';
import {
  vec3, vec4, mix, positionLocal, mx_noise_float, float, normalWorld, positionWorld, normalize, dot, abs, pow, max,
  reflect, uniform, bumpMap, length, sin,
} from 'three/tsl';
import { toCamera, noVelocity } from '../render/common.js';

const machined = (period = 0.016) => {
  const rings = sin(length(positionLocal.xz).mul(6.2832 / period)).mul(0.5).add(0.5);
  const scratch = mx_noise_float(positionWorld.mul(vec3(3, 90, 3))).mul(0.5).add(0.5);
  return rings.mul(0.7).add(scratch.mul(0.3));
};

export function brass(tone = [0.86, 0.6, 0.26], rough = 0.44) {
  const m = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.95, roughness: rough, clearcoat: 0.45, clearcoatRoughness: 0.12 });
  m.normalNode = bumpMap(machined(), 0.25);
  // laiton brossé et patine irrégulière, en coordonnées monde (même grain pour
  // les pièces instanciées ou mises à l'échelle)
  const p = positionWorld;
  const brush = mx_noise_float(vec3(p.x.mul(14.0), p.y.mul(260.0), p.z.mul(14.0))).mul(0.5).add(0.5);
  const patina = mx_noise_float(p.mul(2.3)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(...tone).mul(0.8), vec3(...tone), brush).mul(patina.mul(0.3).add(0.72));
  m.roughnessNode = float(rough).add(brush.mul(0.1)).add(patina.mul(0.14));
  m.metalnessNode = float(0.97).sub(patina.pow(3.0).mul(0.25)); // patine : oxyde, un peu diélectrique
  return m;
}

// acier brossé (poli très fin, il renvoyait la lampe et l'étoile en éclats aveuglants)
export function steel() {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x737880, metalness: 1.0, roughness: 0.42 });
  m.normalNode = bumpMap(mx_noise_float(positionLocal.mul(vec3(4, 600, 4))).mul(0.5).add(0.5), 0.12);
  return m;
}

// acier bleui au feu : la couche d'oxyde produit des interférences (irisation
// bleu → pourpre selon l'angle), comme les vis et aiguilles d'horlogerie
export const blued = () => new THREE.MeshPhysicalNodeMaterial({ color: 0x1d3478, metalness: 0.9, roughness: 0.3,
  iridescence: 0.85, iridescenceIOR: 1.7, iridescenceThicknessRange: [260, 420], clearcoat: 0.3, clearcoatRoughness: 0.1 });
export const ruby = () => new THREE.MeshStandardNodeMaterial({ color: 0x9a1028, roughness: 0.16, metalness: 0.1, emissive: 0x2a0208 });
export const dark = () => new THREE.MeshStandardNodeMaterial({ color: 0x0c0a08, roughness: 0.7, metalness: 0.2 });

// métal mat texturé (gravures sur canevas : limbe, platine, cadrans)
export function engraved(map, color, metalness = 0.9, roughness = 0.5) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness, roughness });
  m.map = map;
  m.color = new THREE.Color(...color);
  return m;
}

// Verre : presque invisible, liseré au bord et reflets des deux lumières principales
export const glassK = uniform(1); // reflets sur le verre (atténués par le tournage)
export function glassMaterial(k = 1) {
  const gm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const V = toCamera(), N = normalize(normalWorld);
  const fres = pow(float(1).sub(abs(dot(N, V))), 4.0);
  const spec = pow(max(dot(reflect(V.negate(), N), normalize(vec3(-5.5, 16, 6.5))), 0), 120.0);
  const spec2 = pow(max(dot(reflect(V.negate(), N), normalize(vec3(6, 10, -11))), 0), 40.0);
  gm.colorNode = vec4(vec3(1.0, 0.96, 0.9).mul(fres.mul(0.06).add(spec.mul(0.14).add(spec2.mul(0.06)).mul(glassK)).mul(k)), 1);
  gm.mrtNode = noVelocity(); // (le verre ne brouille pas le flou de mouvement)
  gm.userData.glass = k;
  return gm;
}

// jeu de matériaux partagé par toutes les pièces
export function createMaterials() {
  return {
    brass: brass(),
    brassDark: brass([0.4, 0.34, 0.24], 0.55),
    bronze: brass([0.55, 0.38, 0.24], 0.4), // bagues et coussinets
    steel: steel(), blued: blued(), ruby: ruby(), dark: dark(),
  };
}
