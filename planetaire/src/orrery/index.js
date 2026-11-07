// La machine : un planétaire (orrery) en laiton qui « porte » la simulation.
//
// Rien ici ne simule : la mécanique LIT l'état du GPU et le rend tangible.
// Chaque pièce a une fonction, et la chaîne cinématique est cohérente :
//
//   BARILLET (ressort = énergie d'un cycle de vie)
//     ├─▶ pignon de l'ARBRE DE RENVOI ─▶ pignons ─▶ ROUES des tubes ─▶ BRAS ─▶ planètes
//     │      (rapport roue / pignon = rapport des vitesses angulaires : Kepler)
//     └─▶ ROUE DE CENTRE ─▶ ROUE D'ÉCHAPPEMENT ⇄ ANCRE ⇄ BALANCIER (régulateur)
//
//  · toutes les dentures ont le même module : les entraxes sont exacts et les
//    dents s'engrènent vraiment (nombres de dents entiers, phases calées) ;
//  · RÉSERVE DE MARCHE : l'aiguille suit le ressort qui se détend au fil du
//    cycle ; le cadran est gradué par les phases de la vie du système ;
//  · FIN DE CYCLE : le ressort est vide, le LEVIER D'ARRÊT bloque le balancier ;
//    la TRÉMIE aspire les débris de la supernova pendant que la COURONNE
//    remonte le barillet (le CLIQUET claque sur le ROCHET) ; le levier se
//    déclenche, la VANNE s'ouvre et les grains se déversent : le nouveau nuage ;
//  · PEIGNE de boîte à musique = la tête de lecture, au-dessus du disque ;
//  · LIMBE gradué, PIEDS et ARCEAUX qui portent la CLOCHE de verre ;
//  · GALERIE DES AUTOMATES autour du pied du socle (gallery.js).
import * as THREE from 'three/webgpu';
import {
  vec3, vec4, mix, positionLocal, mx_noise_float, normalWorld, positionWorld, normalize, dot, abs, pow, float, max, min,
  uniform, smoothstep, time, length, cubeTexture, reflectVector, uv, lights,
} from 'three/tsl';
import { R_IN, R_OUT, planetRadius } from '../sim.js';
import { ss, smoother } from '../util.js';
import { noVelocity, toCamera } from '../render/common.js';
import {
  K, Y_ARM0, DY_ARM, Y_BASE, Y_GEAR0, DY_GEAR, LAY_N, LAY_D, OMEGA_L, LIMB_R0, LIMB_R1, LIMB_RM, DOME_H, HOPPER,
  COMB_Z, COMB_BAR_Y, TOOTH_ROOT_Y, TOOTH_TIP_Y, TOOTH_TIP_Z, PIN_TOP, NTEETH, PHASE_W, WIND0, WIND1, pitchR,
} from './layout.js';
import { plate, turned, gearGeometry, bushGeometry, bridgeGeometry, ratchetGeometry, escapeGeometry, meshAngle, ArchCurve, legCurve, helixCurve } from './geometry.js';
import { createMaterials, brass, engraved, glassMaterial, glassK } from './materials.js';
import { limbTexture, plateTexture, dialTexture, dialAngle, studioEnv } from './textures.js';
import { createBuilder, UP, at, angTo, dyn } from './builder.js';
import { createGallery } from './gallery.js';
import { createAssembly } from './assembly.js';
import { mergeStatic } from './batch.js';

export { HOPPER, BELL_R } from './layout.js';

const COMB_DUR = 2.6, COMB_FOLD = 0.45;   // sortie du peigne (s) ; lames rentrées : relevées (rad)
const M_IN = 0.12, M_OUT = 0.06, SWAP = 1.6; // seuils (M⊕) de prise en charge d'une planète par un bras
const ENV_K = 0.8;                         // reflets du studio (plus haut, la softbox fait une tache blanche)

