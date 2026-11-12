// Environnement de studio HDR (demi-flottants) : c'est lui que les métaux, le
// vernis et le verre reflètent. Fond très sombre et sources formées — boîtes
// à lumière, bandes, fenêtre, rebond du plateau — dont les bords adoucis
// donnent des reflets nets mais pas crénelés. Les pixels sont calculés dans
// un worker (gen/envmap.js) ; ici, la texture.
import * as THREE from 'three/webgpu';
import { ENV_PRESETS, envPixels } from '../gen/envmap.js';

export { ENV_PRESETS, envPixels };

// (une nouvelle texture à chaque changement : le pré-filtrage PMREM est
// associé à la texture)
// data : pixels de envPixels (calculés dans un worker), ou une clé de préréglage
export function makeEnvironment(data = 'studio', warmth = 0, W = 1024) {
  if (typeof data === 'string') data = envPixels(data, warmth, W);
  const H = W / 2;
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
