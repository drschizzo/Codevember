// Les laminaires (module pur) : des chaînes de nœuds (stipe, lanières) ancrées
// au crampon, intégrées par XPBD à petits pas (Macklin et al., 2019 : beaucoup
// de sous-pas, une itération), dans l'eau enregistrée par gen/sea.js.
//
// Forces (par nœud) :
//  - poids, et poussée d'Archimède de la partie immergée (rapport de densité
//    ρ_algue / ρ_eau propre à la famille : < 1 pour les flotteurs et le tissu
//    alvéolé) ; la masse ajoutée ralentit la montée d'une lame à plat ;
//  - traînée quadratique de Morison sur la vitesse relative à l'eau, intégrée
//    implicitement (v_r ← v_r / (1 + k|v_r|h) : stable quel que soit le pas) ;
//  - l'accélération de l'eau elle-même, qui emporte une lame presque neutre.
// Contraintes : longueur (inextensible), flexion (seconde différence pondérée,
// raideur EI/l³ propre à chaque partie), contact et frottement sur la roche,
// contact entre lanières (rubans épais : séparation choisie sur l'axe de
// moindre recouvrement parmi les normales des faces et l'axe des points les
// plus proches — couchée sur une autre, une lanière se pose dessus ; côte à
// côte, elles s'écartent par la tranche).
// Orientation du ruban : un directeur b (le long de la largeur) transporté
// avec la lanière, couché à plat sur ce qui la porte, tourné dans le plan du
// courant (moindre traînée) quand l'eau la tire, lissé le long de la lanière.
//
// Axe x vers la côte, y vers le haut, z le long de la côte. Unités SI.
import { createRng } from '../rng.js';

export const RHO_W = 1025;
const G = 9.81;

// ── Les familles ─────────────────────────────────────────────────────────────
// stipe : longueur L, rayon r, raideur EI, densité relative rho ;
// lanières : nombre n, longueur L, largeur w, épaisseur e, EI, rho, pas ds
export const FAMILIES = {
  digitata: {
    label: 'Digitée', latin: 'Laminaria digitata',
    stipe: { L: [0.18, 0.3], r: 0.007, EI: 0.002, rho: 1.04, ds: 0.06 },
    blade: { n: [5, 7], L: [0.6, 1.0], w: [0.05, 0.08], e: 0.0022, EI: 3e-4, rho: 0.93, ds: 0.07, fan: 0.5 },
    holdfast: 0.07, spacing: 0.3, drag: 1, palm: 3,
  },
  durvillaea: {
    label: 'Cochayuyo', latin: 'Durvillaea antarctica',
    stipe: { L: [0.1, 0.18], r: 0.018, EI: 0.6, rho: 1.02, ds: 0.06 },
    blade: { n: [3, 5], L: [1.4, 2.1], w: [0.035, 0.055], e: 0.008, EI: 0.004, rho: 0.78, ds: 0.07, fan: 0.35 },
    holdfast: 0.13, spacing: 0.55, drag: 0.7, palm: 6,
  },
  postelsia: {
    label: 'Palmier de mer', latin: 'Postelsia palmaeformis',
    stipe: { L: [0.3, 0.45], r: 0.011, EI: 0.9, rho: 1.0, ds: 0.05, stand: true },
    blade: { n: [14, 20], L: [0.14, 0.22], w: [0.008, 0.012], e: 0.0015, EI: 1.5e-4, rho: 1.0, ds: 0.045, fan: 1.2, tassel: true },
    holdfast: 0.05, spacing: 0.22, drag: 1,
  },
  egregia: {
    label: 'Boa', latin: 'Egregia menziesii',
    stipe: { L: [0.06, 0.1], r: 0.009, EI: 0.05, rho: 1.03, ds: 0.05 },
    blade: { n: [3, 5], L: [1.1, 1.7], w: [0.03, 0.04], e: 0.003, fringe: true, EI: 1.2e-3, rho: 0.86, ds: 0.08, fan: 0.6 },
    holdfast: 0.08, spacing: 0.4, drag: 1.4, // (les franges de lamelles freinent)
  },
};

// ── Disposition : crampons sur la roche (disque de Poisson) ──────────────────
// area : { x0, x1, z0, z1 } ; near : point (x, z) autour duquel les plantes
// sont détaillées (la caméra) ; renvoie une liste de plantes tirées
export function layoutPlants(family, seed, area, rockH, opts = {}) {
  const F = FAMILIES[family], r = createRng(`layout:${seed}`);
  const sp = F.spacing * (opts.density ?? 1);
  const pts = [];
  const tries = Math.round(((area.x1 - area.x0) * (area.z1 - area.z0)) / (sp * sp) * 6);
  for (let k = 0; k < tries && pts.length < (opts.max ?? 80); k++) {
    // densité plus forte près du bord du platier (frange infralittorale)
    const x = r.range(area.x0, area.x1), z = r.range(area.z0, area.z1);
    const edge = 1 - Math.max(0, Math.min(1, (x - area.x0) / (area.x1 - area.x0)));
    if (r.next() > 0.45 + 0.55 * edge) continue;
    if (opts.avoid && opts.avoid(x, z)) continue;
    if (opts.inside && !opts.inside(x, z)) continue;
    const d = sp * (0.85 + 0.3 * r.next());
    if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < d * d)) continue;
    pts.push({ x, z });
  }
  const near = opts.near ?? { x: 0, z: 0 };
  return pts.map((p, i) => {
    const q = createRng(`plant:${seed}:${i}`);
    const dist = Math.hypot(p.x - near.x, p.z - near.z);
    const lod = dist < (opts.nearR ?? 3) ? 0 : 1; // (0 : détaillée, 1 : grossière)
    const nb = q.int(...F.blade.n);
    return {
      x: p.x, z: p.z, y: rockH(p.x, p.z), lod,
      stipeL: q.range(...F.stipe.L),
      blades: Array.from({ length: lod ? Math.max(2, Math.ceil(nb * 0.6)) : nb }, () => ({ L: q.range(...F.blade.L), w: q.range(...F.blade.w) })),
      lean: q.range(-0.4, 0.4), // (azimut de la chute initiale, autour du large)
      tilt: q.range(-0.25, 0.25),
    };
  });
}

