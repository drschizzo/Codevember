// L'éclair à l'écran : chaque segment de l'arbre est un quad face à la caméra
// (une capsule de lumière : cœur blanc très fin, halo bleuté), additif. Sa
// luminosité est une fonction pure de deux nombres du film — l'avancement du
// traceur a et le temps τ écoulé depuis la jonction — et de ce que le segment
// sait de lui-même : son instant de naissance tb, sa distance au sol s le
// long du canal, les arcs dont il fait partie (mask), sa grosseur w.
//
//   traceur (τ < 0)   : né si tb ≤ a ; canal violet pâle, pointe blanche qui s'éteint en quelques bonds
//   arc en retour j   : l'onde atteint le segment à t_j + s / v ; impulsion (film.js : pulse)
//   traceur de réamorçage : il redescend le canal juste avant t_j
//   branches          : elles s'allument au passage de la première onde, et meurent
//   rémanence         : après le dernier arc, le canal se défait en perles
import * as THREE from 'three/webgpu';
import { attribute, uniform, uniformArray, uv, vec3, vec4, float, cameraPosition, normalize, cross, length, mix, exp, floor, mod, step, smoothstep, cos, varying, mrt, max as tMax, min as tMin, sqrt } from 'three/tsl';
import { PHYS } from '../film.js';

export const MAX_STROKES = 6;

export function createLightning(scene, { lite = false } = {}) {
  const U = {
    a: uniform(-1), tau: uniform(-1), last: uniform(0),
    strokes: uniformArray(Array.from({ length: MAX_STROKES }, () => new THREE.Vector4(0, 0, 0, 1)), 'vec4'), // t, amplitude, bit du canal, longueur du canal
    width: uniform(0.012), pixel: uniform(0.001), gain: uniform(1),
    core: uniform(new THREE.Color('#ffffff')), halo: uniform(new THREE.Color('#9db8ff')), leader: uniform(new THREE.Color('#b8a4ff')),
    cloudY: uniform(9), // (au-dessus de la base du nuage, le canal est dans le nuage : c'est le nuage qui le montre)
  };
  const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), iC = attribute('iC', 'vec4');
  const A = iA.xyz, Bp = iB.xyz, tb = iA.w, s = iB.w, mask = iC.x, w = iC.y, rnd = iC.z;
  const pulse = (x) => { const y = x.max(0); return step(0, x).mul(tMin(y.div(0.012), 1)).mul(exp(y.div(-PHYS.tauFast)).mul(0.72).add(exp(y.div(-PHYS.tauSlow)).mul(0.28))); };
  const bit = (m, b) => mod(floor(m.div(b)), 2); // b = 2^j

  // intensité (x) et « blancheur de pointe » (y), calculées au sommet
  const born = step(tb, U.a);
  const tip = exp(U.a.sub(tb).max(0).div(-0.022)).mul(born);
  const lead = born.mul(float(0.085).mul(w.mul(0.6).add(0.4)).add(tip.mul(1.5)));
  let ret = float(0), dartG = float(0), mine = float(0);
  for (let j = 0; j < MAX_STROKES; j++) {
    const S = U.strokes.element(j);
    const on = bit(mask, S.z).mul(step(0.001, S.y));
    mine = tMax(mine, on);
    ret = ret.add(on.mul(S.y).mul(pulse(U.tau.sub(S.x).sub(s.div(PHYS.wave)))));
    if (j > 0) {
      // traceur de réamorçage : il descend du haut du canal (s = longueur) au sol en PHYS.dart
      const td = S.x.sub(float(PHYS.dart).mul(s.div(S.w.max(0.01)).clamp(0, 1)));
      const x = U.tau.sub(td);
      dartG = dartG.add(on.mul(S.y).mul(0.3).mul(step(0, x)).mul(exp(x.max(0).div(-0.035))));
    }
  }
  // branches : touchées par la première onde seulement
  const xb = U.tau.sub(s.div(PHYS.wave));
  const branch = mine.oneMinus().mul(step(tb, 1.2)).mul(w).mul(0.55).mul(step(0, xb)).mul(tMin(xb.max(0).div(0.012), 1)).mul(exp(xb.max(0).div(-PHYS.tauBranch)));
  // avant que l'onde ne l'atteigne, le traceur garde sa lueur ; après, elle retombe
  const after = step(0, xb);
  const leaderGlow = lead.mul(mix(1, exp(xb.max(0).div(-0.05)), after));
  // rémanence en perles
  const beads = mix(1, cos(s.mul(46).add(rnd.mul(6.283))).mul(0.5).add(0.5).pow(3).mul(2.4), smoothstep(0.15, 0.7, U.tau.sub(U.last)));
  const I = leaderGlow.add(ret.mul(beads).mul(2.6)).add(dartG).add(branch);
  const hidden = smoothstep(U.cloudY.add(0.03), U.cloudY.sub(0.02), tMin(A.y, Bp.y));
  const vI = varying(vec3(I.mul(hidden), tip.mul(step(U.tau, 0)).add(ret.add(dartG).clamp(0, 1)), 0), 'vBolt');

  // géométrie du quad
  const t = uv();
  const dir = Bp.sub(A), len = length(dir).max(1e-6), ax = dir.div(len);
  const mid = A.add(dir.mul(0.5));
  const toCam = cameraPosition.sub(mid), dist = length(toCam);
  const side = normalize(cross(ax, toCam.div(dist)));
  // demi-largeur : celle du canal, jamais sous le pixel ; elle gonfle avec le courant
  const hw = tMax(U.width.mul(w.mul(0.6).add(0.4)).mul(I.clamp(0, 2.6).mul(0.55).add(0.6)), U.pixel.mul(dist));
  const K = 3.2; // (le quad déborde du cœur : place du halo)
  const along = t.y.mul(len.add(hw.mul(2 * K))).sub(hw.mul(K));
  const pos = A.add(ax.mul(along)).add(side.mul(t.x.sub(0.5).mul(2 * K).mul(hw)));
  const vL = varying(vec3(along.div(hw), len.div(hw), 0), 'vBoltL');

  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.positionNode = pos;
  const lx = t.x.sub(0.5).mul(2 * K);
  const dy = tMax(tMax(vL.x.negate(), vL.x.sub(vL.y)), 0);
  const d = sqrt(lx.mul(lx).add(dy.mul(dy)));
  const coreP = exp(d.div(0.42).pow2().negate()), haloP = exp(d.div(1.45).pow2().negate());
  const white = vI.y.clamp(0, 1);
  const c = mix(U.leader, U.core, white).mul(coreP).add(mix(U.leader, U.halo, white).mul(haloP).mul(0.16));
  m.colorNode = c.mul(vI.x).mul(U.gain);
  if (!lite) m.mrtNode = mrt({ velocity: vec4(0), refl: vec4(0) });

  const quad = new THREE.PlaneGeometry(1, 1);
  let mesh = null;
  function setSegments(seg) {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    const n = seg.length / 12;
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    g.setAttribute('normal', quad.attributes.normal);
    const ib = new THREE.InstancedInterleavedBuffer(seg, 12);
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    g.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    g.setAttribute('iC', new THREE.InterleavedBufferAttribute(ib, 4, 8));
    g.instanceCount = n;
    mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    scene.add(mesh);
  }
  return { U, material: m, setSegments, get mesh() { return mesh; } };
}
