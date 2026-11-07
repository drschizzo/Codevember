// Fond d'étoiles, éteint par le disque de poussière qui passe devant.
import * as THREE from 'three/webgpu';
import { instanceIndex, instancedArray, float, vec3, vec4, length, exp, mix, uv, smoothstep, varying, hash, normalize, select, pow, abs, cameraPosition } from 'three/tsl';
import { R_IN, R_OUT } from '../sim.js';
import { additive } from './common.js';

export function createSky(V, count = 6000) {
  const sb = instancedArray(count, 'vec4');
  const a = sb.value.array;
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    a.set([s * Math.cos(th) * 300, u * 300, s * Math.sin(th) * 300, Math.random() ** 6], i * 4);
  }
  const mat = new THREE.SpriteNodeMaterial(additive());
  const S = sb.element(instanceIndex);
  mat.positionNode = S.xyz;
  // Le disque est opaque à la lumière des étoiles du fond : on calcule où le
  // rayon caméra → étoile traverse le plan du disque et on l'éteint selon la
  // densité de surface de la poussière à cet endroit (et l'obliquité).
  const dir = normalize(S.xyz.sub(cameraPosition));
  const tCross = cameraPosition.y.negate().div(dir.y);
  const hit = cameraPosition.add(dir.mul(tCross));
  const Rh = length(hit.xz);
  const sigma = smoothstep(R_OUT * 1.15, R_OUT * 0.75, Rh).mul(smoothstep(R_IN * 0.6, R_IN * 1.2, Rh)).div(pow(Rh.max(0.3), 0.8));
  const depth = select(tCross.greaterThan(0.0), sigma.mul(V.dustK).mul(5.0).div(abs(dir.y).add(0.03)), float(0.0));
  const extinct = varying(exp(depth.negate()));
  const shape = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
  // la plupart à peine visibles, quelques-unes brillantes
  mat.colorNode = vec4(mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.7), hash(instanceIndex)).mul(S.w.mul(1.2).add(0.05)).mul(extinct), shape);
  mat.scaleNode = float(0.5).add(S.w.mul(1.2));
  const stars = new THREE.Sprite(mat);
  stars.count = count;
  stars.frustumCulled = false;
  return stars;
}
