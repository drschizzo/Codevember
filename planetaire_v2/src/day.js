// Orrery comme jour de la méga-scène (mega/). La scène et le rendu d'un
// instant (les trois mondes emboîtés, la plongée, la caméra, la mise au point,
// la chaîne d'image) sont ceux de la page : core.js, la source unique. Ce
// module ne fait que brancher le cœur sur le kit du relais (réglages par
// défaut, pas de mode léger, cible du jour) ; look.push avance la caméra vers
// ce qu'elle regarde.
//
// Ce que le relais garde de la page, et ce qu'il laisse :
// - la recherche des orbites a lieu (core.setRecipe), pendant que le jour se
//   prépare derrière celui qui joue : mêmes graines, mêmes essais, même
//   résultat que la page (le premier essai réussi, quel que soit le nombre de
//   workers) ; le jour est prêt quand les trois mondes sont construits ;
// - le spectacle de la recherche (les courbes qui se cherchent sous les yeux,
//   le schéma de la machine) et l'atterrissage de l'écran de chargement sur la
//   scène sont à la page seule : les workers n'envoient pas d'instantanés ;
// - la préparation des shaders est celle du kit (warmScene, aux six moments
//   qui comptent), non celle de la page (par lots d'objets, pipelines de la
//   page) ; les studios des trois mondes (cartes d'environnement des
//   matériaux, que le kit ne connaît pas) sont refiltrés à la fin, comme le
//   kit le fait pour scene.environment.
// Orrery a son propre pool de workers (orbit/client.js : la recherche répartie
// essai par essai), et non celui du kit : même nombre de workers que la page.
import { generate } from './recipe.js';
import { createCore } from './core.js';
import { defaultsFor } from './app/settings.js';
import { createPool } from './orbit/client.js';
import { makeDay } from '../../mega/src/kit.js';

export const meta = { id: 'planetaire_v2', name: 'Orrery', subtitle: 'la chorégraphie des astres', seed: 'bwkwvk', enter: 'orbit' };

export async function createDay({ renderer, pipes, width, height, nextFrame = null, seed = meta.seed }) {
  const gen = createPool();
  const RENDER = { ...defaultsFor(false) };
  const core = await createCore({ renderer, width, height, gen, lite: false, RENDER });
  core.applyRender();
  // (la construction des mondes s'étale : un monde, puis un passage, par image de l'hôte)
  core.setRecipe(generate(seed), { yieldFn: nextFrame }).catch((e) => console.error(e)); // (un échec : le jour ne sera jamais prêt)
  const day = makeDay({
    meta, renderer, pipes, width, height, gen,
    scene: core.scene, camera: core.camera, post: core.post,
    duration: core.duration, isReady: core.isReady, progress: core.progress, warmPhases: core.warmPhases,
    renderAt: (u, { push = 0 } = {}) => core.renderAt(u, { push }),
    extraDispose: core.dispose, // (les mondes : studios, machines, atmosphères)
  });
  // Les studios des mondes refiltrés une dernière fois, découpage coupé : en
  // arrière-plan, le préfiltrage (PMREM) fait pendant warmScene peut être en
  // partie sauté (voir mega/src/kit.js) ; le kit ne refait que celui de
  // scene.environment, nos studios sont ceux des matériaux.
  const prepare = day.prepare;
  day.prepare = async function (o) {
    const ok = await prepare.call(this, o);
    if (ok) { for (const W of core.S.worlds) W.env.needsPMREMUpdate = true; this.render(0); }
    return ok;
  };
  return day;
}
