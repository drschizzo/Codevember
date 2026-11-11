// Cinématique de l'appareil : cotes, matrices, bielles, courroie. Module pur
// (Node, workers, rendu) — la scène, les maillages et les tests lisent les
// mêmes nombres.
//
// Repères :
//  - plateau (physique) : x, y dans le plan du fond, z normale, en mm ;
//  - plateau (three) : X = x, Y = z, Z = −y, à l'échelle S (1 unité = 100 mm) ;
//  - monde (three) : Y vers le haut, le dessus du support à Y = 0, caméra
//    vers −Z.
import { DIM } from './gen/maze.js';
import { BACK } from './gen/plan.js';

export const S = 0.01; // mm → unités de la scène
export const PIN = 7;   // décalage de l'œil de bielle le long du maneton (mm)

// ── Petites matrices 4×4 (colonnes, comme three.js) ──────────────────────────
export const mat = {
  id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  tr: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  rx: (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  ry: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rz: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  // repère : colonnes X, Y, Z (vecteurs unitaires) et origine
  basis: (X, Y, Z, o = [0, 0, 0]) => [X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, o[0], o[1], o[2], 1],
  apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
  dir(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; },
};
const v = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]), norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};
export { v as vec };

// plateau (physique, mm) → plateau (three, unités)
export const boardToLocal = (x, y, z) => [x * S, z * S, -y * S];

// ── Cotes ────────────────────────────────────────────────────────────────────
// maze : labyrinthe (extent, race) ; renvoie le gabarit de l'appareil, en mm
export function layout(maze, family) {
  const rim = maze.race.rim, Hr = DIM.H + 3; // (le cadre dépasse les parois de 3 mm)
  const shape = rim.t === 'circle' ? 'circle' : 'rect';
  const out = shape === 'circle' ? { r: rim.r + DIM.rim } : { hx: rim.hx + DIM.rim, hy: rim.hy + DIM.rim, rr: rim.rr + DIM.rim };
  const Rout = shape === 'circle' ? out.r : Math.hypot(out.hx, out.hy);
  const L = { family, shape, rim, out, Rout, Hr, slab: DIM.slab };
  if (family === 'plateau') {
    // cardan sous le centre, colonne, deux moteurs à manivelle sous les bords
    // proche (A, angle α) et gauche (B, angle β)
    const ext = shape === 'circle' ? out.r : Math.min(out.hx, out.hy);
    const pz = 24;                        // centre du cardan sous la dalle
    const d = Math.round(ext * 0.62);     // points d'attache des bielles
    const rc = 15, Lr = 66;               // manivelle, bielle
    const plinth = { h: 34, hx: d + rc + 40, hz: d + rc + 40 };
    const motorR = 21, motorLen = 58;
    // hauteur du pivot : le moteur (rayon 21) posé sur sa console au-dessus du socle
    const My = plinth.h + 14 + motorR;
    const pivotY = My + Lr - pz + 12; // (l'œil supérieur est 12 mm sous la dalle)
    Object.assign(L, { pz, d, rc, Lr, plinth, motorR, motorLen, pivotY, floorY: pivotY + pz + DIM.slab });
    // moteurs : A sous le bord proche (−y du plateau → +Z monde), B sous le
    // bord gauche (−x) ; leur arbre est horizontal, tangent ; la manivelle
    // tourne dans le plan vertical radial ; au repos elle est horizontale,
    // tournée vers le centre, et la bielle verticale
    L.motors = [
      { name: 'A', attach: [0, -d, -DIM.slab - 12], inward: [0, 0, -1], axis: [1, 0, 0] },
      { name: 'B', attach: [-d, 0, -DIM.slab - 12], inward: [1, 0, 0], axis: [0, 0, 1] },
    ].map((m) => {
      const P0 = mat.apply(plateauMatrix(L, 0, 0), boardToLocal(...m.attach).map((x) => x / S));
      const C0 = v.sub(P0, [0, Lr, 0]);
      const M = v.sub(v.sub(C0, v.mul(m.inward, rc)), v.mul(m.axis, PIN)); // (l'œil de la bielle est 7 mm devant la manivelle, sur le maneton)
      return { ...m, P0, C0, M };
    });
    return L;
  }
  // disques dressés : un volant à gorge derrière le plateau, une courroie vers
  // la poulie du moteur, posé sous le plateau ; un palier sur une colonne derrière
  const Rv = Math.round(Math.min(Rout * 0.5, 110));
  const N = 5;                            // rapport volant / poulie (entier : la poulie revient à son angle)
  const rp = Rv / N;
  const tv = 14, gap = 6;                 // épaisseur du volant, jeu derrière la dalle
  const zv = -(DIM.slab + gap + tv / 2);  // plan de la courroie (z du plateau)
  const Dm = Math.round(Rout + rp + 22);  // poulie sous le bord le plus bas du plateau
  const base = { h: 40 };
  const motorR = 24, motorLen = 64;
  const Yc = base.h + 12 + motorR + Dm * Math.cos(BACK) + 8; // centre du plateau
  const zAxle = zv - tv / 2 - 34;         // palier : derrière le volant
  Object.assign(L, { Rv, N, rp, tv, gap, zv, Dm, base, motorR, motorLen, Yc, zAxle, back: BACK });
  return L;
}

