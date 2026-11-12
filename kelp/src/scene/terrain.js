// La roche du platier : une grille dense près de la caméra, déplacée dans le
// vertex shader par le relief cuit (gen/rock.js, la même surface que la
// simulation), avec sa normal map, sa couleur minérale, l'occlusion de ses
// creux, un micro-relief procédural pour le gros plan — et l'eau : la roche
// fonce et brille là où la mer vient de passer, puis sèche par le haut.
import * as THREE from 'three/webgpu';
import { Fn, vec2, vec3, vec4, float, positionLocal, normalLocal, positionWorld, cameraPosition, cameraViewMatrix, texture, normalize, mix, smoothstep, max, select, uniform, normalView, transformNormalToView, pow } from 'three/tsl';
import { gridGeometry, spacing } from './water.js';
import { fbm, noise, perturb, NZ } from './materials.js';
import { G } from './globals.js';

export function createTerrain(W, lite) {
  const { U } = W;
  const geo = gridGeometry(spacing(-150, -3.6, 3.2, 60, lite ? 0.04 : 0.028, 1.09), spacing(-250, -7, 2.8, 60, lite ? 0.04 : 0.028, 1.09));
  const colT = texture(W.dataTex(new Uint8Array(16), 2, 2, THREE.UnsignedByteType));
  colT.value.colorSpace = THREE.SRGBColorSpace;
  const RU = { base: uniform(new THREE.Color(0.4, 0.35, 0.3)), wetDark: uniform(0.55), micro: uniform(1), grain: uniform(1) };
  const mat = new THREE.MeshStandardNodeMaterial();
  // relief : déplacement des sommets et normale du relief cuit
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const x = p.x, z = p.z;
    const inb = W.inBox(x, z);
    const g = W.reliefT.sample(W.boxUV(x, z)).level(0);
    const pr = W.profAt(x);
    const h = mix(pr, g.x, inb);
    // (hors de la boîte : pente du profil, lue seule)
    const e = 0.05, gp = W.profAt(x.add(e)).sub(W.profAt(x.sub(e))).div(2 * e);
    const gx = mix(gp, g.y, inb), gz = mix(float(0), g.z, inb);
    normalLocal.assign(normalize(vec3(gx.negate(), 1, gz.negate())));
    return vec3(x, h, z);
  })();
  // couleur, eau, micro-relief
  const P = positionWorld;
  const inb = W.inBox(P.x, P.z);
  const tex = colT.sample(W.boxUV(P.x, P.z));
  const relief = W.reliefT.sample(W.boxUV(P.x, P.z));
  const H = P.y; // (la position est déjà la roche : rien à relire)
  const far = vec3(RU.base).mul(NZ(P.mul(0.8)).x.mul(0.22).add(0.9));
  // (sur les faces raides — le tombant, les fronts des feuillets —, la carte
  // vue de dessus s'étire en stries : une couleur tirée du volume de bruit en
  // 3D, de la même teinte, la remplace)
  const gN0 = normalize(mix(vec3(0, 1, 0), vec3(relief.y.negate(), 1, relief.z.negate()), inb));
  const steep = smoothstep(0.8, 0.5, gN0.y);
  const side = vec3(RU.base).mul(NZ(P.mul(7)).x.mul(0.3).add(NZ(P.mul(23)).y.mul(0.15)).add(0.85)).mul(0.9);
  const albedo0 = mix(mix(far, tex.rgb, inb), side, steep);
  // mouillé : sous l'enveloppe de séchage (la mer vient d'y passer), ou dans l'eau
  const lv = W.levelNear(P.x, P.z, U.t);
  const under = smoothstep(0.0, 0.004, lv.sub(H));
  const wet = max(smoothstep(-0.004, 0.006, W.wetLevel(P.x, P.z, U.t).sub(H)), under).max(smoothstep(-0.3, -0.6, H));
  // grain minéral (cristaux de 1 à 3 mm) : taches sombres et claires
  const gr = NZ(P.mul(vec3(260, 260, 260))).w, gr2 = NZ(P.mul(vec3(110, 110, 110)).add(3.3)).w;
  const camD = positionWorld.sub(cameraPosition).length();
  const near = smoothstep(4, 0.6, camD); // (le grain s'efface avant la fréquence du pixel)
  const speck = smoothstep(0.1, 0.0, gr).mul(-0.45).add(smoothstep(0.08, 0.0, gr2).mul(0.25)).mul(RU.grain).mul(near);
  const albedoS = albedo0.mul(speck.add(1));
  const albedo = mix(albedoS, pow(albedoS, vec3(1.45)).mul(RU.wetDark), wet);
  mat.colorNode = albedo;
  // la pellicule d'eau sur la roche découverte brille ; sous l'eau, non
  mat.roughnessNode = mix(mix(float(0.85), tex.a, inb), float(0.16), wet.mul(under.oneMinus())).max(G.roughFloor);
  mat.metalnessNode = float(0);
  // micro-relief : grain et cristaux (le gros plan), estompé à l'approche du pixel
  const hMicro = fbm(P.mul(28), 2).mul(0.0035).add(NZ(P.mul(140)).x.mul(0.0006)).add(NZ(P.mul(420)).y.mul(0.00025).mul(near)).mul(RU.micro).mul(G.microDetail).mul(wet.mul(0.5).oneMinus());
  // normale lue au pixel dans le relief cuit (pas interpolée entre les
  // sommets : sur une pente raide, l'interpolation dessinait les triangles)
  const gN = gN0;
  const nV = cameraViewMatrix.mul(vec4(gN, 0)).xyz;
  mat.normalNode = perturb(hMicro, normalize(nV));
  mat.aoNode = mix(float(1), relief.a, inb);
  mat.receivedShadowNode = W.receivedShadow;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, colT, RU };
}
