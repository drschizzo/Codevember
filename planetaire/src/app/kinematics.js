// Positions des embryons à l'instant présent.
//
// Position + vitesse des embryons sont relues à chaque image (2 ko). La lecture
// arrive avec 1 à 3 images de retard, mais on sait de quel instant elle date :
// on la propage jusqu'à maintenant (problème à 2 corps, saute-mouton, même
// schéma que le GPU). Sur quelques centièmes d'unité de temps l'erreur est
// d'environ 1e-5 UA : caméra, effets et notes restent accrochés aux planètes
// rendues par le GPU.
import { M } from '../sim.js';

export function createKinematics(sim) {
  let pos = null, vel = null, tRead = -1, busy = false;
  const pred = new Map(); // index → [x, y, z] à l'instant présent

  return {
    pred,
    get ready() { return pos !== null; },

    // lance une lecture si la précédente est terminée
    poll(simTime) {
      if (busy) return;
      busy = true;
      sim.readKinematics()
        .then((d) => { if (simTime >= tRead) { pos = d.pos; vel = d.vel; tRead = simTime; } })
        .finally(() => (busy = false));
    },

    predict(simTime) {
      pred.clear();
      if (!pos) return;
      const span = Math.max(0, simTime - tRead);
      const n = Math.min(80, Math.ceil(span / 0.004));
      const h = n ? span / n : 0;
      for (let i = 0; i < M; i++) {
        const o = i * 4;
        if (pos[o + 3] <= 0) continue;
        let x = pos[o], y = pos[o + 1], z = pos[o + 2];
        let vx = vel[o], vy = vel[o + 1], vz = vel[o + 2];
        for (let k = 0; k < n; k++) { // vitesse puis position
          const r2 = x * x + y * y + z * z, ir3 = 1 / (r2 * Math.sqrt(r2));
          vx -= x * ir3 * h; vy -= y * ir3 * h; vz -= z * ir3 * h;
          x += vx * h; y += vy * h; z += vz * h;
        }
        pred.set(i, [x, y, z]);
      }
    },

    reset(simTime) { pos = vel = null; tRead = simTime; pred.clear(); },
  };
}
