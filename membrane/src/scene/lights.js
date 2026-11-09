// Lumières :
//   - la lampe (projecteur, côté caméra, solidaire d'elle) : modelé, reflets
//     du film humide, ombres de l'armature sur la couche suivante ;
//   - le contre-jour (projecteur derrière le nid, dans l'axe) : il traverse
//     les membranes et y dessine, en ombres chinoises, les lames de
//     l'armature (translucidité ombrée) ;
//   - le cœur (lumière ponctuelle au centre, sans ombre) et sa lueur : la
//     source d'où naissent les couches, que l'on devine au travers de toutes.
// Lampe et contre-jour sont fixes par rapport à la caméra et au centre :
// l'éclairage ne dépend que de la profondeur relative, comme tout le reste.
import * as THREE from 'three/webgpu';
import { vec4, float, positionViewDirection, normalView, dot, abs, pow, mix, viewportTexture, screenUV } from 'three/tsl';
import { KEY, BACK, MAIN } from './nest.js';
import { G } from './globals.js';

// (mobile : 1024, quatre fois moins de texels à rendre et à filtrer ; les
// ombres de l'armature sont adoucies par la pénombre, la perte ne se voit guère)
const SHADOW_SIZES = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

export function createLights(scene, { lite = false } = {}) {
  // (sans atténuation : une source lointaine — les membranes qui frôlent la
  // caméra ne s'embrasent pas)
  const key = new THREE.SpotLight(0xffffff, 10, 0, 0.6, 0.8, 0);
  key.castShadow = true;
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004;
  key.shadow.camera.layers.mask = KEY;
  const back = new THREE.SpotLight(0xffffff, 10, 0, 0.35, 0.9, 2);
  back.castShadow = true;
  back.shadow.camera.near = 0.5;
  back.shadow.camera.far = 40;
  back.shadow.bias = -0.0005;
  back.shadow.normalBias = 0.006;
  back.shadow.camera.layers.mask = BACK;
  const core = new THREE.PointLight(0xffffff, 1, 0, 1.5);
  core.castShadow = false;
  scene.add(key, key.target, back, back.target, core);

  // lueur du cœur : sphère émissive, plus dense au centre (vue de face). Elle
  // est opaque (dessinée avant les membranes, qui la voient au travers ; les
  // couches qui naissent s'y cachent) et se fond dans ce qui est derrière elle.
  const glowMat = new THREE.MeshBasicNodeMaterial();
  const facing = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
  const a = pow(facing, float(1.5));
  const col = G.coreColor.mul(G.coreGlow).mul(pow(facing, float(3)).add(0.15));
  if (lite) {
    // mode allégé : le même mélange mix(fond, lueur, a), fait par le matériel
    // (mélange alpha) au lieu d'une copie de l'image. Dessinée après les
    // objets opaques et avant les membranes (renderOrder), elle écrit sa
    // profondeur : le résultat est identique, sans copie.
    glowMat.colorNode = vec4(col, a);
    glowMat.transparent = true;
    glowMat.depthWrite = true;
  } else {
    const behind = viewportTexture(screenUV).rgb;
    glowMat.colorNode = vec4(mix(behind, col, a), 1);
  }
  glowMat.fog = false;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, lite ? 32 : 48, lite ? 16 : 24), glowMat);
  glow.layers.mask = MAIN;
  glow.renderOrder = 5; // (avant les membranes : elles le voient au travers)
  scene.add(glow);

  const _v = new THREE.Vector3();
  return {
    key, back, core, glow,
    setShadowQuality(q) { const s = SHADOW_SIZES[q] || 2048; key.shadow.mapSize.set(s, s); back.shadow.mapSize.set(s, s); },
    update(R, camera, D, coreR) {
      const k = R.key;
      key.color.set(k.color); key.intensity = k.intensity * D * D; key.angle = k.angle; key.penumbra = k.penumbra;
      key.shadow.radius = k.soft;
      _v.set(k.x * D, k.y * D, 0).applyQuaternion(camera.quaternion);
      key.position.copy(camera.position).add(_v);
      key.target.position.set(0, 0, 0);
      const b = R.back;
      back.color.set(b.color); back.intensity = b.intensity * D * D * 9;
      back.decay = 2; back.angle = b.angle; back.penumbra = 0.9;
      back.shadow.radius = b.soft;
      back.position.set(b.x * D, b.y * D, -3 * D);
      back.target.position.set(0, 0, 0);
      const c = R.core;
      core.color.set(c.color); core.intensity = c.intensity * D * D; core.decay = c.decay;
      G.coreColor.value.set(c.color); G.coreGlow.value = c.glow;
      glow.scale.setScalar(coreR);
    },
  };
}
