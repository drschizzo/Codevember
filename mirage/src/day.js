// Mirage comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique. Ce module ne fait que
// brancher le cœur sur le kit du relais (réglages par défaut, pas de mode
// léger, cible du jour). Toute l'image est un lancer de rayons plein écran
// dans la passe de scène de la chaîne d'image : pas d'autre rendu, pas
// d'autre cible.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'mirage', name: 'Mirage', subtitle: 'l\'objet qui n\'est pas là', seed: 'j2wm45', enter: 'mirror' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  // (le worker ne sert qu'au volume de bruit : le mirascope se calcule au pixel)
  const gen = generatorFor('mirage');
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
