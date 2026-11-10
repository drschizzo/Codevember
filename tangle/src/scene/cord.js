// La corde à l'écran : un tube déformé dans le vertex shader.
//
// Chaque image, le CPU relit la simulation (track.js), calcule la courbe dense
// de chaque brin et son vecteur matériel d1, et les envoie dans une petite
// texture (une rangée par grandeur : position, d1, et les mêmes à l'image
// précédente pour les vecteurs vitesse). Le maillage ne porte que ses
// coordonnées (anneau j, angle autour de l'axe, brin) : un shader par corde,
// quelle que soit sa forme.
//
// La matière : une gaine tressée (16 fuseaux, deux familles d'hélices qui se
// croisent dessus-dessous, chaque fil en relief), en deux tons, et une rayure
// de repère tissée dans la tresse : c'est elle qui montre la torsion. Lustre
// textile (sheen), translucidité légère au contre-jour.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, texture, vec2, vec3, vec4, float, uniform, normalize, cross, cos, sin, mix, smoothstep, abs, fract, floor,
  positionPrevious, normalLocal, step, clamp, select, normalViewGeometry, faceDirection, mod,
} from 'three/tsl';
import { SUB, sampleSim, denseStrand } from '../track.js';
import { perturb, stableVelocity, isLite, noise2 } from './materials.js';
import { G } from './globals.js';

const SIDES = 18;

