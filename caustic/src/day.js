// Caustic comme jour de la méga-scène (mega/). La scène et le rendu d'une phase
// sont ceux de la page : core.js, la source unique. Ce module ne fait que
// brancher le cœur sur le kit du relais (réglages par défaut, pas de mode
// léger, cible du jour), avec le pool commun sous la signature du client local.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'caustic', name: 'Caustic', subtitle: 'le foyer des ondes', seed: 'v3lsu6', enter: 'ripple' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  // Le pool commun (avec terminate) sous la signature du client local de
  // Caustic : request(spec, what, { onProgress, noCache }) — la scène s'en sert
  // pour les spectres des dessins, avancement compris.
  const pool = generatorFor('caustic');
  const gen = { ...pool, request: (spec, what, { onProgress = null, noCache = false } = {}) => pool.request(spec, what, onProgress, { cache: !noCache }) };
  const RENDER = defaultsFor(false);
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  core.setRecipe(generate(seed));
  const { stage } = core;
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
    // (la houle est calculée dans des tampons WebGPU créés à la main, hors du
    // registre du kit : spectres des dessins, ambiance, tampons de la FFT)
    extraDispose: () => stage.waves.dispose(),
  });
}
