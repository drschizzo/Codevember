// Hollow comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// (la plongée, ses battements, la caméra, la lumière, la chaîne d'image) sont
// ceux de la page : core.js, la source unique. Ce module ne fait que brancher
// le cœur sur le kit du relais (réglages par défaut, pas de mode léger, cible
// du jour) ; look.push avance la caméra vers ce qu'elle regarde.
// Hollow a son propre pool de workers (gen/client.js : file à priorités par
// niveau de détail), et non celui du kit : même nombre de workers que la page.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { createGenerator } from './gen/client.js';
import { makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'hollow', name: 'Hollow', subtitle: 'une plongée sans fond', seed: 'ce0gkq', enter: 'dive' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = createGenerator();
  const RENDER = { ...defaultsFor(false) };
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
