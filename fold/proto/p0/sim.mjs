// Fold · essai p0 : la feuille qui se plie seule.
//
// Une feuille = un maillage de triangles. Chaque arête est une barre (elle garde
// sa longueur : le papier ne s'étire pas), chaque arête intérieure une charnière
// (elle vise un angle : 0 dans un pan, ±θ sur une pliure). Le solveur cherche
// l'équilibre par dynamique amortie (d'après Ghassaei et al., 2018).

// ── Patrons ──────────────────────────────────────────────────────────────────
// Variante à mailles régulières : le nombre de mailles d'un anneau croît avec
// son rayon (les petites mailles du centre ruinaient la convergence), et deux
// anneaux voisins sont cousus en fermeture éclair, côté par côté.
export function pleatedU({ n = 4, rings = 14, sub = 2, m = 14, hole = 0.08 } = {}) {
  const round = n >= 32, sides = round ? 1 : n, K = rings * sub, w = (2 * Math.PI) / n;
  const P = [], uv = [], tris = [], ringOf = [], corner = [], start = [], per = [];
  for (let k = 0; k <= K; k++) {
    const r = hole + (1 - hole) * (k / K), sk = round ? Math.max(8, 4 * Math.round((2 * Math.PI * r * m) / 4)) : Math.max(1, Math.round(2 * Math.sin(w / 2) * r * m));
    start.push(P.length / 3); per.push(sk);
    for (let i = 0; i < sides; i++) for (let j = 0; j < sk; j++) {
      const t = j / sk;
      let X, Z;
      if (round) { const a = 2 * Math.PI * t; X = r * Math.cos(a); Z = r * Math.sin(a); } else {
        const a0 = i * w, a1 = a0 + w;
        X = r * ((1 - t) * Math.cos(a0) + t * Math.cos(a1)); Z = r * ((1 - t) * Math.sin(a0) + t * Math.sin(a1));
      }
      P.push(X, 0, Z); uv.push(Math.atan2(Z, X) / (2 * Math.PI) + 0.5, k / K); ringOf.push(k); corner.push(!round && j === 0 ? 1 : 0);
    }
  }
  const at = (k, i, j) => start[k] + ((i * per[k] + j) % (sides * per[k]));
  for (let k = 0; k < K; k++) for (let i = 0; i < sides; i++) {
    const a = per[k], b = per[k + 1];
    let p = 0, q = 0;
    while (p < a || q < b) {
      // avance sur l'anneau dont le prochain point est le plus en retard
      if (q < b && (p >= a || (q + 1) / b <= (p + 1) / a + 1e-9)) { tris.push(at(k, i, p), at(k + 1, i, q + 1), at(k + 1, i, q)); q++; }
      else { tris.push(at(k, i, p), at(k, i, p + 1), at(k + 1, i, q)); p++; }
    }
  }
  const crease = (i0, i1) => {
    const k0 = ringOf[i0], k1 = ringOf[i1];
    if (k0 === k1 && k0 % sub === 0 && k0 > 0 && k0 < K) return (k0 / sub) & 1 ? 1 : -1;
    if (k0 !== k1 && corner[i0] && corner[i1]) return (Math.min(k0, k1) / sub | 0) & 1 ? -0.6 : 0.6;
    return 0;
  };
  const S = build(P, uv, tris, crease, []);
  S.ringOf = ringOf; S.K = K; S.q = round || n === 8 ? 2 : n / 2; S.w = Math.PI / S.q; S.m = m;
  // tour de 2π/n : le sommet i va sur perm[i]
  S.perm = new Uint32Array(S.N);
  for (let k = 0; k <= K; k++) { const c = sides * per[k], sh = round ? Math.round(per[k] / 4) : per[k] * Math.round(S.w / w); for (let j = 0; j < c; j++) S.perm[start[k] + j] = start[k] + (j + sh) % c; }
  return S;
}

