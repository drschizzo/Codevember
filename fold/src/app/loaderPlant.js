// Fold — la plante de l'écran de chargement, poussée dans un worker à part
// (lancé par loaderArt.js, depuis le worker de l'écran) : growPlant prend
// une à deux secondes, le dessin ne doit pas s'arrêter pendant ce temps.
//
// C'est la plante même de la scène (même archétype, même graine) ; on y
// ajoute deux horloges, calculées sur son graphe vasculaire :
//  - grow : distance au collet le long des tiges et des pétioles (l'ordre
//    dans lequel le dessin pousse) ;
//  - sig  : instant d'arrivée du signal du coup de marteau (le choc part du
//    collet, gen/plant.js et physio.js), complété comme dans plan.js (le
//    pulvinus primaire relaie le signal vers les pinnules et les folioles).
import { growPlant } from '../gen/plant.js';
import { containerShape } from '../container.js';
import { propagate, SIGNAL } from '../physio.js';

self.onmessage = ({ data }) => {
  try {
    const plant = growPlant(data.plant);
    const E = plant.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + Math.max(...L.pinnae.map((P) => P.len))), 0.6);
    const S = containerShape(data.container, plant.H, E);
    const g = plant.graph;
    // distance de croissance (sans atténuation, vitesse 1)
    const flat = { speed: [1, 1, 1, 1], boost: 0, lambda: [1e9, 1e9, 1e9, 1e9], threshold: { leaflet: 0 } };
    const grow = propagate(g, g.root, 1, flat).arr;
    // le signal du marteau (amplitude 4, comme plan.js)
    const { arr } = propagate(g, g.root, 4, SIGNAL);
    for (const L of plant.leaves) {
      const aP = arr[L.nodeP];
      if (!Number.isFinite(aP)) continue;
      const aS = Math.min(arr[L.nodeS], aP + L.pet / SIGNAL.speed[1]);
      arr[L.nodeS] = aS;
      for (const P of L.pinnae) for (const q of P.pairs) arr[q.node] = Math.min(arr[q.node], aS + (q.s * P.len) / SIGNAL.speed[2]);
    }
    delete g.adj;
    const fin = (a) => Float32Array.from(a, (x) => (Number.isFinite(x) ? x : -1));
    const sig = fin(arr), gr = fin(grow);
    self.postMessage({
      plant: { family: plant.family, H: plant.H, stems: plant.stems, leaves: plant.leaves, flowers: plant.flowers, pods: plant.pods, graph: { nodes: g.nodes.map((n) => n.pos), edges: g.edges, root: g.root } },
      pot: { outer: S.outer, rimR: S.rimR, rimY: S.rimY, soilR: S.soilR, potBottom: S.potBottom },
      grow: gr, sig,
    }, [sig.buffer, gr.buffer]);
  } catch (e) {
    self.postMessage({ error: String(e?.message ?? e) });
  }
};
