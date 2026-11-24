// La neige tassée par le vent (sastrugi) : une croûte dure, sculptée en crêtes
// allongées dans le sens du vent, à bord raide au vent et en pente douce sous
// le vent ; un grain fin de croûte ; des paillettes de givre qui scintillent
// quand elles renvoient le soleil vers l'œil. Pas de poudreuse, pas de
// translucidité visible à cette échelle : une matière que le temps réel rend
// juste (choix de l'utilisateur, docs/concept.md).
// Relief en bumpMap (quelques centimètres : l'ombre de l'objet reste lisible).
import * as THREE from 'three/webgpu';
import {
  positionWorld, vec2, vec3, float, mix, smoothstep, clamp, bumpMap, uniform, dot, normalize, pow, max, abs,
  cameraPosition, mx_fractal_noise_float, mx_noise_float, mx_cell_noise_float, normalView, transformNormalToView,
} from 'three/tsl';

export function snowMaterial({ windAz = 0.6, relief = 1 } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const U = { sun: uniform(new THREE.Vector3(0, 1, 0)), relief: uniform(relief), glint: uniform(1) };
  const p = positionWorld.xz;
  const c = Math.cos(windAz), s = Math.sin(windAz);
  const along = p.x.mul(c).add(p.y.mul(s)), across = p.x.mul(-s).add(p.y.mul(c));
  // crêtes : bruit en arêtes, étiré dans le sens du vent, déformé par un bruit lent
  const warp = mx_noise_float(vec3(along.mul(0.25), across.mul(0.25), 3.1)).mul(0.6);
  const q = vec3(along.mul(0.55), across.add(warp).mul(2.2), 0.7);
  const r1 = float(1).sub(abs(mx_noise_float(q))).pow(3);
  const r2 = float(1).sub(abs(mx_noise_float(q.mul(2.3).add(5.2)))).pow(3);
  const big = mx_fractal_noise_float(vec3(p.mul(0.18), 1.3), 3, 2, 0.5);
  const crust = mx_noise_float(vec3(p.mul(18), 9.0)).mul(0.5).add(0.5);
  const h = r1.mul(0.028).add(r2.mul(0.01)).add(big.mul(0.05)).add(crust.mul(0.0012));
  m.normalNode = bumpMap(h.mul(U.relief), 1.0);
  // un blanc à peine bleuté, un peu plus gris dans les creux (neige tassée, poussière de glace)
  m.colorNode = mix(vec3(0.80, 0.83, 0.87), vec3(0.90, 0.91, 0.93), smoothstep(0.0, 0.5, r1));
  m.roughnessNode = float(0.72).sub(crust.mul(0.08));
  m.metalnessNode = float(0);
  // paillettes : une sur ~400 cellules de 4 mm, orientée au hasard ; brille si
  // elle renvoie le soleil vers l'œil
  const cell = positionWorld.xz.mul(250);
  const pick = mx_cell_noise_float(vec3(cell, 0.5));
  const nx = mx_cell_noise_float(vec3(cell, 1.5)).sub(0.5), nz = mx_cell_noise_float(vec3(cell, 2.5)).sub(0.5);
  const facet = normalize(vec3(nx.mul(0.6), 1, nz.mul(0.6)));
  const V = normalize(cameraPosition.sub(positionWorld));
  const Hh = normalize(V.add(U.sun));
  const glint = smoothstep(0.9975, 1, pick).mul(pow(max(dot(facet, Hh), 0), 900)).mul(U.glint).mul(40);
  m.emissiveNode = vec3(glint);
  m.userData.U = U;
  return m;
}