// ── Topologie : nœuds, chaînes, contraintes ───────────────────────────────────
export function buildKelp(family, plants, rockH) {
  const F = FAMILIES[family];
  const nodes = []; // { x, y, z, w (masse inverse), r (demi-épaisseur), wid, rho, am, kind, chain, plant }
  const chains = []; // { plant, kind, nodes: [], parent }
  const dist = [], bend = []; // [a, b, l] ; [a, b, c, l1, l2, k]
  const node = (o) => { nodes.push(o); return nodes.length - 1; };
  const normal = (x, z) => {
    const e = 0.03, hx = (rockH(x + e, z) - rockH(x - e, z)) / (2 * e), hz = (rockH(x, z + e) - rockH(x, z - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hz); return [-hx / l, 1 / l, -hz / l];
  };
  plants.forEach((P, pi) => {
    const n = normal(P.x, P.z), hf = F.holdfast * 0.6;
    // ancre au sommet du crampon, et un point fixe dessous (direction du pied)
    const ax = P.x + n[0] * hf, ay = P.y + n[1] * hf, az = P.z + n[2] * hf;
    const below = node({ x: ax - n[0] * 0.05, y: ay - n[1] * 0.05, z: az - n[2] * 0.05, w: 0, r: 0.01, wid: 0.02, rho: 1, am: 0, kind: 0, chain: -1, plant: pi });
    const anchor = node({ x: ax, y: ay, z: az, w: 0, r: F.stipe.r, wid: 2 * F.stipe.r, rho: 1, am: 0, kind: 0, chain: -1, plant: pi });
    // pose initiale : le stipe se couche vers le large (direction tirée), les
    // lanières suivent, à plat sur la roche (la mise en place la laisse retomber)
    const az0 = Math.PI + P.lean; // (vers −x)
    const dir = [Math.cos(az0), 0, Math.sin(az0)];
    const stand = F.stipe.stand;
    // stipe
    const S = F.stipe, ns = Math.max(2, Math.round(P.stipeL / S.ds)), ls = P.stipeL / ns;
    const sc = { plant: pi, kind: 0, nodes: [], parent: anchor };
    chains.push(sc);
    let prev2 = below, prev = anchor, px = ax, py = ay, pz = az;
    const lin = RHO_W * S.rho * Math.PI * S.r * S.r; // (kg/m)
    for (let i = 1; i <= ns; i++) {
      const up = stand ? 1 : Math.max(0, 1 - i / 2);
      px += ls * (dir[0] * (1 - up) + n[0] * up); pz += ls * (dir[2] * (1 - up) + n[2] * up);
      py = stand ? py + ls * n[1] : Math.max(rockH(px, pz) + S.r + 0.004, py + ls * up * n[1] - ls * (1 - up) * 0.2);
      const k = node({ x: px, y: py, z: pz, w: 1 / (lin * ls), r: S.r, wid: 2 * S.r, rho: S.rho, am: 1, kind: 0, chain: chains.length - 1, plant: pi });
      sc.nodes.push(k);
      dist.push([prev, k, ls]); // (longueurs nominales : la mise en place corrige la pose initiale)
      const l1 = prev !== anchor ? ls : 0.05;
      bend.push([prev2, prev, k, l1, ls, (S.EI / (0.5 * (l1 + ls))) * (i === 1 ? (S.stand ? 3 : 1) : 1)]); // (raideur d'une charnière : EI / l, pour C ≈ l'angle)
      prev2 = prev; prev = k;
    }
    const top = prev, topPrev = prev2;
    // lanières (ou houppe)
    const Bl = F.blade, nb = P.blades.length;
    P.blades.forEach((b, bi) => {
      const ds = Bl.ds * (P.lod ? 1.6 : 1), nn = Math.max(3, Math.round(b.L / ds)), l = b.L / nn;
      const ch = { plant: pi, kind: 1, nodes: [], parent: top, w: b.w, e: Bl.e, L: b.L };
      chains.push(ch);
      const fan = (nb > 1 ? bi / (nb - 1) - 0.5 : 0) * Bl.fan * 2;
      let d2;
      if (Bl.tassel) { const a = (bi / nb) * Math.PI * 2; d2 = [Math.cos(a), -0.6, Math.sin(a)]; }
      else d2 = [Math.cos(az0 + fan * 0.6), 0, Math.sin(az0 + fan * 0.6)];
      let qx = nodes[top].x, qy = nodes[top].y, qz = nodes[top].z, p2 = topPrev, p1 = top;
      const lin2 = RHO_W * Bl.rho * b.w * Bl.e;
      for (let i = 1; i <= nn; i++) {
        qx += l * d2[0]; qz += l * d2[2];
        const floor = rockH(qx, qz) + Bl.e + 0.003;
        qy = Math.max(floor, qy + l * d2[1]);
        const taper = Bl.tassel ? 1 : 1 - 0.35 * (i / nn) ** 2; // (la lanière s'effile)
        const k = node({ x: qx, y: qy, z: qz, w: 1 / (lin2 * l), r: Bl.e / 2, wid: b.w * taper, rho: Bl.rho, am: 1, kind: 1, chain: chains.length - 1, plant: pi });
        ch.nodes.push(k);
        dist.push([p1, k, l]);
        const j = i === 1;
        bend.push([p2, p1, k, j ? ls : l, l, (j ? Bl.EI * 4 : Bl.EI) / l]);
        p2 = p1; p1 = k;
      }
    });
  });
  return { family, nodes, chains, dist, bend };
}

// ── Simulation ───────────────────────────────────────────────────────────────
// opts : { sea (gen/sea.js), rockH, T, fps (images enregistrées / s), sub
//   (sous-pas / s), loops, obliq (retard de la houle le long de la côte, s/m),
//   zRef, settle (s), mu (frottement sur la roche), side (part du courant le
//   long de la côte) }
// retour : { n, nf, fps, pos (Float32 nf × n × 3), dir (idem), stats }
export function simulateKelp(K, opts, onProgress = null) {
  const { sea: S, rockH, T, fps = 30, sub = 480, loops = 2, obliq = 0.06, zRef = 0, settle = 2.5, mu = 0.45, side = 0.12, iters = 2 } = opts;
  const F = FAMILIES[K.family];
  const N = K.nodes.length;
  const X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N);
  const PX = new Float64Array(N), PY = new Float64Array(N), PZ = new Float64Array(N);
  const VX = new Float64Array(N), VY = new Float64Array(N), VZ = new Float64Array(N);
  const W = new Float64Array(N), Rr = new Float64Array(N), Wd = new Float64Array(N), Rho = new Float64Array(N), Am = new Float64Array(N);
  const KIND = new Uint8Array(N);
  const BX = new Float64Array(N), BY = new Float64Array(N), BZ = new Float64Array(N); // directeur (largeur)
  const TX = new Float64Array(N), TY = new Float64Array(N), TZ = new Float64Array(N); // tangente
  const GH = new Float64Array(N), GX = new Float64Array(N), GY = new Float64Array(N), GZ = new Float64Array(N); // roche sous le nœud : hauteur, normale
  const Kd = new Float64Array(N); // coefficient de traînée k (1/m)
  const CN = new Float64Array(N * 3); // normale du dernier contact (0 si aucun)
  const prevN = new Int32Array(N).fill(-1), nextN = new Int32Array(N).fill(-1);
  K.nodes.forEach((o, i) => {
    X[i] = o.x; Y[i] = o.y; Z[i] = o.z; W[i] = o.w; Rr[i] = o.r; Wd[i] = o.wid; Rho[i] = o.rho; KIND[i] = o.kind;
    // traînée : ½ C_D ρ · aire frontale / (masse + ½ masse ajoutée), par mètre
    const area = o.kind ? o.wid : 2 * o.r, m = RHO_W * o.rho * (o.kind ? o.wid * 2 * o.r : Math.PI * o.r * o.r);
    const ma = RHO_W * (o.kind ? (Math.PI * o.wid * o.wid) / 4 : Math.PI * o.r * o.r);
    Kd[i] = (0.5 * 1.2 * RHO_W * area * F.drag) / (m + 0.5 * ma);
    Am[i] = o.kind ? ma / m : 1;
  });
  for (const c of K.chains) {
    const seq = [c.parent, ...c.nodes];
    for (let i = 1; i < seq.length; i++) { prevN[seq[i]] = seq[i - 1]; if (i < seq.length - 1) nextN[seq[i]] = seq[i + 1]; }
  }
  const tangent = (i) => {
    const a = prevN[i] >= 0 ? prevN[i] : i, b = nextN[i] >= 0 ? nextN[i] : i;
    const tx = X[b] - X[a], ty = Y[b] - Y[a], tz = Z[b] - Z[a];
    const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; TX[i] = tx / l; TY[i] = ty / l; TZ[i] = tz / l;
  };
  for (let i = 0; i < N; i++) {
    tangent(i);
    const bx = -TZ[i], bz = TX[i], l = Math.hypot(bx, bz) || 1; BX[i] = bx / l; BY[i] = 0; BZ[i] = bz / l;
  }
  const ground = (i) => {
    const e = 0.02, x = X[i], z = Z[i], h0 = rockH(x, z);
    const hx = (rockH(x + e, z) - h0) / e, hz = (rockH(x, z + e) - h0) / e, l = Math.sqrt(hx * hx + 1 + hz * hz);
    GH[i] = h0; GX[i] = -hx / l; GY[i] = 1 / l; GZ[i] = -hz / l;
  };
  const ND = K.dist.length, D = Int32Array.from(K.dist.flatMap((d) => [d[0], d[1]])), DL = Float64Array.from(K.dist.map((d) => d[2]));
  // contraintes raides (stipes de palmier de mer, de cochayuyo) : Gauss-Seidel
  // converge lentement le long d'une poutre raide ; elles ont leurs propres
  // itérations, peu coûteuses (quelques dizaines de contraintes)
  const stiffB = [], stiffD = [];
  K.bend.forEach((b, i) => { if (b[5] > 2) { stiffB.push(i); for (const n of [b[1], b[2]]) { const di = K.dist.findIndex((d) => d[1] === n); if (di >= 0 && !stiffD.includes(di)) stiffD.push(di); } } });
  const SB_ = Int32Array.from(stiffB), SD_ = Int32Array.from(stiffD);
  const nb = K.bend.length, BA = new Int32Array(nb * 3), BG = new Float64Array(nb * 3), BAl = new Float64Array(nb);
  K.bend.forEach((b, i) => { BA[i * 3] = b[0]; BA[i * 3 + 1] = b[1]; BA[i * 3 + 2] = b[2]; BG[i * 3] = 1 / b[3]; BG[i * 3 + 2] = 1 / b[4]; BG[i * 3 + 1] = -(1 / b[3] + 1 / b[4]); BAl[i] = 1 / b[5]; });
  // ordre racine → pointe pour l'inextensibilité exacte (chaînes dans l'ordre de construction)
  const ftl = [], fl = [];
  const restOf = new Map(K.dist.map((q) => [q[1], q[2]]));
  for (const c of K.chains) { let p = c.parent; for (const n of c.nodes) { ftl.push(p, n); fl.push(restOf.get(n) ?? 0.05); p = n; } }
  const FTL = Int32Array.from(ftl), FL = Float64Array.from(fl);
  // segments (contacts entre lanières) : chaque nœud de chaîne et son prédécesseur
  const segA = [], segB = [];
  for (let i = 0; i < N; i++) if (prevN[i] >= 0 && K.nodes[i].chain >= 0) { segA.push(prevN[i]); segB.push(i); }
  const NS = segA.length, SA = Int32Array.from(segA), SB = Int32Array.from(segB);
  const segChain = Int32Array.from(segB.map((b) => K.nodes[b].chain));
  const segIdx = Int32Array.from(segB.map((b) => K.chains[K.nodes[b].chain].nodes.indexOf(b)));
  const segPlant = Int32Array.from(segB.map((b) => K.nodes[b].plant));
  const PALM = F.palm ?? 3;

  // ── l'eau au nœud (champ enregistré, bilinéaire en x et t) ──
  const fieldAt = (arr, x, t) => {
    const fx = (x - S.x0) / S.dx - 0.5, i0 = fx < 0 ? 0 : fx > S.nx - 2 ? S.nx - 2 : Math.floor(fx), wx = Math.min(1, Math.max(0, fx - i0));
    let ft = (t / S.T) * S.nf; ft -= Math.floor(ft / S.nf) * S.nf;
    const f0 = Math.floor(ft) % S.nf, f1 = f0 + 1 === S.nf ? 0 : f0 + 1, wt = ft - Math.floor(ft);
    const o0 = f0 * S.nx + i0, o1 = f1 * S.nx + i0;
    return (arr[o0] * (1 - wx) + arr[o0 + 1] * wx) * (1 - wt) + (arr[o1] * (1 - wx) + arr[o1 + 1] * wx) * wt;
  };

  const h = 1 / sub, VMAX = 5, BP = 6, SW = 0.012, SD = Number(globalThis.process?.env?.SD ?? 0.3);
  const DVX = new Float64Array(N), DVY = new Float64Array(N), DVZ = new Float64Array(N);
  // ── voisinage des segments : grille hachée (tableaux, sans allocation) ──
  const cell = 0.16, HS = 1 << 15, head = new Int32Array(HS), nxt = new Int32Array(NS);
  const MX = new Float64Array(NS), MY = new Float64Array(NS), MZ = new Float64Array(NS);
  let pairs = new Int32Array(1 << 16), np = 0;
  const hkey = (i, j, k) => (((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0) & (HS - 1);
  function broadphase() {
    head.fill(-1); np = 0;
    for (let s = 0; s < NS; s++) {
      const a = SA[s], b = SB[s];
      MX[s] = (X[a] + X[b]) / 2; MY[s] = (Y[a] + Y[b]) / 2; MZ[s] = (Z[a] + Z[b]) / 2;
      const k = hkey(Math.floor(MX[s] / cell), Math.floor(MY[s] / cell), Math.floor(MZ[s] / cell));
      nxt[s] = head[k]; head[k] = s;
    }
    for (let s = 0; s < NS; s++) {
      const ci = Math.floor(MX[s] / cell), cj = Math.floor(MY[s] / cell), ck = Math.floor(MZ[s] / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        for (let t = head[hkey(ci + di, cj + dj, ck + dk)]; t >= 0; t = nxt[t]) {
          if (t <= s) continue;
          if (segChain[s] === segChain[t] && Math.abs(segIdx[s] - segIdx[t]) < 3) continue;
          // (la paume : les doigts d'une même plante sont soudés près de la racine)
          if (segPlant[s] === segPlant[t] && segIdx[s] < PALM && segIdx[t] < PALM) continue;
          if (SA[s] === SA[t] || SA[s] === SB[t] || SB[s] === SA[t] || SB[s] === SB[t]) continue;
          const r = 0.5 * (Wd[SB[s]] + Wd[SB[t]]) + 0.1;
          const dx = MX[s] - MX[t], dy = MY[s] - MY[t], dz = MZ[s] - MZ[t];
          if (dx * dx + dy * dy + dz * dz < r * r) {
            if (np + 2 > pairs.length) { const q = new Int32Array(pairs.length * 2); q.set(pairs); pairs = q; }
            pairs[np++] = s; pairs[np++] = t;
          }
        }
      }
    }
  }

  // ── contact entre deux segments (rubans épais) ──
  // séparation : axe de moindre recouvrement parmi la droite des points les
  // plus proches et les normales des deux faces ; support d'un ruban sur un
  // axe a : (w/2)|a·b| + (e/2)|a·n_face| (un stipe : son rayon)
  let ovMax = 0, pushMax = 0, worst = null;
  function collide(s, t) {
    const a0 = SA[s], a1 = SB[s], b0 = SA[t], b1 = SB[t];
    const ux = X[a1] - X[a0], uy = Y[a1] - Y[a0], uz = Z[a1] - Z[a0];
    const vx = X[b1] - X[b0], vy = Y[b1] - Y[b0], vz = Z[b1] - Z[b0];
    const wx = X[a0] - X[b0], wy = Y[a0] - Y[b0], wz = Z[a0] - Z[b0];
    const a = ux * ux + uy * uy + uz * uz, b = ux * vx + uy * vy + uz * vz, c = vx * vx + vy * vy + vz * vz;
    const d = ux * wx + uy * wy + uz * wz, e = vx * wx + vy * wy + vz * wz;
    const den = a * c - b * b;
    let sc = den > 1e-12 ? (b * e - c * d) / den : 0.5;
    sc = sc < 0 ? 0 : sc > 1 ? 1 : sc;
    let tc = c > 1e-12 ? (b * sc + e) / c : 0.5;
    if (tc < 0) { tc = 0; sc = a > 1e-12 ? Math.min(1, Math.max(0, -d / a)) : 0; } else if (tc > 1) { tc = 1; sc = a > 1e-12 ? Math.min(1, Math.max(0, (b - d) / a)) : 0; }
    const dx = X[b0] + vx * tc - X[a0] - ux * sc, dy = Y[b0] + vy * tc - Y[a0] - uy * sc, dz = Z[b0] + vz * tc - Z[a0] - uz * sc;
    // bornes rapides : au-delà des demi-largeurs, rien
    const reach = 0.5 * (Wd[a1] + Wd[b1]) + Rr[a1] + Rr[b1] + 0.002;
    const dd = dx * dx + dy * dy + dz * dz;
    if (dd > reach * reach) return;
    const la = Math.sqrt(a) || 1, lb = Math.sqrt(c) || 1;
    const tax = ux / la, tay = uy / la, taz = uz / la, tbx = vx / lb, tby = vy / lb, tbz = vz / lb;
    let bax = BX[a0] + (BX[a1] - BX[a0]) * sc, bay = BY[a0] + (BY[a1] - BY[a0]) * sc, baz = BZ[a0] + (BZ[a1] - BZ[a0]) * sc;
    let bbx = BX[b0] + (BX[b1] - BX[b0]) * tc, bby = BY[b0] + (BY[b1] - BY[b0]) * tc, bbz = BZ[b0] + (BZ[b1] - BZ[b0]) * tc;
    let l = Math.sqrt(bax * bax + bay * bay + baz * baz) || 1; bax /= l; bay /= l; baz /= l;
    l = Math.sqrt(bbx * bbx + bby * bby + bbz * bbz) || 1; bbx /= l; bby /= l; bbz /= l;
    const nax = tay * baz - taz * bay, nay = taz * bax - tax * baz, naz = tax * bay - tay * bax;
    const nbx = tby * bbz - tbz * bby, nby = tbz * bbx - tbx * bbz, nbz = tbx * bby - tby * bbx;
    const ka = KIND[a1], kb = KIND[b1];
    const hwA = 0.25 * (Wd[a0] + (Wd[a1] - Wd[a0]) * sc + Wd[a1]) * ka, eA = Rr[a1];
    const hwB = 0.25 * (Wd[b0] + (Wd[b1] - Wd[b0]) * tc + Wd[b1]) * kb, eB = Rr[b1];
    let best = 1e9, ax = 0, ay = 0, az = 0;
    for (let q = 0; q < 3; q++) {
      let x, y, z;
      if (q === 0) { const dl = Math.sqrt(dd); if (dl < 1e-7) continue; x = dx / dl; y = dy / dl; z = dz / dl; }
      else if (q === 1) { if (!ka) continue; x = nax; y = nay; z = naz; }
      else { if (!kb) continue; x = nbx; y = nby; z = nbz; }
      const proj = dx * x + dy * y + dz * z;
      const sA = ka ? hwA * Math.abs(x * bax + y * bay + z * baz) + eA * Math.abs(x * nax + y * nay + z * naz) : eA;
      const sB = kb ? hwB * Math.abs(x * bbx + y * bby + z * bbz) + eB * Math.abs(x * nbx + y * nby + z * nbz) : eB;
      const ov = sA + sB + 0.0012 - Math.abs(proj);
      if (ov < best) { best = ov; let sg = proj >= 0 ? 1 : -1; if (Math.abs(proj) < 1e-7) sg = y >= 0 ? 1 : -1; ax = x * sg; ay = y * sg; az = z * sg; }
    }
    if (!(best > 0) || best > 0.2) return;
    // (correction bornée par sous-pas : un recouvrement se résout en douceur,
    // sans lancer les nœuds — une correction de position devient une vitesse)
    if (best > 0.0025) best = 0.0025;
    const w0 = W[a0] * (1 - sc), w1 = W[a1] * sc, w2 = W[b0] * (1 - tc), w3 = W[b1] * tc;
    const sw = w0 * (1 - sc) + w1 * sc + w2 * (1 - tc) + w3 * tc;
    if (sw <= 0) return;
    const lam = best / sw;
    X[a0] -= ax * lam * w0; Y[a0] -= ay * lam * w0; Z[a0] -= az * lam * w0;
    X[a1] -= ax * lam * w1; Y[a1] -= ay * lam * w1; Z[a1] -= az * lam * w1;
    X[b0] += ax * lam * w2; Y[b0] += ay * lam * w2; Z[b0] += az * lam * w2;
    X[b1] += ax * lam * w3; Y[b1] += ay * lam * w3; Z[b1] += az * lam * w3;
    if (best > ovMax) ovMax = best;
    // la face qui porte : ce qu'on touche par sa face devient l'appui du ruban
    if (ay > 0.5) { CN[b1 * 3] = ax; CN[b1 * 3 + 1] = ay; CN[b1 * 3 + 2] = az; CN[b0 * 3] = ax; CN[b0 * 3 + 1] = ay; CN[b0 * 3 + 2] = az; }
    else if (ay < -0.5) { CN[a1 * 3] = -ax; CN[a1 * 3 + 1] = -ay; CN[a1 * 3 + 2] = -az; CN[a0 * 3] = -ax; CN[a0 * 3 + 1] = -ay; CN[a0 * 3 + 2] = -az; }
  }

  const LB = new Float64Array(nb * 3);
  function solveDist(k) {
    const a = D[2 * k], b = D[2 * k + 1], wa = W[a], wb = W[b];
    const dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Z[b] - Z[a], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const c = (l - DL[k]) / (l * (wa + wb));
    X[a] += wa * c * dx; Y[a] += wa * c * dy; Z[a] += wa * c * dz;
    X[b] -= wb * c * dx; Y[b] -= wb * c * dy; Z[b] -= wb * c * dz;
  }
  function solveBend(k) {
    const a = BA[3 * k], b = BA[3 * k + 1], c = BA[3 * k + 2];
    const ga = BG[3 * k], gb = BG[3 * k + 1], gc = BG[3 * k + 2], al = BAl[k] / (h * h);
    const sw = W[a] * ga * ga + W[b] * gb * gb + W[c] * gc * gc;
    const cx = gc * X[c] + gb * X[b] + ga * X[a], cy = gc * Y[c] + gb * Y[b] + ga * Y[a], cz = gc * Z[c] + gb * Z[b] + ga * Z[a];
    const o = 3 * k, den = sw + al;
    const lx = (-cx - al * LB[o]) / den, ly = (-cy - al * LB[o + 1]) / den, lz = (-cz - al * LB[o + 2]) / den;
    LB[o] += lx; LB[o + 1] += ly; LB[o + 2] += lz;
    X[a] += W[a] * ga * lx; Y[a] += W[a] * ga * ly; Z[a] += W[a] * ga * lz;
    X[b] += W[b] * gb * lx; Y[b] += W[b] * gb * ly; Z[b] += W[b] * gb * lz;
    X[c] += W[c] * gc * lx; Y[c] += W[c] * gc * ly; Z[c] += W[c] * gc * lz;
  }
  let tSim = 0, water = 0;
  let obst = null;
  // le caisson : une sphère autour de l'objectif (le dôme et son boîtier) et
  // un pied vertical jusqu'à la roche ; un nœud est repoussé hors des deux
  const pushOutP = (p, o, clear) => {
    let dx = p[0] - o.x, dy = p[1] - o.y, dz = p[2] - o.z, dd = Math.hypot(dx, dy, dz), rr = o.r + clear;
    if (dd < rr && dd > 1e-6) { const q = (rr - dd) / dd; p[0] += dx * q; p[1] += dy * q; p[2] += dz * q; }
    if (p[1] < o.y) {
      dx = p[0] - o.x; dz = p[2] - o.z; dd = Math.hypot(dx, dz); rr = o.rs + clear;
      if (dd < rr && dd > 1e-6) { const q = (rr - dd) / dd; p[0] += dx * q; p[2] += dz * q; }
    }
    return p;
  };
  const _p3 = [0, 0, 0];
  const pushOut = (i, o, clear) => { _p3[0] = X[i]; _p3[1] = Y[i]; _p3[2] = Z[i]; pushOutP(_p3, o, clear); X[i] = _p3[0]; Y[i] = _p3[1]; Z[i] = _p3[2]; };

  function substep() {
    const t = tSim;
    // (le caisson suit le léger travelling de la caméra)
    if (opts.camera) { const c = opts.camera(t / T); obst = { x: c[0], y: c[1], z: c[2], r: opts.cameraR ?? 0.13, rs: 0.035, h: c[1] - rockH(c[0], c[2]) }; }
    // 1. forces et prédiction
    for (let i = 0; i < N; i++) {
      if (W[i] === 0) continue;
      ground(i);
      let vx = VX[i], vy = VY[i], vz = VZ[i];
      let s = 0, ux = 0, uz = 0, dux = 0;
      if (water > 0) {
        const tl = t - obliq * (Z[i] - zRef);
        const eta = fieldAt(S.eta, X[i], tl);
        const depth = eta - GH[i];
        s = (eta - Y[i]) / (2 * Rr[i] + SW) + 0.5;
        s = (s < 0 ? 0 : s > 1 ? 1 : s) * water;
        // (une lame d'eau de quelques millimètres sur la roche — la nappe qui
        // se retire — n'emporte pas une lanière couchée : sa prise croît avec
        // la profondeur, nulle sous 5 mm, entière au-delà de 6 cm. Sans cela,
        // les lames glissaient dans une eau que l'image montre à peine)
        const dep = depth < 0.005 ? 0 : depth > 0.06 ? 1 : ((depth - 0.005) / 0.055) ** 2 * (3 - 2 * (depth - 0.005) / 0.055);
        s *= dep;
        if (s > 0 && depth > 0.003) {
          // profil de vitesse en puissance 1/7 : plus lent près de la roche
          const zr = Math.max(0, Y[i] - GH[i]) / Math.max(0.02, depth);
          const pr = Math.max(0.35, Math.min(1, zr ** (1 / 7)));
          const u0 = fieldAt(S.u, X[i], tl) * pr, u1 = fieldAt(S.u, X[i], tl + h) * pr;
          ux = u0; uz = u0 * side; dux = u1 - u0;
        }
      }
      // poids et poussée (la masse ajoutée ralentit une lame à plat dans l'eau)
      vy += (G * (s / Rho[i] - 1) / (1 + s * Am[i] * 0.5)) * h;
      if (s > 0) {
        vx += s * dux; vz += s * dux * side; // (l'eau qui accélère emporte la lame)
        let rx = vx - ux, ry = vy, rz = vz - uz;
        const f = 1 / (1 + Kd[i] * Math.sqrt(rx * rx + ry * ry + rz * rz) * h * s);
        vx = ux + rx * f; vy = ry * f; vz = uz + rz * f;
      } else { const f = 1 / (1 + 0.5 * h); vx *= f; vy *= f; vz *= f; }
      PX[i] = X[i]; PY[i] = Y[i]; PZ[i] = Z[i];
      X[i] += vx * h; Y[i] += vy * h; Z[i] += vz * h;
      CN[i * 3] = 0; CN[i * 3 + 1] = 0; CN[i * 3 + 2] = 0;
    }
    LB.fill(0);
    for (let it = 0; it < iters; it++) {
      // 2. longueur
      for (let k = 0; k < ND; k++) solveDist(k);
      // 3. flexion : C = (x_c − x_b)/l2 − (x_b − x_a)/l1 (XPBD, composante par composante)
      for (let k = 0; k < nb; k++) solveBend(k);
    }
    for (let it = 0; it < 10; it++) { for (let q = 0; q < SB_.length; q++) solveBend(SB_[q]); for (let q = 0; q < SD_.length; q++) solveDist(SD_[q]); }
    // 4. contacts entre lanières
    if (!opts.noCollide) for (let p = 0; p < np; p += 2) collide(pairs[p], pairs[p + 1]);
    // 5. inextensibilité exacte (« follow the leader », Müller et al. 2012),
    // de la racine vers la pointe — chaque nœud est ramené à sa distance au
    // précédent (le courant accumule sinon un étirement le long d'une lanière)
    // — et, nœud par nœud, contact et frottement sur la roche (la tranche du
    // ruban compte s'il penche) : le suivant part de la position corrigée
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < FTL.length; k += 2) {
      const a = FTL[k], i = FTL[k + 1], l0 = FL[k >> 1];
      const dx = X[i] - X[a], dy = Y[i] - Y[a], dz = Z[i] - Z[a], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
      const f = l0 / l;
      X[i] = X[a] + dx * f; Y[i] = Y[a] + dy * f; Z[i] = Z[a] + dz * f;
      const nx = GX[i], ny = GY[i], nz = GZ[i];
      const h0 = rockH(X[i], Z[i]);
      let clear = Rr[i];
      if (KIND[i]) {
        const fx = TY[i] * BZ[i] - TZ[i] * BY[i], fy = TZ[i] * BX[i] - TX[i] * BZ[i], fz = TX[i] * BY[i] - TY[i] * BX[i];
        clear = 0.5 * Wd[i] * Math.abs(BX[i] * nx + BY[i] * ny + BZ[i] * nz) + Rr[i] * Math.abs(fx * nx + fy * ny + fz * nz);
      }
      // (correction bornée par sous-pas : sur le tombant, la hauteur sous le
      // nœud peut dépasser d'un mètre sa position ; corrigée d'un coup, elle
      // lançait le nœud à 30 m/s — un « saut » à l'écran)
      // le caisson de la caméra (dôme et pied) : un obstacle comme la roche
      if (obst) pushOut(i, obst, clear);
      const pen = Math.min(0.006, (h0 + clear + 0.001 - Y[i]) * ny);
      if (pen > 0) {
        if (pen > pushMax) { pushMax = pen; worst = { i, t: tSim, pen, y: Y[i], h0, prevY: PY[i], hPrev: GH[i], x: X[i], z: Z[i], px: PX[i], pz: PZ[i], kind: KIND[i], ny, clear, a, ya: Y[a] }; }
        X[i] += nx * pen; Y[i] += ny * pen; Z[i] += nz * pen;
        let ex = X[i] - PX[i], ey = Y[i] - PY[i], ez = Z[i] - PZ[i];
        const dn = ex * nx + ey * ny + ez * nz;
        ex -= dn * nx; ey -= dn * ny; ez -= dn * nz;
        const dl = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (dl > 1e-12) { const q = Math.min(1, (mu * pen) / dl); X[i] -= ex * q; Y[i] -= ey * q; Z[i] -= ez * q; }
        CN[i * 3] = nx; CN[i * 3 + 1] = ny; CN[i * 3 + 2] = nz;
      }
    }
    // 6. vitesses
    for (let i = 0; i < N; i++) {
      if (W[i] === 0) continue;
      VX[i] = (X[i] - PX[i]) / h; VY[i] = (Y[i] - PY[i]) / h; VZ[i] = (Z[i] - PZ[i]) / h;
      // (vitesse bornée : une lame dans le ressac ne dépasse pas ~5 m/s ; au-delà,
      // c'est une correction de contrainte, pas un mouvement)
      const sp = Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i]);
      if (sp > VMAX) { const q = VMAX / sp; VX[i] *= q; VY[i] *= q; VZ[i] *= q; }
    }
    // 6 bis. amortissement structurel : la vitesse de chaque nœud est tirée vers
    // la moyenne de ses voisins de chaîne. Le mouvement d'ensemble (la lame
    // emportée par l'eau) est intact ; les vibrations nœud contre nœud — que
    // les contacts et la projection d'inextensibilité excitent, et qui se
    // voyaient comme des sauts d'une image à l'autre — s'éteignent.
    for (let i = 0; i < N; i++) {
      if (W[i] === 0) continue;
      const p = prevN[i], n = nextN[i];
      let mx = 0, my = 0, mz = 0, c = 0;
      if (p >= 0) { mx += VX[p]; my += VY[p]; mz += VZ[p]; c++; }
      if (n >= 0) { mx += VX[n]; my += VY[n]; mz += VZ[n]; c++; }
      if (!c) continue;
      DVX[i] = (mx / c - VX[i]) * SD; DVY[i] = (my / c - VY[i]) * SD; DVZ[i] = (mz / c - VZ[i]) * SD;
    }
    for (let i = 0; i < N; i++) if (W[i] !== 0) { VX[i] += DVX[i]; VY[i] += DVY[i]; VZ[i] += DVZ[i]; }
    // 7. directeurs : transportés, couchés sur ce qui porte, tournés dans le courant
    for (let i = 0; i < N; i++) tangent(i);
    for (let i = 0; i < N; i++) {
      if (!KIND[i]) continue;
      let bx = BX[i], by = BY[i], bz = BZ[i], tx, ty, tz, rate;
      if (CN[i * 3 + 1] !== 0 || CN[i * 3] !== 0) {
        const nx = CN[i * 3], ny = CN[i * 3 + 1], nz = CN[i * 3 + 2];
        tx = ny * TZ[i] - nz * TY[i]; ty = nz * TX[i] - nx * TZ[i]; tz = nx * TY[i] - ny * TX[i]; rate = 40;
      } else {
        const vt = VX[i] * TX[i] + VY[i] * TY[i] + VZ[i] * TZ[i];
        tx = VX[i] - vt * TX[i]; ty = VY[i] - vt * TY[i]; tz = VZ[i] - vt * TZ[i]; rate = 5;
      }
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-4) {
        tx /= tl; ty /= tl; tz /= tl;
        if (tx * bx + ty * by + tz * bz < 0) { tx = -tx; ty = -ty; tz = -tz; }
        const f = Math.min(1, rate * h);
        bx += (tx - bx) * f; by += (ty - by) * f; bz += (tz - bz) * f;
      }
      const p = prevN[i], n = nextN[i];
      if (p >= 0 && KIND[p]) { const sg = BX[p] * bx + BY[p] * by + BZ[p] * bz < 0 ? -1 : 1; bx += 0.35 * (sg * BX[p] - bx); by += 0.35 * (sg * BY[p] - by); bz += 0.35 * (sg * BZ[p] - bz); }
      if (n >= 0) { const sg = BX[n] * bx + BY[n] * by + BZ[n] * bz < 0 ? -1 : 1; bx += 0.35 * (sg * BX[n] - bx); by += 0.35 * (sg * BY[n] - by); bz += 0.35 * (sg * BZ[n] - bz); }
      const bt = bx * TX[i] + by * TY[i] + bz * TZ[i];
      bx -= bt * TX[i]; by -= bt * TY[i]; bz -= bt * TZ[i];
      const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      BX[i] = bx / bl; BY[i] = by / bl; BZ[i] = bz / bl;
    }
    tSim += h;
  }

  let done = 0;
  const total = settle + T * (loops > 1 ? 2 - (opts.aStart ?? 0) : 1);
  function run(seconds, rec = null) {
    const n = Math.round(seconds * sub), per = Math.round(sub / fps);
    for (let k = 0; k < n; k++) {
      if (onProgress && k % 200 === 0) onProgress(Math.min(0.99, (done + k / sub) / total));
      if (k % BP === 0) broadphase();
      if (rec && k % per === 0) rec(k / per);
      substep();
    }
    done += n / sub;
  }
  const snap = () => ({ x: Float64Array.from(X), y: Float64Array.from(Y), z: Float64Array.from(Z), bx: Float64Array.from(BX), by: Float64Array.from(BY), bz: Float64Array.from(BZ) });
  const stretch = () => { let m = 0; for (let k = 0; k < ND; k++) { const a = D[2 * k], b = D[2 * k + 1]; m = Math.max(m, Math.abs(Math.hypot(X[b] - X[a], Y[b] - Y[a], Z[b] - Z[a]) / DL[k] - 1)); } return m; };

  // mise en place : à l'air, sans eau (la plante retombe sur la roche)
  water = 0; tSim = 0;
  run(settle);
  const stats = { settleStretch: +stretch().toFixed(4) };
  // Deux passages sous le même forçage : A commence au grand retrait (aStart·T,
  // le platier est à sec, les plantes couchées comme après la mise en place)
  // et va jusqu'à T ; B part de A(T) et fait la boucle entière.
  water = S ? 1 : 0;
  const nf = Math.round(T * fps);
  const aStart = opts.aStart ?? 0, fA = Math.round(aStart * nf);
  const A = { pos: new Float32Array(nf * N * 3), dir: new Float32Array(nf * N * 3) };
  const Bq = loops > 1 ? { pos: new Float32Array(nf * N * 3), dir: new Float32Array(nf * N * 3) } : A;
  const snaps = [snap()];
  let maxS = 0;
  const recInto = (rec, f0 = 0) => (f) => {
    maxS = Math.max(maxS, stretch());
    const o = (f + f0) * N * 3;
    for (let i = 0; i < N; i++) { rec.pos[o + 3 * i] = X[i]; rec.pos[o + 3 * i + 1] = Y[i]; rec.pos[o + 3 * i + 2] = Z[i]; rec.dir[o + 3 * i] = BX[i]; rec.dir[o + 3 * i + 1] = BY[i]; rec.dir[o + 3 * i + 2] = BZ[i]; }
  };
  if (loops > 1) {
    tSim = fA / fps;
    run(T - tSim, recInto(A, fA));
    snaps.push(snap());
    if (onProgress) onProgress(0.3);
  }
  tSim = 0;
  run(T, recInto(Bq));
  snaps.push(snap());
  if (onProgress) onProgress(1);
  // Fermeture de la boucle : deux boucles simulées sous le même forçage, A (la
  // précédente) et B (la dernière), avec B(0) = A(T). La boucle rendue est
  // R(t) = (1 − w)·B(t) + w·A(t), w passant de 0 à 1 pendant le retrait de la
  // grande vague (quand tout bouge vite et dans le même sens) : R(0) = B(0) =
  // A(T) = R(T). Les images mélangées sont ramenées à des chaînes
  // inextensibles posées sur la roche.
  const pos = Bq.pos, dir = Bq.dir;
  // écart moyen entre A et B, image par image (pour placer le fondu)
  const gap = new Float64Array(nf);
  if (loops > 1) for (let f = fA; f < nf; f++) { let m = 0; const o = f * N * 3; for (let i = 0; i < N; i++) m += Math.hypot(pos[o + 3 * i] - A.pos[o + 3 * i], pos[o + 3 * i + 1] - A.pos[o + 3 * i + 1], pos[o + 3 * i + 2] - A.pos[o + 3 * i + 2]); gap[f] = m / N; }
  stats.gap = Array.from({ length: 20 }, (_, k) => +gap[Math.floor(((k + 0.5) / 20) * nf)].toFixed(3));
  if (loops > 1) {
    // Chaque plante a son propre fondu, centré là où ses deux versions se
    // ressemblent le plus (l'écart moyen de ses nœuds, entre 0,55 et 0,95 de
    // la boucle) : on ne mélange jamais deux poses opposées.
    const NP = K.nodes.reduce((m, o) => Math.max(m, o.plant + 1), 0);
    const plantOf = Int32Array.from(K.nodes.map((o) => o.plant));
    const gp = Array.from({ length: NP }, () => new Float64Array(nf)), cnt = new Float64Array(NP);
    for (let i = 0; i < N; i++) cnt[plantOf[i]]++;
    for (let f = 0; f < nf; f++) { const o = f * N * 3; for (let i = 0; i < N; i++) gp[plantOf[i]][f] += Math.hypot(pos[o + 3 * i] - A.pos[o + 3 * i], pos[o + 3 * i + 1] - A.pos[o + 3 * i + 1], pos[o + 3 * i + 2] - A.pos[o + 3 * i + 2]) / cnt[plantOf[i]]; }
    const half = Math.round(0.05 * nf), lo = Math.round(0.55 * nf) + half, hi = Math.round(0.95 * nf) - half;
    // part immergée de chaque plante, image par image : le fondu se fait de
    // préférence quand la plante est dans l'eau qui bouge (son glissement d'une
    // version à l'autre s'y perd dans le mouvement de l'eau) ; à l'air, une
    // lame qui glisse sur la roche sèche se voit
    const sub = Array.from({ length: NP }, () => new Float64Array(nf));
    if (S) for (let f = 0; f < nf; f++) { const o = f * N * 3, t = f / fps; for (let i = 0; i < N; i++) { const x = pos[o + 3 * i], y = pos[o + 3 * i + 1], z = pos[o + 3 * i + 2]; if (fieldAt(S.eta, x, t - obliq * (z - zRef)) > y + 0.02) sub[plantOf[i]][f] += 1 / cnt[plantOf[i]]; } }
    const center = new Int32Array(NP);
    for (let p = 0; p < NP; p++) {
      let best = Infinity;
      for (let f = lo; f <= hi; f++) {
        let m = 0, wsub = 0;
        for (let d = -half; d <= half; d++) { m = Math.max(m, gp[p][f + d]); wsub += sub[p][f + d]; }
        const score = m + 0.25 * (1 - wsub / (2 * half + 1));
        if (score < best) { best = score; center[p] = f; }
      }
    }
    const wOf = (p, f) => { const t = (f - (center[p] - half)) / (2 * half); return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
    stats.blendCenters = [Math.min(...center) / nf, Math.max(...center) / nf].map((v) => +v.toFixed(2));
    for (let f = Math.round(0.55 * nf); f < nf; f++) {
      const o = f * N * 3;
      // (on mélange les directions des segments, pas les positions : deux poses
      // très différentes mélangées point à point font des chaînes dont les
      // nœuds se superposent, et dont le sens bascule d'une image à l'autre)
      for (let k = 0; k < FTL.length; k += 2) {
        const pa = FTL[k], i = FTL[k + 1], l0 = FL[k >> 1], w = wOf(plantOf[i], f);
        const ia = o + 3 * pa, ii = o + 3 * i;
        let bx = pos[ii] - pos[ia], by = pos[ii + 1] - pos[ia + 1], bz = pos[ii + 2] - pos[ia + 2];
        let ax = A.pos[ii] - A.pos[ia], ay = A.pos[ii + 1] - A.pos[ia + 1], az = A.pos[ii + 2] - A.pos[ia + 2];
        const lb = Math.hypot(bx, by, bz) || 1, la = Math.hypot(ax, ay, az) || 1;
        bx /= lb; by /= lb; bz /= lb; ax /= la; ay /= la; az /= la;
        let dx = bx + (ax - bx) * w, dy = by + (ay - by) * w, dz = bz + (az - bz) * w;
        const l = Math.hypot(dx, dy, dz) || 1;
        // (le parent, déjà reconstruit dans cette image, porte le segment)
        pos[ii] = pos[ia] + (dx * l0) / l; pos[ii + 1] = pos[ia + 1] + (dy * l0) / l; pos[ii + 2] = pos[ia + 2] + (dz * l0) / l;
        const g = rockH(pos[ii], pos[ii + 2]) + Rr[i] + 0.001;
        if (pos[ii + 1] < g) pos[ii + 1] = g;
        if (opts.camera) {
          const c = opts.camera(f / nf), o = { x: c[0], y: c[1], z: c[2], r: opts.cameraR ?? 0.13, rs: 0.035 };
          _p3[0] = pos[ii]; _p3[1] = pos[ii + 1]; _p3[2] = pos[ii + 2];
          pushOutP(_p3, o, Rr[i]);
          pos[ii] = _p3[0]; pos[ii + 1] = _p3[1]; pos[ii + 2] = _p3[2];
        }
      }
      for (let i = 0; i < N; i++) { const w = wOf(plantOf[i], f); for (let c = 0; c < 3; c++) dir[o + 3 * i + c] += (A.dir[o + 3 * i + c] - dir[o + 3 * i + c]) * w; }
      for (let i = 0; i < N; i++) { const q = o + 3 * i, l = Math.hypot(dir[q], dir[q + 1], dir[q + 2]) || 1; dir[q] /= l; dir[q + 1] /= l; dir[q + 2] /= l; }
    }
  }
  // écart au raccord : état à la fin de chaque boucle contre celui du début
  stats.residual = [];
  for (let L = 1; L < snaps.length; L++) {
    let m = 0, sum = 0;
    for (let i = 0; i < N; i++) { const d = Math.hypot(snaps[L].x[i] - snaps[L - 1].x[i], snaps[L].y[i] - snaps[L - 1].y[i], snaps[L].z[i] - snaps[L - 1].z[i]); m = Math.max(m, d); sum += d; }
    stats.residual.push([+m.toFixed(4), +(sum / N).toFixed(4)]);
  }
  stats.maxStretch = +maxS.toFixed(4);
  stats.maxOverlap = +ovMax.toFixed(4);
  stats.maxPush = +pushMax.toFixed(4); stats.worst = worst;
  stats.pairs = np / 2;
  return { n: N, nf, fps, pos, dir, stats, end: snaps[snaps.length - 1], start: snaps[snaps.length - 2] };
}
