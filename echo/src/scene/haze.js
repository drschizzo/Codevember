// La brume de la pièce : la poussière en suspension diffuse un peu de chaque
// lumière vers l'œil. Rendue dans la chaîne d'image (shared/render/post.js,
// option haze) : on marche le long du rayon de vue jusqu'à la surface, et en
// chaque pas on ajoute la lumière de chaque source à retard, avec la même
// porte que les surfaces (scene/paths.js). C'est elle qui montre les fronts
// dans l'air : la sphère de la lampe, celle qui sort de la glace, le cône qui
// se referme sur le foyer, les pinceaux de la boule.
// (Sans ombres : la brume est assez légère pour qu'elles ne manquent pas.)
import * as THREE from 'three/webgpu';
import {
  Fn, Loop, vec2, vec3, vec4, float, uniform, screenUV, screenCoordinate, perspectiveDepthToViewZ, length, normalize, dot, min, max, fract, select,
} from 'three/tsl';
import { P, gateK, planeEcho, ellipseEcho, facetEcho, galleryEcho } from './paths.js';

export const HZ = { projInv: uniform(new THREE.Matrix4()), camWorld: uniform(new THREE.Matrix4()), near: uniform(0.05), far: uniform(80) };

// fonction de phase de Henyey-Greenstein (g > 0 : diffusion vers l'avant)
const hg = (c, g) => float((1 - g * g) / (4 * Math.PI)).div(float(1 + g * g).sub(c.mul(2 * g)).pow(1.5));

export function createHaze() {
  return (depthTex, lite) => Fn(() => {
    const N = lite ? 8 : 22;
    const dz = depthTex.sample(screenUV).r;
    // (dans une passe plein écran, les nœuds « caméra » désignent la caméra du
    // quad, et getViewPosition suppose une profondeur OpenGL : la caméra de la
    // scène arrive par des uniformes, la distance par perspectiveDepthToViewZ)
    const ndc = vec2(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1));
    const fp = HZ.projInv.mul(vec4(ndc, 1, 1));
    const vdir = normalize(fp.xyz.div(fp.w));
    const rd = normalize(HZ.camWorld.mul(vec4(vdir, 0)).xyz);
    const tScene = perspectiveDepthToViewZ(dz, HZ.near, HZ.far).div(vdir.z);
    const ro = P.eye, tMax = min(tScene, 4.0);
    const j = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(P.frame.mul(0.618034)));
    const acc = vec3(0).toVar();
    // (une source absente a des uniformes nuls : ses termes donneraient NaN,
    // et NaN × 0 reste NaN ; on ne les évalue pas du tout)
    const on = (c) => dot(c, vec3(1)).greaterThan(0);
    const keep = (c, term) => select(on(c), term, vec3(0));
    Loop(N, ({ i }) => {
      const t = float(i).add(j).div(N).mul(tMax);
      const p = ro.add(rd.mul(t)).toVar();
      const D = t; // (distance à l'œil)
      // la lampe
      {
        const v = p.sub(P.lamp), r2 = dot(v, v).max(0.02);
        acc.addAssign(P.cLamp.mul(gateK(length(v).add(D))).mul(hg(dot(normalize(v), rd.negate()).negate(), 0.35)).div(r2));
      }
      // la glace
      {
        const e = planeEcho(p);
        const v = p.sub(P.msv), r2 = dot(v, v);
        acc.addAssign(keep(P.cMirror, P.cMirror.mul(e.w).mul(gateK(e.L.add(D))).mul(hg(dot(normalize(v), rd), 0.35)).div(r2)));
      }
      // le foyer
      {
        const e = ellipseEcho(p);
        const r2 = e.dist.mul(e.dist).max(P.efMin.mul(P.efMin));
        const L = e.Lb.mul(e.before).add(e.La.mul(e.after));
        const dir = e.dirB.mul(e.before).add(e.dirA.mul(e.after)); // (vers la source)
        acc.addAssign(keep(P.cFocus, P.cFocus.mul(e.before.add(e.after).min(1)).mul(gateK(L.add(D))).mul(hg(dot(dir, rd.negate()).negate(), 0.35)).div(r2)));
      }
      // les facettes
      {
        const e = facetEcho(p);
        const v = p.sub(e.sv), r2 = dot(v, v).max(1e-3);
        acc.addAssign(keep(P.cFacet, P.cFacet.mul(e.w).mul(gateK(e.L.add(D))).mul(hg(dot(normalize(v), rd), 0.35)).div(r2)));
      }
      // la galerie (les échos au-delà du premier ; isotrope, sans phase)
      {
        const e = galleryEcho(p, P.eye, { skipA1: true });
        acc.addAssign(keep(P.cGallery, P.cGallery.mul(e.w).mul(0.08)));
      }
    });
    return acc.mul(P.haze).mul(tMax.div(N));
  })();
}
