// Les machines, construites comme de vraies machines : chaque pièce portée par
// une autre (rail, bogie, colonne, traverse, chariot, coulisseau, tête), rien
// qui flotte. Finitions (attribut surf) : OUT peinture de la machine, IN acier
// nu ou inox, EDGE caoutchouc / plastique noir. Les pièces mobiles sont des
// maillages séparés, construits autour de leur pivot ; scene/machine.js les
// anime d'après machines.js.
//
//  - laser   : portique roulant (rails au sol, bogies, deux colonnes, traverse),
//              chariot sur la traverse, coulisseau vertical, tête laser à
//              hublot, câble de fibre et gaine d'aspiration ;
//  - sablage : plateau tournant (socle, couronne, plateau à rainures en T),
//              colonne, bras pivotant à coulisseau, buse et flexible, pot de
//              sablage ;
//  - bain    : cuve d'électrolyse à rebord roulé (anodes, barres, câbles,
//              coffret), couvercle en deux battants, portique de levage à
//              pieds en A, palan à chaîne, moufle et crochet, élingues.
import { Buffers, OUT, IN, EDGE, roundedBox, add, sub, mul, norm, cross, dot } from './mesh.js';
import { frame, slab, prism, revolve, loft, roundPoly, chainLink, hexPrism, bolt, washer, rivet } from './parts.js';

const { PI, cos, sin, abs, max, min, sqrt, atan2 } = Math;
const PAINT = OUT, STEEL = IN, RUBBER = EDGE;
const box = (B, c, h, r = 0.006, s = PAINT) => roundedBox(B, c, h, r, 2, s, s);
// chaîne de a à b : maillons de longueur L (ligne moyenne), rayon de courbure R,
// fil de rayon r ; chaque maillon tourne d'un quart de tour sur le précédent
// et passe dans lui : le pas est la longueur intérieure, L − 2r (moins un
// jeu), donc chaque maillon touche ses deux voisins
function chainRun(B, a, b, L, R, r, s = STEEL) {
  const d = sub(b, a), len = Math.hypot(...d), ax = norm(d);
  const pitch = L - 2 * r - 0.0008, n = Math.max(1, Math.ceil(len / pitch));
  const u = norm(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross(ax, u);
  for (let k = 0; k < n; k++) {
    const c = add(a, mul(ax, (k + 0.5) * pitch));
    const Y = k % 2 ? v : u;
    chainLink(B, { o: c, X: ax, Y, Z: cross(ax, Y) }, L, R, r, s, 20, 8);
  }
  return add(a, mul(ax, n * pitch));
}
// tube rond (tuyau, flexible) le long d'une polyligne lissée
const hose = (B, pts, r, s = RUBBER) => {
  // (Catmull-Rom pour une courbe souple)
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[min(pts.length - 1, i + 2)];
    for (let k = 0; k < 8; k++) { const t = k / 8, t2 = t * t, t3 = t2 * t; out.push([0, 1, 2].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); }
  }
  out.push(pts[pts.length - 1]);
  loft(B, out, () => [r, r], s, { nr: 12, up: [0, 1, 0], caps: true });
};
// profil d'I (poutrelle) extrudé selon un axe
const ibeam = (B, F, h, b, tw, tf, z0, z1, s = PAINT) => {
  const p = [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]];
  prism(B, F, roundPoly(p, [0.002, 0.002, 0.002, tf * 0.8, tf * 0.8, 0.002, 0.002, 0.002, 0.002, tf * 0.8, tf * 0.8, 0.002], 2), z0, z1, s, { smooth: 0.7, nz: 4 });
};
const wheelOn = (B, c, axis, R, w) => {
  revolve(B, frame(add(c, mul(axis, -w / 2)), axis), [[0, 0], [R * 0.6, 0], [R * 0.95, 0.002], [R, w * 0.2], [R, w * 0.8], [R * 0.95, w - 0.002], [R * 0.6, w], [0, w]], STEEL, { M: 24, smooth: 0.7 });
};