export function createOrrery(scene, renderer, { film = false } = {}) {
  const root = new THREE.Group();
  root.name = 'orrery';
  scene.add(root);
  const M = createMaterials();
  const b = createBuilder(root, M);
  const { add, screw, pillar, arbor, bridgeAB } = b;

  // Environnement de studio, préfiltré (PMREM) et attaché matériau par matériau,
  // PAS via scene.environment : avec le moteur WebGPU, l'environnement de la
  // scène s'ajoute aussi aux matériaux « basic » (poussière, verre, halos).
  let env = null;
  const eachMaterial = (fn) => root.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) fn(m, o); });
  const applyEnv = () => {
    if (!env) return;
    eachMaterial((m) => { if (m.isMeshStandardMaterial && m.envMap !== env) { m.envMap = env; m.envMapIntensity = ENV_K; m.needsUpdate = true; } });
  };
  new THREE.PMREMGenerator(renderer).fromEquirectangularAsync(studioEnv()).then((rt) => { env = rt.texture; applyEnv(); });

  // ── Lumières ─────────────────────────────────────────────────────────────
  //  · clé motivée : l'étoile, qui porte des ombres radiales sur la platine et
  //    raconte le cycle par sa couleur ;
  //  · lampe de musée : un projecteur étroit et haut, qui pose une flaque de
  //    lumière sur la machine et la laisse tomber dans le noir ;
  //  · projecteur froid et rasant sur la galerie ; deux contre-jours froids ;
  //  · remplissage presque nul (ratio ≈ 8:1) : l'environnement HDR fait vivre le métal.
  const starLight = new THREE.PointLight(0xffd6a0, 2, 0, 2);
  starLight.castShadow = true;
  starLight.shadow.mapSize.set(1024, 1024);
  starLight.shadow.camera.near = 0.3; starLight.shadow.camera.far = 30;
  starLight.shadow.bias = -0.002; starLight.shadow.normalBias = 0.03;
  starLight.shadow.radius = 6;
  root.add(starLight);
  const starCupL = uniform(new THREE.Color(0, 0, 0)), starCupR = uniform(0.06); // radiance et rayon du disque stellaire
  const lamp = new THREE.SpotLight(0xfff0dc, 140, 0, 0.36, 0.85, 1.6); // ~4500 K : le laiton fournit lui-même le chaud
  lamp.position.set(-5.5, 16, 6.5);
  lamp.target.position.set(0, -3.4, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 8; lamp.shadow.camera.far = 40;
  lamp.shadow.bias = -0.0004; lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 5;
  const lamp2 = new THREE.SpotLight(0xa9c2ff, 60, 0, 0.5, 1.0, 1.3);
  lamp2.position.set(9, -2.6, 6.5);
  lamp2.target.position.set(0, -4.0, 0.5);
  const hemi = new THREE.HemisphereLight(0x8fa3d0, 0x3a2414, 0.3);
  // (contre-jours hauts, ~40° : rasants, ils se reflétaient en miroir dans les pièces planes)
  const rim = new THREE.DirectionalLight(0x9fbcff, 1.5);
  rim.position.set(6, 10, -11);
  const rim2 = new THREE.DirectionalLight(0xc8d6ff, 0.7);
  rim2.position.set(-10, 7.5, -6);
  lamp.target.userData.noAssemble = lamp2.target.userData.noAssemble = true;
  root.add(lamp, lamp.target, lamp2, lamp2.target, hemi, rim, rim2);

  // ── Plateau : velours sombre dans la flaque de la lampe ─────────────────
  {
    const fm = new THREE.MeshLambertNodeMaterial(); // (diffus pur : aucun reflet du studio en incidence rasante)
    const rr = positionWorld.xz.length();
    const alb = vec3(0.16, 0.105, 0.07).mul(mx_noise_float(positionWorld.mul(vec3(40, 1, 40))).mul(0.08).add(1.0));
    fm.colorNode = alb.mul(smoothstep(24.0, 6.0, rr));
    // flaque de lumière, assombrie au pied du socle (ombre de contact)
    const pool = smoothstep(17.0, 3.0, rr).pow(1.6).mul(smoothstep(2.3, 4.2, rr).mul(0.85).add(0.15));
    fm.emissiveNode = alb.mul(pool).mul(0.16);
    fm.mrtNode = noVelocity(); // (sinon, caméra en mouvement, le flou étalait le sol à travers la poussière)
    const floor = add(new THREE.CircleGeometry(40, 96), fm, 0, Y_BASE - 1.252, 0);
    floor.rotation.x = -Math.PI / 2;
    floor.userData.noCast = floor.userData.noAssemble = true;
  }

  // ── Faisceau de la lampe : une poussière d'atelier en suspension rend le cône visible
  const beamK = uniform(1);
  {
    const top = lamp.position, bot = lamp.target.position;
    const len = top.distanceTo(bot), rad = Math.tan(0.36) * len;
    const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const edge = abs(dot(normalize(normalWorld), toCamera())).pow(1.6); // plus dense au cœur du cône
    const along = positionLocal.y.div(len).add(0.5);                    // 0 en bas, 1 à la lampe
    const motes = mx_noise_float(positionWorld.mul(1.3).add(vec3(0, time.mul(0.05), 0))).mul(0.35).add(0.75);
    bm.colorNode = vec4(vec3(1.0, 0.86, 0.66).mul(edge).mul(smoothstep(0.0, 0.3, along)).mul(smoothstep(0.75, 0.45, along)).mul(motes).mul(0.012).mul(beamK), 1);
    bm.mrtNode = noVelocity();
    const beam = add(new THREE.ConeGeometry(rad, len, 64, 1, true), bm);
    beam.userData.noAssemble = true;
    beam.position.copy(top).add(bot).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), bot.clone().sub(top).normalize());
    beam.renderOrder = 12;
  }

  // ── Socle tourné + platine gravée ───────────────────────────────────────
  const PLATE_R = 2.56;
  {
    const y = Y_BASE;
    add(turned([[0, y - 1.25], [2.3, y - 1.25], [2.4, y - 1.22], [2.44, y - 1.17], [2.2, y - 1.1], [1.25, y - 0.92], [0.98, y - 0.72],
      [0.82, y - 0.5], [0.8, y - 0.42], [0.95, y - 0.3], [1.6, y - 0.21], [2.5, y - 0.14], [2.6, y - 0.1], [2.62, y - 0.07],
      [2.62, y - 0.035], [2.6, y - 0.02], [0, y - 0.02]], 96), M.brassDark);
    // (satinée : sous l'étoile, une platine polie devient un miroir aveuglant)
    add(new THREE.CylinderGeometry(PLATE_R, PLATE_R, 0.02, 96), engraved(plateTexture(), [0.84, 0.6, 0.28], 0.9, 0.62), 0, y - 0.01, 0);
    add(turned([[PLATE_R, y], [PLATE_R, y - 0.02], [PLATE_R + 0.03, y - 0.02], [PLATE_R + 0.03, y - 0.012], [PLATE_R + 0.012, y]], 96), M.brass); // chanfrein
  }

  // ── Limbe gradué, pieds, arceaux, cloche de verre ───────────────────────
  {
    const limb = add(new THREE.RingGeometry(LIMB_R0 + 0.02, LIMB_R1 - 0.02, 256, 1), engraved(limbTexture(), [0.86, 0.62, 0.3]), 0, -0.02, 0);
    limb.rotation.x = -Math.PI / 2;
    // tranche du limbe, chanfreinée dessus et dessous ; gorge où repose la cloche
    add(turned([[LIMB_R0 + 0.02, -0.02], [LIMB_R0, -0.035], [LIMB_R0, -0.125], [LIMB_R0 + 0.02, -0.14], [LIMB_R1 - 0.02, -0.14],
      [LIMB_R1, -0.125], [LIMB_R1, -0.035], [LIMB_R1 - 0.02, -0.02]], 256), M.brassDark);
    add(turned([[LIMB_R1, -0.03], [LIMB_R1 + 0.09, -0.03], [LIMB_R1 + 0.1, -0.01], [LIMB_R1 + 0.1, 0.05], [LIMB_R1 + 0.08, 0.06],
      [LIMB_R1 + 0.065, 0.02], [LIMB_R1 + 0.035, 0.02], [LIMB_R1 + 0.02, 0.06], [LIMB_R1, 0.05]], 256), M.brass);
    const knobG = turned([[0, 0], [0.13, 0], [0.15, 0.03], [0.12, 0.08], [0.07, 0.11], [0, 0.12]], 24);
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const pt = (r, y) => d.clone().multiplyScalar(r).setY(y);
      // pied : du dessous du limbe jusqu'au patin vissé sur la platine
      add(new THREE.TubeGeometry(legCurve(pt, LIMB_RM, Y_BASE), 64, 0.055, 14), M.brass);
      const shoe = add(bridgeGeometry(0.34, 0.17, 0.05), M.brass);
      shoe.position.copy(pt(2.2, Y_BASE + 0.025)); shoe.rotation.y = -a;
      screw(...pt(2.45, Y_BASE + 0.05).toArray(), 0.03);
      add(bushGeometry(0.075, 0.06), M.brass, ...pt(2.38, Y_BASE + 0.08).toArray());
      // pommeau sur le limbe, d'où part l'arceau supérieur
      add(knobG, M.brass).position.copy(pt(LIMB_RM, -0.02));
      add(new THREE.TubeGeometry(new ArchCurve(d, LIMB_RM, DOME_H + 0.02, 0.47), 160, 0.042, 12), M.brass);
    }
    // collier de la trémie : les arceaux s'y arrêtent, la trémie le traverse
    add(bushGeometry(0.5, 0.1, 0.13), M.brass, 0, DOME_H + 0.06, 0);
    for (let k = 0; k < 4; k++) screw(Math.cos(k * Math.PI / 2 + 0.785) * 0.32, DOME_H + 0.11, Math.sin(k * Math.PI / 2 + 0.785) * 0.32, 0.025);
    // cloche (ouverte au sommet pour le collier)
    const dome = add(new THREE.SphereGeometry(1, 128, 48, 0, Math.PI * 2, 0.045, Math.PI / 2 - 0.045), glassMaterial());
    dome.scale.set(LIMB_R1 + 0.05, DOME_H + 0.1, LIMB_R1 + 0.05);
    dome.renderOrder = 10;
  }

  // ── Trémie : réservoir de grains, entonnoir, vanne ─────────────────────
  const heapLevel = uniform(0);
  const heapGlow = uniform(1); // luminosité de la poussière d'étoile dans la trémie
  const valve = dyn(new THREE.Group());
  let heap;
  {
    const Gc = DOME_H + 0.78, GR = 0.55;
    add(new THREE.SphereGeometry(GR, 48, 32), glassMaterial(1.6), 0, Gc, 0).renderOrder = 11;
    // grains dans le réservoir : une sphère dont le dessus est arasé au niveau
    const sm = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0 });
    const sp = positionLocal;
    const sparkle = mx_noise_float(sp.mul(90.0)).mul(0.5).add(0.5);
    sm.colorNode = mix(vec3(0.32, 0.22, 0.16), vec3(0.85, 0.62, 0.42), sparkle.pow(3.0));
    // poussière d'étoile (les débris du cycle précédent) : elle luit et scintille
    const twinkle = mx_noise_float(sp.mul(60.0).add(vec3(0, time.mul(0.4), 0))).mul(0.5).add(0.5);
    sm.emissiveNode = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.85, 0.6), sparkle).mul(sparkle.pow(5.0).mul(4.0).add(0.35)).mul(twinkle.mul(0.6).add(0.6)).mul(heapGlow);
    sm.positionNode = vec3(sp.x, min(sp.y, heapLevel.mul(2 * (GR - 0.03)).sub(GR - 0.03)), sp.z);
    heap = add(new THREE.SphereGeometry(GR - 0.03, 40, 24), sm, 0, Gc, 0);
    heap.userData.isHeap = true;
    // monture : cerclage, chapeau et col
    add(new THREE.TorusGeometry(GR + 0.005, 0.022, 10, 64), M.brass, 0, Gc, 0).rotation.x = Math.PI / 2;
    add(turned([[0, 0], [0.2, 0], [0.22, 0.02], [0.18, 0.07], [0.06, 0.1], [0.05, 0.2], [0.08, 0.23], [0.05, 0.27], [0, 0.28]], 32), M.brass, 0, Gc + GR - 0.04, 0);
    const neckY = Gc - GR;
    add(turned([[0.13, -0.12], [0.19, -0.1], [0.21, -0.07], [0.21, 0.02], [0.16, 0.05], [0.13, 0.05]], 32), M.brass, 0, neckY, 0);
    // entonnoir : du col jusqu'à la buse, à travers le collier
    const y0 = neckY - 0.12, y1 = HOPPER.y + 0.08;
    const funMat = M.brass.clone(); funMat.side = THREE.DoubleSide;
    add(turned([[0.13, y0], [0.125, y0 - 0.25], [0.1, (y0 + y1) / 2], [0.06, y1 + 0.12], [0.05, y1], [0.065, y1 - 0.02],
      [0.065, y1 - 0.06], [0.04, y1 - 0.08]], 32), funMat);
    // vanne : boisseau et sa clé, qui pivote d'un quart de tour à l'ouverture
    add(bushGeometry(0.075, 0.1), M.brassDark, 0, y1 + 0.05, 0);
    valve.position.set(0, y1 + 0.05, 0);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8).rotateZ(Math.PI / 2).translate(0.15, 0, 0), M.steel, 0, 0, 0, valve);
    add(bridgeGeometry(0.18, 0.05, 0.02), M.blued, 0.22, 0, 0, valve).rotation.y = -Math.PI / 2;
    root.add(valve);
  }

  // ── Peigne de la boîte à musique (= la tête de lecture), au-dessus du disque
  // Il pivote sur un pilier planté dans le limbe (axe +X) et se relève quand
  // l'étoile enfle. Il ne sert qu'au son : sans son, il est rentré dans son
  // pilier ; à l'activation, la barre sort vers l'étoile, chaque lame se déplie
  // quand la barre l'a dépassée, puis les pointes montent sur les tiges.
  const teeth = [], combScrews = [];
  const comb = dyn(new THREE.Group());
  const combBar = dyn(new THREE.Group());
  const snowSlider = dyn(new THREE.Group());
  comb.position.set(LIMB_RM, COMB_BAR_Y, COMB_Z);
  root.add(comb);
  const COMB_X0 = R_IN * 0.7 - LIMB_RM; // bout intérieur (repère du peigne)
  {
    pillar(LIMB_RM, COMB_Z, -0.02, COMB_BAR_Y - 0.03, 0.06);
    // barre-talon, d'une pièce (origine au pilier : la barre en sort par mise à l'échelle)
    add(bridgeGeometry(-COMB_X0 + 0.07, 0.13, 0.045, [[-COMB_X0, 0.022]]), M.steel, COMB_X0, 0, 0, combBar);
    comb.add(combBar);
    screw(0, 0.0225, 0, 0.04, comb);
    for (let x = COMB_X0 + 0.6; x < -0.3; x += 1.15) combScrews.push({ g: dyn(screw(x, 0.0225, 0.03, 0.02, comb)), x });
    const spacing = (R_OUT - R_IN) / NTEETH;
    const rootZ = -0.062, dy = TOOTH_TIP_Y - TOOTH_ROOT_Y, dz = (TOOTH_TIP_Z - COMB_Z) - rootZ;
    const Lt = Math.hypot(dy, dz);
    const qBase = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, dy, dz).normalize());
    const toothG = bridgeGeometry(Lt, spacing * 0.68, 0.012);
    for (let i = 0; i < NTEETH; i++) {
      const r = R_IN + (i + 0.5) * spacing;
      const t = dyn(new THREE.Group());
      t.position.set(r - LIMB_RM, TOOTH_ROOT_Y - COMB_BAR_Y, rootZ);
      t.quaternion.copy(qBase);
      add(toothG, M.steel, 0, 0, 0, t);
      // masselottes de plomb sous les lames graves (elles abaissent la note)
      if (i > NTEETH * 0.45) {
        const w = 0.02 + 0.05 * ((i - NTEETH * 0.45) / (NTEETH * 0.55));
        add(new THREE.BoxGeometry(w * 2, 0.02, spacing * 0.5), M.dark, 0.05 + w, -0.016, 0, t);
      }
      comb.add(t);
      teeth.push({ g: t, q0: qBase.clone(), r, x: r - LIMB_RM, amp: 0, t: 0, f: 26 - 14 * (i / NTEETH) });
    }
    // curseur de la ligne des glaces, à cheval sur la barre
    add(bridgeGeometry(0.1, 0.24, 0.12), M.blued, -0.05, 0, 0, snowSlider);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8).translate(0, 0.1, 0), M.steel, 0, 0.06, 0.06, snowSlider);
    add(new THREE.OctahedronGeometry(0.035), M.blued, 0, 0.28, 0.06, snowSlider);
    screw(0, 0.06, -0.06, 0.02, snowSlider);
    comb.add(snowSlider);
  }

  // ── Axe central, arbre de renvoi et grand pont ──────────────────────────
  // positions du rouage dans le repère de la platine (puis demi-tour → monde)
  const polar = (a, r) => new THREE.Vector2(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r);
  const W = (v) => new THREE.Vector3(-v.x, 0, -v.y);
  const dLB = pitchR(10) + pitchR(22), dBC = pitchR(22) + pitchR(8), dCE = pitchR(10) + pitchR(8); // (roue de centre à 10 dents : elle passe à côté du tambour)
  const Lp = polar(150, LAY_D);
  const Bp = Lp.clone().add(polar(240, dLB));
  const Cp = Bp.clone().add(polar(0, dBC));
  const Ep = Cp.clone().add(polar(275, dCE));
  const Fp = Ep.clone().add(polar(275, 0.4));
  const BalP = Fp.clone().add(polar(275, 0.52));
  const layP = W(Lp), bW = W(Bp), cW = W(Cp), eW = W(Ep), fW = W(Fp), balW = W(BalP);
  const dW = new THREE.Vector3(-1.25, 0, 1.22);
  const bridgeY = Y_GEAR0 + (K - 1) * DY_GEAR + 0.09;
  const O = new THREE.Vector3();
  {
    // l'arbre le plus fin monte de la platine jusqu'à l'étoile, qu'il porte dans une coupe
    add(bushGeometry(0.08, 0.04, 0.02), M.bronze, 0, Y_BASE + 0.02, 0);
    arbor(0, 0, Y_BASE, -0.1, 0.02);
    // La coupe est à ~0,1 du centre de la lumière ponctuelle de l'étoile : en
    // 1/d², son reflet brillait bien plus que l'étoile. Elle ignore donc cette
    // lumière et reçoit à la place le reflet d'une sphère de radiance connue.
    const cupM = brass();
    cupM.side = THREE.DoubleSide;
    cupM.lightsNode = lights([lamp, lamp2, hemi, rim, rim2]);
    {
      const d = length(positionWorld).max(1e-3);
      const facing = max(dot(normalWorld, positionWorld.div(d).negate()), 0.0);
      const view = starCupR.div(d).pow(2.0).mul(facing); // facteur de forme de la sphère
      cupM.emissiveNode = vec3(0.95, 0.74, 0.44).mul(starCupL).mul(view.mul(1.6).min(0.85));
    }
    add(turned([[0.02, -0.06], [0.035, -0.06], [0.05, -0.03], [0.075, 0.0], [0.08, 0.01], [0.07, 0.012], [0.045, -0.015], [0.02, -0.03]], 32), cupM, 0, -0.08, 0);
    // arbre de renvoi
    add(bushGeometry(0.09, 0.04, 0.035), M.bronze, layP.x, Y_BASE + 0.02, layP.z);
    arbor(layP.x, layP.z, Y_BASE, bridgeY + 0.03, 0.035);
    // grand pont : bague autour des tubes, palier de l'arbre de renvoi, pilier au bout
    const pEnd = at(O, 1, layP, 1.16);
    bridgeAB(O, layP, bridgeY, 0.2, 0.05, 0, 1.16, [[0, 0.2], [1, 0.035]]);
    add(bushGeometry(0.25, 0.07, 0.19), M.bronze, 0, bridgeY, 0);                 // coussinet des tubes
    add(bushGeometry(0.07, 0.03, 0), M.ruby, layP.x, bridgeY + 0.035, layP.z);    // rubis
    pillar(pEnd.x, pEnd.z, Y_BASE, bridgeY - 0.025, 0.06);
    screw(pEnd.x, bridgeY + 0.025, pEnd.z, 0.035);
    screw(...at(O, 0.5, layP).setY(bridgeY + 0.025).toArray(), 0.022);
  }

  // ── Barillet, rouage du régulateur, échappement, balancier ─────────────
  const Ylay = Y_BASE + 0.07, Ywheel = Y_BASE + 0.15, Yesc = Y_BASE + 0.235, YtrainBr = Y_BASE + 0.36, YbBr = Y_BASE + 0.355;
  const gear = (n, thick, bore, mat, p, y) => dyn(add(gearGeometry(n, thick, bore), mat, p.x, y, p.z));
  const layPin = gear(10, 0.05, 0.035, M.steel, layP, Ylay);
  const barrelGear = gear(22, 0.04, 0.04, M.brass, bW, Ylay);
  const barrel = dyn(new THREE.Group()); barrel.position.copy(bW).setY(Y_BASE + 0.07); root.add(barrel);
  // tambour (avec gorge de couvercle) et trois vis du couvercle
  add(turned([[0.04, 0.02], [0.6, 0.02], [0.62, 0.035], [0.62, 0.23], [0.6, 0.25], [0.56, 0.25], [0.555, 0.24], [0.5, 0.24],
    [0.495, 0.25], [0.04, 0.25]], 64), M.brassDark, 0, 0, 0, barrel);
  for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.005, 12), M.dark, Math.cos(k * 2.1) * 0.38, 0.252, Math.sin(k * 2.1) * 0.38, barrel);
  arbor(bW.x, bW.z, Y_BASE, Y_BASE + 0.46, 0.04);
  // pont de barillet : pilier au bord de la platine, palier au-dessus de l'arbre
  const outB = new THREE.Vector3(bW.x, 0, bW.z).normalize();
  const sideB = new THREE.Vector3(-outB.z, 0, outB.x);
  const bPil = bW.clone().addScaledVector(outB, 0.78);
  bridgeAB(bPil, bW, YbBr, 0.2, 0.04, 0.02, 0.16, [[1, 0.042]]);
  pillar(bPil.x, bPil.z, Y_BASE, YbBr - 0.02, 0.055);
  screw(bPil.x, YbBr + 0.02, bPil.z, 0.032);
  // rochet sur l'arbre, au-dessus du pont ; cliquet et son ressort
  const ratchet = dyn(add(ratchetGeometry(24, 0.26, 0.03, 0.04), M.steel, bW.x, YbBr + 0.04, bW.z));
  screw(bW.x, YbBr + 0.055, bW.z, 0.05);
  const clickPiv = bW.clone().addScaledVector(sideB, 0.36).addScaledVector(outB, 0.12);
  const click = dyn(new THREE.Group()); click.position.copy(clickPiv).setY(YbBr + 0.04); root.add(click);
  const clickBase = -angTo(clickPiv, bW) + 0.18;
  {
    click.rotation.y = clickBase;
    add(bridgeGeometry(0.17, 0.05, 0.026), M.steel, 0, 0, 0, click);
    screw(0, 0.015, 0, 0.022, click);
    const spring = add(bridgeGeometry(0.22, 0.016, 0.02), M.steel, clickPiv.x, YbBr + 0.04, clickPiv.z); // ressort de cliquet
    spring.rotation.y = -angTo(clickPiv, bW) - 1.3; spring.translateZ(0.04);
  }
  // remontoir : couronne au bord du socle ; la tige passe à côté du pont de
  // barillet, une vis sans fin à son bout entraîne le rochet
  const crownG = dyn(new THREE.Group());
  const crownWheel = dyn(add(gearGeometry(18, 0.09, 0), M.brass, 0, 0, 0, crownG)); // couronne moletée
  add(turned([[0, 0.045], [0.08, 0.045], [0.06, 0.08], [0, 0.09]], 20), M.brass, 0, 0, 0, crownG);
  const stemG = dyn(new THREE.Group());
  const stemBase = new THREE.Quaternion().setFromUnitVectors(UP, outB);
  {
    const OFF = 0.19, y = YbBr + 0.04;
    const e0 = Math.sqrt(0.27 * 0.27 - OFF * OFF);
    const a0 = bW.clone().addScaledVector(outB, e0 - 0.05).addScaledVector(sideB, OFF);
    const a1 = bW.clone().addScaledVector(outB, 2.86 - bW.length() - 0.06).addScaledVector(sideB, OFF);
    crownG.position.copy(a1).addScaledVector(outB, 0.06).setY(y);
    crownG.quaternion.copy(stemBase);
    stemG.position.copy(a0).setY(y);
    stemG.quaternion.copy(stemBase);
    root.add(crownG, stemG);
    const len = a0.distanceTo(a1);
    add(new THREE.CylinderGeometry(0.02, 0.02, len, 10).translate(0, len / 2, 0), M.steel, 0, 0, 0, stemG);
    add(new THREE.TubeGeometry(helixCurve(0.032, 0.16, 4), 160, 0.009, 6), M.steel, 0, 0, 0, stemG);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 12).translate(0, 0.08, 0), M.steel, 0, 0, 0, stemG);
    // palier de la tige, vissé sur la platine
    const blk = bW.clone().addScaledVector(outB, 2.5 - bW.length()).addScaledVector(sideB, OFF);
    const h = y + 0.04 - Y_BASE;
    const bl = add(bridgeGeometry(0.12, 0.12, h), M.brassDark, blk.x, Y_BASE + h / 2, blk.z);
    bl.rotation.y = -Math.atan2(outB.z, outB.x); bl.translateX(-0.06);
    screw(blk.x, Y_BASE + h, blk.z, 0.022);
  }
  // roue de centre et échappement
  const centerPin = gear(8, 0.05, 0.018, M.steel, cW, Ylay);
  const centerWheel = gear(10, 0.03, 0.018, M.brass, cW, Ywheel);
  const escPin = gear(8, 0.035, 0.018, M.steel, eW, Ywheel);
  const escape = dyn(add(escapeGeometry(0.26, 0.022, 0.018), M.steel, eW.x, Yesc, eW.z));
  for (const p of [cW, eW]) { arbor(p.x, p.z, Y_BASE, YtrainBr + 0.02); add(bushGeometry(0.05, 0.03, 0), M.bronze, p.x, Y_BASE + 0.015, p.z); }
  // pont de rouage : un pilier au-delà de la roue de centre, rubis sur les pivots
  {
    const pA = at(cW, 0, eW, -0.7);
    bridgeAB(pA, eW, YtrainBr, 0.15, 0.04, 0, 0.1, [[0.7 / (0.7 + cW.distanceTo(eW)), 0.018], [1, 0.018]]);
    pillar(pA.x, pA.z, Y_BASE, YtrainBr - 0.02, 0.05);
    screw(pA.x, YtrainBr + 0.02, pA.z, 0.03);
    for (const p of [cW, eW]) add(bushGeometry(0.035, 0.025, 0), M.ruby, p.x, YtrainBr + 0.028, p.z);
  }
  // ancre : palettes de rubis sur la roue d'échappement, fourchette vers le balancier
  const anchor = dyn(new THREE.Group()); anchor.position.copy(fW).setY(Yesc); root.add(anchor);
  const anchorBase = -angTo(fW, eW);
  {
    anchor.rotation.y = anchorBase;
    add(bridgeGeometry(0.34, 0.05, 0.02), M.steel, 0.14, 0, -0.17, anchor).rotation.y = -Math.PI / 2;
    add(bridgeGeometry(0.14, 0.05, 0.02), M.steel, 0, 0, 0, anchor);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.03, 0.025), M.ruby, 0.17, 0, s * 0.17, anchor);
    add(bridgeGeometry(0.44, 0.035, 0.02), M.steel, 0, 0, 0, anchor).rotation.y = Math.PI;
    for (const s of [-1, 1]) add(bridgeGeometry(0.05, 0.016, 0.02), M.steel, -0.44, 0, s * 0.028, anchor).rotation.y = Math.PI;
    arbor(fW.x, fW.z, Y_BASE, Y_BASE + 0.33, 0.014);
    // pont d'ancre (petit coq)
    const perpF = new THREE.Vector3(-(eW.z - fW.z), 0, eW.x - fW.x).normalize();
    const pa = fW.clone().addScaledVector(perpF, -0.3);
    bridgeAB(pa, fW, Y_BASE + 0.32, 0.1, 0.03, 0, 0.06, [[1, 0.014]]);
    pillar(pa.x, pa.z, Y_BASE, Y_BASE + 0.305, 0.04);
    screw(pa.x, Y_BASE + 0.335, pa.z, 0.024);
  }
  // balancier spiral, sous son coq
  const balance = dyn(new THREE.Group());
  const Ybal = Y_BASE + 0.29;
  balance.position.copy(balW).setY(Ybal);
  let hair;
  {
    add(turned([[0.335, -0.018], [0.38, -0.018], [0.385, -0.012], [0.385, 0.012], [0.38, 0.018], [0.335, 0.018], [0.33, 0.012], [0.33, -0.012]], 64), M.brass, 0, 0, 0, balance);
    for (let k = 0; k < 3; k++) add(bridgeGeometry(0.33, 0.03, 0.016), M.brass, 0, 0, 0, balance).rotation.y = (k / 3) * Math.PI * 2;
    add(bushGeometry(0.045, 0.03, 0.012), M.brass, 0, 0, 0, balance);
    const studG = turned([[0, 0], [0.018, 0], [0.018, 0.012], [0.012, 0.02], [0, 0.022]], 10);
    for (let k = 0; k < 12; k++) { // vis de réglage sur la serge
      const a = (k / 12) * Math.PI * 2, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      add(studG, M.blued, d.x * 0.385, 0, d.z * 0.385, balance).quaternion.setFromUnitVectors(UP, d);
    }
    add(bushGeometry(0.05, 0.02, 0.012), M.steel, 0, -0.04, 0, balance);                       // plateau
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), M.ruby, 0.04, -0.055, 0, balance);  // cheville
    root.add(balance);
    const pts = [];
    for (let i = 0; i <= 500; i++) {
      const t = i / 500, ang = t * Math.PI * 2 * 9, r = 0.03 + t * 0.2;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.035, Math.sin(ang) * r));
    }
    hair = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicNodeMaterial({ color: 0x3a56b0 }));
    balance.add(hair);
    arbor(balW.x, balW.z, Y_BASE, Y_BASE + 0.45, 0.012);
    add(bushGeometry(0.04, 0.02, 0), M.ruby, balW.x, Y_BASE + 0.01, balW.z);
    // coq : pont en porte-à-faux au-dessus du balancier, piton du spiral
    const sdB = new THREE.Vector3(-balW.z, 0, balW.x).normalize();
    const foot = balW.clone().addScaledVector(sdB, 0.5);
    bridgeAB(foot, balW, Y_BASE + 0.44, 0.15, 0.035, 0.05, 0.08, [[1, 0.012]]);
    pillar(foot.x, foot.z, Y_BASE, Y_BASE + 0.4225, 0.06);
    screw(foot.x, Y_BASE + 0.4575, foot.z, 0.035);
    add(bushGeometry(0.04, 0.02, 0), M.ruby, balW.x, Y_BASE + 0.465, balW.z);
    const stud = balW.clone().addScaledVector(sdB, 0.23);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.11, 8).translate(0, -0.055, 0), M.steel, stud.x, Y_BASE + 0.42, stud.z);
  }
  // levier d'arrêt : bloque la serge du balancier (pause, remontage) puis se
  // déclenche pour libérer un nouveau cycle
  const stop = dyn(new THREE.Group());
  let stopOn, stopOff;
  {
    const sd = new THREE.Vector3(-balW.z, 0, balW.x).normalize();
    const piv = balW.clone().addScaledVector(sd, -0.62).setY(Ybal);
    stop.position.copy(piv);
    stopOn = -angTo(piv, balW); stopOff = stopOn + 0.6;
    stop.rotation.y = stopOff;
    add(bridgeGeometry(0.2, 0.05, 0.03), M.blued, 0, 0, 0, stop);
    add(new THREE.BoxGeometry(0.04, 0.03, 0.04), M.ruby, 0.215, 0, 0, stop);
    arbor(piv.x, piv.z, Y_BASE, Ybal + 0.03, 0.014);
    screw(0, 0.015, 0, 0.022, stop);
    root.add(stop);
  }
  // cadran de la réserve de marche, posé sur trois pieds
  const dial = new THREE.Group();
  dial.position.copy(dW).setY(Y_BASE + 0.08);
  dial.rotation.y = Math.PI / 2; // le haut du cadran vers le fond : lisible depuis la vue d'ensemble
  root.add(dial);
  {
    add(new THREE.CylinderGeometry(0.52, 0.52, 0.03, 64), engraved(dialTexture(), [0.5, 0.47, 0.4], 0.15, 0.55), 0, 0.015, 0, dial); // émail un peu jauni
    add(turned([[0.5, 0], [0.56, 0], [0.57, 0.012], [0.57, 0.04], [0.555, 0.055], [0.52, 0.05], [0.5, 0.035]], 64), M.brass, 0, 0, 0, dial);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      add(new THREE.CylinderGeometry(0.03, 0.035, 0.08, 12).translate(0, -0.04, 0), M.brass, Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45, dial);
    }
  }
  const hand = dyn(new THREE.Group()); hand.position.y = 0.045; dial.add(hand);
  {
    const s = new THREE.Shape(); // aiguille « poire »
    s.moveTo(-0.08, 0); s.lineTo(0, -0.012); s.lineTo(0.3, -0.004); s.lineTo(0.4, 0); s.lineTo(0.3, 0.004); s.lineTo(0, 0.012); s.closePath();
    add(plate(s, 0.008, 0.002), M.blued, 0, 0, 0, hand);
    add(bushGeometry(0.03, 0.02, 0), M.blued, 0, 0, 0, hand);
  }

  // ── Pièces mobiles, une par planète portée ──────────────────────────────
  // (matériaux à part, sans vecteur vitesse : ces pièces suivent les planètes)
  const noVel = new Map();
  const inst = (geo, mat0) => {
    if (!noVel.has(mat0)) { const c = mat0.clone(); c.mrtNode = noVelocity(); noVel.set(mat0, c); }
    const m = new THREE.InstancedMesh(geo, noVel.get(mat0), K);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    root.add(m);
    return m;
  };
  const rodX = new THREE.CylinderGeometry(1, 1, 1, 12).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
  const rodY = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
  const HUB_IN = 0.72; // rapport alésage / diamètre des bagues instanciées
  const hubG = bushGeometry(1, 1, HUB_IN, 0.06);
  const P = {
    arms: inst(rodX, M.brass),
    counters: inst(rodX, M.brass),
    weights: inst(turned([[0, -0.5], [0.85, -0.5], [1, -0.3], [1, 0.3], [0.85, 0.5], [0, 0.5]], 24), M.brassDark),
    stems: inst(rodY, M.steel),
    pins: inst(rodY, M.steel),
    pinTips: inst(new THREE.SphereGeometry(1, 10, 8), M.steel),
    bosses: inst(bushGeometry(1, 1, 0, 0.18), M.brass),
    collars: inst(turned([[0, -0.5], [0.45, -0.5], [0.55, -0.2], [1, 0.4], [0.95, 0.5], [0.4, 0.1], [0, 0.1]], 24), M.brass),
    tubes: inst(new THREE.CylinderGeometry(1, 1, 1, 24).translate(0, 0.5, 0), M.brass),
    hubs: inst(hubG, M.brassDark),
    hubScrews: inst(new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2), M.blued),
    gearHubs: inst(hubG, M.brass),
    pinHubs: inst(hubG, M.steel),
  };
  const instanced = Object.values(P);
  // réserve de roues et de pignons (une paire par bras)
  const gearPool = [];
  for (let k = 0; k < K; k++) {
    const g = dyn(add(gearGeometry(20, 0.028, 0.04), M.brass)), p = dyn(add(gearGeometry(20, 0.028, 0.035), M.steel));
    g.visible = p.visible = false; gearPool.push({ g, p });
  }
  const tubeR = (j) => 0.035 + 0.013 * j;
  const thLay = Math.atan2(layP.z, layP.x);

  const gallery = createGallery(root, b, M);

  // ombres : toute la mécanique en porte et en reçoit (pas le verre)
  root.traverse((o) => {
    if (!o.isMesh) return;
    const glass = o.material.blending === THREE.AdditiveBlending;
    o.castShadow = !glass && !o.userData.isHeap && !o.userData.noCast;
    o.receiveShadow = !glass;
  });
  // hors tournage, les pièces fixes sont fusionnées (l'assemblage du film les anime une à une)
  if (!film) mergeStatic(root);

  // ── Animation ───────────────────────────────────────────────────────────
  // Suivi des bras : un bras ne surgit jamais d'un coup. Quand une planète est
  // prise en charge, son bras sort de la bague (la tringle s'allonge, puis la
  // tige monte sous la bille) ; quand elle disparaît (fusion, éjection, ou elle
  // n'est plus parmi les plus massives), le bras redescend et rentre en
  // continuant de tourner à la vitesse képlérienne. Sa roue glisse dans la pile
  // quand l'ordre des rayons change. Seuils à hystérésis : pas de clignotement.
  const track = new Map(); // index → { alive, e, s, x, y, z, a, phi, mE, pair }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const place = (mesh, i, pos, rotY, scale) => { _q.setFromAxisAngle(UP, rotY); _m.compose(pos, _q, scale); mesh.setMatrixAt(i, _m); };
  const S = { comb: 0, combT: 0, snowX: null, lay: 0, escCont: 0, ph: 0, amp: 0, reserve: 1, ratchet: 0, crown: 0, tooth: 0, stop: 1, cycle: -1, valve: 0, lift: 0 };
  const api = { root, onClick: null, onClack: null, collect: 0 };
  const zAxis = new THREE.Vector3(0, 0, 1), xAxis = new THREE.Vector3(1, 0, 0), _qb = new THREE.Quaternion();
  const R_ESC = (10 / 22) * (22 / 8) * (10 / 8); // rapport renvoi → échappement

  function updateArms(planets, pred, dtSim, dtReal, k) {
    const ok = (p) => pred.has(p.index) && p.a < LIMB_R0 - 0.4 && p.a > 0.2;
    const byIdx = new Map(planets.map((p) => [p.index, p]));
    // planètes perdues ou devenues trop légères : leur bras rentre
    for (const [i, t] of track) {
      const p = byIdx.get(i);
      if (t.alive && (!p || !ok(p) || p.mE < M_OUT)) t.alive = false;
    }
    // nouvelles planètes : un bras libre, ou on libère le plus léger si la nouvelle est nettement plus massive
    const cands = planets.filter((p) => ok(p) && p.mE >= M_IN && !(track.get(p.index)?.alive)).sort((a, b) => b.m - a.m);
    for (const p of cands) {
      const old = track.get(p.index);
      if (old) { old.alive = true; continue; } // (bras en train de rentrer : il ressort)
      if (track.size >= K) {
        const alive = [...track.values()].filter((t) => t.alive).sort((a, b) => a.mE - b.mE);
        if (alive.length && p.mE > alive[0].mE * SWAP) alive[0].alive = false;
        continue; // (le bras libéré servira quand il sera rentré)
      }
      const used = new Set([...track.values()].map((t) => t.pair));
      track.set(p.index, { alive: true, e: 0, s: -1, phi: 0, pair: gearPool.find((q) => !used.has(q)), mE: p.mE });
    }
    // planète vivante → position du GPU ; bras qui rentre → il poursuit son orbite
    for (const [i, t] of track) {
      const q = t.alive ? pred.get(i) : null;
      if (q) { t.x = q[0]; t.y = q[1]; t.z = q[2]; t.a = Math.hypot(q[0], q[2]); t.phi = Math.atan2(q[2], q[0]); t.mE = byIdx.get(i).mE; }
      else if (t.a) { t.phi += dtSim * Math.pow(t.a, -1.5); t.x = t.a * Math.cos(t.phi); t.z = t.a * Math.sin(t.phi); }
      t.e = Math.max(0, Math.min(1, t.e + (t.alive ? dtReal / 1.3 : -dtReal / 1.0)));
    }
    for (const [i, t] of track) if (!t.alive && t.e <= 0) { t.pair.g.visible = t.pair.p.visible = false; track.delete(i); }
    // étages : par rayon croissant (la plus proche en haut) ; glissement doux
    const order = [...track.values()].filter((t) => t.a).sort((a, b) => a.a - b.a);
    order.forEach((t, j) => { t.s = t.s < 0 ? j : t.s + (j - t.s) * Math.min(1, dtReal * 2.5); });
    order.forEach((t, j) => {
      const sl = t.s, e = t.e;
      const eArm = ss(0, 0.55, e), eStem = ss(0.5, 0.9, e), ePin = ss(0.85, 1, e) * ss(0.78, 1, S.comb), eHub = ss(0, 0.25, e);
      const { x, y, z, a, phi } = t;
      const ya = Y_ARM0 - sl * DY_ARM, vr = planetRadius(t.mE, k), rT = tubeR(sl);
      const ra = 0.014 + 0.008 * Math.min(1, Math.cbrt(t.mE / 30)); // rayon de la tringle
      const rHub = rT / HUB_IN, back = 0.26 + 0.09 * (Math.round(sl) % 3);
      const cx = Math.cos(phi), cz = Math.sin(phi);
      const reach = rHub * 0.97 + (a - rHub * 0.97) * eArm; // bout de la tringle
      const tx = cx * reach, tz = cz * reach;
      // bague serrée sur le tube (vis de pression), tringle, contre-tringle et contrepoids
      place(P.hubs, j, _p.set(0, ya, 0), 0, _s.set(rHub * eHub, 0.06, rHub * eHub));
      place(P.hubScrews, j, _p.set(-cz * rHub, ya, cx * rHub), -phi, _s.set(0.012 * eHub, 0.03 * eHub, 0.012 * eHub));
      place(P.arms, j, _p.set(cx * rHub * 0.97, ya, cz * rHub * 0.97), -phi, _s.set(Math.max(1e-3, reach - rHub * 0.97), ra * eHub, ra * eHub));
      const bk = rHub + (back - rHub) * eArm;
      place(P.counters, j, _p.set(-cx * rHub * 0.97, ya, -cz * rHub * 0.97), Math.PI - phi, _s.set(Math.max(1e-3, bk - rHub), ra * eHub, ra * eHub));
      place(P.weights, j, _p.set(-cx * bk, ya, -cz * bk), -phi, _s.set((0.04 + 2 * ra) * eHub, 0.07 * eHub, (0.04 + 2 * ra) * eHub));
      place(P.bosses, j, _p.set(tx, ya, tz), 0, _s.set(ra * 1.9 * eHub, ra * 2.6 * eHub, ra * 1.9 * eHub));
      // tige : monte du bossage jusque sous la planète ; pointe au-dessus
      const top = y - vr * 0.85, stemTop = ya + (top - ya) * eStem;
      place(P.stems, j, _p.set(tx, ya, tz), 0, _s.set(0.009 * eHub, Math.max(0.005, stemTop - ya), 0.009 * eHub));
      place(P.collars, j, _p.set(tx, stemTop, tz), 0, _s.setScalar((vr * 0.6 + 0.008) * eStem));
      const pin0 = y + vr * 0.9;
      place(P.pins, j, _p.set(x, pin0, z), 0, _s.set(0.004 * ePin, Math.max(0.001, (PIN_TOP - pin0) * ePin), 0.004 * ePin));
      place(P.pinTips, j, _p.set(x, pin0 + (PIN_TOP - pin0) * ePin, z), 0, _s.setScalar(0.007 * ePin));
      // tube (de sa roue jusqu'à sa bague) ; roue solidaire du tube, donc du bras
      const gy = Y_GEAR0 + sl * DY_GEAR;
      place(P.tubes, j, _p.set(0, gy, 0), 0, _s.set(rT, Math.max(1e-3, ya - gy), rT));
      // rapport : ω_planète / ω_renvoi = n_pignon / n_roue, n_roue + n_pignon = 40
      const om = Math.pow(Math.max(a, 0.2), -1.5);
      const ng = Math.min(LAY_N - 8, Math.max(8, Math.round((LAY_N * OMEGA_L) / (OMEGA_L + om)))), np = LAY_N - ng;
      const { g: Gw, p: Pw } = t.pair, bore = tubeR(Math.round(sl));
      if (Gw.userData.n !== ng || Gw.userData.b !== bore) { Gw.geometry = gearGeometry(ng, 0.028, bore); Gw.userData.n = ng; Gw.userData.b = bore; }
      if (Pw.userData.n !== np) { Pw.geometry = gearGeometry(np, 0.028, 0.035); Pw.userData.n = np; }
      Gw.visible = Pw.visible = true;
      Gw.position.set(0, gy, 0); Gw.rotation.y = -phi; Gw.scale.set(eHub, 1, eHub);
      Pw.position.set(layP.x, gy, layP.z); Pw.scale.set(eHub, 1, eHub);
      Pw.rotation.y = meshAngle(Gw.rotation.y, ng, np, thLay); // ses dents dans les creux de la roue
      place(P.gearHubs, j, _p.set(0, gy + 0.03, 0), 0, _s.set(rHub * 0.95, 0.035, rHub * 0.95));
      place(P.pinHubs, j, _p.set(layP.x, gy + 0.03, layP.z), 0, _s.set(0.035 / HUB_IN * eHub, 0.035, 0.035 / HUB_IN * eHub));
    });
    for (const m of instanced) { m.count = order.length; m.instanceMatrix.needsUpdate = true; }
  }

  // planets : liste de app/planets.js ; pred : index → [x, y, z] (instant présent) ;
  // running : la simulation avance ; life : cycle de vie ; k : échelle des
  // planètes ; pour : { t, dur } du versement du nuage
  function update(planets, pred, dtSim, dtReal, running, life, k = 1, pour = null) {
    updateArms(planets, pred, dtSim, dtReal, k);

    // ── réserve de marche, aspiration et remontage (d'après le cycle de vie)
    const ph = life.phase, pr = Math.min(1, life.p.progress || 0);
    let cum = 0;
    for (let i = 0; i < ph; i++) cum += PHASE_W[i];
    let target, winding = false;
    if (ph < 6) target = 1 - cum - PHASE_W[ph] * pr;
    else if (pr < WIND0) target = PHASE_W[6] * (1 - pr / WIND0);
    else { winding = pr < WIND1 + 0.05; target = ss(WIND0, WIND1, pr); }
    const prevRes = S.reserve;
    S.reserve += (target - S.reserve) * Math.min(1, dtReal * (winding ? 10 : 3));
    const dRes = S.reserve - prevRes;
    if (dRes > 0 && winding) {
      S.ratchet += dRes * 6 * Math.PI * 2;      // six tours de ressort pour un cycle
      S.crown += dRes * 6 * Math.PI * 2 * 1.45; // (rapport couronne / rochet)
    }
    ratchet.rotation.y = -S.ratchet;
    crownWheel.rotation.y = S.crown;
    stemG.quaternion.copy(stemBase).multiply(_qb.setFromAxisAngle(UP, S.crown));
    const toothF = S.ratchet / ((Math.PI * 2) / 24), tooth = Math.floor(toothF);
    if (tooth !== S.tooth) { S.tooth = tooth; if (winding) api.onClick?.(); }
    click.rotation.y = clickBase - 0.25 * (toothF - tooth);
    hand.rotation.y = -dialAngle(S.reserve);
    // trémie : les débris remontent pendant le remontage ; au nouveau cycle la
    // vanne s'ouvre et le réservoir se vide dans la cloche
    api.collect = ph === 6 ? ss(WIND0, WIND1, pr) : 0;
    let fill = 0, open = 0;
    if (ph === 6) fill = api.collect;
    else if (ph === 0 && pour) { fill = 1 - ss(0, pour.dur, pour.t); open = pour.t < pour.dur + 0.5 ? 1 : 0; }
    heapLevel.value = fill;
    heap.visible = fill > 0.01;
    S.valve += (open - S.valve) * Math.min(1, dtReal * 5);
    valve.rotation.y = S.valve * Math.PI / 2;

    // ── levier d'arrêt
    const held = !running || (ph === 6 && pr > WIND0 - 0.05);
    if (life.cycle !== S.cycle) {
      if (S.cycle >= 0) api.onClack?.();
      S.cycle = life.cycle;
    }
    S.stop += ((held ? 1 : 0) - S.stop) * Math.min(1, dtReal * (held ? 4 : 14));
    stop.rotation.y = stopOff + (stopOn - stopOff) * S.stop;

    // ── rouage : l'arbre de renvoi tourne avec le temps simulé ; la roue
    //    d'échappement avance par à-coups et tout le rouage la suit, dents
    //    dans les creux (rapports exacts : 10/22, 22/8, 10/8)
    const dLay = dtSim * OMEGA_L;
    S.lay += dLay;
    S.escCont += dLay * R_ESC;
    S.ph = S.escCont * 15; // une oscillation du balancier par dent d'échappement
    const rate = dtReal > 0 ? (dLay * R_ESC * 15) / dtReal / (Math.PI * 2) : 0; // Hz
    const half = Math.floor(S.ph / Math.PI), fr = Math.min(1, (S.ph / Math.PI - half) * 5);
    const escRot = ((half + fr * fr * (3 - 2 * fr)) * Math.PI) / 15;
    escape.rotation.y = escRot; escPin.rotation.y = escRot;
    const cRot = meshAngle(escRot, 8, 10, angTo(eW, cW));
    centerWheel.rotation.y = cRot; centerPin.rotation.y = cRot;
    const bRot = meshAngle(cRot, 8, 22, angTo(cW, bW));
    barrelGear.rotation.y = bRot; barrel.rotation.y = bRot;
    layPin.rotation.y = meshAngle(bRot, 22, 10, angTo(bW, layP));
    // balancier : amplitude réduite quand il bat très vite ou que le ressort
    // faiblit ; immobilisé par le levier d'arrêt
    const ampT = held ? 0 : Math.min(1, 0.35 + S.reserve * 4) / (1 + Math.max(0, rate - 5) / 5);
    S.amp += (ampT - S.amp) * Math.min(1, dtReal * (held ? 6 : 2));
    const osc = Math.sin(S.ph), bAng = osc * 2.5 * S.amp;
    balance.rotation.y = bAng;
    hair.scale.set(1 + 0.05 * osc * S.amp, 1, 1 + 0.05 * osc * S.amp);
    hair.rotation.y = -bAng * 0.85;
    anchor.rotation.y = anchorBase + 0.12 * Math.tanh(osc * 5) * Math.min(1, S.amp * 3);

    gallery.update(dtReal, life.cycle, S.lay, rate, S.reserve, api.collect);

    // ── peigne : relevé si l'étoile enfle ; curseur de la ligne des glaces
    const starR = life.p.starVisR || 0.06;
    const liftT = Math.atan(Math.max(0, starR + 0.25 - (TOOTH_TIP_Y - 0.02)) / (LIMB_RM - R_IN));
    S.lift += (liftT - S.lift) * Math.min(1, dtReal * 1.5);
    comb.rotation.z = -S.lift;
    // sortie / rentrée du peigne (son actif ou coupé), à vitesse constante
    S.comb += Math.max(-dtReal / COMB_DUR, Math.min(dtReal / COMB_DUR, S.combT - S.comb));
    const reach = smoother(ss(0, 0.8, S.comb)); // la barre sort pendant les 4/5 du temps
    combBar.scale.x = Math.max(1e-3, reach);
    combBar.visible = reach > 1e-3;
    const xEnd = COMB_X0 * reach;              // bout de la barre (x < 0, vers l'étoile)
    for (const c of combScrews) { const kk = ss(0, 0.15, c.x - xEnd); c.g.scale.setScalar(0.02 * kk); c.g.visible = kk > 0; }
    const sx = Math.min(R_OUT, Math.max(R_IN, life.p.snow || 2.7)) - LIMB_RM;
    S.snowX = S.snowX === null ? sx : S.snowX + (sx - S.snowX) * Math.min(1, dtReal * 2);
    snowSlider.position.x = Math.max(S.snowX, xEnd + 0.05); // (poussé par le bout de la barre quand elle rentre)
    snowSlider.scale.setScalar(Math.max(1e-3, ss(0, 0.12, reach)));
    snowSlider.visible = reach > 1e-3;
    const fin = ss(0.8, 1, S.comb);            // (les dernières lames finissent de se déplier)
    // lames : rentrées tant que la barre ne les a pas dépassées, puis elles en
    // sortent et s'abaissent ; vibration amortie après le passage d'une pointe
    for (const t of teeth) {
      const u = Math.min(1, Math.max(0, (t.x - xEnd) / 0.5 + fin));
      t.g.visible = t.x - xEnd > 0;
      if (t.amp >= 1e-3) { t.t += dtReal; t.amp *= Math.exp(-dtReal * 3.2); } else t.amp = 0;
      if (u >= 1 && t.amp === 0 && t.u === 1) continue; // (au repos : rien à recalculer)
      t.u = u;
      const bend = t.amp ? (t.t < 0.06 ? t.t / 0.06 : Math.cos((t.t - 0.06) * t.f * Math.PI * 2 / 6)) * 0.12 * t.amp : 0;
      const us = smoother(u);
      t.g.quaternion.setFromAxisAngle(xAxis, COMB_FOLD * (1 - us)).multiply(t.q0).multiply(_qb.setFromAxisAngle(zAxis, bend));
      t.g.scale.set(Math.max(1e-3, us), 1, 1);
    }
  }

  // ── Tournage : variateur des lumières et reflets réels ─────────────────
  const assembly = createAssembly(root);
  const base = { lamp: lamp.intensity, lamp2: lamp2.intensity, hemi: hemi.intensity, rim: rim.intensity, rim2: rim2.intensity };
  let lightLevel = 1, starLightK = 1, liveOn = false;

  // Une caméra cube, au-dessus de la platine, capte à chaque image ce qui
  // entoure la machine (disque, étoile, cloche, velours) et des panneaux de
  // studio qui n'existent que pour les reflets. Le métal et le verre reflètent
  // cette image : le laiton reflète le disque qui tourne au-dessus de lui.
  function liveEnv({ size = 384, layer = 2 } = {}) {
    liveOn = true;
    const rt = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true });
    const cam = new THREE.CubeCamera(0.05, 200, rt);
    cam.position.set(0, -1.6, 0);
    cam.layers.set(layer);
    for (const c of cam.children) c.layers.set(layer);
    scene.add(cam);
    // tout ce qui n'est pas la machine apparaît dans les reflets (plus le tas, le velours, le faisceau)
    const inMachine = (o) => { for (let m = o; m; m = m.parent) if (m === root) return true; return false; };
    scene.traverse((o) => { if (!inMachine(o)) o.layers.enable(layer); });
    root.traverse((o) => { if (o.userData.isHeap || o.userData.noAssemble) o.layers.enable(layer); });
    // pas de vecteurs vitesse au tournage (le flou vient des sous-images) : sans
    // quoi ces matériaux n'ont aucune sortie dans la sonde
    scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) if (m.mrtNode) m.mrtNode = null; });
    // panneaux de studio (cartes de réflexion), aux bords très doux
    const card = (w, h, col, kk, pos) => {
      const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
      const e = uv().sub(0.5).abs().mul(2.0);
      m.colorNode = vec3(...col).mul(kk).mul(beamK.add(0.0001)).mul(smoothstep(1.0, 0.45, e.x).mul(smoothstep(1.0, 0.45, e.y)));
      const c = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      c.position.copy(pos); c.lookAt(0, -1.5, 0); c.layers.set(layer);
      scene.add(c);
    };
    card(14, 7, [1.0, 0.88, 0.72], 3.2, lamp.position.clone().multiplyScalar(1.4)); // softbox de la lampe
    card(1.6, 16, [0.62, 0.78, 1.0], 1.6, new THREE.Vector3(14, 4, -20));          // bandes froides, contre-jour
    card(1.2, 13, [0.7, 0.82, 1.0], 1.0, new THREE.Vector3(-22, 3, -9));
    card(6, 4, [1.0, 0.86, 0.66], 0.6, new THREE.Vector3(-14, 6, 24));             // fenêtre lointaine
    // le métal reflète la sonde (PMREM recalculé à chaque image)
    env = rt.texture;
    eachMaterial((m) => { if (m.isMeshStandardMaterial) { m.envMap = env; m.envMapIntensity = 0.75; m.needsUpdate = true; } });
    // le verre reflète vraiment la scène (Fresnel)
    eachMaterial((m, o) => {
      if (!o.isMesh || !m.userData.glass) return;
      const fres = pow(float(1).sub(abs(dot(normalize(normalWorld), toCamera()))), 5.0).mul(0.96).add(0.04);
      m.colorNode = vec4(cubeTexture(rt.texture, reflectVector).rgb.mul(fres).mul(m.userData.glass * 0.9).mul(glassK.mul(0.6).add(0.4)), 1);
      m.needsUpdate = true;
    });
    // ombres en haute définition
    lamp.shadow.mapSize.set(4096, 4096); lamp.shadow.map?.dispose(); lamp.shadow.map = null; lamp.shadow.radius = 4;
    starLight.shadow.mapSize.set(2048, 2048); starLight.shadow.map?.dispose(); starLight.shadow.map = null;
    return {
      update() {
        const vis = root.visible;
        cam.update(renderer, scene);
        rt.texture.needsPMREMUpdate = true;
        root.visible = vis;
      },
    };
  }

  return Object.assign(api, {
    update,
    glassK, heapGlow, liveEnv,
    assemblyApply: assembly.apply, assemblyRestore: assembly.restore,

    // une planète croise la tête : sa pointe soulève la lame de son rayon
    pluck(a, strength = 1) {
      if (S.comb < 1) return; // (peigne rentré ou en mouvement)
      let best = null, bd = 1e9;
      for (const t of teeth) { const d = Math.abs(t.r - a); if (d < bd) { bd = d; best = t; } }
      if (!best) return;
      best.amp = Math.min(1, best.amp + 0.6 + 0.4 * strength);
      best.t = 0;
    },

    // la cloche de la galerie sonne (impact géant)
    strike: gallery.strike,

    // son actif → peigne sorti ; immediate : sans animation
    setComb(on, immediate = false) { S.combT = on ? 1 : 0; if (immediate) S.comb = S.combT; },

    // éclairage par l'étoile (couleur et luminosité du cycle de vie) ;
    // surface, radius : radiance et rayon du disque stellaire (reflet de la coupe)
    setStar(color, lightK, shell = 0, surface = 1, radius = 0.06) {
      starCupL.value.setRGB(color[0] * surface, color[1] * surface, color[2] * surface);
      starCupR.value = radius;
      // couleur saturée aux deux tiers : la géante baigne la machine de rouge, le laiton reste lisible
      starLight.color.setRGB(0.3 + 0.7 * color[0], 0.3 + 0.7 * color[1], 0.3 + 0.7 * color[2]);
      starLight.intensity = (4.5 * Math.min(1.6, lightK) + 70 * shell) * starLightK;
    },

    setVisible(v) {
      root.visible = v;
      if (v) applyEnv();
    },

    // variateur (tournage) : 0 = noir complet, 1 = plan lumière normal ; starK pour l'étoile
    setLightLevel(kk, starK = kk) {
      if (kk === lightLevel && starK === starLightK) return;
      lamp.intensity = base.lamp * kk; lamp2.intensity = base.lamp2 * kk; hemi.intensity = base.hemi * kk;
      rim.intensity = base.rim * kk; rim2.intensity = base.rim2 * kk; beamK.value = kk;
      starLight.intensity *= starK / Math.max(1e-4, starLightK); starLightK = starK;
      if (Math.abs(kk - lightLevel) > 1e-3 || kk === 0 || kk === 1) {
        // (sonde vivante : l'étoile et le disque ne dépendent pas de la lampe)
        eachMaterial((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = liveOn ? 0.75 : ENV_K * kk; });
      }
      lightLevel = kk;
    },
  });
}