// ── Plateau : cardan ─────────────────────────────────────────────────────────
// R = Rx(α)·Ry(β) en physique (x, y, z) ; en three : rotation de α autour de X,
// puis de −β autour de Z (l'axe y du plateau est −Z). Pivot au centre du cardan.
export function plateauMatrix(L, al, be) {
  return mat.mul(mat.mul(mat.mul(mat.tr(0, L.pivotY, 0), mat.rx(al)), mat.rz(-be)), mat.tr(0, L.pz + DIM.slab, 0));
}
// croisillon : tourne de α seulement
export const crossMatrix = (L, al) => mat.mul(mat.tr(0, L.pivotY, 0), mat.rx(al));

// manivelle : angle γ tel que la bielle garde sa longueur (Newton, depuis γ0)
export function crankAngle(L, m, P, g0 = 0) {
  const up = [0, 1, 0];
  let g = g0;
  for (let k = 0; k < 30; k++) {
    const C = v.add(v.add(m.M, v.mul(m.axis, PIN)), v.add(v.mul(m.inward, L.rc * Math.cos(g)), v.mul(up, L.rc * Math.sin(g))));
    const dC = v.add(v.mul(m.inward, -L.rc * Math.sin(g)), v.mul(up, L.rc * Math.cos(g)));
    const D = v.sub(P, C), f = v.dot(D, D) - L.Lr * L.Lr, df = -2 * v.dot(D, dC);
    const step = f / (df || 1e-9);
    g -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return g;
}
export function crankPin(L, m, g) {
  return v.add(v.add(m.M, v.mul(m.axis, PIN)), v.add(v.mul(m.inward, L.rc * Math.cos(g)), v.mul([0, 1, 0], L.rc * Math.sin(g))));
}
// pose complète du mécanisme du Plateau (mm) pour les angles du cardan
export function plateauPose(L, al, be) {
  const B = plateauMatrix(L, al, be);
  const motors = L.motors.map((m) => {
    const P = mat.apply(B, boardToLocal(...m.attach).map((x) => x / S));
    const g = crankAngle(L, m, P);
    return { P, g, C: crankPin(L, m, g) };
  });
  return { B, motors, cross: crossMatrix(L, al) };
}

// ── Disques dressés ──────────────────────────────────────────────────────────
// le plan du plateau penché de β vers l'arrière ; rotation φ autour de sa normale
export function discFrame(L) {
  const n = [0, Math.sin(L.back), Math.cos(L.back)], up = [0, Math.cos(L.back), -Math.sin(L.back)];
  return { n, up, X: [1, 0, 0], Y: n, Z: v.mul(up, -1), C: [0, L.Yc, 0] };
}
// (repère local three du plateau → monde, en mm), tourné de φ
export function discMatrix(L, phi) {
  const F = discFrame(L);
  return mat.mul(mat.basis(F.X, F.Y, F.Z, F.C), mat.ry(phi));
}
// centre de la poulie du moteur, dans le plan de la courroie (mm, monde)
export function pulleyCenter(L) {
  const F = discFrame(L);
  return v.add(v.add(F.C, v.mul(F.up, -L.Dm)), v.mul(F.n, L.zv));
}
// courroie ouverte : elle enveloppe le haut du volant et le bas de la poulie ;
// les deux brins sont tangents extérieurs (sin a = (R − r)/D). Points dans le
// plan (x, y) du plateau, en mm, volant en (0, 0), poulie en (0, −D) ; boucle fermée.
export function beltPath(L, n = 180) {
  const R1 = L.Rv, R2 = L.rp, D = L.Dm, a = Math.asin((R1 - R2) / D);
  const P = [];
  const n1 = Math.round(n * 0.75), n2 = n - n1;
  for (let i = 0; i < n1; i++) { const t = -a + ((Math.PI + 2 * a) * i) / n1; P.push([R1 * Math.cos(t), R1 * Math.sin(t)]); }
  for (let i = 0; i < n2; i++) { const t = Math.PI + a + ((Math.PI - 2 * a) * i) / n2; P.push([R2 * Math.cos(t), -D + R2 * Math.sin(t)]); }
  return P;
}
// matrice en mm → matrice en unités de la scène (translation mise à l'échelle)
export const toWorld = (m) => { const o = [...m]; o[12] *= S; o[13] *= S; o[14] *= S; return o; };

// ── Pose de la bille ─────────────────────────────────────────────────────────
// piste (film) lue au temps t (s), interpolée ; renvoie x, y, quaternion,
// angles de l'appareil (a, b)
export function sampleFilm(F, t) {
  const n = F.n, T = (n - 1) / F.rate;
  let u = ((t % T) + T) % T;
  const f = u * F.rate, i = Math.min(n - 2, Math.floor(f)), w = f - i;
  const lerp = (A) => A[i] + (A[i + 1] - A[i]) * w;
  const q0 = [F.q[4 * i], F.q[4 * i + 1], F.q[4 * i + 2], F.q[4 * i + 3]];
  let q1 = [F.q[4 * i + 4], F.q[4 * i + 5], F.q[4 * i + 6], F.q[4 * i + 7]];
  if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) q1 = q1.map((x) => -x);
  const q = q0.map((x, k) => x + (q1[k] - x) * w), ql = Math.hypot(...q);
  return { x: lerp(F.x), y: lerp(F.y), q: q.map((x) => x / ql), a: lerp(F.a), b: lerp(F.b) };
}

