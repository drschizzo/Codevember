// La tranche prête pour le GPU (dans le worker) : tout ce qu'il faut pour la
// dessiner à n'importe quel âge s ∈ [0, 1] du creusement, sans recalcul.
//   A (RGBA16F) = (couche, lamine, instant de creusement [9 : jamais], profondeur finale)
//   B (RG16F)   = (instant d'apparition, indice de couleur) ; apparition (0 : sable de départ ; grain du tas : son
//                 instant de dépôt ; 9 : air)
// À l'âge s, une cellule est du sable si apparition ≤ s, une galerie si
// creusement ≤ s ; sa profondeur s'enfonce en un court instant (le grain
// arraché), jusqu'à la voûte calculée sur le réseau fini.
import { buildSlab, SLAB } from './slab.js';
import { half } from './half.js';

export const NEVER = 9;

export function slabTextures({ seed, params = {} }) {
  const S = buildSlab(seed, params);
  const { nx, ny, C } = S, N = nx * ny;
  const dig = new Float32Array(N).fill(NEVER), appear = new Float32Array(N).fill(NEVER);
  for (let id = 0; id < N; id++) {
    if (S.mound[id] >= 0) appear[id] = S.mound[id];
    else if (S.layer[id] !== 255) { appear[id] = 0; if (S.dug[id] >= 0) dig[id] = S.dug[id]; }
  }
  // la bouche dans le tas : galerie contre le verre entre les deux flancs ;
  // elle existe dès que ses deux flancs sont là
  const layer = new Float32Array(N), lam = new Float32Array(N);
  for (let id = 0; id < N; id++) { layer[id] = S.layer[id] === 255 ? 0 : S.colorOrder[S.layer[id]]; lam[id] = S.lam[id]; } // (la couleur : l'ordre propre à la tranche)
  for (let j = S.nyS; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + nx * j;
    if (appear[id] < NEVER) continue;
    let l = -1, r = -1;
    for (let k = 1; k <= 8; k++) { if (l < 0 && i - k >= 0 && appear[id - k] < NEVER && S.mound[id - k] >= 0) l = k; if (r < 0 && i + k < nx && appear[id + k] < NEVER && S.mound[id + k] >= 0) r = k; }
    if (l > 0 && r > 0 && l + r <= 12) {
      const a = Math.max(appear[id - l], appear[id + r]);
      appear[id] = a; dig[id] = a; layer[id] = layer[id - l]; lam[id] = lam[id - l];
    }
  }
  // profondeur finale : distance (chanfrein 3-4) des cellules creusées au sable intact
  const D = new Float32Array(N);
  for (let id = 0; id < N; id++) D[id] = dig[id] < NEVER ? 1e9 : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + nx * j; if (!D[id]) continue;
    if (i > 0) D[id] = Math.min(D[id], D[id - 1] + 3);
    if (j > 0) { D[id] = Math.min(D[id], D[id - nx] + 3); if (i > 0) D[id] = Math.min(D[id], D[id - nx - 1] + 4); if (i < nx - 1) D[id] = Math.min(D[id], D[id - nx + 1] + 4); }
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const id = i + nx * j; if (!D[id]) continue;
    if (i < nx - 1) D[id] = Math.min(D[id], D[id + 1] + 3);
    if (j < ny - 1) { D[id] = Math.min(D[id], D[id + nx] + 3); if (i < nx - 1) D[id] = Math.min(D[id], D[id + nx + 1] + 4); if (i > 0) D[id] = Math.min(D[id], D[id + nx - 1] + 4); }
  }
  const R = 0.022;
  let depthA = new Float32Array(N);
  for (let id = 0; id < N; id++) if (dig[id] < NEVER) { const d = Math.min(1, (D[id] / 3) * C / R); depthA[id] = Math.min(SLAB.DEPTH * 0.9, R * 1.6 * Math.sqrt(1 - (1 - d) ** 2)); }
  // parois lisses et lèvre arrondie : flou séparable (une passe de boîte, rayon 1 ;
  // plus fort, il étalait la galerie en traînée floue) ; une cellule intacte que le flou creuse s'ouvre avec sa voisine
  // creusée la plus ancienne (la lèvre de la galerie)
  for (let pass = 0; pass < 1; pass++) {
    const tmp = new Float32Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let a = 0, n = 0; for (let k = -1; k <= 1; k++) { const x = i + k; if (x >= 0 && x < nx) { a += depthA[x + nx * j]; n++; } } tmp[i + nx * j] = a / n; }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let a = 0, n = 0; for (let k = -1; k <= 1; k++) { const y = j + k; if (y >= 0 && y < ny) { a += tmp[i + nx * y]; n++; } } depthA[i + nx * j] = a / n; }
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + nx * j;
    if (dig[id] < NEVER || depthA[id] <= 1e-4 || appear[id] >= NEVER) continue;
    let m = NEVER;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = i + di, y = j + dj; if (x >= 0 && y >= 0 && x < nx && y < ny) m = Math.min(m, dig[x + nx * y]); }
    if (m < NEVER) dig[id] = m; else depthA[id] = 0;
  }
  const A = new Uint16Array(N * 4), B = new Uint16Array(N * 2);
  for (let id = 0; id < N; id++) {
    const depth = depthA[id];
    A[id * 4] = half(layer[id]); A[id * 4 + 1] = half(lam[id]); A[id * 4 + 2] = half(dig[id]); A[id * 4 + 3] = half(depth);
    B[id * 2] = half(appear[id]); B[id * 2 + 1] = half(layer[id]); // (lu au plus proche : la couleur sans mélange aux frontières)
  }
  // le réseau (pour les fourmis) : points de l'axe, instant, parent
  const nodes = new Float32Array(S.nodes.length * 4);
  S.nodes.forEach((n, i) => { nodes[i * 4] = n.x; nodes[i * 4 + 1] = n.y; nodes[i * 4 + 2] = n.t; nodes[i * 4 + 3] = n.parent; });
  const drops = new Float32Array(S.drops.length * 3);
  S.drops.forEach((d, i) => { drops[i * 3] = d.t; drops[i * 3 + 1] = d.x; drops[i * 3 + 2] = d.y; });
  return { A, B, nx, ny, C, W: S.W, H: ny * C, nyS: S.nyS, nL: S.nL, digger: S.digger, style: S.style, entrances: S.entrances, nodes, drops, nodeEnt: Int8Array.from(S.nodes.map((n) => n.ent)), dropEnt: Int8Array.from(S.drops.map((d) => d.ent)) };
}
