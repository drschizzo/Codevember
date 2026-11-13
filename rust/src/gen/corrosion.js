// Corrosion atmosphérique calculée sur la géométrie de la pièce.
//
// La rouille a besoin d'eau : sa vitesse est réglée par le temps
// d'humectation (ISO 9223), c'est-à-dire par l'endroit où l'eau arrive, où
// elle reste et où elle sèche mal. On le calcule sur des points tirés sur
// toute la surface (rivets et boulons compris) :
//
//  - concavité (hauteur moyenne des voisins au-dessus du plan tangent, à deux
//    rayons) : positive dans les angles rentrants et au pied des têtes de
//    rivet — l'aération différentielle (Evans) y fait une anode, la rouille
//    commence là ; négative sur les arêtes et les sommets, qui perdent leur
//    protection en premier ;
//  - ciel : part des directions vers le haut que rien ne masque (rayons dans
//    une grille d'occupation) — la pluie mouille, l'abri sèche mal ;
//  - stagnation : faces tournées vers le haut et creuses, où l'eau reste ;
//  - ruissellement : l'eau qui coule emporte des oxydes depuis chaque point
//    rouillé et les dépose en traînées vers le bas, le long des surfaces.
//
// Le tout est écrit dans un volume 3D (repère de la pièce, ~1 cm par voxel,
// dilaté autour de la surface) que le shader lit : R = instant d'apparition
// (en temps d'humectation, front de propagation compris), G = concavité,
// B = coulure, A = humectation (épaisseur finale). Le shader en tire la
// rouille à chaque instant (loi de dose, voir scene/rust.js).
//
// Deux cartes d'accès décident aussi ce que les machines atteignent (un point
// masqué par une autre partie de la pièce reste rouillé) : profondeur vue de
// face (laser, qui tire selon −z) et rayon maximal vu de l'axe (buse de
// sablage, la pièce tourne sur le plateau).
import { createRng } from '../../../shared/rng.js';

const { sqrt, max, min, abs, floor, ceil, PI, cos, sin, atan2 } = Math;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Échantillons sur la surface (densité uniforme) ───────────────────────────
export function sampleSurface(body, spacing, seed = 'samples') {
  const rng = createRng(seed);
  const P = body.position, N = body.normal, S = body.surf, I = body.index;
  const per = 1 / (spacing * spacing);
  let cap = 1 << 16, n = 0;
  let pos = new Float32Array(cap * 3), nor = new Float32Array(cap * 3), mat = new Uint8Array(cap);
  const grow = () => { cap *= 2; const a = new Float32Array(cap * 3); a.set(pos); pos = a; const b = new Float32Array(cap * 3); b.set(nor); nor = b; const c = new Uint8Array(cap); c.set(mat); mat = c; };
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const area = 0.5 * sqrt(cx * cx + cy * cy + cz * cz);
    let k = area * per;
    let m = floor(k) + (rng.next() < k - floor(k) ? 1 : 0);
    // matière : poids dominant du premier sommet (cohérent par pièce)
    const sa = I[t] * 4;
    const ma = S[sa] >= S[sa + 1] && S[sa] >= S[sa + 2] ? 0 : S[sa + 1] >= S[sa + 2] ? 1 : 2;
    while (m-- > 0) {
      let r1 = rng.next(), r2 = rng.next();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      const r0 = 1 - r1 - r2;
      if (n === cap) grow();
      const o = n * 3;
      for (let q = 0; q < 3; q++) {
        pos[o + q] = r0 * P[a + q] + r1 * P[b + q] + r2 * P[c + q];
        nor[o + q] = r0 * N[a + q] + r1 * N[b + q] + r2 * N[c + q];
      }
      const l = Math.hypot(nor[o], nor[o + 1], nor[o + 2]) || 1;
      nor[o] /= l; nor[o + 1] /= l; nor[o + 2] /= l;
      mat[n] = ma;
      n++;
    }
  }
  return { n, pos: pos.subarray(0, n * 3), nor: nor.subarray(0, n * 3), mat: mat.subarray(0, n) };
}

// ── Grille de voisinage (tri par cellule) ────────────────────────────────────
function hashGrid(pos, n, cell, lo, dims) {
  const [nx, ny, nz] = dims, start = new Int32Array(nx * ny * nz + 1), order = new Int32Array(n), key = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = min(nx - 1, max(0, floor((pos[i * 3] - lo[0]) / cell))), y = min(ny - 1, max(0, floor((pos[i * 3 + 1] - lo[1]) / cell))), z = min(nz - 1, max(0, floor((pos[i * 3 + 2] - lo[2]) / cell)));
    key[i] = (z * ny + y) * nx + x; start[key[i] + 1]++;
  }
  for (let k = 0; k < nx * ny * nz; k++) start[k + 1] += start[k];
  const fill = start.slice();
  for (let i = 0; i < n; i++) order[fill[key[i]]++] = i;
  return { start, order, cell, lo, dims };
}

