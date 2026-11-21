// Spore comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique (la caméra du film,
// construite quand le site est calculé ; le volume de fumée dans sa passe à
// demi-résolution ; look.push avance la caméra vers ce qu'elle vise). Ce
// module ne fait que brancher le cœur sur le kit du relais (réglages par
// défaut, pas de mode léger, raccord de la boucle, cible du jour).
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay, disposeScene } from '../../mega/src/kit.js';

export const meta = { id: 'spore', name: 'Spore', subtitle: 'le relais', seed: 's9', enter: 'spore' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  // (comme main.js au bureau : le nombre de workers par défaut de createGenerator)
  const gen = generatorFor('spore', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  core.setRecipe(generate(seed));
  let lap = null;
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => {
      // Raccord de la boucle (la caméra recule de L) : vitesses nulles et
      // historique repris, comme la boucle de main.js
      const lp = Math.floor(u);
      if (lp !== lap) { if (lap !== null) core.post.cut(); lap = lp; }
      core.renderAt(u, { push });
    },
    // (la scène de la fumée et sa passe ne sont pas dans la scène principale)
    extraDispose: () => { core.smokePass?.dispose(); disposeScene(core.stage.smokeScene); },
  });
}
