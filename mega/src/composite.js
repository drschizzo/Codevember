// Composition du relais. L'hôte possède deux emplacements (des cibles à la
// taille du canvas) ; chaque jour dessine dans celui de sa parité, si bien que
// le jour qui joue et celui qui se prépare n'en partagent jamais un. Les
// images sont déjà étalonnées (sortie de leur chaîne d'image) ; le passage
// propre au jour qui arrive (transitions.js : meta.enter) les mêle.
//
// Les nœuds de texture lisent toujours les deux mêmes emplacements : changer
// la texture d'un nœud laissait noire la première image d'un passage.
import * as THREE from 'three/webgpu';
import { texture, vec4, mix, uniform } from 'three/tsl';
import { createTransitions } from './transitions.js';

export function createComposite(renderer, width, height) {
  const slots = [0, 1].map((i) => {
    const rt = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
    rt.texture.name = `mega:slot${i}`; // (le registre des jours ne les prend pas)
    return rt;
  });
  const T = createTransitions(slots);
  const pipe = (node) => {
    const p = new THREE.RenderPipeline(renderer);
    p.outputColorTransform = false; // (les images des jours sont déjà en espace d'affichage)
    p.outputNode = node;
    return p;
  };
  const pipes = new Map();
  const forKind = (kind) => {
    if (!pipes.has(kind)) pipes.set(kind, pipe(T.build(kind)));
    return pipes.get(kind);
  };
  const which = uniform(0);
  const pass = pipe(vec4(mix(texture(slots[0].texture).rgb, texture(slots[1].texture).rgb, which), 1));
  const _s = new THREE.Vector2();

  return {
    U: T.U, kinds: T.kinds, slots,
    resize(w, h) { for (const s of slots) s.setSize(w, h); },
    // un seul jour : copie de son emplacement
    show(slot, target = null) {
      which.value = slot;
      renderer.setRenderTarget(target);
      pass.render();
      if (target) renderer.setRenderTarget(null);
    },
    // from : l'emplacement du jour qui s'en va
    blend(from, p, t, kind = 'fade', target = null) {
      T.U.swap.value = from; T.U.p.value = p; T.U.t.value = t;
      renderer.getDrawingBufferSize(_s);
      T.U.aspect.value = _s.x / Math.max(1, _s.y);
      renderer.setRenderTarget(target);
      forKind(kind).render();
      if (target) renderer.setRenderTarget(null);
    },
    // compile tous les passages d'avance (sous l'écran d'ouverture), dans une
    // cible jetable (jamais un emplacement, qu'ils lisent)
    warm() {
      const rt = new THREE.RenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: false });
      for (const s of slots) { renderer.setRenderTarget(s); renderer.clear(); }
      for (const k of T.kinds) { renderer.setRenderTarget(rt); forKind(k).render(); }
      renderer.setRenderTarget(rt); pass.render();
      renderer.setRenderTarget(null);
      rt.dispose();
    },
  };
}
