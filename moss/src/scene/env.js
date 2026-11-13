// Environnement de studio HDR (demi-flottants), calculé en JS : c'est lui que
// les métaux, le vernis et le verre reflètent. Fond très sombre et sources
// formées — boîtes à lumière, bandes, fenêtre, rebond du plateau — dont les
// bords adoucis donnent des reflets nets mais pas crénelés.
import * as THREE from 'three/webgpu';
import { ENV_PRESETS, envPixels } from '../../../shared/gen/envmap.js';

export { ENV_PRESETS };

// (une nouvelle texture à chaque changement : le pré-filtrage PMREM est
// associé à la texture)
// (W : largeur de la carte ; 512 en mobile, quatre fois moins de pixels à
// calculer et à préfiltrer, pour des reflets à peine plus doux)
export function makeEnvironment(key = 'studio', warmth = 0, W = 1024, data = null) {
  const H = W / 2;
  data ??= envPixels(key, warmth, W); // (sinon calculé par le worker : gen.request({ key, warmth, W }, 'env'))
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