// concavité au rayon r : hauteur moyenne pondérée des voisins au-dessus du plan tangent, / r
function concavity(S, G, r) {
  const { pos, nor, n } = S, out = new Float32Array(n), r2 = r * r;
  const reach = ceil(r / G.cell), [nx, ny, nz] = G.dims;
  for (let i = 0; i < n; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], qx = nor[i * 3], qy = nor[i * 3 + 1], qz = nor[i * 3 + 2];
    const cx = floor((px - G.lo[0]) / G.cell), cy = floor((py - G.lo[1]) / G.cell), cz = floor((pz - G.lo[2]) / G.cell);
    let sw = 0, sh = 0;
    for (let z = max(0, cz - reach); z <= min(nz - 1, cz + reach); z++) for (let y = max(0, cy - reach); y <= min(ny - 1, cy + reach); y++) {
      const row = (z * ny + y) * nx;
      for (let x = max(0, cx - reach); x <= min(nx - 1, cx + reach); x++) {
        const k = row + x;
        for (let e = G.start[k]; e < G.start[k + 1]; e++) {
          const j = G.order[e];
          const dx = pos[j * 3] - px, dy = pos[j * 3 + 1] - py, dz = pos[j * 3 + 2] - pz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          // (l'autre face d'une tôle mince n'est pas un voisin)
          if (qx * nor[j * 3] + qy * nor[j * 3 + 1] + qz * nor[j * 3 + 2] < -0.3) continue;
          const w = 1 - d2 / r2;
          sw += w; sh += w * (dx * qx + dy * qy + dz * qz);
        }
      }
    }
    out[i] = sw > 0 ? sh / sw / r : 0;
  }
  return out;
}

// part du ciel visible (rayons vers le haut dans une grille d'occupation)
function skyView(S, lo, hi, wind = [0.15, 0]) {
  const cell = 0.02, dims = [0, 1, 2].map((k) => max(1, ceil((hi[k] - lo[k]) / cell) + 1));
  const [nx, ny, nz] = dims, occ = new Uint8Array(nx * ny * nz);
  const { pos, nor, n } = S;
  for (let i = 0; i < n; i++) {
    const x = floor((pos[i * 3] - lo[0]) / cell), y = floor((pos[i * 3 + 1] - lo[1]) / cell), z = floor((pos[i * 3 + 2] - lo[2]) / cell);
    occ[(z * ny + y) * nx + x] = 1;
  }
  // directions : la verticale (inclinée par le vent) et deux couronnes
  const dirs = [[wind[0], 1, wind[1]]];
  for (const [el, k] of [[62, 6], [38, 8]]) for (let j = 0; j < k; j++) { const a = (2 * PI * (j + 0.5 * (el === 38))) / k, e = (el * PI) / 180; dirs.push([cos(e) * cos(a) + wind[0] * 0.5, sin(e), cos(e) * sin(a) + wind[1] * 0.5]); }
  const wts = dirs.map((d) => d[1]);
  const D = dirs.map((d) => { const l = Math.hypot(...d); return d.map((v) => v / l); });
  const sumW = wts.reduce((a, b) => a + b, 0);
  const out = new Float32Array(n), step = cell * 0.7, maxT = 1.4;
  for (let i = 0; i < n; i++) {
    const ox = pos[i * 3] + nor[i * 3] * 0.03, oy = pos[i * 3 + 1] + nor[i * 3 + 1] * 0.03, oz = pos[i * 3 + 2] + nor[i * 3 + 2] * 0.03;
    let s = 0;
    for (let d = 0; d < D.length; d++) {
      const [dx, dy, dz] = D[d];
      // (une direction sous le plan tangent ne voit pas le ciel)
      if (dx * nor[i * 3] + dy * nor[i * 3 + 1] + dz * nor[i * 3 + 2] < -0.05) continue;
      let free = true;
      for (let t = 0.02; t < maxT; t += step) {
        const x = floor((ox + dx * t - lo[0]) / cell), y = floor((oy + dy * t - lo[1]) / cell), z = floor((oz + dz * t - lo[2]) / cell);
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) break;
        if (occ[(z * ny + y) * nx + x]) { free = false; break; }
      }
      if (free) s += wts[d];
    }
    out[i] = s / sumW;
  }
  return out;
}

