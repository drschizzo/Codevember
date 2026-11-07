// Galerie des automates : une plate-forme annulaire autour du pied du socle.
// Une grande couronne dentée (88 dents), tirée par un POIDS MOTEUR qui descend
// au fil du cycle, entraîne une ronde de stations ; chacune lit un aspect de
// la simulation :
//   · RÉGULATEUR À BOULES : les boules s'écartent avec la vitesse du temps ;
//   · TAMBOUR À CAMES (le programme du cycle) : trois cames — luminosité de
//     l'étoile, gaz du disque, ligne des glaces — poussent des crémaillères
//     qui font tourner les aiguilles de trois cadrans ;
//   · COMPTEUR À ROULEAUX : orbites à 1 UA et numéro du cycle ;
//   · POMPE À SOUFFLET : aspire les débris à la fin du cycle ; sa conduite
//     remonte le long d'un pied et d'un arceau jusqu'à la trémie ;
//   · CLOCHE : frappée à chaque impact géant.
import * as THREE from 'three/webgpu';
import { Y_BASE, LIMB_RM, DOME_H, PHASE_CUM, OMEGA_L, pitchR } from './layout.js';
import { plate, circlePath, turned, gearShape, gearGeometry, bushGeometry, bridgeGeometry, meshAngle, ArchCurve, legCurve, helixCurve } from './geometry.js';
import { engraved } from './materials.js';
import { gaugeTexture, digitsTexture } from './textures.js';
import { UP, dyn } from './builder.js';
import { ss } from '../util.js';

const RING_N = 88;

// profils des trois cames : la grandeur au fil du cycle (f = fraction du cycle)
const c = PHASE_CUM;
const starLight = (f) => {
  if (f < c[1]) return 0.1 + 0.15 * f / c[1];
  if (f < c[2]) return 0.25 + 0.3 * ss(c[1], c[1] + 0.06, f);
  if (f < c[4]) return 0.55 + 0.1 * (f - c[2]) / (c[4] - c[2]);
  if (f < c[5]) return 0.65 + 0.35 * ss(c[4], c[5], f);
  return 1 - 0.85 * ss(c[5], 1, f);
};
const CAMS = [
  starLight,                                                                   // luminosité de l'étoile
  (f) => (f < c[1] ? 1 : f < c[2] ? 1 - ss(c[1], c[2], f) : 0.02),             // gaz du disque
  (f) => Math.sqrt(starLight(f)),                                              // ligne des glaces (∝ √L)
];