function build(P, uv, tris, creaseOf, pin) {
  const N = P.length / 3, T = tris.length / 3;
  const E = new Map(); // arête → [i0, i1, sommet opposé A, sommet opposé B]
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const a = tris[3 * t + e], b = tris[3 * t + (e + 1) % 3], c = tris[3 * t + (e + 2) % 3];
    const key = a < b ? a * N + b : b * N + a;
    const r = E.get(key);
    if (!r) E.set(key, [a, b, c, -1]); else r[3] = c;
  }
  const bars = [], hinges = [];
  for (const [a, b, c, d] of E.values()) {
    const l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
    bars.push(a, b, l);
    if (d >= 0) hinges.push(a, b, c, d, creaseOf(a, b) || creaseOf(b, a), l);
  }
  return { N, P: new Float32Array(P), uv: new Float32Array(uv), tris: new Uint32Array(tris), bars, hinges, pin };
}

// ── Angle dièdre et son gradient ─────────────────────────────────────────────
// Arête x0→x1 ; x2 en face dans le triangle (x0, x1, x2), x3 dans l'autre.
export function dihedral(x, a, b, c, d, g) {
  const ex = x[3 * b] - x[3 * a], ey = x[3 * b + 1] - x[3 * a + 1], ez = x[3 * b + 2] - x[3 * a + 2];
  const ux = x[3 * c] - x[3 * a], uy = x[3 * c + 1] - x[3 * a + 1], uz = x[3 * c + 2] - x[3 * a + 2];
  const vx = x[3 * d] - x[3 * a], vy = x[3 * d + 1] - x[3 * a + 1], vz = x[3 * d + 2] - x[3 * a + 2];
  const ax = ey * uz - ez * uy, ay = ez * ux - ex * uz, az = ex * uy - ey * ux; // nA = e × u
  const bx = vy * ez - vz * ey, by = vz * ex - vx * ez, bz = vx * ey - vy * ex; // nB = v × e
  const L = Math.hypot(ex, ey, ez), a2 = ax * ax + ay * ay + az * az, b2 = bx * bx + by * by + bz * bz;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const th = Math.atan2((cx * ex + cy * ey + cz * ez) / L, ax * bx + ay * by + az * bz);
  if (g) {
    const sa = -L / Math.max(a2, 1e-12), sb = -L / Math.max(b2, 1e-12);
    g[6] = sa * ax; g[7] = sa * ay; g[8] = sa * az;
    g[9] = sb * bx; g[10] = sb * by; g[11] = sb * bz;
    const L2 = L * L;
    const p1 = ((ex - ux) * ex + (ey - uy) * ey + (ez - uz) * ez) / L2, p2 = ((ex - vx) * ex + (ey - vy) * ey + (ez - vz) * ez) / L2;
    const q1 = (ux * ex + uy * ey + uz * ez) / L2, q2 = (vx * ex + vy * ey + vz * ez) / L2;
    for (let i = 0; i < 3; i++) { g[i] = -p1 * g[6 + i] - p2 * g[9 + i]; g[3 + i] = -q1 * g[6 + i] - q2 * g[9 + i]; }
  }
  return th;
}

