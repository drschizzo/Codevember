// Fusion des pièces statiques.
//
// La machine compte quelque 480 maillages ; chacun coûte un appel de rendu
// dans la passe principale et dans chaque passe d'ombre (6 faces pour la
// lumière ponctuelle de l'étoile, 1 pour la lampe). Les pièces qui ne bougent
// pas les unes par rapport aux autres sont regroupées par matériau en un seul
// maillage : dans la machine elle-même, et dans chaque sous-ensemble animé
// (balancier, ancre, barillet…), dans le repère de ce sous-ensemble.
//
// Une pièce animée est marquée userData.dynamic (cf. builder.js) : elle forme
// son propre sous-ensemble. Ne sont pas fusionnés : les maillages instanciés,
// les matériaux transparents, le tas de la trémie et les pièces exclues de
// l'assemblage (velours, faisceau).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const skip = (o) => o.userData.dynamic || o.userData.noAssemble || o.userData.isHeap;

// maillages rigidement liés à `container` (sans sous-ensemble animé entre les deux)
function rigidMeshes(container) {
  const out = [];
  const walk = (o) => {
    for (const c of o.children) {
      if (skip(c)) continue;
      if (c.isMesh && !c.isInstancedMesh && c.visible && !c.material.transparent && !Array.isArray(c.material)) out.push(c);
      walk(c);
    }
  };
  walk(container);
  return out;
}

function mergeInto(container) {
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const groups = new Map(); // matériau → maillages
  for (const m of rigidMeshes(container)) {
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(m);
  }
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    // attributs communs à toutes les pièces du groupe
    const keep = ['position', 'normal', 'uv'].filter((k) => meshes.every((m) => m.geometry.attributes[k]));
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      g.clearGroups();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    });
    const geometry = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = meshes.some((m) => m.castShadow);
    merged.receiveShadow = true;
    for (const m of meshes) m.removeFromParent();
    container.add(merged);
  }
}

export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const containers = [root];
  root.traverse((o) => { if (o.userData.dynamic && !o.isMesh) containers.push(o); });
  for (const c of containers) mergeInto(c);
}
