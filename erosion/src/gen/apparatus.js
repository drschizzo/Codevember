// L'appareil (géométrie, module pur) : la table à érosion telle qu'un atelier
// de laboratoire la construirait. Toutes les longueurs en mètres, repère du
// monde (X le long du bac vers l'aval, Y vers le haut, Z en travers ; le fond
// du bac en Y = 0, le centre du bac en X = Z = 0).
//
// Pièces fixes, rangées par matière : aluminium (profilés du châssis, pieds,
// traverses, supports de rails), acrylique (parois du bac), acier (rails
// ronds, tiges), inox (boîte d'alimentation, goulotte, déversoir), noir
// (pieds réglables, volants, moteur, courroie), fond du bac.
// Pièces mobiles, chacune dans son repère : le portique (chariots, poutre,
// moteur, tiges des vérins), la lame (profil en travers du gabarit), la
// guillotine du déversoir, le flotteur du débitmètre.
import { Buffers, roundedBox, tube, sphere, torus, lathe, OUT, EDGE } from './mesh.js';
import { TABLE, crossProfile } from './table.js';

const HX = TABLE.Lx / 2, HZ = TABLE.Ly / 2;
export const DIM = {
  wallT: 0.008,              // épaisseur de l'acrylique
  wallTop: 0.175,            // haut des parois
  railY: 0.225, railZ: HZ + 0.055, railR: 0.008,
  beamY: 0.30,               // poutre du portique
  bladeH: 0.05, bladeT: 0.006,
  floorY: -0.82,             // sol du lieu
  benchY: -0.03,             // dessous du bac (châssis)
};

const box = (B, c, h, r = 0.002, n = 4) => roundedBox(B, c, h, r, n);