// ── Solveur ──────────────────────────────────────────────────────────────────
// Les charnières sont des forces, les barres des contraintes de longueur
// projetées (Gauss-Seidel, quelques passes) : le papier ne s'étire pas, et le
// pas de temps ne dépend que de la raideur des plis.
export function createSolver(S, { k = 0.7, dtK = 0.25, iters = 4, drag = 0.05 } = {}) {
  const { N, bars, hinges } = S, NB = bars.length / 3, NH = hinges.length / 6;
  const x = Float64Array.from(S.P), v = new Float64Array(3 * N), xp = new Float64Array(3 * N), f = new Float64Array(3 * N), G = new Float64Array(12);
  const target = new Float64Array(NH);
  let lmin = 1e9;
  for (let b = 0; b < NB; b++) lmin = Math.min(lmin, bars[3 * b + 2]);
  const dt = dtK * Math.sqrt(lmin / k);
  const ring0 = [];
  for (let i = 0; i < N; i++) if (S.ringOf[i] === 0) ring0.push(i);
  // force : (i, fx, fy, fz) ajoutée à chaque pas (le coup de pouce qui choisit la selle)
  function step(n = 1, push = null) {
    for (let s = 0; s < n; s++) {
      f.fill(0);
      if (push) push(f, x);
      for (let h = 0; h < NH; h++) {
        const a = hinges[6 * h], b = hinges[6 * h + 1], c = hinges[6 * h + 2], d = hinges[6 * h + 3], l = hinges[6 * h + 5];
        let dth = dihedral(x, a, b, c, d, G) - target[h];
        if (dth > Math.PI) dth -= 2 * Math.PI; else if (dth < -Math.PI) dth += 2 * Math.PI;
        const kk = -k * l * dth;
        for (let i = 0; i < 3; i++) { f[3 * a + i] += kk * G[i]; f[3 * b + i] += kk * G[3 + i]; f[3 * c + i] += kk * G[6 + i]; f[3 * d + i] += kk * G[9 + i]; }
      }
      for (let i = 0; i < 3 * N; i++) { v[i] = (v[i] + dt * f[i]) * (1 - drag); xp[i] = x[i] + dt * v[i]; }
      for (let it = 0; it < iters; it++) for (let b = 0; b < NB; b++) {
        const i = bars[3 * b], j = bars[3 * b + 1], l0 = bars[3 * b + 2];
        const dx = xp[3 * j] - xp[3 * i], dy = xp[3 * j + 1] - xp[3 * i + 1], dz = xp[3 * j + 2] - xp[3 * i + 2];
        const c = 0.5 * (Math.sqrt(dx * dx + dy * dy + dz * dz) - l0) / Math.sqrt(dx * dx + dy * dy + dz * dz);
        xp[3 * i] += c * dx; xp[3 * i + 1] += c * dy; xp[3 * i + 2] += c * dz; xp[3 * j] -= c * dx; xp[3 * j + 1] -= c * dy; xp[3 * j + 2] -= c * dz;
      }
      // la feuille tient par son centre : l'anneau intérieur reste centré, et la
      // feuille ne tourne pas sur elle-même
      let cx = 0, cy = 0, cz = 0;
      for (const i of ring0) { cx += xp[3 * i]; cy += xp[3 * i + 1]; cz += xp[3 * i + 2]; }
      cx /= ring0.length; cy /= ring0.length; cz /= ring0.length;
      let L = 0, I = 0;
      for (let i = 0; i < N; i++) {
        xp[3 * i] -= cx; xp[3 * i + 1] -= cy; xp[3 * i + 2] -= cz;
        const X = xp[3 * i], Z = xp[3 * i + 2];
        L += Z * (xp[3 * i] - x[3 * i]) - X * (xp[3 * i + 2] - x[3 * i + 2]); I += X * X + Z * Z;
      }
      const w = L / I; // (rotation d'ensemble autour de la tige, retirée)
      for (let i = 0; i < N; i++) {
        const X = xp[3 * i], Z = xp[3 * i + 2];
        xp[3 * i] = X - w * Z; xp[3 * i + 2] = Z + w * X;
        for (let c = 0; c < 3; c++) { v[3 * i + c] = (xp[3 * i + c] - x[3 * i + c]) / dt; x[3 * i + c] = xp[3 * i + c]; }
      }
    }
  }
  const setFold = (amount) => { for (let h = 0; h < NH; h++) target[h] = hinges[6 * h + 4] * amount; };
  const strain = () => {
    let m = 0, a = 0;
    for (let b = 0; b < NB; b++) {
      const i = bars[3 * b], j = bars[3 * b + 1];
      const e = Math.abs(Math.hypot(x[3 * j] - x[3 * i], x[3 * j + 1] - x[3 * i + 1], x[3 * j + 2] - x[3 * i + 2]) / bars[3 * b + 2] - 1);
      m = Math.max(m, e); a += e / NB;
    }
    return [m, a];
  };
  const energy = () => { let e = 0; for (let i = 0; i < 3 * N; i++) e += v[i] * v[i]; return e / N; };
  return { x, v, step, setFold, strain, energy, dt, NH, NB };
}

