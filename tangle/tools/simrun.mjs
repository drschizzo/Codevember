// Une boucle complète d'une famille (Node) : temps de calcul, temps forts,
// résidu du raccord, durée du film ; images de contrôle (profil) en option.
//   node tangle/tools/simrun.mjs cordon 4,8,9 [sortie.json]
import { simulate } from '../src/gen/sim.js';
import { criticalTurns, FAMILIES } from '../src/plan.js';
import fs from 'node:fs';

const fam = process.argv[2] || 'cordon';
const Ks = (process.argv[3] || '4,8,9').split(',').map(Number);
const R = { family: fam, sim: { dashpot: 15 }, cycles: Ks.map((K, i) => ({ K, rate: Number(process.env.RATE ?? 1), settle: [5, 6.5, 8][i] ?? 6 })) };
console.log(fam, 'seuil estimé', criticalTurns(FAMILIES[fam]).toFixed(2), 'tours');
const t0 = performance.now();
const S = simulate(R);
console.log(`calcul ${((performance.now() - t0) / 1000).toFixed(1)} s ; P = ${S.P.toFixed(1)} s ; film T = ${S.T.toFixed(1)} s, ${S.nf} images`);
console.log('flambages (τ)', S.buckles.map((x) => x?.toFixed(2)), 'résidu', (S.residual * 1000).toFixed(3), 'mm ; tours du volant', S.residualTurns.toFixed(4));
if (process.argv[4]) {
  const out = [];
  for (let f = 0; f < S.nf; f += 15) out.push({ t: f / S.fps, P: Array.from(S.frames.subarray(f * S.stride, f * S.stride + S.nv * 3), (x) => +x.toFixed(4)), fy: S.frames[f * S.stride + S.stride - 4] });
  fs.writeFileSync(process.argv[4], JSON.stringify(out));
}
