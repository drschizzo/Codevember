// Les pièces en vol (assemblage, démontage) : la pose de chaque pièce est
// calculée sur le processeur (src/gen/assembly.js, poseAt) et passée au vertex
// shader dans deux tableaux d'uniformes (pose à cette image, pose à l'image
// précédente : vecteurs vitesse de l'anticrénelage temporel). Chaque sommet sait
// le milieu de sa pièce à sa place et son numéro (attribut pc).
//   x' = c + q·(x − c_f)·q⁻¹, normale et tangente tournées de même.
import { Fn, attribute, uniformArray, int, vec3, positionGeometry, normalLocal, tangentLocal, positionPrevious, cross } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { poseAt, flightAt } from '../gen/assembly.js';

const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));

export function createMotion(n) {
  const mk = () => Array.from({ length: n * 2 }, (_, i) => new THREE.Vector4(0, 0, 0, i % 2 ? 1 : 0));
  const now = uniformArray(mk(), 'vec4'), prev = uniformArray(mk(), 'vec4');
  const node = (full) => Fn(() => {
    const pc = attribute('pc', 'vec4');
    const i = int(pc.w).mul(2);
    const rel = positionGeometry.sub(pc.xyz);
    const c = now.element(i).xyz, q = now.element(i.add(1));
    if (full) {
      normalLocal.assign(qrot(q, normalLocal));
      tangentLocal.assign(qrot(q, tangentLocal));
      positionPrevious.assign(prev.element(i).xyz.add(qrot(prev.element(i.add(1)), rel)));
    }
    return c.add(qrot(q, rel));
  })();
  const fill = (arr, plan, u, timing) => {
    for (let k = 0; k < plan.length; k++) {
      const P = poseAt(plan[k], flightAt(u, plan[k].k, plan.length, timing));
      arr.array[2 * k].set(P.c[0], P.c[1], P.c[2], 0);
      arr.array[2 * k + 1].set(P.q[0], P.q[1], P.q[2], P.q[3]);
    }
  };
  return {
    attach(m) { m.positionNode = node(true); m.castShadowPositionNode = node(false); },
    update(plan, u, uPrev, timing) { fill(now, plan, u, timing); fill(prev, plan, uPrev, timing); },
  };
}
