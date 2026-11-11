import { prepare } from '../src/gen/gait.js';
import { makeFilm } from '../src/gen/film.js';
const fam = process.argv[2] || 'culbute', n = +(process.argv[3] || 6);
const P = prepare(fam === 'culbute' ? { family: fam, n } : { family: fam, m: n });
const Fm = makeFilm(P);
const a = Fm.pose(0), b = Fm.pose(1 - 1e-9);
// image : l'ensemble des positions à 1 = celui à 0 déplacé par g (arc : rotation autour de C ; ligne : translation)
const g = (x, z) => { if (Fm.arc) { const th = Fm.theta, c = Math.cos(th), s = Math.sin(th), X = x - Fm.C[0], Z = z - Fm.C[1]; return [c * X - s * Z + Fm.C[0], s * X + c * Z + Fm.C[1]]; } return [x + Fm.dist, z]; };
let err = 0;
for (let i = 0; i < Fm.N; i++) { const [x, z] = g(a[i*3], a[i*3+2]); let best = 1e9; for (let j = 0; j < Fm.N; j++) best = Math.min(best, Math.hypot(x - b[j*3], a[i*3+1]-b[j*3+1], z - b[j*3+2])); err = Math.max(err, best); }
const r0 = Fm.rig(0), r1 = Fm.rig(1);
console.log(fam, 'arc', Fm.arc, 'theta°', (Fm.theta*180/Math.PI).toFixed(2), 'dist', Fm.dist.toFixed(3), 'R', Fm.Rarc.toFixed?.(2), 'period', Fm.period.toFixed(3), 'seam set err', err.toExponential(2), 'blend', Fm.seamErr.toExponential(2), 'rig1', JSON.stringify(r1), 'ks', Fm.ks.length, 'dur', Fm.dur.toFixed(2));
