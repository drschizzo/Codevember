// Lumières : le cœur (lumière ponctuelle au centre, ombres projetées par les
// coquilles) et une lampe frontale (projecteur solidaire de la caméra,
// légèrement décentré, qui franchit chaque oculus avec elle — aucune coquille
// ne change jamais de côté par rapport à elle, donc pas de saut d'ombre).
// Toutes deux sont fixes par rapport à la caméra et au centre : l'éclairage
// ne dépend que de la profondeur relative, comme le reste de la plongée.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { CORE, KEY, MAIN } from './nest.js';
import { buildCoreMaterial, buildCoronaMaterial, buildRingMaterial, G } from './materials.js';

const SHADOW_SIZES = { low: [512, 1024], medium: [1024, 2048], high: [1024, 2048], ultra: [2048, 4096] };

export function createLights(scene) {
  const core = new THREE.PointLight(0xffffff, 40, 0, 2);
  core.castShadow = true;
  core.shadow.camera.near = 0.03;
  core.shadow.camera.far = 24;
  core.shadow.bias = -0.0006;
  core.shadow.normalBias = 0.003;
  core.shadow.camera.layers.mask = CORE;
  scene.add(core);

  // Le cœur : étoile (avec sa couronne), perle de lumière, ou gyroscope
  // (trois anneaux qui tournent autour de la source : leurs ombres balaient les
  // coquilles, un nombre entier de tours par boucle)
  const U = { color: uniform(new THREE.Color()), glow: uniform(15), pulse: uniform(0) };
  const coreMats = { star: buildCoreMaterial(U, 'star'), pearl: buildCoreMaterial(U, 'pearl') };
  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), coreMats.star);
  coreMesh.layers.mask = MAIN;
  coreMesh.castShadow = false;
  scene.add(coreMesh);
  const corona = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), buildCoronaMaterial(U));
  corona.layers.mask = MAIN;
  corona.renderOrder = 1000;
  scene.add(corona);
  const ringMat = buildRingMaterial(U);
  const RINGS = [[1.7, [0.3, 1, 0.2], 1], [2.1, [1, 0.2, 0.5], -1], [2.5, [0.4, 0.3, 1], 2]];
  const rings = RINGS.map(([, axis]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 8, 128), ringMat);
    m.userData.axis = new THREE.Vector3(...axis).normalize();
    m.castShadow = true; m.receiveShadow = false;
    scene.add(m);
    return m;
  });
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

  const key = new THREE.SpotLight(0xffffff, 80, 0, 0.6, 0.8, 2);
  key.castShadow = true;
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.004;
  key.shadow.camera.layers.mask = KEY;
  key.target.position.set(0, 0, 0);
  scene.add(key, key.target);

  const _v = new THREE.Vector3();
  return {
    core, key, coreMesh, corona, rings, U,
    setShadowQuality(q) {
      const [c, k] = SHADOW_SIZES[q] || SHADOW_SIZES.high;
      // (le moteur redimensionne la carte d'ombre d'après mapSize à chaque image)
      core.shadow.mapSize.set(c, c);
      key.shadow.mapSize.set(k, k);
    },
    // R : recette ; D : distance de la caméra au centre
    update(R, camera, D, pulse) {
      const k = R.core;
      core.color.set(k.color);
      U.color.value.set(k.color);
      U.glow.value = k.glow;
      U.pulse.value = k.pulse;
      core.intensity = k.intensity * (1 + pulse * k.pulse);
      core.decay = k.decay;
      core.shadow.radius = k.shadowSoft;
      const cr = R.nest.core * D, kind = k.kind ?? 'star';
      coreMesh.scale.setScalar(cr);
      coreMesh.material = coreMats[kind === 'pearl' ? 'pearl' : 'star'];
      corona.visible = kind === 'star';
      corona.scale.setScalar(cr * 1.9);
      rings.forEach((m, i) => {
        const [s, , turns] = RINGS[i];
        m.visible = kind === 'gyro';
        m.layers.mask = m.visible ? MAIN | CORE : 0;
        m.scale.setScalar(cr * s);
        _q.setFromAxisAngle(m.userData.axis, Math.PI * 2 * turns * G.phase.value);
        _q2.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.userData.axis.clone().cross(new THREE.Vector3(0.2, 0.9, 0.1)).normalize());
        m.quaternion.multiplyQuaternions(_q, _q2);
      });
      const kk = R.key;
      key.color.set(kk.color);
      key.intensity = kk.intensity;
      key.angle = kk.angle;
      key.penumbra = kk.penumbra;
      // décalage dans le plan de l'écran, en fraction de D : assez faible pour que
      // la lampe passe toujours bien à l'intérieur de l'oculus, loin du rebord
      _v.set(kk.x * 0.12 * D, kk.y * 0.12 * D, 0).applyQuaternion(camera.quaternion);
      key.position.copy(camera.position).add(_v);
    },
  };
}
