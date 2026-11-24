// Le champ du terrier et le calcul de ce que fait le métal dedans.
// Module pur (sans three) : le worker l'exécute, les tests et les bancs de
// tools/ l'importent dans Node.
//
// 1. field(prims) : distance signée sur une grille de voxels (négative dans le
//    vide), par union adoucie des primitives, coupée à la face du haut.
// 2. escapeSet : les voxels que le métal peut remplir. Au remplissage (sablier
//    droit), l'air d'un voxel doit pouvoir monter jusqu'à l'entrée : il faut un
//    chemin du voxel à l'entrée qui ne descend jamais. C'est aussi, à l'envers,
//    la condition pour que le métal s'écoule vers l'entrée quand le sablier est
//    retourné : ce qui se remplit se vide (le raccord de la boucle).
// 3. fillOrder : remplissage-débordement. Le métal versé à l'entrée court vers
//    le point le plus bas qu'il peut atteindre sans remonter (le filet) ; le
//    bassin y monte ; quand il atteint un seuil au-delà duquel le terrain
//    redescend, il déborde, et le filet repart vers le bassin suivant, qui se
//    remplit jusqu'au niveau du seuil avant que le premier ne remonte.
// 4. drainOrder : sablier retourné, l'entrée en bas ; le niveau baisse d'un seul
//    tenant (vases communicants), du point le plus haut (l'ancien fond) au plus bas.
// 5. freezeDist : distance géodésique depuis le col, dans le métal : le front
//    de prise (le germe resté au col amorce le gallium en surfusion).
// 6. le filet : chaque bout de chemin parcouru par un filet, avec l'intervalle
//    (en fraction de volume versé) pendant lequel il coule.
import { BLOCK, sdPrim, primBounds } from './burrows.js';

export const VOXEL = 0.012; // (1,2 mm)
const BAND = 0.06;

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

export function gridOf(h = VOXEL) {
  const pad = 2;
  const min = [-BLOCK.hx - pad * h, -BLOCK.hy - pad * h, -BLOCK.hz - pad * h];
  const n = [Math.ceil((2 * BLOCK.hx) / h) + 2 * pad + 1, Math.ceil((2 * BLOCK.hy) / h) + 2 * pad + 1, Math.ceil((2 * BLOCK.hz) / h) + 2 * pad + 1];
  return { min, n, h };
}

