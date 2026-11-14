// Le cycle du bain de bismuth (fonctions pures, Node et navigateur). Tout ce
// qui bouge est calculé ici une fois par image, puis passé au rendu
// (scene/tracer.js) en uniformes :
//
// - la marée de métal (la liberté) : le bain couvre tout, se retire et découvre
//   les cristaux, reste bas, puis le métal chaud remonte et les refond ;
// - l'oxyde : il pousse dès que le métal sort du bain (en racine du temps) ;
//   quand le métal chaud remonte, il s'épaissit au-dessus de la ligne ;
// - la fonte : arrondi et gradins comblés au-dessus de la ligne (dans le
//   rendu), affaissement du cristal quand son pied fond, un coin de gradin qui
//   cède et tombe, des gouttes qui perlent et glissent, la peau d'oxyde qui
//   survit au métal et se fend sur le miroir, les rides des chutes ;
// - pendant que le bain couvre tout (le métal refroidit), les cristaux
//   repoussent sous le miroir : à u = 1, l'état est celui de u = 0.
import { createRng } from '../../shared/rng.js';

export const CYCLE = { LH: 2.9, LL: 0.22, T0: 0.06, T1: 0.30, T2: 0.60, T3: 0.86 };

export function level(t, C = CYCLE) {
  if (t < C.T0) return C.LH;
  if (t < C.T1) return C.LH + (C.LL - C.LH) * (t - C.T0) / (C.T1 - C.T0);
  if (t < C.T2) return C.LL;
  if (t < C.T3) return C.LL + (C.LH - C.LL) * (t - C.T2) / (C.T3 - C.T2);
  return C.LH;
}
// instant où le métal à la hauteur y sort du bain
export const emerge = (y, C = CYCLE) => C.T0 + Math.min(1, Math.max(0, (C.LH - y) / (C.LH - C.LL))) * (C.T1 - C.T0);
// instant où la ligne de métal chaud atteint la hauteur y en remontant
export const reach = (y, C = CYCLE) => C.T2 + Math.min(1, Math.max(0, (y - C.LL) / (C.LH - C.LL))) * (C.T3 - C.T2);
export const rising = (t, C = CYCLE) => (t > C.T2 && t < C.T3 + 0.02 ? Math.min(1, (t - C.T2) / (C.T3 - C.T2)) : 0);
const sm = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// ── La grappe : des trémies posées sur la croûte du fond, sans s'interpénétrer
// trop (une trémie peut en pénétrer une autre : ce sont des cristaux maclés) ──
export function buildCluster(seed, { count = 9, scale = 1, spread = 1 } = {}) {
  const rng = createRng(seed).fork('cluster');
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < 400) {
    const big = out.length === 0;
    const s = (big ? rng.range(0.85, 1.05) : rng.range(0.25, 0.75)) * scale;
    const r = big ? 0 : rng.range(0.9, 2.9) * spread * scale;
    const a = rng.range(0, Math.PI * 2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // (au plus une interpénétration légère avec les voisins)
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < (c.s + s) * 0.95)) continue;
    out.push({
      x, z, s, y: s * rng.range(0.55, 0.98), // centre : posé, plus ou moins enfoncé dans la croûte (jamais au-dessus)
      ang: rng.range(0, Math.PI), tilt: rng.range(-0.3, 0.3), ox: rng.range(0, 1), seed: rng.range(0, 50),
      lean: rng.pick([-1, 1]), corner: [rng.pick([-1, 1]), rng.pick([-1, 1])],
    });
  }
  return out;
}

const rotY = (v, a) => [Math.cos(a) * v[0] + Math.sin(a) * v[2], v[1], -Math.sin(a) * v[0] + Math.cos(a) * v[2]];

// État de chaque cristal à l'instant t : pose (affaissement), coin, gouttes,
// peau, rides
export function crystalsAt(cluster, t, C = CYCLE) {
  const L = level(t, C), rs = rising(t, C);
  return cluster.map((c, i) => {
    // l'affaissement : quand la ligne atteint le pied, il fond ; le cristal
    // s'enfonce et penche du côté qui a cédé
    const tBase = reach(c.y - c.s * 0.6, C);
    const col = sm(tBase, tBase + 0.09, t);
    const pose = { x: c.x, y: c.y - c.s * 0.55 * col, z: c.z, s: c.s, ang: c.ang, tilt: c.tilt + 0.45 * col * c.lean };
    // le coin de gradin qui cède quand la fonte atteint le milieu du cristal
    const tb = reach(c.y, C) + 0.015;
    const cl = [c.corner[0] * c.s * 0.72, c.s * 0.9, c.corner[1] * c.s * 0.72];
    const w0 = [c.x + rotY(cl, -c.ang)[0], c.y + cl[1], c.z + rotY(cl, -c.ang)[2]];
    const outd = rotY([cl[0], 0, cl[2]], -c.ang), on = Math.hypot(outd[0], outd[2]) || 1;
    const tau = t - tb;
    let piece = null, ripple = null;
    if (tau > 0) {
      const pos = [w0[0] + (outd[0] / on) * 9 * tau, w0[1] - 1400 * tau * tau, w0[2] + (outd[2] / on) * 9 * tau];
      if (pos[1] > L - 0.4) piece = { pos, ang: c.ang, rot: 18 * tau * Math.sign(cl[2]), s: c.s };
      const ti = tb + Math.sqrt(Math.max(w0[1] - L, 0) / 1400);
      const dt = t - ti;
      if (dt > 0 && dt < 0.07) ripple = { x: w0[0] + (outd[0] / on) * 9 * (ti - tb), z: w0[2] + (outd[2] / on) * 9 * (ti - tb), dt };
    }
    // les gouttes : elles naissent quand la fonte atteint leur hauteur, glissent,
    // et le bain les absorbe ; elles suivent l'affaissement du cristal
    const drips = [];
    if (rs > 0 && col < 0.35) {
      const rng = createRng(`${c.seed.toFixed(3)}:${i}`);
      for (let j = 0; j < 4; j++) {
        const face = Math.floor(rng.range(0, 4)), off = rng.range(-0.6, 0.6), hk = rng.next();
        const a = c.ang + face * Math.PI / 2;
        const nf = [Math.sin(a), 0, Math.cos(a)], tf = [Math.cos(a), 0, -Math.sin(a)];
        const y0 = c.y + c.s * (0.2 + 0.6 * hk);
        const age = t - reach(y0 - 0.5, C);
        if (age <= 0 || y0 < L) continue;
        const y = y0 - age * 6 * c.s - c.s * 0.55 * col;
        if (y < L - 0.03) continue;
        const r = c.s * (0.1 + 0.06 * hk) * Math.min(age * 14, 1);
        drips.push([c.x + nf[0] * c.s * 1.02 + tf[0] * off * c.s, y, c.z + nf[2] * c.s * 1.02 + tf[2] * off * c.s, r]);
      }
    }
    // la peau d'oxyde : quand le haut passe sous la ligne
    const tSub = reach(c.y + c.s * 1.1, C);
    const skinAge = t - tSub;
    const skin = skinAge > 0 && skinAge < 0.16 ? skinAge : -1;
    const breakNow = tau > 0;
    return { ...pose, ox: c.ox, seed: c.seed, cornerLocal: cl, broken: breakNow, piece, drips, skin, ripple };
  });
}
