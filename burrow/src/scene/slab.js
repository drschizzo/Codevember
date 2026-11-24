// La tranche de sable vue à travers son verre : un maillage dense (une
// cellule, un sommet) déplacé vers l'arrière par la profondeur des galeries,
// pour que la lumière entre vraiment dans les tunnels et que leurs ombres
// tombent sur leur plancher. Le sable est fait de grains (cellules de Voronoï
// de 0,35 mm) tirés d'un mélange de minéraux propre à chaque couche : la
// couleur d'une couche est une moyenne, pas une teinte.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, texture, uv, vec2, vec3, vec4, float, positionLocal, normalize, dot, fract, sin, floor, mix, smoothstep,
  max, min, abs, length, fwidth, select, clamp, transformNormalToView, int, exp, step,
} from 'three/tsl';
import { SLAB } from '../gen/slab.js';
import { NZ } from '../../../shared/scene/materials.js';

// fenêtre d'arrachage d'un grain, en part de la vie de la tranche : ~1 mm de
// galerie au front (plus large, une gorge à peine amorcée se dessinait devant
// le front, sur 1 à 2 cm, avant d'être creusée)
const OPEN = 0.0008;


export function createSlab({ lite = false } = {}) {
  const blank = new THREE.DataTexture(new Uint16Array(4 * 4), 2, 2, THREE.RGBAFormat, THREE.HalfFloatType);
  const tA = texture(blank);
  const blankB = new THREE.DataTexture(new Uint16Array(8), 2, 2, THREE.RGFormat, THREE.HalfFloatType);
  const tB = texture(blankB);
  const U = {
    size: uniform(new THREE.Vector2(SLAB.W, 2.9)), texel: uniform(new THREE.Vector2(1 / 800, 1 / 725)),
    pal: uniformArray(Array.from({ length: 8 }, () => new THREE.Color(0.6, 0.5, 0.4)), 'color'),
    quartz: uniform(new THREE.Color('#e9e4d8')), dark: uniform(new THREE.Color('#2f2a26')),
    mix: uniform(new THREE.Vector3(0.68, 0.16, 0.1)), nSign: uniform(1), age: uniform(1), depthMax: uniform(SLAB.DEPTH),
    // par sable (indice de couleur) : taille du grain (unités) et part de paillettes de mica
    sun: uniform(new THREE.Vector3(-0.7, 0.4, 0.5)), // (direction du soleil, repère de la tranche)
    gsize: uniformArray(Array.from({ length: 8 }, () => 0.0035), 'float'),
    kind: uniformArray(Array.from({ length: 8 }, () => 0), 'float'), // (0 sable, 1 verre pilé, 2 billes de verre, 3 nacre)
    mica: uniformArray(Array.from({ length: 8 }, () => 0), 'float'),
  };
  const A0 = (q) => tA.sample(q).level(0);
  const Bt = (q) => tB.sample(q).level(0).x;
  const Bn = (q) => tB.sample(q).level(0); // (au plus proche : apparition, indice de couleur)
  // la cellule à l'âge s : (couche, lamine, profondeur, sable 1 / air 0). Le
  // dessus du sable est un bord net contre le verre (une fuite en profondeur du
  // dessus du tas tirait des triangles en échardes au sommet du talus).
  const A = (q) => {
    const a = A0(q), b = Bn(q);
    const solid = b.x.lessThanEqual(U.age);
    const dig = smoothstep(a.z, a.z.add(OPEN), U.age).mul(step(a.z, float(8)));
    return vec4(b.y, a.y, a.w.mul(dig), select(solid, float(1), float(0)));
  };
  const hash = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const hash2 = (p) => vec2(hash(p), hash(p.add(vec2(17.3, 41.9))));

  // profondeur brute d'une cellule à l'âge s (sans le dessus du tas)
  const depthAt = (q) => { const a = A0(q); return a.w.mul(smoothstep(a.z, a.z.add(OPEN), U.age)).mul(step(a.z, float(8))); };

  // déplacement : la profondeur, vers l'arrière
  const positionNode = Fn(() => {
    const a = A(uv());
    return vec3(positionLocal.x, positionLocal.y, a.z.negate());
  })();

  // normale du relief (différences centrées sur la carte de profondeur)
  const reliefN = (q) => {
    const e = U.texel;
    const dx = depthAt(q.add(vec2(e.x, 0))).sub(depthAt(q.sub(vec2(e.x, 0)))).div(e.x.mul(U.size.x).mul(2));
    const dy = depthAt(q.add(vec2(0, e.y))).sub(depthAt(q.sub(vec2(0, e.y)))).div(e.y.mul(U.size.y).mul(2));
    return normalize(vec3(dx.mul(U.nSign), dy.mul(U.nSign), 1)); // (z = −profondeur)
  };

  // les grains : Voronoï 2D, 9 cellules, à la taille du sable de la couche
  const grains = (p, gs) => {
    const q = p.div(gs), ic = floor(q), fc = fract(q);
    let f1 = float(9), f2 = float(9), id = vec2(0), r = vec2(0), cen = vec2(0);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const o = vec2(x, y), c = ic.add(o), s = o.add(hash2(c).mul(0.75).add(0.125)), d = fc.sub(s), l = length(d);
      const closer = l.lessThan(f1);
      f2 = select(closer, f1, min(f2, l));
      id = select(closer, c, id); r = select(closer, d, r); cen = select(closer, ic.add(s), cen);
      f1 = min(f1, l);
    }
    return { f1, f2, id, r, center: cen.mul(gs), fw: fwidth(q.x) };
  };
  // un grain : son sable est celui de la couche où tombe son centre (avec une
  // petite dérive) — les frontières sont grenues, comme dans le vrai sable
  const grainData = () => {
    const q = uv(), p = q.mul(U.size), a = A(q);
    const kPix = int(a.x.add(0.5));
    const gs = U.gsize.element(kPix);
    const G = grains(p, gs);
    const drift = hash2(G.id.add(vec2(5.3, 2.9))).sub(0.5).mul(gs.mul(2.4));
    const cq = G.center.add(drift).div(U.size);
    const bc = Bn(cq);
    const inSand = bc.x.lessThanEqual(U.age).and(bc.x.lessThan(8));
    const k = select(inSand, int(bc.y.add(0.5)), kPix);
    // sable frais des déblais : humide, plus sombre, il pâlit en séchant
    const app = select(inSand, bc.x, float(0));
    const damp = select(app.greaterThan(0.0001), exp(U.age.sub(app).max(0).div(-0.05)), float(0));
    const kind = U.kind.element(k);
    return { a, q, p, kPix, k, G, gs, damp, kind };
  };

  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.shadowSide = THREE.DoubleSide; // (une nappe : par défaut seules les faces arrière portent ombre — les parois des galeries, pas la tranche)
  material.positionNode = positionNode;
  const GD = grainData();
  material.maskNode = GD.a.w.greaterThan(0.5); // (la cellule est lue une seule fois par pixel)
  // l'ombre propre des galeries : on remonte vers le soleil dans la carte de
  // profondeur ; si le sable intact, plus haut, coupe le rayon, le point est à
  // l'ombre (la nappe ne porte pas d'ombre dans la carte d'ombre du soleil)
  const selfShadow = (() => {
    const q = uv(), h0 = depthAt(q).negate();
    const L = normalize(U.sun), lxy = length(L.xy).max(1e-3);
    const dirUV = L.xy.div(lxy).div(U.size);
    let sh = float(0);
    for (let i = 1; i <= 5; i++) {
      const d = i * 0.0065; // (5 pas de 0,65 mm : la lèvre d'une galerie porte au plus ~3 mm d'ombre)
      const ray = h0.add(L.z.div(lxy).mul(d));
      const h = depthAt(q.add(dirUV.mul(d))).negate();
      sh = sh.max(smoothstep(ray, ray.add(0.002), h));
    }
    return sh.mul(step(0.0005, h0.negate()));
  })();
  const shade = Fn(() => {
    const { a, k, G, gs, damp, kind } = GD;
    const isGlass = kind.greaterThan(0.5).and(kind.lessThan(1.5)), isBead = kind.greaterThan(1.5).and(kind.lessThan(2.5)), isNacre = kind.greaterThan(2.5);
    const base = U.pal.element(k), next = U.pal.element(k.add(3).mod(8));
    const u = hash(G.id.add(vec2(3.1, 7.7)));
    const jit = hash(G.id.add(vec2(9.4, 1.3))).mul(0.3).add(0.85);
    const m = U.mix;
    let grainCol = select(u.lessThan(m.x), base.mul(jit), select(u.lessThan(m.x.add(m.y)), vec3(U.quartz).mul(jit), select(u.lessThan(m.x.add(m.y).add(m.z)), vec3(U.dark).mul(jit), next.mul(jit))));
    const avg = base.mul(m.x).add(vec3(U.quartz).mul(m.y)).add(vec3(U.dark).mul(m.z)).add(next.mul(float(1).sub(m.x).sub(m.y).sub(m.z)));
    // gravier : des galets de toutes les couleurs du jeu, dans une matrice plus sombre
    const gravel = gs.greaterThan(0.009);
    const pebble = U.pal.element(int(hash(G.id.add(vec2(1.7, 8.1))).mul(7.99)));
    grainCol = select(gravel, mix(base, pebble, step(0.4, u)).mul(jit), grainCol);
    // verre pilé : des éclats purs, plus clairs vers leur bord (la lumière les traverse)
    const rim = smoothstep(0.2, 0.5, length(G.r));
    const glassCol = mix(base, next, step(0.9, u)).mul(jit.mul(1.2).sub(0.15)).mul(rim.mul(0.45).add(1)).add(rim.mul(0.04));
    // nacre : une paillette irisée, sa teinte suit son inclinaison
    const tiltN = hash2(G.id.add(vec2(2.2, 3.3))).sub(0.5);
    const hh = hash(G.id.add(vec2(8.8, 1.1))).mul(0.4).add(tiltN.x.mul(1.2)).add(tiltN.y.mul(0.7));
    const iri = vec3(0.5).add(vec3(0.5).mul(vec3(hh.mul(6.283).cos(), hh.add(0.33).mul(6.283).cos(), hh.add(0.67).mul(6.283).cos())));
    const nacreCol = mix(base.mul(1.1), iri.mul(0.8).add(0.2), 0.35);
    grainCol = select(isGlass, glassCol, select(isBead, base.mul(jit), select(isNacre, nacreCol, grainCol)));
    // joints entre les grains : un peu d'ombre (plus profonde entre les galets) ;
    // effacés quand un grain passe sous le pixel
    const strong = gravel.or(isBead);
    const gap = smoothstep(0.0, select(strong, float(0.22), float(0.16)), G.f2.sub(G.f1)).mul(select(strong, float(0.7), float(0.45))).add(select(strong, float(0.3), float(0.55)));
    const vis = smoothstep(0.7, 0.3, G.fw);
    // à distance : des lamines (deux fréquences, parallèles aux frontières) et des
    // marbrures de tassement et d'humidité, à l'échelle du centimètre
    const lamv = sin(a.y.mul(41).add(a.x.mul(2.3))).mul(0.05).add(sin(a.y.mul(97).add(a.x.mul(5.1))).mul(0.03)).add(1);
    const pp = GD.p;
    const mott = NZ(vec3(pp.x.mul(5), pp.y.mul(8), a.x.mul(0.37))).x.mul(0.08).add(NZ(vec3(pp.x.mul(28), pp.y.mul(40), 1.7)).y.mul(0.04)).add(1);
    // le fond d'une galerie : du sable dans l'ombre de sa voûte, un peu plus sombre
    const cav = float(1).sub(clamp(a.z.div(0.025), 0, 1).mul(0.55));
    return mix(avg.mul(0.93), grainCol.mul(gap), vis).mul(lamv).mul(mott).mul(cav).mul(float(1).sub(damp.mul(0.32))).mul(float(1).sub(selfShadow.mul(0.75)));
  });
  material.colorNode = shade();
  const micaOf = () => hash(GD.G.id.add(vec2(4.4, 6.6))).lessThan(U.mica.element(GD.k));
  material.normalNode = Fn(() => {
    const { q, G, gs } = GD;
    const vis = smoothstep(0.7, 0.3, G.fw);
    const n = reliefN(q);
    // le dôme du grain (plus marqué pour un galet) ; une paillette penche au hasard
    const kind = GD.kind;
    const dome = select(gs.greaterThan(0.009).or(kind.greaterThan(1.5).and(kind.lessThan(2.5))), float(1.9), float(0.9));
    const tilt = hash2(G.id.add(vec2(2.2, 3.3))).sub(0.5).mul(1.4);
    // facettes : les paillettes de mica, tous les éclats de verre, la nacre
    const facet = micaOf().or(kind.greaterThan(0.5).and(kind.lessThan(1.5))).or(kind.greaterThan(2.5));
    const b = G.r.mul(vis).mul(dome).add(select(facet, tilt, vec2(0)).mul(vis));
    return transformNormalToView(normalize(n.add(vec3(b.x, b.y, 0))));
  })();
  // le mica brille ; le sable humide est un peu moins mat
  // le mica, le verre, les billes brillent ; la nacre luit ; le sable humide est moins mat
  {
    const kd = GD.kind;
    const sandR = select(micaOf(), float(0.16), float(0.92).sub(GD.damp.mul(0.25)));
    material.roughnessNode = select(kd.lessThan(0.5), sandR, select(kd.lessThan(1.5), float(0.08), select(kd.lessThan(2.5), float(0.05), float(0.22))));
  }
  // creux : moins de lumière ambiante au fond des galeries
  material.aoNode = float(1).sub(clamp(GD.a.z.div(0.025), 0, 1).mul(0.7));

  const geo = new THREE.PlaneGeometry(1, 1, 2, 2);
  const mesh = new THREE.Mesh(geo, material);
  // (la nappe ne porte pas d'ombre : sur le mur, la silhouette des tumulus et des
  //  galeries se lisait comme un bug ; un bloc simple la remplace, voir stage.js)
  mesh.castShadow = false; mesh.receiveShadow = true;

  // les textures d'une tranche (partagées entre les emplacements de l'étagère)
  function texturesOf(o) {
    const a = new THREE.DataTexture(o.A, o.nx, o.ny, THREE.RGBAFormat, THREE.HalfFloatType);
    a.minFilter = a.magFilter = THREE.LinearFilter; a.needsUpdate = true;
    const b = new THREE.DataTexture(o.B, o.nx, o.ny, THREE.RGFormat, THREE.HalfFloatType);
    b.minFilter = b.magFilter = THREE.NearestFilter; b.needsUpdate = true;
    return { a, b };
  }
  function setSlab(o, T = texturesOf(o)) {
    tA.value = T.a; tB.value = T.b;
    U.size.value.set(o.W, o.H); U.texel.value.set(1 / o.nx, 1 / o.ny);
    // un sommet pour 2 × 2 cellules (la normale vient de la texture, au pixel)
    const g = new THREE.PlaneGeometry(o.W, o.H, Math.ceil(o.nx / 2) - 1, Math.ceil(o.ny / 2) - 1);
    g.translate(0, o.H / 2, 0);
    mesh.geometry.dispose(); mesh.geometry = g;
  }
  const KINDS = { sable: 0, verre: 1, billes: 2, nacre: 3 };
  function setPalette(cols, mixv, sizes, mica, kinds) {
    if (kinds) kinds.forEach((v, i) => { U.kind.array[i] = KINDS[v] ?? 0; });
    cols.forEach((c, i) => U.pal.array[i].set(c));
    for (let i = cols.length; i < 8; i++) U.pal.array[i].set(cols[cols.length - 1]);
    if (mixv) U.mix.value.set(...mixv);
    if (sizes) sizes.forEach((v, i) => { U.gsize.array[i] = v; });
    if (mica) mica.forEach((v, i) => { U.mica.array[i] = v; });
  }
  function useTextures(T) { tA.value = T.a; tB.value = T.b; }
  return { mesh, U, setSlab, setPalette, useTextures, texturesOf };
}
