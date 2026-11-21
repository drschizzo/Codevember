// Moss comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique (la caméra vient de
// stage.update ; look.push avance la caméra vers le coussin). Ce module ne
// fait que brancher le cœur sur le kit du relais (réglages par défaut, pas de
// mode léger, cible du jour).
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'moss', name: 'Moss', subtitle: 'la reviviscence', seed: 'b88', enter: 'moss' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('moss');
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  // (le ciel HDR arrive du worker : isReady l'attend)
  core.setRecipe(generate(seed)).catch((e) => console.error(e));
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
  });
}
