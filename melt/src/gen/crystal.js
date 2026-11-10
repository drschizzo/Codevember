// Le cristal : de la croissance simulée à un maillage animé, et sa fonte.
//
// Unités : le millimètre. Le cristal est posé à plat sur le support (z = 0),
// sa face inférieure plane contre lui, sa face supérieure en relief.
//
// Chaque cellule du réseau est un sommet ; deux triangles par cellule. Le
// shader calcule l'épaisseur à l'instant t d'une valeur signée
//     v = (h + ½h₀)·g·(1 − m) − ½h₀
//     g = S((t − T)/τ)        (la cellule pousse à son instant d'attachement T)
//     m = S((s − M)/τm)       (elle fond à son instant de fonte M, s = avancée de la fonte)
// où S est un pas lissé. Le bord visible est la ligne de niveau v = 0,
// interpolée dans les triangles : il avance (ou recule) continûment, entre
// les cellules, sans marches. Les sommets de la marge (voisins non attachés)
// valent toujours −½h₀. L'épaisseur affichée est max(v, 0) ; la normale vient
// du gradient de v, que le shader recompose à partir des gradients de h, T et
// M rangés dans les attributs.
//
// La fonte : l'instant M de chaque cellule suit l'ordre où elle fond — les
// parties les plus éloignées du centre le long du cristal (distance
// géodésique), les plus fines et celles qui regardent le soleil d'abord ; M
// croît toujours vers le centre (le long de l'arbre des plus courts chemins),
// si bien que l'eau peut toujours se replier vers une glace encore là.
//
// L'eau : chaque cellule qui fond donne son eau (0,917 × le volume de glace)
// à la perle qui se tient sur le front de son bras ; une perle avance avec ce
// front (vers le centre, d'une cellule à sa mère) ; deux perles dont les
// calottes se touchent fusionnent. Les états sont enregistrés à F instants de
// la fonte, dans K emplacements stables (une perle garde son emplacement),
// pour que le shader puisse interpoler sans saut.
import { grow, lattice, cellXY, SQ3 } from './growth.js';

const ICE_TO_WATER = 0.917;
export const MAX_BLOBS = 96;
export const MELT_FRAMES = 160;

const sstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// volume d'une calotte sphérique de rayon de base a et d'angle de contact θ
export const capVolume = (a, th) => {
  const s = Math.sin(th), c = Math.cos(th);
  return (Math.PI * a ** 3 / 3) * (2 - 3 * c + c ** 3) / s ** 3;
};
// rayon de base d'une calotte de volume V
export const capBase = (V, th) => (V <= 0 ? 0 : Math.cbrt(V / capVolume(1, th)));

// La colonne : un prisme hexagonal couché sur une face (largeur aux coins W,
// longueur L = aspect × W), aux deux bouts creusés en entonnoir (colonne
// creuse), décrit sur le même réseau que les plaques : son épaisseur est le
// profil du prisme vu de dessus (face plate, puis pans inclinés jusqu'aux
// arêtes, à mi-hauteur), et il pousse en longueur, par ses deux bouts.
function growColumn({ R, fill = 0.9, column }) {
  const L = lattice(R);
  const Lc = Math.floor(R * fill * 0.9);
  const hw = Math.max(3, Lc / column.aspect); // (demi-largeur, en pas du réseau)
  const hollowLen = Math.max(2, hw * 2.2 * column.hollow);
  const M = L.N * L.N;
  const a = new Uint8Array(M), c = new Float32Array(M), T = new Int32Array(M).fill(-1), Hf = new Float32Array(M);
  const STEPS = 1000;
  for (let k = 0; k < L.order.length; k++) {
    const i = L.order[k];
    const [x, y] = cellXY(L, i);
    if (Math.abs(x) > Lc || Math.abs(y) > hw) continue;
    a[i] = 1;
    const ay = Math.abs(y);
    let z = ay <= hw / 2 ? 1 : 1 - 0.5 * (ay - hw / 2) / (hw / 2);
    const d = Lc - Math.abs(x);
    if (d < hollowLen && ay < hw * 0.62) z *= 0.3 + 0.7 * (d / hollowLen) ** 1.5; // (bout creux)
    Hf[i] = z;
    c[i] = z;
    T[i] = Math.round(STEPS * Math.min(1, Math.max(Math.abs(x) / Lc, (ay / hw) * 0.15)));
  }
  // (rayon du réseau atteint : la distance hexagonale des coins dépasse la demi-longueur)
  let rmax = 0;
  for (let k = 0; k < L.order.length; k++) if (a[L.order[k]]) rmax = Math.max(rmax, L.ring[L.order[k]]);
  return { L, a, c, T, steps: STEPS, rmax, Hf, hw };
}

