// Tension comme jour de la méga-scène (mega/). La scène, sa préparation (les
// simulations de la troupe, le film, les pièces tournées) et le rendu d'une
// phase (travelling, montage en plans et ses raccords) sont ceux de la page :
// core.js, la source unique. Ce module ne fait que brancher le cœur sur le kit
// du relais (réglages par défaut, pas de mode léger, cible du jour) ;
// look.push avance la caméra vers ce que regarde le plan.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'tension', name: 'Tension', subtitle: 'ce qui tient ne pousse pas', seed: 'z76lqn', enter: 'cables' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('tension', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER, relay: true });
  core.applyRender();
  core.setRecipe(generate(seed)).catch((e) => console.error(e)); // (un échec : le jour ne sera jamais prêt)
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
  });
}