// ── Caméra du film ───────────────────────────────────────────────────────────
// Un point d'attention : le centre de l'appareil, tiré vers la position lissée
// de la bille (noyau gaussien périodique, σ ≈ 1,6 s) ; azimut et hauteur
// tirés par la recette, un balancement d'une période par boucle. Périodique
// en ph par construction. D : { layout, film } ; R : recette.
export function cameraPath(D, R, n = 240) {
  const L = D.layout, F = D.film, T = F.duration;
  const centre = L.family === 'plateau' ? [0, L.floorY, 0] : [0, L.Yc - 25, 0];
  const raw = [];
  for (let i = 0; i < n; i++) {
    const s = sampleFilm(F, (i / n) * T);
    const Bm = L.family === 'plateau' ? plateauPose(L, s.a, s.b).B : discMatrix(L, s.a);
    raw.push(mat.apply(Bm, [s.x, DIM.ball, -s.y]));
  }
  const sig = Math.max(2, (1.6 / T) * n), K = Math.ceil(3 * sig);
  const pts = raw.map((_, i) => {
    let w = 0, acc = [0, 0, 0];
    for (let k = -K; k <= K; k++) { const g = Math.exp(-(k * k) / (2 * sig * sig)); acc = v.add(acc, v.mul(raw[(i + k + n) % n], g)); w += g; }
    return v.mul(acc, 1 / w);
  });
  return {
    centre,
    pose(ph, aspect = 16 / 9) {
      const C = R.camera;
      ph -= Math.floor(ph);
      // Catmull-Rom périodique sur les points lissés
      const f = ph * n, i = Math.floor(f) % n, t = f - Math.floor(f);
      const P = (k) => pts[(i + k + n) % n];
      const cr = (a, b, c, d) => a.map((_, j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t * t * t));
      const ball = cr(P(-1), P(0), P(1), P(2));
      const tgt = v.add(centre, v.mul(v.sub(ball, centre), C.follow));
      const fov = (C.fov * Math.PI) / 180, hfov = 2 * Math.atan(Math.tan(fov / 2) * Math.min(aspect, 1.6));
      const rad = L.family === 'plateau' ? L.Rout * 1.02 : L.Rout + L.Dm * 0.45;
      const dist = rad / Math.sin(Math.min(fov, hfov) / 2) / (C.fill ?? 0.85);
      const TAU = Math.PI * 2;
      const az = C.az + C.sway * Math.sin(TAU * ph), el = C.el + C.sway * 0.4 * Math.sin(TAU * ph * 2 + 1);
      const pos = [tgt[0] + dist * Math.cos(el) * Math.sin(az), tgt[1] + dist * Math.sin(el), tgt[2] + dist * Math.cos(el) * Math.cos(az)];
      return { pos: pos.map((x) => x * S), target: tgt.map((x) => x * S), dist: dist * S };
    },
  };
}
