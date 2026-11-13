// Worker de génération : la plante, son plan (gouttes, marteau, signal) et
// toute la géométrie sont construits hors du fil principal, à partir d'une
// spécification JSON ; les tampons sont transférés sans copie. Les
// constructeurs sont des fonctions pures, importables depuis Node.
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { growPlant } from './plant.js';
import { containerShape } from '../container.js';
import { planLoop } from '../plan.js';
import * as G from './build.js';

export function buildScene(spec) {
  const plant = growPlant(spec.plant);
  const E = plant.leaves.reduce((m, L) => Math.max(m, Math.hypot(L.tip[0], L.tip[2]) + Math.max(...L.pinnae.map((P) => P.len))), 0.6);
  const S = containerShape(spec.container, plant.H, E);
  const plan = planLoop(plant, S, { seed: spec.seed, events: spec.events, spacing: spec.spacing, signal: spec.signal, view: spec.view, duration: spec.duration, rot: spec.rot });
  const half = plant.family === 'oxalis' ? 'oxalis' : plant.family === 'dionaea' ? 'trap' : null;
  const meshes = {
    stems: G.buildStems(plant), flowers: plant.flowers.length ? G.buildFlowers(plant) : null, pods: plant.pods.length ? G.buildPods(plant) : null,
    soil: G.buildSoil(S, spec.seed), pot: G.buildPot(S), mulch: G.buildMulch(S, plant, spec.mulch ?? 'gravel', spec.seed, spec.lite),
    base: S.plinth || S.case ? G.buildBase(S) : null, frame: S.case ? G.buildCaseFrame(S) : null, glass: S.bell || S.case ? G.buildGlass(S) : null,
    leafletL: half ? G.halfTemplate(false, half) : G.leafletTemplate(true), leafletR: half ? G.halfTemplate(false, half) : G.leafletTemplate(false),
    petiole: plant.family === 'dionaea' ? G.wingTemplate() : plant.family === 'oxalis' ? G.rodTemplate((x) => 0.0045 - 0.001 * x, 24, 8, 0.3) : G.rodTemplate((x) => 0.0058 - 0.0016 * x, 20, 8, 0.7),
    rachis: half ? G.rodTemplate((x) => (half === 'trap' ? 0.0035 : 0.0022) * (1 - 0.5 * x), 16, 6, 0) : G.rodTemplate((x) => 0.0036 - 0.0014 * x, 24, 6, 0.4),
    sphere: G.unitSphere(), disc: G.unitDisc(),
  };
  if (plan.burette) meshes.burette = G.buildBurette(plan.burette);
  const tap = plan.events.find((e) => e.cause === 'tap');
  if (tap) meshes.hammer = G.buildHammer(tap, S);
  delete plant.graph.adj;
  return { plant, plan, H: plant.H, E, meshes };
}

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'scene': return buildScene(spec);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const seen = new Set();
    const walk = (o) => { if (!o || seen.has(o)) return; seen.add(o); for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, [...new Set(transfer)]);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