// spec : { family, form, growth, then, column, R, size, thick, seed, sun: [x, y] }
export function buildCrystal(spec) {
  const { R = 100, size = 3, seed = 1, sun = [1, 0], fill = 0.9 } = spec;
  let { thick = 0.03 } = spec;
  const isCol = !!spec.column;
  const g = isCol ? growColumn({ R, fill, column: spec.column }) : grow({ ...spec.growth, then: spec.then, R, fill, sigma: spec.sigma ?? 4e-5, seed });
  const { L, a, c, T, steps, rmax } = g;
  const { N, order, ringStart, NB } = L;
  const s = size / (2 * rmax + 1); // pas du réseau (mm)
  if (isCol) thick = 2 * g.hw * s * (Math.sqrt(3) / 2); // (hauteur du prisme couché)

  // ── cellules du cristal et de la marge ──
  const vid = new Int32Array(N * N).fill(-1);
  const verts = [];
  const isMargin = [];
  const lim = ringStart[Math.min(R, rmax + 2)];
  for (let k = 0; k < lim; k++) {
    const i = order[k];
    if (a[i]) { vid[i] = verts.length; verts.push(i); isMargin.push(0); }
  }
  for (let k = 0; k < lim; k++) {
    const i = order[k];
    if (a[i]) continue;
    let near = false;
    for (let m = 0; m < 6; m++) if (a[i + NB[m]]) { near = true; break; }
    if (near) { vid[i] = verts.length; verts.push(i); isMargin.push(1); }
  }
  const nV = verts.length, nC = isMargin.indexOf(1) < 0 ? nV : isMargin.indexOf(1);

  // ── distance au bord (en sauts), distance géodésique au centre, arbre ──
  const edge = new Float32Array(N * N).fill(-1);
  let queue = [];
  for (let k = 0; k < nC; k++) {
    const i = verts[k];
    for (let m = 0; m < 6; m++) if (!a[i + NB[m]]) { edge[i] = 1; queue.push(i); break; }
  }
  while (queue.length) {
    const next = [];
    for (const i of queue) for (let m = 0; m < 6; m++) {
      const j = i + NB[m];
      if (a[j] && edge[j] < 0) { edge[j] = edge[i] + 1; next.push(j); }
    }
    queue = next;
  }
  const o = L.idx(0, 0);
  const geo = new Float32Array(N * N).fill(-1);
  const parent = new Int32Array(N * N).fill(-1);
  const bfs = [o];
  geo[o] = 0;
  for (let h = 0; h < bfs.length; h++) {
    const i = bfs[h];
    for (let m = 0; m < 6; m++) {
      const j = i + NB[m];
      if (a[j] && geo[j] < 0) { geo[j] = geo[i] + 1; parent[j] = i; bfs.push(j); }
    }
  }
  let geoMax = 1, edgeMax = 1;
  for (const i of bfs) { geoMax = Math.max(geoMax, geo[i]); edgeMax = Math.max(edgeMax, edge[i]); }

  // ── épaisseur : la masse de glace du modèle (nervures, marques de croissance),
  // arrondie au bord ──
  const cs = [];
  for (let k = 0; k < nC; k++) cs.push(c[verts[k]]);
  cs.sort((p, q) => p - q);
  const cLo = cs[Math.floor(cs.length * 0.05)], cHi = cs[Math.floor(cs.length * 0.98)] + 1e-6;
  const H = new Float32Array(nV);
  for (let k = 0; k < nC; k++) {
    const i = verts[k];
    const cn = Math.min(1, Math.max(0, (c[i] - cLo) / (cHi - cLo)));
    const round = 0.45 + 0.55 * sstep(edge[i] / 3.5); // (bord arrondi)
    H[k] = isCol ? thick * g.Hf[i] * (0.8 + 0.2 * sstep(edge[i] / 2)) : thick * (0.5 + 0.5 * cn) * round;
  }

  // ── instant d'attachement (0..1), un peu lissé (le contour ne trahit pas le réseau) ──
  const Tn = new Float32Array(nV).fill(9);
  for (let k = 0; k < nC; k++) Tn[k] = T[verts[k]] / steps;
  {
    const sm = Tn.slice();
    for (let k = 1; k < nC; k++) {
      const i = verts[k];
      let s0 = Tn[k] * 2, w = 2;
      for (let m = 0; m < 6; m++) { const j = vid[i + NB[m]]; if (j >= 0 && j < nC) { s0 += Tn[j]; w++; } }
      sm[k] = Math.max(Tn[k] - 0.01, Math.min(Tn[k] + 0.01, s0 / w));
    }
    for (let k = 1; k < nC; k++) Tn[k] = sm[k];
  }

  // ── ordre de fonte ──
  // priorité P (grande = fond tôt) : éloignement le long du cristal, finesse,
  // côté du soleil, un peu de bruit ; puis monotone le long de l'arbre
  let h32 = (seed * 2654435761) >>> 0;
  const rnd = () => { h32 ^= h32 << 13; h32 >>>= 0; h32 ^= h32 >>> 17; h32 ^= h32 << 5; h32 >>>= 0; return h32 / 4294967296; };
  const P = new Float32Array(N * N);
  const plate = spec.family === 'plate';
  const sl = Math.hypot(sun[0], sun[1]) || 1;
  for (const i of bfs) {
    const [x, y] = cellXY(L, i);
    const rr = Math.hypot(x, y) / (rmax || 1);
    const thin = 1 - Math.min(1, edge[i] / 5);
    const toward = (x * sun[0] + y * sun[1]) / sl / (rmax || 1); // −1..1
    if (isCol) {
      // Plateau-Rayleigh : le cylindre d'eau qui gaine la colonne se rompt en
      // perles espacées de λ ≈ 9 rayons ; la glace entre deux perles part
      // d'abord, les bouts avant le milieu
      const lam = Math.max(6, 9 * g.hw * 0.62);
      const dB = Math.abs(x - Math.round(x / lam) * lam) / (lam / 2);
      P[i] = 0.45 * dB + 0.35 * Math.abs(x) / rmax + 0.15 * (1 - edge[i] / edgeMax) + 0.03 * toward + 0.005 * rnd();
    } else {
      P[i] = plate
        ? 0.8 * (1 - edge[i] / edgeMax) + 0.2 * rr + 0.06 * toward + 0.01 * rnd()
        : 0.75 * geo[i] / geoMax + 0.18 * thin * rr + 0.08 * toward * rr + 0.01 * rnd();
    }
  }
  const eps = 1e-4;
  if (isCol) {
    // l'eau va vers la perle la plus proche (centres espacés de λ sur l'axe,
    // dont le centre du cristal) : chaque cellule vise le centre de sa perle,
    // et fond avant la cellule suivante sur ce chemin
    const lam = Math.max(6, 9 * g.hw * 0.62);
    const tgt = (i) => { const [x] = cellXY(L, i); return [Math.round(x / lam) * lam, 0]; };
    const d2 = (i, t) => { const [x, y] = cellXY(L, i); return (x - t[0]) ** 2 + (y - t[1]) ** 2; };
    for (const i of bfs) {
      const t = tgt(i);
      let best = -1, bd = d2(i, t) - 1e-6;
      for (let m = 0; m < 6; m++) { const j = i + NB[m]; if (a[j] && d2(j, t) < bd) { bd = d2(j, t); best = j; } }
      parent[i] = best;
    }
    const byDist = bfs.slice().sort((p, q) => d2(p, tgt(p)) - d2(q, tgt(q)));
    for (const i of byDist) if (parent[i] >= 0 && P[i] <= P[parent[i]]) P[i] = P[parent[i]] + eps;
  } else {
    // monotone : une cellule fond avant sa mère, sur son chemin vers le centre
    // (la fille fond AVANT la mère : P(fille) > P(mère))
    for (let h = 1; h < bfs.length; h++) { const i = bfs[h]; if (P[i] <= P[parent[i]]) P[i] = P[parent[i]] + eps; }
  }
  { let mn = Infinity; for (const i of bfs) mn = Math.min(mn, P[i]); P[o] = Math.min(P[o], mn - eps); } // (le centre en dernier)
  // rangs → instants 0..1 (régulier : la fonte avance à vitesse constante)
  const melted = bfs.slice().sort((p, q) => P[q] - P[p]); // ordre de fonte
  const Mc = new Float32Array(N * N);
  melted.forEach((i, r) => { Mc[i] = r / (melted.length - 1); });
  const Mn = new Float32Array(nV).fill(-9);
  for (let k = 0; k < nC; k++) Mn[k] = Mc[verts[k]];

  // ── maillage : positions, triangles ──
  const pos = new Float32Array(nV * 3);
  for (let k = 0; k < nV; k++) { const [x, y] = cellXY(L, verts[k]); pos[k * 3] = x * s; pos[k * 3 + 1] = y * s; pos[k * 3 + 2] = 0; }
  const tris = [];
  for (let k = 0; k < nV; k++) {
    const i = verts[k];
    const i1 = vid[i + 1], i2 = vid[i + N], i3 = vid[i + N + 1];
    // (q,r),(q+1,r),(q,r+1) et (q+1,r),(q+1,r+1),(q,r+1) ; au moins une cellule du cristal
    if (i1 >= 0 && i2 >= 0 && (k < nC || i1 < nC || i2 < nC)) tris.push(k, i1, i2);
    if (i1 >= 0 && i3 >= 0 && i2 >= 0 && (i1 < nC || i3 < nC || i2 < nC)) tris.push(i1, i3, i2);
  }
  const index = nV < 65536 ? new Uint16Array(tris) : new Uint32Array(tris);

  // ── gradients (moindres carrés sur les voisins présents) ──
  const E = Array.from({ length: 6 }, (_, m) => {
    const j = NB[m]; // (déplacement axial → cartésien)
    const dq = ((j % N) + N + Math.floor(N / 2)) % N - Math.floor(N / 2), dr = Math.round((j - dq) / N);
    return [(dq + dr / 2) * s, (dr * SQ3 / 2) * s];
  });
  const grad = (f, k, valid) => {
    const i = verts[k];
    let sxx = 0, sxy = 0, syy = 0, bx = 0, by = 0;
    for (let m = 0; m < 6; m++) {
      const j = vid[i + NB[m]];
      if (j < 0 || !valid(j)) continue;
      const [ex, ey] = E[m], df = f[j] - f[k];
      sxx += ex * ex; sxy += ex * ey; syy += ey * ey; bx += df * ex; by += df * ey;
    }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) < 1e-12 * s ** 4) return [0, 0];
    return [(syy * bx - sxy * by) / det, (sxx * by - sxy * bx) / det];
  };
  const isC = (j) => j < nC;
  const h0 = thick;
  // attributs : A = (h, T, M, marge) ; B = (∂h, ∂T) ; C = (∂M, distance au bord, distance au centre)
  const A = new Float32Array(nV * 4), B = new Float32Array(nV * 4), C = new Float32Array(nV * 4);
  const Hs = H.slice(); for (let k = nC; k < nV; k++) Hs[k] = -0.5 * h0; // (h signé : la marge est sous zéro)
  for (let k = 0; k < nV; k++) {
    const i = verts[k];
    A[k * 4] = k < nC ? H[k] : 0; A[k * 4 + 1] = Tn[k]; A[k * 4 + 2] = Mn[k]; A[k * 4 + 3] = isMargin[k];
    if (k < nC) {
      const gh = grad(H, k, isC), gT = grad(Tn, k, isC), gM = grad(Mn, k, isC);
      B.set([gh[0], gh[1], gT[0], gT[1]], k * 4);
      C.set([gM[0], gM[1], edge[i] * s, geo[i] * s], k * 4);
    }
  }

  // ── l'eau de la fonte ──
  const water = meltWater({ L, a, verts, nC, vid, parent, Mc, melted, root: o, isCol, H, s, thetaIce: spec.thetaIce ?? 0.5, frames: spec.frames ?? MELT_FRAMES });

  // rayons du sujet (caméra) : pendant la croissance (selon T) et la fonte (selon s)
  const growR = new Float32Array(65), meltR = new Float32Array(65), growInv = new Float32Array(257);
  {
    const rr = new Float32Array(nC);
    for (let k = 0; k < nC; k++) rr[k] = Math.hypot(pos[k * 3], pos[k * 3 + 1]);
    for (let k = 0; k < nC; k++) {
      const gi = Math.min(64, Math.max(0, Math.ceil(Tn[k] * 64)));
      growR[gi] = Math.max(growR[gi], rr[k] + s);
      const mi = Math.min(64, Math.max(0, Math.floor(Mn[k] * 64)));
      meltR[mi] = Math.max(meltR[mi], rr[k] + s);
    }
    for (let i = 1; i <= 64; i++) growR[i] = Math.max(growR[i], growR[i - 1]); // (croissant)
    // réciproque : l'instant T où le cristal atteint la part ρ = i/256 de son
    // rayon (le film fait avancer le rayon régulièrement, quelle que soit la
    // vitesse propre de la simulation, dont les pointes accélèrent en sortant
    // de la vapeur appauvrie) ; exacte, cellule par cellule
    const ord = Array.from({ length: nC }, (_, k) => k).sort((p, q) => Tn[p] - Tn[q]);
    const run = new Float32Array(nC);
    let mx = 0;
    ord.forEach((k, n) => { mx = Math.max(mx, rr[k] + s); run[n] = mx; });
    for (let i = 0; i <= 256; i++) {
      const target = (i / 256) * mx;
      let lo = 0, hi = nC - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (run[mid] >= target) hi = mid; else lo = mid + 1; }
      growInv[i] = Tn[ord[lo]];
    }
    for (let i = 63; i >= 0; i--) meltR[i] = Math.max(meltR[i], meltR[i + 1]); // (décroissant)
    // les perles débordent un peu de la glace qui reste
    const D = water.data;
    for (let i = 0; i <= 64; i++) {
      const f = Math.min(water.frames - 1, Math.round((i / 64) * (water.frames - 1)));
      for (let k = 0; k < MAX_BLOBS; k++) {
        const o = (f * MAX_BLOBS + k) * 4;
        if (D[o + 2] > 0) meltR[i] = Math.max(meltR[i], Math.hypot(D[o], D[o + 1]) + capBase(D[o + 2], spec.thetaIce ?? 0.5));
      }
    }
  }

  // volume de glace (mm³) et du nucléus
  let Vice = 0;
  const cellArea = (SQ3 / 2) * s * s;
  for (let k = 0; k < nC; k++) Vice += H[k] * cellArea;

  // carte d'emprise (repère du cristal) : pour l'ombre de contact sur le
  // support. Par texel : instant d'attachement, instant de fonte, épaisseur,
  // présence (RGBA8, filtrée linéairement)
  const CG = 256, ext = (rmax + 3) * s;
  const cov = new Uint8Array(CG * CG * 4);
  const SQ = Math.sqrt(3) / 2;
  for (let j = 0; j < CG; j++) for (let i = 0; i < CG; i++) {
    const x = ((i + 0.5) / CG * 2 - 1) * ext / s, y = ((j + 0.5) / CG * 2 - 1) * ext / s;
    const r = Math.round(y / SQ), q = Math.round(x - r / 2);
    const o4 = (j * CG + i) * 4;
    cov[o4] = 255; cov[o4 + 1] = 0; cov[o4 + 2] = 0; cov[o4 + 3] = 0;
    if (Math.abs(q) > L.R || Math.abs(r) > L.R) continue;
    const ci = L.idx(q, r), k = vid[ci];
    if (k < 0 || k >= nC) continue;
    cov[o4] = Math.round(Math.min(1, Tn[k]) * 255); cov[o4 + 1] = Math.round(Mn[k] * 255);
    cov[o4 + 2] = Math.round(Math.min(1, H[k] / (thick || 1e-3)) * 255); cov[o4 + 3] = 255;
  }

  return {
    cover: { data: cov, size: CG, ext },
    position: pos, index, A, B, C,
    nCells: nC, cell: s, steps, rmax, radius: (rmax + 0.5) * s, thick: h0,
    // durée de vie d'une cellule au front (en unités de T) : sert à la rampe g
    tau: 2.2 / Math.max(1, rmax),
    // (la colonne s'amincit lentement pendant que le chapelet se forme)
    tauMelt: isCol ? 0.3 : 2.5 / Math.max(1, melted.length ** 0.5),
    Vice, Vwater: Vice * ICE_TO_WATER,
    water, growR, meltR, growInv,
  };
}

