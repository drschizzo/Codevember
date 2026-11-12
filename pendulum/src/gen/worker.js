// Worker de génération : les transitions (le solveur), puis toute la
// géométrie, hors du fil principal ; tampons transférés sans copie.
// L'avancement d'un long calcul est posté au fil de l'eau
// ({ id, progress, label, art }) : l'écran de chargement dessine le solveur
// pendant qu'il cherche.
import { buildNoiseVolume } from './noisevol.js';
import { envPixels } from './envmap.js';
import { solveMove } from './plan.js';
import { systemOf } from './machines.js';
import { linkParts, cartBench, cartCarriage, pulley, beltLoop, rotaryBase, rotaryArm, portal, acroDrive, elbowPulley, gallows, flywheel, wheelMotor } from './build.js';
import { chainPoints } from './pose.js';

function build({ id, spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'env': return { data: envPixels(spec.preset, 0, spec.W) };
    case 'move': {
      const R = spec;
      let last = 0;
      const sys = systemOf(R.machine);
      const r = solveMove(R, spec.i, (p) => self.postMessage({ id, progress: p }), (it) => {
        const now = performance.now();
        if (now - last < 90) return;
        last = now;
        // poses aux nœuds de tir : fin de chaque segment intégré depuis son état
        // poses à la fin de chaque intervalle de commande, segment par segment :
        // chaque segment repart de son état de tir (les sauts sont les défauts)
        const poses = [];
        const y = new Float64Array(sys.nx);
        const isys = it.sys ?? sys;
        for (let i = 0; i < (it.S ?? 16); i++) {
          let bad = false;
          it.seg(i, y, (x) => { if (!Number.isFinite(x[0]) || Math.abs(x[0]) > 1e3) bad = true; else poses.push(chainPoints(R.machine, isys, x)); });
          if (bad) break;
        }
        self.postMessage({ id, progress: -1, art: { i: spec.i, k: it.k, cn: it.cn, poses } });
      });
      if (!r.ok) throw new Error(`transition ${spec.i} : aucune trajectoire trouvée (${JSON.stringify(r.why)})`);
      return r;
    }
    case 'link': return linkParts(spec.L, spec.dz);
    case 'cartBench': return cartBench(spec.M, spec.wood);
    case 'carriage': return cartCarriage(spec.M, spec.dz);
    case 'pulley': return pulley(spec.r, spec.w);
    case 'belt': return beltLoop(spec.X, spec.r, spec.w, spec.e);
    case 'rotaryBase': return rotaryBase(spec.M);
    case 'rotaryArm': return rotaryArm(spec.M, spec.Lay);
    case 'portal': return portal(spec.M, spec.Lay, spec.wood);
    case 'acroDrive': return acroDrive(spec.L0, spec.zBack, spec.at);
    case 'elbowPulley': return elbowPulley(spec.re, spec.zBack);
    case 'gallows': return gallows(spec.M, spec.Lay, spec.wood);
    case 'flywheel': return flywheel(spec.W);
    case 'wheelMotor': return wheelMotor(spec.L, spec.zBack);
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