export function createGallery(root, { add, screw, pillar, arbor, bridgeAB }, M) {
  const Yg = Y_BASE - 0.62, RIN = 0.93, ROUT = 3.85, RING_R = pitchR(RING_N);
  const G = { stations: [] };

  // plate-forme (anneau tourné, bord mouluré) et consoles chantournées
  add(turned([[RIN, 0], [ROUT - 0.03, 0], [ROUT, 0.015], [ROUT, 0.045], [ROUT - 0.02, 0.06], [ROUT - 0.08, 0.06], [ROUT - 0.09, 0.045],
    [RIN + 0.05, 0.045], [RIN, 0.03]], 128), M.brassDark, 0, Yg - 0.06, 0);
  add(bushGeometry(RIN + 0.1, 0.12, RIN - 0.03), M.brass, 0, Yg - 0.04, 0);
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(1.6, 0); s.lineTo(1.6, -0.06);
    s.quadraticCurveTo(0.6, -0.12, 0.12, -0.55); s.lineTo(0, -0.55); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 }).translate(0, 0, -0.02);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      add(g, M.brass, Math.cos(a) * (RIN - 0.02), Yg - 0.06, Math.sin(a) * (RIN - 0.02)).rotation.y = -a;
    }
  }
  // couronne motrice, posée sur huit galets
  {
    const s = gearShape(RING_N);
    s.holes.push(circlePath(RING_R - 0.32));
    for (let k = 0; k < 24; k++) s.holes.push(circlePath(0.05, Math.cos((k / 24) * Math.PI * 2) * (RING_R - 0.2), Math.sin((k / 24) * Math.PI * 2) * (RING_R - 0.2)));
    G.ring = dyn(add(plate(s, 0.05, 0.006, 4), M.brass, 0, Yg + 0.075, 0));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const roller = add(bushGeometry(0.045, 0.04, 0), M.steel, Math.cos(a) * (RING_R - 0.17), Yg + 0.025, Math.sin(a) * (RING_R - 0.17));
      roller.rotation.z = Math.PI / 2; roller.rotation.y = -a;
    }
  }
  // une station : pignon vertical qui engrène la couronne, à l'angle thDeg
  const station = (thDeg, n) => {
    const th = (thDeg * Math.PI) / 180, r = RING_R + pitchR(n);
    const pos = new THREE.Vector3(Math.cos(th) * r, Yg + 0.075, Math.sin(th) * r);
    const pin = dyn(add(gearGeometry(n, 0.05, 0.022), M.steel, pos.x, pos.y, pos.z));
    arbor(pos.x, pos.z, Yg - 0.01, Yg + 0.14, 0.022);
    add(bushGeometry(0.06, 0.03, 0.022), M.bronze, pos.x, Yg + 0.015, pos.z);
    const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const st = { th, n, pos, pin, rot: 0, out, tan: new THREE.Vector3(-out.z, 0, out.x) };
    G.stations.push(st);
    return st;
  };

  // ── poids moteur : tambour (axe vertical), poulie de renvoi, chaîne, poids
  {
    const { pos, out, tan } = station(-6, 14);
    G.drum = dyn(add(turned([[0.022, 0], [0.2, 0], [0.2, 0.02], [0.17, 0.03], [0.17, 0.22], [0.2, 0.23], [0.2, 0.25], [0.022, 0.25]], 40), M.brass, pos.x, Yg + 0.1, pos.z));
    for (let k = 0; k < 8; k++) add(new THREE.TorusGeometry(0.172, 0.008, 6, 40).rotateX(Math.PI / 2), M.steel, pos.x, Yg + 0.14 + k * 0.022, pos.z);
    arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.42, 0.022);
    // potence et poulie au bord de la plate-forme
    const pul = out.clone().multiplyScalar(ROUT + 0.12).addScaledVector(tan, 0.2).setY(Yg + 0.2);
    bridgeAB(out.clone().multiplyScalar(ROUT - 0.2).addScaledVector(tan, 0.2), pul, Yg + 0.03, 0.1, 0.04, 0, 0.08);
    pillar(pul.x, pul.z, Yg + 0.05, Yg + 0.1, 0.03);
    const pg = new THREE.Group(); pg.position.copy(pul); pg.rotation.y = -Math.atan2(tan.z, tan.x); root.add(pg);
    G.pulley = dyn(add(turned([[0.02, -0.025], [0.14, -0.025], [0.14, -0.015], [0.11, 0], [0.14, 0.015], [0.14, 0.025], [0.02, 0.025]], 32), M.brass, 0, 0, 0, pg));
    G.pulley.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) add(bridgeGeometry(0.2, 0.06, 0.02), M.brassDark, 0, -0.1, s * 0.045, pg).rotation.z = Math.PI / 2;
    // chaîne (maillons instanciés) et poids
    const linkG = new THREE.TorusGeometry(0.022, 0.006, 6, 12).scale(1, 1.7, 1);
    G.links = new THREE.InstancedMesh(linkG, M.steel, 160);
    G.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage); G.links.frustumCulled = false;
    root.add(G.links);
    G.chainTop = pul.clone().addScaledVector(out, 0.14).setY(Yg + 0.06); // point de chute
    G.weight = dyn(new THREE.Group()); root.add(G.weight);
    add(turned([[0, 0], [0.16, 0], [0.18, 0.03], [0.18, 0.5], [0.15, 0.56], [0.06, 0.6], [0.04, 0.64], [0, 0.64]], 40), M.brass, 0, -0.64, 0, G.weight);
    add(new THREE.TorusGeometry(0.035, 0.009, 6, 16), M.steel, 0, 0, 0, G.weight);
    for (let k = 0; k < 3; k++) add(new THREE.TorusGeometry(0.182, 0.006, 6, 40).rotateX(Math.PI / 2), M.brassDark, 0, -0.5 + k * 0.18, 0, G.weight);
  }

  // ── régulateur à boules (Watt)
  {
    const st = station(68, 12), { pos } = st, H = 1.25;
    arbor(pos.x, pos.z, Yg + 0.1, Yg + H, 0.02);
    G.gov = dyn(new THREE.Group()); G.gov.position.set(pos.x, Yg + H, pos.z); root.add(G.gov);
    add(turned([[0.02, -0.05], [0.07, -0.05], [0.08, -0.03], [0.08, 0.02], [0.05, 0.05], [0.02, 0.06]], 24), M.brass, 0, 0, 0, G.gov);
    add(turned([[0, 0], [0.04, 0], [0.03, 0.08], [0.012, 0.16], [0, 0.18]], 16), M.brass, 0, 0.05, 0, G.gov);
    G.govArms = []; G.govLinks = [];
    for (const s of [0, Math.PI]) {
      const side = new THREE.Group(); side.rotation.y = s; G.gov.add(side);
      const arm = dyn(new THREE.Group()); arm.position.x = 0.03; side.add(arm);
      add(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 8).translate(0, -0.25, 0), M.steel, 0, 0, 0, arm);
      add(new THREE.SphereGeometry(0.075, 24, 16), M.brass, 0, -0.52, 0, arm);
      G.govArms.push(arm);
      const link = dyn(new THREE.Group()); side.add(link);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 8).translate(0, -0.13, 0), M.steel, 0, 0, 0, link);
      G.govLinks.push(link);
    }
    G.sleeve = dyn(add(bushGeometry(0.05, 0.08, 0.02), M.bronze, pos.x, Yg + H - 0.4, pos.z));
    // levier de l'étrangleur (il freine le poids si la machine s'emballe)
    G.govLever = dyn(add(bridgeGeometry(0.4, 0.04, 0.02), M.blued, pos.x, Yg + H - 0.4, pos.z));
    G.govLever.rotation.y = -st.th;
    pillar(pos.x + Math.cos(st.th) * 0.42, pos.z + Math.sin(st.th) * 0.42, Yg, Yg + H - 0.42, 0.03);
  }

  // ── tambour à cames (programme du cycle) et colonne des cadrans
  {
    const st = station(180, 12), { pos, out, tan } = st;
    G.camSt = st;
    arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.75, 0.024);
    // roue à vis sans fin (réduction énorme : un tour par cycle)
    G.wormWheel = dyn(add(gearGeometry(40, 0.03, 0.024), M.brass, pos.x, Yg + 0.16, pos.z));
    const wormP = pos.clone().addScaledVector(tan, pitchR(40) + 0.04);
    G.worm = dyn(new THREE.Group()); G.worm.position.copy(wormP).setY(Yg + 0.16); root.add(G.worm);
    add(new THREE.TubeGeometry(helixCurve(0.04, 0.22, 5, -0.11, 140), 200, 0.01, 6), M.steel, 0, 0, 0, G.worm);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12), M.steel, 0, 0, 0, G.worm);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), M.steel, 0, 0, 0, G.worm);
    G.wormBase = new THREE.Quaternion().setFromUnitVectors(UP, out);
    G.worm.quaternion.copy(G.wormBase);
    for (const s of [-1, 1]) pillar(wormP.x + out.x * s * 0.22, wormP.z + out.z * s * 0.22, Yg, Yg + 0.15, 0.025);
    // trois cames ; le profil est lu par un poussoir tourné vers l'axe du socle
    G.cams = []; G.racks = []; G.needles = [];
    const R0 = 0.16, AMP = 0.11, DELTA = Math.atan2(out.z, out.x) + Math.PI;
    const dir = new THREE.Vector3(Math.cos(DELTA), 0, Math.sin(DELTA));
    CAMS.forEach((F, i) => {
      const y = Yg + 0.3 + i * 0.14;
      const s = new THREE.Shape(), NP = 180;
      for (let k = 0; k <= NP; k++) {
        const phi = (k / NP) * Math.PI * 2;
        const r = R0 + AMP * F((((phi + DELTA) / (Math.PI * 2)) % 1 + 1) % 1);
        if (k === 0) s.moveTo(r * Math.cos(phi), r * Math.sin(phi)); else s.lineTo(r * Math.cos(phi), r * Math.sin(phi));
      }
      s.holes.push(circlePath(0.024));
      G.cams.push(dyn(add(plate(s, 0.04, 0.005, 2), [M.brass, M.steel, M.brassDark][i], pos.x, y, pos.z)));
      // poussoir : galet, tige coulissante, crémaillère
      const rack = dyn(new THREE.Group()); root.add(rack);
      rack.userData = { ...rack.userData, F, R0, AMP, y, dir };
      add(bushGeometry(0.03, 0.03, 0), M.steel, 0, 0, 0, rack);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8).rotateZ(Math.PI / 2).translate(0.32, 0, 0), M.steel, 0, 0, 0, rack);
      add(new THREE.BoxGeometry(0.22, 0.03, 0.025), M.brass, 0.52, 0, -0.02, rack);
      for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.012, 0.03, 0.02), M.brass, 0.43 + k * 0.022, 0, -0.04, rack);
      rack.rotation.y = -DELTA;
      G.racks.push(rack);
      // guide du poussoir
      const gp = pos.clone().addScaledVector(dir, 0.42);
      pillar(gp.x, gp.z, Yg, y - 0.02, 0.03);
      add(bushGeometry(0.03, 0.04, 0.012), M.bronze, gp.x, y, gp.z).rotation.z = Math.PI / 2;
    });
    // colonne des cadrans, entre le tambour et le socle
    const colP = pos.clone().addScaledVector(out, -0.85);
    add(turned([[0, 0], [0.12, 0], [0.12, 0.03], [0.07, 0.06], [0.06, 0.9], [0.08, 0.93], [0.08, 0.96], [0, 0.96]], 24), M.brass, colP.x, Yg, colP.z);
    [['lumière', 'faible', 'vive'], ['gaz', 'vide', 'plein'], ['glaces', 'près', 'loin']].forEach(([l, a, b], i) => {
      const dg = new THREE.Group(); dg.position.copy(colP).setY(Yg + 0.3 + i * 0.25).addScaledVector(out, 0.09);
      dg.quaternion.setFromUnitVectors(UP, out); // face vers l'extérieur
      root.add(dg);
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 40), engraved(gaugeTexture(l, a, b), [1, 1, 1], 0.1, 0.5), 0, 0, 0, dg).rotation.y = Math.PI / 2;
      add(new THREE.TorusGeometry(0.115, 0.012, 8, 40).rotateX(Math.PI / 2), M.brass, 0, 0.008, 0, dg);
      const nd = dyn(new THREE.Group()); nd.position.y = 0.012; dg.add(nd);
      add(new THREE.BoxGeometry(0.004, 0.005, 0.09).translate(0, 0, -0.04), M.blued, 0, 0, 0, nd);
      G.needles.push(nd);
    });
  }

  // ── compteur à rouleaux (orbites, cycle)
  {
    const { pos, out, tan } = station(108, 10);
    const dm = engraved(digitsTexture(), [1, 1, 1], 0.1, 0.6);
    G.counter = new THREE.Group(); G.counter.position.copy(pos).addScaledVector(out, 0.35).setY(Yg + 0.42);
    G.counter.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan); root.add(G.counter);
    G.digits = [];
    for (let k = 0; k < 6; k++) {
      const x = (k - 2.5) * 0.1 + (k === 5 ? 0.06 : 0);
      G.digits.push(dyn(add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 40, 1, true).rotateZ(Math.PI / 2), dm, x, 0, 0, G.counter)));
      add(new THREE.CylinderGeometry(0.064, 0.064, 0.012, 40).rotateZ(Math.PI / 2), M.brass, x + 0.046, 0, 0, G.counter);
    }
    // bâti : joues, axe, fenêtre
    for (const s of [-1, 1]) add(bridgeGeometry(0.3, 0.16, 0.025), M.brass, s * 0.36, -0.3, 0, G.counter).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.78, 8).rotateZ(Math.PI / 2), M.steel, 0, 0, 0, G.counter);
    const fr = new THREE.Shape(); fr.moveTo(-0.38, -0.09); fr.lineTo(0.38, -0.09); fr.lineTo(0.38, 0.09); fr.lineTo(-0.38, 0.09); fr.closePath();
    const hole = new THREE.Path(); hole.moveTo(-0.3, -0.035); hole.lineTo(0.3, -0.035); hole.lineTo(0.3, 0.035); hole.lineTo(-0.3, 0.035); hole.closePath(); fr.holes.push(hole);
    add(plate(fr, 0.015, 0.004), M.brass, 0, 0, 0.07, G.counter).rotation.x = Math.PI / 2;
    // renvoi d'angle (pignons coniques) entre la station et l'axe des rouleaux
    add(new THREE.ConeGeometry(0.05, 0.05, 16, 1, true).translate(0, 0.025, 0), M.steel, pos.x, Yg + 0.14, pos.z);
    arbor(pos.x, pos.z, Yg + 0.1, Yg + 0.3, 0.015);
  }

  // ── pompe à soufflet et sa conduite jusqu'à la trémie
  {
    const st = station(252, 12), { pos, out, tan } = st;
    G.pumpSt = st;
    // plateau excentrique (embrayé seulement pendant l'aspiration)
    G.crank = dyn(new THREE.Group()); G.crank.position.copy(pos).setY(Yg + 0.13); root.add(G.crank);
    add(bushGeometry(0.16, 0.03, 0.022), M.brass, 0, 0, 0, G.crank);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.06, 10), M.steel, 0.11, 0.04, 0, G.crank);
    // soufflet : accordéon tourné, couché le long de la tangente
    const bp = pos.clone().addScaledVector(tan, 0.75).setY(Yg + 0.2);
    G.bellowsBase = bp;
    const bellows = new THREE.Group(); bellows.position.copy(bp);
    bellows.quaternion.setFromUnitVectors(UP, tan.clone().negate()); root.add(bellows);
    const acc = []; for (let k = 0; k <= 12; k++) acc.push([k % 2 ? 0.1 : 0.14, k / 12]);
    const leather = new THREE.MeshStandardNodeMaterial({ color: 0x3a1c10, roughness: 0.85, metalness: 0 });
    G.bellowsBody = dyn(add(turned([[0, 0], ...acc, [0, 1]], 24), leather, 0, 0, 0, bellows));
    add(bushGeometry(0.16, 0.025, 0), M.brass, 0, 0, 0, bellows);
    G.bellowsCap = dyn(add(bushGeometry(0.16, 0.025, 0), M.brass, 0, 0.3, 0, bellows));
    G.rod = dyn(add(new THREE.CylinderGeometry(0.012, 0.012, 1, 8).rotateZ(Math.PI / 2).translate(0.5, 0, 0), M.steel, 0, Yg + 0.2, 0));
    const fixed = bp.clone().addScaledVector(tan, 0.05);
    pillar(fixed.x, fixed.z, Yg, Yg + 0.06, 0.06);
    // conduite : du soufflet au bord de la platine, le long du pied (225°), puis de l'arceau, jusqu'au collier
    const a = (5 * Math.PI) / 4 + 0.035, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const leg = legCurve((r, y) => d.clone().multiplyScalar(r).setY(y), LIMB_RM, Y_BASE);
    const arch = new ArchCurve(d, LIMB_RM - 0.02, DOME_H - 0.05, 0.56);
    const lift = new THREE.Vector3(0, 0.1, 0);
    const pts = [bp.clone().addScaledVector(tan, 0.02).setY(Yg + 0.2), bp.clone().addScaledVector(out, 0.25).setY(Yg + 0.35)];
    for (let i = 10; i >= 1; i--) pts.push(leg.getPoint(i / 10 * 0.98 + 0.02).add(lift));
    for (let i = 1; i <= 24; i++) pts.push(arch.getPoint(i / 24).add(lift));
    const pipe = new THREE.CatmullRomCurve3(pts);
    add(new THREE.TubeGeometry(pipe, 400, 0.028, 10), M.brass);
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let k = 1; k < 30; k++) { // colliers de fixation
      const p = pipe.getPoint(k / 30);
      add(new THREE.TorusGeometry(0.034, 0.008, 6, 16), M.brassDark, p.x, p.y, p.z).quaternion.setFromUnitVectors(zAxis, pipe.getTangent(k / 30));
    }
  }

  // ── cloche et son marteau (impacts géants)
  {
    const th = (292 * Math.PI) / 180;
    const out = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), tan = new THREE.Vector3(-out.z, 0, out.x);
    const p = out.clone().multiplyScalar(3.25);
    pillar(p.x, p.z, Yg, Yg + 1.0, 0.035);
    const top = p.clone().setY(Yg + 1.0);
    add(bridgeGeometry(0.42, 0.06, 0.03), M.brass, top.x, top.y, top.z).rotation.y = -Math.atan2(tan.z, tan.x);
    const bellP = top.clone().addScaledVector(tan, 0.36);
    const bellMat = M.bronze.clone(); bellMat.side = THREE.DoubleSide;
    G.bell = dyn(add(turned([[0.005, 0.02], [0.05, 0], [0.09, -0.06], [0.11, -0.18], [0.16, -0.27], [0.165, -0.29], [0.14, -0.285],
      [0.1, -0.2], [0.08, -0.08], [0.04, -0.02], [0.005, 0.0]], 40), bellMat, bellP.x, bellP.y - 0.03, bellP.z));
    G.hammer = dyn(new THREE.Group()); G.hammer.position.copy(p).setY(Yg + 0.62).addScaledVector(tan, 0.02);
    G.hammer.rotation.y = -Math.atan2(tan.z, tan.x); root.add(G.hammer);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8).rotateZ(Math.PI / 2).translate(0.21, 0, 0), M.steel, 0, 0, 0, G.hammer);
    add(new THREE.SphereGeometry(0.04, 16, 12), M.blued, 0.42, 0, 0, G.hammer);
    add(bushGeometry(0.03, 0.04, 0), M.brass, 0, 0, 0, G.hammer).rotation.x = Math.PI / 2;
  }

  // ── Animation ───────────────────────────────────────────────────────────────
  let hammerT = 1, hammerK = 1, pump = 0, pumpA = 0, links = -1;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const _pin = new THREE.Vector3(), _cap = new THREE.Vector3();
  const qLink = [new THREE.Quaternion(), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)];

  return {
    // la cloche sonne : impact géant (k ~ intensité)
    strike(k = 1) { hammerT = 0; hammerK = Math.min(1, 0.4 + k); },

    // lay : angle de l'arbre de renvoi ; rate : fréquence du balancier (Hz) ;
    // reserve : réserve du ressort (1 → 0) ; collect : aspiration (0 → 1)
    update(dtReal, cycle, lay, rate, reserve, collect) {
      const ringRot = lay * 0.18;
      G.ring.rotation.y = ringRot;
      for (const st of G.stations) { st.rot = meshAngle(ringRot, RING_N, st.n, st.th); st.pin.rotation.y = st.rot; }
      const [drumSt, govSt, camSt, , pumpSt] = G.stations;
      const simTime = lay / OMEGA_L;
      // poids : descend quand le ressort se détend, remonte au remontage
      G.drum.rotation.y = drumSt.rot;
      const len = 0.35 + 2.4 * (1 - reserve), pitch = 0.064, nL = Math.min(160, Math.ceil(len / pitch));
      const top = G.chainTop;
      if (nL !== links) {
        for (let i = 0; i < nL; i++) { _m.compose(_p.set(top.x, top.y - i * pitch, top.z), qLink[i % 2], _s); G.links.setMatrixAt(i, _m); }
        G.links.count = links = nL; G.links.instanceMatrix.needsUpdate = true;
      }
      G.weight.position.set(top.x, top.y - len - 0.02, top.z);
      G.pulley.rotation.y = -len / 0.12;
      // régulateur : rotation rapide ; les boules s'écartent avec la vitesse
      G.gov.rotation.y = govSt.rot * 3;
      const sp = Math.min(1, rate / 6);
      const ang = 0.25 + 0.75 * sp + 0.03 * Math.sin(simTime * 3);
      for (const a of G.govArms) a.rotation.z = ang;
      const ballX = 0.03 + Math.sin(ang) * 0.27, ballY = -Math.cos(ang) * 0.27, sleeveY = -0.4 + 0.18 * sp;
      for (const l of G.govLinks) { l.position.set(ballX, ballY, 0); l.rotation.z = -Math.atan2(ballX - 0.02, ballY - sleeveY); }
      G.sleeve.position.y = G.gov.position.y + sleeveY;
      G.govLever.position.y = G.sleeve.position.y;
      // tambour à cames : un tour par cycle (fraction du cycle écoulée)
      const frac = 1 - reserve, camRot = -frac * Math.PI * 2;
      for (const cm of G.cams) cm.rotation.y = camRot;
      G.wormWheel.rotation.y = camRot;
      G.worm.quaternion.copy(G.wormBase).multiply(_q.setFromAxisAngle(UP, frac * 40 * Math.PI * 2));
      G.racks.forEach((rk, i) => {
        const { F, R0, AMP, y, dir } = rk.userData;
        const r = R0 + AMP * F(((frac % 1) + 1) % 1);
        rk.position.copy(camSt.pos).addScaledVector(dir, r + 0.03).setY(y);
        G.needles[i].rotation.y = -(Math.PI * 0.75) + 1.5 * Math.PI * ((r - R0) / AMP) - Math.PI / 2;
      });
      // compteur : orbites à 1 UA (5 rouleaux, retenue progressive) + cycle
      const orbits = simTime / (Math.PI * 2);
      let carry = orbits;
      for (let k = 0; k < 5; k++) {
        const v = carry % 10, lower = k === 0 ? 0 : (orbits / Math.pow(10, k - 1)) % 10;
        const val = k === 0 ? v : Math.floor(v) + (lower > 9 ? lower - 9 : 0);
        G.digits[4 - k].rotation.x = -(val / 10) * Math.PI * 2;
        carry /= 10;
      }
      G.digits[5].rotation.x = -((cycle + 1) % 10 / 10) * Math.PI * 2;
      // pompe : embrayée pendant l'aspiration
      pump += ((collect > 0 && collect < 1 ? 1 : 0) - pump) * Math.min(1, dtReal * 4);
      pumpA += dtReal * 9 * pump;
      G.crank.rotation.y = -pumpA;
      G.crank.position.y = Yg + 0.13 + 0.03 * (1 - pump);
      const { tan } = pumpSt;
      _pin.set(Math.cos(pumpA) * 0.11, 0, -Math.sin(pumpA) * 0.11);
      const capD = 0.3 + _pin.dot(tan) * 0.6 * pump;
      _pin.add(pumpSt.pos);
      G.bellowsBody.scale.set(1, capD, 1);
      G.bellowsCap.position.y = capD;
      _cap.copy(G.bellowsBase).addScaledVector(tan, -capD).setY(_pin.y);
      G.rod.position.copy(_pin).setY(Yg + 0.2);
      G.rod.scale.x = Math.max(0.05, _pin.distanceTo(_cap));
      G.rod.rotation.y = -Math.atan2(_cap.z - _pin.z, _cap.x - _pin.x);
      // cloche
      hammerT += dtReal;
      const h = hammerT;
      const lift = h < 0.25 ? h / 0.25 : h < 0.32 ? 1 - (h - 0.25) / 0.07 : Math.max(0, -0.15 * Math.exp(-(h - 0.32) * 8) * Math.cos((h - 0.32) * 30));
      G.hammer.rotation.z = lift * 0.6 * hammerK;
      G.bell.rotation.z = h > 0.32 && h < 2 ? Math.sin((h - 0.32) * 25) * 0.04 * Math.exp(-(h - 0.32) * 2) : 0;
    },
  };
}
