// Le film : ce que la boucle montre à la phase u, d'après l'enregistrement
// d'un pas (gait.js · prepare). Fonctions pures (rendu, tests, Node).
//
// - Temps : la phase u ∈ [0, 1) donne le temps physique τ(u) par une
//   déformation qui ralentit autour des chutes (caméra rapide) sans changer la
//   durée totale : τ(t) = t − Σ a·w·K((t − t_k)/w), K(x) = x − 3x³ + 3x⁵ − x⁷.
// - Raccord : l'état final est l'état initial déplacé par g (rotation θ autour
//   de y et translation), ré-étiqueté par une symétrie π (Culbute). Le reste
//   (quelques mm au plus : la pose de repos n'est symétrique qu'à peu près)
//   est réparti linéairement sur toute la boucle.
// - Monde : si θ est notable, le pas est une rotation autour d'un centre C
//   (le sol est alors invariant par cette rotation : motif en coordonnées
//   polaires) ; sinon, une translation (θ est réparti sur la boucle par une
//   rotation d'ensemble imperceptible). Le monde est tourné pour que la marche
//   parte selon +x, depuis l'origine.
import { REC_HZ, ramp } from './gait.js';
import { planarFit, align3D } from './sim.js';

const K7 = (x) => x - 3 * x ** 3 + 3 * x ** 5 - x ** 7;
const rot = (th, x, z) => [Math.cos(th) * x - Math.sin(th) * z, Math.sin(th) * x + Math.cos(th) * z];

