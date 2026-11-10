// Cinématique de la plante : à un instant physique τ, la pose de chaque
// pétiole, de chaque pinnule et de chaque foliole.
//
// Module pur (sans three.js) : la scène l'appelle à chaque image et envoie
// les matrices au GPU (tampon entrelacé, voir scene/plant.js) ; les tests
// l'appellent pour vérifier la boucle et l'absence d'interpénétration.
//
// Hiérarchie de corps rigides :
//   feuille   — rotation autour du pulvinus primaire (base du pétiole), axe
//               horizontal ⟂ au pétiole : l'affaissement ;
//   pinnule   — rotation d'axe fixe autour du pulvinus secondaire (bout du
//               pétiole) : le rapprochement ; plus la flexion due au choc ;
//   foliole   — rotation d'axe fixe autour de sa pulvinule : le pli.
// Les matrices sont affines 3×4, rangées par lignes : [r0 | r1 | r2] (12 nombres).
import { leafletFrames, pinnaPose, frameXZ, pinnaUp, rot, LEAFLET, v3, rachisPoint } from './gen/plant.js';
import { closeCurve, impactDip, SIGNAL, kineticsOf } from './physio.js';

const { cos, sin, max, min } = Math;
const UP = [0, 1, 0];

// ── matrices affines 3×4 (lignes) ────────────────────────────────────────────
// M = [R | t] ; R·x + t
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mulM(A, B, out = new Array(12)) {
  for (let r = 0; r < 3; r++) {
    const a0 = A[4 * r], a1 = A[4 * r + 1], a2 = A[4 * r + 2], a3 = A[4 * r + 3];
    out[4 * r] = a0 * B[0] + a1 * B[4] + a2 * B[8];
    out[4 * r + 1] = a0 * B[1] + a1 * B[5] + a2 * B[9];
    out[4 * r + 2] = a0 * B[2] + a1 * B[6] + a2 * B[10];
    out[4 * r + 3] = a0 * B[3] + a1 * B[7] + a2 * B[11] + a3;
  }
  return out;
}
// rotation d'axe unitaire a, d'angle t, autour du point p
function rotAbout(a, t, p, out = new Array(12)) {
  const c = cos(t), s = sin(t), k = 1 - c, [x, y, z] = a;
  const R = [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
  out[0] = R[0]; out[1] = R[1]; out[2] = R[2];
  out[4] = R[3]; out[5] = R[4]; out[6] = R[5];
  out[8] = R[6]; out[9] = R[7]; out[10] = R[8];
  out[3] = p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]);
  out[7] = p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]);
  out[11] = p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2]);
  return out;
}
// repère [X, Y, Z] mis à l'échelle (sx, sy, sz), origine o
function placed(F, sx, sy, sz, o) {
  const [X, Y, Z] = F;
  return [X[0] * sx, Y[0] * sy, Z[0] * sz, o[0], X[1] * sx, Y[1] * sy, Z[1] * sz, o[1], X[2] * sx, Y[2] * sy, Z[2] * sz, o[2]];
}
export const applyM = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3], M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7], M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11]];

