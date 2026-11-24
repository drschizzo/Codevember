// Les fourmis, vues comme dans un film en accéléré : de petites taches sombres,
// étirées dans le sens de leur course. Elles sont la cause du creusement, et
// leurs trajets suivent le vrai réseau : de l'entrée au front (le point de la
// galerie creusé à l'instant s), retour avec la boulette, puis sur le tas,
// jusqu'au point où tombe le grain creusé à cet instant, et retour.
//
// Tout est fonction de l'âge s de la tranche (pas d'état d'une image à l'autre).
import * as THREE from 'three/webgpu';
import { Fn, uv, vec3, vec4, float, smoothstep, length, vec2 } from 'three/tsl';
import { STAND } from '../layout.js';

const PER_ENTRANCE = 6, TRIPS = 9; // (allers-retours d'une fourmi sur la vie de la tranche)

// chemins d'une tranche : par entrée, les nœuds triés par instant ; la chaîne
// d'un nœud jusqu'à la racine
export function antPaths(o) {
  const n = o.nodes.length / 4, ent = o.nodeEnt;
  const node = (i) => ({ x: o.nodes[i * 4], y: o.nodes[i * 4 + 1], t: o.nodes[i * 4 + 2], parent: o.nodes[i * 4 + 3] });
  const byEnt = o.entrances.map(() => []);
  for (let i = 0; i < n; i++) byEnt[ent[i]].push(i);
  for (const L of byEnt) L.sort((a, b) => node(a).t - node(b).t);
  const drops = o.entrances.map(() => []);
  for (let i = 0; i < o.drops.length / 3; i++) drops[o.dropEnt[i]].push({ t: o.drops[i * 3], x: o.drops[i * 3 + 1], y: o.drops[i * 3 + 2] });
  for (const L of drops) L.sort((a, b) => a.t - b.t);
  // le front de l'entrée e à l'âge s : le dernier nœud creusé
  const front = (e, s) => { const L = byEnt[e]; let lo = 0, hi = L.length - 1, r = L[0]; while (lo <= hi) { const m = (lo + hi) >> 1; if (node(L[m]).t <= s) { r = L[m]; lo = m + 1; } else hi = m - 1; } return r; };
  const chain = (i) => { const P = []; for (let k = i; k >= 0; k = node(k).parent) P.push(node(k)); return P; }; // (du front à l'entrée)
  const drop = (e, s) => { const L = drops[e]; let r = L[0]; for (const d of L) { if (d.t <= s) r = d; else break; } return r; };
  return { n: o.entrances.length, front, chain, drop, W: o.W, nyS: o.nyS, C: o.C };
}

// point à la distance d le long d'une ligne brisée
function along(P, d) {
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= l) { const k = l ? d / l : 0; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y, z: a.z ?? b.z ?? -0.014 }; }
    d -= l;
  }
  const z = P[P.length - 1];
  return { x: z.x, y: z.y, dx: 1, dy: 0, z: z.z ?? -0.014 };
}
const lenOf = (P) => { let s = 0; for (let i = 0; i + 1 < P.length; i++) s += Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y); return s; };
const hash = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createAnts(maxAnts = 30) {
  const pos = new Float32Array(maxAnts * 4 * 3), uvs = new Float32Array(maxAnts * 4 * 2), idx = [];
  for (let a = 0; a < maxAnts; a++) {
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], a * 8);
    idx.push(a * 4, a * 4 + 1, a * 4 + 2, a * 4, a * 4 + 2, a * 4 + 3);
  }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa);
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  // une tache ovale, sombre, aux bords flous (elle bouge pendant la pose)
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.colorNode = Fn(() => {
    const q = uv().sub(0.5).mul(2);
    // trois parties le long du corps (u : de l'arrière à l'avant) : l'abdomen
    // (gros), le thorax (mince), la tête ; bords nets mais doux (anticrénelage)
    const blob = (cx, rx, ry) => length(vec2(q.x.sub(cx).div(rx), q.y.div(ry)));
    const d = blob(-0.45, 0.5, 0.95).min(blob(0.18, 0.28, 0.5)).min(blob(0.68, 0.24, 0.62));
    const a = smoothstep(1.0, 0.8, d).mul(0.97);
    // brun-rouge, un reflet luisant sur le dos (la chitine)
    const hl = smoothstep(0.45, 0.0, length(vec2(q.x.add(0.45), q.y.sub(0.35)))).mul(0.3);
    return vec4(vec3(0.07, 0.026, 0.013).add(hl), a);
  })();
  m.fog = false;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  // P : chemins de la tranche ; s : âge
  function update(P, s, digger = 'fourmis') {
    const worm = digger === 'vers';
    pos.fill(0);
    if (!P || s <= 0.005 || s >= 0.995) { pa.needsUpdate = true; return; }
    const active = Math.min(1, s / 0.02, (1 - s) / 0.02);
    let a = 0;
    for (let e = 0; e < P.n && a < maxAnts; e++) {
      const f = P.front(e, s), ch = P.chain(f).map((n) => ({ x: n.x, y: n.y - 0.012, z: -0.01 })); // (sur le plancher de la galerie, éclairé)
      const dr = P.drop(e, s);
      const top = ch[ch.length - 1]; // (la bouche)
      const mouth = { x: top.x, y: top.y + 0.01, z: -0.05 };
      const out = dr ? [mouth, { x: dr.x, y: dr.y + 0.012, z: -0.06 }] : [mouth];
      const down = ch.slice().reverse(); // (de la bouche au front)
      const L1 = lenOf(down), L2 = lenOf(out);
      for (let k = 0; k < (worm ? 1 : PER_ENTRANCE) && a < maxAnts; k++, a++) {
        // un ver reste au front de son terrier ; les fourmis font la navette
        const ph = worm ? 0.399 : (s * TRIPS * (0.85 + 0.3 * hash(e * 31 + k)) + k / PER_ENTRANCE + hash(e * 7 + k)) % 1;
        // un trajet : halte à la bouche, descente, halte au front (elle gratte),
        // remontée avec la boulette, aller au tas et retour
        const ease = (t) => t * t * (3 - 2 * t);
        let p;
        if (ph < 0.08) { p = along(down, 0); p.dx = 0; p.dy = -1; }
        else if (ph < 0.38) p = along(down, ease((ph - 0.08) / 0.3) * L1);
        else if (ph < 0.52) { p = along(down, L1 - 0.004 * (1 + Math.sin(ph * 900))); } // (elle gratte)
        else if (ph < 0.82) { p = along(down, (1 - ease((ph - 0.52) / 0.3)) * L1); p.dx = -p.dx; p.dy = -p.dy; }
        else { const u = (ph - 0.82) / 0.18, v = u < 0.5 ? ease(u * 2) : ease(2 - u * 2); p = along(out, v * L2); if (u >= 0.5) { p.dx = -p.dx; p.dy = -p.dy; } }
        // une tache de 4 mm, étirée dans le sens de la course (pose longue)
        const dl = Math.hypot(p.dx, p.dy) || 1, ux = p.dx / dl, uy = p.dy / dl;
        const hl = (worm ? 0.07 : 0.046) * active, hw = (worm ? 0.008 : 0.017) * active;
        const cx = p.x - P.W / 2, cy = p.y + STAND.baseH, cz = p.z;
        const c = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
        c.forEach(([u2, v2], j) => { pos.set([cx + ux * u2 - uy * v2, cy + uy * u2 + ux * v2, cz], (a * 4 + j) * 3); });
      }
    }
    pa.needsUpdate = true;
  }
  return { mesh, update };
}
