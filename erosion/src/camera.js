// La caméra du film (module pur) : une suite d'images clés propre à la
// famille — plan d'ensemble sur le sable neuf, descente vers l'endroit où
// l'eau travaille, vol bas qui suit le geste, remontée pour la révélation du
// paysage sec, la lame vue de profil, retour au plan d'ensemble. Chaque clé :
// une cible et une position sphérique autour d'elle (azimut, élévation,
// distance) et une focale. Interpolation de Catmull-Rom périodique, puis
// lissage gaussien périodique (σ ≈ 0,9 s) de la trajectoire échantillonnée :
// la pose à u = 1 est la pose à u = 0, la vitesse et l'accélération sont
// continues.
import { TABLE } from './gen/table.js';
import { filmState, U } from './timeline.js';

const TAU = Math.PI * 2;
// repère du monde : X le long du bac (aval +X), Z en travers, Y la hauteur
export const toWorld = (x, y, z = 0.07) => [x - TABLE.Lx / 2, z, y - TABLE.Ly / 2];

function keys(R, S) {
  const side = R.camera.side;           // de quel côté du bac la caméra vole
  const hk = R.camera.height;
  const F = R.family, t = R.form;
  const y0 = (F === 'breche' ? t.notchY : t.srcY) ?? TABLE.Ly / 2;
  // a : azimut (0 : caméra du côté +Z, regard en travers ; π/2 : depuis l'aval)
  const k = (u, focus, a, el, r, fov = R.camera.fov) => ({ u, T: toWorld(...focus), a, el: el * hk, r, fov });
  const mid = [TABLE.Lx / 2, TABLE.Ly / 2, 0.06];
  // la lame au milieu de son passage (vue de profil)
  const gx = filmState((U.cut0 + U.cut1) / 2, S).gantryX;
  let path;
  // (plans moyens : un champ de 30 à 60 cm ; la grille de 2,5 mm ne doit jamais se voir)
  if (F === 'delta') {
    const xs = t.xs ?? 0.74;
    path = [
      k(0.0, mid, 0.75, 0.66, 1.75),
      k(0.13, [0.3, y0, 0.1], 0.7, 0.55, 0.95),
      k(0.33, [0.58, y0, 0.085], 0.85, 0.46, 0.85),
      k(0.52, [xs + 0.05, y0, 0.07], 1.0, 0.42, 0.85),
      k(0.71, [xs - 0.1, TABLE.Ly / 2, 0.06], 0.55, 0.6, 1.25),
    ];
  } else if (F === 'recul') {
    path = [
      k(0.0, mid, 0.8, 0.66, 1.75),
      k(0.14, [0.72, y0, 0.09], 1.05, 0.52, 0.95),
      k(0.33, [0.72, y0, 0.08], 0.85, 0.45, 0.85),
      k(0.52, [0.52, y0, 0.085], 0.65, 0.45, 0.85),
      k(0.71, [0.6, TABLE.Ly / 2, 0.07], 0.45, 0.62, 1.25),
    ];
  } else if (F === 'ravines') {
    path = [
      k(0.0, mid, 0.6, 0.66, 1.75),
      k(0.13, [0.55, TABLE.Ly * 0.32, 0.1], 0.95, 0.55, 0.95),
      k(0.33, [0.5, TABLE.Ly * 0.45, 0.1], 1.05, 0.46, 0.85),
      k(0.52, [0.47, TABLE.Ly * 0.6, 0.11], 1.0, 0.44, 0.85),
      k(0.71, [0.55, TABLE.Ly / 2, 0.08], 0.8, 0.66, 1.2),
    ];
  } else { // brèche
    const xd = t.xd ?? 0.4;
    path = [
      k(0.0, mid, 0.85, 0.66, 1.75),
      k(0.13, [xd - 0.05, y0, 0.11], 0.95, 0.55, 0.95),
      k(0.33, [xd + 0.03, y0, 0.1], 1.1, 0.46, 0.8),
      k(0.52, [xd + 0.2, y0, 0.09], 1.2, 0.45, 0.9),
      k(0.71, [0.62, TABLE.Ly / 2, 0.08], 0.85, 0.66, 1.2),
    ];
  }
  path.push(
    k(0.86, [gx, TABLE.Ly / 2, 0.08], 0.3, 0.42, 0.95),
    k(0.95, mid, 0.55, 0.62, 1.55),
  );
  return path;
}

