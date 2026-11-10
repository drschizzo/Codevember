// Relecture de la simulation enregistrée (module pur : scène, caméra, tests).
//
// La simulation est enregistrée à 30 images par seconde de film ; on la relit
// en Catmull-Rom (positions, quaternions renormalisés, état du balancier), puis
// on calcule, par brin, une courbe dense (Catmull-Rom entre sommets, SUB points
// par segment) et le premier vecteur d1 du repère matériel en chaque point
// (interpolé entre les centres des segments, orthogonalisé contre la tangente) :
// c'est lui qui porte la rayure, qui rend la torsion visible.

export const SUB = 3;

// état interpolé à l'instant t (secondes de film) : { P, Q, flyY, flyPhi, theta }
export function sampleSim(S, t, out = null) {
  const n = S.stride, f = ((t * S.fps) % S.nf + S.nf) % S.nf, i1 = Math.floor(f), u = f - i1;
  out ??= { buf: new Float32Array(n) };
  const fr = S.frames, idx = (i) => ((i % S.nf) + S.nf) % S.nf * n;
  const a = idx(i1 - 1), b = idx(i1), c = idx(i1 + 1), d = idx(i1 + 2);
  const u2 = u * u, u3 = u2 * u;
  const w0 = -0.5 * u3 + u2 - 0.5 * u, w1 = 1.5 * u3 - 2.5 * u2 + 1, w2 = -1.5 * u3 + 2 * u2 + 0.5 * u, w3 = 0.5 * u3 - 0.5 * u2;
  const o = out.buf;
  // (les angles du volant et du mandrin se déroulent : on interpole leurs écarts,
  // pas leurs valeurs, autour du raccord de la boucle où ils sautent de N tours)
  for (let k = 0; k < n; k++) o[k] = w0 * fr[a + k] + w1 * fr[b + k] + w2 * fr[c + k] + w3 * fr[d + k];
  const TAU = Math.PI * 2;
  for (const k of [n - 3, n - 2]) {
    const ref = fr[b + k];
    const unwrap = (v) => v - TAU * Math.round((v - ref) / TAU) * (Math.abs(v - ref) > 3 ? 1 : 0);
    o[k] = w0 * unwrap(fr[a + k]) + w1 * ref + w2 * unwrap(fr[c + k]) + w3 * unwrap(fr[d + k]);
  }
  // quaternions : alignés sur le signe de l'image de référence (au raccord de
  // la boucle, un quaternion peut avoir changé de signe), puis renormalisés
  const q0 = S.nv * 3;
  for (let j = 0; j < S.ns; j++) {
    const q = q0 + j * 4;
    let acc0 = 0, acc1 = 0, acc2 = 0, acc3 = 0;
    for (const [base, w] of [[a, w0], [b, w1], [c, w2], [d, w3]]) {
      const dd = fr[base + q] * fr[b + q] + fr[base + q + 1] * fr[b + q + 1] + fr[base + q + 2] * fr[b + q + 2] + fr[base + q + 3] * fr[b + q + 3];
      const sw = dd < 0 ? -w : w;
      acc0 += sw * fr[base + q]; acc1 += sw * fr[base + q + 1]; acc2 += sw * fr[base + q + 2]; acc3 += sw * fr[base + q + 3];
    }
    o[q] = acc0; o[q + 1] = acc1; o[q + 2] = acc2; o[q + 3] = acc3;
    const l = Math.hypot(o[q], o[q + 1], o[q + 2], o[q + 3]) || 1;
    o[q] /= l; o[q + 1] /= l; o[q + 2] /= l; o[q + 3] /= l;
  }
  out.flyY = o[n - 4]; out.flyPhi = o[n - 3]; out.theta = o[n - 2];
  return out;
}

// courbe dense d'un brin : positions (M × 3) et d1 (M × 3), M = n·SUB + 1
export function denseStrand(S, st, k, pos, d1) {
  const { n, v0, s0 } = S.strands[k], o = st.buf, q0 = S.nv * 3;
  const V = (i) => { i = Math.max(0, Math.min(n, i)); return (v0 + i) * 3; };
  const M = n * SUB + 1;
  for (let m = 0; m < M; m++) {
    const s = m / SUB, i = Math.min(n - 1, Math.floor(s)), u = s - i;
    const a = V(i - 1), b = V(i), c = V(i + 1), d = V(i + 2);
    const u2 = u * u, u3 = u2 * u;
    const w0 = -0.5 * u3 + u2 - 0.5 * u, w1 = 1.5 * u3 - 2.5 * u2 + 1, w2 = -1.5 * u3 + 2 * u2 + 0.5 * u, w3 = 0.5 * u3 - 0.5 * u2;
    for (let c3 = 0; c3 < 3; c3++) pos[m * 3 + c3] = w0 * o[a + c3] + w1 * o[b + c3] + w2 * o[c + c3] + w3 * o[d + c3];
  }
  // d1 de chaque segment (colonne 0 de la rotation)
  const D = (j) => {
    j = Math.max(0, Math.min(n - 1, j));
    const q = q0 + (s0 + j) * 4, x = o[q], y = o[q + 1], z = o[q + 2], w = o[q + 3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
  };
  for (let m = 0; m < M; m++) {
    const s = m / SUB - 0.5, j = Math.floor(s), u = s - j;
    const A = D(j), B = D(j + 1);
    let x = A[0] * (1 - u) + B[0] * u, y = A[1] * (1 - u) + B[1] * u, z = A[2] * (1 - u) + B[2] * u;
    // tangente de la courbe dense
    const m0 = Math.max(0, m - 1), m1 = Math.min(M - 1, m + 1);
    let tx = pos[m1 * 3] - pos[m0 * 3], ty = pos[m1 * 3 + 1] - pos[m0 * 3 + 1], tz = pos[m1 * 3 + 2] - pos[m0 * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const dt = x * tx + y * ty + z * tz;
    x -= dt * tx; y -= dt * ty; z -= dt * tz;
    const l = Math.hypot(x, y, z) || 1;
    d1[m * 3] = x / l; d1[m * 3 + 1] = y / l; d1[m * 3 + 2] = z / l;
  }
  return M;
}
