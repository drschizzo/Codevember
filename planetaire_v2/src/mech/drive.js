// Le mouvement : ce qui fait tourner la machine, posé sur un bâti fixe autour
// du plateau. Chaque pièce sert :
//   - un arbre de sortie, sur le bâti, engrène la denture taillée au bord du
//     plateau (le plateau tourne à ω) et, par-dessous, la roue du tube central
//     (qui porte l'étoile des bras 0, à ω + k₀) ;
//   - horlogerie, classique, astrolabe : le barillet (l'énergie, remonté par
//     une clé à rochet et cliquet) mène l'arbre par un rouage ; de l'autre
//     côté, un pignon de l'arbre mène l'échappement, dont l'ancre et le
//     balancier règlent la marche (le balancier bat au rythme des dents) ; des
//     cadrans sont menés par des roues du rouage (secondes, heures) ;
//   - atelier : une machine à vapeur (cylindre, piston, bielle, manivelle)
//     fait tourner un volant, qui mène l'arbre par une courroie ; une seconde
//     courroie, croisée, entraîne le régulateur à boules ; un compteur est mené
//     par un engrenage du volant.
// Toutes les vitesses découlent de celle du plateau par des rapports de dents
// (ou de diamètres de poulies) exacts, et chaque roue est calée sur celle qui la
// mène : rien ne tourne pour rien, rien ne glisse.
import * as THREE from 'three/webgpu';
import { gearGeometry, cyl, ribbonGeometry, flat } from '../scene/machine.js';

const TAU = Math.PI * 2;
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

// arbre cinématique de roues : root (mené par drive), mesh (engrène parent),
// coax (solidaire de l'arbre d'une autre roue). Angles « bruts » (sans calage),
// puis calage : chaque roue présente un creux à la dent qui la mène, à t = 0.
function gearTree(nodes) {
  const raw = (n, tau) => (n.drive ? n.drive(tau) : n.coax !== undefined ? raw(nodes[n.coax], tau) : -raw(nodes[n.parent], tau) * (nodes[n.parent].z / n.z) * (n.ratioSign ?? 1));
  for (const n of nodes) {
    if (n.drive || n.coax !== undefined || n.belt) { n.off = n.off ?? 0; continue; }
    const p = nodes[n.parent];
    const dir = Math.atan2(n.y - p.y, n.x - p.x);
    const pp = TAU / p.z, pn = TAU / n.z;
    const fP = ((((dir - raw(p, 0) - p.off) / pp) % 1) + 1) % 1;
    const fN = (((0.5 - fP) % 1) + 1) % 1;
    n.off = dir + Math.PI - fN * pn - raw(n, 0);
  }
  return (tau) => nodes.map((n) => raw(n, tau) + n.off);
}