export function buildStatic(spec) {
  const alu = new Buffers(), acr = new Buffers(), steel = new Buffers(), inox = new Buffers(), black = new Buffers(), base = new Buffers();
  const D = DIM;
  // ── bac : fond, parois d'acrylique, profilés du haut ──
  box(base, [0, -0.008, 0], [HX + 0.06, 0.008, HZ + 0.02], 0.002);
  for (const s of [-1, 1]) box(acr, [0, D.wallTop / 2 - 0.016, s * (HZ + D.wallT / 2)], [HX + 0.004, D.wallTop / 2 + 0.016, D.wallT / 2], 0.0015, 3);
  box(acr, [-HX - D.wallT / 2, D.wallTop / 2 - 0.016, 0], [D.wallT / 2, D.wallTop / 2 + 0.016, HZ + D.wallT], 0.0015, 3);
  // profilés de 30 × 30 le long des bords hauts, et en bout
  for (const s of [-1, 1]) {
    box(alu, [0, D.wallTop + 0.015, s * (HZ + D.wallT + 0.015)], [HX + 0.07, 0.015, 0.015], 0.003);
    box(alu, [0, -0.031, s * (HZ + 0.02)], [HX + 0.07, 0.015, 0.02], 0.003);
  }
  for (const s of [-1, 1]) box(alu, [s * (HX + 0.085), D.wallTop / 2 - 0.02, 0], [0.015, D.wallTop / 2 + 0.035, HZ + 0.04], 0.003);
  // montants d'angle
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(alu, [sx * (HX + 0.085), D.wallTop / 2, sz * (HZ + D.wallT + 0.015)], [0.015, D.wallTop / 2 + 0.03, 0.015], 0.003);
  // ── piétement : quatre pieds de 40 × 40, traverses, pieds réglables, vérins de basculement ──
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (HX - 0.05), z = sz * (HZ - 0.02);
    box(alu, [x, (D.floorY + 0.03 - 0.046) / 2, z], [0.02, (-0.046 - D.floorY - 0.03) / 2, 0.02], 0.003);
    // pied réglable : tige filetée (le patin est fait plus bas)
    tube(steel, [[x, D.floorY + 0.012, z], [x, D.floorY + 0.045, z]], 0.006, 12);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (HX - 0.05), z = sz * (HZ - 0.02);
    black.frame([x, D.floorY, z], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
    lathe(black, [{ r: 0.0001, z: 0, nr: 0, nz: -1, s: OUT }, { r: 0.024, z: 0, nr: 0, nz: -1, s: OUT }, { r: 0.024, z: 0.001, nr: 1, nz: 0, s: EDGE }, { r: 0.021, z: 0.013, nr: 1, nz: 0.5, s: EDGE }, { r: 0.0001, z: 0.013, nr: 0, nz: 1, s: OUT }], 28);
    black.noFrame();
  }
  for (const sz of [-1, 1]) box(alu, [0, D.floorY + 0.2, sz * (HZ - 0.02)], [HX - 0.03, 0.015, 0.015], 0.003);
  for (const sx of [-1, 1]) box(alu, [sx * (HX - 0.05), D.floorY + 0.2, 0], [0.015, 0.015, HZ - 0.04], 0.003);
  // vérin de basculement à l'amont : corps, tige, volant
  for (const sz of [-1, 1]) {
    const x = -HX + 0.12, z = sz * (HZ - 0.02);
    tube(steel, [[x, D.floorY + 0.2, z], [x, -0.05, z]], 0.008, 14);
    box(black, [x, -0.1, z], [0.022, 0.03, 0.022], 0.004);
    black.frame([x + 0.04, -0.1, z], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
    torus(black, [0, 0, 0], 0.03, 0.004, 40, 10);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; tube(black, [[0, 0, 0], [Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0]], 0.0025, 8, OUT, false); }
    black.noFrame();
  }
  // ── rails ronds du portique, sur supports ──
  for (const s of [-1, 1]) {
    tube(steel, [[-HX - 0.1, D.railY, s * D.railZ], [HX + 0.1, D.railY, s * D.railZ]], D.railR, 20);
    for (const x of [-HX - 0.07, -HX / 3, HX / 3, HX + 0.07]) {
      box(alu, [x, (D.railY + D.wallTop + 0.03) / 2 - 0.004, s * D.railZ], [0.012, (D.railY - D.wallTop - 0.03) / 2 + 0.004, 0.012], 0.002);
      box(alu, [x, D.wallTop + 0.022, s * (D.railZ - 0.022)], [0.014, 0.008, 0.034], 0.002);
    }
  }
  // ── déversoir aval : caisson, glissières de la guillotine, goulotte ──
  {
    const x = HX + 0.035;
    box(inox, [x, 0.04, 0], [0.026, 0.07, HZ + 0.01], 0.002);
    for (const s of [-1, 1]) box(alu, [HX + 0.006, 0.1, s * 0.06], [0.006, 0.09, 0.008], 0.0015);
    // crémaillère et volant
    tube(steel, [[HX + 0.006, 0.19, 0], [HX + 0.006, 0.26, 0]], 0.004, 12);
    black.frame([HX + 0.006, 0.265, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
    torus(black, [0, 0, 0], 0.035, 0.0045, 44, 10);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.3; tube(black, [[0, 0, 0], [Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0]], 0.0028, 8, OUT, false); }
    black.noFrame();
    // tuyau de sortie vers le bac de reprise
    tube(inox, [[x + 0.02, -0.02, 0.08], [x + 0.08, -0.06, 0.08], [x + 0.09, -0.3, 0.08]], 0.016, 18);
  }
  // ── boîte d'alimentation amont (débordement par une lèvre en biseau), débitmètre, robinet ──
  if (spec.src) {
    const zc = spec.src.y - HZ, w = Math.max(0.06, spec.src.w) / 2 + 0.02;
    const x0 = -HX - 0.004;
    box(inox, [x0 - 0.05, 0.155, zc], [0.045, 0.05, w], 0.003);
    // lèvre : une goulotte inclinée qui descend jusqu'au sable
    inox.frame([x0 + 0.004, 0.118, zc], [0.94, -0.34, 0], [0.34, 0.94, 0], [0, 0, 1]);
    box(inox, [0.0, 0, 0], [0.02, 0.0015, w - 0.006], 0.001, 3);
    for (const s of [-1, 1]) box(inox, [0.0, 0.008, s * (w - 0.006)], [0.02, 0.008, 0.0015], 0.001, 3);
    inox.noFrame();
    // arrivée d'eau : tuyau, robinet à volant, débitmètre (tube de verre gradué)
    tube(steel, [[x0 - 0.12, 0.17, zc + w - 0.01], [x0 - 0.2, 0.17, zc + w - 0.01], [x0 - 0.2, -0.3, zc + w - 0.01]], 0.007, 14);
    box(black, [x0 - 0.16, 0.17, zc + w - 0.01], [0.012, 0.012, 0.012], 0.003);
    black.frame([x0 - 0.16, 0.2, zc + w - 0.01], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
    torus(black, [0, 0, 0], 0.02, 0.003, 32, 8);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; tube(black, [[0, 0, 0], [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0]], 0.002, 8, OUT, false); }
    black.noFrame();
    // débitmètre : deux bagues, le tube de verre est fait à part (acrylique)
    for (const y of [0.13, 0.33]) tube(alu, [[x0 - 0.12, y - 0.008, zc - w - 0.02], [x0 - 0.12, y + 0.008, zc - w - 0.02]], 0.011, 18);
    tube(acr, [[x0 - 0.12, 0.138, zc - w - 0.02], [x0 - 0.12, 0.322, zc - w - 0.02]], 0.008, 20, OUT, false);
  }
  // ── simulateur de pluie (famille « Ravines ») : caisson à aiguilles sur quatre montants ──
  if (spec.rain) {
    const top = 1.44;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(alu, [sx * (HX + 0.11), (top + 0.2) / 2, sz * (HZ + 0.1)], [0.0125, (top - 0.2) / 2, 0.0125], 0.003);
    for (const sx of [-1, 1]) box(alu, [sx * (HX + 0.11), top + 0.04, 0], [0.0125, 0.0125, HZ + 0.11], 0.003);
    for (const sz of [-1, 1]) box(alu, [0, top + 0.04, sz * (HZ + 0.1)], [HX + 0.12, 0.0125, 0.0125], 0.003);
    box(acr, [0, top + 0.01, 0], [HX + 0.08, 0.012, HZ + 0.06], 0.002);
    tube(steel, [[-HX - 0.11, top + 0.06, 0], [-HX - 0.2, top + 0.06, 0], [-HX - 0.2, 0.2, 0]], 0.006, 12);
  }
  return { alu: alu.out(), acr: acr.out(), steel: steel.out(), inox: inox.out(), black: black.out(), base: base.out() };
}

// Le portique (dans son repère : X = 0 au plan de la lame), sans la lame
export function buildGantry() {
  const alu = new Buffers(), steel = new Buffers(), black = new Buffers();
  const D = DIM;
  for (const s of [-1, 1]) {
    // chariot à galets sur le rail rond
    box(alu, [0, D.railY + 0.012, s * D.railZ], [0.045, 0.012, 0.022], 0.003);
    for (const dx of [-0.03, 0.03]) {
      black.frame([dx, D.railY + 0.002, s * D.railZ], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      torus(black, [0, 0, 0], 0.009, 0.004, 24, 8);
      black.noFrame();
    }
    // montant jusqu'à la poutre
    box(alu, [0, (D.railY + D.beamY) / 2 + 0.012, s * D.railZ], [0.015, (D.beamY - D.railY) / 2 + 0.006, 0.015], 0.003);
  }
  // poutre en profilé 60 × 30
  box(alu, [0, D.beamY + 0.015, 0], [0.03, 0.015, D.railZ + 0.03], 0.004);
  // moteur pas à pas et poulie (côté +Z), courroie crantée le long du rail
  box(black, [-0.05, D.beamY + 0.02, D.railZ + 0.02], [0.021, 0.021, 0.021], 0.004);
  tube(steel, [[-0.05, D.beamY + 0.02, D.railZ + 0.041], [-0.05, D.beamY + 0.02, D.railZ + 0.055]], 0.003, 10);
  // vérins de descente de la lame (corps sur la poutre)
  for (const s of [-1, 1]) box(black, [0, D.beamY - 0.025, s * (TABLE.Ly / 2 - 0.08)], [0.014, 0.025, 0.014], 0.003);
  return { alu: alu.out(), steel: steel.out(), black: black.out() };
}

// La lame-gabarit (dans son repère : bord bas = profil en travers P(y) du gabarit, Y = 0 à P = 0)
export function buildBlade(form) {
  const B = new Buffers();
  const D = DIM, n = 96, t = D.bladeT / 2, r = 0.0012;
  const zs = Array.from({ length: n + 1 }, (_, i) => -HZ + 0.002 + ((TABLE.Ly - 0.004) * i) / n);
  const bot = (z) => crossProfile(form, z + HZ);
  // faces avant et arrière
  for (const s of [-1, 1]) {
    const rows = [[], []];
    for (const z of zs) { rows[0].push(B.vert([s * t, bot(z) + r, z], [s, 0, 0], OUT)); rows[1].push(B.vert([s * t, D.bladeH, z], [s, 0, 0], OUT)); }
    B.grid(rows);
  }
  // tranche basse arrondie (elle touche le sable), tranche haute
  for (const [yy, sgn] of [[null, -1], [D.bladeH, 1]]) {
    const rows = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * Math.PI - Math.PI / 2, row = [];
      for (const z of zs) {
        const y0 = yy ?? bot(z) + r;
        row.push(B.vert([Math.sin(a) * t, y0 + sgn * Math.cos(a) * r, z], [Math.sin(a), sgn * Math.cos(a), 0], EDGE));
      }
      rows.push(row);
    }
    B.grid(rows);
  }
  for (const s of [-1, 1]) {
    const z = s * (HZ - 0.002);
    const y0 = bot(z - s * 0.002);
    const a = B.vert([-t, y0, z], [0, 0, s], EDGE), b = B.vert([t, y0, z], [0, 0, s], EDGE), c = B.vert([t, D.bladeH, z], [0, 0, s], EDGE), d = B.vert([-t, D.bladeH, z], [0, 0, s], EDGE);
    B.quad(a, b, c, d);
  }
  // tiges des vérins
  tube(B, [[0, D.bladeH, -(HZ - 0.08)], [0, D.bladeH + 0.13, -(HZ - 0.08)]], 0.004, 12, EDGE);
  tube(B, [[0, D.bladeH, HZ - 0.08], [0, D.bladeH + 0.13, HZ - 0.08]], 0.004, 12, EDGE);
  return B.out();
}

// La guillotine du déversoir (repère : son arête haute en Y = 0)
export function buildGate() {
  const B = new Buffers();
  box(B, [0, -0.06, 0], [0.003, 0.06, 0.055], 0.0015);
  return B.out();
}
// Le flotteur du débitmètre
export function buildFloat() {
  const B = new Buffers();
  sphere(B, [0, 0, 0], 0.006, 20, 12);
  return B.out();
}