// La fonte en perles. Voir l'en-tête.
function meltWater({ L, verts, nC, vid, parent, Mc, melted, root, isCol, H, s, thetaIce, frames }) {
  const { NB } = L;
  const cellArea = (SQ3 / 2) * s * s;
  const xy = new Map();
  for (let k = 0; k < nC; k++) { const [x, y] = cellXY(L, verts[k]); xy.set(verts[k], [x * s, y * s]); }
  const vol = (i) => H[vid[i]] * cellArea * ICE_TO_WATER;

  // perles : { id, vol, mem: Map(cellule → poids) } ; at : cellule → perle
  const blobs = new Map();
  const at = new Map();
  const tops = []; // perle disparue → perle d'accueil
  let nextId = 1;
  // position d'une perle : moyenne de ses fronts, pondérée par l'eau qu'ils
  // portent (les filets qui traînent, sous le quart du plus gros, n'y comptent pas)
  const position = (b) => {
    let wmax = 0;
    for (const wi of b.mem.values()) wmax = Math.max(wmax, wi);
    // (la goutte du centre reste au centre : c'est là qu'elle regèlera)
    if (b.mem.has(root)) return xy.get(root);
    let x = 0, y = 0, w = 0;
    for (const [i, wi] of b.mem) { if (wi < 0.25 * wmax) continue; const p = xy.get(i); x += p[0] * wi; y += p[1] * wi; w += wi; }
    return w > 0 ? [x / w, y / w] : xy.get(b.mem.keys().next().value);
  };
  const radius = (b) => capBase(b.vol, thetaIce);
  const merge = (keep, gone) => {
    keep.vol += gone.vol;
    for (const [i, w] of gone.mem) { keep.mem.set(i, (keep.mem.get(i) || 0) + w); at.set(i, keep); }
    blobs.delete(gone.id);
    tops[gone.id] = keep.id;
  };

  const out = new Float32Array(frames * MAX_BLOBS * 4); // (x, y, volume, 0) par emplacement
  const slotOf = new Map(); // id → emplacement
  const free = [];
  for (let k = MAX_BLOBS - 1; k >= 1; k--) free.push(k); // (0 : la perle du centre)
  const freeAt = []; // [image à partir de laquelle l'emplacement est libre, k]
  let ev = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    // 1. les cellules qui fondent avant t : leur eau et leur perle passent à la mère
    while (ev < melted.length && Mc[melted[ev]] <= t) {
      const i = melted[ev++];
      let b = at.get(i);
      if (!b) { b = { id: nextId++, vol: 0, mem: new Map() }; blobs.set(b.id, b); b.mem.set(i, 0); at.set(i, b); }
      b.vol += vol(i);
      const w = (b.mem.get(i) || 0) + vol(i);
      b.mem.delete(i); at.delete(i);
      const p = parent[i] >= 0 ? parent[i] : i;
      if (p === i) { b.mem.set(i, w + 1e-9); at.set(i, b); continue; } // (le centre)
      const other = at.get(p);
      if (other && other !== b) {
        // deux perles se rencontrent : elles fusionnent si c'est le gros de la
        // perle qui arrive ; sinon seul ce filet d'eau change de perle (une perle
        // ne fusionne pas avec sa voisine par un filet qui traîne)
        let wmax = 0;
        for (const x of b.mem.values()) wmax = Math.max(wmax, x);
        if (w >= 0.5 * wmax || b.mem.size === 0) { b.mem.set(p, w); merge(other.vol >= b.vol ? other : b, other.vol >= b.vol ? b : other); }
        else { b.vol -= w; other.vol += w; other.mem.set(p, (other.mem.get(p) || 0) + w); }
      } else { b.mem.set(p, (b.mem.get(p) || 0) + w); at.set(p, b); }
      if (b.mem.size === 0 && blobs.has(b.id) && b.vol <= 1e-12) blobs.delete(b.id);
    }
    // 2. coalescence : les calottes qui se touchent (grille de hachage)
    const list = [...blobs.values()];
    const P = new Map(list.map((b) => [b.id, position(b)]));
    const cellSize = Math.max(s * 2, ...list.map(radius)) * 2;
    const grid = new Map();
    const key = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
    for (const b of list) { const p = P.get(b.id); const k = key(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); }
    for (const b of list) {
      if (!blobs.has(b.id)) continue;
      const p = P.get(b.id), gx = Math.floor(p[0] / cellSize), gy = Math.floor(p[1] / cellSize);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(`${gx + dx},${gy + dy}`) || []) {
          if (o === b || !blobs.has(o.id) || !blobs.has(b.id)) continue;
          const q = P.get(o.id);
          // (colonne : les perles du chapelet restent chacune à sa place ; seules
          // se confondent celles qui se superposent)
          if (Math.hypot(p[0] - q[0], p[1] - q[1]) < (radius(b) + radius(o)) * (isCol ? 0.4 : 0.92)) {
            const [keep, gone] = o.vol > b.vol ? [o, b] : [b, o];
            merge(keep, gone);
            P.set(keep.id, position(keep));
          }
        }
      }
    }
    // 3. emplacements : la perle qui tient le centre a l'emplacement 0 ; les
    // autres, les plus grosses, dans des emplacements stables
    const alive = [...blobs.values()];
    // (la perle du centre : celle qui tient le centre ; l'eau n'y arrive qu'à la fin)
    const centre = at.get(root);
    alive.sort((p, q) => q.vol - p.vol);
    const shown = new Set(alive.filter((b) => b !== centre).slice(0, MAX_BLOBS - 1).map((b) => b.id));
    if (centre) {
      shown.add(centre.id);
      // l'emplacement 0 suit la perle du centre (une fusion peut changer son identité)
      for (const [id, k] of slotOf) if (k === 0 && id !== centre.id) slotOf.delete(id);
      if (slotOf.get(centre.id) !== 0) {
        const old = slotOf.get(centre.id);
        if (old !== undefined) { const p = position(centre); out.set([p[0], p[1], 0, 0], (f * MAX_BLOBS + old) * 4); freeAt.push([f + 2, old]); }
        slotOf.set(centre.id, 0);
      }
    }
    // libérer les emplacements des perles disparues ou trop petites
    for (const [id, k] of [...slotOf]) {
      if (shown.has(id)) continue;
      slotOf.delete(id);
      // (elle rejoint sa perle d'accueil en s'annulant : interpolation sans saut)
      let dest = null, g = id;
      while (!blobs.has(g)) { const gone = tops[g]; if (!gone) break; g = gone; }
      dest = blobs.get(g);
      const p = dest ? position(dest) : [out[((f - 1) * MAX_BLOBS + k) * 4], out[((f - 1) * MAX_BLOBS + k) * 4 + 1]];
      out.set([p[0], p[1], 0, 0], (f * MAX_BLOBS + k) * 4);
      freeAt.push([f + 2, k]);
    }
    for (let n = freeAt.length - 1; n >= 0; n--) if (freeAt[n][0] <= f) { free.push(freeAt[n][1]); freeAt.splice(n, 1); }
    for (const b of alive) {
      if (!shown.has(b.id)) continue;
      let k = slotOf.get(b.id);
      const p = position(b);
      if (k === undefined) {
        if (free.length) k = free.pop();
        else continue;
        slotOf.set(b.id, k);
        if (f > 0) out.set([p[0], p[1], 0, 0], ((f - 1) * MAX_BLOBS + k) * 4); // (naît de rien, à sa place)
      }
      out.set([p[0], p[1], b.vol, 0], (f * MAX_BLOBS + k) * 4);
    }
  }
  // dernière image : tout est réuni au centre
  return { frames, slots: MAX_BLOBS, data: out };
}