export function createDrive({ archetype, plateR, yPlate, yFloor, k0, omegaFrac, mats, keep, plateGroup, stand, styleGear, yTubeTop }) {
  const anim = [];
  const mesh = (geo, mat, shadow = true) => { const o = new THREE.Mesh(geo, mat); o.castShadow = shadow; o.receiveShadow = true; return o; };
  const atS = (o, x, y, h) => { o.position.set(x, h, -y); stand.add(o); return o; };   // sur le bâti (fixe)
  const atP = (o, x, y, h) => { o.position.set(x, h, -y); plateGroup.add(o); return o; }; // sur le plateau
  const [pw, qw] = omegaFrac;
  const OmP = pw / qw, OmT = pw / qw + k0;

  // ── denture du plateau (une couronne taillée au bord) ; module ~0,011
  const zR = Math.round((2 * plateR) / 0.016);
  const rimGear = mesh(gearGeometry(zR, plateR, { thick: 0.05, ring: 0.045, style: 'solid' }), mats.gears);
  if (OmP !== 0) atP(rimGear, 0, 0, yPlate - 0.03); else atS(rimGear, 0, 0, yPlate - 0.03);

  // ── arbre de sortie : vitesse Ω_D, pignon p1 (denture du plateau), pignon p2 (roue du tube)
  // la couronne dentée : vissée au plateau s'il tourne ; sinon, montée sur le
  // bâti et menée seule par l'arbre (elle distribue le mouvement aux satellites)
  const OmRing = OmP !== 0 ? OmP : 0.6;
  let zP1 = 0, OmD;
  {
    // un vrai pignon (12 à 40 dents) : l'arbre tourne vite, la denture du plateau démultiplie
    zP1 = Math.max(12, Math.min(40, Math.round((zR * Math.abs(OmRing)) / 8)));
    OmD = -OmRing * (zR / zP1);
  }
  const rP1 = zP1 ? (plateR * zP1) / zR : 0;
  const rO = plateR + (zP1 ? rP1 : 0.05);
  const ARB = { x: rO, y: 0, z: 1 };
  // roue du tube : rapport |Ω_D / Ω_T| en dents ; renvoi si les sens l'exigent
  const yRim = yPlate - 0.03, yUB = yPlate - 0.09, yT = yUB - 0.03, yFrame = yT - 0.05;
  let tube = null;
  if (OmT !== 0) {
    let a = Math.abs(Math.round(OmD * qw * 1000)), b = Math.abs(Math.round(OmT * qw * 1000));
    const g = gcd(a, b); a /= g; b /= g;
    const t = Math.max(1, Math.ceil(12 / Math.min(a, b)));
    // |Ω_T / Ω_D| = zP2 / zT, donc zT / zP2 = |Ω_D| / |Ω_T| = a / b
    const zT = a * t, zP2 = b * t;
    const idler = Math.sign(OmT) === Math.sign(OmD);
    const zI = idler ? 14 : 0, m2 = (2 * rO) / (zT + zP2 + 2 * zI);
    tube = { zT, zP2, zI, rT: (m2 * zT) / 2, rP2: (m2 * zP2) / 2, rI: (m2 * zI) / 2, idler };
  }

  // ── bâti : couronne fixe autour du plateau, gravée
  const bIn = plateR + 0.022, bOut = plateR + 0.46, yB = yPlate - 0.065;
  {
    const s = new THREE.Shape(); s.absarc(0, 0, bOut, 0, TAU, false);
    const h = new THREE.Path(); h.absarc(0, 0, bIn, 0, TAU, true); s.holes.push(h);
    atS(mesh(keep(flat(s, 0.05, 0.15, 160)), mats.bezel), 0, 0, yB - 0.025);
    // graduation du bord (et, selon l'archétype, zodiaque ou heures)
    const nT = archetype === 'astrolabe' ? 96 : 120, tick = keep(new THREE.BoxGeometry(0.04, 0.0012, 0.004));
    const ticks = new THREE.InstancedMesh(tick, mats.ink, nT);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * TAU, long = i % (archetype === 'astrolabe' ? 4 : 10) === 0 ? 2 : 1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      p.set(Math.cos(a) * (bOut - 0.03 - 0.01 * long), yB + 0.0006, -Math.sin(a) * (bOut - 0.03 - 0.01 * long));
      sc.set(long, 1, 1);
      ticks.setMatrixAt(i, M.compose(p, q, sc));
    }
    stand.add(ticks);
    if (archetype === 'classique') {
      // anneau zodiacal sur le bâti ; un index fixé au plateau le parcourt (lecture de la rotation)
      for (let i = 0; i < 12; i++) {
        const a0 = (i / 12) * TAU + 0.008, a1 = ((i + 1) / 12) * TAU - 0.008, z = new THREE.Shape();
        z.absarc(0, 0, bOut - 0.06, a0, a1, false); z.absarc(0, 0, bOut - 0.15, a1, a0, true); z.closePath();
        atS(mesh(keep(flat(z, 0.002, 0, 24)), i % 2 ? mats.arms : mats.arms2, false), 0, 0, yB + 0.001);
      }
    }
    if (OmP !== 0 && (archetype === 'classique' || archetype === 'astrolabe')) {
      const ix = new THREE.Shape(); ix.moveTo(plateR - 0.02, -0.01); ix.lineTo(bOut - 0.1, 0); ix.lineTo(plateR - 0.02, 0.01); ix.closePath();
      const idx = mesh(keep(flat(ix, 0.002, 0)), mats.arms2, false); idx.rotation.y = 0.5;
      atP(idx, 0, 0, yPlate + 0.004);
    }
  }

  // ── pièces de l'arbre de sortie
  const yL1 = yPlate + 0.018, yL2 = yPlate + 0.05; // niveaux du rouage (au-dessus du plateau)
  atS(mesh(keep(cyl(0.012, yL2 + 0.025 - yFrame, 16)), mats.pins), rO, 0, yFrame);
  const nodes = [];
  const add = (n) => (nodes.push(n), nodes.length - 1);
  const iArb = add({ ...ARB, drive: (tau) => OmD * tau });
  const meshes = []; // [nodeIndex, mesh]
  const wheel = (i, h, opts = {}) => {
    const n = nodes[i], m = mesh(gearGeometry(n.z, n.r, { thick: opts.thick ?? 0.012, style: opts.style ?? styleGear }), opts.mat ?? mats.gears);
    atS(m, n.x, n.y, h); meshes.push([i, m]);
    if (!opts.noStud) atS(mesh(keep(cyl(0.008, h - yB)), mats.pins), n.x, n.y, yB);
    return m;
  };
  if (zP1) {
    const i = add({ x: rO, y: 0, z: zP1, r: rP1, coax: iArb });
    wheel(i, yRim, { thick: 0.048, style: 'solid', noStud: true });
    // (la denture du plateau : son angle est celui du plateau, calé pour engrener ce pignon)
    const pp = TAU / zP1, pr = TAU / zR;
    const fP = ((((Math.PI - 0) / pp) % 1) + 1) % 1; // pignon à t = 0 : contact vers le centre (angle π)
    rimGear.rotation.y = -(((0.5 - fP) % 1 + 1) % 1) * pr;
  }
  const rimOff = rimGear.rotation.y;
  if (OmP === 0) anim.push((tau) => { rimGear.rotation.y = OmRing * tau + rimOff; });
  // la couronne dans l'arbre cinématique (angle dans le studio)
  const iRim = add({ x: 0, y: 0, z: zR, r: plateR, drive: (tau) => OmRing * tau, off: rimOff });
  if (tube) {
    // sous le plateau : roue du tube (dans le repère du plateau) et pignon (ou renvoi)
    const tw = mesh(gearGeometry(tube.zT, tube.rT, { thick: 0.006, style: 'spokes5' }), mats.gears);
    atP(tw, 0, 0, yT);
    const p2 = mesh(gearGeometry(tube.zP2, tube.rP2, { thick: 0.006, style: 'solid' }), mats.gears);
    atS(p2, rO, 0, yT);
    let idl = null;
    if (tube.zI) { idl = mesh(gearGeometry(tube.zI, tube.rI, { thick: 0.006, style: 'solid' }), mats.gears); atS(idl, tube.rT + tube.rI, 0, yT); }
    anim.push((tau) => {
      const aD = OmD * tau;
      p2.rotation.y = aD;
      if (idl) idl.rotation.y = -aD * (tube.zP2 / tube.zI) + Math.PI / tube.zI;
      tw.rotation.y = k0 * tau + Math.PI / tube.zT;
    });
  }

  // ── rouage, selon l'archétype ; roues placées sur le cercle rT du bâti
  const rT = plateR + 0.22;
  const onCircle = (from, rr, dirSign) => {
    // centre sur le cercle rT à la distance rr du centre « from » (côté dirSign)
    const d0 = Math.hypot(from.x, from.y), a0 = Math.atan2(from.y, from.x);
    const c = (rT * rT + d0 * d0 - rr * rr) / (2 * rT * d0);
    const a = a0 + dirSign * Math.acos(Math.max(-1, Math.min(1, c)));
    return { x: rT * Math.cos(a), y: rT * Math.sin(a) };
  };
  const bridgeOver = (x, y, h) => {
    const a = Math.atan2(y, x), len = bOut - 0.04 - Math.hypot(x, y), w = 0.042;
    const s = new THREE.Shape();
    s.absarc(0, 0, w * 0.8, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.lineTo(len, -w * 0.45); s.absarc(len, 0, w * 0.45, -Math.PI / 2, Math.PI / 2, false); s.closePath();
    const b = mesh(keep(flat(s, 0.01, 0.4)), mats.bridge); b.rotation.y = a; atS(b, x, y, h);
    atS(mesh(keep(cyl(0.008, 0.002, 12)), mats.jewel, false), x, y, h + 0.01);
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    atS(mesh(keep(cyl(0.01, 0.003, 12)), mats.screw, false), ex, ey, h + 0.01);
    atS(mesh(keep(cyl(0.012, h - yB)), mats.pins), ex, ey, yB);
  };
  const dial = (parentIdx, h, rate) => {
    // cadran mené par une petite roue qui engrène une roue du rouage, vers l'extérieur
    const p = nodes[parentIdx], a = Math.atan2(p.y, p.x), rD = 0.07, zD = 24, rd = (p.r * zD) / p.z;
    const x = p.x + Math.cos(a) * (p.r + rd), y = p.y + Math.sin(a) * (p.r + rd);
    const i = add({ x, y, z: zD, r: rd, parent: parentIdx });
    wheel(i, h);
    atS(mesh(keep(cyl(rD * 1.08, 0.008, 48)), mats.arms), x, y, h + 0.01);
    atS(mesh(keep(cyl(rD, 0.009, 48)), mats.dial), x, y, h + 0.01);
    const tick = keep(new THREE.BoxGeometry(rD * 0.16, 0.001, rD * 0.025)), ticks = new THREE.InstancedMesh(tick, mats.ink, 12);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
    for (let k = 0; k < 12; k++) { const b = (k / 12) * TAU; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b); pp.set(x + Math.cos(b) * rD * 0.82, h + 0.0195, -(y + Math.sin(b) * rD * 0.82)); ticks.setMatrixAt(k, M.compose(pp, q, s1)); }
    stand.add(ticks);
    const hs = new THREE.Shape(); hs.moveTo(-rD * 0.15, -rD * 0.05); hs.lineTo(rD * 0.8, -rD * 0.012); hs.lineTo(rD * 0.8, rD * 0.012); hs.lineTo(-rD * 0.15, rD * 0.05); hs.closePath();
    const hand = mesh(keep(flat(hs, 0.002, 0)), mats.screw, false);
    atS(hand, x, y, h + 0.0205);
    meshes.push([i, hand]);
    void rate;
  };

  if (archetype !== 'atelier') {
    // côté barillet (niveau 1) : roue de l'arbre, rouage, barillet
    const z1 = 60, m1 = 0.0044, r1 = (m1 * z1) / 2;
    const iW1 = add({ x: rO, y: 0, z: z1, r: r1, coax: iArb });
    wheel(iW1, yL1, { noStud: true });
    let prev = iW1;
    const seq = [40, 56, 36];
    const placed = [];
    for (const z of seq) {
      const r = (m1 * z) / 2, pn = nodes[prev];
      const c = placed.length ? (() => { const a = Math.atan2(pn.y, pn.x) + 2 * Math.asin((pn.r + r) / (2 * rT)); return { x: rT * Math.cos(a), y: rT * Math.sin(a) }; })() : onCircle(pn, pn.r + r, 1);
      prev = add({ ...c, z, r, parent: prev });
      wheel(prev, yL1);
      placed.push(prev);
      if (placed.length % 2) bridgeOver(c.x, c.y, yL1 + 0.022);
    }
    dial(placed[1], yL1, 1);
    // barillet : tambour denté, rochet et cliquet, clé de remontoir
    {
      const pn = nodes[prev], zB = 96, rB = (m1 * zB) / 2;
      const a = Math.atan2(pn.y, pn.x) + 2 * Math.asin((pn.r + rB) / (2 * rT));
      const x = rT * Math.cos(a), y = rT * Math.sin(a);
      const iB = add({ x, y, z: zB, r: rB, parent: prev });
      wheel(iB, yL1, { style: 'solid', thick: 0.006 });
      atS(mesh(keep(cyl(rB * 0.92, 0.026, 64)), mats.gears), x, y, yL1 - 0.03);
      const iRat = add({ x, y, z: 36, r: rB * 0.7, coax: iB });
      wheel(iRat, yL1 + 0.016, { style: 'escape', mat: mats.arms2, noStud: true });
      const click = mesh(keep(new THREE.BoxGeometry(0.04, 0.003, 0.007)), mats.arms2);
      click.rotation.y = a + 1.9; atS(click, x + Math.cos(a + 0.9) * rB * 0.85, y + Math.sin(a + 0.9) * rB * 0.85, yL1 + 0.013);
      const key = mesh(keep(new THREE.BoxGeometry(0.012, 0.03, 0.012)), mats.pins); atS(key, x, y, yL1 + 0.02);
      bridgeOver(x, y, yL1 + 0.036);
    }
    // côté échappement (niveau 2) : pignon de l'arbre, roue de champ et son
    // pignon (démultiplication composée), roue d'échappement, ancre, balancier
    const zE1 = 10, m2 = 0.0042, rE1 = (m2 * zE1) / 2;
    const iE1 = add({ x: rO, y: 0, z: zE1, r: rE1, coax: iArb });
    wheel(iE1, yL2, { noStud: true, style: 'solid' });
    const zX = 60, rX = (m2 * zX) / 2, cX = onCircle(nodes[iE1], rE1 + rX, -1);
    const iX = add({ ...cX, z: zX, r: rX, parent: iE1 });
    wheel(iX, yL2);
    bridgeOver(cX.x, cX.y, yL2 + 0.034);
    const zx = 10, rx = (m2 * zx) / 2;
    const ix = add({ ...cX, z: zx, r: rx, coax: iX });
    wheel(ix, yL2 + 0.014, { noStud: true, style: 'solid' });
    const zE = 20, rE = (m2 * zE) / 2;
    const aEsc = Math.atan2(cX.y, cX.x) - 2 * Math.asin((rx + rE) / (2 * rT));
    const pv = add({ x: rT * Math.cos(aEsc), y: rT * Math.sin(aEsc), z: zE, r: rE, parent: ix });
    wheel(pv, yL2 + 0.014, { style: 'escape' });
    dial(iX, yL2, 1);
    // ancre et balancier : le balancier bat deux fois par dent de la roue d'échappement
    const E = nodes[pv], aE = Math.atan2(E.y, E.x), rb = 0.075;
    const aBal = aE - 2 * Math.asin((E.r + rb + 0.03) / (2 * rT));
    const bx = rT * Math.cos(aBal), by = rT * Math.sin(aBal);
    const bal = new THREE.Group();
    const ring = mesh(keep(new THREE.TorusGeometry(rb, 0.0045, 8, 64)), mats.gears); ring.rotation.x = Math.PI / 2; bal.add(ring);
    for (let i = 0; i < 3; i++) { const arm = mesh(keep(new THREE.BoxGeometry(rb * 2, 0.002, 0.004)), mats.gears); arm.rotation.y = (i / 3) * Math.PI; bal.add(arm); }
    for (let i = 0; i < 8; i++) { const sw = mesh(keep(cyl(0.004, 0.004)), mats.screw, false); const b = (i / 8) * TAU; sw.position.set(Math.cos(b) * rb, -0.002, Math.sin(b) * rb); bal.add(sw); }
    const sp = [];
    for (let i = 0; i <= 300; i++) { const tt = i / 300, rr = rb * (0.12 + 0.6 * tt), b = tt * TAU * 9; sp.push(new THREE.Vector3(Math.cos(b) * rr, 0.006, Math.sin(b) * rr)); }
    bal.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 600, 0.0007, 4, false)), mats.gears, false));
    atS(bal, bx, by, yL2 + 0.014);
    atS(mesh(keep(cyl(0.004, yL2 - yB)), mats.pins), bx, by, yB);
    bridgeOver(bx, by, yL2 + 0.034);
    const anchor = new THREE.Group();
    anchor.add(mesh(keep(new THREE.BoxGeometry(Math.hypot(E.x - bx, E.y - by) * 0.7, 0.003, 0.006)), mats.arms2));
    for (const sd of [-1, 1]) { const st = mesh(keep(new THREE.BoxGeometry(0.008, 0.0035, 0.004)), mats.jewel, false); st.position.set(sd * 0.02, 0, 0.007); anchor.add(st); }
    const a0 = Math.atan2(E.y - by, E.x - bx);
    atS(anchor, (E.x + bx) / 2, (E.y + by) / 2, yL2 + 0.002);
    const iEsc = pv;
    anim.push((tau, ang) => {
      const beat = ang[iEsc] * E.z; // une alternance par demi-dent
      bal.rotation.y = 1.25 * Math.sin(beat);
      anchor.rotation.y = a0 + 0.16 * Math.tanh(4 * Math.sin(beat));
    });
  } else {
    // ── atelier : machine à vapeur → volant → courroie → arbre de sortie
    const rPa = 0.05; // poulie de l'arbre
    const iPa = add({ x: rO, y: 0, z: 1, r: rPa, coax: iArb });
    wheel(iPa, yL1, { style: 'pulley', thick: 0.012, noStud: true });
    const aF = 0.75, fx = rT * Math.cos(aF), fy = rT * Math.sin(aF), rF = 0.15, rFp = 0.075;
    // le volant tourne au rapport des poulies (courroie ouverte : même sens)
    const iF = add({ x: fx, y: fy, z: 1, r: rF, drive: (tau) => OmD * tau * (rPa / rFp) });
    const fly = wheel(iF, yL1 + 0.02, { style: 'pulley', thick: 0.018 });
    const iFp = add({ x: fx, y: fy, z: 1, r: rFp, coax: iF });
    wheel(iFp, yL1, { style: 'pulley', thick: 0.012, noStud: true });
    const belt = (x1, y1, r1, x2, y2, r2, h, crossed) => {
      const pts = [], L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
      if (!crossed) {
        const al = Math.asin((r1 - r2) / L);
        for (let i = 0; i <= 40; i++) { const b = ang + Math.PI / 2 + al + (i / 40) * (Math.PI - 2 * al); pts.push(new THREE.Vector3(x1 + Math.cos(b) * r1, h, -(y1 + Math.sin(b) * r1))); }
        for (let i = 0; i <= 40; i++) { const b = ang - Math.PI / 2 - al + (i / 40) * (Math.PI + 2 * al); pts.push(new THREE.Vector3(x2 + Math.cos(b) * r2, h, -(y2 + Math.sin(b) * r2))); }
      } else {
        const be = Math.acos(Math.min(1, (r1 + r2) / L));
        for (let i = 0; i <= 40; i++) { const b = ang + be + (i / 40) * (TAU - 2 * be); pts.push(new THREE.Vector3(x1 + Math.cos(b) * r1, h + 0.002 * Math.sin(i / 6), -(y1 + Math.sin(b) * r1))); }
        for (let i = 0; i <= 40; i++) { const b = ang + Math.PI - be - (i / 40) * (TAU - 2 * be); pts.push(new THREE.Vector3(x2 + Math.cos(b) * r2, h, -(y2 + Math.sin(b) * r2))); }
      }
      stand.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 240, 0.004, 5, true)), mats.belt, false));
    };
    belt(rO, 0, rPa, fx, fy, rFp, yL1, false);
    // machine à vapeur : manivelle sur le volant, bielle, crosse, piston dans le cylindre
    const crankR = rF * 0.6, lRod = rF * 2.4, aC = aF + Math.PI / 2; // axe du cylindre : tangent au cercle
    const ux = Math.cos(aC), uy = Math.sin(aC);
    const cylLen = 0.16, cx0 = fx + ux * (lRod + crankR + 0.04), cy0 = fy + uy * (lRod + crankR + 0.04);
    const cylM = mesh(keep(new THREE.CylinderGeometry(0.035, 0.035, cylLen, 32)), mats.foot);
    cylM.rotation.z = Math.PI / 2; cylM.rotation.y = aC; atS(cylM, cx0 + ux * cylLen / 2, cy0 + uy * cylLen / 2, yL1 + 0.045);
    const rod = mesh(keep(new THREE.BoxGeometry(1, 0.008, 0.012)), mats.arms2); stand.add(rod);
    const head = mesh(keep(new THREE.BoxGeometry(0.03, 0.025, 0.03)), mats.arms); stand.add(head);
    const prodM = mesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 1, 10)), mats.pins); stand.add(prodM);
    const pinC = mesh(keep(cyl(0.008, 0.02)), mats.pins); stand.add(pinC);
    anim.push((tau, ang) => {
      const th = ang[iF];
      const mx = fx + Math.cos(th) * crankR, my = fy + Math.sin(th) * crankR;
      const along = (mx - fx) * ux + (my - fy) * uy, perp = (mx - fx) * -uy + (my - fy) * ux;
      const s = along + Math.sqrt(Math.max(0, lRod * lRod - perp * perp)); // crosse sur l'axe
      const sx = fx + ux * s, sy = fy + uy * s, hh = yL1 + 0.045;
      pinC.position.set(mx, yL1 + 0.03, -my);
      head.position.set(sx, hh, -sy); head.rotation.y = aC;
      rod.position.set((mx + sx) / 2, hh, -(my + sy) / 2); rod.scale.x = Math.hypot(sx - mx, sy - my); rod.rotation.y = Math.atan2(sy - my, sx - mx);
      const pe = cx0 + ux * 0.02, pf = cy0 + uy * 0.02;
      prodM.position.set((sx + pe) / 2, hh, -(sy + pf) / 2); prodM.scale.y = Math.max(0.001, Math.hypot(pe - sx, pf - sy)); prodM.rotation.set(0, aC, Math.PI / 2);
    });
    // régulateur à boules, mené par une courroie croisée depuis le volant
    const aG = aF + 0.9, gx = rT * Math.cos(aG), gy = rT * Math.sin(aG), rGp = 0.04;
    const iG = add({ x: gx, y: gy, z: 1, r: rGp, drive: (tau) => -OmD * tau * (rPa / rFp) * (rFp / rGp) });
    wheel(iG, yL1, { style: 'pulley', thick: 0.012 });
    belt(fx, fy, rFp, gx, gy, rGp, yL1, true);
    atS(mesh(keep(cyl(0.005, 0.17)), mats.pins), gx, gy, yL1);
    const gov = new THREE.Group();
    for (const sd of [-1, 1]) {
      const armG = mesh(keep(new THREE.BoxGeometry(0.004, 0.09, 0.004)), mats.arms2); armG.position.set(sd * 0.03, -0.035, 0); armG.rotation.z = sd * 0.75; gov.add(armG);
      const ball = mesh(keep(new THREE.SphereGeometry(0.018, 20, 12)), mats.gears); ball.position.set(sd * 0.065, -0.07, 0); gov.add(ball);
    }
    atS(gov, gx, gy, yL1 + 0.17);
    anim.push((tau, ang) => { gov.rotation.y = ang[iG]; });
    // compteur : un pignon du volant mène la roue d'un cadran
    const iFg = add({ x: fx, y: fy, z: 16, r: 0.03, coax: iF });
    wheel(iFg, yL1 + 0.04, { style: 'solid', noStud: true });
    dial(iFg, yL1 + 0.04, 1);
    void fly;
  }

  // ── satellites : tout autour du bâti, chacun mené par un pignon qui engrène
  // la couronne ; cadran de tours, phase de lune, réserve, ou (atelier) poulies
  {
    const used = nodes.filter((n) => n.r && Math.hypot(n.x, n.y) > plateR * 0.9).map((n) => Math.atan2(n.y, n.x));
    const free = (a) => used.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.42);
    const kinds = archetype === 'atelier' ? ['pulley', 'dial', 'pulley'] : ['dial', 'moon', 'reserve'];
    let placedN = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + 0.05;
      if (!free(a)) continue;
      const kind = kinds[placedN % kinds.length];
      placedN++;
      used.push(a);
      const zS = 16, rS = (plateR * zS) / zR, rS0 = plateR + rS;
      const ca = Math.cos(a), sa = Math.sin(a);
      // pignon sur la couronne, roue au-dessus, roue extérieure
      const iP = add({ x: rS0 * ca, y: rS0 * sa, z: zS, r: rS, parent: iRim });
      wheel(iP, yRim, { thick: 0.048, style: 'solid', noStud: true });
      atS(mesh(keep(cyl(0.01, yL1 + 0.02 - (yRim - 0.03))), mats.pins), rS0 * ca, rS0 * sa, yRim - 0.03);
      const m = 0.0044;
      if (kind === 'pulley') {
        const iPu = add({ x: rS0 * ca, y: rS0 * sa, z: 1, r: 0.05, coax: iP });
        wheel(iPu, yL1, { style: 'pulley', thick: 0.016, noStud: true });
        const rOut = rS0 + 0.05 + 0.2, ox = rOut * ca, oy = rOut * sa;
        const rF = 0.085;
        const iF = add({ x: ox, y: oy, z: 1, r: rF, drive: (tau) => OmRing * tau * (-zR / zS) * (0.05 / rF) });
        wheel(iF, yL1, { style: 'pulley', thick: 0.02 });
        // courroie ouverte (mêmes sens), tracée entre les deux poulies
        const pts = [], L = Math.hypot(ox - rS0 * ca, oy - rS0 * sa), ang = a, r1 = 0.05, r2 = rF, al = Math.asin((r1 - r2) / L);
        for (let q = 0; q <= 40; q++) { const b = ang + Math.PI / 2 + al + (q / 40) * (Math.PI - 2 * al); pts.push(new THREE.Vector3(rS0 * ca + Math.cos(b) * r1, yL1, -(rS0 * sa + Math.sin(b) * r1))); }
        for (let q = 0; q <= 40; q++) { const b = ang - Math.PI / 2 - al + (q / 40) * (Math.PI + 2 * al); pts.push(new THREE.Vector3(ox + Math.cos(b) * r2, yL1, -(oy + Math.sin(b) * r2))); }
        stand.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, 0.005, 6, true)), mats.belt, false));
        continue;
      }
      const zW = 40, rW = (m * zW) / 2;
      const iW = add({ x: rS0 * ca, y: rS0 * sa, z: zW, r: rW, coax: iP });
      wheel(iW, yL1, { noStud: true });
      const zD = kind === 'moon' ? 59 : 48, rD = (m * zD) / 2, rDc = rS0 + rW + rD;
      const iD = add({ x: rDc * ca, y: rDc * sa, z: zD, r: rD, parent: iW });
      wheel(iD, yL1);
      bridgeOver(rS0 * ca, rS0 * sa, yL1 + 0.022);
      const x = rDc * ca, y = rDc * sa, h = yL1 + 0.012;
      if (kind === 'moon') {
        // disque de lune (deux lunes d'or sur le ciel) sous un guichet
        const disk = new THREE.Group();
        disk.add(mesh(keep(cyl(rD * 0.95, 0.004, 48)), mats.screw, false));
        for (const sd of [-1, 1]) { const mo = mesh(keep(cyl(rD * 0.28, 0.0045, 32)), mats.arms, false); mo.position.set(sd * rD * 0.55, 0, 0); disk.add(mo); }
        atS(disk, x, y, h);
        meshes.push([iD, disk]);
        const cover = new THREE.Shape(); cover.absarc(0, 0, rD * 1.02, 0, TAU, false);
        const win = new THREE.Path(); win.absarc(0, rD * 0.25, rD * 0.62, Math.PI * 0.05, Math.PI * 0.95, false); win.lineTo(-rD * 0.6, rD * 0.25); win.closePath();
        cover.holes.push(win);
        const cv = mesh(keep(flat(cover, 0.004, 0.3, 32)), mats.arms); cv.rotation.y = a - Math.PI / 2;
        atS(cv, x, y, h + 0.006);
      } else {
        // cadran : tours de la couronne, ou réserve de marche (24 divisions)
        atS(mesh(keep(cyl(rD * 0.92, 0.008, 48)), mats.dial), x, y, h);
        const nT = kind === 'reserve' ? 24 : 12, tick = keep(new THREE.BoxGeometry(rD * 0.14, 0.001, rD * 0.022)), ticks = new THREE.InstancedMesh(tick, mats.ink, nT);
        const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), pp = new THREE.Vector3();
        for (let k2 = 0; k2 < nT; k2++) { const b = (k2 / nT) * TAU; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b); pp.set(x + Math.cos(b) * rD * 0.75, h + 0.0085, -(y + Math.sin(b) * rD * 0.75)); ticks.setMatrixAt(k2, M.compose(pp, q, s1)); }
        stand.add(ticks);
        const hs = new THREE.Shape(); hs.moveTo(-rD * 0.12, -rD * 0.05); hs.lineTo(rD * 0.72, -rD * 0.014); hs.lineTo(rD * 0.72, rD * 0.014); hs.lineTo(-rD * 0.12, rD * 0.05); hs.closePath();
        const hand = mesh(keep(flat(hs, 0.002, 0)), mats.screw, false);
        atS(hand, x, y, h + 0.009);
        meshes.push([iD, hand]);
      }
    }
  }

  // ── sous le plateau : canon (le plateau repose sur le pont), tube central, pont, bâti, pied
  const plateSleeve = mesh(keep(cyl(0.04, yPlate - 0.06 - yUB, 40)), mats.foot);
  plateSleeve.position.y = yUB; plateGroup.add(plateSleeve);
  const tubeM = mesh(keep(cyl(0.012, yTubeTop - (yFrame + 0.006), 24)), mats.arms);
  tubeM.position.y = yFrame + 0.006; plateGroup.add(tubeM);
  const bridgeU = mesh(keep(new THREE.BoxGeometry(rO + 0.06, 0.01, 0.05)), mats.foot);
  bridgeU.position.set(rO / 2, yUB - 0.005, 0); stand.add(bridgeU);
  const frame = mesh(keep(new THREE.CylinderGeometry(rO + 0.1, rO + 0.1, 0.024, 120)), mats.foot);
  frame.position.y = yFrame - 0.012; stand.add(frame);
  // colonnes qui portent le bâti
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26; atS(mesh(keep(cyl(0.016, yB - 0.03 - yFrame, 20)), mats.foot), (bIn + bOut) / 2 * Math.cos(a), (bIn + bOut) / 2 * Math.sin(a), yFrame); }
  const box = mesh(keep(new THREE.CylinderGeometry(0.16, 0.19, 0.12, 64)), mats.foot);
  box.position.y = yFrame - 0.024 - 0.06; stand.add(box);
  const footTop = yFrame - 0.024 - 0.12;
  const foot = mesh(keep(cyl(0.11, footTop - yFloor - 0.04, 48, 0.07)), mats.foot);
  foot.position.y = yFloor + 0.04; stand.add(foot);
  const base = mesh(keep(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 96)), mats.foot);
  base.position.y = yFloor + 0.02; stand.add(base);

  // ── gravure du centre du plateau (à plat, sous la machine)
  for (const f of [0.25, 0.5, 0.75]) {
    const n = 360, pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts[2 * i] = Math.cos(a) * plateR * f; pts[2 * i + 1] = Math.sin(a) * plateR * f; }
    plateGroup.add(new THREE.Mesh(keep(ribbonGeometry(pts, 0.003, yPlate + 0.0003)), mats.groove));
  }

  const angles = gearTree(nodes);
  function update(tau) {
    const ang = angles(tau);
    for (const [i, m] of meshes) m.rotation.y = ang[i];
    for (const f of anim) f(tau, ang);
  }
  return { update, bezelR: bOut, yTubeBottom: yFrame };
}
