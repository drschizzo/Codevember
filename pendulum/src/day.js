// Pendulum comme jour de la méga-scène (mega/). La scène et le rendu d'une
// phase sont ceux de la page : core.js, la source unique (le découpage en
// plans, camera.js ; look.push avance la caméra vers ce que regarde le plan).
// Ce module ne fait que brancher le cœur sur le kit du relais (réglages par
// défaut, pas de mode léger, cible du jour). Le pool est celui du relais
// (shared/gen/client.js), sur le worker du projet : même protocole que
// gen/client.js, sans le dessin du solveur, que seul l'écran de chargement
// de la page montre.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'pendulum', name: 'Pendulum', subtitle: 'l\'équilibre renversé', seed: 'p114', enter: 'swing' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('pendulum', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
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
