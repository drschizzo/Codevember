// Matières de l'appareil, par rôle (structure, ferrures, cage, bois, œil,
// verre de l'ampoule, filament). Physiques, au F0 mesuré pour les métaux ;
// le bois porte un fil (veinage) dans le repère de la pièce au repos.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, positionGeometry, mix, smoothstep, abs, sin, color, dFdx, dFdy, normalViewGeometry } from 'three/tsl';
import { noise, fbm, stableVelocity } from '../../../shared/scene/materials.js';
export { MAT as MATERIALS };

import { MATERIALS as MAT } from './materials-list.js';


export function solidMaterial(key, { minRough = 0 } = {}) {
  const D = MAT[key] ?? MAT.brass;
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
  const p = positionGeometry;
  if (D.wood) {
    // fil du bois le long de la pièce (axe y au repos), cernes ondulés
    const w = noise(p.mul(vec3(14, 1.6, 14))).mul(1.2);
    const rings = abs(sin(p.x.mul(160).add(p.z.mul(130)).add(w.mul(6)))).pow(3);
    const g = fbm(p.mul(vec3(30, 3, 30)), 3).mul(0.5).add(0.5);
    m.colorNode = mix(color(D.color), color(D.color2), rings.mul(0.55).add(g.mul(0.3)));
    m.roughnessNode = float(D.rough).add(rings.mul(0.12));
  } else {
    const g = fbm(p.mul(40), 2).mul(0.5).add(0.5);
    m.colorNode = color(D.color);
    m.roughnessNode = float(D.rough).mul(g.mul(0.3).add(0.85));
  }
  if (minRough > 0) m.roughnessNode = m.roughnessNode.max(minRough);
  // anticrénelage spéculaire (Kaplanyan) : là où la normale tourne vite d'un
  // pixel à l'autre (tubes fins, arêtes arrondies vues de loin), le reflet
  // s'élargit au lieu de scintiller
  {
    const dx = dFdx(normalViewGeometry), dy = dFdy(normalViewGeometry);
    const v = dx.dot(dx).add(dy.dot(dy)).mul(0.5).min(0.3);
    m.roughnessNode = m.roughnessNode.mul(m.roughnessNode).add(v).sqrt();
  }
  m.metalnessNode = float(D.metal);
  if (D.cc) { m.clearcoat = D.cc; m.clearcoatRoughness = 0.06; }
  m.mrtNode = stableVelocity();
  return m;
}

// verre de l'ampoule : mince, presque invisible, sauf ses reflets
export function bulbMaterial() {
  const m = new THREE.MeshPhysicalNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  m.colorNode = color('#ffffff');
  m.roughness = 0.04; m.metalness = 0; m.opacity = 0.18;
  m.mrtNode = stableVelocity();
  return m;
}
// filament : émission (la lampe elle-même, hors d'échelle : le bloom la dessine)
export function filamentMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = vec4(U.filament, 1);
  m.mrtNode = stableVelocity();
  return m;
}
