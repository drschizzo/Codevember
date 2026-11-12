// Préparation du rendu sans gel (module commun à tous les projets du dépôt).
//
// Ce qui coûte, à l'ouverture d'une scène three.js WebGPU :
//  1. la traduction des matériaux TSL en WGSL, sur le fil principal (de
//     quelques dizaines à plusieurs centaines de millisecondes par matériau) :
//     un premier dessin de toute la scène tient la page plusieurs secondes ;
//  2. la compilation des pipelines, que three.js demande en synchrone au
//     premier dessin : le processus graphique du navigateur est bloqué pendant
//     chaque compilation, et avec lui tout l'affichage de la page — y compris
//     un écran de chargement dessiné dans un worker.
// D'où deux outils :
//  - asyncPipelines : pendant le chargement, les pipelines sont demandées en
//    asynchrone (compilées en parallèle, hors du fil d'affichage) ; tant
//    qu'une pipeline n'est pas prête, three.js saute l'objet ;
//  - warmScene : dessine les moments qui comptent en ne construisant que
//    quelques objets nouveaux par image (budget en millisecondes), en rendant
//    la main entre deux images, jusqu'à ce que plus rien ne manque. Les objets
//    au-delà du budget sont sautés le temps d'une image : on ne touche ni à
//    leur visibilité ni à la scène.
// (Aucune attente par setTimeout : un onglet en arrière-plan les ralentit à
// une par seconde, voire par minute ; un MessageChannel ne l'est pas.)

export const yieldNow = () => new Promise((res) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); res(); };
  c.port2.postMessage(0);
});
export const sleep = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await yieldNow(); };

// pipes.on : pipelines asynchrones ; pipes.made : nombre demandé ; flush() :
// attend celles en cours. (?syncpipes : l'ancien comportement, pour comparer)
export function asyncPipelines(renderer, enabled = !new URLSearchParams(location.search).has('syncpipes')) {
  const pipes = {
    on: false, pending: [], made: 0,
    async flush() { while (this.pending.length) await Promise.all(this.pending.splice(0)); },
  };
  const be = renderer.backend;
  if (!enabled || !be?.isWebGPUBackend) return pipes;
  const create = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (renderObject, promises) => {
    if (!pipes.on || promises) return create(renderObject, promises);
    const list = [];
    create(renderObject, list);
    const data = be.get(renderObject.pipeline);
    data.error = true; // (three.js saute les objets dont la pipeline est en erreur)
    pipes.made++;
    pipes.pending.push(Promise.all(list).then(() => { if (data.pipeline) data.error = false; }, () => {}));
  };
  return pipes;
}

// Construction des objets limitée par image : au-delà de `budget` ms dans un
// même dessin, un objet jamais dessiné (avec ce matériau, dans cette passe)
// est sauté. gate.skipped : combien l'ont été au dernier dessin.
function createGate(renderer) {
  const gate = { on: false, t0: 0, budget: 100, built: 0, skipped: 0 };
  const direct = renderer._renderObjectDirect;
  const objects = () => renderer._objects;
  if (typeof direct !== 'function') return gate; // (autre version de three.js : pas de découpage)
  const keys = [null, null, null, null];
  renderer._renderObjectDirect = function (object, material, scene, camera, lightsNode, group, clippingContext, passId) {
    if (gate.on) {
      keys[0] = object; keys[1] = material; keys[2] = this._currentRenderContext; keys[3] = lightsNode;
      const known = objects()?.getChainMap(passId).get(keys) !== undefined;
      if (!known) {
        if (gate.built > 0 && performance.now() - gate.t0 > gate.budget) { gate.skipped++; return; }
        gate.built++;
      }
    }
    return direct.call(this, object, material, scene, camera, lightsNode, group, clippingContext, passId);
  };
  return gate;
}

// Prépare tout ce que la boucle dessinera : chaque phase de `phases` est
// dessinée (render(ph) : un rendu complet de la scène à cette phase) jusqu'à
// ce qu'aucun objet n'y manque, puis on recommence tant que de nouvelles
// pipelines apparaissent. frustum désactivé (un objet hors champ n'est pas
// compilé). onProgress(f) : avancement estimé, 0 à 1. alive() : faux si un
// autre chargement a été demandé entre-temps (on abandonne).
// envs : textures d'environnement à refiltrer (préfiltrées pendant des
// dessins sautés). Rend false si abandonné.
export async function warmScene({ renderer, scene, pipes, render, phases, onProgress, alive = () => true, budget = 100, envs = () => [scene.environment] }) {
  const gate = renderer.__gate ??= createGate(renderer);
  const fresh = () => renderer._nodes?.nodeFrame?.update?.();
  const culled = [];
  scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
  pipes.on = true; gate.on = true; gate.budget = budget;
  let done = 0; const total = phases.length;
  const report = (f) => onProgress?.(Math.min(1, (done + f) / (total + 1)));
  try {
    // 1. chaque phase, par petits lots d'objets nouveaux
    for (const ph of phases) {
      let first = -1, guard = 0;
      do {
        gate.t0 = performance.now(); gate.built = 0; gate.skipped = 0;
        fresh(); render(ph);
        if (first < 0) first = gate.skipped + gate.built;
        report(first ? 1 - gate.skipped / first : 1);
        await yieldNow();
        if (!alive()) return false;
      } while (gate.skipped > 0 && ++guard < 400);
      done++;
    }
    // 2. les pipelines en cours, puis des tours complets tant qu'il en apparaît
    await pipes.flush();
    for (let round = 0; round < 6; round++) {
      const before = pipes.made;
      let skipped = 0;
      for (const ph of phases) {
        gate.t0 = performance.now(); gate.built = 0; gate.skipped = 0;
        fresh(); render(ph);
        skipped += gate.skipped;
        await pipes.flush(); await yieldNow();
        if (!alive()) return false;
      }
      if (pipes.made === before && !skipped) break;
    }
    // (le studio a été préfiltré pendant des dessins sautés : on le refait ici,
    // pipelines encore asynchrones, plutôt qu'à la première vraie image)
    const E = envs().filter(Boolean);
    if (E.length) {
      for (const e of E) e.needsPMREMUpdate = true;
      gate.t0 = performance.now(); gate.built = 0;
      fresh(); render(phases[0]);
      await pipes.flush(); await yieldNow();
    }
    done = total; report(1);
    return true;
  } finally {
    gate.on = false; pipes.on = false;
    for (const o of culled) o.frustumCulled = true;
  }
}
