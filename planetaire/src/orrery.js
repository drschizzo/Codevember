// La machine : un planétaire (orrery) en laiton qui « porte » la simulation.
//
// Rien ici ne simule : la mécanique LIT l'état du GPU et le rend tangible.
//  · chaque planète est tenue par un bras horizontal fixé sur un tube ; les
//    tubes sont concentriques autour de l'axe central (la planète la plus
//    proche sur l'arbre le plus fin et le plus haut, comme sur un vrai orrery) ;
//  · au pied de chaque tube, une roue dentée ; elle engrène un pignon monté sur
//    un arbre de renvoi. Le rapport roue / pignon suit la vitesse angulaire de
//    la planète : la troisième loi de Kepler est écrite dans les dentures ;
//  · la tête de lecture devient le peigne d'une boîte à musique : chaque
//    planète, en passant, pince la lame qui correspond à son rayon (longues
//    lames = notes graves, au bord du disque) ;
//  · un balancier et une roue d'échappement battent la mesure du temps simulé ;
//  · un limbe gradué cercle le disque, porté par quatre arceaux.
import * as THREE from 'three/webgpu';
import { vec3, mix, positionLocal, mx_noise_float, float } from 'three/tsl';
import { R_IN, R_OUT } from './sim.js';

const K = 12;                          // bras (planètes portées) au maximum
const Y_ARM0 = -0.42, DY_ARM = 0.12;   // hauteur des bras sous le plan du disque
const Y_BASE = -3.3;                   // dessus du socle
const Y_GEAR0 = Y_BASE + 0.12, DY_GEAR = 0.075;
const LAY_D = 1.6, LAY_ANG = (3 * Math.PI) / 4; // arbre de renvoi
const COMB_Y = -0.3, NTEETH = 44;
const LIMB_R0 = 9.55, LIMB_R1 = 10.35;
const MODULE = 0.06;                   // module des dentures (même pas pour toutes les roues)

// Rayon affiché d'une planète (même formule que le shader de visuals.js)
export function visRadius(mE) {
  const Rp = mE < 2 ? Math.pow(mE, 0.28) : Math.min(11.5, 1.21 * Math.pow(mE / 2, 0.59));
  return Math.max(0.005, 0.013 * Math.pow(Rp, 0.75));
}

// ── Matériaux ────────────────────────────────────────────────────────────────
function brass(tone = [0.8, 0.66, 0.4], rough = 0.4) {
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: rough });
  // laiton brossé : fines stries et légères variations de patine
  const p = positionLocal;
  const brush = mx_noise_float(vec3(p.x.mul(3.0), p.y.mul(180.0), p.z.mul(3.0))).mul(0.5).add(0.5);
  const patina = mx_noise_float(p.mul(1.7)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(...tone).mul(0.82), vec3(...tone), brush).mul(patina.mul(0.18).add(0.88));
  m.roughnessNode = float(rough).add(brush.mul(0.12)).add(patina.mul(0.08));
  return m;
}
const steel = () => new THREE.MeshStandardNodeMaterial({ color: 0xc4cad2, metalness: 0.6, roughness: 0.28 });
const blued = () => new THREE.MeshStandardNodeMaterial({ color: 0x3550a0, metalness: 0.55, roughness: 0.25 });

// ── Géométries ───────────────────────────────────────────────────────────────
// Roue dentée de rayon primitif 1, épaisseur 1 (axe y, centrée), n dents,
// rayons évidés pour les grandes roues.
const gearCache = new Map();
function gearGeometry(n) {
  if (gearCache.has(n)) return gearCache.get(n);
  const m = 2 / n, out = 1 + m, root = 1 - 1.25 * m, p = (Math.PI * 2) / n;
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = i * p;
    const pts = [[root, a], [root, a + 0.22 * p], [out, a + 0.38 * p], [out, a + 0.62 * p], [root, a + 0.78 * p]];
    pts.forEach(([r, t], j) => (i === 0 && j === 0 ? s.moveTo(r * Math.cos(t), r * Math.sin(t)) : s.lineTo(r * Math.cos(t), r * Math.sin(t))));
  }
  s.closePath();
  if (n >= 18) {
    const S = n >= 40 ? 6 : 5, hub = 0.26, rim = root - 0.16;
    for (let k = 0; k < S; k++) {
      const a0 = (k / S) * Math.PI * 2, a1 = ((k + 1) / S) * Math.PI * 2;
      const dO = 0.09 / rim, dI = 0.09 / hub;
      const h = new THREE.Path();
      h.moveTo(rim * Math.cos(a0 + dO), rim * Math.sin(a0 + dO));
      h.absarc(0, 0, rim, a0 + dO, a1 - dO, false);
      h.lineTo(hub * Math.cos(a1 - dI), hub * Math.sin(a1 - dI));
      h.absarc(0, 0, hub, a1 - dI, a0 + dI, true);
      h.closePath();
      s.holes.push(h);
    }
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -0.5, 0);
  g.computeVertexNormals();
  gearCache.set(n, g);
  return g;
}
const teethFor = (r) => Math.max(8, Math.round((2 * r) / MODULE));

