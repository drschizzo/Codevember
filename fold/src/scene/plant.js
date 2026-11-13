// La plante à l'écran : folioles, rachis et pétioles instanciés (une
// géométrie, des milliers d'instances, un shader par organe), tiges, fleurs
// et gousses fixes.
//
// Pas d'InstancedMesh (three.js compile un shader par InstancedMesh) : un
// Mesh ordinaire dont la géométrie porte, par instance, sa matrice affine
// (im0…im2, lignes), celle de l'image précédente (ip0…ip2 : les vecteurs
// vitesse de l'anticrénelage temporel) et quatre nombres (ix : tirage, âge,
// mouillé, fermeture), dans un seul tampon entrelacé (un seul tampon de
// sommets de plus). Les poses viennent de pose.js, calculées sur le CPU.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, positionLocal, normalLocal, positionPrevious, positionGeometry, vec3, vec4, float, dot, mat3, normalize, mix, smoothstep,
  abs, uniform, faceDirection, clamp, pow, sin, cos, fract, length, max as tmax, normalViewGeometry, select,
} from 'three/tsl';
import { isLite, stableVelocity, noise, worley, perturb } from './materials.js';
import { atan } from 'three/tsl';
import { FOLD_Y0 } from '../gen/plant.js';
import { G } from '../../../shared/scene/globals.js';

const STRIDE = 32; // (im0…2, ip0…2, ix, iy : état précédent du pli)

// Pli d'un limbe d'un seul tenant (même formule que foldPoint, gen/plant.js) :
// une pliure en arc de demi-largeur y0 le long de la nervure, le reste plan,
// tourné de θ = mix(ouvert, fermé, f) ; renvoie position et normale pliées.
function bendLeaf(p0, n, f, B) {
  // (dionée : la courbure du lobe s'inverse en se fermant — voir trapFlip)
  const luv = attribute('leafuv', 'vec3'), vv = luv.y.clamp(-1, 1);
  const p = vec3(p0.x, p0.y, p0.z.add(B.flip.mul(f.min(1)).mul(-0.3).mul(vv.mul(vv)).mul(sin(luv.x.mul(Math.PI)).mul(0.4).add(0.6))));
  const th = mix(B.open, B.closed, f);
  const s = select(p.y.greaterThanEqual(0), float(1), float(-1));
  const ay = abs(p.y), t = ay.div(B.y0).min(1), a = th.mul(t);
  const ths = select(abs(th).lessThan(1e-4), float(1e-4), th), out = ay.sub(B.y0).max(0);
  const Y = B.y0.mul(sin(a)).div(ths).add(out.mul(cos(th)));
  const Z = B.y0.mul(float(1).sub(cos(a))).div(ths).add(out.mul(sin(th)));
  const pos = vec3(p.x, s.mul(Y.sub(sin(a).mul(p.z))), Z.add(cos(a).mul(p.z)));
  const nys = s.mul(n.y);
  const nrm = vec3(n.x, s.mul(nys.mul(cos(a)).sub(n.z.mul(sin(a)))), nys.mul(sin(a)).add(n.z.mul(cos(a))));
  return { pos, nrm };
}
// position instanciée (et pose précédente, normale) ; full : rendu, sinon
// ombre ; bend : uniformes du pli du limbe (trèfle, dionée), ou null
export function instancedPosition(full, bend = null, rod = null) {
  return Fn(() => {
    const r0 = attribute('im0', 'vec4'), r1 = attribute('im1', 'vec4'), r2 = attribute('im2', 'vec4');
    let pl = positionLocal, nl = normalLocal, plPrev = positionLocal;
    if (rod) {
      // pétiole arqué (ix.z de côté, ix.w vers le haut, en sin πx) ; rachis
      // fléchi (ix.w · x²) — mêmes courbes que petiolePoint / rachisPoint
      const ix = attribute('ix', 'vec4'), x = positionLocal.x;
      const off = rod === 'bow' ? vec3(0, ix.z.mul(sin(x.mul(Math.PI))), ix.w.mul(sin(x.mul(Math.PI)))) : vec3(0, 0, ix.w.mul(x.mul(x)));
      pl = positionLocal.add(off); plPrev = pl;
    }
    if (bend) {
      const ix = attribute('ix', 'vec4'), iy = attribute('iy', 'vec4');
      const b = bendLeaf(positionLocal, normalLocal, ix.w.clamp(0, 1.2), bend);
      pl = b.pos; nl = b.nrm;
      if (full && !isLite()) plPrev = bendLeaf(positionLocal, normalLocal, iy.x.clamp(0, 1.2), bend).pos;
    }
    const p = vec4(pl, 1);
    if (full) {
      if (!isLite()) {
        const q0 = attribute('ip0', 'vec4'), q1 = attribute('ip1', 'vec4'), q2 = attribute('ip2', 'vec4');
        const pp = vec4(plPrev, 1);
        positionPrevious.assign(vec3(dot(q0, pp), dot(q1, pp), dot(q2, pp)));
      }
      // normale : colonnes orthogonales mises à l'échelle → n / s² puis rotation
      const c0 = vec3(r0.x, r1.x, r2.x), c1 = vec3(r0.y, r1.y, r2.y), c2 = vec3(r0.z, r1.z, r2.z);
      normalLocal.assign(normalize(mat3(c0, c1, c2).mul(nl.div(vec3(dot(c0, c0), dot(c1, c1), dot(c2, c2))))));
    }
    return vec3(dot(r0, p), dot(r1, p), dot(r2, p));
  })();
}

