// La menue poussière du bois : grains (sable, sciure, cendre, miettes de
// bois pourri) et fibres arrachées, posés sur la même surface que tout le
// reste. Ils donnent l'échelle : sans eux, le bois nu se lit comme un meuble
// et les sporanges comme des objets de la taille d'un arbre.
//
// Périodique comme le bois : un semis tiré sur une période L, recopié de L en
// L sur toute l'étendue du maillage (la boucle par translation reste exacte).
// Les objets sont immobiles : leur position précédente est leur position.
import * as THREE from 'three/webgpu';
import { Fn, attribute, float, vec3, color, mix, cos, sin, positionGeometry, positionPrevious, normalLocal, normalGeometry, normalize } from 'three/tsl';
import { NZ, isLite, stableVelocity } from '../../../shared/scene/materials.js';
import { createRng } from '../../../shared/rng.js';
import { woodNodes } from './wood.js';

const vnoise = (p) => NZ(p).level(0).x;

// teintes par support : grains (deux tons), fibres
const LOOK = {
  drift: { grain: ['#c4bcac', '#8c8579'], fiber: '#a8a296', nG: 1100, nF: 170 },
  weathered: { grain: ['#8a857c', '#55514a'], fiber: '#aaa498', nG: 900, nF: 220 },
  char: { grain: ['#8a8580', '#121110'], fiber: '#2c2a28', nG: 700, nF: 90 },
  rot: { grain: ['#6e4c30', '#1e130b'], fiber: '#5c3c24', nG: 1400, nF: 260 },
  spalted: { grain: ['#7a6848', '#2e2a20'], fiber: '#c4a47c', nG: 800, nF: 200 },
  cedar: { grain: ['#b98a66', '#6e4430'], fiber: '#b88464', nG: 1000, nF: 120 },
};