// Gravure du limbe : graduations en degrés, chiffres, devise
function limbTexture() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const C = S / 2, R1 = C, R0 = C * (LIMB_R0 / LIMB_R1);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#3a2a14';
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); };
  const band = R1 - R0;
  ring(R1 - band * 0.06, 3); ring(R1 - band * 0.30, 2); ring(R0 + band * 0.42, 2); ring(R0 + band * 0.06, 3);
  // degrés (sens trigonométrique, 0° sur la tête de lecture)
  for (let d = 0; d < 360; d++) {
    const a = (-d * Math.PI) / 180;
    const L = d % 10 === 0 ? 0.24 : d % 5 === 0 ? 0.16 : 0.09;
    const r1 = R1 - band * 0.06, r0 = r1 - band * L;
    g.lineWidth = d % 10 === 0 ? 3 : 1.6;
    g.beginPath(); g.moveTo(C + r0 * Math.cos(a), C + r0 * Math.sin(a)); g.lineTo(C + r1 * Math.cos(a), C + r1 * Math.sin(a)); g.stroke();
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const along = (txt, r, a, px) => {
    g.save(); g.translate(C + r * Math.cos(a), C + r * Math.sin(a)); g.rotate(a + Math.PI / 2);
    g.font = `500 ${px}px "Cormorant Garamond", Georgia, serif`; g.fillText(txt, 0, 0); g.restore();
  };
  for (let d = 0; d < 360; d += 10) along(String(d), R1 - band * 0.38, (-d * Math.PI) / 180, band * 0.12);
  // devise gravée dans la bande intérieure, avec les signes des douze maisons
  const ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  for (let k = 0; k < 12; k++) along(ROM[k], R0 + band * 0.24, (-(k * 30 + 15) * Math.PI) / 180, band * 0.13);
  for (let k = 0; k < 12; k++) {
    const a = (-k * 30 * Math.PI) / 180;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(C + (R0 + band * 0.06) * Math.cos(a), C + (R0 + band * 0.06) * Math.sin(a));
    g.lineTo(C + (R0 + band * 0.42) * Math.cos(a), C + (R0 + band * 0.42) * Math.sin(a)); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Gravure de la platine (dessus du socle) : guillochage et inscription
function plateTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), C = S / 2;
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
  g.strokeStyle = g.fillStyle = '#3a2a14';
  // guillochage : rosace de cercles décentrés
  g.globalAlpha = 0.35; g.lineWidth = 1;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    g.beginPath(); g.arc(C + Math.cos(a) * 60, C + Math.sin(a) * 60, 300, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1; g.lineWidth = 3;
  for (const r of [0.985, 0.93, 0.79]) { g.beginPath(); g.arc(C, C, C * r, 0, Math.PI * 2); g.stroke(); }
  const txt = 'MACHINA · MUNDI · PLANÉTAIRE · T² ∝ a³ · LIGNÉE & SILLONS · ';
  g.font = `500 ${C * 0.075}px "Cormorant Garamond", Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...txt + txt];
  chars.forEach((ch, i) => {
    const a = (i / chars.length) * Math.PI * 2;
    g.save(); g.translate(C + C * 0.86 * Math.cos(a), C + C * 0.86 * Math.sin(a)); g.rotate(a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Petit ciel d'atelier pour les reflets du métal : pénombre chaude, deux
// fenêtres et une lampe — juste de quoi faire luire les arêtes.
function workshopEnv() {
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#9a9488'); sky.addColorStop(0.35, '#4c4640'); sky.addColorStop(0.5, '#1e1914'); sky.addColorStop(1, '#0a0807');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const glow = (x, y, rx, ry, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
    g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
  };
  glow(140, 60, 90, 45, 'rgba(255,224,180,1)');
  glow(360, 70, 110, 40, 'rgba(200,212,255,0.7)');
  glow(250, 10, 260, 40, 'rgba(255,215,170,0.6)');
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOrrery(scene, renderer) {
  const root = new THREE.Group();
  root.name = 'orrery';
  scene.add(root);
  // (préfiltrée en PMREM : sans cela, les reflets du métal restent noirs)
  let env = null;
  scene.environmentIntensity = 1.2;
  new THREE.PMREMGenerator(renderer).fromEquirectangularAsync(workshopEnv()).then((rt) => {
    env = rt.texture;
    if (root.visible) scene.environment = env;
  });

  const MB = brass(), MBd = brass([0.56, 0.44, 0.27], 0.45), MS = steel(), MBl = blued();

  // ── Lumières : l'étoile éclaire la machine, une lampe d'atelier la révèle ─
  const starLight = new THREE.PointLight(0xffd6a0, 2, 0, 0.3);
  root.add(starLight);
  const lamp = new THREE.DirectionalLight(0xfff6ec, 5.5);
  lamp.position.set(-8, 14, 10);
  root.add(lamp);
  const rim = new THREE.DirectionalLight(0x9fb6ff, 1.5);
  rim.position.set(9, -4, -12);
  root.add(rim);

  // ── Socle tourné + platine gravée ───────────────────────────────────────
  {
    const y = Y_BASE;
    const prof = [[0, y - 1.25], [2.35, y - 1.25], [2.45, y - 1.17], [2.2, y - 1.1], [1.25, y - 0.92], [0.95, y - 0.7],
      [0.8, y - 0.45], [0.95, y - 0.3], [1.6, y - 0.2], [2.55, y - 0.12], [2.62, y - 0.06], [2.62, y], [0, y]]
      .map(([r, h]) => new THREE.Vector2(r, h));
    const foot = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), MBd);
    root.add(foot);
    const pm = new THREE.MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.42 });
    const eng = plateTexture();
    pm.map = eng;
    pm.color = new THREE.Color(0.72, 0.6, 0.38);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.58, 2.58, 0.02, 96), pm);
    plate.position.y = y + 0.01;
    // (UV du dessus d'un cylindre : planaires, la gravure se pose telle quelle)
    root.add(plate);
  }

  // ── Limbe gradué et ses arceaux ─────────────────────────────────────────
  {
    const lm = new THREE.MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.36 });
    lm.map = limbTexture();
    lm.color = new THREE.Color(0.8, 0.67, 0.42);
    const ringGeo = new THREE.RingGeometry(LIMB_R0, LIMB_R1, 256, 1);
    // (UV planaires sur le carré circonscrit au bord extérieur : la gravure tombe juste)
    const limb = new THREE.Mesh(ringGeo, lm);
    limb.rotation.x = -Math.PI / 2;
    limb.position.y = -0.02;
    root.add(limb);
    // tranche du limbe
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(LIMB_R1, LIMB_R1, 0.12, 256, 1, true), MBd);
    edge.position.y = -0.08;
    root.add(edge);
    const edge2 = new THREE.Mesh(new THREE.CylinderGeometry(LIMB_R0, LIMB_R0, 0.12, 256, 1, true), MBd);
    edge2.position.y = -0.08;
    root.add(edge2);
    // arceaux : du limbe jusqu'au bord de la platine
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const at = (r, y) => d.clone().multiplyScalar(r).setY(y);
      const curve = new THREE.CubicBezierCurve3(at((LIMB_R0 + LIMB_R1) / 2, -0.14), at(9.9, -2.6), at(4.2, Y_BASE + 0.5), at(2.45, Y_BASE + 0.02));
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.07, 12), MB));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12), MB);
      knob.position.copy(at((LIMB_R0 + LIMB_R1) / 2, -0.02));
      knob.scale.y = 0.6;
      root.add(knob);
    }
  }

  // ── Peigne de la boîte à musique (= la tête de lecture, axe +X) ────────
  const teeth = [];
  {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.16), MB);
    const x0 = R_IN * 0.6, x1 = LIMB_R0 + 0.3;
    bar.scale.x = x1 - x0;
    bar.position.set((x0 + x1) / 2, COMB_Y - 0.03, 0.2);
    root.add(bar);
    // vis bleuies le long de la barre
    const screwG = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12);
    for (let x = 0.8; x < x1; x += 1.1) {
      const s = new THREE.Mesh(screwG, MBl);
      s.position.set(x, COMB_Y + 0.005, 0.2);
      root.add(s);
    }
    // lames : une par note, de plus en plus longues vers le bord (graves)
    const tg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
    for (let i = 0; i < NTEETH; i++) {
      const r = R_IN + (i + 0.5) * (R_OUT - R_IN) / NTEETH;
      const L = 0.16 + 0.34 * (i / (NTEETH - 1));
      const mesh = new THREE.Mesh(tg, MS);
      mesh.scale.set(((R_OUT - R_IN) / NTEETH) * 0.62, 0.018, L);
      mesh.position.set(r, COMB_Y, 0.12);
      root.add(mesh);
      teeth.push({ mesh, r, L, amp: 0, t: 0, f: 26 - 14 * (i / NTEETH) });
    }
  }

  // ── Axe central, arbre de renvoi, pont, roue motrice, balancier ─────────
  const layP = new THREE.Vector3(Math.cos(LAY_ANG) * LAY_D, 0, Math.sin(LAY_ANG) * LAY_D);
  const gearTop = Y_GEAR0 + (K - 1) * DY_GEAR;
  {
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 12).translate(0, 0.5, 0), MS);
    spindle.position.y = Y_BASE;
    spindle.scale.y = -0.08 - Y_BASE; // l'axe le plus fin monte jusque sous l'étoile
    root.add(spindle);
    const cup = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MB);
    cup.material.side = THREE.DoubleSide;
    cup.position.y = -0.09;
    root.add(cup);
    const lay = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12).translate(0, 0.5, 0), MS);
    lay.position.set(layP.x, Y_BASE, layP.z);
    lay.scale.y = gearTop - Y_BASE + 0.18;
    root.add(lay);
    // pont (cock) qui tient le haut de l'arbre de renvoi
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.16), MB);
    bridge.scale.x = LAY_D + 0.4;
    bridge.position.set(layP.x / 2, gearTop + 0.16, layP.z / 2);
    bridge.rotation.y = -LAY_ANG;
    root.add(bridge);
    for (const p of [layP, new THREE.Vector3()]) {
      const jewel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), new THREE.MeshStandardNodeMaterial({ color: 0x8a0f22, roughness: 0.1, metalness: 0.2 }));
      jewel.position.set(p.x, gearTop + 0.195, p.z);
      root.add(jewel);
    }
  }
  // roue motrice (barillet) et pignon au pied de l'arbre de renvoi
  const drive = new THREE.Mesh(gearGeometry(teethFor(0.9)), MB);
  const drivePin = new THREE.Mesh(gearGeometry(teethFor(0.22)), MS);
  {
    const dirOut = layP.clone().normalize();
    const side = new THREE.Vector3(-dirOut.z, 0, dirOut.x);
    drive.position.copy(layP).addScaledVector(side, 1.12).setY(Y_BASE + 0.06);
    drive.scale.set(0.9, 0.05, 0.9);
    drivePin.position.copy(layP).setY(Y_BASE + 0.06);
    drivePin.scale.set(0.22, 0.05, 0.22);
    root.add(drive, drivePin);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.28, 48), MBd);
    barrel.position.copy(drive.position).setY(Y_BASE + 0.23);
    root.add(barrel);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24), MBl);
    cap.position.copy(barrel.position).setY(Y_BASE + 0.39);
    root.add(cap);
  }
  // balancier spiral + roue d'échappement
  const balance = new THREE.Group();
  const escape = new THREE.Mesh(gearGeometry(15), MS);
  {
    const a = -Math.PI / 4;
    balance.position.set(Math.cos(a) * 1.75, Y_BASE + 0.32, Math.sin(a) * 1.75);
    const rimB = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 10, 64), MB);
    rimB.rotation.x = Math.PI / 2;
    balance.add(rimB);
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.02, 0.03), MB);
      sp.rotation.y = (k / 3) * Math.PI;
      balance.add(sp);
    }
    for (let k = 0; k < 8; k++) { // vis de réglage sur la serge
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), MS);
      s.position.set(Math.cos((k / 8) * Math.PI * 2) * 0.45, 0, Math.sin((k / 8) * Math.PI * 2) * 0.45);
      balance.add(s);
    }
    root.add(balance);
    // spiral (fixe en son centre : on le dessine en ligne bleuie)
    const pts = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400, ang = t * Math.PI * 2 * 7, r = 0.03 + t * 0.26;
      pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.03, Math.sin(ang) * r));
    }
    const hair = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicNodeMaterial({ color: 0x5f7ed8 }));
    balance.add(hair);
    balance.userData.hair = hair;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 10), MS);
    post.position.copy(balance.position).setY(Y_BASE + 0.16);
    root.add(post);
    escape.position.copy(balance.position).add(new THREE.Vector3(-0.62, 0, 0.22)).setY(Y_BASE + 0.2);
    escape.scale.set(0.2, 0.025, 0.2);
    root.add(escape);
  }

  // ── Pièces mobiles, une par planète portée ──────────────────────────────
  const inst = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    root.add(m);
    return m;
  };
  const arms = inst(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0), MB, K);
  const stems = inst(new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0), MS, K);
  const collars = inst(new THREE.CylinderGeometry(1, 0.55, 1, 20), MB, K);
  const weights = inst(new THREE.CylinderGeometry(1, 1, 1, 24), MBd, K);
  const tubes = inst(new THREE.CylinderGeometry(1, 1, 1, 24).translate(0, 0.5, 0), MB, K);
  const hubs = inst(new THREE.CylinderGeometry(1, 1, 1, 24), MBd, K);
  const gears = [], pinions = [];
  for (let k = 0; k < K; k++) {
    const g = new THREE.Mesh(gearGeometry(24), MB);
    const p = new THREE.Mesh(gearGeometry(12), MS);
    g.visible = p.visible = false;
    root.add(g, p);
    gears.push(g); pinions.push(p);
  }

  const track = new Map(); // index → { y, phi, cum }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const place = (mesh, i, pos, rotY, scale) => {
    _q.setFromAxisAngle(_up, rotY);
    _m.compose(pos, _q, scale);
    mesh.setMatrixAt(i, _m);
  };

  let tReal = 0, layAng = 0, escStep = 0, escPrev = 0;

  // planets : liste de main.js ; pred : index → [x, y, z] (instant présent)
  function update(planets, pred, dtSim, dtReal, running) {
    tReal += dtReal;
    const carried = planets.filter((p) => p.mE >= 0.1 && pred.has(p.index))
      .sort((a, b) => b.m - a.m).slice(0, K)
      .sort((a, b) => a.a - b.a);
    const seen = new Set();
    let n = 0;
    for (const p of carried) {
      const q = pred.get(p.index);
      const [x, y, z] = q;
      const a = Math.hypot(x, z), phi = Math.atan2(z, x);
      let tr = track.get(p.index);
      const yT = Y_ARM0 - n * DY_ARM;
      if (!tr) { tr = { y: yT, phi, cum: 0 }; track.set(p.index, tr); }
      let dphi = phi - tr.phi;
      if (dphi > Math.PI) dphi -= Math.PI * 2; else if (dphi < -Math.PI) dphi += Math.PI * 2;
      tr.cum += dphi; tr.phi = phi;
      tr.y += (yT - tr.y) * Math.min(1, dtReal * 3); // un bras qui change d'étage glisse sur son tube
      seen.add(p.index);
      const k = n, ya = tr.y, vr = visRadius(p.mE);
      const w = 0.045 + 0.035 * Math.min(1, Math.cbrt(p.mE / 30));
      const back = 0.28 + 0.1 * (k % 3);
      // bras (prolongé derrière l'axe jusqu'au contrepoids)
      place(arms, k, _p.set(-Math.cos(phi) * back, ya, -Math.sin(phi) * back), -phi, _s.set(a + back, 0.03, w));
      place(weights, k, _p.set(-Math.cos(phi) * back, ya, -Math.sin(phi) * back), 0, _s.set(0.05 + w, 0.07, 0.05 + w));
      // tige verticale jusque sous la planète, coupelle qui la tient
      const top = y - vr * 0.85;
      place(stems, k, _p.set(x, ya, z), 0, _s.set(0.011, Math.max(0.01, top - ya), 0.011));
      place(collars, k, _p.set(x, top, z), 0, _s.set(vr * 0.55 + 0.006, 0.006 + vr * 0.25, vr * 0.55 + 0.006));
      // tube et moyeu
      const gy = Y_GEAR0 + k * DY_GEAR, tr0 = 0.035 + 0.013 * k;
      place(tubes, k, _p.set(0, gy, 0), 0, _s.set(tr0, ya - gy, tr0));
      place(hubs, k, _p.set(0, ya, 0), 0, _s.set(tr0 + 0.035, 0.05, tr0 + 0.035));
      // roue (solidaire du tube, donc du bras) et pignon du renvoi
      // ω_planète / ω_renvoi = r_pignon / r_roue, avec r_roue + r_pignon = LAY_D
      const om = Math.pow(Math.max(a, 0.2), -1.5);
      const rg = Math.min(1.35, Math.max(0.25, LAY_D / (1 + om)));
      const rp = LAY_D - rg;
      const ng = teethFor(rg), np = teethFor(rp);
      const G = gears[k], P = pinions[k];
      if (G.userData.n !== ng) { G.geometry = gearGeometry(ng); G.userData.n = ng; }
      if (P.userData.n !== np) { P.geometry = gearGeometry(np); P.userData.n = np; }
      G.visible = P.visible = true;
      G.position.set(0, gy, 0); G.scale.set(rg, 0.032, rg); G.rotation.y = -phi;
      P.position.set(layP.x, gy, layP.z); P.scale.set(rp, 0.032, rp);
      P.rotation.y = tr.cum * (rg / rp) + Math.PI / np; // engrène la roue (sens inverse)
      n++;
    }
    for (const i of track.keys()) if (!seen.has(i)) track.delete(i);
    for (let k = n; k < K; k++) gears[k].visible = pinions[k].visible = false;
    for (const m of [arms, stems, collars, weights, tubes, hubs]) { m.count = n; m.instanceMatrix.needsUpdate = true; }

    // renvoi, barillet : tournent avec le temps simulé
    layAng += dtSim;
    drivePin.rotation.y = layAng;
    drive.rotation.y = -layAng * (0.22 / 0.9) + Math.PI / teethFor(0.9);
    // balancier : 2,5 battements/s quand la machine tourne, s'amortit à l'arrêt
    const amp = balance.userData.amp = (balance.userData.amp ?? 0) + ((running ? 1 : 0) - (balance.userData.amp ?? 0)) * Math.min(1, dtReal * 1.5);
    const ph = (balance.userData.ph = (balance.userData.ph ?? 0) + dtReal * Math.PI * 2 * 1.25);
    const ang = Math.sin(ph) * 2.4 * amp;
    balance.rotation.y = ang;
    const hair = balance.userData.hair;
    hair.scale.setScalar(1 + 0.04 * Math.sin(ph) * amp);
    hair.rotation.y = -ang * 0.85;
    // échappement : la roue avance d'une dent à chaque alternance
    const half = Math.floor(ph / Math.PI);
    if (half !== escPrev && amp > 0.2) escStep++;
    escPrev = half;
    const e = Math.min(1, (ph / Math.PI - half) * 6);
    escape.rotation.y = -((escStep - 1 + e * e * (3 - 2 * e)) * (Math.PI * 2)) / 15;

    // lames du peigne : vibration amortie
    for (const t of teeth) {
      if (t.amp < 1e-3) { if (t.mesh.rotation.x) t.mesh.rotation.x = 0; continue; }
      t.t += dtReal;
      t.amp *= Math.exp(-dtReal * 3.2);
      t.mesh.rotation.x = Math.sin(t.t * t.f * Math.PI * 2 / 6) * 0.25 * t.amp;
    }
  }

  // une planète croise la tête : elle pince la lame de son rayon
  function pluck(a, strength = 1) {
    let best = null, bd = 1e9;
    for (const t of teeth) { const d = Math.abs(t.r - a); if (d < bd) { bd = d; best = t; } }
    if (!best) return;
    best.amp = Math.min(1, best.amp + 0.6 + 0.4 * strength);
    best.t = 0;
  }

  // éclairage de la machine par l'étoile (couleur et luminosité du cycle de vie)
  function setStar(color, lightK, shell = 0) {
    starLight.color.setRGB(color[0], color[1], color[2]);
    starLight.intensity = 1.6 * Math.min(2.0, lightK) + 12 * shell;
  }

  function setVisible(v) {
    root.visible = v;
    scene.environment = v ? env : null;
  }

  return { root, update, pluck, setStar, setVisible };
}