// ── Le champ ─────────────────────────────────────────────────────────────────
export function corrosionField(body, { seed = 'rust', spacing = 0.0045, maxDim = 150, lite = false, spread = 0.25 } = {}) {
  const t0 = Date.now();
  const S = sampleSurface(body, lite ? spacing * 1.35 : spacing, `${seed}:samples`);
  const { pos, nor, mat, n } = S;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], pos[i * 3 + k]); hi[k] = max(hi[k], pos[i * 3 + k]); }
  // voisinage
  const gcell = 0.02, gl = lo.map((v) => v - 0.04), gd = [0, 1, 2].map((k) => ceil((hi[k] - lo[k] + 0.08) / gcell));
  const G = hashGrid(pos, n, gcell, gl, gd);
  const c1 = concavity(S, G, 0.012), c2 = concavity(S, G, 0.04);
  const sky = skyView(S, gl, hi.map((v) => v + 0.04));
  // humectation, stagnation (par point)
  const tow = new Float32Array(n), pool = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const up = nor[i * 3 + 1];
    const pl = sstep(0.55, 0.92, up) * (0.35 + 0.65 * sstep(0.0, 0.1, c2[i])) * (0.4 + 0.6 * sky[i]);
    const crev = sstep(0.025, 0.16, c1[i]) * 0.8 + sstep(0.02, 0.12, c2[i]) * 0.35;
    const edge = sstep(0.04, 0.22, -c1[i]);
    const rain = sky[i] * (0.4 + 0.6 * max(0, up));
    const shelter = (1 - sky[i]) * (up < -0.3 ? 0.6 : 0.35);
    let w = 0.12 + 0.38 * rain + 0.55 * pl + crev + 0.3 * edge + shelter;
    if (mat[i] === 2) w = 0; // (laiton, bronze : ne rouillent pas)
    tow[i] = min(1, w); pool[i] = pl;
  }
  // volume
  const span = [0, 1, 2].map((k) => hi[k] - lo[k]);
  const vox = max(0.008, max(...span) / maxDim);
  const vlo = lo.map((v) => v - 2 * vox), dims = span.map((s) => ceil(s / vox) + 5);
  const [nx, ny, nz] = dims, NV = nx * ny * nz;
  const acc = new Float32Array(NV * 4), cnt = new Float32Array(NV), brass = new Float32Array(NV);
  for (let i = 0; i < n; i++) {
    const x = floor((pos[i * 3] - vlo[0]) / vox), y = floor((pos[i * 3 + 1] - vlo[1]) / vox), z = floor((pos[i * 3 + 2] - vlo[2]) / vox);
    const k = (z * ny + y) * nx + x;
    acc[k * 4] += tow[i]; acc[k * 4 + 1] += c1[i] + 0.5 * c2[i]; acc[k * 4 + 2] += tow[i] * sky[i]; acc[k * 4 + 3] += pool[i];
    cnt[k]++; if (mat[i] === 2) brass[k]++;
  }
  const val = new Float32Array(NV * 4), has = new Uint8Array(NV);
  for (let k = 0; k < NV; k++) if (cnt[k] > 0) { has[k] = 1; for (let q = 0; q < 4; q++) val[k * 4 + q] = acc[k * 4 + q] / cnt[k]; }
  // coulures : la charge descend la gravité le long des voxels occupés
  const streak = new Float32Array(NV);
  for (let y = ny - 1; y >= 0; y--) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const k = (z * ny + y) * nx + x;
    if (!has[k]) continue;
    // source : là où il y a de la rouille et de l'eau qui ruisselle
    const src = val[k * 4 + 2] * 0.55;
    let carry = 0;
    if (y + 1 < ny) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
        const kk = (zz * ny + y + 1) * nx + xx;
        const w = dx === 0 && dz === 0 ? 1 : dx === 0 || dz === 0 ? 0.8 : 0.62;
        carry = max(carry, streak[kk] * w);
      }
    }
    streak[k] = max(src * (0.5 + 0.5 * val[k * 4 + 3] * 0), carry * 0.972);
  }
  // instant d'apparition : d'abord local (l'humectation), puis le front qui
  // s'étend le long de la surface depuis les points précoces (la rouille
  // gagne de proche en proche, sous la calamine) — distance géodésique dans
  // les voxels occupés (Dijkstra, 26 voisins), à la vitesse `spread` (m par
  // unité de temps d'humectation)
  // (double précision : le tas compare les valeurs poussées à onset[k] ; en
  // float32, l’arrondi de onset[kk] = no tombait parfois sous no, l’entrée
  // était rejetée au dépilage et le front s’interrompait)
  const onset = new Float64Array(NV).fill(9);
  for (let k = 0; k < NV; k++) if (has[k]) { const t = Math.max(0, Math.min(1, (val[k * 4] - 0.28) / 0.72)); onset[k] = (1 - t) ** 1.25; }
  {
    const heap = new MinHeap(), done = new Uint8Array(NV);
    for (let k = 0; k < NV; k++) if (has[k]) heap.push(onset[k], k);
    const nb = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) nb.push([dx, dy, dz, (vox * Math.hypot(dx, dy, dz)) / spread]);
    while (heap.size) {
      const [o, k] = heap.pop();
      if (done[k] || o > onset[k]) continue;
      done[k] = 1;
      const x = k % nx, y = floor(k / nx) % ny, z = floor(k / (nx * ny));
      for (const [dx, dy, dz, c] of nb) {
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
        const kk = (zz * ny + yy) * nx + xx;
        if (!has[kk] || done[kk]) continue;
        const no = o + c;
        if (no < onset[kk]) { onset[kk] = no; heap.push(no, kk); }
      }
    }
  }
  for (let k = 0; k < NV; k++) if (has[k]) val[k * 4 + 3] = val[k * 4]; // (A : humectation, épaisseur)
  for (let k = 0; k < NV; k++) if (has[k]) val[k * 4] = brass[k] / cnt[k] > 0.5 ? 1 : Math.min(1, onset[k]); // (R : apparition)
  // dilatation : les voxels vides voisins de la surface prennent la moyenne
  // de leurs voisins (le filtrage trilinéaire ne mélange pas de zéros)
  for (let pass = 0; pass < 2; pass++) {
    const nv = val.slice(), ns = streak.slice(), nh = has.slice();
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = (z * ny + y) * nx + x;
      if (has[k]) continue;
      let c = 0; const s4 = [0, 0, 0, 0]; let ss = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, zz = z + dz;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
        const kk = (zz * ny + yy) * nx + xx;
        if (!has[kk]) continue;
        c++; for (let q = 0; q < 4; q++) s4[q] += val[kk * 4 + q]; ss += streak[kk];
      }
      if (c) { nh[k] = 1; for (let q = 0; q < 4; q++) nv[k * 4 + q] = s4[q] / c; ns[k] = ss / c; }
    }
    val.set(nv); streak.set(ns); has.set(nh);
  }
  const data = new Uint8Array(NV * 4);
  const u8 = (v) => max(0, min(255, Math.round(v * 255)));
  for (let k = 0; k < NV; k++) {
    data[k * 4] = u8(val[k * 4]);
    data[k * 4 + 1] = u8(0.5 + val[k * 4 + 1] * 2.2);
    data[k * 4 + 2] = u8(min(1, streak[k] * 1.6));
    data[k * 4 + 3] = u8(val[k * 4 + 3]);
  }

  // ── cartes d'accès ──
  // laser (vu de face, selon −z) : z maximal par cellule de 4 mm
  const lc = 0.004, lw = ceil((hi[0] - lo[0]) / lc) + 1, lh = ceil((hi[1] - lo[1]) / lc) + 1;
  const front = new Float32Array(lw * lh).fill(-1e3);
  for (let i = 0; i < n; i++) {
    const x = floor((pos[i * 3] - lo[0]) / lc), y = floor((pos[i * 3 + 1] - lo[1]) / lc);
    const k = y * lw + x;
    if (pos[i * 3 + 2] > front[k]) front[k] = pos[i * 3 + 2];
  }
  fillHoles(front, lw, lh, -1e3);
  // plateau tournant : profondeur vue de 32 directions horizontales (la buse
  // voit la pièce de côté pendant qu'elle tourne) — pour chaque direction d,
  // la plus grande profondeur p·d par cellule (latéral, hauteur) de 1 cm ;
  // tuiles 8 × 4 dans une seule texture
  const K = 32, dc = 0.01;
  let rAll = 0;
  for (let i = 0; i < n; i++) rAll = max(rAll, Math.hypot(pos[i * 3], pos[i * 3 + 2]));
  const tw2 = ceil((2 * rAll) / dc) + 2, th2 = ceil((hi[1] - lo[1]) / dc) + 2;
  const dirs = new Float32Array(tw2 * 8 * th2 * 4).fill(-1e3), DW = tw2 * 8;
  for (let k = 0; k < K; k++) {
    const a = (k / K) * 2 * PI, dx = cos(a), dz = sin(a), ox = (k % 8) * tw2, oy = floor(k / 8) * th2;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const dep = x * dx + z * dz, lat = -x * dz + z * dx;
      const ci = floor((lat + rAll) / dc) + 1, cj = floor((y - lo[1]) / dc) + 1;
      const kk = (oy + cj) * DW + ox + ci;
      if (dep > dirs[kk]) dirs[kk] = dep;
    }
  }
  // (trous : la plus grande voisine, sans déborder d'une tuile)
  for (let pass = 0; pass < 2; pass++) {
    const b = dirs.slice();
    for (let k = 0; k < K; k++) {
      const ox = (k % 8) * tw2, oy = floor(k / 8) * th2;
      for (let j = 1; j < th2 - 1; j++) for (let i = 1; i < tw2 - 1; i++) {
        const kk = (oy + j) * DW + ox + i;
        if (dirs[kk] > -999) continue;
        let m = -1e3;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) m = max(m, dirs[(oy + j + dj) * DW + ox + i + di]);
        b[kk] = m;
      }
    }
    dirs.set(b);
  }
  // plateau tournant : rayon maximal (depuis l'axe x = z = 0) par (azimut, hauteur)
  const tw = 720, tc = 0.004, th = ceil((hi[1] - lo[1]) / tc) + 1;
  const radial = new Float32Array(tw * th).fill(-1);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], z = pos[i * 3 + 2], r = Math.hypot(x, z);
    const a = floor(((atan2(z, x) / (2 * PI) + 1) % 1) * tw) % tw, y = floor((pos[i * 3 + 1] - lo[1]) / tc);
    const k = y * tw + a;
    if (r > radial[k]) radial[k] = r;
  }
  fillHoles(radial, tw, th, -1, true);

  // dessus (vu d'en haut) : hauteur maximale par cellule de 1 cm — la pluie
  // s'y arrête et y éclabousse
  const pc = 0.01, pw = ceil((hi[0] - lo[0]) / pc) + 1, ph = ceil((hi[2] - lo[2]) / pc) + 1;
  const top = new Float32Array(pw * ph).fill(-1e3);
  for (let i = 0; i < n; i++) {
    const k = floor((pos[i * 3 + 2] - lo[2]) / pc) * pw + floor((pos[i * 3] - lo[0]) / pc);
    if (pos[i * 3 + 1] > top[k]) top[k] = pos[i * 3 + 1];
  }
  return {
    top: { data: top, w: pw, h: ph, lo: [lo[0], lo[2]], cell: pc },
    field: { data, dims, lo: vlo, vox },
    front: { data: front, w: lw, h: lh, lo: [lo[0], lo[1]], cell: lc },
    radial: { data: radial, w: tw, h: th, y0: lo[1], cell: tc },
    dirs: { data: dirs, w: DW, h: th2 * 4, tw: tw2, th: th2, K, r: rAll, y0: lo[1], cell: dc },
    lo, hi,
    stats: { samples: n, ms: Date.now() - t0, vox, dims },
    // (échantillons pour les tests : un sous-ensemble)
    probe: subsample(S, tow, 4000),
  };
}