function toGeometry(o, instanced = 0) {
  const g = instanced ? new THREE.InstancedBufferGeometry() : new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  if (!instanced) g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  if (o.leafuv) g.setAttribute('leafuv', new THREE.BufferAttribute(o.leafuv, 3));
  g.setIndex(new THREE.BufferAttribute(o.index.length < 65536 && o.position.length / 3 < 65536 ? Uint16Array.from(o.index) : o.index, 1));
  if (instanced) {
    const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(instanced * STRIDE), STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    for (let q = 0; q < 3; q++) g.setAttribute(`im${q}`, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q));
    for (let q = 0; q < 3; q++) g.setAttribute(`ip${q}`, new THREE.InterleavedBufferAttribute(ib, 4, 12 + 4 * q));
    g.setAttribute('ix', new THREE.InterleavedBufferAttribute(ib, 4, 24));
    g.setAttribute('iy', new THREE.InterleavedBufferAttribute(ib, 4, 28));
    g.instanceCount = instanced;
    g.userData.ib = ib;
  }
  g.computeBoundingSphere();
  return g;
}

// ── Matières ─────────────────────────────────────────────────────────────────
export function createPlantLook() {
  return {
    leaf: uniform(new THREE.Color('#4d7a2a')),       // face supérieure
    leafBack: uniform(new THREE.Color('#7f9a5c')),   // face inférieure, plus pâle
    leafYoung: uniform(new THREE.Color('#9cbf4a')),  // jeunes folioles
    trans: uniform(new THREE.Color('#a6d43c')),      // lumière transmise
    translucency: uniform(1),
    stemLow: uniform(new THREE.Color('#6e2f23')), stemHigh: uniform(new THREE.Color('#5d7a32')),
    flower: uniform(new THREE.Color('#f4a6cf')), anther: uniform(new THREE.Color('#f2d04a')),
    pod: uniform(new THREE.Color('#5d5a2c')), height: uniform(2.4),
    // familles (uniformes : pas de recompilation) : intérieur rouge du piège
    // de la dionée, tache centrale du trèfle pourpre
    rough: uniform(0.42), relief: uniform(0.00025), veinFreq: uniform(46),
    sheenTop: uniform(new THREE.Color('#0a0c08')), sheenBack: uniform(new THREE.Color('#3a4630')),
    trap: uniform(0), inner: uniform(new THREE.Color('#9c1f1a')), eye: uniform(new THREE.Color('#d98cc8')), eyeAmt: uniform(0),
  };
}

