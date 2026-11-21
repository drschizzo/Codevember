// {{TITLE}} comme jour de la méga-scène (mega/, le relais). La scène et le rendu
// d'une phase sont ceux de la page : core.js, la source unique. Ce module ne
// fait que brancher le cœur sur le kit du relais (réglages par défaut, pas de
// mode léger, cible du jour). Contrat et pièges : mega/README.md.
//
// À régler au livrable :
// - seed : la scène d'ouverture de la page (DEFAULT_SEED de main.js) ;
// - enter : le passage par lequel on entre dans ce jour, tiré de son geste
//   (mega/src/transitions.js : heat, shatter, melt, bolt, ripple, wave,
//   rivulets, moss, spore, feather, cocoon, twist, cables, rust… ou un passage
//   nouveau, écrit sur leur modèle) ;
// - la place du jour dans l'ordre du relais (DAYS, mega/src/main.js).
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: '{{NAME}}', name: '{{TITLE}}', subtitle: '{{SUBTITLE}}', seed: 'a1', enter: 'fade' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  // (autant de workers que la page au bureau)
  const gen = generatorFor('{{NAME}}', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
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