export function createDebris(T, R, { lite = false } = {}) {
  const Wn = woodNodes(T), L = T.L;
  const look = LOOK[R.wood.pattern] ?? LOOK.drift;
  const rng = createRng(`${R.seed}:debris`);
  const zMax = Math.min(1.8, T.R * 0.8);
  const copies = [-2, -1, 0, 1, 2];
  const k = lite ? 0.5 : 1;
  const meshes = [];

  // ── grains : petites pierres bosselées, aplaties, posées ──
  {
    const n = Math.round(look.nG * k), N = n * copies.length;
    const base = new THREE.IcosahedronGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    const a0 = new Float32Array(N * 4), a1 = new Float32Array(N * 4);
    for (let i = 0; i < n; i++) {
      // (taille : surtout de la poussière, quelques grains plus gros)
      const x = rng.next() * L, z = (rng.next() * 2 - 1) * zMax, size = 0.0018 + 0.0065 * rng.next() ** 4;
      const ang = rng.next() * Math.PI * 2, rnd = rng.next(), tone = 1 - rng.next() ** 3; // (surtout le ton sombre, quelques grains clairs)
      copies.forEach((c, j) => { const o = (j * n + i) * 4; a0.set([x + c * L, z, ang, size], o); a1.set([rnd, tone, 0, 0], o); });
    }
    g.setAttribute('d0', new THREE.InstancedBufferAttribute(a0, 4));
    g.setAttribute('d1', new THREE.InstancedBufferAttribute(a1, 4));
    g.instanceCount = N;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const d0 = attribute('d0', 'vec4'), d1 = attribute('d1', 'vec4');
    const m = new THREE.MeshStandardNodeMaterial();
    const place = Fn(() => {
      const p = positionGeometry, sz = d0.w;
      const lump = vnoise(p.mul(1.8).add(vec3(d1.x.mul(37), d1.x.mul(11), 0))).mul(0.35).add(1);
      const q = vec3(p.x.mul(lump), p.y.mul(lump).mul(0.55), p.z.mul(lump).mul(0.85)).mul(sz);
      const c = cos(d0.z), s = sin(d0.z);
      const r = vec3(q.x.mul(c).sub(q.z.mul(s)), q.y, q.x.mul(s).add(q.z.mul(c)));
      const n0 = normalGeometry;
      normalLocal.assign(normalize(vec3(n0.x.mul(c).sub(n0.z.mul(s)), n0.y.mul(1.6), n0.x.mul(s).add(n0.z.mul(c)))));
      const y = Wn.height(d0.x, d0.y).add(sz.mul(0.3));
      const w = r.add(vec3(d0.x, y, d0.y));
      if (!isLite()) positionPrevious.assign(w);
      return w;
    })();
    m.positionNode = place;
    m.colorNode = mix(color(new THREE.Color(look.grain[0])), color(new THREE.Color(look.grain[1])), attribute('d1', 'vec4').y);
    m.roughnessNode = float(0.85);
    m.metalnessNode = float(0);
    m.mrtNode = stableVelocity();
    const mesh = new THREE.Mesh(g, m);
    // (pas d'ombre portée : à cette taille elle ne se voit pas, et elle coûte une passe)
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    meshes.push(mesh);
  }

  // ── fibres : brins couchés, un peu courbes, qui épousent le relief ──
  {
    const n = Math.round(look.nF * k), N = n * copies.length, SEG = 10;
    // gabarit : tube unité le long de x (−½ … ½), rayon 1, 4 faces
    const pos = [], nor = [], idx = [];
    for (let i = 0; i <= SEG; i++) for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2;
      pos.push(i / SEG - 0.5, Math.cos(a), Math.sin(a)); nor.push(0, Math.cos(a), Math.sin(a));
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < 4; j++) {
      const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + ((j + 1) % 4), d = (i + 1) * 4 + j;
      idx.push(a, b, c, a, c, d);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const a0 = new Float32Array(N * 4), a1 = new Float32Array(N * 4);
    for (let i = 0; i < n; i++) {
      const x = rng.next() * L, z = (rng.next() * 2 - 1) * zMax;
      // (le plus souvent dans le sens du fil)
      const ang = (rng.next() - 0.5) * (rng.next() < 0.7 ? 0.6 : 3.1);
      const len = 0.03 + 0.2 * rng.next() ** 2, rad = 0.0007 + 0.0012 * rng.next(), curl = (rng.next() - 0.5) * 0.8;
      copies.forEach((c, j) => { const o = (j * n + i) * 4; a0.set([x + c * L, z, ang, len], o); a1.set([rad, curl, rng.next(), 0], o); });
    }
    g.setAttribute('f0', new THREE.InstancedBufferAttribute(a0, 4));
    g.setAttribute('f1', new THREE.InstancedBufferAttribute(a1, 4));
    g.instanceCount = N;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const f0 = attribute('f0', 'vec4'), f1 = attribute('f1', 'vec4');
    const m = new THREE.MeshStandardNodeMaterial();
    m.positionNode = Fn(() => {
      const p = positionGeometry, u = p.x, len = f0.w, rad = f1.x;
      // ligne médiane courbe (parabole), tournée dans le plan du bois
      const cx = u.mul(len), cz = u.mul(u).sub(0.25).mul(f1.y).mul(len);
      const tx = len, tz = u.mul(2).mul(f1.y).mul(len);
      const c = cos(f0.z), s = sin(f0.z);
      const X = f0.x.add(cx.mul(c).sub(cz.mul(s))), Z = f0.y.add(cx.mul(s).add(cz.mul(c)));
      const tdir = normalize(vec3(tx.mul(c).sub(tz.mul(s)), 0, tx.mul(s).add(tz.mul(c))));
      const side = vec3(tdir.z.negate(), 0, tdir.x), up = vec3(0, 1, 0);
      // (les bouts se relèvent un peu : une fibre sèche ne colle pas au bois)
      const lift = u.mul(u).mul(4).mul(len).mul(0.06);
      const y = Wn.height(X, Z).add(rad.mul(0.8)).add(lift);
      normalLocal.assign(normalize(side.mul(p.z).add(up.mul(p.y))));
      const w = vec3(X, y, Z).add(side.mul(p.z.mul(rad))).add(up.mul(p.y.mul(rad)));
      if (!isLite()) positionPrevious.assign(w);
      return w;
    })();
    m.colorNode = color(new THREE.Color(look.fiber)).mul(f1.z.mul(0.5).add(0.75));
    m.roughnessNode = float(0.7);
    m.metalnessNode = float(0);
    m.mrtNode = stableVelocity();
    const mesh = new THREE.Mesh(g, m);
    // (pas d'ombre portée : à cette taille elle ne se voit pas, et elle coûte une passe)
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false;
    meshes.push(mesh);
  }
  return {
    meshes,
    dispose(group) { for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.material.dispose(); } },
  };
}
