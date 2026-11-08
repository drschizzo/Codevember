// Réseau de vaisseaux d'une membrane, par colonisation de l'espace (Runions) :
// des racines près du pédoncule (arrière), des points attracteurs répartis sur
// la sphère ; à chaque pas, chaque attracteur tire vers lui le nœud le plus
// proche, qui pousse d'un petit pas ; un attracteur atteint disparaît. Le
// rayon des vaisseaux suit le « modèle des tuyaux » (r³ ≈ somme des r³ des
// branches) : épais au pied, capillaires aux extrémités.
//
// Sortie : carte octaédrique (RGBA8) de la direction au repos :
//   R : présence d'un vaisseau (bord adouci), G : rayon (épaisseur relative),
//   B : profondeur (les gros vaisseaux sont un peu plus enfoncés),
//   A : distance au vaisseau le plus proche (halo, sang diffusé)

import { createRng } from '../rng.js';
import { V3 } from './geo.js';

const { sqrt, min, max, abs, acos } = Math;

export function buildVessels({ seed, roots = 5, attractors = 1600, size = 512, reach = 0.22, kill = 0.035, step = 0.018, r0 = 0.0016, rMax = 0.011, back = true }) {
  const rng = createRng(`vessels:${seed}`);
  const nodes = []; // { p, parent, leaves }
  for (let i = 0; i < roots; i++) {
    const th = (back ? 150 + rng.next() * 22 : rng.next() * 180) * Math.PI / 180, ph = rng.next() * Math.PI * 2;
    nodes.push({ p: [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)], parent: -1 });
  }
  let att = [];
  for (let i = 0; i < attractors; i++) att.push(rng.dir());
  // grille spatiale des nœuds
  const cell = reach, key = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
  const grid = new Map();
  const put = (i) => { const k = key(nodes[i].p); (grid.get(k) || grid.set(k, []).get(k)).push(i); };
  nodes.forEach((_, i) => put(i));
  const near = (p, r) => {
    const out = [];
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const l = grid.get(`${cx + x},${cy + y},${cz + z}`);
      if (l) for (const i of l) { const d = V3.len(V3.sub(nodes[i].p, p)); if (d < r) out.push([i, d]); }
    }
    return out;
  };
  for (let it = 0; it < 600 && att.length; it++) {
    const pull = new Map();
    for (const a of att) {
      let best = -1, bd = reach;
      for (const [i, d] of near(a, reach)) if (d < bd) { bd = d; best = i; }
      if (best < 0) continue;
      const dir = V3.norm(V3.sub(a, nodes[best].p));
      const acc = pull.get(best);
      if (acc) { acc[0] += dir[0]; acc[1] += dir[1]; acc[2] += dir[2]; } else pull.set(best, [...dir]);
    }
    if (!pull.size) break;
    for (const [i, d] of pull) {
      const p = nodes[i].p;
      // pas tangent à la sphère, un peu de sinuosité
      let g = V3.norm(d);
      const j = rng.dir();
      g = V3.norm(V3.add(g, V3.mul(j, 0.25)));
      const q = V3.norm(V3.add(p, V3.mul(g, step)));
      nodes.push({ p: q, parent: i });
      put(nodes.length - 1);
    }
    att = att.filter((a) => !near(a, kill).length);
  }
  // modèle des tuyaux
  const n = nodes.length, kids = new Int32Array(n), r3 = new Float64Array(n);
  for (const nd of nodes) if (nd.parent >= 0) kids[nd.parent]++;
  const order = [];
  const pend = Int32Array.from(kids);
  for (let i = 0; i < n; i++) if (!kids[i]) order.push(i);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (!kids[i]) r3[i] = r0 ** 3;
    const p = nodes[i].parent;
    if (p >= 0) { r3[p] += r3[i] * 1.05; if (--pend[p] === 0) order.push(p); }
  }
  const rad = (i) => min(rMax, Math.cbrt(r3[i]));
  // segments, grille spatiale
  const segs = [];
  for (let i = 0; i < n; i++) if (nodes[i].parent >= 0) segs.push([nodes[i].p, nodes[nodes[i].parent].p, rad(i)]);
  const sc = 0.06, sg = new Map();
  segs.forEach((s, k) => {
    const m = V3.mul(V3.add(s[0], s[1]), 0.5), kk = `${Math.floor(m[0] / sc)},${Math.floor(m[1] / sc)},${Math.floor(m[2] / sc)}`;
    (sg.get(kk) || sg.set(kk, []).get(kk)).push(k);
  });
  // rastérisation par texel (direction exacte : pas de couture aux plis)
  const N = size, out = new Uint8Array(N * N * 4);
  const halo = 0.03;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let u = ((i + 0.5) / N) * 2 - 1, v = ((j + 0.5) / N) * 2 - 1;
    let z = 1 - abs(u) - abs(v);
    if (z < 0) { const ou = u; u = (1 - abs(v)) * Math.sign(ou || 1); v = (1 - abs(ou)) * Math.sign(v || 1); }
    const d = V3.norm([u, v, z]);
    const cx = Math.floor(d[0] / sc), cy = Math.floor(d[1] / sc), cz = Math.floor(d[2] / sc);
    let cov = 0, rr = 0, dist = halo;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let w = -1; w <= 1; w++) {
      const l = sg.get(`${cx + x},${cy + y},${cz + w}`);
      if (!l) continue;
      for (const k of l) {
        const [a, b, r] = segs[k];
        const ab = V3.sub(b, a), t = max(0, min(1, V3.dot(V3.sub(d, a), ab) / (V3.dot(ab, ab) || 1)));
        const e = V3.len(V3.sub(d, V3.add(a, V3.mul(ab, t))));
        const fw = 0.0035; // (bord adouci : ~1 texel)
        const c = max(0, min(1, (r + fw - e) / (2 * fw)));
        if (c > cov) { cov = c; rr = r; }
        dist = min(dist, max(0, e - r));
      }
    }
    const o = (j * N + i) * 4;
    out[o] = Math.round(cov * 255);
    out[o + 1] = Math.round(min(1, rr / rMax) * 255);
    out[o + 2] = Math.round(min(1, (rr / rMax) ** 0.7) * cov * 255);
    out[o + 3] = Math.round((1 - dist / halo) * 255);
  }
  return { data: out, size: N, nodes: n };
}

export { acos };
