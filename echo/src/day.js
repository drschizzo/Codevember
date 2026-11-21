// Echo comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique. Ce module ne fait que
// brancher le cœur sur le kit du relais (réglages par défaut, pas de mode
// léger, cible du jour). Les glaces rendent la pièce dans leurs propres cibles
// (reflector, rattachées au jour par le registre du kit), jamais dans le canvas.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'echo', name: 'Echo', subtitle: 'le miroir en retard', seed: 'h3', enter: 'flash' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('echo', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  core.setRecipe(generate(seed));
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
  });
}
