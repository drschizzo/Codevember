// Tangle comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique. Ce module ne fait que
// brancher le cœur sur le kit du relais (réglages par défaut, pas de mode
// léger, cible du jour) ; look.push avance la caméra vers la corde.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'tangle', name: 'Tangle', subtitle: 'le tour de trop', seed: 'b5', enter: 'twist' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  // (le pool commun : sans `live`, le worker simule sans envoyer d'états en
  // route — même résultat, mais l'avancement reste à 0 jusqu'à la fin du calcul)
  const gen = generatorFor('tangle', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  core.setRecipe(generate(seed)); // (R.loop.duration est posé quand la simulation arrive)
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
  });
}
