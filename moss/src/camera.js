// La caméra du film (module pur) : un travelling avant puis arrière.
//
// Au début, un plan large : toute la pierre, la mousse réduite à des îlots
// dans les fissures — on voit l'échelle (des milliers de tiges, des
// aiguilles, des gouttes). Quand la pluie revient, la caméra avance
// lentement jusqu'au bord d'un îlot, en macro, au ras des tiges, et suit le
// front vert qui avance sur la roche. Quand la sécheresse arrive, elle
// recule et s'élève pour montrer le tapis qui se retire dans ses refuges.
// Un seul mouvement par boucle ; la trajectoire est échantillonnée, lissée
// par un noyau gaussien périodique (σ = 1,1 s) et relue en Catmull-Rom.

// images clés : [u, rapprochement (0 large, 1 macro), avance le long du front (−1…1)]
const KEYS = [
  [0.0, 0.0, -0.4], [0.1, 0.02, -0.4], [0.2, 0.35, -0.35], [0.3, 0.92, -0.2], [0.42, 1.0, 0.25],
  [0.54, 0.95, 0.65], [0.63, 0.55, 0.6], [0.74, 0.12, 0.2], [0.88, 0.0, -0.3],
];
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
function keyAt(u) {
  u -= Math.floor(u);
  const K = KEYS, n = K.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (K[k][0] <= u) i = k;
  const k0 = K[(i - 1 + n) % n], k1 = K[i], k2 = K[(i + 1) % n], k3 = K[(i + 2) % n];
  const u1 = k1[0], u2 = k2[0] + (i + 1 >= n ? 1 : 0);
  const t = (u - u1) / (u2 - u1);
  return [catmull(k0[1], k1[1], k2[1], k3[1], t), catmull(k0[2], k1[2], k2[2], k3[2], t)];
}
const lerp = (a, b, t) => a + (b - a) * t;

// C : recette.camera ; S : { top (hauteur du tapis), E (demi-largeur de la
// pierre), hero ([x, z] bord d'îlot), heroDir ([x, z] sens du front) } ; T : durée (s)
export function createCameraPath(C, S, T) {
  const az = C.az;
  const dir = [Math.cos(az), 0, Math.sin(az)];
  const hd = S.heroDir ?? [1, 0];
  const rawPose = (u) => {
    const [z0, a] = keyAt(u);
    const z = Math.min(1, Math.max(0, z0));
    // cible : le centre de la pierre (large) → le bord de l'îlot qui avance (macro)
    const tx = lerp(0, S.hero[0] + hd[0] * a * C.travel, z), tz = lerp(0, S.hero[1] + hd[1] * a * C.travel, z);
    const ty = lerp(S.top * 0.2, S.top * 0.75, z);
    // (plan large : toute la pierre dans le champ ; macro : quelques centimètres)
    const wide = (S.E * 1.25) / Math.tan((C.fov * Math.PI) / 360);
    const dist = Math.exp(lerp(Math.log(wide), Math.log(C.dist), z));
    const el = lerp(C.elWide ?? 0.5, C.el, z);
    const p = [tx + dir[0] * Math.cos(el) * dist, ty + Math.sin(el) * dist, tz + dir[2] * Math.cos(el) * dist];
    p[1] = Math.max(p[1], S.top + 0.25);
    return [...p, tx, ty, tz];
  };
  const N = Math.round(T * 30), sigma = 1.1 * 30;
  const raw = Array.from({ length: N }, (_, i) => rawPose(i / N));
  const W = Math.ceil(sigma * 3), w = Array.from({ length: 2 * W + 1 }, (_, k) => Math.exp(-((k - W) ** 2) / (2 * sigma * sigma)));
  const ws = w.reduce((x, y) => x + y, 0);
  const smooth = raw.map((_, i) => {
    const acc = [0, 0, 0, 0, 0, 0];
    for (let k = -W; k <= W; k++) { const q = raw[(i + k + N * 10) % N], c = w[k + W] / ws; for (let j = 0; j < 6; j++) acc[j] += q[j] * c; }
    return acc;
  });
  const pose = (u) => {
    const f = (u - Math.floor(u)) * N, i = Math.floor(f), t = f - i;
    const g = (k) => smooth[(i + k + N) % N];
    const out = [];
    for (let j = 0; j < 6; j++) out.push(catmull(g(-1)[j], g(0)[j], g(1)[j], g(2)[j], t));
    return { pos: out.slice(0, 3), target: out.slice(3, 6), fov: C.fov, focus: Math.hypot(out[0] - out[3], out[1] - out[4], out[2] - out[5]) };
  };
  return { pose, dir };
}
