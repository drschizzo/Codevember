// La vie du platier à l'écran : balanes, patelles, moules (gen/scene.js,
// faunaGeometry). Un seul maillage ; l'espèce est dans l'attribut surf.
//  - balane : plâtre blanc cassé, crayeux, l'orifice sombre au sommet ;
//  - patelle : gris brun, côtes rayonnantes plus claires, usée au sommet ;
//  - moule : bleu-noir, lisse et brillante, stries de croissance.
// Mouillées : plus sombres et brillantes, comme la roche (enveloppe de séchage).
import * as THREE from 'three/webgpu';
import { attribute, vec3, float, mix, smoothstep, positionWorld, max, select } from 'three/tsl';
import { fbm, NZ } from './materials.js';

export function createFauna(W) {
  const { U } = W;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = true; mesh.receiveShadow = true;

  function makeMat() {
    const mat = new THREE.MeshStandardNodeMaterial();
    const s = attribute('surf', 'vec4'), P = positionWorld;
    const bar = s.x, lim = s.y, mus = s.z, pc = s.w;
    const n1 = fbm(P.mul(140), 2), n2 = NZ(P.mul(600)).x;
    // balane : plâtre, l'orifice sombre au sommet (le haut de la coque)
    const top = smoothstep(0.004, 0.0075, P.y.sub(W.rockAt(P.x, P.z)));
    const cBar = mix(vec3(0.62, 0.6, 0.55), vec3(0.42, 0.4, 0.36), n1.mul(0.5).add(0.5)).mul(float(1).sub(top.mul(0.75)));
    // patelle : côtes claires sur fond gris brun
    const cLim = mix(vec3(0.2, 0.18, 0.15), vec3(0.42, 0.39, 0.33), smoothstep(0.1, 0.6, n2).mul(0.6).add(n1.mul(0.3)));
    // moule : bleu-noir, un reflet violacé
    const cMus = vec3(0.025, 0.028, 0.04).mul(n1.mul(0.25).add(1));
    const tint = pc.mul(0.25).add(0.88);
    const base = cBar.mul(bar).add(cLim.mul(lim)).add(cMus.mul(mus)).mul(tint);
    const lv = W.levelNear(P.x, P.z, U.t), H = W.rockAt(P.x, P.z);
    const wet = max(smoothstep(-0.004, 0.006, W.wetLevel(P.x, P.z, U.t, H).sub(H)), smoothstep(-0.002, 0.004, lv.sub(P.y)));
    mat.colorNode = mix(base, base.pow(1.35).mul(0.7), wet);
    const rough = bar.mul(0.85).add(lim.mul(0.6)).add(mus.mul(0.32));
    mat.roughnessNode = mix(rough, rough.mul(0.45), wet.mul(select(mus.greaterThan(0.5), float(1), float(0.7))));
    mat.metalnessNode = float(0);
    mat.receivedShadowNode = W.receivedShadow;
    return mat;
  }

  function setData(F) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(F.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(F.normal, 3));
    g.setAttribute('surf', new THREE.BufferAttribute(F.surf, 4, true));
    g.setIndex(new THREE.BufferAttribute(F.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    mesh.geometry.dispose(); mesh.geometry = g;
    // (un matériau neuf avec la géométrie neuve : voir three-tsl-pitfalls)
    mesh.material?.dispose?.(); mesh.material = makeMat();
    mesh.visible = F.position.length > 0;
  }
  return { mesh, setData };
}
