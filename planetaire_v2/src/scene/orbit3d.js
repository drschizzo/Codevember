// Les astres et le sillage de verre filé.
//
// Le sillage est un seul tube, fixe sur le plateau, qui suit toute la courbe.
// Chaque astre y dépose du verre en fusion : en un point d'abscisse s
// (fraction de période), le dernier passage date de fract(N·(φ − s)) / N
// période, φ étant la phase courante. La chaleur vaut 1 − fract(N·(φ − s)) :
// le verre refroidit pendant exactement un N-ième de période, et l'astre
// suivant arrive au moment où il s'éteint pour le ranimer. Tout est calculé
// dans le shader à partir d'un seul uniforme, la phase.
//
// Coordonnées : la courbe (x, y) du plan est posée en (x, 0, −y) ; une
// rotation du plateau d'angle θ autour de +y est alors la rotation du plan.
import * as THREE from 'three/webgpu';
import { uniform, attribute, float, vec3, mix, smoothstep, fract, pow, exp, positionLocal, normalLocal, max } from 'three/tsl';

// verre en fusion → verre froid (approximation d'un corps noir)
export function heatColor(h) {
  const c1 = mix(vec3(0.25, 0.015, 0.004), vec3(1.0, 0.18, 0.03), smoothstep(0.0, 0.35, h));
  const c2 = mix(c1, vec3(1.0, 0.55, 0.16), smoothstep(0.3, 0.7, h));
  return mix(c2, vec3(1.0, 0.9, 0.74), smoothstep(0.72, 1.0, h));
}

const LIGHT = 0.12;

export function createOrbitVisual({ curve, N, radius = 0.0065, ring = 10 }) {
  const n = curve.length / 2;
  const group = new THREE.Group();
  const phase = uniform(0);

  // ── tube : anneaux le long de la courbe fermée, repère (tangente, haut, normale)
  const pos = new Float32Array(n * ring * 3), nrm = new Float32Array(n * ring * 3), sAttr = new Float32Array(n * ring);
  for (let i = 0; i < n; i++) {
    const x = curve[2 * i], z = -curve[2 * i + 1];
    const j = (i + 1) % n, k = (i - 1 + n) % n;
    let tx = curve[2 * j] - curve[2 * k], tz = -(curve[2 * j + 1] - curve[2 * k + 1]);
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx; // normale dans le plan (tangente × haut)
    for (let r = 0; r < ring; r++) {
      const a = (r / ring) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const ox = nx * ca, oy = sa, oz = nz * ca;
      const o = (i * ring + r) * 3;
      pos[o] = x + ox * radius; pos[o + 1] = oy * radius; pos[o + 2] = z + oz * radius;
      nrm[o] = ox; nrm[o + 1] = oy; nrm[o + 2] = oz;
      sAttr[i * ring + r] = i / n;
    }
  }
  const idx = new Uint32Array(n * ring * 6);
  let q = 0;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let r = 0; r < ring; r++) {
      const r2 = (r + 1) % ring;
      const a = i * ring + r, b = i2 * ring + r, c = i2 * ring + r2, d = i * ring + r2;
      idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('s', new THREE.BufferAttribute(sAttr, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const heat = float(1).sub(fract(float(N).mul(phase.sub(attribute('s', 'float')))));
  // refroidissement exponentiel : le verre ne rougeoie qu'en arrière de l'astre,
  // puis redevient un fil de verre sombre et brillant
  const glow = exp(float(1).sub(heat).mul(-6));
  const mat = new THREE.MeshPhysicalNodeMaterial({ color: 0x07080a, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
  mat.emissiveNode = heatColor(glow).mul(glow.mul(glow).mul(6).add(pow(glow, 16).mul(10)));
  // le verre encore mou est plus épais : une goutte qui s'étire derrière l'astre
  mat.positionNode = positionLocal.add(normalLocal.mul(max(pow(glow, 4), 0).mul(radius * 1.4)));
  const tube = new THREE.Mesh(geo, mat);
  tube.castShadow = false; tube.receiveShadow = true;
  group.add(tube);

  // ── astres : un cœur incandescent, une lumière chacun
  const bodies = [];
  const coreGeo = new THREE.SphereGeometry(0.026, 32, 16);
  const mats = [];
  for (let j = 0; j < N; j++) {
    // embrasement : chaque astre a sa propre intensité (il s'avive quand il en frôle un autre)
    const boost = uniform(1);
    const coreMat = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 1 });
    coreMat.emissiveNode = vec3(1.0, 0.86, 0.66).mul(boost.mul(18));
    mats.push(coreMat);
    const m = new THREE.Mesh(coreGeo, coreMat);
    m.userData.boost = boost;
    const light = new THREE.PointLight(0xffc489, LIGHT, 0, 2);
    // ombres : les trois premiers astres seulement (une carte cubique chacun)
    if (j < 3) {
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      light.shadow.camera.near = 0.03; light.shadow.camera.far = 6;
      light.shadow.bias = -0.002; light.shadow.radius = 3;
    }
    m.add(light);
    m.userData.light = light;
    group.add(m);
    bodies.push(m);
  }
  // intensité de chaque astre (1 : au repos)
  const setBoost = (j, k) => { bodies[j].userData.boost.value = k; bodies[j].userData.light.intensity = LIGHT * k; };

  return {
    group, bodies, phase, setBoost,
    dispose() { geo.dispose(); mat.dispose(); coreGeo.dispose(); for (const m of mats) m.dispose(); for (const b of bodies) b.children[0].dispose(); },
  };
}