// ════════════════════════════════════════════════════════════════════════════
// Laser : portique roulant
// ════════════════════════════════════════════════════════════════════════════
function buildLaser(s) {
  const { lo, hi, zHead } = s;
  const half = max(abs(lo[0]), abs(hi[0])) + 0.75; // (colonnes hors du cadre des gros plans)
  const zb = zHead + 0.2; // plan des colonnes et de la traverse
  const beamY = hi[1] + 0.5, colH = beamY;
  const parts = {};
  // rails au sol, selon z, de part et d'autre de la pièce : le portique
  // arrive de derrière, par-dessus la pièce
  {
    const B = new Buffers();
    const z0 = -3.6, z1 = zb + 0.45;
    for (const sx of [-1, 1]) for (const dx of [-0.11, 0.11]) {
      prism(B, { o: [sx * half + dx, 0, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, roundPoly([[-0.04, 0], [0.04, 0], [0.04, 0.007], [0.01, 0.014], [0.01, 0.04], [0.022, 0.045], [0.022, 0.062], [-0.022, 0.062], [-0.022, 0.045], [-0.01, 0.04], [-0.01, 0.014], [-0.04, 0.007]], 0.003, 2), z0, z1, STEEL, { smooth: 0.7, nz: 10 });
    }
    for (const sx of [-1, 1]) for (let z = z0 + 0.15; z <= z1 - 0.1; z += 0.6) box(B, [sx * half, 0.004, z], [0.2, 0.004, 0.05], 0.003, PAINT);
    // butées en bout de voie
    for (const sx of [-1, 1]) box(B, [sx * half, 0.05, z1 + 0.02], [0.16, 0.05, 0.03], 0.008, PAINT);
    parts.rails = B.out();
  }
  // portique (se déplace selon x) : bogies, colonnes, traverse, chaîne porte-câbles
  {
    const B = new Buffers();
    for (const sx of [-1, 1]) {
      const x = sx * half;
      // bogie : caisson + 4 galets sur les deux rails
      box(B, [x, 0.13, zb], [0.17, 0.05, 0.3], 0.012);
      for (const dx of [-0.11, 0.11]) for (const dz of [-0.2, 0.2]) wheelOn(B, [x + dx, 0.1, zb + dz], [1, 0, 0], 0.038, 0.03);
      // colonne : caisson carré à congés
      box(B, [x, 0.18 + (colH - 0.18) / 2, zb], [0.075, (colH - 0.18) / 2, 0.075], 0.014);
      // goussets de pied
      for (const dz of [-1, 1]) slab(B, { o: [x, 0, zb + dz * 0.075], X: [0, 0, dz], Y: [0, 1, 0], Z: [1, 0, 0] }, roundPoly([[0, 0.18], [0.2, 0.18], [0, 0.5]], 0.01, 2), 0.012, 0.003, PAINT);
    }
    // traverse : poutre-caisson + rail de guidage du chariot
    box(B, [0, beamY + 0.09, zb], [half + 0.1, 0.09, 0.08], 0.012);
    prism(B, { o: [0, beamY + 0.02, zb + 0.085], X: [0, 0, 1], Y: [0, 1, 0], Z: [-1, 0, 0] }, roundPoly([[0, -0.015], [0.022, -0.015], [0.022, 0.015], [0, 0.015]], 0.003, 2), -half, half, STEEL, { nz: 4 });
    // chaîne porte-câbles sur la traverse (maillons)
    for (let x = -half + 0.08; x < half - 0.05; x += 0.045) box(B, [x, beamY + 0.2, zb - 0.02], [0.019, 0.022, 0.05], 0.004, RUBBER);
    // coffret de commande sur une colonne
    box(B, [-half - 0.13, 1.05, zb], [0.06, 0.2, 0.15], 0.01);
    box(B, [-half - 0.2, 1.12, zb], [0.012, 0.02, 0.02], 0.004, RUBBER);
    parts.portal = B.out();
  }
  // chariot (se déplace selon x sur la traverse), centré en x = 0
  {
    const B = new Buffers();
    box(B, [0, beamY + 0.09, zb + 0.12], [0.13, 0.12, 0.045], 0.01);
    for (const dx of [-0.08, 0.08]) wheelOn(B, [dx, beamY + 0.02, zb + 0.105], [0, 0, 1], 0.024, 0.02);
    // guide du coulisseau
    box(B, [0, beamY + 0.09, zb + 0.2], [0.06, 0.14, 0.035], 0.008, STEEL);
    parts.carriage = B.out();
  }
  // coulisseau vertical + tête (se déplace selon y) ; origine : la ligne de
  // balayage (point visé sur la face de la pièce), la tête est en z = zHead
  {
    const B = new Buffers();
    const mastL = beamY - lo[1] + 0.35;
    // (le mât descend du chariot jusqu'à la tête ; il est tenu par le guide)
    box(B, [0, 0.2 + mastL / 2 - 0.1, zb + 0.2], [0.035, mastL / 2, 0.025], 0.008, STEEL);
    // console en L vers la pièce
    box(B, [0, 0.12, (zHead + zb + 0.2) / 2 + 0.06], [0.04, 0.03, (zb + 0.2 - zHead) / 2 + 0.02], 0.008);
    // tête : corps cylindrique à ailettes, hublot, buse d'air
    const Fh = frame([0, 0, zHead + 0.26], [0, 0, -1], [1, 0, 0]);
    const prof = [[0, 0], [0.05, 0]];
    for (let k = 0; k < 7; k++) prof.push([0.05, 0.02 + k * 0.022], [0.058, 0.026 + k * 0.022], [0.058, 0.034 + k * 0.022], [0.05, 0.038 + k * 0.022]);
    prof.push([0.05, 0.19], [0.045, 0.2], [0.03, 0.235], [0.026, 0.26], [0, 0.26]);
    revolve(B, Fh, prof, STEEL, { M: 32, smooth: 0.4 });
    revolve(B, frame([0, 0, zHead + 0.003], [0, 0, 1]), [[0, 0], [0.024, 0], [0.024, 0.002], [0, 0.002]], RUBBER, { M: 24 });
    // câble de fibre (gaine) et flexible d'aspiration qui remontent le long du mât
    hose(B, [[0.03, 0.06, zHead + 0.25], [0.06, 0.1, zHead + 0.33], [0.07, 0.4, zb + 0.15], [0.06, mastL - 0.15, zb + 0.16]], 0.011, RUBBER);
    hose(B, [[-0.04, -0.02, zHead + 0.06], [-0.09, 0.05, zHead + 0.1], [-0.1, 0.4, zb + 0.12], [-0.07, mastL - 0.15, zb + 0.15]], 0.022, RUBBER);
    revolve(B, frame([-0.04, -0.02, zHead + 0.06], norm([0.4, 0.5, -1])), [[0.024, 0], [0.03, 0], [0.03, 0.04], [0.024, 0.04]], RUBBER, { M: 16 });
    parts.head = B.out();
  }
  return { parts, info: { half, zb, beamY } };
}

// ════════════════════════════════════════════════════════════════════════════
// Sablage : plateau tournant, colonne, bras, buse
// ════════════════════════════════════════════════════════════════════════════
function buildBlast(s) {
  const { rMax, hi, lo, platen } = s;
  const Rp = rMax + 0.08, top = platen;
  const parts = {};
  // socle du plateau (fixe)
  {
    const B = new Buffers();
    revolve(B, frame([0, 0, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [Rp * 0.55, 0], [Rp * 0.56, 0.01], [Rp * 0.5, 0.03], [Rp * 0.45, top - 0.09], [Rp * 0.42, top - 0.07], [0, top - 0.07]], PAINT, { M: 64, smooth: 0.5 });
    // carter du moteur et couronne
    box(B, [Rp * 0.45 + 0.12, 0.13, 0], [0.13, 0.11, 0.11], 0.015);
    revolve(B, frame([Rp * 0.45 + 0.12, 0.13, 0.11], [0, 0, 1]), [[0, 0], [0.07, 0], [0.07, 0.08], [0.06, 0.09], [0, 0.09]], STEEL, { M: 24, smooth: 0.6 });
    parts.base = B.out();
  }
  // plateau (tourne avec la pièce) : disque épais à rainures en T
  {
    const B = new Buffers();
    revolve(B, frame([0, top - 0.07, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [Rp * 0.42, 0], [Rp * 0.44, 0.01], [Rp - 0.006, 0.012], [Rp, 0.02], [Rp, 0.064], [Rp - 0.006, 0.07], [0, 0.07]], STEEL, { M: 128, smooth: 0.5 });
    // rainures : barrettes sombres (fonds de rainure) en étoile
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * PI;
      const F = { o: [0, top + 0.0006, 0], X: [cos(a), 0, sin(a)], Y: [-sin(a), 0, cos(a)], Z: [0, 1, 0] };
      slab(B, F, roundPoly([[-Rp + 0.03, -0.007], [Rp - 0.03, -0.007], [Rp - 0.03, 0.007], [-Rp + 0.03, 0.007]], 0.006, 2), 0.0014, 0.0006, RUBBER);
    }
    parts.platen = B.out();
  }
  // colonne (fixe), à l'azimut de la buse, hors du plateau
  const Rc = Rp + 0.35, H = top + hi[1] + 0.45;
  {
    const B = new Buffers();
    box(B, [Rc, 0.02, 0], [0.22, 0.02, 0.22], 0.006);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bolt(B, [Rc + dx * 0.17, 0.04, dz * 0.17], [0, 1, 0], [Rc + dx * 0.17, 0.0, dz * 0.17], [0, -1, 0], 0.016, STEEL, { washers: true, headHex: false });
    revolve(B, frame([Rc, 0.04, 0], [0, 1, 0], [1, 0, 0]), [[0, 0], [0.11, 0], [0.09, 0.03], [0.085, 0.05], [0.085, H - 0.06], [0.09, H - 0.04], [0.09, H - 0.01], [0.08, H], [0, H]], PAINT, { M: 48, smooth: 0.5 });
    // pot de sablage derrière la colonne : cuve sous pression, vanne, flexible
    const pc = [Rc + 0.25, 0, -0.55];
    revolve(B, frame(pc, [0, 1, 0], [1, 0, 0]), [[0, 0.08], [0.22, 0.08], [0.24, 0.14], [0.25, 0.25], [0.25, 0.75], [0.22, 0.88], [0.12, 0.95], [0.06, 0.97], [0.06, 1.0], [0, 1.0]], PAINT, { M: 48, smooth: 0.6 });
    for (let k = 0; k < 3; k++) { const a = (k / 3) * 2 * PI; box(B, [pc[0] + cos(a) * 0.19, 0.045, pc[2] + sin(a) * 0.19], [0.025, 0.045, 0.025], 0.006, PAINT); }
    revolve(B, frame([pc[0], 0.05, pc[2]], [0, 1, 0]), [[0, 0], [0.05, 0], [0.05, 0.05], [0, 0.05]], STEEL, { M: 16 });
    hose(B, [[pc[0] - 0.05, 0.06, pc[2] + 0.04], [pc[0] - 0.2, 0.03, pc[2] + 0.2], [Rc + 0.05, 0.03, -0.18], [Rc + 0.02, 0.15, -0.09]], 0.022, RUBBER);
    parts.column = B.out();
  }
  // bras (pivote autour de la colonne, coulisse en hauteur) ; origine : axe de
  // la colonne à la hauteur de la buse ; la buse vise −x (vers l'axe), inclinée
  {
    const B = new Buffers();
    const reach = Rc - (rMax + 0.16);
    box(B, [0, 0, 0], [0.13, 0.09, 0.13], 0.014); // coulisseau autour de la colonne
    box(B, [-reach / 2, 0.02, 0], [reach / 2, 0.035, 0.035], 0.01); // bras
    // porte-buse incliné vers le bas (tilt), buse en carbure, flexible
    const t = s.tilt, dir = [-cos(t), -sin(t), 0];
    const tip = [-reach, 0, 0];
    revolve(B, frame(add(tip, mul(dir, -0.17)), dir), [[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.07], [0.026, 0.09], [0.022, 0.15], [0.016, 0.17], [0.011, 0.171], [0, 0.171]], STEEL, { M: 24, smooth: 0.5 });
    revolve(B, frame(add(tip, mul(dir, -0.17)), mul(dir, -1)), [[0, 0], [0.03, 0], [0.03, 0.05], [0.025, 0.06], [0, 0.06]], RUBBER, { M: 20 });
    hose(B, [add(tip, mul(dir, -0.23)), [-reach + 0.05, 0.12, 0.05], [-reach / 2, 0.11, 0.07], [-0.1, 0.07, 0.11], [0.0, 0.1, 0.13]], 0.022, RUBBER);
    parts.arm = B.out();
    s.reach = reach;
  }
  return { parts, info: { Rp, Rc, H, top, reach: s.reach } };
}

// ════════════════════════════════════════════════════════════════════════════
// Bain : cuve, couvercle, portique de levage, palan, crochet, élingues
// ════════════════════════════════════════════════════════════════════════════
function buildBath(s) {
  const { tank: T, hook, lifts } = s;
  const parts = {};
  const x0 = T.cx - T.hx, x1 = T.cx + T.hx, z0 = T.cz - T.hz, z1 = T.cz + T.hz, tw = 0.012;
  // fosse : quatre parois et un fond sous le sol, cornière de rive au ras du
  // sol, anodes suspendues aux barres, coffret et câbles
  {
    const B = new Buffers();
    const D = T.depth;
    const wall = (o, X, len) => slab(B, { o, X, Y: [0, 1, 0], Z: cross(X, [0, 1, 0]) }, [[0, -D], [len, -D], [len, -0.005], [0, -0.005]], tw, 0.003, PAINT);
    wall([x0, 0, z1 + tw / 2], [1, 0, 0], x1 - x0); wall([x0, 0, z0 - tw / 2], [1, 0, 0], x1 - x0);
    wall([x0 - tw / 2, 0, z0], [0, 0, 1], z1 - z0); wall([x1 + tw / 2, 0, z0], [0, 0, 1], z1 - z0);
    box(B, [T.cx, -D - tw / 2, T.cz], [T.hx, tw / 2, T.hz], 0.003, PAINT);
    // cornière de rive (cadre au ras du sol)
    const rim = [[x0 - tw, z0 - tw], [x1 + tw, z0 - tw], [x1 + tw, z1 + tw], [x0 - tw, z1 + tw]];
    for (let i = 0; i < 4; i++) {
      const a = rim[i], b = rim[(i + 1) % 4], d = norm([b[0] - a[0], 0, b[1] - a[1]]), out = [d[2], 0, -d[0]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const c = [(a[0] + b[0]) / 2 + out[0] * 0.04, 0.004, (a[1] + b[1]) / 2 + out[2] * 0.04];
      box(B, c, [abs(d[0]) * (len / 2 + 0.08) + abs(d[2]) * 0.045, 0.006, abs(d[2]) * (len / 2 + 0.08) + abs(d[0]) * 0.045], 0.003, STEEL);
    }
    // anodes : plaques le long des grands côtés, pendues à des barres de cuivre
    for (const zz of [z0 + 0.05, z1 - 0.05]) {
      box(B, [T.cx, 0.026, zz], [T.hx - 0.05, 0.012, 0.012], 0.004, STEEL);
      for (let x = x0 + 0.2; x < x1 - 0.15; x += 0.4) { box(B, [x, -0.01, zz], [0.012, 0.03, 0.014], 0.003, STEEL); slab(B, { o: [x, 0, zz], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }, [[-0.15, -0.55], [0.15, -0.55], [0.15, -0.04], [-0.15, -0.04]], 0.006, 0.002, STEEL); }
    }
    // coffret d'alimentation derrière la fosse (hors du chemin du couvercle) et
    // ses deux câbles jusqu'à la barre arrière
    const cb = [T.cx + T.hx * 0.6, 0, z0 - 0.5];
    box(B, [cb[0], 0.32, cb[2]], [0.16, 0.3, 0.12], 0.012, PAINT);
    box(B, [cb[0], 0.5, cb[2] + 0.125], [0.05, 0.03, 0.006], 0.003, RUBBER);
    hose(B, [[cb[0] - 0.08, 0.36, cb[2] + 0.12], [cb[0] - 0.12, 0.08, cb[2] + 0.25], [cb[0] - 0.2, 0.025, z0 - 0.06], [cb[0] - 0.25, 0.04, z0 + 0.05]], 0.009, RUBBER);
    hose(B, [[cb[0] + 0.08, 0.36, cb[2] + 0.12], [cb[0] + 0.1, 0.08, cb[2] + 0.25], [cb[0] + 0.05, 0.025, z0 - 0.06], [cb[0], 0.04, z0 + 0.05]], 0.009, RUBBER);
    parts.tank = B.out();
  }
  // couvercle roulant : il glisse sur le côté sur quatre galets (repère :
  // centré sur la fosse, au ras du sol)
  {
    const B = new Buffers();
    const hz = T.hz + 0.05, hx = T.hx + 0.05;
    slab(B, { o: [0, 0.03, 0], X: [1, 0, 0], Y: [0, 0, 1], Z: [0, 1, 0] }, roundPoly([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]], 0.012, 2), 0.008, 0.003, PAINT);
    for (const x of [-hx * 0.5, 0, hx * 0.5]) box(B, [x, 0.046, 0], [0.015, 0.01, hz - 0.04], 0.004, PAINT);
    box(B, [-hx + 0.08, 0.06, 0], [0.012, 0.012, 0.12], 0.005, STEEL);
    for (const x of [-hx + 0.1, hx - 0.1]) for (const z of [-hz + 0.06, hz - 0.06]) { box(B, [x, 0.02, z], [0.03, 0.006, 0.02], 0.003, PAINT); wheelOn(B, [x, 0.014, z], [0, 0, 1], 0.014, 0.014); }
    parts.lid = B.out();
  }
  // portique de levage : deux pieds en A, poutrelle, palan
  const beamY = hook[1] + 0.95 + s.rest;
  {
    const B = new Buffers();
    const span = T.hx + 0.6;
    for (const sx of [-1, 1]) {
      const x = T.cx + sx * span;
      for (const dz of [-1, 1]) loft(B, [[x, 0.1, T.cz + dz * 0.75], [x, beamY - 0.12, T.cz + dz * 0.04]], () => [0.035, 0.035], PAINT, { nr: 12, caps: true });
      loft(B, [[x, 0.5, T.cz - 0.6], [x, 0.5, T.cz + 0.6]], () => [0.022, 0.022], PAINT, { nr: 10, caps: true });
      for (const dz of [-0.78, 0.78]) box(B, [x, 0.08, T.cz + dz], [0.06, 0.03, 0.06], 0.008, PAINT);
      for (const dz of [-0.78, 0.78]) wheelOn(B, [x, 0.035, T.cz + dz], [1, 0, 0], 0.035, 0.03);
      box(B, [x, beamY - 0.08, T.cz], [0.08, 0.05, 0.1], 0.01, PAINT);
    }
    ibeam(B, { o: [T.cx, beamY, T.cz], X: [0, 0, 1], Y: [0, 1, 0], Z: [-1, 0, 0] }, 0.16, 0.09, 0.008, 0.012, -span - 0.12, span + 0.12, PAINT);
    // palan : chariot sur la semelle, corps, roue à chaîne de manœuvre
    const hx = hook[0];
    box(B, [hx, beamY - 0.11, T.cz], [0.08, 0.04, 0.07], 0.008, PAINT);
    box(B, [hx, beamY - 0.25, T.cz], [0.11, 0.1, 0.09], 0.02, PAINT);
    revolve(B, frame([hx + 0.12, beamY - 0.25, T.cz], [1, 0, 0]), [[0, 0], [0.12, 0], [0.12, 0.02], [0, 0.02]], PAINT, { M: 32 });
    // chaîne de manœuvre : boucle qui pend de la roue (deux brins)
    for (const dz of [-0.11, 0.11]) chainRun(B, [hx + 0.15, beamY - 0.25 + dz * 0, T.cz + dz], [hx + 0.15, beamY - 1.45, T.cz + dz], 0.034, 0.008, 0.0035);
    parts.crane = B.out();
    s.beamY = beamY;
  }
  // moufle, crochet, élingues (se déplacent avec la pièce) ; repère de la pièce
  {
    const B = new Buffers();
    const [hxp, hy, hzp] = hook;
    // crochet (tore partiel) et moufle
    box(B, [hxp, hy + 0.17, hzp], [0.045, 0.06, 0.035], 0.012, PAINT);
    revolve(B, frame([hxp, hy + 0.08, hzp], [0, 1, 0]), [[0, 0], [0.02, 0], [0.02, 0.04], [0, 0.04]], STEEL, { M: 16 });
    const hk = [];
    for (let k = 0; k <= 16; k++) { const a = -PI / 2 + (k / 16) * PI * 1.35; hk.push([hxp + 0.045 * sin(a) * -1, hy + 0.0 - 0.045 * cos(a) + 0.045 * 0, hzp]); }
    loft(B, [[hxp + 0.0, hy + 0.08, hzp], ...hk], (i) => [0.014, 0.011], STEEL, { nr: 12, up: [0, 0, 1], caps: true });
    // élingues : chaînes du crochet aux pitons
    // élingues : chaînes de la manille du crochet aux pitons
    for (const lp of lifts) chainRun(B, [hxp, hy - 0.035, hzp], lp, 0.042, 0.009, 0.004);
    // chaîne de levage (vers le palan, longue : la part au-dessus du palan est masquée)
    chainRun(B, [hxp, hy + 0.225, hzp], [hxp, hy + 3.3, hzp], 0.044, 0.009, 0.004);
    parts.hook = B.out();
  }
  return { parts, info: { beamY: s.beamY } };
}

export function buildMachine(spec) {
  switch (spec.kind) {
    case 'laser': return buildLaser(spec);
    case 'sablage': return buildBlast(spec);
    case 'bain': return buildBath(spec);
    default: throw new Error(`machine inconnue : ${spec.kind}`);
  }
}