// ── Le film d'une feuille ────────────────────────────────────────────────────
// La selle a deux états (n/2 coins en haut, les autres en bas, ou l'inverse),
// images l'un de l'autre par un tour de 2π/n. Le film : les plis se rouvrent,
// un coup de pouce fait passer la selle d'un état à l'autre, les plis se
// referment. Un demi-cycle suffit : l'autre est le même, tourné.
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export function bake(S, { amp = 2.0, open = 0.3, frames: NF = 300, eps = 0.02, onStep = null, ...opts } = {}) {
  // (une feuille plus fine a un pas plus court : autant de pas en plus)
  const rec = Math.max(1, Math.round(12 * S.m / 14)), pre = 220 * rec, half = NF * rec;
  const so = createSolver(S, opts), { N } = S, q = S.q, w = Math.PI / q;
  const push = (psi) => (f, x) => {
    for (let i = 0; i < N; i++) { const X = S.P[3 * i], Z = S.P[3 * i + 2]; f[3 * i + 1] += eps * (X * X + Z * Z) * Math.cos(q * (Math.atan2(Z, X) - psi)); }
  };
  for (let s = 0; s < pre; s += rec) { so.setFold(amp * smooth(s / (pre * 0.6))); so.step(rec, push(0)); onStep?.(s / (pre + half)); }
  const F = Math.floor(half / rec), frames = new Float32Array((F + 1) * 3 * N);
  frames.set(so.x, 0);
  for (let fr = 1; fr <= F; fr++) {
    const u = fr / F;
    // (les plis se rouvrent pendant les 45 premiers centièmes, la selle bascule au creux, ils se referment)
    const dip = smooth(u / 0.4) * (1 - smooth((u - 0.45) / 0.4));
    so.setFold(amp * (1 - (1 - open) * dip));
    so.step(rec, push(w * smooth((u - 0.25) / 0.35)));
    frames.set(so.x, fr * 3 * N);
    onStep?.((pre + fr * rec) / (pre + half));
  }
  // raccord exact : la fin du demi-cycle est le début, tourné de 2π/n
  const c = Math.cos(S.w), sn = Math.sin(S.w);
  let gap = 0;
  for (let i = 0; i < N; i++) {
    const j = S.perm[i], X = frames[3 * i], Y = frames[3 * i + 1], Z = frames[3 * i + 2], o = F * 3 * N + 3 * j;
    const d = [X * c - Z * sn - frames[o], Y - frames[o + 1], X * sn + Z * c - frames[o + 2]];
    gap = Math.max(gap, Math.hypot(d[0], d[1], d[2]));
    for (let fr = Math.floor(F * 0.75); fr <= F; fr++) { const g = smooth((fr / F - 0.75) / 0.25); for (let k = 0; k < 3; k++) frames[fr * 3 * N + 3 * j + k] += g * d[k]; }
  }
  return { frames, F, N, gap, strain: so.strain(), energy: so.energy(), dt: so.dt };
}

