// La scène : la sole (une cuvette au fond d'un cyclorama), le plateau tournant
// encastré au centre, le bain de verre en fusion, les pièces (un maillage
// d'éclats chacune), les déclencheurs, la gueule du four, les lumières.
//
// Tout est fonction du temps de la boucle t : la pièce k vit dans
// ℓ_k = mod(t − k·Ts, T) ; sa rotation (le plateau) est posée ici, le reste est
// calculé dans les shaders (glass.js) ou dans apparatus.js.
//
// Les lumières sont créées une fois, dans un ordre fixe, au premier niveau de
// la scène ; les maillages reçoivent leur matériau quand leur géométrie est
// arrivée, et un matériau neuf à chaque nouvelle géométrie.
import * as THREE from 'three/webgpu';
import { uniform, lights, vec2, vec3, vec4, atan, fwidth, smoothstep, length, normalize, positionWorld, cameraPosition, acos, clamp, dot, exp, float, uv, mix, abs, floor as tFloor, fract, min, select, step, normalViewGeometry, faceDirection, mx_cell_noise_float, mx_noise_float, positionGeometry, sin, cos } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, signature, noise, perturb } from './materials.js';
import { glassUniforms, applyGlass, buildGlassMaterial, buildGlassShadowCaster, SHADOW_LAYER, blackbody, GLASSES, LIT, BODY } from './glass.js';
import { createApparatus } from './apparatus.js';
import { G } from './globals.js';
const TAU6 = Math.PI * 12;
import { pieceSpec, finishOf, floorFinish } from '../recipe.js';
import { PH, floorH, spinAngle } from '../cycle.js';
import { Buffers, OUT, EDGE } from '../../../shared/gen/mesh.js';

