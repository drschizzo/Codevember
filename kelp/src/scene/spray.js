// Les embruns : là où la vague casse, des gouttes partent de la crête.
//
// Rien n'est simulé au démarrage : la mer donne, par profil du faisceau et
// par image, l'endroit et la force du déferlement (gen/sea.js, BRK : x de la
// crête, intensité, vitesse de l'eau, hauteur). Chaque goutte (en fait une
// grappe de gouttes) est un quadrilatère face à la caméra, qui vit par
// cycles : à chaque cycle, elle tire une place le long de la côte, lit le
// déferlement à cet instant, part de la crête avec la
// vitesse de l'eau plus un jet vers le haut, et suit une trajectoire
// balistique freinée par l'air (forme exacte, pas d'intégration). La durée
// d'un cycle divise la boucle : tout est périodique.
//
// Les gouttes éclairées à contre-jour s'allument (diffusion de Mie vers
// l'avant) ; sous l'eau, elles disparaissent ; près du dôme, rien.
import * as THREE from 'three/webgpu';
import { Fn, attribute, float, vec2, vec3, vec4, fract, floor, exp, mix, smoothstep, uniform, length, max, positionWorld, cameraPosition, cameraWorldMatrix, normalize, dot, select, mrt, hash, varying } from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export function createSpray(W, lite) {
  const { U } = W;
  const N = lite ? 2500 : 8000;
  const SU = { cycles: uniform(24), size: uniform(1), gain: uniform(1) }; // (nombre de cycles par boucle : la durée d'un cycle est T / cycles)

  // (hachage entier : fract(sin(…)) perd sa précision en float32 sur des
  // milliers d'indices et groupait les gouttes en quelques grappes)
  // (chaque goutte : quatre sommets, son numéro et son coin)
  const pid = attribute('pid', 'vec4'); // (numéro, coin x, coin y, —)
  const h = (k, c) => hash(pid.x.toUint().add(c.toUint().mul(9973)).add(Math.round(k * 2) * 104729));
  const g = 9.81;

  const state = () => {
    const Lc = U.T.div(SU.cycles);
    const cyc = U.t.div(Lc).add(h(0.5, float(0)));
    const c0 = floor(cyc), age = fract(cyc).mul(Lc);
    const c = c0.sub(floor(c0.div(SU.cycles)).mul(SU.cycles)); // (le cycle, replié sur la boucle)
    const tb = U.t.sub(age);
    // la place le long de la côte, et le déferlement à cet instant
    const z = U.bz0.add(h(1, c).mul(U.bnz.sub(1).mul(U.bdz)));
    const bk = W.breaking(z, W.localT(z, tb));
    const I = bk.y;
    // (plus la vague casse fort, plus il y a de gouttes, et plus elles montent)
    const born = select(h(2, c).lessThan(smoothstep(1.2, 10, I)), float(1), float(0));
    const life = Lc.mul(h(3, c).mul(0.55).add(0.45));
    const a = age.div(life);
    const x0 = bk.x.add(h(4, c).sub(0.5).mul(0.3));
    const y0 = bk.w.add(0.015);
    const up = h(6, c).pow(2).mul(2.8).add(0.6).mul(smoothstep(2, 16, I).mul(0.7).add(0.3));
    const v = vec3(bk.z.mul(0.7).add(h(5, c).sub(0.5).mul(1.4)), up, h(7, c).sub(0.5).mul(1.0));
    const k = h(8, c).mul(2.5).add(1.0); // (traînée : les petites gouttes freinent plus)
    const e = float(1).sub(exp(age.mul(k).negate())).div(k);
    // (chute freinée : y = y0 + (v + g/k)(1 − e^{−kτ})/k − gτ/k)
    const gk = float(g).div(k);
    const p = vec3(x0.add(v.x.mul(e)), y0.add(v.y.add(gk).mul(e)).sub(age.mul(gk)), z.add(v.z.mul(e)));
    // (la vitesse à cet âge : pour étirer la grappe dans le sens où elle vole)
    const ek = exp(age.mul(k).negate());
    const vel = vec3(v.x.mul(ek), v.y.add(gk).mul(ek).sub(gk), v.z.mul(ek));
    return { p, a, born, I, c, vel };
  };

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.DoubleSide;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const S = state();
  // (petites gouttes et quelques bouffées de brume, qui s'étalent en vieillissant)
  const big = smoothstep(0.85, 1.0, h(9, S.c));
  // (un quadrilatère est une grappe de gouttes, pas une goutte : à 4 m, une goutte
  // de 3 mm tient dans un pixel)
  const size = mix(float(0.03).add(h(10, S.c).mul(0.04)), float(0.16), big).mul(S.a.mul(1.5).add(1)).mul(SU.size);
  // face à la caméra : les axes de l'écran, dans le repère du monde
  const right = cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, upv = cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz;
  // (étirée dans le sens où elle vole, à l'écran : le filé d'une pose de
  // 1/50 s — un disque immobile se lisait comme une tache)
  const sv = vec2(dot(S.vel, right), dot(S.vel, upv)), sl = sv.length().max(1e-3), ax = sv.div(sl), ay = vec2(ax.y.negate(), ax.x);
  const stretch = sl.mul(0.02).div(size).add(1).min(4).mul(big.oneMinus()).add(big);
  const off = vec2(ax.mul(pid.y.mul(stretch))).add(ay.mul(pid.z)).mul(size);
  mat.positionNode = S.p.add(right.mul(off.x)).add(upv.mul(off.y));
  const corner = varying(vec2(pid.y, pid.z));
  // (les états d'une goutte, transmis au fragment)
  const vA = varying(S.a), vBorn = varying(S.born), vBig = varying(big), vSd = varying(h(11, S.c));
  const out = Fn(() => {
    const P = positionWorld, C = cameraPosition;
    // une grappe de gouttelettes de tailles diverses, pas un disque ; la brume,
    // une bouffée au contour bruité
    const sd = vSd.mul(57.3);
    const d = length(corner).mul(2);
    const env = smoothstep(1, 0.35, d.add(NZ(vec3(corner.mul(2.5), sd)).x.mul(0.45)));
    const drops = smoothstep(0.2, 0.05, NZ(vec3(corner.mul(7), sd.add(3.1))).z).add(smoothstep(0.12, 0.02, NZ(vec3(corner.mul(15), sd.add(9.7))).z).mul(0.8)).min(1);
    const mist = smoothstep(0.0, 0.6, NZ(vec3(corner.mul(3), sd.add(1.7))).x.mul(0.5).add(0.45)).mul(env);
    const disc = mix(env.mul(drops.mul(0.85).add(0.15)), mist, vBig);
    const alive = vA.lessThan(1).and(vA.greaterThan(0));
    const fade = smoothstep(0, 0.06, vA).mul(float(1).sub(smoothstep(0.55, 1, vA)));
    const above = smoothstep(-0.005, 0.02, P.y.sub(W.level(P.x, P.z, U.t)));
    const near = smoothstep(0.25, 0.6, length(P.sub(C)));
    const al = select(alive, float(1), float(0)).mul(vBorn).mul(fade).mul(above).mul(near).mul(disc).mul(mix(float(0.9), float(0.16), vBig)).mul(SU.gain).min(1);
    // Mie vers l'avant : à contre-jour, les gouttes s'allument
    const vdir = normalize(P.sub(C));
    const mie = dot(vdir, vec3(U.sunDir)).max(0).pow(8).mul(3).add(0.25);
    // (de l'eau blanche : éclairée comme l'écume, plus la diffusion vers l'avant)
    const rgb = vec3(U.sunE).mul(max(U.sunDir.y, 0.0).mul(0.7).add(mie.mul(0.25))).add(vec3(U.skyE).mul(1.1));
    return vec4(rgb.mul(al), al);
  });
  mat.outputNode = out();
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(0) });

  const pidA = new Float32Array(N * 16), idx = new Uint32Array(N * 6);
  const cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let q = 0; q < N; q++) {
    for (let k = 0; k < 4; k++) { const o = (q * 4 + k) * 4; pidA[o] = q; pidA[o + 1] = cs[k][0]; pidA[o + 2] = cs[k][1]; }
    const b = q * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 12), 3));
  geo.setAttribute('pid', new THREE.BufferAttribute(pidA, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;

  function setData(T) {
    SU.cycles.value = Math.max(1, Math.round(T / 1.3));
    mesh.visible = W.U.bOn.value > 0;
  }
  return { mesh, setData, SU };
}
