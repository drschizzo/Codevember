// Cinématique de l'armature : chaque pièce est rigide (à un facteur d'échelle
// près) et suit, au temps normalisé t ∈ [0, 1] de l'éclosion,
//
//   q  = b + (p − b)·(1 + sc·e_s) + dir·ext·e_x   (déploiement : gonflement autour
//        de la charnière — la pièce reste attachée —, extension)
//   p' = b + R(a, th·e_r)·(q − b)            (ouverture autour d'une charnière)
//
// u = clamp((t − delay) / dur) ; e(u) = 6u⁵ − 15u⁴ + 10u³ (départ et arrivée
// sans à-coup). Nature 0 : tout ensemble ; nature 1 : l'extension d'abord, la
// rotation ensuite (une épine sort, puis s'incline).
//
// La même formule existe dans le vertex shader (scene/armature.js) : la
// simulation de la membrane (collisions) et l'image voient exactement la même
// armature.

export const ease = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * u * (u * (u * 6 - 15) + 10); };

// Les assauts : avant de s'ouvrir pour de bon, l'armature pousse n fois, de
// plus en plus fort (amplitude a·(0,45 + 0,55·k/n), en temps « ouverture »),
// et recule entre deux — poussée vive, retour plus lent. Ils occupent la
// fraction f du déploiement ; l'ouverture finale prend le reste.
//   S = { n, a, f } ; n = 0 : pas d'assaut.
export function struggle(u, S) {
  if (!S || S.n <= 0 || S.f <= 0) return u;
  if (u >= S.f) return (u - S.f) / (1 - S.f);
  const w = (u / S.f) * S.n, k = Math.floor(w), v = w - k;
  return S.a * (0.45 + (0.55 * (k + 1)) / S.n) * Math.sin(Math.PI * v ** 0.75) ** 2;
}

export function partEases(P, t, dur) {
  const u = struggle(Math.min(1, Math.max(0, (t - P.delay) / dur)), P.st);
  if (P.mode === 1) { const ex = ease(u / 0.45); return { r: ease((u - 0.35) / 0.65), x: ex, s: ex }; }
  const e = ease(u);
  return { r: e, x: e, s: e };
}

// Pose d'une pièce : matrice 3×3 (lignes) M et translation T, p' = M·p + T
export function partPose(P, t, dur) {
  const E = partEases(P, t, dur);
  const th = P.th * E.r, c = Math.cos(th), s = Math.sin(th), k = 1 - c;
  const [x, y, z] = P.a;
  const R = [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
  const sig = 1 + P.sc * E.s;
  const d = [P.dir[0] * P.ext * E.x - P.b[0] * sig, P.dir[1] * P.ext * E.x - P.b[1] * sig, P.dir[2] * P.ext * E.x - P.b[2] * sig];
  // p' = R·(σ(p − b) + dir·ext) + b = (σR)·p + (R·d + b), d = dir·ext − σb
  const M = R.map((v) => v * sig);
  const T = [
    R[0] * d[0] + R[1] * d[1] + R[2] * d[2] + P.b[0],
    R[3] * d[0] + R[4] * d[1] + R[5] * d[2] + P.b[1],
    R[6] * d[0] + R[7] * d[1] + R[8] * d[2] + P.b[2],
  ];
  return { M, T, sig, R };
}

// p' = M p + T ; et l'inverse (M = σR, R orthogonale : M⁻¹ = Rᵀ/σ)
export const apply = (pose, p, o = [0, 0, 0], i = 0) => {
  const { M, T } = pose, x = p[i], y = p[i + 1], z = p[i + 2];
  o[0] = M[0] * x + M[1] * y + M[2] * z + T[0];
  o[1] = M[3] * x + M[4] * y + M[5] * z + T[1];
  o[2] = M[6] * x + M[7] * y + M[8] * z + T[2];
  return o;
};
export const unapply = (pose, p, o = [0, 0, 0], i = 0) => {
  const { R, T, sig } = pose, x = p[i] - T[0], y = p[i + 1] - T[1], z = p[i + 2] - T[2];
  o[0] = (R[0] * x + R[3] * y + R[6] * z) / sig;
  o[1] = (R[1] * x + R[4] * y + R[7] * z) / sig;
  o[2] = (R[2] * x + R[5] * y + R[8] * z) / sig;
  return o;
};