// folioles : nappe double face, translucide ; nervure médiane, nervilles,
// bord cilié plus pâle ; la face inférieure est plus claire et plus mate
function leafletMaterial(U, bend = null, { wing = false } = {}) {
  // une lame fermée (dessus, dessous, tranche arrondie) : une seule face dessinée
  const m = new THREE.MeshSSSNodeMaterial({ side: THREE.FrontSide });
  m.positionNode = instancedPosition(true, bend);
  m.castShadowPositionNode = instancedPosition(false, bend);
  const g = positionGeometry, ix = attribute('ix', 'vec4'), luv = attribute('leafuv', 'vec3');
  const u = luv.x, y = luv.y.mul(0.5); // (y : en demi-largeurs, la nervure en 0)
  const front = luv.z; // (1 dessus, 0 dessous, ½ tranche)
  const rim = float(1).sub(abs(front.sub(0.5)).mul(2));
  // nervure médiane, nervures secondaires obliques qui partent de la nervure,
  // réseau fin entre elles (Worley du volume de bruit) ; bord plus pâle
  const rib = smoothstep(0.05, 0.0, abs(y)).mul(smoothstep(1.05, 0.7, u));
  const lat = smoothstep(0.82, 1.0, sin(u.mul(U.veinFreq).sub(abs(y).mul(U.veinFreq.mul(0.7)))).mul(0.5).add(0.5)).mul(smoothstep(0.03, 0.12, abs(y))).mul(smoothstep(0.5, 0.3, abs(y)));
  const wn = worley(g.mul(40).add(ix.x.mul(13)));
  const net = smoothstep(0.08, 0.02, wn.y.sub(wn.x)).mul(0.5);
  const veins = lat.add(net.mul(0.4)).clamp(0, 1);
  const edge = smoothstep(0.4, 0.5, abs(y));
  const age = ix.y, rnd = ix.x.sub(0.5);
  let col = mix(U.leafBack, U.leaf, front.clamp(0, 1));
  col = mix(col, U.leafYoung, age.oneMinus().mul(0.5));
  // plus clair à la base, plus soutenu vers la pointe
  col = col.mul(mix(float(1.12), float(0.92), smoothstep(0.0, 0.9, u)));
  // marbrures de la cuticule (lentes, à peine visibles)
  col = col.mul(rnd.mul(0.12).add(1)).mul(noise(g.mul(vec3(6, 14, 14)).add(ix.x.mul(17))).mul(0.08).add(1));
  col = mix(col, col.mul(vec3(1.18, 1.2, 0.88)), rib.mul(0.6).add(veins.mul(0.2)).clamp(0, 1)); // (nervures : un ton, pas un trait de dessin)
  col = mix(col, col.mul(1.1), edge.mul(0.4));
  col = mix(col, U.leafYoung.mul(1.1), smoothstep(0.05, 0.0, u).mul(U.trap.oneMinus()));
  // trèfle pourpre : tache plus claire au centre ; dionée : intérieur rouge
  // ponctué de glandes, bord vert, cils
  col = mix(col, U.eye, (wing ? float(0) : U.eyeAmt).mul(smoothstep(0.6, 0.05, u)).mul(smoothstep(0.45, 0.1, abs(y))).mul(front));
  const glands = smoothstep(0.22, 0.12, worley(g.mul(90)).x);
  const lip = smoothstep(0.43, 0.5, abs(y)), cil = smoothstep(0.5, 0.52, abs(y));
  const trap = wing ? float(0) : U.trap;
  const hair = smoothstep(1.5, 1.6, u); // (poils sensibles : leafuv.x = 2)
  const trapIn = trap.mul(front).mul(lip.oneMinus()).mul(hair.oneMinus());
  // dionée, face externe : verte, rougissant vers la lèvre et la charnière
  col = mix(col, mix(col, U.inner.mul(0.8), smoothstep(0.25, 0.48, abs(y)).mul(0.45).add(smoothstep(0.08, 0.0, abs(y)).mul(0.3))), trap.mul(front.oneMinus()));
  // (le rouge s'assombrit au centre du lobe, s'éclaircit vers la lèvre jaune-vert)
  // (le rouge s'assombrit au centre du lobe, nervures pourpres rayonnantes,
  // glandes humides plus claires)
  const rays = smoothstep(0.75, 1.0, sin(atan(abs(y).add(0.02), u.sub(0.5)).mul(34)).mul(0.5).add(0.5)).mul(0.35);
  col = mix(col, mix(U.inner.mul(mix(float(0.62), float(1.12), smoothstep(0.0, 0.42, abs(y)))).mul(rays.oneMinus().mul(0.25).add(0.75)), U.inner.mul(1.6).add(vec3(0.05, 0.02, 0.0)), glands.mul(0.8)), trapIn);
  col = mix(col, vec3(0.55, 0.62, 0.32), trap.mul(hair));
  col = mix(col, vec3(0.34, 0.42, 0.1), trap.mul(front).mul(smoothstep(0.43, 0.48, abs(y))).mul(cil.oneMinus()).mul(0.6)); // (lèvre : un filet vert-jaune, pas une bordure crème)
  col = mix(col, mix(U.leaf.mul(1.1), U.inner, 0.3), trap.mul(cil).mul(hair.oneMinus()));
  const wet = ix.z;
  col = col.mul(wet.mul(-0.22).add(1));
  m.colorNode = col;
  // cuticule : dessus lustré, dessous mat et duveteux ; intérieur du piège
  // humide (glandes), mouillure
  m.roughnessNode = mix(mix(float(0.62), U.rough, front), float(0.14), wet.max(trapIn.mul(0.6)));
  // cuticule cireuse de la dionée (dehors), glandes humides (dedans)
  m.clearcoatNode = trap.mul(mix(float(0.55), float(0.35), front));
  m.clearcoatRoughnessNode = float(0.22);
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(0.6);
  m.sheenNode = mix(U.sheenBack, U.sheenTop, front).mul(float(1).sub(trapIn)).mul(trap.oneMinus());
  m.sheenRoughnessNode = float(0.45);
  // relief : nervures en creux dessus, en saillie dessous (normale perturbée)
  const H = rib.mul(0.8).add(veins.mul(0.5)).mul(front.mul(2).sub(1).negate()).sub(glands.mul(trapIn).mul(0.6)).mul(U.relief).mul(rim.oneMinus());
  m.normalNode = perturb(H, normalViewGeometry);
  // lumière transmise : une feuille transmet ~10 % (vert-jaune), moins à travers
  // les nervures ; la tranche n'en transmet pas
  m.thicknessColorNode = U.trans.mul(U.translucency).mul(0.16).mul(rib.mul(-0.6).add(1)).mul(veins.mul(-0.3).add(1)).mul(age.oneMinus().mul(0.35).add(0.85)).mul(rim.oneMinus());
  m.thicknessDistortionNode = float(0.18);
  m.thicknessAmbientNode = float(0.02);
  m.thicknessAttenuationNode = float(1.0);
  m.thicknessPowerNode = float(3.0);
  m.thicknessScaleNode = float(1.6);
  m.mrtNode = stableVelocity();
  return m;
}
function rodMaterial(U, petiole) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.positionNode = instancedPosition(true, null, petiole ? 'bow' : 'sag');
  m.castShadowPositionNode = instancedPosition(false, null, petiole ? 'bow' : 'sag');
  const ix = attribute('ix', 'vec4'), x = positionGeometry.x;
  const base = petiole ? mix(U.stemLow.mul(1.25), U.stemHigh, smoothstep(0.05, 0.6, x)) : U.stemHigh.mul(1.05);
  m.colorNode = base.mul(ix.x.sub(0.5).mul(0.15).add(1));
  m.roughnessNode = float(0.55);
  m.sheenNode = vec3(0.25, 0.28, 0.2); // (poils fins)
  m.sheenRoughnessNode = float(0.4);
  m.mrtNode = stableVelocity();
  return m;
}
// tiges, aiguillons, stipules
function stemMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const s = attribute('surf', 'vec4'), h = positionGeometry.y.div(U.height);
  // (tige rouge brun, verte seulement vers les pousses ; stries le long de la tige)
  const bark = mix(U.stemLow, U.stemHigh, smoothstep(0.7, 1.05, h).mul(0.8)).mul(noise(positionGeometry.mul(vec3(30, 4, 30))).mul(0.14).add(1));
  const prick = vec3(0.78, 0.62, 0.45), stip = mix(U.stemHigh, vec3(0.7, 0.62, 0.4), 0.5);
  m.colorNode = bark.mul(s.x).add(prick.mul(s.y)).add(stip.mul(s.z));
  m.roughnessNode = float(0.5).add(s.y.mul(0.1));
  m.sheenNode = vec3(0.35, 0.3, 0.25).mul(s.x);
  m.sheenRoughnessNode = float(0.35);
  m.mrtNode = stableVelocity();
  return m;
}
function flowerMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const s = attribute('surf', 'vec4');
  m.colorNode = U.flower.mul(s.x).add(U.anther.mul(s.y)).add(U.stemHigh.mul(1.2).mul(s.z));
  m.roughnessNode = float(0.45).add(s.y.mul(0.2));
  m.sheenNode = U.flower.mul(0.5).mul(s.x);
  m.sheenRoughnessNode = float(0.3);
  m.mrtNode = stableVelocity();
  return m;
}
function podMaterial(U) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const s = attribute('surf', 'vec4');
  const c = U.pod.mul(noise(positionGeometry.mul(40)).mul(0.1).add(1));
  m.colorNode = c.mul(s.x).add(vec3(0.55, 0.4, 0.22).mul(s.z.add(s.y)));
  m.roughnessNode = float(0.6);
  m.sheenNode = vec3(0.3, 0.28, 0.2);
  m.sheenRoughnessNode = float(0.4);
  m.mrtNode = stableVelocity();
  return m;
}

