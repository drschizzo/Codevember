// Les lumières à retard. Chaque classe est une lumière de three.js dont le nœud
// multiplie la couleur, au point éclairé, par la part du front qui y est
// arrivée (scene/paths.js) ; les échos qui ne sont pas une source ponctuelle
// (le foyer d'un miroir elliptique, les facettes d'une boule) récrivent toute
// la direction et l'atténuation.
//
// - GatedLight (PointLight) : la lampe elle-même (L = |x − s|) et les rebonds
//   diffus (L = |v − s| + |x − v|, v la source secondaire).
// - MirrorLight (SpotLight) : la source image s′ derrière la glace, visée sur
//   la glace, avec ses ombres ; ouverture : le contour de la glace.
// - FocusLight : l'écho d'un miroir elliptique, qui converge sur f₂ puis en
//   repart ; intensité d'une source ponctuelle en f₂, bornée près du foyer
//   (l'ampoule n'est pas un point : son image a la taille du filament).
// - FacetLight : les pinceaux de la boule, un par facette.
import * as THREE from 'three/webgpu';
import { uniform, positionWorld, length, normalize, vec3, vec4, max, cameraViewMatrix, float } from 'three/tsl';
import { P, gate, planeEcho, ellipseEcho, facetEcho, galleryEcho } from './paths.js';

export class GatedLight extends THREE.PointLight {
  constructor(...a) { super(...a); this.gPos = uniform(new THREE.Vector3()); this.gOff = uniform(0); }
}
export class GatedLightNode extends THREE.PointLightNode {
  static get type() { return 'GatedLightNode'; }
  setupDirect(builder) {
    const d = super.setupDirect(builder);
    const x = positionWorld, l = this.light;
    d.lightColor = d.lightColor.mul(gate(l.gOff.add(length(x.sub(l.gPos))), x));
    return d;
  }
}

export class MirrorLight extends THREE.SpotLight {}
export class MirrorLightNode extends THREE.SpotLightNode {
  static get type() { return 'MirrorLightNode'; }
  setupDirect(builder) {
    const d = super.setupDirect(builder);
    const x = positionWorld;
    const e = planeEcho(x);
    d.lightColor = d.lightColor.mul(e.w).mul(gate(e.L, x));
    return d;
  }
}

const toView = (dirW) => normalize(cameraViewMatrix.mul(vec4(dirW, 0)).xyz);

export class FocusLight extends THREE.PointLight {}
export class FocusLightNode extends THREE.PointLightNode {
  static get type() { return 'FocusLightNode'; }
  setupDirect() {
    const x = positionWorld;
    const e = ellipseEcho(x);
    const dirW = e.dirB.mul(e.before).add(e.dirA.mul(e.after));
    const L = e.Lb.mul(e.before).add(e.La.mul(e.after));
    const att = float(1).div(max(e.dist.mul(e.dist), P.efMin.mul(P.efMin)));
    const lightColor = this.colorNode.mul(att).mul(e.before.add(e.after).min(1)).mul(gate(L, x));
    return { lightColor, lightDirection: toView(dirW) };
  }
}

export class FacetLight extends THREE.PointLight {}
export class FacetLightNode extends THREE.PointLightNode {
  static get type() { return 'FacetLightNode'; }
  setupDirect() {
    const x = positionWorld;
    const e = facetEcho(x);
    const r = length(x.sub(e.sv));
    const lightColor = this.colorNode.div(r.mul(r).max(1e-4)).mul(e.w).mul(gate(e.L, x));
    return { lightColor, lightDirection: toView(normalize(e.hit.sub(x))) };
  }
}

// Les échos de la galerie (deux glaces face à face) : toutes les images sauf
// la première de la glace du mur, que MirrorLight porte avec ses ombres
export class GalleryLight extends THREE.PointLight {}
export class GalleryLightNode extends THREE.PointLightNode {
  static get type() { return 'GalleryLightNode'; }
  setupDirect() {
    const e = galleryEcho(positionWorld, undefined, { skipA1: true });
    return { lightColor: this.colorNode.mul(e.w), lightDirection: toView(normalize(e.dir.add(vec3(0, 1e-6, 0)))) };
  }
}

export function registerLights(renderer) {
  const lib = renderer?.library;
  if (!lib) return;
  lib.addLight(GatedLightNode, GatedLight);
  lib.addLight(MirrorLightNode, MirrorLight);
  lib.addLight(FocusLightNode, FocusLight);
  lib.addLight(FacetLightNode, FacetLight);
  lib.addLight(GalleryLightNode, GalleryLight);
}
