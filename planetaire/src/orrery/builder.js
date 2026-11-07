// Outils d'assemblage : poser une pièce, une vis, un pilier, un arbre, un pont.
import * as THREE from 'three/webgpu';
import { turned, bridgeGeometry } from './geometry.js';

export const UP = new THREE.Vector3(0, 1, 0);
export const angTo = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
// point sur le segment v → b (plan XZ), à t·d + ext
export const at = (v, t, b, ext = 0) => {
  const d = Math.hypot(b.x - v.x, b.z - v.z), k = t + ext / d;
  return new THREE.Vector3(v.x + (b.x - v.x) * k, 0, v.z + (b.z - v.z) * k);
};
// marque une pièce animée : elle reste un objet à part (cf. batch.js)
export const dyn = (o) => { o.userData.dynamic = true; return o; };

export function createBuilder(root, mats) {
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = root) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  };
  // vis à tête bombée fendue (bleuie), posée sur une surface à la hauteur y
  const screwHead = turned([[0, 0], [1, 0], [1, 0.25], [0.85, 0.55], [0.5, 0.72], [0, 0.76]], 20);
  const slotG = new THREE.BoxGeometry(2.1, 0.5, 0.22).translate(0, 0.62, 0);
  const screw = (x, y, z, r = 0.028, parent = root, rot = Math.random() * 3) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(r); g.rotation.y = rot;
    add(screwHead, mats.blued, 0, 0, 0, g); add(slotG, mats.dark, 0, 0, 0, g); parent.add(g); return g;
  };
  // pilier tourné de y0 à y1 (embase, fût, chanfreins)
  const pillar = (x, z, y0, y1, r = 0.05, mat = mats.brass) => {
    const h = y1 - y0, c = Math.min(0.012, r * 0.25);
    return add(turned([[0, 0], [r * 1.5, 0], [r * 1.5, 0.02], [r, 0.04], [r, h - c], [r - c, h], [0, h]], 24), mat, x, y0, z);
  };
  // arbre d'acier vertical
  const arbor = (x, z, y0, y1, r = 0.018) => add(new THREE.CylinderGeometry(r, r, y1 - y0, 12).translate(0, (y1 - y0) / 2, 0), mats.steel, x, y0, z);
  // pont plat orienté de a vers b (points monde), à la hauteur y, prolongé de ext0 / ext1 ; trous [t, r]
  const bridgeAB = (a, b, y, w, thick, ext0 = 0, ext1 = 0, holes = [], mat = mats.brass) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const m = add(bridgeGeometry(d + ext0 + ext1, w, thick, holes.map(([t, r]) => [t * d + ext0, r])), mat, a.x, y, a.z);
    m.rotation.y = -angTo(a, b);
    m.translateX(-ext0);
    return m;
  };
  return { add, screw, pillar, arbor, bridgeAB };
}
