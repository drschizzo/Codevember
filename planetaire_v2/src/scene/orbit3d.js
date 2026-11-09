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

// natures : astres (perle, gemme, metal, lanterne), traces (verre, or, gravure, aucune)
export function createOrbitVisual({ curve, N, radius = 0.0065, ring = 10, shadows = { bodies: 3, size: 512 }, bodyKind = 'perle', traceKind = 'verre', pinsMat = null }) {
  const n = curve.length / 2;
  const group = new THREE.Group();
  const U = {
    phase: uniform(0), cool: uniform(6), glow: uniform(1),
    bodyColor: uniform(new THREE.Color(1, 0.86, 0.66)), bodyGlow: uniform(1),
  };

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

  const heat = float(1).sub(fract(float(N).mul(U.phase.sub(attribute('s', 'float')))));
  // refroidissement exponentiel : le verre ne rougeoie qu'en arrière de l'astre,
  // puis redevient un fil de verre sombre et brillant
  const glow = exp(float(1).sub(heat).mul(U.cool.negate()));
  const mat = new THREE.MeshPhysicalNodeMaterial({ color: 0x07080a, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
  let heatK = 1;
  if (traceKind === 'or') {
    // fil d'or étiré : métal, à peine rougeoyant derrière l'astre
    mat.metalness = 1; mat.roughness = 0.18; mat.clearcoat = 0; heatK = 0.45;
  } else if (traceKind === 'gravure') {
    // gravure : un sillon sombre et mat, dont le fond rougeoie derrière la pointe
    mat.metalness = 0.3; mat.roughness = 0.8; mat.clearcoat = 0; heatK = 1.4;
  }
  mat.emissiveNode = heatColor(glow).mul(glow.mul(glow).mul(6).add(pow(glow, 16).mul(10))).mul(U.glow).mul(heatK);
  // le verre encore mou est plus épais : une goutte qui s'étire derrière l'astre
  if (traceKind === 'verre') mat.positionNode = positionLocal.add(normalLocal.mul(max(pow(glow, 4), 0).mul(radius * 1.4)));
  const tube = new THREE.Mesh(geo, mat);
  tube.receiveShadow = true;
  if (traceKind === 'gravure') tube.scale.y = 0.15; // (à fleur du plateau)
  tube.userData.kind = traceKind;
  group.add(tube);

  // ── astres : chacun une lumière, et selon sa nature
  //   perle : un cœur incandescent ; gemme : une pierre taillée irisée autour
  //   d'un petit cœur ; métal : une bille polie qui reflète tout (sans feu) ;
  //   lanterne : un cœur dans une cage de deux anneaux
  const bodies = [], mats = [], geos = [];
  const G = (g) => (geos.push(g), g);
  const coreGeo = G(new THREE.SphereGeometry(bodyKind === 'perle' ? 0.026 : bodyKind === 'lanterne' ? 0.014 : 0.011, 32, 16));
  const gemGeo = bodyKind === 'gemme' ? G(new THREE.IcosahedronGeometry(0.03, 0)) : null;
  const ballGeo = bodyKind === 'metal' ? G(new THREE.SphereGeometry(0.026, 48, 24)) : null;
  const ringGeo = bodyKind === 'lanterne' ? G(new THREE.TorusGeometry(0.028, 0.0016, 8, 48)) : null;
  const shellMat = bodyKind === 'gemme'
    ? new THREE.MeshPhysicalNodeMaterial({ metalness: 0, roughness: 0.02, clearcoat: 1, iridescence: 0.8, iridescenceIOR: 1.6, transparent: true, opacity: 0.55, flatShading: true })
    : bodyKind === 'metal' ? new THREE.MeshPhysicalNodeMaterial({ color: 0xf2f2f4, metalness: 1, roughness: 0.04 }) : null;
  if (shellMat) mats.push(shellMat);
  let lightBase = 0.12;
  const lightK = bodyKind === 'metal' ? 0.25 : bodyKind === 'gemme' ? 0.7 : 1;
  for (let j = 0; j < N; j++) {
    // embrasement : chaque astre a sa propre intensité (il s'avive quand il en frôle un autre)
    const boost = uniform(1);
    const m = new THREE.Group();
    if (bodyKind !== 'metal') {
      const coreMat = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 1 });
      coreMat.emissiveNode = U.bodyColor.mul(boost.mul(U.bodyGlow).mul(bodyKind === 'perle' ? 18 : 30));
      mats.push(coreMat);
      m.add(new THREE.Mesh(coreGeo, coreMat));
    }
    if (gemGeo) { const g = new THREE.Mesh(gemGeo, shellMat); g.rotation.set(j * 0.7, j * 1.3, 0); g.castShadow = true; m.add(g); }
    if (ballGeo) { const b = new THREE.Mesh(ballGeo, shellMat); b.castShadow = true; m.add(b); }
    if (ringGeo) {
      for (const [rx, rz] of [[Math.PI / 2, 0], [0, Math.PI / 2], [Math.PI / 2, Math.PI / 2]]) {
        const r = new THREE.Mesh(ringGeo, pinsMat); r.rotation.set(rx, 0, rz); r.castShadow = true; m.add(r);
      }
    }
    m.userData.boost = boost;
    const light = new THREE.PointLight(0xffc489, lightBase, 0, 2);
    if (j < shadows.bodies && bodyKind !== 'metal') {
      light.castShadow = true;
      light.shadow.mapSize.set(shadows.size, shadows.size);
      light.shadow.camera.near = 0.03; light.shadow.camera.far = 6;
      light.shadow.bias = -0.002; light.shadow.radius = 3;
    }
    m.add(light);
    m.userData.light = light;
    group.add(m);
    bodies.push(m);
  }

  // intensité de chaque astre (1 : au repos)
  const setBoost = (j, k) => { bodies[j].userData.boost.value = k; bodies[j].userData.light.intensity = lightBase * lightK * k; };

  // réglages de la recette (astres, verre)
  function setStyle(R) {
    U.cool.value = R.trace.cool;
    U.glow.value = R.trace.glow;
    if (traceKind === 'verre') mat.color.set(R.trace.glass);
    if (traceKind === 'or') mat.color.setRGB(1, 0.77, 0.34);
    if (traceKind === 'gravure') mat.color.set(R.trace.glass);
    tube.visible = R.trace.show && traceKind !== 'aucune';
    if (shellMat && bodyKind === 'gemme') shellMat.color.set(R.bodies.color);
    U.bodyColor.value.set(R.bodies.color);
    U.bodyGlow.value = R.bodies.glow;
    lightBase = R.bodies.light;
    for (const b of bodies) b.userData.light.color.set(R.bodies.color);
  }

  return {
    group, bodies, phase: U.phase, setBoost, setStyle,
    dispose() { geo.dispose(); mat.dispose(); for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); for (const b of bodies) b.userData.light.dispose(); },
  };
}