export function makeFilm(P, { slow = 0.72, slowW = 0.45 } = {}) {
  const N = P.T.nodes.length, F = P.frames, nf = F.length;
  const dur = (nf - 1) / REC_HZ;
  const perm = P.perm ?? Array.from({ length: N }, (_, i) => i);
  const A = F[0], B = F[nf - 1];

  // ── raccord : cible exacte de l'état final, fondue sur la dernière demi-seconde ──
  const fit = planarFit(A, B, N, perm);
  const tgt = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const [x, z] = rot(fit.th, A[i * 3], A[i * 3 + 2]);
    const j = perm[i];
    tgt[j * 3] = x + fit.t[0]; tgt[j * 3 + 1] = A[i * 3 + 1]; tgt[j * 3 + 2] = z + fit.t[1];
  }
  let seamErr = 0;
  for (let q = 0; q < N * 3; q++) seamErr = Math.max(seamErr, Math.abs(tgt[q] - B[q]));
  // l'écart se répartit sur toute la boucle : d'abord sa part rigide (une
  // rotation et une translation, interpolées : la roue qui a tourné d'un tour
  // à un millième près), puis ce qui reste (une différence de forme ≪ 1 mm),
  // linéairement — sans à-coup et sans déformer les barres
  const Rg = align3D(tgt, B, N);
  const R = Rg.R;
  const ang = Math.acos(Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)));
  let ax = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  const al = Math.hypot(...ax) || 1;
  ax = ax.map((v) => v / al);
  const cB = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) cB[a] += B[i * 3 + a] / N;
  const dc = [0, 1, 2].map((a) => R[a][0] * cB[0] + R[a][1] * cB[1] + R[a][2] * cB[2] + Rg.t[a] - cB[a]);
  const rotAxis = (v, th) => { // Rodrigues
    const c = Math.cos(th), s = Math.sin(th), d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2];
    const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
    return [0, 1, 2].map((a) => v[a] * c + cr[a] * s + ax[a] * d * (1 - c));
  };
  const rigidAt = (f, w) => {
    const c = [0, 0, 0], g = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) c[a] += f[i * 3 + a] / N;
    for (let i = 0; i < N; i++) {
      const r = rotAxis([f[i * 3] - c[0], f[i * 3 + 1] - c[1], f[i * 3 + 2] - c[2]], ang * w);
      for (let a = 0; a < 3; a++) g[i * 3 + a] = r[a] + c[a] + dc[a] * w;
    }
    return g;
  };
  const Bm = rigidAt(B, 1);
  const frames = F.map((f, k) => {
    const w = k / (nf - 1), g = rigidAt(f, w);
    for (let q = 0; q < N * 3; q++) g[q] += (tgt[q] - Bm[q]) * w;
    return g;
  });
  let shapeErr = 0;
  for (let q = 0; q < N * 3; q++) shapeErr = Math.max(shapeErr, Math.abs(tgt[q] - Bm[q]));

  // ── monde : centre de départ à l'origine, marche selon +x ──
  const c0 = [0, 0];
  for (let i = 0; i < N; i++) { c0[0] += A[i * 3] / N; c0[1] += A[i * 3 + 2] / N; }
  // déplacement du centre sur le pas
  const [ex, ez] = rot(fit.th, c0[0], c0[1]);
  const c1 = [ex + fit.t[0], ez + fit.t[1]];
  const dist = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  // arc si le rayon de courbure est raisonnable
  const Rarc = Math.abs(fit.th) > 1e-6 ? dist / (2 * Math.sin(Math.abs(fit.th) / 2)) : Infinity;
  const arc = Rarc < 60;
  // orientation du monde : la corde (ou la tangente de départ) selon +x
  let head;
  if (arc) head = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) - fit.th / 2; // (tangente au départ = corde tournée de −θ/2)
  else { const [dx, dz] = rot(-fit.th, c1[0] - c0[0], c1[1] - c0[1]); head = Math.atan2(dz, dx); } // (déplacement une fois le lacet retiré)
  const W = -head; // rotation du monde
  const toWorld = (x, z) => rot(W, x - c0[0], z - c0[1]);
  let C = null;
  if (arc) {
    // centre de la rotation g : (I − Rot θ) C = t
    const c = Math.cos(fit.th), s = Math.sin(fit.th);
    const a11 = 1 - c, a12 = s, a21 = -s, a22 = 1 - c, det = a11 * a22 - a12 * a21;
    const Cx = (fit.t[0] * a22 - a12 * fit.t[1]) / det, Cz = (a11 * fit.t[1] - a21 * fit.t[0]) / det;
    C = toWorld(Cx, Cz);
  }

  // ── déformation du temps : ralentis aux chutes (Culbute) ──
  const ks = [];
  if (P.T.family === 'culbute' && slow > 0) {
    // instant de la chute : vitesse du centre maximale dans la fenêtre du basculement
    const sp = new Float64Array(nf);
    for (let k = 1; k < nf; k++) {
      let vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < N; i++) { vx += F[k][i * 3] - F[k - 1][i * 3]; vy += F[k][i * 3 + 1] - F[k - 1][i * 3 + 1]; vz += F[k][i * 3 + 2] - F[k - 1][i * 3 + 2]; }
      sp[k] = Math.hypot(vx, vy, vz);
    }
    for (const e of P.events) {
      const k0 = Math.round((e.t + 0.6) * REC_HZ), k1 = Math.min(nf - 1, Math.round((e.t + 2.6) * REC_HZ));
      let km = k0;
      for (let k = k0; k <= k1; k++) if (sp[k] > sp[km]) km = k;
      // le ralenti commence au basculement, pas avant : centré un peu après le pic
      ks.push({ t: km / REC_HZ + slowW * 0.25, a: slow, w: slowW });
    }
  }
  // τ(t) : t temps du film ∈ [0, dur], τ temps physique ; le noyau ne déborde pas
  const tau = (t) => {
    let r = t;
    for (const k of ks) { const x = (t - k.t) / k.w; if (x > -1 && x < 1) r -= k.a * k.w * K7(x); }
    return Math.max(0, Math.min(dur, r));
  };

  // ── échantillonnage : Catmull-Rom sur les images enregistrées ──
  const sample = (tp, out, src = frames, stride = N * 3) => {
    const f = Math.max(0, Math.min(nf - 1, tp * REC_HZ)), k = Math.min(nf - 2, Math.floor(f)), a = f - k;
    const p0 = src[Math.max(0, k - 1)], p1 = src[k], p2 = src[k + 1], p3 = src[Math.min(nf - 1, k + 2)];
    const a2 = a * a, a3 = a2 * a;
    for (let q = 0; q < stride; q++) out[q] = 0.5 * (2 * p1[q] + (-p0[q] + p2[q]) * a + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * a2 + (-p0[q] + 3 * p1[q] - 3 * p2[q] + p3[q]) * a3);
    return out;
  };
  const tmp = new Float32Array(N * 3);
  // positions des nœuds dans le monde à la phase u (u peut dépasser 1 : seule la partie fractionnaire compte)
  function pose(u, out = new Float32Array(N * 3)) {
    const ph = u - Math.floor(u);
    sample(tau(ph * dur), tmp);
    // (ligne droite : le lacet résiduel est réparti par une rotation d'ensemble autour du centre de départ)
    const corr = arc ? 0 : -fit.th * ph;
    for (let i = 0; i < N; i++) {
      let x = tmp[i * 3], z = tmp[i * 3 + 2];
      if (corr) { const r = rot(corr, x - c0[0], z - c0[1]); x = r[0] + c0[0]; z = r[1] + c0[1]; }
      const [wx, wz] = toWorld(x, z);
      out[i * 3] = wx; out[i * 3 + 1] = tmp[i * 3 + 1]; out[i * 3 + 2] = wz;
    }
    return out;
  }
  const NC = P.rests[0].length, rtmp = new Float32Array(NC);
  function rests(u, out = new Float32Array(NC)) {
    const ph = u - Math.floor(u);
    return sample(tau(ph * dur), out, P.rests, NC);
  }
  // le déplacement idéal du pas à la phase u : rotation (arc) ou translation (ligne)
  // rend la pose d'un repère : origine [x, z] et cap ψ
  function rig(u) {
    const ph = u;
    if (arc) {
      const th = fit.th * ph;
      // rotation autour de C, dans le monde (θ conserve son signe : W est une rotation)
      const [x, z] = rot(th, -C[0], -C[1]);
      return { x: x + C[0], z: z + C[1], psi: th };
    }
    return { x: dist * ph, z: 0, psi: 0 };
  }
  // encombrement (pose de départ) : longueur selon la marche, hauteur, profondeur
  const ext = (() => {
    const Q = pose(0), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], Q[i * 3 + a]); hi[a] = Math.max(hi[a], Q[i * 3 + a]); }
    return [hi[0] - lo[0], hi[1], hi[2] - lo[2]];
  })();
  return {
    N, NC, dur, pose, rests, rig, tau, ks, arc, C, theta: fit.th, dist, seamErr, shapeErr, ext, T: P.T,
    period: arc ? Rarc * Math.abs(fit.th) : dist, Rarc: arc ? Math.hypot(C[0], C[1]) : Infinity,
    frames, perm,
  };
}
