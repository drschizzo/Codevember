// Particules : quadrilatères orientés (traînées ou bouffées), un maillage et
// un shader par système. Leurs positions sont calculées sur le processeur à
// chaque image comme des fonctions pures de la phase (naissance quantifiée par
// particule, mouvement balistique en forme fermée) : la boucle se referme,
// l'export image par image rend la même chose.
//
//  - traînée (streak) : quad étiré le long de la vitesse (flou de bougé d'un
//    obturateur), face à la caméra autour de son axe — pluie, étincelles,
//    grenaille, gouttes ;
//  - bouffée (puff) : quad face à la caméra, disque doux — poussière,
//    éclaboussures, bulles.
import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, vec3, vec4, float, uv, normalize, cross, length, smoothstep, mix, uniform, color, max, clamp, mrt } from 'three/tsl';
import { isLite } from './materials.js';

export function createParticles(scene, { max: N, kind = 'streak', blend = 'add', tint = '#ffffff' }) {
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  g.index = quad.index;
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setAttribute('normal', quad.attributes.normal);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iDir = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const iPar = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('iPos', iPos); g.setAttribute('iDir', iDir); g.setAttribute('iPar', iPar);
  g.instanceCount = 0;

  const U = { color: uniform(new THREE.Color(tint)), gain: uniform(1) };
  const m = new THREE.MeshBasicNodeMaterial();
  m.transparent = true; m.depthWrite = false;
  m.blending = blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending;
  const P = attribute('iPos', 'vec3'), D = attribute('iDir', 'vec3'), par = attribute('iPar', 'vec4');
  const t = uv();
  const toCam = normalize(cameraPosition.sub(P));
  if (kind === 'streak') {
    const len = max(length(D), 1e-5), ax = D.div(len);
    const side = normalize(cross(ax, toCam));
    m.positionNode = P.add(D.mul(t.y.sub(0.5))).add(side.mul(par.x.mul(t.x.sub(0.5))));
    // (profil doux en travers, extrémités atténuées)
    const across = smoothstep(0.5, 0.15, t.x.sub(0.5).abs()), along = smoothstep(0, 0.25, t.y).mul(smoothstep(1, 0.6, t.y));
    const a = across.mul(along).mul(par.y);
    m.colorNode = vec3(U.color).mul(par.z).mul(U.gain);
    m.opacityNode = a;
  } else {
    const side = normalize(cross(vec3(0, 1, 0), toCam)), up = cross(toCam, side);
    m.positionNode = P.add(side.mul(par.x.mul(t.x.sub(0.5)))).add(up.mul(par.x.mul(t.y.sub(0.5))));
    const r = length(t.sub(0.5)).mul(2);
    // par.w > 0.5 : anneau (bulle, couronne d'éclaboussure) ; sinon disque doux
    const disc = smoothstep(1, 0.1, r).pow(1.5);
    const ring = smoothstep(1, 0.8, r).mul(smoothstep(0.55, 0.8, r));
    const a = mix(disc, ring, smoothstep(0.4, 0.6, par.w)).mul(par.y);
    m.colorNode = vec3(U.color).mul(par.z).mul(U.gain);
    m.opacityNode = a;
  }
  // (les particules ne touchent ni aux vitesses ni à la réflectance : sorties
  // à alpha nul, donc laissées telles quelles par le mélange. Sans cela, leurs
  // quads écrivaient des vitesses que le flou de bougé et l'anticrénelage
  // temporel étiraient en rectangles fantômes)
  if (!isLite()) m.mrtNode = mrt({ velocity: vec4(0), refl: vec4(0) });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);
  let n = 0;
  return {
    mesh, U,
    begin() { n = 0; },
    // p : position ; d : traînée (vecteur monde) ou 0 ; w : largeur ; a : opacité ; b : éclat ; k : forme
    push(px, py, pz, dx, dy, dz, w, a, b, k = 0) {
      if (n >= N) return;
      iPos.array[n * 3] = px; iPos.array[n * 3 + 1] = py; iPos.array[n * 3 + 2] = pz;
      iDir.array[n * 3] = dx; iDir.array[n * 3 + 1] = dy; iDir.array[n * 3 + 2] = dz;
      iPar.array[n * 4] = w; iPar.array[n * 4 + 1] = a; iPar.array[n * 4 + 2] = b; iPar.array[n * 4 + 3] = k;
      n++;
    },
    end() {
      g.instanceCount = n;
      for (const a of [iPos, iDir, iPar]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
      mesh.visible = n > 0;
    },
    count: () => n,
  };
}

// hachage déterministe [0, 1) d'un entier et d'un sel
export const hash = (i, s = 0) => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s + 0x632be5ab, 0xc2b2ae35); x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15; return (x >>> 0) / 4294967296; };