// cellules vides d'une carte : la plus grande valeur voisine (quelques passes)
function fillHoles(a, w, h, empty, wrapX = false) {
  for (let pass = 0; pass < 3; pass++) {
    const b = a.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (a[k] !== empty) continue;
      let m = empty;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let xx = x + dx; const yy = y + dy;
        if (wrapX) xx = (xx + w) % w;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (a[yy * w + xx] > m) m = a[yy * w + xx];
      }
      b[k] = m;
    }
    a.set(b);
  }
}

function subsample(S, tow, k) {
  const step = max(1, floor(S.n / k)), out = [];
  for (let i = 0; i < S.n; i += step) out.push([S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], S.nor[i * 3], S.nor[i * 3 + 1], S.nor[i * 3 + 2], S.mat[i], tow[i]]);
  return new Float32Array(out.flat());
}

// tas binaire minimal (priorité, valeur)
class MinHeap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.p.length; }
  push(pr, v) { const P = this.p, Vv = this.v; let i = P.length; P.push(pr); Vv.push(v); while (i > 0) { const j = (i - 1) >> 1; if (P[j] <= P[i]) break; [P[i], P[j]] = [P[j], P[i]]; [Vv[i], Vv[j]] = [Vv[j], Vv[i]]; i = j; } }
  pop() {
    const P = this.p, Vv = this.v, top = [P[0], Vv[0]], lp = P.pop(), lv = Vv.pop();
    if (P.length) { P[0] = lp; Vv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < P.length && P[l] < P[m]) m = l; if (r < P.length && P[r] < P[m]) m = r; if (m === i) break; [P[i], P[m]] = [P[m], P[i]]; [Vv[i], Vv[m]] = [Vv[m], Vv[i]]; i = m; } }
    return top;
  }
}
