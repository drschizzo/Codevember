// Courbes du film (règle 17) : τ, vitesse, fronts, cordon, en fonction de u.
import { createFilm, TIMELINE } from '../src/film.js';
const F = createFilm({ duration: 30, rhoStart: 2.1, rhoEnd: 8.5, cord: { length: 0.28, damping: 1.6, pull: 0.25, hold: 0.12, depth: 0.025, swing: 0.06, dir: 0.4 } });
console.log('K', F.K.toExponential(2), 'P (s réelles)', F.P.toFixed(3), 'front m/s', F.frontSpeed.toFixed(3));
for (let i = 0; i <= 100; i++) {
  const u = i / 100, r = F.rho(u), c = F.cordAt(u);
  console.log(u.toFixed(2), 'v', F.speed(u).toExponential(1).padStart(8), 'τ', F.tauAt(u).toFixed(3), 'on', r.on.toFixed(2).padStart(6), 'off', r.off.toFixed(2).padStart(6), 'cord y', (c.y * 1000).toFixed(1).padStart(6), 'sx', (c.sx * 1000).toFixed(1).padStart(6));
}
