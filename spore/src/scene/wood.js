// Le bois : un maillage dense du dessus de la bûche, déplacé dans le vertex
// shader par le relief cuit (gen/wood.js), éclairé au pixel par ses pentes
// (normal map), avec un micro-relief procédural pour le gros plan. La carte
// se répète de L en L le long du vent (x) : c'est la même fonction de hauteur
// qui pose le plasmodium, les sporanges et les spores (woodHeightNode).
//
// Le bois porte aussi les traces de la vie : la nappe du plasmodium le
// mouille (plus sombre, plus lisse) là où elle est passée, puis sèche ; la
// poussière de spores le poudre.
import * as THREE from 'three/webgpu';
import { Fn, texture, uniform, vec2, vec3, vec4, float, positionLocal, positionGeometry, positionPrevious, normalLocal, modelViewMatrix, normalize, mix, smoothstep, sqrt, max as tmax, abs, clamp, fwidth } from 'three/tsl';
import { noise, perturb, stableVelocity, isLite, NZ } from '../../../shared/scene/materials.js';

export function woodTextures(maps) {
  const rel = new THREE.DataTexture(maps.relH, maps.M, maps.M, THREE.RGBAFormat, THREE.HalfFloatType);
  const col = new THREE.DataTexture(maps.col, maps.M, maps.M, THREE.RGBAFormat, THREE.UnsignedByteType);
  col.colorSpace = THREE.SRGBColorSpace;
  const smooth = new THREE.DataTexture(maps.smoothH, maps.M, maps.M, THREE.RedFormat, THREE.HalfFloatType);
  for (const t of [rel, col, smooth]) {
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.MirroredRepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
    t.needsUpdate = true;
  }
  smooth.generateMipmaps = false; smooth.minFilter = THREE.LinearFilter;
  return { rel, col, smooth, L: maps.L, W: maps.W, R: maps.logR };
}

// nœuds de la surface du bois (partagés par tout ce qui s'y pose)
export function woodNodes(T) {
  const L = float(T.L), W = float(T.W), R = float(T.R);
  const uvOf = (x, z) => vec2(x.div(L), z.add(W.mul(0.5)).div(W));
  const base = (z) => sqrt(tmax(R.mul(R).sub(z.mul(z)), 0)).sub(R);
  // hauteur (vertex shader : .level(0))
  const height = (x, z) => base(z).add(texture(T.rel, uvOf(x, z)).level(0).x);
  // hauteur lissée (le niveau d'un liquide qui remplit les creux : mip grossier)
  const smooth = (x, z) => base(z).add(texture(T.smooth, uvOf(x, z)).level(0).x);
  // normale de la forme d'ensemble (le cylindre)
  const baseNormal = (z) => normalize(vec3(0, base(z).add(R), z));
  return { uvOf, base, height, smooth, baseNormal, L, W, R };
}

// la grille : x de x0 à x1 (cm), angle autour de l'axe de la bûche de −a à a,
// plus dense au milieu (là où la caméra regarde)
function logGeometry(x0, x1, R, nx, na, amax) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((nx + 1) * (na + 1) * 3), nor = new Float32Array(pos.length), idx = [];
  for (let j = 0; j <= na; j++) {
    const s = (j / na) * 2 - 1, a = amax * Math.sign(s) * Math.abs(s) ** 1.6; // (dense au sommet)
    const z = R * Math.sin(a), y = R * Math.cos(a) - R;
    for (let i = 0; i <= nx; i++) {
      const o = (j * (nx + 1) + i) * 3;
      pos[o] = x0 + ((x1 - x0) * i) / nx; pos[o + 1] = y; pos[o + 2] = z;
      nor[o] = 0; nor[o + 1] = Math.cos(a); nor[o + 2] = Math.sin(a);
    }
  }
  for (let j = 0; j < na; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
    idx.push(a, d, c, a, c, b);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// look : { wet: uniform (mouillure générale), trail: fonction (x, z) → nœud
// de mouillure du passage du plasmodium (scene/plasmodium.js) }
export function createWood(T, { lite = false, look = {} } = {}) {
  const Wn = woodNodes(T);
  const span = [-1.7 * T.L, 2.7 * T.L];
  // (≈ 0,14 mm entre sommets le long du fil au bureau : plus lâche, le maillage
  // ne suit pas la carte de relief — 43 µm le texel — et les falaises des
  // fentes se dessinent en terrasses dentelées)
  const geo = logGeometry(span[0], span[1], T.R, lite ? 700 : 1350, lite ? 220 : 400, 1.35);
  const m = new THREE.MeshPhysicalNodeMaterial();
  // (déplacement vertical : le point (x, z) du bois est exactement à
  // base(z) + h(x, z), la hauteur où l'on pose tout le reste)
  const disp = (p) => p.add(vec3(0, texture(T.rel, Wn.uvOf(p.x, p.z)).level(0).x, 0));
  m.positionNode = Fn(() => { const q = disp(positionLocal); if (!isLite()) positionPrevious.assign(q); return q; })();
  m.castShadowPositionNode = disp(positionLocal);
  const g = positionGeometry, uv = Wn.uvOf(g.x, g.z);
  const rel = texture(T.rel, uv), alb = texture(T.col, uv);
  // normale : celle du cylindre inclinée par les pentes cuites
  const n0 = Wn.baseNormal(g.z);
  const across = normalize(vec3(0, g.z.negate(), g.y.add(Wn.R)));
  const nW = normalize(n0.add(vec3(rel.y.negate(), 0, 0)).add(across.mul(rel.z.negate())));
  const nV = normalize(modelViewMatrix.mul(vec4(nW, 0)).xyz);
  const micro = noise(g.mul(vec3(18, 160, 160))).mul(0.0006).add(noise(g.mul(vec3(60, 420, 420))).mul(0.00025));
  m.normalNode = perturb(micro, nV);
  let col = alb.rgb, rough = alb.a;
  // fibres du bois plus fines que le texel (43 µm) : de fines stries le long
  // du fil, éteintes quand elles passent sous le pixel. Sans elles, en gros
  // plan, le bois est un aplat flou.
  const fz = g.z.mul(900), n4 = NZ(vec3(g.x.mul(30), fz, g.y.mul(300)));
  // (la poudre se loge dans les creux : l'occlusion cuite en fait des amas, sans lecture de plus)
  const dustClump = float(1.45).sub(rel.w.mul(0.95)).clamp(0, 1);
  {
    const fade = float(1).sub(smoothstep(0.25, 0.7, fwidth(fz)));
    const fib = n4.x.mul(0.7).add(n4.y.mul(0.3));
    col = col.mul(fib.mul(0.16).mul(fade).add(1));
    rough = rough.add(fib.mul(0.06).mul(fade));
  }
  // mouillure : traces du plasmodium (nappe et veines passées), plus sombres et lisses
  const wet = look.trail ? clamp(look.trail(g.x, g.z), 0, 1) : float(0);
  col = col.mul(wet.mul(-0.22).add(1));
  rough = mix(rough, float(0.3), wet.mul(0.7));
  // poussière de spores déposée (vers l'aval des sites)
  // (la poudre s'accroche en amas : elle ne nappe pas le bois)
  if (look.dust) col = mix(col, look.dust.color, clamp(look.dust.at(g.x, g.z).mul(dustClump), 0, 0.85));
  m.colorNode = col;
  m.roughnessNode = rough;
  m.metalnessNode = float(0);
  m.aoNode = rel.w;
  m.mrtNode = stableVelocity();
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true; mesh.castShadow = true;
  mesh.frustumCulled = false;
  return { mesh, nodes: Wn, span };
}