export function field(prims, G = gridOf()) {
  const [nx, ny, nz] = G.n, h = G.h;
  const f = new Float32Array(nx * ny * nz).fill(BAND);
  const K = 0.012; // (congé des raccords, 1,2 mm)
  for (const P of prims) {
    const b = primBounds(P);
    const i0 = Math.max(0, Math.floor((b[0] - BAND - G.min[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((b[3] + BAND - G.min[0]) / h));
    const j0 = Math.max(0, Math.floor((b[1] - BAND - G.min[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((b[4] + BAND - G.min[1]) / h));
    const k0 = Math.max(0, Math.floor((b[2] - BAND - G.min[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((b[5] + BAND - G.min[2]) / h));
    for (let k = k0; k <= k1; k++) {
      const z = G.min[2] + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = G.min[1] + j * h, row = nx * (j + ny * k);
        for (let i = i0; i <= i1; i++) {
          const d = sdPrim(G.min[0] + i * h, y, z, P);
          if (d < BAND) f[row + i] = smin(f[row + i], d, K);
        }
      }
    }
  }
  // coupé à la face du haut (le col du bulbe prend le relais) ; borné à la bande
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const y = G.min[1] + j * h, row = nx * (j + ny * k);
    for (let i = 0; i < nx; i++) f[row + i] = Math.min(BAND, Math.max(f[row + i], y - BLOCK.hy));
  }
  return { f, ...G };
}

// ── tas binaire (clé, puis ordre d'insertion) ────────────────────────────────
class Heap {
  constructor() { this.k = []; this.v = []; this.s = []; this.n = 0; this.seq = 0; }
  push(key, val) {
    let i = this.n++;
    this.k[i] = key; this.v[i] = val; this.s[i] = this.seq++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(p, i)) break;
      this.swap(i, p); i = p;
    }
  }
  less(a, b) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.s[a] < this.s[b]); }
  swap(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; [this.s[a], this.s[b]] = [this.s[b], this.s[a]]; }
  topKey() { return this.k[0]; }
  pop() {
    const v = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n]; this.s[0] = this.s[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return v;
  }
}

// voisinage 26 : décalages d'indice et pas vertical
function neighbours(n) {
  const [nx, ny] = n, out = [];
  for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj && !dk) continue;
    out.push({ o: di + nx * (dj + ny * dk), di, dj, dk, w: Math.hypot(di, dj, dk) });
  }
  return out;
}

// Tout le calcul du métal dans le terrier. F : le champ (field()).
export function simulate(F) {
  const { f, n, min, h } = F, [nx, ny, nz] = n, N = nx * ny * nz;
  const NB = neighbours(n);
  const isVoid = new Uint8Array(N);
  let nVoid = 0;
  for (let i = 0; i < N; i++) if (f[i] < 0) { isVoid[i] = 1; nVoid++; }
  const J = (id) => Math.floor(id / nx) % ny;
  const valid = (id, nb) => { // (pas de débordement de grille)
    const i = id % nx, j = J(id), k = Math.floor(id / (nx * ny));
    const a = i + nb.di, b = j + nb.dj, c = k + nb.dk;
    return a >= 0 && a < nx && b >= 0 && b < ny && c >= 0 && c < nz;
  };
  // entrée : les voxels vides de la couche la plus haute
  let jTop = -1;
  for (let id = 0; id < N; id++) if (isVoid[id]) jTop = Math.max(jTop, J(id));
  const entrance = [];
  for (let id = 0; id < N; id++) if (isVoid[id] && J(id) === jTop) entrance.push(id);

  // 2. ensemble remplissable : atteint depuis l'entrée sans jamais monter
  const E = new Uint8Array(N);
  {
    const st = [...entrance];
    for (const id of st) E[id] = 1;
    while (st.length) {
      const id = st.pop();
      for (const nb of NB) {
        if (nb.dj > 0 || !valid(id, nb)) continue;
        const q = id + nb.o;
        if (isVoid[q] && !E[q]) { E[q] = 1; st.push(q); }
      }
    }
  }
  let nE = 0;
  for (let i = 0; i < N; i++) nE += E[i];

  // 3. remplissage-débordement
  const order = new Float32Array(N).fill(Infinity);
  const filled = new Uint8Array(N);
  const wetA = new Map(), wetB = new Map(); // filet : voxel → [début, fin] (en voxels versés)
  let vol = 0;
  const events = []; // (débordements : volume versé, voxel du seuil)
  // le chemin du filet : depuis s, au plus bas atteignable sans remonter
  // (largeur d'abord : à hauteur égale, le plus proche)
  const route = (s) => {
    const seen = new Map([[s, -1]]), q = [s];
    let best = s;
    for (let qi = 0; qi < q.length; qi++) {
      const id = q[qi];
      if (J(id) < J(best)) best = id;
      for (const nb of NB) {
        if (nb.dj > 0 || !valid(id, nb)) continue;
        const r = id + nb.o;
        if (!E[r] || filled[r] || seen.has(r)) continue;
        seen.set(r, id); q.push(r);
      }
    }
    const path = [];
    for (let id = best; id !== -1; id = seen.get(id)) path.push(id);
    return path.reverse(); // de s au fond
  };
  const pour = (s, stop) => {
    const path = route(s);
    const m = path[path.length - 1];
    const startVol = vol;
    const heap = new Heap();
    let level = J(m);
    const fill = (id) => {
      filled[id] = 1; order[id] = vol++;
      for (const nb of NB) {
        if (!valid(id, nb)) continue;
        const r = id + nb.o;
        if (E[r] && !filled[r]) heap.push(J(r), r);
      }
    };
    fill(m);
    while (heap.n) {
      if (heap.topKey() >= stop) break;
      const id = heap.pop();
      if (filled[id]) continue;
      if (J(id) < level) {
        events.push({ vol, at: id });
        const rest = pour(id, level);
        for (const r of rest) if (!filled[r]) heap.push(J(r), r);
        continue;
      }
      level = J(id);
      fill(id);
    }
    // le filet coule de startVol jusqu'au retour (ou jusqu'à être noyé)
    for (const id of path) {
      const a = wetA.get(id);
      wetA.set(id, a === undefined ? startVol : Math.min(a, startVol));
      wetB.set(id, Math.max(wetB.get(id) ?? 0, stop === Infinity ? Infinity : vol));
    }
    const rest = [];
    while (heap.n) { const id = heap.pop(); if (!filled[id]) rest.push(id); }
    return rest;
  };
  pour(entrance[Math.floor(entrance.length / 2)], Infinity);
  for (const id of entrance) if (!filled[id] && E[id]) { order[id] = vol++; filled[id] = 1; }
  const total = vol;

  // 4. vidange : le niveau baisse d'un seul tenant, de l'ancien fond à l'entrée
  //    (rang par hauteur croissante dans le repère du terrier)
  const drain = new Float32Array(N).fill(-1);
  {
    const ids = [];
    for (let i = 0; i < N; i++) if (filled[i]) ids.push(i);
    ids.sort((a, b) => J(a) - J(b) || order[b] - order[a]);
    ids.forEach((id, r) => { drain[id] = r; });
  }

  // 5. front de prise : géodésique depuis l'entrée, dans le métal (Dijkstra)
  const geo = new Float64Array(N).fill(Infinity); // (Float64 : la clé du tas est comparée à la valeur stockée)
  {
    const heap = new Heap();
    for (const id of entrance) if (filled[id]) { geo[id] = 0; heap.push(0, id); }
    while (heap.n) {
      const d0 = heap.topKey(), id = heap.pop();
      if (d0 > geo[id]) continue;
      for (const nb of NB) {
        if (!valid(id, nb)) continue;
        const r = id + nb.o;
        if (!filled[r]) continue;
        const d = d0 + nb.w * h;
        if (d < geo[r]) { geo[r] = d; heap.push(d, r); }
      }
    }
  }
  let geoMax = 0;
  for (let i = 0; i < N; i++) if (filled[i] && geo[i] > geoMax) geoMax = geo[i];

  return { isVoid, E, filled, order, drain, geo, geoMax, total, nVoid, nE, entrance, wetA, wetB, events, J };
}
