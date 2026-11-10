// Sonde de pièce : ce que voit le centre de la pièce où l'on se tient.
//
// Un objet exposé est enfermé entre six murs, et c'est d'eux qu'il tient sa
// lumière indirecte : une perle prend le rouge d'une pièce de laque, un bronze
// reflète le marbre d'en face. Le studio HDR, lui, n'existe plus dans
// l'hypersphère. La sonde est une petite carte cubique, rendue depuis le
// centre de la pièce (l'objet y est : pas de parallaxe), une face toutes les deux images.
// Ses niveaux de mipmap servent de flou :
//  - le plus bas, lu dans la direction de la normale, est l'éclairement diffus
//    (la couleur des murs sur l'objet, et d'un mur sur le mur d'en face) ;
//  - les autres, lus dans la direction du reflet selon la rugosité, sont le
//    reflet de la pièce sur les métaux, les vernis et les cristaux.
//
// Elle ne voit pas les vrais matériaux des parois (leur passe MRT ne se rend
// pas dans une cible simple, et leur détail serait perdu à cette taille) mais
// des doublures : mêmes maillages, même projection 4D, même ajourage, une
// couleur unie par face (externe, interne, tranche), éclairage de Lambert par
// les lumières de la cellule (dont le projecteur et son ombre). Ces doublures
// vivent sur le calque 1, que seule la sonde regarde. Un seul rebond : les
// doublures ne lisent pas la sonde.
import * as THREE from 'three/webgpu';
import {
  cubeTexture, uniform, vec3, vec4, float, mix, step, attribute, cameraWorldMatrix, positionView, positionViewDirection,
  normalize, cross, dFdx, dFdy, reflect, pow,
} from 'three/tsl';
import { projectPosition, revealMask } from './project.js';
import { MODE } from './globals.js';

export const PROBE_LAYER = 1;
const SIZE = 128, LEVELS = Math.log2(SIZE);
let target = null;
const cube = () => (target ??= new THREE.CubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }));

// part de la sonde dans l'image (0 dehors, 1 dans les pièces)
export const PROBE = { k: uniform(0) };

// Lumière que la sonde ajoute à une surface (à verser dans son émission).
// N : normale (repère de vue) ; base : albédo ; metal, rough ; diffuse,
// specular : parts du rebond diffus et du reflet.
export function probeLight(N, base, metal, rough, { diffuse = 1, specular = 1 } = {}) {
  if (MODE.lite) return null;
  const tex = (dirView, level) => cubeTexture(cube().texture, cameraWorldMatrix.mul(vec4(dirView, 0)).xyz).level(level).rgb;
  let out = vec3(0);
  if (diffuse) out = out.add(base.mul(float(1).sub(metal)).mul(tex(N, float(LEVELS - 2))).mul(diffuse));
  if (specular) {
    const V = positionViewDirection;
    const f0 = mix(vec3(0.04), base, metal);
    const fres = f0.add(vec3(1).sub(f0).mul(pow(float(1).sub(N.dot(V).abs().clamp(0, 1)), 5)));
    const refl = tex(reflect(V.negate(), N), rough.clamp(0, 1).mul(LEVELS - 2));
    out = out.add(refl.mul(fres).mul(rough.mul(-0.6).add(1)).mul(specular));
  }
  return out.mul(PROBE.k);
}

// Doublure d'un jeu de panneaux, pour la sonde. U : uniformes des trois
// finitions ; M : uniformes du maillage ; reveal : ajourage de la cellule
export function buildProbeMaterial(U, M, reveal) {
  const m = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  m.positionNode = projectPosition(M, false, reveal);
  m.maskNode = revealMask(false);
  const surf = attribute('surf', 'vec4');
  const pick = (k) => mix(mix(U.outer[k], U.edge[k], step(0.5, surf.z)), U.inner[k], step(0.5, surf.y));
  // (un métal ne diffuse pas : la doublure en garde la teinte, à demi)
  m.colorNode = vec4(pick('color').mul(mix(float(1), float(0.5), pick('metal'))), 1);
  // normale de la facette (la projection 4D déforme celle du maillage) :
  // tournée vers l'observateur, quel que soit le sens du triangle
  m.normalNode = normalize(cross(dFdx(positionView), dFdy(positionView)));
  return m;
}

export function createProbe(renderer, scene) {
  const rt = cube();
  const cam = new THREE.CubeCamera(0.02, 80, rt);
  for (const c of cam.children) c.layers.set(PROBE_LAYER);
  let face = 0, fresh = 0, tick = 0; // (fresh : faces rendues depuis la dernière remise à zéro)
  return {
    texture: rt.texture, target: rt,
    // center : centre de la pièce (monde) ; near : plan proche ; all : les
    // six faces d'un coup (après un saut dans la boucle). À l'entrée dans le
    // voyage, la sonde se remplit en trois images (deux faces chacune) : sa
    // part est alors presque nulle, et six rendus d'un coup faisaient un à-coup.
    update(center, near = 0.02, all = false) {
      // (une fois remplie : une face une image sur deux — les murs changent lentement)
      if (!all && fresh >= 6 && (tick++ & 1)) return;
      cam.position.copy(center);
      for (const c of cam.children) { if (c.near !== near) { c.near = near; c.updateProjectionMatrix(); } }
      if (cam.coordinateSystem !== renderer.coordinateSystem) { cam.coordinateSystem = renderer.coordinateSystem; cam.updateCoordinateSystem(); }
      cam.updateMatrixWorld(true);
      const prev = renderer.getRenderTarget();
      const n = all ? 6 : fresh < 6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        // (les niveaux de mipmap ne sont refaits qu'une fois le tour des six
        // faces terminé : les refaire à chaque image coûtait plus que le rendu)
        rt.texture.generateMipmaps = face === 5;
        renderer.setRenderTarget(rt, face);
        renderer.render(scene, cam.children[face]);
        face = (face + 1) % 6;
      }
      rt.texture.generateMipmaps = true;
      renderer.setRenderTarget(prev);
      fresh = Math.min(6, fresh + n);
    },
    invalidate() { fresh = 0; },
  };
}
