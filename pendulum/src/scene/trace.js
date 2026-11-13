// La pose longue : une petite lampe au bout de la chaîne, et la trace qu'elle
// laisse sur le film d'un appareil qui reste ouvert (Berenice Abbott,
// photographies de pendules à la lampe ; Marey, la chronophotographie à point
// lumineux). C'est la liberté de la scène : l'œil ne garde pas la trajectoire,
// la plaque photographique si. Tout le reste reste exact : la trace est la
// vraie trajectoire du bout de la chaîne, relue dans le film aux instants
// passés (film.at(ph − âge)), donc périodique comme lui — la boucle se referme
// sans couture.
//
// Un tube fin (RADIAL côtés) le long des SAMPLES dernières positions, sur
// TRACE_T secondes de film, recalculé chaque image sur le CPU (≈ 1 500
// sommets) ; matière additive, sans profondeur écrite, d'autant plus vive que
// la lumière est récente ; le vermillon du fil rouge de la collection.
import * as THREE from 'three/webgpu';
import { uniform, attribute, vec3, float, pow } from 'three/tsl';
import { poseOf, layoutOf } from '../gen/pose.js';

export const TRACE_T = 3.6, SAMPLES = 240, RADIAL = 6;
export const FIL_ROUGE = 0xd8401f;

export function createTrace() {
  const group = new THREE.Group();
  group.visible = false;
  const nv = SAMPLES * RADIAL;
  const pos = new Float32Array(nv * 3), age = new Float32Array(nv);
  const idx = [];
  for (let i = 0; i + 1 < SAMPLES; i++) for (let j = 0; j < RADIAL; j++) {
    const a = i * RADIAL + j, b = i * RADIAL + ((j + 1) % RADIAL), c = a + RADIAL, d = b + RADIAL;
    idx.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < RADIAL; j++) age[i * RADIAL + j] = i / (SAMPLES - 1);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa);
  geo.setAttribute('age', new THREE.BufferAttribute(age, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4);

  const U = { gain: uniform(1), color: uniform(new THREE.Color(FIL_ROUGE)) };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // (la tête de la trace, toute récente, tire vers le blanc : une lampe surexposée)
  const a = attribute('age', 'float');
  const fade = pow(float(1).sub(a), 1.6);
  const hot = pow(float(1).sub(a), 24.0);
  mat.colorNode = U.color.mul(fade.mul(4.0)).add(vec3(1.0, 0.85, 0.7).mul(hot.mul(6.0))).mul(U.gain);
  mat.opacityNode = fade;
  const tube = new THREE.Mesh(geo, mat);
  tube.frustumCulled = false;
  tube.renderOrder = 12;

  // la lampe : une perle émissive au bout de la chaîne (elle éclaire, l'ampoule ne se voit qu'en blanc)
  const bulbMat = new THREE.MeshBasicNodeMaterial();
  bulbMat.colorNode = vec3(1.0, 0.82, 0.68).mul(U.gain).mul(5.0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), bulbMat);
  const glow = new THREE.PointLight(FIL_ROUGE, 0, 1.2, 2);
  glow.castShadow = false;
  group.add(tube, bulb, glow);

  let M = null, Lay = null, radius = 0.003, power = 1;
  const pts = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
  const st = {};
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), up = new THREE.Vector3();

  function setRecipe(R) {
    M = R.machine; Lay = layoutOf(M);
    const t = R.stage.trace ?? 0;
    group.visible = t > 0;
    power = t;
    U.gain.value = t;
    // (bulbe : un peu plus gros que le bout du maillon, pour qu'on le voie porter la lumière)
    const last = M.links[M.links.length - 1];
    radius = Math.max(0.003, last.w * 0.12);
    bulb.scale.setScalar(Math.max(0.006, last.w * 0.32));
  }

  const tip = (s, out) => {
    const Q = poseOf(M, s.theta, s.s, Lay), p = Q.joints[Q.joints.length - 1];
    // (en avant du plan du maillon : la lampe est vissée sur sa face)
    return out.set(p[0], p[1], p[2] + 0.012);
  };

  // ph : phase courante ; film : le film (at(u) périodique) ; cur : état courant
  function update(ph, film, cur) {
    if (!group.visible || !M || !film) return;
    for (let i = 0; i < SAMPLES; i++) {
      const s = i === 0 ? cur : film.at(ph - (i / (SAMPLES - 1)) * TRACE_T / film.duration, st);
      tip(s, pts[i]);
    }
    bulb.position.copy(pts[0]);
    glow.position.copy(pts[0]);
    glow.intensity = 0.35 * power;
    // tube : repère de Bishop simplifié (normale transportée), rayon constant
    up.set(0, 0, 1);
    for (let i = 0; i < SAMPLES; i++) {
      const p = pts[i], q = pts[Math.min(SAMPLES - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      T.subVectors(q, o);
      if (T.lengthSq() < 1e-14) T.set(0, -1, 0); else T.normalize();
      N.crossVectors(up, T);
      if (N.lengthSq() < 1e-10) N.set(1, 0, 0); else N.normalize();
      B.crossVectors(T, N);
      for (let j = 0; j < RADIAL; j++) {
        const a = (j / RADIAL) * Math.PI * 2, c = Math.cos(a) * radius, s = Math.sin(a) * radius, k = (i * RADIAL + j) * 3;
        pos[k] = p.x + N.x * c + B.x * s; pos[k + 1] = p.y + N.y * c + B.y * s; pos[k + 2] = p.z + N.z * c + B.z * s;
      }
    }
    pa.needsUpdate = true;
  }

  return { group, setRecipe, update };
}
