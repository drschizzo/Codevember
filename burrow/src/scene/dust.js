// Des poussières dans les rayons de soleil. Chaque grain de poussière flotte
// autour d'une position tirée, d'une dérive lente et périodique (un nombre
// entier d'oscillations par boucle) ; il ne s'allume que dans les faisceaux
// qui passent par les portes-fenêtres (le même test que celui des ombres :
// remonter vers le soleil jusqu'au mur des fenêtres). Les positions sont
// réparties sur une période de M·L en x et recopiées autour de la caméra : la
// boucle reste exacte.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, attribute, vec2, vec3, vec4, float, sin, fract, floor, cameraViewMatrix, cameraProjectionMatrix, modelWorldMatrix,
  positionGeometry, uv, length, smoothstep, abs, mod, step,
} from 'three/tsl';
import { SHELF, WINDOW } from '../layout.js';

const N = 1400, PERIOD = SHELF.M * SHELF.L;

export function createDust() {
  const U = {
    u: uniform(0), xc: uniform(0), sun: uniform(new THREE.Vector3(-0.7, 0.4, 0.5)), sunCol: uniform(new THREE.Color(1, 1, 1)),
    shift: uniform(0), level: uniform(1),
  };
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  // par grain : base (x sur la période, y, z), phase, taille
  let s = 12345;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
  const base = new Float32Array(N * 4), ph = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    base.set([rnd() * PERIOD, 0.15 + rnd() * 3.4, 0.25 + rnd() * 2.6, 0.003 + rnd() * rnd() * 0.006], i * 4);
    ph.set([rnd(), rnd(), 1 + Math.floor(rnd() * 3), rnd() * 6.283], i * 4);
  }
  g.setAttribute('dBase', new THREE.InstancedBufferAttribute(base, 4));
  g.setAttribute('dPh', new THREE.InstancedBufferAttribute(ph, 4));
  g.instanceCount = N;

  const B = attribute('dBase', 'vec4'), P = attribute('dPh', 'vec4');
  // position monde du grain à la phase u (dérive périodique), ramenée autour de la caméra
  const world = (() => {
    const t = U.u.mul(6.283).mul(P.z);
    const x0 = B.x.add(sin(t.add(P.w)).mul(0.25));
    const rel = x0.sub(U.xc).add(PERIOD / 2);
    const x = rel.sub(floor(rel.div(PERIOD)).mul(PERIOD)).add(U.xc).sub(PERIOD / 2);
    const y = B.y.add(sin(t.mul(1).add(P.x.mul(6.283))).mul(0.12));
    const z = B.z.add(sin(t.add(P.y.mul(6.283))).mul(0.1));
    return vec3(x, y, z);
  })();
  // dans un faisceau ? (le point voit-il le soleil par une porte-fenêtre ?)
  const lit = (() => {
    const L = U.sun;
    const xw = world.x.add(float(WINDOW.Z).sub(world.z).mul(L.x.div(L.z)));
    const f = xw.sub(U.shift).div(SHELF.L).add(0.5).fract().sub(0.5).mul(SHELF.L); // (position dans le pas des fenêtres)
    return smoothstep(WINDOW.x0 - 0.05, WINDOW.x0 + 0.1, f).mul(smoothstep(WINDOW.x1 + 0.05, WINDOW.x1 - 0.1, f));
  })();
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.vertexNode = Fn(() => {
    const vp = cameraViewMatrix.mul(vec4(world, 1));
    const off = positionGeometry.xy.mul(B.w);
    return cameraProjectionMatrix.mul(vec4(vp.xy.add(off), vp.z, 1));
  })();
  m.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = smoothstep(1, 0, d).pow(2);
    return vec4(vec3(U.sunCol).mul(lit).mul(U.level).mul(a), 1);
  })();
  m.fog = false;
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return { mesh, U };
}
