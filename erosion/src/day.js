// Erosion comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique (le découpage en plans,
// camera.js ; look.push avance la caméra vers ce que regarde le plan). Ce
// module ne fait que brancher le cœur sur le kit du relais (réglages par
// défaut, pas de mode léger, simulation étalée sur les images de l'hôte).
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'erosion', name: 'Erosion', subtitle: 'un paysage d\'une heure', seed: 'e15', enter: 'rivulets' };

export async function createDay({ renderer, pipes, width, height, nextFrame, seed = meta.seed }) {
  // (le worker ne sert qu'au volume de bruit : la simulation tourne sur le GPU, scene/gpusim.js)
  const gen = generatorFor('erosion');
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER, nextFrame });
  core.applyRender();
  core.setRecipe(generate(seed)).catch((e) => console.error(e)); // (un échec : le jour ne sera jamais prêt)
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
    extraDispose: core.dispose, // (≈ 270 Mo de tampons créés sur le device, hors du registre)
  });
}