export function createCord(root) {
  let S = null, tex = null, data = null, mesh = null, mat = null, M = 0, W = 0, rows = 0;
  let st = null, pos = null, d1 = null, prevValid = false;
  const U = {
    base: [uniform(new THREE.Color()), uniform(new THREE.Color())],
    yarn: [uniform(new THREE.Color()), uniform(new THREE.Color())],
    stripe: [uniform(new THREE.Color()), uniform(new THREE.Color())],
    sheen: uniform(0.35), r: uniform(0.005), L: uniform(0.62), stripes: uniform(1),
  };

  function setSim(sim, R, palettes) {
    S = sim;
    const k = S.strands.length;
    M = S.strands[0].n * SUB + 1;
    W = M; rows = k * 4;
    data = new Float32Array(W * rows * 4);
    tex?.dispose();
    tex = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    st = null; pos = new Float32Array(M * 3); d1 = new Float32Array(M * 3); prevValid = false;
    U.r.value = S.r; U.L.value = S.L;
    setLook(R, palettes);
    // maillage : anneaux × côtés, par brin
    if (mesh) { root.remove(mesh); mesh.geometry.dispose(); mat?.dispose(); }
    const nv = k * M * SIDES, cuv = new Float32Array(nv * 3), P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
    const idx = [];
    for (let s = 0; s < k; s++) for (let j = 0; j < M; j++) for (let a = 0; a < SIDES; a++) {
      const v = (s * M + j) * SIDES + a;
      cuv[v * 3] = j; cuv[v * 3 + 1] = a / SIDES; cuv[v * 3 + 2] = s;
      P[v * 3 + 1] = -j / M; N[v * 3] = 1;
      if (j + 1 < M) {
        const b = (s * M + j + 1) * SIDES, c0 = (s * M + j) * SIDES;
        const a1 = (a + 1) % SIDES;
        idx.push(c0 + a, b + a1, b + a, c0 + a, c0 + a1, b + a1); // (sens direct vu de l'extérieur : t × e2 = −e1, on inverse)
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('cuv', new THREE.BufferAttribute(cuv, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.4, 0), 0.8);
    mat = buildMaterial();
    mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  function setLook(R, palettes) {
    const p1 = palettes[R.cord.palette], p2 = palettes[R.cord.palette2];
    const set = (i, p) => { U.base[i].value.set(p[0]); U.yarn[i].value.set(p[1]); U.stripe[i].value.set(p[2]); };
    set(0, p1); set(1, S?.strands.length > 1 ? p2 : p1);
    U.sheen.value = R.cord.sheen; U.stripes.value = R.cord.stripes;
  }

  // position et normale d'un sommet du tube (rangées : 0 position, 1 d1, 2 et 3 : image précédente)
  const tubePoint = (prev) => {
    const c = attribute('cuv', 'vec3'), j = c.x, a = c.y.mul(Math.PI * 2), s = c.z;
    const at = (jj, r) => texture(tex, vec2(jj.add(0.5).div(W), s.mul(4).add(r).add(0.5).div(rows))).level(0).xyz;
    const r0 = prev ? 2 : 0, r1 = prev ? 3 : 1;
    const p = at(j, r0);
    const pa = at(j.sub(1).max(0), r0), pb = at(j.add(1).min(M - 1), r0);
    const t = normalize(pb.sub(pa));
    const e1 = normalize(at(j, r1));
    const e2 = cross(t, e1);
    const n = e1.mul(cos(a)).add(e2.mul(sin(a)));
    return { p: p.add(n.mul(U.r)), n };
  };

  function buildMaterial() {
    const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
    m.positionNode = Fn(() => {
      const cur = tubePoint(false);
      if (!isLite()) positionPrevious.assign(tubePoint(true).p);
      normalLocal.assign(cur.n);
      return cur.p;
    })();
    m.castShadowPositionNode = Fn(() => tubePoint(false).p)();
    // tresse : 16 fuseaux, 8 dans chaque sens ; u : le long de la corde (m), v : autour (tours)
    const c = attribute('cuv', 'vec3');
    const s = c.z;
    const along = c.x.div(M - 1).mul(U.L);
    const around = c.y;
    const pitch = U.r.mul(Math.PI * 2).mul(1.7); // (pas d'une hélice de fil : ~1,7 tour de circonférence)
    const h1 = along.div(pitch).add(around), h2 = along.div(pitch).sub(around);
    const k = 8;
    const c1 = floor(h1.mul(k)), c2 = floor(h2.mul(k));
    const f1 = fract(h1.mul(k)), f2 = fract(h2.mul(k));
    // dessus-dessous : sergé 2/2 (le fil d'une famille passe sur deux fils de l'autre)
    const over = step(1.5, mod(c1.add(c2), 4));
    const bulge1 = sin(f2.mul(Math.PI)), bulge2 = sin(f1.mul(Math.PI));
    const H = mix(bulge2, bulge1, over).mul(0.8).add(sin(mix(f1, f2, over).mul(Math.PI * 6)).mul(0.05)); // (fibres du fil)
    // rayure : un fuseau d'une autre couleur (ou deux, opposés), tissé dans la tresse
    const ar = fract(around.add(0.5)).sub(0.5);
    const band = select(U.stripes.greaterThan(1.5), abs(fract(around.mul(2).add(0.5)).sub(0.5)), abs(ar));
    const stripe = smoothstep(0.075, 0.055, band);
    const pick = (arr) => select(s.greaterThan(0.5), vec3(arr[1]), vec3(arr[0]));
    const base = pick(U.base), yarn = pick(U.yarn), stc = pick(U.stripe);
    const tone = mix(base, yarn, over.mul(0.6));
    const col = mix(tone, stc, stripe).mul(H.mul(0.35).add(0.72)).mul(noise2(vec3(along.mul(40), around.mul(6), s)).mul(0.06).add(1));
    m.colorNode = vec4(col, 1);
    m.roughnessNode = float(0.72).sub(H.mul(0.1));
    m.metalnessNode = float(0);
    m.sheenNode = mix(base, vec3(1), 0.5).mul(U.sheen);
    m.sheenRoughnessNode = float(0.45);
    // relief de la tresse (hauteur en unités du monde : ~0,5 mm de bosse)
    const N0 = normalViewGeometry.mul(faceDirection);
    m.normalNode = perturb(H.mul(0.0012).mul(G.microDetail), N0);
    m.mrtNode = stableVelocity();
    return m;
  }

  // t : temps du film (s) ; renvoie l'état du balancier et du mandrin
  function update(t) {
    if (!S) return null;
    // image précédente → rangées 2 et 3
    const k = S.strands.length;
    st = sampleSim(S, t, st ?? undefined);
    for (let s = 0; s < k; s++) {
      denseStrand(S, st, s, pos, d1);
      const base = s * 4 * W * 4;
      for (let j = 0; j < M; j++) {
        const o0 = base + j * 4, o1 = base + (W + j) * 4, o2 = base + (2 * W + j) * 4, o3 = base + (3 * W + j) * 4;
        if (prevValid) { data[o2] = data[o0]; data[o2 + 1] = data[o0 + 1]; data[o2 + 2] = data[o0 + 2]; data[o3] = data[o1]; data[o3 + 1] = data[o1 + 1]; data[o3 + 2] = data[o1 + 2]; }
        data[o0] = pos[j * 3]; data[o0 + 1] = pos[j * 3 + 1]; data[o0 + 2] = pos[j * 3 + 2]; data[o0 + 3] = 1;
        data[o1] = d1[j * 3]; data[o1 + 1] = d1[j * 3 + 1]; data[o1 + 2] = d1[j * 3 + 2]; data[o1 + 3] = 1;
        if (!prevValid) { data[o2] = data[o0]; data[o2 + 1] = data[o0 + 1]; data[o2 + 2] = data[o0 + 2]; data[o3] = data[o1]; data[o3 + 1] = data[o1 + 1]; data[o3 + 2] = data[o1 + 2]; }
      }
    }
    prevValid = true;
    tex.needsUpdate = true;
    return st;
  }
  // (un saut dans la boucle : pas de vitesse)
  const resetHistory = () => { prevValid = false; };

  return { setSim, setLook, update, resetHistory, get mesh() { return mesh; }, U };
}