// Catmull-Rom périodique sur les clés (les angles déroulés au plus court)
function sampleKeys(K, u) {
  const n = K.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (K[k].u <= u) i = k;
  const k1 = K[i], k2 = K[(i + 1) % n];
  const u1 = k1.u, u2 = k2.u + (i + 1 >= n ? 1 : 0);
  const t = (u - u1) / (u2 - u1);
  const k0 = K[(i - 1 + n) % n], k3 = K[(i + 2) % n];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  // (pas de tension infinie : les écarts de temps entre clés sont semblables)
  const f = (g) => cr(g(k0), g(k1), g(k2), g(k3));
  return { T: [0, 1, 2].map((c) => f((q) => q.T[c])), a: f((q) => q.a), el: f((q) => q.el), r: f((q) => q.r), fov: f((q) => q.fov) };
}

// Trajectoire lissée, tabulée (M échantillons sur la boucle)
export function buildCamera(R, S, M = 720) {
  const K = keys(R, S);
  const side = R.camera.side;
  const raw = Array.from({ length: M }, (_, i) => sampleKeys(K, i / M));
  // obstacles : les montants du simulateur de pluie (cylindres verticaux). La
  // trajectoire brute est écartée radialement (rayon 0,2 m), puis lissée : la
  // caméra les contourne en douceur, sans saut.
  if (S.rain) {
    const posts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push([sx * (TABLE.Lx / 2 + 0.11), sz * (TABLE.Ly / 2 + 0.1)]);
    for (const q of raw) {
      const P = [q.T[0] + q.r * Math.cos(q.el) * Math.sin(q.a), q.T[2] + side * q.r * Math.cos(q.el) * Math.cos(q.a)];
      for (const [px, pz] of posts) {
        const dx = P[0] - px, dz = P[1] - pz, d = Math.hypot(dx, dz), R0 = 0.2;
        if (d < R0) {
          // déplace la cible et la caméra ensemble (le cadre glisse latéralement)
          const k = (R0 - d) / Math.max(d, 1e-3);
          q.T[0] += dx * k; q.T[2] += dz * k;
        }
      }
    }
  }
  const sigma = 0.9 / R.loop.duration * M; // (σ en échantillons)
  const W = Math.ceil(sigma * 3), w = [];
  for (let k = -W; k <= W; k++) w.push(Math.exp(-0.5 * (k / sigma) ** 2));
  const ws = w.reduce((a, b) => a + b, 0);
  const tab = raw.map((_, i) => {
    const o = { T: [0, 0, 0], a: 0, el: 0, r: 0, fov: 0 };
    for (let k = -W; k <= W; k++) {
      const q = raw[(i + k + M) % M], c = w[k + W] / ws;
      for (let d = 0; d < 3; d++) o.T[d] += q.T[d] * c;
      o.a += q.a * c; o.el += q.el * c; o.r += q.r * c; o.fov += q.fov * c;
    }
    return o;
  });
  // pose : position, cible, focale (interpolation linéaire entre échantillons voisins)
  return function pose(u) {
    u -= Math.floor(u);
    const x = u * M, i = Math.floor(x) % M, f = x - Math.floor(x), j = (i + 1) % M;
    const A = tab[i], B = tab[j], m = (p, q) => p + (q - p) * f;
    const T = [0, 1, 2].map((d) => m(A.T[d], B.T[d]));
    const a = m(A.a, B.a), el = m(A.el, B.el), r = m(A.r, B.r);
    // (le côté du bac ne change que la composante en travers : la caméra ne passe jamais derrière le portique)
    const P = [T[0] + r * Math.cos(el) * Math.sin(a), T[1] + r * Math.sin(el), T[2] + side * r * Math.cos(el) * Math.cos(a)];
    return { position: P, target: T, fov: m(A.fov, B.fov) };
  };
}
export { TAU };
