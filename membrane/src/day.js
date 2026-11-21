// Membrane comme jour de la méga-scène (mega/). La scène et le rendu d'une
// phase sont ceux de la page : core.js, la source unique (look.push avance la
// caméra vers le cœur du nid). Ce module ne fait que brancher le cœur sur le
// kit du relais (réglages par défaut, pas de mode léger, cible du jour) :
// les couches se simulent sur le GPU par petits lots, un par image de
// l'hôte (nextFrame), leurs emplacements se construisent un par image
// (isReady), et leurs tampons, créés sur le device hors de three.js, sont
// rendus par extraDispose.
// (La page tire une graine au hasard : celle du jour est celle de
// tools/regress.html, « regress ».)
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'membrane', name: 'Membrane', subtitle: 'l’éclosion sans fin', seed: 'regress', enter: 'membrane' };

export async function createDay({ renderer, pipes, width, height, nextFrame, seed = meta.seed }) {
  // (une couche simulée pèse plusieurs dizaines de Mo : peu de résultats en cache, comme gen/client.js)
  const gen = generatorFor('membrane', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), { maxCache: 12 });
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER, nextFrame });
  core.applyRender();
  core.setRecipe(generate(seed));
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
    extraDispose: core.dispose,
  });
}
