// Rendu accumulé (export) : chaque image est la moyenne de N rendus complets,
// décalés d'un rien les uns des autres — dans le temps (l'obturateur reste
// ouvert : vrai flou de mouvement), sur la lentille (elle a un diamètre :
// vraie profondeur de champ, vrai bokeh), dans le pixel (anticrénelage) et sur
// la lampe (elle a une taille : vraie pénombre). L'export est déjà rendu image
// par image, hors temps réel : cela ne coûte que du temps de calcul.
//
// La moyenne se fait sur l'image finale (après étalonnage et tone mapping),
// ramenée en lumière linéaire : chaque rendu est une image exposée comme les
// autres, et un reflet très vif ne laisse pas de traînée de points blancs.
import * as THREE from 'three/webgpu';
import { texture, uniform, vec4, uv, sRGBTransferEOTF } from 'three/tsl';

export { jitter } from '../rng.js';

export function createAccumulator(renderer) {
  let frame = null, sum = null, add = null, show = null;
  const weight = uniform(1);
  function resize(w, h) {
    if (frame && frame.width === w && frame.height === h) return;
    frame?.dispose(); sum?.dispose(); add?.material.dispose(); show?.material.dispose();
    frame = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    sum = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    const ma = new THREE.MeshBasicNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
    ma.colorNode = vec4(sRGBTransferEOTF(texture(frame.texture, uv()).rgb).mul(weight), 1);
    add = new THREE.QuadMesh(ma);
    const ms = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
    ms.colorNode = vec4(texture(sum.texture, uv()).rgb, 1);
    show = new THREE.QuadMesh(ms);
  }
  return {
    // cible du rendu de chaque passe (l'image finale de la chaîne)
    begin(w, h) {
      resize(w, h);
      renderer.setRenderTarget(sum);
      renderer.clear();
      renderer.setRenderTarget(frame);
      return frame;
    },
    // ajoute la passe qui vient d'être rendue dans la cible, avec le poids w
    add(w) {
      weight.value = w;
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(sum);
      add.render(renderer);
      renderer.autoClear = auto;
      renderer.setRenderTarget(frame);
    },
    // affiche la moyenne sur le canevas
    present() {
      renderer.setRenderTarget(null);
      show.render(renderer);
    },
    get sum() { return sum; }, // (lumière linéaire, demi-flottants : mise au point)
    dispose() { frame?.dispose(); sum?.dispose(); frame = sum = null; },
  };
}
