// L'écume, flocon par flocon (gen/sea.js, foamFlakes). Chaque flocon est né
// là où la mer produit de l'écume et suit le courant de surface jusqu'à
// s'échouer ; sa trajectoire est relue ici, à 10 Hz, interpolée. Il est posé
// sur l'eau (ou sur la roche s'il s'est échoué) : un quadrilatère à plat,
// allongé dans le courant, au contour déchiré et troué de bulles. En
// vieillissant, la mousse se défait en dentelle, puis disparaît ; échouée,
// elle jaunit un peu et sèche sur place.
//
// Vue d'en dessous, la mousse est une plaque sombre qui coupe le jour.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, float, vec2, vec3, vec4, floor, fract, mix, smoothstep, uniform, length, max, min, cos, sin, select, positionWorld, cameraPosition,
  textureLoad, texture, ivec2, int, varying, mrt, abs,
} from 'three/tsl';
import { NZ } from '../../../shared/scene/materials.js';

export function createFoam(W, lite) {
  const { U } = W;
  const FU = { K: uniform(80), rate: uniform(10), perRow: uniform(4), on: uniform(0), size: uniform(1) };
  const trajT = texture(W.dataTex(new Uint16Array(8), 2, 2, THREE.HalfFloatType, THREE.RGFormat));
  trajT.value.minFilter = trajT.value.magFilter = THREE.NearestFilter;

  const fl = attribute('fl', 'vec4'); // (naissance, vie, graine, numéro)
  const fc = attribute('fc', 'vec3'); // (coin x, coin y, z le long de la côte)
  const T = U.T;

  // la trajectoire : (x, sur l'eau) à l'âge a
  const at = (a) => {
    const k = a.mul(FU.rate), k0 = floor(k).min(FU.K.sub(2)), w = k.sub(k0).clamp(0, 1);
    const row = floor(fl.w.div(FU.perRow)), col = fl.w.sub(row.mul(FU.perRow)).mul(FU.K);
    const A = textureLoad(trajT, ivec2(int(col.add(k0)), int(row))).xy, B = textureLoad(trajT, ivec2(int(col.add(k0).add(1)), int(row))).xy;
    return mix(A, B, w);
  };
  const age = U.t.sub(fl.x).sub(floor(U.t.sub(fl.x).div(T)).mul(T)); // (replié sur la boucle)
  const life = fl.y, seed = fl.z;
  const tr = at(age.min(life));
  const x = tr.x, z = fc.z, onWater = tr.y;
  const lvl = W.level(x, z, U.t), rock = W.rockAt(x, z);
  const camAbove = cameraPosition.y.greaterThan(W.levelDome(cameraPosition.x, cameraPosition.z, U.t));
  // (à plat, juste au-dessus de l'eau — ou juste au-dessous si on la voit d'en
  // dessous : la surface écrit sa profondeur ; échoué, sur la roche)
  const y = select(onWater.greaterThan(0.5), lvl.add(select(camAbove, float(0.004), float(-0.004))), max(lvl, rock).add(0.003));
  const aF = age.div(life);
  // taille : de 3,5 à 15 cm, s'étale en vieillissant ; allongé dans le courant
  const u = W.sea(x, z, U.t).y;
  const size = float(0.035).add(seed.mul(seed).mul(0.11)).mul(aF.mul(0.8).add(0.7)).mul(onWater.mul(0.4).add(0.6)).mul(FU.size); // (échoué : il se rétracte)
  const ang = seed.mul(37.1).fract().sub(0.5).mul(0.9);
  const sx = size.mul(u.abs().min(2).mul(0.3).add(1)), sz = size.mul(seed.mul(13.7).fract().mul(0.5).add(0.6));
  const ca = cos(ang), sa = sin(ang);
  const lx = fc.x.mul(sx), lz = fc.y.mul(sz);
  const alive = age.lessThan(life).and(FU.on.greaterThan(0.5));
  const P = select(alive, vec3(x.add(lx.mul(ca)).sub(lz.mul(sa)), y, z.add(lx.mul(sa)).add(lz.mul(ca))), vec3(0, -50, 0));

  const vC = varying(vec2(fc.x, fc.y)), vA = varying(aF), vSeed = varying(seed), vWet = varying(onWater), vAge = varying(age);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.positionNode = P;
  mat.outputNode = Fn(() => {
    const c = vC, sd = vSeed.mul(91.3);
    // le contour : déchiré (un rayon bruité), jamais un disque
    const r = length(c).mul(2);
    const edge = r.add(NZ(vec3(c.mul(3.1).add(sd), sd.mul(0.37))).x.mul(0.55)).add(NZ(vec3(c.mul(8.3).add(sd.mul(1.7)), 4.1)).y.mul(0.2));
    const blob = smoothstep(1.0, 0.35, edge);
    // bulles : trous ronds de toutes tailles dans la mousse fraîche
    const b1 = smoothstep(0.18, 0.05, NZ(vec3(c.mul(16).add(sd), 1.3)).z), b2 = smoothstep(0.14, 0.03, NZ(vec3(c.mul(38).add(sd.mul(2.1)), 7.7)).z);
    // (la mousse fraîche : un amas de bulles, dense au cœur, qui s'éclaircit vers le bord)
    const cells = smoothstep(0.55, 0.15, NZ(vec3(c.mul(11).add(sd.mul(1.3)), 3.3)).x.abs());
    const fresh = blob.mul(float(1).sub(b1.mul(0.75)).sub(b2.mul(0.5)).max(0)).mul(cells.mul(0.35).add(0.65));
    // en vieillissant, la mousse se défait en dentelle (un réseau de filaments)
    const web = float(1).sub(NZ(vec3(c.mul(5.5).add(sd), sd.mul(0.21).add(vA.mul(0.6)))).x.abs().mul(3.2)).max(0);
    const lace = blob.mul(smoothstep(0.35, 0.75, web));
    const mask = mix(fresh, lace, smoothstep(0.15, 0.6, vA));
    const fade = smoothstep(0, 0.35, vAge).mul(float(1).sub(smoothstep(0.7, 1.0, vA)));
    // (échouée : plus mince, et elle sèche plus vite)
    // (échouée, la mousse sèche en un voile mince : rien de ces taches de peinture opaques)
    const al = mask.mul(fade).mul(mix(float(0.22), float(0.7), vWet)).mul(select(camAbove, float(1), float(0.55))).clamp(0, 1);
    // éclairée comme l'écume de la surface ; une ombre au cœur (épaisseur)
    const lit = vec3(U.sunE).mul(U.sunDir.y.max(0)).mul(0.7).add(vec3(U.skyE).mul(1.1));
    const shade = float(0.82).add(NZ(vec3(c.mul(6).add(sd.mul(0.5)), 2.2)).x.mul(0.18));
    const tint = mix(vec3(0.82, 0.78, 0.66), vec3(0.88, 0.9, 0.9), vWet); // (échouée : un peu jaunie)
    // (d'en dessous, la mousse coupe le jour : une ombre grise, pas un blanc)
    let rgb = select(camAbove, tint.mul(lit).mul(shade), vec3(U.skyE).mul(0.12).add(vec3(U.tint).mul(vec3(U.skyE)).mul(0.25)));
    rgb = W.medium(positionWorld, cameraPosition, rgb);
    return vec4(rgb.mul(al), al);
  })();
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(0) });

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;

  function setData(F) {
    if (!F) { mesh.visible = false; FU.on.value = 0; return; }
    const t = new THREE.DataTexture(F.traj, F.perRow * F.K, F.rows, THREE.RGFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    trajT.value?.dispose(); trajT.value = t;
    FU.K.value = F.K; FU.rate.value = F.rate; FU.perRow.value = F.perRow; FU.on.value = 1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(F.n * 12), 3));
    g.setAttribute('fl', new THREE.BufferAttribute(F.fl, 4));
    g.setAttribute('fc', new THREE.BufferAttribute(F.fc, 3));
    g.setIndex(new THREE.BufferAttribute(F.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    mesh.geometry.dispose(); mesh.geometry = g;
    mesh.visible = true;
  }
  return { mesh, setData, FU };
}