// ── Préparation (une fois par plante) ────────────────────────────────────────
export function createPoser(plant, plan = { events: [], P: 1 }) {
  const leaves = plant.leaves;
  const pinnae = [], pairs = [];
  for (const L of leaves) {
    L.droopAxis = v3.norm(v3.cross(L.dir, UP));
    // repère du pétiole (gabarit le long de +X)
    L.frame = frameXZ(L.dir, v3.sub(UP, v3.mul(L.dir, L.dir[1])));
    L.pinnae.forEach((P, pi) => {
      const pr = pinnaPose(P, 0);
      const t0 = pr.t, n0 = pr.n;
      const y0 = v3.cross(n0, t0);
      const idx = pinnae.length;
      pinnae.push({ L, P, pi, t0, n0, y0, frame: [t0, y0, n0], hinge: P._h });
      for (const [qi, q] of P.pairs.entries()) {
        const B = rachisPoint(L, P, t0, n0, q.s);
        const side = (sg) => {
          const F = leafletFrames(t0, n0, sg, P.fold ?? P.down);
          const base = v3.add(B, v3.mul(y0, sg * LEAFLET.rachisR));
          // matrice de repos (gabarit → monde, avant le pli) et charnière
          return { F, base, rest: placed(F.open, q.len, q.wid, q.wid, base) };
        };
        // trèfle, dionée : un limbe d'un seul tenant, posé dans le repère de la
        // pinnule ; son pli (la pliure le long de la nervure) est fait dans le
        // shader d'après l'état de fermeture (voir foldPoint)
        const full = P.fold?.half ? { base: B, rest: placed([t0, y0, n0], q.len, q.wid, q.wid, B) } : null;
        pairs.push({ pinna: idx, leaf: L.id, q, qi, node: q.node, l: side(1), r: side(-1), full });
      }
    });
  }

  // réponses : pour chaque événement, les nœuds touchés (amplitude au-dessus
  // du seuil) et leurs instants d'arrivée
  const T = SIGNAL.threshold;
  const resp = (node, level, delay = () => 0) => {
    const out = [];
    for (const E of plan.events) {
      const a = E.amp[node];
      if (a >= T[level]) out.push(E.tc + E.arr[node] + delay(E));
    }
    return out;
  };
  for (const L of leaves) { L.respP = resp(L.nodeP, 'petiole', (E) => E.delayP?.[L.id] ?? 0); L.respS = resp(L.nodeS, 'pinna'); }
  for (const p of pairs) p.resp = resp(p.node, 'leaflet');
  const Pp = plan.P;
  const K = kineticsOf(plant.family);
  // f = max_k F(mod(τ − a_k, P)) — fonction périodique de τ
  const level = (times, name, tau) => {
    let f = 0;
    for (const a of times) {
      let d = (tau - a) % Pp;
      if (d < 0) d += Pp;
      f = max(f, closeCurve(name, d, K));
    }
    return f;
  };
  // flexion au choc d'une goutte (pinnule et foliole touchées)
  const dips = plan.events.filter((E) => E.cause === 'drop');
  const dipOf = (tau, test, A, f, z) => {
    let s = 0;
    for (const E of dips) if (test(E)) { let d = (tau - E.tc) % Pp; if (d < 0) d += Pp; s += impactDip(d, A * E.impulse, f, z); }
    return s;
  };

  const nL = leaves.length, nP = pinnae.length, nQ = pairs.length;
  const out = {
    petiole: new Float32Array(nL * 12), rachis: new Float32Array(nP * 12),
    left: new Float32Array(nQ * 12), right: new Float32Array(nQ * 12),
    state: new Float32Array(nQ), // fermeture des folioles (pour le shader : ombre de pli, etc.)
  };
  const Mleaf = new Array(nL), Mpin = new Array(nP);
  const tmp = new Array(12), tmp2 = new Array(12), tmp3 = new Array(12);

  function update(tau) {
    // feuilles : affaissement
    for (let i = 0; i < nL; i++) {
      const L = leaves[i];
      const f = level(L.respP, 'petiole', tau);
      L.fP = f;
      Mleaf[i] = rotAbout(L.droopAxis, -L.droop * f, L.base, Mleaf[i] || new Array(12));
      const M = mulM(Mleaf[i], placed(L.frame, L.pet, 1, 1, L.base), tmp);
      out.petiole.set(M, i * 12);
    }
    // pinnules : rapprochement + flexion au choc
    for (let j = 0; j < nP; j++) {
      const p = pinnae[j], L = p.L;
      const f = level(L.respS, 'pinna', tau);
      p.f = f;
      const h = rotAbout(p.hinge.axis, p.hinge.angle * f, L.tip, tmp);
      const dip = dipOf(tau, (E) => E.leaf === L.id && E.pinna === p.pi, 0.12, 5.5, 0.12);
      const d = rotAbout(v3.norm(rot(p.y0, p.hinge.axis, p.hinge.angle * f)), dip, L.tip, tmp2);
      Mpin[j] = mulM(Mleaf[L.id], mulM(d, h, tmp3), Mpin[j] || new Array(12));
      const M = mulM(Mpin[j], placed(p.frame, p.P.len, 1, 1, L.tip), tmp);
      out.rachis.set(M, j * 12);
    }
    // folioles : pli autour de la pulvinule
    for (let k = 0; k < nQ; k++) {
      const q = pairs[k];
      const f = level(q.resp, 'leaflet', tau);
      out.state[k] = f;
      if (q.full) {
        const W = mulM(Mpin[q.pinna], q.full.rest, tmp3);
        out.left.set(W, k * 12); out.right.set(W, k * 12);
        continue;
      }
      for (const [s, arr] of [[q.l, out.left], [q.r, out.right]]) {
        const { axis, angle } = s.F.hinge;
        let M = rotAbout(axis, angle * f, s.base, tmp);
        // la foliole frappée plie sous la goutte (rotation autour de sa largeur)
        const dl = dipOf(tau, (E) => E.pair === k && E.sideObj === (s === q.l ? 1 : -1), 0.45, 14, 0.22);
        if (dl) {
          const Yc = v3.norm(rot(s.F.open[1], axis, angle * f));
          M = mulM(rotAbout(Yc, dl, s.base, tmp2), M, tmp3); // (+ : la pointe descend)
        }
        const W = mulM(Mpin[q.pinna], mulM(M, s.rest, tmp2), tmp3);
        arr.set(W, k * 12);
      }
    }
    return out;
  }

  return { update, out, leaves, pinnae, pairs, counts: { leaves: nL, pinnae: nP, pairs: nQ } };
}