// ── La plante ────────────────────────────────────────────────────────────────
export function createPlant(group, { lite = false } = {}) {
  const U = createPlantLook();
  const parts = {};
  let poser = null, counts = null, lastTau = null;
  const mats = [];

  function clear() {
    for (const k of Object.keys(parts)) { const m = parts[k]; group.remove(m); m.geometry.dispose(); }
    for (const m of mats) m.dispose();
    mats.length = 0;
    for (const k of Object.keys(parts)) delete parts[k];
  }

  // meshes : tampons du worker ; plant : architecture (pour le tirage des
  // instances) ; p : poser (pose.js)
  function set(meshes, plant, p) {
    clear();
    poser = p; counts = p.counts; lastTau = null;
    const add = (name, geo, mat, { cast = true, receive = true } = {}) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.frustumCulled = !geo.isInstancedBufferGeometry;
      group.add(mesh); parts[name] = mesh; mats.push(mat);
      return mesh;
    };
    // (trèfle, dionée : un seul limbe par paire, plié dans le shader)
    const fold = plant.leaves[0]?.pinnae[0]?.fold;
    const bend = fold?.half ? { open: uniform(fold.open), closed: uniform(fold.closed), y0: uniform(FOLD_Y0), flip: uniform(fold.shape === 'trap' ? 1 : 0) } : null;
    add('left', toGeometry(meshes.leafletL, counts.pairs), leafletMaterial(U, bend));
    if (!bend) add('right', toGeometry(meshes.leafletR, counts.pairs), leafletMaterial(U));
    // (dionée : le pétiole ailé est une feuille — même matière translucide)
    add('petiole', toGeometry(meshes.petiole, counts.leaves), plant.family === 'dionaea' ? leafletMaterial(U, null, { wing: true }) : rodMaterial(U, true));
    add('rachis', toGeometry(meshes.rachis, counts.pinnae), rodMaterial(U, false));
    add('stems', toGeometry(meshes.stems), stemMaterial(U));
    if (meshes.flowers) add('flowers', toGeometry(meshes.flowers), flowerMaterial(U));
    if (meshes.pods) add('pods', toGeometry(meshes.pods), podMaterial(U));
    U.height.value = plant.H;
    // tirages par instance : nuance, âge (feuilles du bout plus jeunes)
    const seedOf = (i, k) => fract1(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453);
    const fill = (mesh, n, ageOf) => {
      const a = mesh.geometry.userData.ib.array;
      for (let i = 0; i < n; i++) { a[i * STRIDE + 24] = seedOf(i, 1); a[i * STRIDE + 25] = ageOf(i); }
    };
    const ageOfPair = (i) => { const q = p.pairs[i]; return 1 - plant.leaves[q.leaf].young * 0.9; };
    fill(parts.left, counts.pairs, ageOfPair); if (parts.right) fill(parts.right, counts.pairs, ageOfPair);
    fill(parts.petiole, counts.leaves, (i) => 1 - plant.leaves[i].young);
    fill(parts.rachis, counts.pinnae, () => 1);
    // courbes propres à chaque pièce (attributs fixes : ix.z, ix.w)
    { const a = parts.petiole.geometry.userData.ib.array; plant.leaves.forEach((L, i) => { a[i * STRIDE + 26] = L.bow?.[0] ?? 0; a[i * STRIDE + 27] = L.bow?.[1] ?? 0; }); }
    { const a = parts.rachis.geometry.userData.ib.array; p.pinnae.forEach((q, j) => { a[j * STRIDE + 26] = 0; a[j * STRIDE + 27] = q.P.sag ?? 0; }); }
  }
  const fract1 = (x) => x - Math.floor(x);

  // pose à l'instant physique τ ; wet(k, side) : mouillure de la foliole
  function update(tau, wetOf) {
    if (!poser) return;
    const o = poser.update(tau);
    // (un saut dans le temps — pas à pas, début de boucle — n'est pas un mouvement)
    const jump = lastTau == null || Math.abs(tau - lastTau) > 30;
    lastTau = tau;
    const write = (mesh, src, n, extra) => {
      const ib = mesh.geometry.userData.ib, a = ib.array;
      for (let i = 0; i < n; i++) {
        const b = i * STRIDE, s = i * 12;
        // précédente ← courante, courante ← nouvelle
        if (jump) for (let j = 0; j < 12; j++) a[b + 12 + j] = src[s + j];
        else for (let j = 0; j < 12; j++) a[b + 12 + j] = a[b + j];
        for (let j = 0; j < 12; j++) a[b + j] = src[s + j];
        if (extra) extra(a, b, i);
      }
      ib.needsUpdate = true;
    };
    // (ix.w : fermeture ; iy.x : celle de l'image précédente)
    const st = (a, b, i, side) => { a[b + 26] = wetOf ? Math.max(wetOf(i, side), parts.right ? 0 : wetOf(i, -side)) : 0; a[b + 28] = jump ? o.state[i] : a[b + 27]; a[b + 27] = o.state[i]; };
    write(parts.left, o.left, counts.pairs, (a, b, i) => st(a, b, i, 1));
    if (parts.right) write(parts.right, o.right, counts.pairs, (a, b, i) => st(a, b, i, -1));
    write(parts.petiole, o.petiole, counts.leaves);
    write(parts.rachis, o.rachis, counts.pinnae);
  }

  return { set, update, U, parts, get poser() { return poser; } };
}
