// La lèvre en volute : là où la vague casse, une nappe d'eau part de la crête,
// s'avance et s'enroule vers le bas (le rouleau d'une vague plongeante).
//
// La surface de la mer est un champ de hauteur : elle ne peut pas se replier.
// La lèvre est donc un objet à part, une grille le long de la côte (une
// colonne tous les ~5 cm) sur la section d'une volute, posée sur la crête que
// la mer relève à chaque image (gen/sea.js, BRK : x de la crête, intensité,
// vitesse de l'eau, hauteur). L'enroulement grandit avec la force du
// déferlement, son rayon avec la hauteur de la crête au-dessus du fond. Rien
// n'est calculé au démarrage.
//
// Matière : une lame d'eau mince, que le soleil traverse à contre-jour
// (vert-turquoise), qui reflète le ciel, et dont le bord, là où elle se
// déchire, blanchit.
import * as THREE from 'three/webgpu';
import { Fn, attribute, float, vec2, vec3, vec4, sin, cos, exp, mix, smoothstep, select, positionWorld, cameraPosition, normalize, dot, varying, mrt, max, uniform } from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';

export function createLip(W, lite) {
  const { U } = W;
  const NC = lite ? 220 : 420, NS = lite ? 10 : 16;
  const LU = { gain: uniform(1) };
  const ga = attribute('lip', 'vec2'); // (place le long de la côte 0..1, s le long de la volute 0..1)

  const zEnd = U.bz0.add(U.bnz.sub(1).mul(U.bdz));
  const z = mix(U.bz0, zEnd, ga.x);
  const s = ga.y;
  const bk = W.breaking(z, W.localT(z, U.t));
  const I = bk.y, xc = bk.x, ec = bk.w;
  const bed = W.simBed(xc, z);
  const crest = ec.sub(bed).max(0);
  const fwd = select(bk.z.lessThan(0), float(-1), float(1));
  // l'enroulement : de 110° (la crête qui se cambre) à 250° (le rouleau qui se referme)
  const curl = smoothstep(3, 16, I);
  const th = s.mul(mix(float(1.9), float(4.4), curl));
  const R = crest.mul(0.42).clamp(0.04, 0.32);
  // (la lèvre s'amincit et se déchire vers son bord ; un peu de bruit le long de la côte)
  const wob = NZ(vec3(z.mul(2.3), s.mul(1.5), G.phase.mul(16))).x.mul(0.25).add(1);
  const off = vec3(fwd.mul(R.mul(sin(th)).add(R.mul(0.25))).mul(wob), R.mul(cos(th).sub(1)).mul(wob), 0);
  const P = vec3(xc, ec, z).add(off);
  // visible là où la vague casse fort, assez haute, et pas contre le dôme
  const camD = vec2(P.x.sub(cameraPosition.x), P.z.sub(cameraPosition.z)).length();
  // (seulement la vague qui arrive, l'eau allant vers la côte : sur le ressaut
  // du retrait, qui court vers le large, la volute vue par la tranche faisait
  // une règle blanche ; et par tronçons le long de la côte, jamais d'un trait)
  const incoming = smoothstep(0.2, 0.7, bk.z);
  const segs = smoothstep(-0.15, 0.25, NZ(vec3(z.mul(0.55), 3.7, G.phase.mul(8))).x.add(NZ(vec3(z.mul(1.7), 9.1, G.phase.mul(16))).y.mul(0.4)));
  // (une vague ne plonge qu'en arrivant sur le haut-fond : au tombant, là où
  // l'eau sous la crête est encore profonde ; sur le platier, le ressaut est
  // déjà cassé — une volute y faisait des bandes blanches à plat)
  const deep = smoothstep(-0.02, -0.25, bed);
  const show = smoothstep(3, 9, I).mul(smoothstep(0.08, 0.18, crest)).mul(smoothstep(2.0, 3.5, camD)).mul(incoming).mul(deep).mul(segs).mul(U.bOn).mul(LU.gain);
  const vShow = varying(show), vS = varying(s), vTh = varying(th);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.positionNode = select(show.greaterThan(0.001), P, vec3(0, -50, 0));
  mat.outputNode = Fn(() => {
    const Pw = positionWorld, v = normalize(cameraPosition.sub(Pw)), dir = v.negate();
    // la normale de la volute (dans le plan x-y), tournée vers la caméra
    const n0 = vec3(fwd.mul(sin(vTh)), cos(vTh), 0);
    const n = select(dot(n0, v).lessThan(0), n0.negate(), n0);
    const cosi = dot(n, v).clamp(0, 1);
    const F = float(0.02).add(float(0.98).mul(float(1).sub(cosi).pow(5)));
    // le soleil à travers la lame (mince : la lumière passe)
    const back = dot(dir, vec3(U.sunDir)).max(0).pow(2).mul(1.2).add(0.15);
    const thin = exp(vec3(U.ext).mul(0.12).negate());
    const body = vec3(U.sunE).mul(thin).mul(back).mul(0.16).add(vec3(U.tint).mul(vec3(U.skyE)).mul(0.6));
    const sky = vec3(U.haze).mul(0.9);
    // le bord se déchire en écume
    const rip = NZ(vec3(Pw.x.mul(9), Pw.y.mul(9), Pw.z.mul(9).add(G.phase.mul(24)))).x;
    const foamE = smoothstep(0.55, 0.95, vS.add(rip.mul(0.25)));
    const lit = vec3(U.sunE).mul(U.sunDir.y.max(0)).mul(0.7).add(vec3(U.skyE).mul(1.1));
    let rgb = mix(body.mul(F.oneMinus()).add(sky.mul(F)), lit.mul(0.88), foamE);
    const al = mix(F.mul(0.6).add(0.55), float(0.92), foamE).mul(vShow).mul(smoothstep(1.0, 0.85, vS.add(rip.mul(0.12)))).clamp(0, 1);
    rgb = W.medium(Pw, cameraPosition, rgb);
    return vec4(rgb.mul(al), al);
  })();
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(0) });

  const pos = new Float32Array(NC * NS * 3), lip = new Float32Array(NC * NS * 2), idx = [];
  for (let c = 0; c < NC; c++) for (let k = 0; k < NS; k++) { const o = c * NS + k; lip[o * 2] = c / (NC - 1); lip[o * 2 + 1] = k / (NS - 1); }
  for (let c = 0; c < NC - 1; c++) for (let k = 0; k < NS - 1; k++) { const a = c * NS + k, b = a + NS; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('lip', new THREE.BufferAttribute(lip, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, LU };
}