// ── Maillage de rendu ────────────────────────────────────────────────────────
// Les sommets sont dédoublés le long des pliures (un pan = les triangles reliés
// par des arêtes qui ne sont pas des pliures) : normales lisses dans un pan,
// vives sur un pli. Pour chaque image du film : positions et normales.
export function renderMesh(S, B, K = 8) {
  const { N, tris, hinges } = S, T = tris.length / 3, key = (a, b) => (a < b ? a * N + b : b * N + a);
  const soft = new Set(), onCrease = new Uint8Array(N);
  for (let h = 0; h < hinges.length; h += 6) { if (!hinges[h + 4]) soft.add(key(hinges[h], hinges[h + 1])); else onCrease[hinges[h]] = onCrease[hinges[h + 1]] = 1; }
  const byEdge = new Map(), nb = Array.from({ length: T }, () => []);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) { const k = key(tris[3 * t + e], tris[3 * t + (e + 1) % 3]); if (soft.has(k)) { const l = byEdge.get(k); if (l) { nb[l].push(t); nb[t].push(l); } else byEdge.set(k, t); } }
  const facet = new Int32Array(T).fill(-1);
  let nf = 0;
  for (let t = 0; t < T; t++) { if (facet[t] >= 0) continue; const st = [t]; facet[t] = nf; while (st.length) { const u = st.pop(); for (const w of nb[u]) if (facet[w] < 0) { facet[w] = nf; st.push(w); } } nf++; }
  const rv = new Map(), src = [], fac = [], index = new Uint32Array(3 * T), copies = Array.from({ length: N }, () => []);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const v = tris[3 * t + e], k = v * nf + facet[t];
    let r = rv.get(k);
    if (r === undefined) { r = src.length; src.push(v); fac.push(facet[t]); rv.set(k, r); copies[v].push(r); }
    index[3 * t + e] = r;
  }
  const RN = src.length, F1 = B.F + 1, pos = new Float32Array(F1 * RN * 4), nor = new Float32Array(F1 * RN * 4), nrm = new Float64Array(3 * RN);
  for (let f = 0; f < F1; f++) {
    const x = B.frames.subarray(f * 3 * N, (f + 1) * 3 * N);
    nrm.fill(0);
    for (let t = 0; t < T; t++) {
      const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
      const ux = x[3 * b] - x[3 * a], uy = x[3 * b + 1] - x[3 * a + 1], uz = x[3 * b + 2] - x[3 * a + 2], vx = x[3 * c] - x[3 * a], vy = x[3 * c + 1] - x[3 * a + 1], vz = x[3 * c + 2] - x[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let e = 0; e < 3; e++) { const r = index[3 * t + e]; nrm[3 * r] += nx; nrm[3 * r + 1] += ny; nrm[3 * r + 2] += nz; }
    }
    for (let r = 0; r < RN; r++) {
      const o = (f * RN + r) * 4, v = src[r], l = Math.hypot(nrm[3 * r], nrm[3 * r + 1], nrm[3 * r + 2]) || 1;
      pos[o] = x[3 * v]; pos[o + 1] = x[3 * v + 1]; pos[o + 2] = x[3 * v + 2];
      nor[o] = nrm[3 * r] / l; nor[o + 1] = nrm[3 * r + 1] / l; nor[o + 2] = nrm[3 * r + 2] / l;
    }
  }
  // aire portée par chaque sommet de rendu, et ses voisins d'en face : les
  // sommets des pans voisins, à deux arêtes au plus (ils lui renvoient leur couleur)
  const area = new Float32Array(RN), P = S.P;
  for (let t = 0; t < T; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const A = 0.5 * Math.abs((P[3 * b] - P[3 * a]) * (P[3 * c + 2] - P[3 * a + 2]) - (P[3 * b + 2] - P[3 * a + 2]) * (P[3 * c] - P[3 * a])) / 3;
    for (let e = 0; e < 3; e++) area[index[3 * t + e]] += A;
  }
  const adj = Array.from({ length: N }, () => []);
  for (let b = 0; b < S.bars.length; b += 3) { adj[S.bars[b]].push(S.bars[b + 1]); adj[S.bars[b + 1]].push(S.bars[b]); }
  const near = new Float32Array(K * RN * 4);
  for (let r = 0; r < RN; r++) {
    const v = src[r], seen = new Set([v]), ring = [];
    for (const a of adj[v]) { if (!seen.has(a)) { seen.add(a); ring.push(a); } }
    for (const a of [...ring]) for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); ring.push(b); }
    const cand = [];
    for (const u of ring) for (const c of copies[u]) if (fac[c] !== fac[r]) cand.push([Math.hypot(P[3 * u] - P[3 * v], P[3 * u + 2] - P[3 * v + 2]), c]);
    cand.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < K; k++) { const o = (k * RN + r) * 4; if (k < cand.length) { near[o] = cand[k][1]; near[o + 1] = area[cand[k][1]]; } else { near[o] = r; near[o + 1] = 0; } }
  }
  const rest = new Float32Array(3 * RN), crease = new Float32Array(RN);
  for (let r = 0; r < RN; r++) { rest.set(P.subarray(3 * src[r], 3 * src[r] + 3), 3 * r); crease[r] = onCrease[src[r]] ? 0 : 1; }
  return { RN, F1, K, index, pos, nor, near, rest, crease };
}
