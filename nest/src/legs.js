// L'appui des pattes : chaque tarse posé sur le papier.
//
// Module pur (Node, worker). Le squelette des pattes refait ici à l'identique
// de celui du vertex shader (scene/wasps.js, angleFn et skin) : mêmes
// articulations, mêmes axes (gen/wasp.js, skeleton), mêmes angles de démarche.
// Pour chaque patte, on cherche la correction du fémur (articulation 1, qui
// lève ou abaisse toute la patte) qui amène le bout du tarse à la hauteur du
// papier sous lui. Elle se calcule sur la pose d'appui (la patte au sol) et
// s'applique aussi pendant le pas : la patte levée part de là où elle était posée.
import { skeleton, LEGS } from './gen/wasp.js';

const SK = skeleton();
const TAU = 2 * Math.PI;
const fract = (x) => x - Math.floor(x);
const rot = (v, a, t) => {
  const c = Math.cos(t), s = Math.sin(t), d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  return [
    v[0] * c + (a[1] * v[2] - a[2] * v[1]) * s + a[0] * d * (1 - c),
    v[1] * c + (a[2] * v[0] - a[0] * v[2]) * s + a[1] * d * (1 - c),
    v[2] * c + (a[0] * v[1] - a[1] * v[0]) * s + a[2] * d * (1 - c),
  ];
};
export const qrot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

// angles des quatre articulations de la patte `chain` (0 à 5), comme angleFn
// (pose : [marche, vol, …] ; drop : ext2[0] ; lift : la correction du fémur)
export function legAngles(chain, pose, drop = 0, lift = 0, stance = false) {
  const pair = Math.floor(chain / 2), side = chain - pair * 2, sgn = 1 - 2 * side;
  const fly = pose[1], ph = pose[0] + fract((pair + side) * 0.5) * TAU;
  const air = stance ? 0 : Math.max(0, Math.sin(ph)) * (1 - fly);
  return [
    (Math.cos(ph) * -0.42 * (1 - fly) - fly * 0.45 * (pair * 0.4 + 0.6)) * sgn,
    air * 0.42 - fly * 0.35 - drop * 28 + lift,
    air * -0.5 - fly * 0.55 + drop * 14,
    air * 0.25 + fly * 0.3,
  ];
}

// le bout du tarse dans le repère de la guêpe
export function legTip(chain, ang) {
  const pair = Math.floor(chain / 2), sd = chain % 2 ? -1 : 1;
  const J = LEGS[pair][4];
  let p = [J[0], J[1], J[2] * sd];
  for (let j = 3; j >= 0; j--) {
    const k = (chain * 4 + j) * 4;
    const piv = [SK.piv[k], SK.piv[k + 1], SK.piv[k + 2]], ax = [SK.ax[k], SK.ax[k + 1], SK.ax[k + 2]];
    p = rot([p[0] - piv[0], p[1] - piv[1], p[2] - piv[2]], ax, ang[j]);
    p = [p[0] + piv[0], p[1] + piv[1], p[2] + piv[2]];
  }
  return p;
}

// les six corrections du fémur. st : { p, q, s, pose, ext2 } ; n : la normale
// de l'appui ; height(x) : la hauteur du papier (le long de n, depuis st.p)
// sous le point du monde x, ou null s'il n'y a rien dessous (la patte dans le
// vide : NaN, que l'appelant comble dans le temps)
export function legLifts(st, n, height, { iters = 6, min = -1.1, max = 0.75 } = {}) {
  const drop = st.ext2?.[0] ?? 0;
  const out = [0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 6; c++) {
    let L = 0, found = false;
    for (let it = 0; it < iters; it++) {
      const tip = legTip(c, legAngles(c, st.pose, drop, L, true));
      const w = qrot(st.q, tip.map((x) => x * st.s));
      const x = [st.p[0] + w[0], st.p[1] + w[1], st.p[2] + w[2]];
      const h = height(x);
      if (h == null) break;
      found = true;
      const a = w[0] * n[0] + w[1] * n[1] + w[2] * n[2];
      // (bras de levier : la distance du fémur au tarse, dans le plan de la patte)
      const J1 = LEGS[Math.floor(c / 2)][1];
      const lever = Math.max(0.01, Math.hypot(tip[0] - J1[0], tip[2] - J1[2] * (c % 2 ? -1 : 1))) * st.s;
      L = Math.min(max, Math.max(min, L + (h - a) / lever));
    }
    out[c] = found ? L : NaN;
  }
  return out;
}

// Une suite de corrections (une ligne de six par image) : les trous (patte
// au-dessus du vide) comblés par interpolation dans le temps, puis dilatés et
// lissés (gaussienne, σ en images) — la patte ne saute pas d'une image à l'autre
export function smoothLifts(rows, sigma = 2) {
  const n = rows.length, out = rows.map(() => [0, 0, 0, 0, 0, 0]);
  for (let c = 0; c < 6; c++) {
    const v = rows.map((r) => r[c]), ok = v.map(Number.isFinite);
    const filled = v.map((x, i) => {
      if (ok[i]) return x;
      let a = i - 1, b = i + 1;
      while (a >= 0 && !ok[a]) a--;
      while (b < n && !ok[b]) b++;
      if (a < 0 && b >= n) return 0;
      if (a < 0) return v[b];
      if (b >= n) return v[a];
      return v[a] + ((v[b] - v[a]) * (i - a)) / (b - a);
    });
    // (dilaté sur la portée du noyau, puis lissé : la correction lissée n'est
    // jamais sous celle d'une image voisine — le tarse jamais dans le papier,
    // au pire un peu au-dessus)
    const R = Math.ceil(sigma * 3);
    const dil = filled.map((_, i) => { let m = -Infinity; for (let k = -R; k <= R; k++) m = Math.max(m, filled[Math.min(n - 1, Math.max(0, i + k))]); return m; });
    for (let i = 0; i < n; i++) {
      let sw = 0, sv = 0;
      for (let k = -R; k <= R; k++) { const j = Math.min(n - 1, Math.max(0, i + k)), w = Math.exp(-(k * k) / (2 * sigma * sigma)); sw += w; sv += dil[j] * w; }
      out[i][c] = sv / sw;
    }
  }
  return out;
}
