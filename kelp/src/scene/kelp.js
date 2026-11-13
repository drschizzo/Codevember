// Les laminaires à l'écran : toutes les lanières et tous les stipes en un seul
// maillage (gen/scene.js, strapGeometry). Le vertex shader lit, pour chaque
// sommet, les positions et les directeurs enregistrés des quatre nœuds de sa
// travée (textures nœud × image, interpolées entre deux images), trace la
// spline de Catmull-Rom qui les joint et pose la section : une ellipse très
// aplatie pour une lame (épaisse au milieu, fine au bord), un cercle pour un
// stipe. La même formule sert à la pose précédente (vecteurs vitesse).
//
// Matière : brun mouillé, olive ou or selon la famille ; translucide à
// contre-jour (diffusion sous la surface) ; vernie de mucilage à l'air, mate
// dans l'eau ; sores sombres, pointes usées et plus claires.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, textureLoad, texture, ivec2, int, vec2, vec3, vec4, float, mix, normalize, cross, dot, sin, cos, floor, fract, positionLocal, normalLocal,
  positionPrevious, positionWorld, uniform, smoothstep, max, select, abs, varying, color, normalView, mx_cell_noise_float,
} from 'three/tsl';
import { fbm, noise, NZ, perturb } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';

export function createKelp(W, lite) {
  let fringe = false;
  const { U } = W;
  const KU = {
    fps: uniform(30), nf: uniform(960),
    blade: uniform(new THREE.Color(0.06, 0.03, 0.01)), stipe: uniform(new THREE.Color(0.04, 0.02, 0.008)), light: uniform(new THREE.Color(0.3, 0.15, 0.03)),
  };
  const posT = texture(W.dataTex(new Uint16Array(16), 2, 2));
  const dirT = texture(W.dataTex(new Uint8Array(16), 2, 2, THREE.UnsignedByteType));
  posT.value.minFilter = posT.value.magFilter = THREE.NearestFilter;
  dirT.value.minFilter = dirT.value.magFilter = THREE.NearestFilter;

  const nid = attribute('nidx', 'vec4'), seg = attribute('seg', 'vec4'), sect = attribute('sect', 'vec4'), anch = attribute('anch', 'vec4');
  const P_ = (i, f) => textureLoad(posT, ivec2(int(i), int(f))).xyz;
  const D_ = (i, f) => textureLoad(dirT, ivec2(int(i), int(f))).xyz.mul(2).sub(1);
  // pose d'un sommet à l'instant t (secondes dans la boucle)
  const pose = (t) => {
    const ft = t.mul(KU.fps), fl = floor(ft), w = ft.sub(fl);
    const f0 = fl.sub(floor(fl.div(KU.nf)).mul(KU.nf)), f1 = f0.add(1).sub(floor(f0.add(1).div(KU.nf)).mul(KU.nf));
    const at = (i) => mix(P_(i, f0), P_(i, f1), w);
    const pa = at(nid.x), pb = at(nid.y), pc = at(nid.z), pd = at(nid.w);
    const s = seg.x, s2 = s.mul(s), s3 = s2.mul(s);
    // Catmull-Rom uniforme et sa dérivée
    const P = pb.mul(2).add(pc.sub(pa).mul(s)).add(pa.mul(2).sub(pb.mul(5)).add(pc.mul(4)).sub(pd).mul(s2)).add(pb.mul(3).sub(pa).sub(pc.mul(3)).add(pd).mul(s3)).mul(0.5);
    const T = normalize(pc.sub(pa).add(pa.mul(2).sub(pb.mul(5)).add(pc.mul(4)).sub(pd).mul(s.mul(2))).add(pb.mul(3).sub(pa).sub(pc.mul(3)).add(pd).mul(s2.mul(3))).add(vec3(0, 1e-5, 0)));
    // directeur : le long de la largeur (au premier tronçon d'une lanière, celui du nœud suivant)
    const dirAt = (i) => { const a = D_(i, f0), b = D_(i, f1); return mix(a, select(dot(a, b).lessThan(0), b.negate(), b), w); };
    const dc = dirAt(nid.z), db0 = dirAt(nid.y);
    const db = select(seg.w.greaterThan(0.5), dc, select(dot(db0, dc).lessThan(0), db0.negate(), db0));
    let B = mix(db, dc, s);
    B = B.sub(T.mul(dot(B, T)));
    B = normalize(B.add(cross(T, vec3(0.31, 0.93, 0.19)).mul(1e-4)));
    const F = cross(T, B);
    const hw = sect.x, ht = sect.y, th = seg.y;
    const c = cos(th), sn = sin(th);
    // bord ondulé (la marge d'une lame pousse plus vite que son milieu)
    // (dans l'eau, le bord ondule : des ondes courent vers la pointe — 21
    // périodes par boucle, ~1,5 s ; à l'air, il retombe figé)
    const wet = smoothstep(-0.01, 0.03, W.level(P.x.add(anch.x), P.z.add(anch.z), t).sub(P.y.add(anch.y)));
    const flutter = sin(seg.z.mul(46).add(sect.w.mul(30)).sub(t.div(U.T).mul(2 * Math.PI * 21))).mul(wet.mul(0.6).add(0.4));
    const ruffle = flutter.mul(c.mul(c)).mul(hw).mul(mix(float(0.22), float(0.32), wet)).mul(sect.z).mul(smoothstep(0.1, 0.3, seg.z));
    const p = P.add(anch.xyz).add(B.mul(hw.mul(c))).add(F.mul(ht.mul(sn).add(ruffle)));
    const n = normalize(B.mul(ht.mul(c)).add(F.mul(hw.mul(sn))));
    return { p, n, B, F, T };
  };
  // (un matériau neuf à chaque nouvelle géométrie : three.js ne recompile pas un
  // objet dont on change seulement la géométrie, et ses attributs manqueraient)
  function makeMat() {
  const mat = new THREE.MeshSSSNodeMaterial();
  mat.positionNode = Fn(() => {
    const now = pose(U.t);
    normalLocal.assign(now.n);
    positionPrevious.assign(pose(U.tPrev).p);
    return now.p;
  })();
  // ── matière ──
  const Pw = positionWorld;
  const u = seg.z, kind = sect.z, rk = sect.w;
  const under = smoothstep(-0.003, 0.004, W.level(Pw.x, Pw.z, U.t).sub(Pw.y));
  const n1 = fbm(Pw.mul(9).add(rk.mul(40)), 3);
  // sores : plaques sombres au milieu des lames ; pointes usées, plus claires et translucides
  const sori = smoothstep(0.15, 0.4, NZ(Pw.mul(3.5).add(rk.mul(17))).x.add(0.1)).mul(smoothstep(0.25, 0.4, u)).mul(smoothstep(0.85, 0.65, u)).mul(kind);
  const tips = smoothstep(0.7, 1.0, u).mul(kind);
  let col = mix(vec3(KU.stipe), vec3(KU.blade), kind);
  col = mix(col, vec3(KU.light), tips.mul(0.35).add(n1.mul(0.12).add(0.06)).clamp(0, 1));
  col = col.mul(float(1).sub(sori.mul(0.35)));
  mat.colorNode = col;
  mat.roughnessNode = mix(float(0.38), float(0.5), under).add(n1.mul(0.1));
  mat.metalnessNode = float(0);
  // mucilage : un vernis à l'air, rien dans l'eau
  mat.clearcoatNode = mix(float(0.35), float(0.0), under).mul(kind.mul(0.4).add(0.6));
  mat.clearcoatRoughnessNode = float(0.12).add(n1.abs().mul(0.15));
  // translucidité (Barré-Brisebois) : la lame s'allume à contre-jour, ambrée
  // (sous l'eau, le soleil réfracté vient d'en haut, à moins de 49° de la
  // verticale : une lame vue de côté n'est plus à contre-jour — sans cela, les
  // lames immergées s'allumaient comme des néons)
  // (la lumière ne passe que là où la lame est mince : marges et pointes)
  const margin = smoothstep(0.55, 1.0, seg.y.cos().abs());
  mat.thicknessColorNode = vec3(KU.light).mul(mix(float(0.3), float(0.8), kind)).mul(max(tips, margin).mul(0.85).add(0.15)).mul(mix(float(1), float(0.12), under));
  mat.thicknessDistortionNode = float(0.15);
  mat.thicknessAmbientNode = float(0.0);
  mat.thicknessAttenuationNode = float(0.9);
  mat.thicknessPowerNode = float(3.0);
  mat.thicknessScaleNode = mix(float(0.3), float(1.4), kind);
  // stries le long de la lame, grain de la surface
  // (le relief court dans la LONGUEUR de la lame : les reflets s'y étirent en
  // filets, comme sur une lame vernie de mucilage ; des stries en travers
  // donnaient un velours côtelé)
  const across = seg.y.cos();
  const hStri = noise(vec3(seg.z.mul(3), across.mul(7), rk.mul(9))).mul(0.0005).mul(kind); // (rides douces : plus fin, le relief faisait une peau de serpent)
  mat.normalNode = perturb(hStri, normalView);
  mat.receivedShadowNode = W.receivedShadow;
  if (fringe) {
    // boa : la lanière est frangée de lamelles (un peigne découpé dans ses marges)
    // (lamelles de longueur, de largeur et d'espacement irréguliers : un peigne
    // régulier se lisait comme une fermeture éclair)
    const ax = seg.y.cos().abs();
    const q = seg.z.mul(150).add(noise(vec3(seg.z.mul(31), rk.mul(13), 0.5)).mul(2.5)), cell = floor(q), f = fract(q);
    const hL = mx_cell_noise_float(vec2(cell, rk.mul(97))), hW = mx_cell_noise_float(vec2(cell, rk.mul(97).add(7)));
    const len = hL.mul(hL).mul(0.75).add(0.25), wid = hW.mul(0.35).add(0.55); // (lamelles larges et serrées : des feuilles, pas des épines)
    const out = ax.sub(0.42).div(float(0.58).mul(len)); // (0 à la base de la lamelle, 1 à sa pointe)
    const lam = f.sub(0.5).abs().lessThan(wid.mul(0.5).mul(float(1).sub(out.mul(0.7)))).and(out.lessThan(1)).and(hL.greaterThan(0.12));
    const keep = ax.lessThan(0.42).or(lam).or(kind.lessThan(0.5));
    mat.maskNode = keep;
    mat.maskShadowNode = keep;
  }
  return mat;
  }
  const mesh = new THREE.Mesh(new THREE.BufferGeometry());
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // crampons : un maillage fixe
  function makeHoldMat() {
    const hmat = new THREE.MeshStandardNodeMaterial();
    const hn = fbm(positionWorld.mul(30), 3);
    hmat.colorNode = vec3(KU.stipe).mul(hn.mul(0.25).add(0.85));
    hmat.roughnessNode = mix(float(0.3), float(0.55), smoothstep(-0.003, 0.004, W.level(positionWorld.x, positionWorld.z, U.t).sub(positionWorld.y)));
    hmat.receivedShadowNode = W.receivedShadow;
    return hmat;
  }
  const hold = new THREE.Mesh(new THREE.BufferGeometry());
  hold.visible = false;
  hold.frustumCulled = false;
  hold.castShadow = true; hold.receiveShadow = true;

  function setData(K, R) {
    const n = K.n, nf = K.nf;
    const pt = new THREE.DataTexture(K.pos, n, nf, THREE.RGBAFormat, THREE.HalfFloatType);
    const dt = new THREE.DataTexture(K.dir, n, nf, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [pt, dt]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; }
    posT.value?.dispose(); dirT.value?.dispose();
    posT.value = pt; dirT.value = dt;
    KU.fps.value = K.fps; KU.nf.value = nf;
    const S = K.straps;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(S.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S.position.length).fill(0.5), 3));
    g.setAttribute('nidx', new THREE.BufferAttribute(S.nidx, 4));
    g.setAttribute('seg', new THREE.BufferAttribute(S.seg, 4));
    g.setAttribute('sect', new THREE.BufferAttribute(S.sect, 4));
    g.setAttribute('anch', new THREE.BufferAttribute(S.anch, 4));
    g.setIndex(new THREE.BufferAttribute(S.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    mesh.geometry.dispose(); mesh.geometry = g;
    fringe = !!K.fringe;
    mesh.material?.dispose?.(); mesh.material = makeMat(); mesh.visible = true;
    const H = K.holdfasts, hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(H.position, 3));
    hg.setAttribute('normal', new THREE.BufferAttribute(H.normal, 3));
    hg.setIndex(new THREE.BufferAttribute(H.index, 1));
    hg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    hold.geometry.dispose(); hold.geometry = hg;
    hold.material?.dispose?.(); hold.material = makeHoldMat(); hold.visible = true;
    const C = R.kelp.color, lin = (h) => new THREE.Color(h); // (THREE.Color convertit le sRGB en linéaire)
    KU.blade.value.copy(lin(C.blade)); KU.stipe.value.copy(lin(C.stipe)); KU.light.value.copy(lin(C.light));
  }
  return { mesh, hold, setData, KU };
}