const _c = new THREE.Color();
const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function pieceGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  for (const k of ['rigA', 'rigB', 'rigC', 'rigD']) g.setAttribute(k, new THREE.BufferAttribute(o[k], 4));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 7); // (les éclats s'envolent)
  return g;
}
function bufGeometry(B) {
  const o = B.out(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
// solide de révolution d'axe y : [[r, y], …]
function revolve(B, prof, cols = 64, s = OUT) {
  const rows = prof.map(([r, y], k) => {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)];
    let nr = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    return Array.from({ length: cols }, (_, i) => { const t = (i / cols) * Math.PI * 2; return B.vert([r * Math.cos(t), y, r * Math.sin(t)], [nr * Math.cos(t), ny, nr * Math.sin(t)], s, [-Math.sin(t), 0, Math.cos(t)]); });
  });
  B.grid(rows, true);
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 700, 0, 0.45, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015; key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 30;
  key.shadow.camera.layers.enable(2); // (les porteurs d'ombre du verre, voir glass.js)
  const rims = [new THREE.SpotLight(0xffffff, 400, 0, 0.55, 0.9, 2), new THREE.SpotLight(0xffffff, 150, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false;
  const glow = new THREE.PointLight(0xff6a22, 0, 0, 2);       // le verre en fusion, la sole qui chauffe
  // la gueule du four (ou la fenêtre) : un projecteur placé dans l'ouverture et
  // tourné vers la pièce. Une lumière ponctuelle collée au mur éclairait d'abord
  // le mur et la sole autour d'elle : tout l'Atelier virait au saumon laiteux.
  const furnaceLight = new THREE.SpotLight(0xff7a2a, 0, 0, 0.55, 1, 2);
  furnaceLight.castShadow = false;
  // la lueur de l'ouvreau sur sa propre maçonnerie (portée courte : elle ne
  // touche ni la sole ni la pièce)
  const mouthLight = new THREE.PointLight(0xff6a1a, 0, 12, 2);
  // la lampe de travail : quand la porte du four se referme, elle éclaire le mur
  // derrière la pièce (le « fond clair » des photographes de verrerie), et le
  // verre froid se détache sur des briques éclairées au lieu de la pénombre
  const wash = new THREE.SpotLight(0xffd9b0, 0, 0, 0.5, 1, 2);
  wash.castShadow = false;
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }
  scene.add(glow, furnaceLight, furnaceLight.target, mouthLight, wash, wash.target);

  // ── Cyclorama et sole ──
  // La sole est une cuvette (cycle.js, floorH : la même dans la physique) : les éclats y
  // glissent et le verre fondu y coule vers le centre. Au-delà, le sol se
  // courbe en paroi (gorge, mur) : aucun horizon. Le verre teinté ne se lit
  // que devant du clair : une lueur douce est peinte sur la paroi, à l'opposé
  // de la caméra (« fond clair » des photographes de verrerie), et la sole
  // rougeoie quand elle chauffe.
  const BD = { c0: uniform(new THREE.Color()), gain: uniform(0.4), heat: uniform(0), heatGain: uniform(1) };
  const R0 = 11, Y0 = floorH(R0);
  const floorGeo = (() => {
    const rc = 4, prof = [];
    for (let i = 0; i <= 60; i++) { const r = (R0 * i) / 60, sl = (floorH(r + 1e-3) - floorH(r - 1e-3)) / 2e-3, l = Math.hypot(sl, 1); prof.push([r, floorH(r), -sl / l, 1 / l]); }
    for (let i = 1; i <= 16; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 16); prof.push([R0 + rc * Math.cos(a), Y0 + rc + rc * Math.sin(a), -Math.cos(a), -Math.sin(a)]); }
    for (let i = 1; i <= 10; i++) prof.push([R0 + rc, Y0 + rc + (14 * i) / 10, -1, 0]);
    const cols = 160, pos = [], nor = [], surf = [], tan = [], idx = [];
    for (const [r, y, nr, ny] of prof) for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(r * ca, y, r * sa); nor.push(nr * ca, ny, nr * sa); surf.push(255, 0, 0, 128); tan.push(-sa, 0, ca, 1);
    }
    for (let k = 0; k < prof.length - 1; k++) for (let c = 0; c < cols; c++) {
      const a = k * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, d, b, e, d); // (faces tournées vers l'intérieur : en double face, three.js retourne la normale des faces vues de dos)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
    g.setAttribute('surf', new THREE.BufferAttribute(Uint8Array.from(surf), 4, true));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  })();
  const floor = new THREE.Mesh(floorGeo);
  floor.receiveShadow = true; floor.frustumCulled = false;
  scene.add(floor);
  let floorKey = '';
  const floorEmissive = () => {
    const p = positionWorld, r = length(p.xz);
    const away = normalize(vec2(cameraPosition.x, cameraPosition.z)).negate();
    const ang = acos(clamp(dot(normalize(p.xz), away), -1, 1));
    const back = BD.c0.mul(BD.gain).mul(exp(ang.mul(ang).div(-0.55))).mul(smoothstep(5, 12, r)).mul(smoothstep(Y0 + 12, Y0 + 2, p.y));
    // la sole qui chauffe : plus fort au centre, marbrée
    const h = BD.heat.mul(smoothstep(1.9, 0.2, r)).mul(noise(p.mul(2.2)).mul(0.25).add(0.85));
    return back.add(blackbody(h.mul(0.62)).mul(BD.heatGain));
  };

  // ── Le lieu ──
  // Chaque décor habille la paroi et la sole du même volume (une cuvette, une
  // gorge, un mur cylindrique) : halle de briques, laboratoire carrelé, cour
  // chaulée sous le ciel, lisière sous la neige, rideau de velours, studio noir. Tout est procédural, en coordonnées monde, avec un
  // bruit analytique (sans période : sur une grande surface, le volume de bruit
  // de la scène montrait sa répétition).
  const SUN = uniform(new THREE.Vector3(1, 0.3, 0));
  const dressWall = (m, kind) => {
    const p = positionWorld, RW = R0 + 4, ang = atan(p.z, p.x), rr = length(p.xz);
    const base = m.colorNode, baseN = m.normalNode, baseR = m.roughnessNode, baseE = m.emissiveNode;
    const N1 = (q) => mx_noise_float(q);
    // appareil : NB pierres par tour (un nombre entier : pas de raccord), hauteur
    // BH, joint jw ; half : rangs décalés d'une demi-pierre
    const bond = (NB, BH, jw, half = true, salt = 3.1) => {
      const row = tFloor(p.y.div(BH));
      const u = ang.mul(NB / (2 * Math.PI)).add(half ? fract(row.mul(0.5)) : float(0)), v = p.y.div(BH);
      const BL = (2 * Math.PI * RW) / NB;
      const cell = vec3(tFloor(u), row, salt), fu = fract(u), fv = fract(v);
      const e = min(min(fu, fu.oneMinus()).mul(BL), min(fv, fv.oneMinus()).mul(BH));
      const w = fwidth(p.y).mul(1.4).max(0.004);
      return { e, joint: smoothstep(float(jw).add(w), float(jw).sub(w).max(0), e), h1: mx_cell_noise_float(cell), h2: mx_cell_noise_float(cell.add(17.3)) };
    };
    // o : { wall (masque), col, rough, H (relief, u), slab, slabR, slabH (sole), sky (masque), skyCol, spec, emis }
    const apply = (o) => {
      const slab = o.slab ?? base.rgb, sky = o.sky ?? float(0);
      m.colorNode = vec4(mix(mix(slab, o.col, o.wall), vec3(0), sky), 1);
      m.roughnessNode = mix(mix(o.slabR ?? baseR, o.rough, o.wall), float(1), sky);
      // (flat : la sole perd le motif de sa finition — une neige, un sable n'ont pas de craquelé d'émail)
      m.normalNode = perturb(mix(o.slabH ?? float(0), o.H, o.wall).mul(sky.oneMinus()), o.flat ? normalViewGeometry.mul(faceDirection) : baseN);
      if (o.spec) m.specularIntensityNode = mix(float(0.22), o.spec, o.wall).mul(sky.oneMinus());
      let e = baseE;
      if (o.emisK) e = e.mul(o.emisK);
      if (o.skyCol) e = e.mul(sky.oneMinus()).add(o.skyCol.mul(sky));
      if (o.emis) e = e.add(o.emis);
      m.emissiveNode = e;
    };
    const upper = smoothstep(Y0 + 3.3, Y0 + 4.1, p.y);
    if (kind === 'brique') {
      // briques réfractaires en panneresses, noircies par la suie vers le haut ;
      // le mur est percé à l'endroit de l'ouvreau
      const b = bond(50, 0.6, 0.045);
      const grain = N1(p.mul(11)).mul(0.5).add(0.5), blot = N1(p.mul(1.3)).mul(0.5).add(0.5);
      const soot = smoothstep(Y0 + 4, Y0 + 13, p.y).mul(0.6).add(blot.mul(0.35));
      const brick = mix(vec3(0.2, 0.105, 0.065), vec3(0.32, 0.19, 0.12), b.h1).mul(b.h2.mul(0.5).add(0.6)).mul(grain.mul(0.3).add(0.8));
      // (la sole d'un atelier : dalle patinée, plus sombre par plaques, polie par endroits)
      const worn = N1(p.mul(0.7)).mul(0.5).add(0.5), speck = N1(p.mul(6.5)).mul(0.5).add(0.5);
      apply({
        wall: upper, col: mix(brick, vec3(0.085, 0.075, 0.068), b.joint).mul(float(1).sub(soot.mul(0.75))), rough: float(0.9),
        H: b.joint.oneMinus().mul(0.02).add(N1(p.mul(37)).mul(0.0015)),
        slab: base.rgb.mul(mix(float(0.62), float(1.12), worn)).mul(mix(float(0.88), float(1.06), speck)),
        slabR: baseR.sub(worn.mul(0.22)).add(speck.mul(0.08)).clamp(0.3, 1),
      });
      const q = p.sub(FU.pos), ax = q.sub(FU.dir.mul(dot(q, FU.dir)));
      m.maskNode = length(ax).greaterThan(FU.hole).or(dot(q, q).greaterThan(9));
    } else if (kind === 'carreaux') {
      // faïence blanche de laboratoire, 15 × 15 cm, posée à joints droits : chaque
      // carreau un peu bombé, l'émail un peu ondulé (les reflets du studio y
      // dansent), joints gris ; la gorge au pied du mur est carrelée aussi
      const b = bond(78, 1.2, 0.02, false);
      const pillow = smoothstep(0.0, 0.1, b.e);
      apply({
        wall: smoothstep(Y0 + 1.6, Y0 + 2.2, p.y),
        col: mix(vec3(0.86, 0.855, 0.83).mul(b.h1.mul(0.05).add(0.96)).mul(mix(vec3(1), vec3(0.97, 0.99, 1.0), b.h2)), vec3(0.27, 0.265, 0.25), b.joint),
        rough: mix(b.h2.mul(0.05).add(0.1), float(0.85), b.joint),
        H: pillow.mul(0.014).add(N1(p.mul(1.9)).mul(0.006)),
        spec: mix(float(1), float(0.2), b.joint),
      });
    } else if (kind === 'chaux') {
      // une cour : mur chaulé (crépi irrégulier, pied assombri, arase un peu
      // ondulée) et, au-dessus, le ciel ; la sole est du sable ridé par le vent
      const top = N1(vec3(ang.mul(5), 0.3, 1.7)).mul(0.06).add(Y0 + 7.8);
      const sky = smoothstep(top, top.add(0.04), p.y);
      const lime = vec3(0.8, 0.74, 0.62).mul(N1(p.mul(0.35)).mul(0.08).add(0.95))
        .mul(float(1).sub(smoothstep(Y0 + 5.6, Y0 + 3.6, p.y).mul(0.3))).mul(float(1).sub(smoothstep(top.sub(0.22), top, p.y).mul(0.35)));
      // (pas de rides sous la pièce : les éclats reposent sur un plan ; ni dans la gorge, où le soleil rasant les changeait en bandes)
      const calm = smoothstep(2.4, 4.5, rr).mul(smoothstep(10.5, 8, rr));
      const ripple = sin(p.x.mul(0.78).add(p.z.mul(0.62)).mul(8).add(N1(p.mul(0.8)).mul(3))).mul(0.5).add(0.5);
      apply({
        wall: upper, col: lime, rough: float(0.92), H: N1(p.mul(0.6)).mul(0.015).add(N1(p.mul(9)).mul(0.001)),
        // (sable fin, uni : le motif moucheté de la finition faisait un liège)
        flat: true, slab: vec3(0.74, 0.62, 0.44).mul(N1(p.mul(0.4)).mul(0.06).add(0.97)).mul(N1(p.mul(47)).mul(0.035).add(0.985)).mul(ripple.mul(0.1).mul(calm).add(0.95)), slabR: float(0.9),
        slabH: ripple.mul(0.012).mul(calm).add(N1(p.mul(19)).mul(0.0012)),
        sky, skyCol: mix(vec3(0.66, 0.8, 0.93), vec3(0.2, 0.42, 0.78), smoothstep(Y0 + 7.5, Y0 + 17, p.y)).mul(0.95),
      });
    } else if (kind === 'neige') {
      // un champ de neige au lever du jour : congères douces, cristaux qui
      // scintillent, et à l'horizon deux lisières de sapins dans la brume, sous
      // un ciel pêche qui vire au bleu ; le halo du soleil est du côté de la lampe
      const hz = Y0 + 2.6;
      const sky = smoothstep(hz, hz + 0.5, p.y);
      // (une lisière, pas une palissade : la ligne des cimes est un relief doux à
      // plusieurs échelles, hérissé de pointes inégales, et noyé dans la brume)
      const tree = (N, amp, salt) => {
        const u = ang.mul(N / (2 * Math.PI)), tip = mx_cell_noise_float(vec3(tFloor(u), salt, 0.5));
        const tri = abs(fract(u).sub(0.5)).mul(2).oneMinus();
        const canopy = N1(vec3(ang.mul(7), salt, 0)).mul(0.55).add(N1(vec3(ang.mul(23), salt, 3)).mul(0.3)).add(0.6);
        const top = canopy.mul(amp).add(tri.pow(1.6).mul(tip).mul(amp * 0.4)).add(hz + 0.3);
        return smoothstep(0.12, -0.12, p.y.sub(top));
      };
      const far = tree(300, 1.1, 2.2), near = tree(170, 1.9, 7.9);
      const sunA = dot(normalize(p.xz), normalize(SUN.xz)).mul(0.5).add(0.5);
      const dawn = mix(vec3(0.98, 0.8, 0.68), vec3(0.5, 0.64, 0.84), smoothstep(hz, Y0 + 12, p.y))
        .add(vec3(1.3, 0.72, 0.36).mul(sunA.pow(24)).mul(exp(p.y.sub(hz).div(-4))));
      const woods = mix(mix(dawn, vec3(0.42, 0.5, 0.6), far.mul(0.4)), vec3(0.26, 0.33, 0.42), near.mul(0.6));
      const calm = smoothstep(2.4, 5, rr);
      // (cristaux : rares, ronds, à des places sans régularité, et qui s'allument ou s'éteignent quand la caméra tourne)
      const sq = p.xz.mul(53).add(vec2(N1(p.mul(3.1)), N1(p.mul(3.1).add(9.7))).mul(1.7));
      const twinkle = step(0.9972, mx_cell_noise_float(vec3(tFloor(sq), tFloor(atan(cameraPosition.z, cameraPosition.x).mul(40))))).mul(smoothstep(0.32, 0.12, length(fract(sq).sub(0.5))));
      apply({
        wall: float(0), col: vec3(0), rough: float(1), H: float(0),
        flat: true, slab: vec3(0.8, 0.85, 0.92).mul(N1(p.mul(0.45)).mul(0.07).add(0.97)),
        slabR: float(0.82), slabH: N1(p.mul(0.5)).mul(0.07).mul(calm).add(N1(p.mul(2.4)).mul(0.012).mul(calm)).add(N1(p.mul(31)).mul(0.0015)),
        sky, skyCol: woods, emis: vec3(0.9, 0.95, 1).mul(twinkle).mul(sky.oneMinus()).mul(1.4),
      });
    } else if (kind === 'rideau') {
      // un rideau de velours tiré en rond : plis verticaux irréguliers, poil qui
      // s'éclaire sur la crête des plis, ourlet au ras de la gorge
      const ph = ang.mul(96).add(N1(vec3(ang.mul(9), p.y.mul(0.12), 2)).mul(2.4));
      const fold = sin(ph).mul(0.5).add(0.5), sec = sin(ph.mul(2.3).add(1)).mul(0.5).add(0.5);
      const hem = smoothstep(Y0 + 3.2, Y0 + 3.5, p.y.add(sin(ph).mul(0.06)));
      apply({
        wall: hem, col: vec3(0.085, 0.04, 0.14).mul(fold.pow(2).mul(1.2).add(0.4)).mul(N1(p.mul(60)).mul(0.08).add(0.96)), rough: float(0.96),
        H: fold.mul(0.2).add(sec.mul(0.05)), emisK: mix(float(1), fold.mul(0.9).add(0.3), hem),
      });
    } else if (kind === 'noir') {
      // studio de prise de vue : panneaux peints en noir mat, à peine visibles,
      // leurs joints et leur lustre inégal accrochent l'éclair
      const b = bond(14, 5, 0.025, false);
      apply({
        wall: upper, col: vec3(0.016, 0.016, 0.018).mul(b.h1.mul(0.5).add(0.75)).mul(b.joint.oneMinus()), rough: N1(p.mul(0.6)).mul(0.12).add(0.62),
        H: b.joint.oneMinus().mul(0.012).add(N1(p.mul(3)).mul(0.002)), spec: float(0.6),
      });
    }
  };

  // ── Plateau tournant encastré ──
  const plate = (() => {
    const B = new Buffers();
    revolve(B, [[0, -0.001], [0.6, -0.001], [0.62, -0.006], [0.62, -0.05]], 96, EDGE);
    const f = floorFinish('blackSteel');
    for (const k of ['outer', 'inner', 'edge']) { f[k].color = '#8d8f93'; f[k].metal = 1; f[k].rough = 0.32; f[k].pattern = 'brushed'; f[k].aniso = 0.6; }
    const m = new THREE.Mesh(bufGeometry(B), buildPieceMaterial(f, finishU(f), { seedOff: uniform(new THREE.Vector3(5, 5, 5)) }));
    m.receiveShadow = true;
    scene.add(m);
    return m;
  })();

  // ── Bain de verre en fusion ──
  const POOL = { heat: uniform(1), gain: uniform(1) };
  const pool = (() => {
    const B = new Buffers();
    const prof = [];
    for (let i = 0; i <= 16; i++) { const r = 1 - i / 16; prof.push([r, 0.16 * (1 - r * r) ** 0.7]); }
    revolve(B, prof, 64, OUT);
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.colorNode = vec3(0.05, 0.03, 0.02);
    m.roughnessNode = float(0.08);
    m.emissiveNode = blackbody(POOL.heat.mul(noise(positionWorld.mul(3)).mul(0.08).add(0.92))).mul(POOL.gain);
    const mesh = new THREE.Mesh(bufGeometry(B), m);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();

  // ── Sources de lumière visibles dans le fond ──
  // la gueule d'un four (Atelier) : un disque blanc-orange, plus chaud au centre ;
  // une fenêtre en lancette à vitraux (Cathédrale) : losanges colorés sertis de
  // plombs, sous un arc brisé. Chacune éclaire la scène (lumière ponctuelle).
  const FU = { on: uniform(0), seed: uniform(0), pos: uniform(new THREE.Vector3(0, -99, 0)), dir: uniform(new THREE.Vector3(0, 0, 1)), hole: uniform(0) };
  const furnace = (() => {
    // l'ouvreau d'un four de verrier, en volume : un conduit réfractaire percé
    // dans le mur de briques, incandescent — orangé à la bouche, jaune au fond,
    // où l'on devine le bain —, un collier de terre cuite noircie, une plaque
    // de fonte boulonnée. Repère local : +z vers la salle.
    const g = new THREE.Group();
    const pulse = (q) => noise(vec3(q.mul(5).add(vec2(cos(G.phase.mul(TAU6)), sin(G.phase.mul(TAU6))).mul(0.7)), 0.5)).mul(0.14).add(0.93);
    const tubeM = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.BackSide });
    // (uv.y : 0 au fond, 1 à la bouche)
    const depth = uv().y.oneMinus();
    const streak = noise(vec3(uv().x.mul(40), uv().y.mul(3), 1.7)).mul(0.25).add(0.85);
    tubeM.colorNode = mix(vec3(0.9, 0.19, 0.03), vec3(1.2, 0.46, 0.09), smoothstep(0.0, 0.9, depth)).mul(streak).mul(pulse(uv())).mul(FU.on);
    const FZ = 0.3; // (la façade du four avance de la paroi courbe, qui sinon en cache les côtés)
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.86, 2.6 + FZ, 64, 1, true).rotateX(Math.PI / 2).translate(0, 0, -1.3 + FZ / 2), tubeM);
    const backM = new THREE.MeshBasicNodeMaterial({ fog: false });
    const d = length(uv().sub(0.5)).mul(2);
    // (au fond : la surface du bain, plus claire en bas, et la voûte au-dessus)
    const bath = smoothstep(0.62, 0.3, uv().y).mul(0.55).add(0.75);
    backM.colorNode = mix(vec3(1.45, 0.64, 0.15), vec3(1.2, 0.46, 0.09), smoothstep(0.1, 1, d)).mul(mix(bath, float(1), smoothstep(0.6, 1, d))).mul(pulse(uv().mul(1.7))).mul(FU.on);
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.86, 48).translate(0, 0, -2.6), backM);
    // collier réfractaire (éclairé par la lueur de la bouche) et plaque de fonte
    const collarM = new THREE.MeshStandardNodeMaterial({ fog: true });
    collarM.colorNode = vec3(0.075, 0.05, 0.036).mul(noise(positionWorld.mul(4)).mul(0.45).add(0.75));
    collarM.roughnessNode = float(0.85);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.2, 20, 72).translate(0, 0, FZ), collarM);
    const ironM = new THREE.MeshStandardNodeMaterial();
    // (bruit analytique, sans période : le volume de bruit de la scène se répète
    // tous les quelques décimètres, et sur une grande tôle unie on voyait le motif)
    const big = mx_noise_float(positionWorld.mul(0.55)), mid = mx_noise_float(positionWorld.mul(2.3).add(11.3));
    ironM.colorNode = mix(vec3(0.05, 0.047, 0.045), vec3(0.085, 0.068, 0.055), big.mul(0.5).add(0.5)).mul(mid.mul(0.12).add(0.94));
    ironM.roughnessNode = big.mul(0.09).add(mid.mul(0.05)).add(0.6);
    ironM.metalnessNode = float(0.85);
    const plate = new THREE.Mesh(new THREE.RingGeometry(1.26, 1.95, 72).translate(0, 0, FZ), ironM);
    // (virole : le tambour de tôle qui porte la plaque, de la paroi à la façade)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, FZ + 0.5, 72, 1, true).rotateX(Math.PI / 2).translate(0, 0, (FZ - 0.5) / 2), ironM);
    g.add(drum);
    g.add(tube, back, collar, plate);
    const bolt = new THREE.CylinderGeometry(0.07, 0.07, 0.07, 6).rotateX(Math.PI / 2);
    for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * Math.PI * 2, b = new THREE.Mesh(bolt, ironM); b.position.set(Math.cos(a) * 1.72, Math.sin(a) * 1.72, FZ + 0.035); g.add(b); }
    // la porte : un disque de fonte pendu à un bras, qui pivote devant la bouche
    // (fermée : le bras pend à la verticale ; ouverte : relevée de côté). Le
    // verrier la rabat dès que la pièce est formée ; la lueur ne passe plus que
    // par le jour entre la porte et le collier.
    const door = new THREE.Group();
    door.position.set(0, 2.3, FZ + 0.34);
    // La porte : fonte moulée. Dans le repère du vantail (centre en (0, −2,3)) :
    // un jonc de bord, quatre nervures en croix, un bossage central percé d'un
    // regard par où l'on voit le feu ; la fonte est bleuie et roussie autour du
    // regard, là où elle chauffe, et noircie de suie vers le haut.
    const doorM = new THREE.MeshStandardNodeMaterial();
    {
      const q = positionGeometry.xy.sub(vec2(0, -2.3)), r = length(q), th = atan(q.y, q.x);
      const front = smoothstep(0.02, 0.04, positionGeometry.z); // (face tournée vers la salle)
      const rib = smoothstep(0.075, 0.03, abs(sin(th.mul(2))).mul(r)).mul(smoothstep(1.16, 1.05, r)).mul(smoothstep(0.26, 0.34, r));
      const rim = smoothstep(1.1, 1.16, r), bossK = smoothstep(0.34, 0.28, r);
      const relief = rib.max(rim).max(bossK);
      const n1 = mx_noise_float(positionGeometry.mul(0.9).add(3.7)), n2 = mx_noise_float(positionGeometry.mul(4.1)), n3 = mx_noise_float(positionGeometry.mul(23));
      const heatTint = smoothstep(1.0, 0.25, r).mul(n1.mul(0.3).add(0.8));
      const soot = smoothstep(-0.9, 1.2, q.y).mul(0.45);
      const iron = mix(vec3(0.062, 0.058, 0.056), vec3(0.1, 0.085, 0.07), n1.mul(0.5).add(0.5));
      const tempered = mix(vec3(0.14, 0.075, 0.04), vec3(0.06, 0.07, 0.11), smoothstep(0.35, 0.8, r.add(n2.mul(0.12))));
      const peep = smoothstep(0.085, 0.07, r).mul(front);
      doorM.colorNode = mix(iron, tempered, heatTint.mul(0.75)).mul(float(1).sub(soot)).mul(relief.mul(0.25).add(0.9)).mul(n3.mul(0.06).add(0.97)).mul(peep.oneMinus());
      doorM.roughnessNode = n1.mul(0.08).add(n2.mul(0.05)).add(mix(float(0.66), float(0.5), relief));
      doorM.metalnessNode = float(0.9);
      doorM.normalNode = perturb(relief.mul(0.05).add(n2.mul(0.004)).add(n3.mul(0.0012)).mul(front), normalViewGeometry.mul(faceDirection));
      doorM.emissiveNode = vec3(1.6, 0.6, 0.12).mul(peep).mul(FU.on);
    }
    const leaf = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.09, 96).rotateX(Math.PI / 2).translate(0, -2.3, 0), doorM);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.07).translate(0, -0.62, 0.05), ironM);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 24).rotateX(Math.PI / 2), ironM);
    door.add(leaf, arm, boss);
    g.add(door);
    g.userData.door = door;
    g.visible = false;
    scene.add(g);
    return g;
  })();
  // ── Le flash (Stroboscope) ──
  // une torche de studio sur son pied : réflecteur parabolique d'aluminium, tube
  // à éclats en anneau, boîtier, lyre, trépied. Sa lampe pilote éclaire la pièce
  // à contre-jour ; à l'instant du choc, l'éclair part.
  const FL = { on: uniform(0) };
  const flash = (() => {
    const g = new THREE.Group(), head = new THREE.Group();
    const alu = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    alu.colorNode = vec3(0.78, 0.78, 0.8); alu.metalnessNode = float(1);
    alu.roughnessNode = mx_noise_float(positionGeometry.mul(3)).mul(0.05).add(0.24);
    // (le tube allumé éclaire son propre réflecteur)
    alu.emissiveNode = vec3(0.9, 0.95, 1.0).mul(FL.on).mul(smoothstep(0.9, 0.2, length(positionGeometry.xy))).mul(0.5);
    const black = new THREE.MeshStandardNodeMaterial();
    black.colorNode = vec3(0.02, 0.02, 0.022); black.roughnessNode = float(0.55); black.metalnessNode = float(0.3);
    const prof = [];
    for (let i = 0; i <= 20; i++) { const r = 0.12 + 0.78 * (i / 20); prof.push(new THREE.Vector2(r, 0.62 * r * r)); }
    const dish = new THREE.Mesh(new THREE.LatheGeometry(prof, 64).rotateX(Math.PI / 2), alu);
    const tubeM = new THREE.MeshBasicNodeMaterial({ fog: false });
    tubeM.colorNode = vec3(1.0, 1.05, 1.15).mul(FL.on).mul(1.6).add(vec3(0.05));
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 12, 48).translate(0, 0, 0.1), tubeM);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.9, 32).rotateX(Math.PI / 2).translate(0, 0, -0.42), black);
    const rimG = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.025, 10, 64).translate(0, 0, 0.5), black);
    head.add(dish, tube, body, rimG);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08).translate(0, -0.42, -0.4), black);
    head.add(yoke);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1, 16).translate(0, 0.5, 0), black);
    g.add(head, pole);
    // (trépied : trois jambes du sol vers la colonne)
    const UP = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4, foot = new THREE.Vector3(Math.cos(a) * 1.25, 0.02, Math.sin(a) * 1.25), d = new THREE.Vector3(0, 0.95, 0).sub(foot);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, d.length(), 10).translate(0, d.length() / 2, 0), black);
      leg.position.copy(foot); leg.quaternion.setFromUnitVectors(UP, d.clone().normalize());
      g.add(leg);
    }
    g.userData = { head, pole };
    g.visible = false;
    scene.add(g);
    return g;
  })();

  // ── Les tubes (Lumière noire) ──
  // deux tubes de Wood dans leurs réglettes, debout contre le rideau
  const TU = { on: uniform(0) };
  const tubes = (() => {
    const g = new THREE.Group();
    const lampM = new THREE.MeshBasicNodeMaterial({ fog: false });
    // (plus clair au cœur du tube, violet profond au bord)
    const cosT = abs(dot(normalViewGeometry, vec3(0, 0, 1)));
    lampM.colorNode = mix(vec3(0.28, 0.1, 1.2), vec3(0.75, 0.6, 1.9), cosT.pow(2)).mul(TU.on);
    const fixM = new THREE.MeshStandardNodeMaterial();
    fixM.colorNode = vec3(0.03, 0.03, 0.035); fixM.roughnessNode = float(0.5); fixM.metalnessNode = float(0.6);
    for (const x of [-1.15, 1.15]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 5.6, 24), lampM); t.position.set(x, 0, 0.16);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.14), fixM); f.position.set(x, 0, 0.02);
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.22), fixM); c1.position.set(x, 2.86, 0.12);
      const c2 = c1.clone(); c2.position.y = -2.86;
      g.add(t, f, c1, c2);
    }
    g.visible = false;
    scene.add(g);
    return g;
  })();

  const apparatus = createApparatus(scene, { finishOf });

  // ── Pièces ──
  let R = null, version = 0, pending = 0, total = 0;
  let pieces = [];
  const clear = () => {
    for (const p of pieces) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material?.dispose?.(); p.track?.dispose(); }
    pieces = [];
  };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    clear();
    total = R.pieces.length; pending = total;
    R.pieces.forEach((P, k) => {
      const U = glassUniforms();
      const slot = { k, P, U, mesh: new THREE.Mesh(new THREE.BufferGeometry()), info: null, glassKey: P.glass, track: null };
      slot.mesh.castShadow = true; slot.mesh.receiveShadow = true; slot.mesh.visible = false;
      slot.mesh.frustumCulled = false;
      pieces.push(slot);
      gen.request(pieceSpec(R, k), 'piece').then((o) => {
        if (v !== version) return;
        slot.mesh.geometry.dispose();
        slot.mesh.geometry = pieceGeometry(o.mesh);
        slot.info = o.info;
        // trajectoires simulées des éclats (gen/sim.js) : une ligne par éclat,
        // deux texels (centre ; quaternion) par échantillon
        slot.track?.dispose();
        slot.track = new THREE.DataTexture(o.track, 2 * o.info.samples, o.info.frags, THREE.RGBAFormat, THREE.FloatType);
        slot.track.needsUpdate = true;
        U.samples.value = o.info.samples; U.rate.value = o.info.rate;
        slot.mesh.material?.dispose?.();
        slot.mesh.material = buildGlassMaterial(U, { glassKey: P.glass, track: slot.track }); // (après la géométrie)
        // le verre transmissif ne porte pas d'ombre : un double invisible la porte
        if (slot.caster) { slot.mesh.remove(slot.caster); slot.caster.material.dispose(); }
        slot.caster = new THREE.Mesh(slot.mesh.geometry, buildGlassShadowCaster(U, slot.mesh.material));
        slot.caster.layers.set(SHADOW_LAYER); slot.caster.castShadow = true; slot.caster.frustumCulled = false;
        slot.mesh.castShadow = GLASSES[P.glass]?.opaque ?? false; // (l'obsidienne porte la sienne)
        if (!GLASSES[P.glass]?.opaque) slot.mesh.add(slot.caster);
        scene.add(slot.mesh);
        pending--;
      }, (e) => { console.error(e); pending--; });
    });
    setFloor(R);
  }
  function setFloor(recipe) {
    const fk = `${recipe.floor.finish.set}|${recipe.floor.finish.outer.color}|${signature(recipe.floor.finish)}|${recipe.wall ?? ''}`;
    if (fk !== floorKey) {
      floorKey = fk;
      floor.material?.dispose?.();
      floor.material = buildPieceMaterial(recipe.floor.finish, finishU(recipe.floor.finish), { seedOff: uniform(new THREE.Vector3(9, 9, 9)) });
      floor.material.emissiveNode = floorEmissive();
      // (sole mate, poussiéreuse : un reflet rasant atténué — la lumière doit
      // tomber sur la pièce, pas sur le sol entre elle et la caméra)
      floor.material.specularIntensityNode = float(0.22);
      // (les contre-jours n'éclairent que le verre et les appareils : sur le sol,
      // ils effaceraient les ombres portées, et la pièce semblerait flotter)
      // (ni la gueule du four : orangée et rasante, elle noyait toute la sole
      // dans un saumon uniforme ; le four se lit par son reflet sur le verre)
      floor.material.lightsNode = lights([key, glow, mouthLight, wash]);
      if (recipe.wall) dressWall(floor.material, recipe.wall);
    }
  }

  // retouche d'un verre depuis le panneau
  function syncGlass() {
    for (const p of pieces) {
      if (!p.info) continue;
      if (!!GLASSES[p.P.glass]?.opaque !== !!GLASSES[p.glassKey]?.opaque) {
        p.mesh.material.dispose();
        p.mesh.material = buildGlassMaterial(p.U, { glassKey: p.P.glass, track: p.track });
      }
      p.glassKey = p.P.glass;
    }
  }

  const place = (l, az, el, r, target = [0, 0.6, 0]) => {
    l.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // angle du plateau : il s'arrête en présentant le point d'impact de profil à
  // la caméra (un peu tourné vers elle), pour que le geste du déclencheur se
  // lise de côté (le pendule dans son plan, le marteau, la flamme, la membrane)
  const presentAngle = (p, l, Ts, k, camAz) => {
    const P = p.P;
    if (!p.info || !camAz) return spinAngle(P, l, Ts);
    const thC = Math.PI / 2 - camAz((k + PH.rupture) * Ts); // (caméra : angle dans le plan (x, z))
    const want = thC + (P.side ?? 1) * 1.25;
    const phiO = Math.atan2(p.info.origin[2], p.info.origin[0]);
    const corr = phiO - want - spinAngle(P, Ts, Ts);
    return spinAngle(P, l, Ts) + corr;
  };

  function update(t, camera, camAz = null) {
    if (!R) return;
    const N = R.pieces.length, Ts = R.loop.stage, T = Ts * N, S = R.size;
    const L = R.light;
    BD.c0.value.set(R.backdrop?.color ?? '#808080'); BD.gain.value = R.backdrop?.gain ?? 0.4; BD.heatGain.value = L.heat;
    place(key, L.key.az, L.key.el, 11);
    key.color.set(L.key.color); key.intensity = L.key.intensity; key.angle = L.key.angle; key.penumbra = L.key.penumbra;
    // carte d'ombre resserrée sur la sole (± 3,5 u), quelle que soit l'ouverture du
    // faisceau : sinon elle s'étale sur toute la scène et les ombres disparaissent
    // (sous un faisceau très ouvert — le soleil —, hors de la carte d'ombre le sol
    // est tenu pour ombré : le bord de la carte dessinait un rond de lumière
    // autour de la pièce ; la carte couvre alors toute la sole visible)
    key.shadow.focus = Math.min(1, Math.atan((L.key.angle > 0.8 ? 9 : 3.5) / 11) / L.key.angle);
    // contre-jours : derrière la pièce par rapport à la caméra, de part et d'autre
    // (ils dessinent les bords du verre, quel que soit l'angle de vue)
    const camAng = camera ? Math.atan2(camera.position.z, camera.position.x) : 0;
    rims.forEach((l, i) => { const r = L.rim[i]; place(l, camAng + Math.PI + r.az, r.el, 9); l.color.set(r.color); l.intensity = r.intensity * (lite && i === 0 ? 1.4 : 1); });
    // four, fenêtre
    const pr = L.prop;
    furnace.visible = pr?.kind === 'four';
    flash.visible = pr?.kind === 'flash'; tubes.visible = pr?.kind === 'tubes';
    SUN.value.copy(key.position).normalize();
    if (pr) {
      // (décollés de la paroi courbe : un disque posé à 3 cm la coupait sur ses
      // côtés, et la gueule du four prenait la forme d'une applique)
      const a = pr.az, rw = R0 + 4 - 0.25, fy = Y0 + 5.2;
      FU.on.value = pr.intensity; FU.seed.value = pr.seed ?? 0;
      if (pr.kind === 'four') {
        // (dans le mur, percé à cet endroit : voir le masque de la paroi, setFloor)
        const rf = R0 + 4 + 0.02;
        furnace.position.set(Math.cos(a) * rf, fy, Math.sin(a) * rf); furnace.lookAt(0, fy, 0); furnace.scale.setScalar(1.6);
        FU.pos.value.copy(furnace.position); FU.dir.value.set(-Math.cos(a), 0, -Math.sin(a)); FU.hole.value = 1.6 * 1.02;
        mouthLight.position.set(Math.cos(a) * (rf - 1.5), fy, Math.sin(a) * (rf - 1.5)); mouthLight.intensity = 110 * pr.intensity;
        furnaceLight.color.set('#ff6a1a'); furnaceLight.intensity = 650 * pr.intensity; furnaceLight.angle = 0.42;
      }
      furnaceLight.position.set(Math.cos(a) * (rw - 0.3), pr.kind === 'four' ? fy : Y0 + 6, Math.sin(a) * (rw - 0.3));
      furnaceLight.target.position.set(0, 0.7, 0);
      if (pr.kind === 'flash') {
        // la torche, posée sur la sole entre la pièce et le mur, tournée vers la
        // pièce ; l'éclair part au choc et retombe en une demi-seconde de film
        const rp = 9.2, hy = 3.6, gy = floorH(rp);
        flash.position.set(Math.cos(a) * rp, gy, Math.sin(a) * rp);
        const { head, pole } = flash.userData;
        head.position.set(0, hy, 0); pole.scale.set(1, hy - 0.3, 1);
        head.lookAt(0, 1.0, 0);
        const ls = ((t % Ts) + Ts) % Ts, dtf = ls - PH.rupture * Ts;
        const burst = dtf < 0 ? Math.exp(-((dtf / 0.05) ** 2)) : Math.exp(-dtf / 0.45);
        FL.on.value = pr.intensity * (0.45 + 2.2 * burst);
        furnaceLight.color.set('#e4ecff'); furnaceLight.angle = 0.5;
        furnaceLight.intensity = 520 * pr.intensity * (0.6 + 2.0 * burst);
        furnaceLight.position.set(Math.cos(a) * rp, gy + hy, Math.sin(a) * rp);
        furnaceLight.target.position.set(0, 1.0, 0);
        key.intensity *= 1 + 0.9 * burst;
      } else if (pr.kind === 'tubes') {
        const ty = Y0 + 5.6;
        tubes.position.set(Math.cos(a) * (rw - 0.15), ty, Math.sin(a) * (rw - 0.15)); tubes.lookAt(0, ty, 0);
        TU.on.value = pr.intensity;
        furnaceLight.color.set('#7a5cff'); furnaceLight.intensity = 800 * pr.intensity; furnaceLight.angle = 0.5;
        furnaceLight.position.set(Math.cos(a) * (rw - 0.6), ty, Math.sin(a) * (rw - 0.6));
      }
    } else furnaceLight.intensity = 0;
    if (pr?.kind !== 'four') { mouthLight.intensity = 0; FU.hole.value = 0; wash.intensity = 0; }
    else {
      // la porte du four : ouverte pendant le soufflage et la refonte, rabattue
      // entre les deux (la pièce refroidit, puis se brise). Les étapes
      // s'enchaînent porte ouverte : le mouvement est continu d'une pièce à l'autre.
      const ls = ((t % Ts) + Ts) % Ts;
      const open = 1 - sm(0.22 * Ts, 0.31 * Ts, ls) + sm(0.74 * Ts, 0.82 * Ts, ls), shut = 1 - open;
      furnace.userData.door.rotation.z = -1.75 * open;
      furnaceLight.intensity *= 0.04 + 0.96 * open;
      mouthLight.intensity *= 0.1 + 0.9 * open;
      // four fermé, la lampe de travail prend le relais : la lampe principale et
      // les contre-jours montent, le mur derrière la pièce s'éclaire
      key.intensity *= 1 + 0.45 * shut;
      rims.forEach((l) => { l.intensity *= 1 + 0.6 * shut; });
      const back = camAng + Math.PI;
      wash.position.set(Math.cos(back) * 5, 11, Math.sin(back) * 5);
      wash.target.position.set(Math.cos(back) * (R0 + 4), Y0 + 4.2, Math.sin(back) * (R0 + 4));
      wash.intensity = 1150 * shut * (R.light.wash ?? 1);
    }

    // (les lampes, vues par le verre : couleur de corps, glass.js)
    [key, rims[0], rims[1], furnaceLight].forEach((l, i) => {
      LIT[i].pos.value.copy(l.position);
      LIT[i].col.value.copy(l.color).multiplyScalar(l.visible ? l.intensity : 0);
    });
    BODY.gain.value = R.light.body ?? 0.34;

    let glowI = 0, poolR = 0, floorHeat = 0, active = null, plateAngle = 0;
    const acc = PH.acc * Ts, cool = PH.cool * Ts;
    pieces.forEach((p, k) => {
      const l = (((t - k * Ts) % T) + T) % T;
      const P = p.P;
      p.mesh.visible = !!p.info && l < Ts;
      const a = presentAngle(p, l, Ts, k, camAz);
      p.mesh.rotation.y = a;
      const U = p.U;
      U.start.value = k * Ts; U.loopT.value = T; U.Ts.value = Ts; U.size.value = S;
      U.k.value = R.loop.slow.k; U.pre.value = R.loop.slow.pre; U.plat.value = R.loop.slow.plat; U.post.value = R.loop.slow.post;
      U.thick.value = S * P.thickness * (P.form === 'dome' ? 2 : 1);
      U.res.value = P.mech === 'resonance' ? 1 : 0; U.therm.value = P.mech === 'thermal' ? 1 : 0;
      U.heatGain.value = L.heat;
      U.fil.value = P.fil ?? 0; U.filN.value = P.filN ?? 16; U.filTwist.value = P.filTwist ?? 1;
      applyGlass(U, { key: P.glass, fire: P.fire });
      if (p.info) U.origin.value.set(...p.info.origin);
      if (l < Ts) {
        // chaleur visible : soufflage, refroidissement, fonte
        glowI += Math.max(0, Math.min(1, l / (acc * 0.3)) * (1 - Math.max(0, l - acc) / cool)) ** 3;
        const melt = sm(PH.melt * Ts, (PH.melt + PH.meltSpan + PH.meltDur) * Ts, l);
        glowI += melt * 0.5;
        poolR = Math.max(poolR, 0.6 * melt, 0.6 * (1 - sm(0, acc * 0.85, l))); // (le bain nourrit le soufflage, puis il se reforme de la fonte)
        floorHeat = Math.max(floorHeat, sm((PH.melt - 0.03) * Ts, PH.melt * Ts, l), 1 - sm(acc * 0.5, acc * 1.6, l));
        active = p; plateAngle = a;
      }
    });
    plate.rotation.y = plateAngle;
    pool.visible = poolR > 0.01;
    pool.scale.set(poolR, Math.max(0.2, poolR), poolR);
    BD.heat.value = Math.min(1, floorHeat);
    POOL.gain.value = L.heat;
    // (sur une sole claire, la lueur du verre chaud brûlait le sol en une flaque crème : elle baisse avec la clarté du sol)
    _c.set(R.floor.finish.outer.color);
    glow.intensity = ((glowI * 30 + floorHeat * 14) * L.heat * S * S) / (1 + 5 * (0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b));
    glow.position.set(0, 0.5, 0);
    // déclencheur de la pièce active (le plateau est arrêté quand il agit)
    if (active) {
      const l = (((t - active.k * Ts) % T) + T) % T;
      apparatus.update(active.P, active.info, presentAngle(active, Ts, Ts, active.k, camAz), l, Ts, R.loop.slow, S);
    } else apparatus.update(null);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, setFloor, update, syncGlass, setShadowQuality, floor, key, rims, glow, pool, plate, apparatus,
    get pieces() { return pieces; },
    // (la plus haute pièce de la scène : le cadrage la contient en entier)
    maxHeight: () => Math.max(1, ...pieces.map((p) => p.info?.height ?? 0)),
    group: scene,
    ready: () => pending === 0,
    progress: () => (total ? 1 - pending / total : 1),
  };
}
