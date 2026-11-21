// Tesseract comme jour de la méga-scène (mega/). La scène et le rendu d'une
// phase (le pliage, le voyage intérieur, la sonde de pièce, la caméra, la
// lumière, la chaîne d'image) sont ceux de la page : core.js, la source
// unique. Ce module ne fait que brancher le cœur sur le kit du relais
// (réglages par défaut, pas de mode léger, cible du jour) ; look.push avance
// la caméra vers ce qu'elle regarde. Les légendes et l'analogie (un canevas
// posé sur la page, app/overlay.js) restent à la page.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { releaseProbeTarget } from './scene/probe.js';
import { defaultsFor } from './app/settings.js';
import { generatorFor, makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'tesseract', name: 'Tesseract', subtitle: 'le cabinet replié', seed: 'atl45i', enter: 'unfold' };

export async function createDay({ renderer, pipes, width, height, seed = meta.seed }) {
  const gen = generatorFor('tesseract', Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
  const RENDER = { ...defaultsFor(false) };
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  core.setRecipe(generate(seed)).catch((e) => console.error(e)); // (un échec : le jour ne sera jamais prêt)
  return makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
    // (la sonde de pièce garde sa cible au niveau du module : on l'oublie pour
    // que le passage suivant de Tesseract en crée une neuve)
    extraDispose: releaseProbeTarget,
  });
}
