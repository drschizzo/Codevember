// Fold comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique (ses ombres douces et
// colorées y sont posées le temps de son dessin). Ce module ne fait que
// brancher le cœur sur le kit du relais (réglages par défaut, pas de mode
// léger, cible du jour). Le film des feuilles est calculé par les workers.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'fold', name: 'Fold', subtitle: 'le papier qui se plie seul', seed: '40aatl', enter: 'fold' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('fold', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
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
