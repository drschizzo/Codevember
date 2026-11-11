// Géométrie des appareils — fonctions pures (worker, Node).
//
// Tout est construit en DÉCIMÈTRES (les motifs des finitions sont réglés
// pour des pièces de l'ordre de l'unité) ; la scène pose les maillages à
// l'échelle 0,1 (mètres). Repère : y vers le haut, surface de l'eau au repos
// en y = 0, fond intérieur en y = −H ; la vitre de face est en z = +D/2,
// côté caméra.
//
// Pièces rendues (chacune un maillage, une matière) :
//   shell   : parois et dalle de fond (extérieur de la cuve), socle
//   inner   : faces intérieures des parois (vues à travers l'eau)
//   frame   : cornières du bâti (arêtes), traverses
//   glass   : vitre de face (épaisse, chants)
//   rig     : batteur — poutres, vérins (fixes)
//   movers  : plongeurs (tige + coin), animés par le champ des ondes (attribut
//             foot : indice du point de la grille sous le plongeur, mobile 0/1)
//   extra   : famille — excitateur de Faraday, ou poteau et grille de Kármán
import { Buffers, roundedBox, tube, lathe, sphere, torus, OUT, IN, EDGE } from './mesh.js';

const D2 = (a) => a * 10; // m → dm

function plunger(B, x, z, nx, nz, H) {
  // coin (prisme triangulaire arrondi) qui plonge de 1,5 cm, tige, collier
  const w = 0.32, d = 0.16, h = 0.5;
  // repère : X le long de la paroi, Z vers l'intérieur
  const X = [-nz, 0, nx], Z = [-nx, 0, -nz], Y = [0, 1, 0];
  B.frame([x, -0.15 + h / 2, z], X, Y, Z);
  roundedBox(B, [0, 0, 0], [w / 2, h / 2, d / 2], 0.03, 30, EDGE, OUT);
  B.noFrame();
  tube(B, [[x, -0.15 + h, z], [x, 1.25, z]], 0.03, 12, EDGE);
  B.frame([x, 0.55, z], X, Y, Z);
  roundedBox(B, [0, 0, 0], [0.07, 0.05, 0.07], 0.02, 20, EDGE, OUT);
  B.noFrame();
}

export function buildApparatus({ family, W, D, H, rim, style, N, L, plungers = 10, karman = null }) {
  const w = D2(W) / 2, d = D2(D) / 2, hh = D2(H), r = D2(rim);
  const tw = style === 'stone' ? 0.6 : style === 'brass' ? 0.12 : 0.15; // épaisseur des parois
  const tb = style === 'stone' ? 0.6 : 0.3; // dalle de fond
  const shell = new Buffers(), inner = new Buffers(), frame = new Buffers(), glass = new Buffers();
  const rig = new Buffers(), movers = new Buffers(), extra = new Buffers();
  const fillet = style === 'stone' ? 0.12 : 0.02;

  // ── parois : arrière, gauche, droite (la face est vitrée) ──
  const yb = -hh - tb, yt = r; // bas de la dalle, haut des parois
  const wall = (c, h) => roundedBox(shell, c, h, fillet, 8, EDGE, OUT);
  wall([0, (yb + yt) / 2, -d - tw / 2], [w + tw, (yt - yb) / 2, tw / 2]);
  wall([-w - tw / 2, (yb + yt) / 2, 0.06], [tw / 2, (yt - yb) / 2, d + 0.06]);
  wall([w + tw / 2, (yb + yt) / 2, 0.06], [tw / 2, (yt - yb) / 2, d + 0.06]);
  // dalle de fond (son dessus 1 mm sous le fond peint : pas de z-fighting)
  wall([0, -hh - 0.01 - tb / 2, 0.06], [w + tw, tb / 2, d + 0.06]);
  // socle (meuble) sous la cuve
  roundedBox(shell, [0, yb - 3.2, 0.06], [w + tw + 0.15, 3.2, d + 0.3], 0.04, 4, EDGE, OUT);
  // faces intérieures (une feuille mince sur chaque paroi, vue à travers l'eau)
  const thin = 0.01;
  roundedBox(inner, [0, (-hh + yt) / 2, -d + thin], [w, (yt + hh) / 2, thin], 0.005, 8, OUT, OUT);
  roundedBox(inner, [-w + thin, (-hh + yt) / 2, 0], [thin, (yt + hh) / 2, d], 0.005, 8, OUT, OUT);
  roundedBox(inner, [w - thin, (-hh + yt) / 2, 0], [thin, (yt + hh) / 2, d], 0.005, 8, OUT, OUT);

  // ── vitre de face : 12 mm, posée entre les parois ──
  const gt = 0.12;
  roundedBox(glass, [0, (-hh + yt) / 2, d + gt / 2], [w, (yt + hh) / 2, gt / 2], 0.02, 6, EDGE, OUT);

  // ── bâti : cornières en L sur les arêtes ──
  const ang = style === 'stone' ? 0.0 : style === 'brass' ? 0.28 : 0.22, at = 0.03;
  if (ang > 0) {
    const Lx = (y, z, sy, sz) => { // cornière le long de x
      roundedBox(frame, [0, y + (sy * ang) / 2, z + (sz * at) / 2], [w + tw + at, ang / 2, at / 2], 0.012, 6, EDGE, OUT);
      roundedBox(frame, [0, y + (sy * at) / 2, z + (sz * ang) / 2], [w + tw + at, at / 2, ang / 2], 0.012, 6, EDGE, OUT);
    };
    const Ly = (x, z, sx, sz) => { // cornière verticale
      roundedBox(frame, [x + (sx * ang) / 2, (yb + yt) / 2, z + (sz * at) / 2], [ang / 2, (yt - yb) / 2 + at, at / 2], 0.012, 6, EDGE, OUT);
      roundedBox(frame, [x + (sx * at) / 2, (yb + yt) / 2, z + (sz * ang) / 2], [at / 2, (yt - yb) / 2 + at, ang / 2], 0.012, 6, EDGE, OUT);
    };
    const zf = d + gt; // devant de la vitre
    Lx(yt, zf, -1, 1); Lx(yb, zf, 1, 1); // traverses haute et basse de la face
    Ly(-w - tw, zf, 1, 1); Ly(w + tw, zf, -1, 1); // montants de face
    Ly(-w - tw, -d - tw, 1, -1); Ly(w + tw, -d - tw, -1, -1); // montants arrière
    // ceinture haute (sur le rebord des parois)
    roundedBox(frame, [0, yt + at / 2, -d - tw / 2], [w + tw, at / 2, tw / 2 + 0.04], 0.01, 6, EDGE, OUT);
    roundedBox(frame, [-w - tw / 2, yt + at / 2, 0.06], [tw / 2 + 0.04, at / 2, d + 0.06], 0.01, 6, EDGE, OUT);
    roundedBox(frame, [w + tw / 2, yt + at / 2, 0.06], [tw / 2 + 0.04, at / 2, d + 0.06], 0.01, 6, EDGE, OUT);
  } else {
    // pierre : margelle arrondie et cadre de bronze autour de la vitre
    roundedBox(frame, [0, yt + 0.12, -d - tw / 2], [w + tw + 0.1, 0.12, tw / 2 + 0.1], 0.1, 8, EDGE, OUT);
    roundedBox(frame, [-w - tw / 2, yt + 0.12, 0.06], [tw / 2 + 0.1, 0.12, d + 0.16], 0.1, 8, EDGE, OUT);
    roundedBox(frame, [w + tw / 2, yt + 0.12, 0.06], [tw / 2 + 0.1, 0.12, d + 0.16], 0.1, 8, EDGE, OUT);
    const zf = d + gt + 0.03;
    roundedBox(rig, [0, yt + 0.03, zf], [w + 0.05, 0.06, 0.04], 0.02, 8, EDGE, OUT);
    roundedBox(rig, [0, -hh - 0.03, zf], [w + 0.05, 0.06, 0.04], 0.02, 8, EDGE, OUT);
    roundedBox(rig, [-w - 0.02, (yt - hh) / 2, zf], [0.06, (yt + hh) / 2 + 0.06, 0.04], 0.02, 8, EDGE, OUT);
    roundedBox(rig, [w + 0.02, (yt - hh) / 2, zf], [0.06, (yt + hh) / 2 + 0.06, 0.04], 0.02, 8, EDGE, OUT);
  }

  // ── famille ──
  const feet = [];
  if (family === 'foyer') {
    // batteur : une poutre au-dessus de chaque paroi opaque (la face vitrée
    // reste dégagée pour le regard), des plongeurs régulièrement
    // espacés, à 2 cm de la paroi ; le coin plonge dans l'eau et suit la hauteur
    // de l'eau à sa place
    const by = 1.35, inset = 0.22;
    const sides = [
      { o: [0, -d + inset], t: [1, 0], n: [0, -1], len: 2 * w },
      { o: [-w + inset, 0], t: [0, 1], n: [-1, 0], len: 2 * d },
      { o: [w - inset, 0], t: [0, 1], n: [1, 0], len: 2 * d },
    ];
    for (const S of sides) {
      // poutre carrée et ses deux consoles posées sur le rebord
      const c = [S.o[0], by, S.o[1]];
      const half = S.len / 2 - 0.25;
      roundedBox(rig, c, [S.t[0] ? half : 0.09, 0.09, S.t[1] ? half : 0.09], 0.02, 6, EDGE, OUT);
      for (const s of [-1, 1]) {
        const px = S.o[0] + S.t[0] * s * (half - 0.1) + S.n[0] * (inset + tw / 2), pz = S.o[1] + S.t[1] * s * (half - 0.1) + S.n[1] * (inset + tw / 2);
        roundedBox(rig, [(px + S.o[0] + S.t[0] * s * (half - 0.1)) / 2, (by + yt) / 2, (pz + S.o[1] + S.t[1] * s * (half - 0.1)) / 2], [S.t[0] ? 0.05 : Math.abs(px - S.o[0]) / 2 + 0.05, (by - yt) / 2, S.t[1] ? 0.05 : Math.abs(pz - S.o[1]) / 2 + 0.05], 0.015, 6, EDGE, OUT);
      }
      for (let i = 0; i < plungers; i++) {
        const t = ((i + 0.5) / plungers - 0.5) * (S.len - 0.6);
        const x = S.o[0] + S.t[0] * t, z = S.o[1] + S.t[1] * t;
        // vérin fixe sur la poutre
        rig.frame([x, by + 0.25, z], [1, 0, 0], [0, 0, -1], [0, 1, 0]);
        lathe(rig, [
          { r: 0, z: -0.12, nr: 0, nz: -1, s: EDGE }, { r: 0.09, z: -0.12, nr: 0, nz: -1, s: EDGE },
          { r: 0.09, z: -0.12, nr: 1, nz: 0, s: OUT }, { r: 0.09, z: 0.2, nr: 1, nz: 0, s: OUT },
          { r: 0.09, z: 0.2, nr: 0, nz: 1, s: EDGE }, { r: 0.05, z: 0.22, nr: 0, nz: 1, s: EDGE }, { r: 0, z: 0.22, nr: 0, nz: 1, s: EDGE },
        ].map((q) => ({ r: q.r, z: q.z, nr: q.nr, nz: q.nz, s: q.s })), 20);
        rig.noFrame();
        // (le tour de vérin est tourné d'axe y : lathe construit autour de z)
        const n0 = movers.n;
        plunger(movers, x, z, S.n[0], S.n[1], hh);
        // indice du point de grille sous le coin (en m : x/10, z/10)
        const fx = Math.round(((x / 10) + L / 2) / (L / N) - 0.5), fz = Math.round(((z / 10) + L / 2) / (L / N) - 0.5);
        for (let k = n0; k < movers.n; k++) feet.push(fz * N + fx);
      }
    }
  } else if (family === 'faraday') {
    // excitateur : volant à excentrique et bielle, sur un bâti à gauche de la cuve
    const cx = -w - tw - 1.0, cy = yb + 0.9, cz = d * 0.2;
    roundedBox(extra, [cx, yb + 0.05, cz], [0.7, 0.05, 0.7], 0.02, 6, EDGE, OUT);
    roundedBox(extra, [cx + 0.25, (yb + cy) / 2 + 0.05, cz - 0.35], [0.06, (cy - yb) / 2, 0.06], 0.02, 6, EDGE, OUT);
    extra.frame([cx, cy, cz - 0.28], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    torus(extra, [0, 0, 0], 0.48, 0.07, 64, 14, EDGE);
    lathe(extra, [{ r: 0, z: -0.04, nr: 0, nz: -1, s: OUT }, { r: 0.44, z: -0.04, nr: 0, nz: -1, s: OUT }, { r: 0.44, z: 0.04, nr: 0, nz: 1, s: OUT }, { r: 0, z: 0.04, nr: 0, nz: 1, s: OUT }], 48);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; tube(extra, [[0, 0, 0], [Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0]], 0.025, 8, EDGE, false); }
    extra.noFrame();
    // moteur
    extra.frame([cx, cy, cz - 0.55], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    lathe(extra, [{ r: 0, z: -0.3, nr: 0, nz: -1, s: EDGE }, { r: 0.22, z: -0.3, nr: 0, nz: -1, s: EDGE }, { r: 0.22, z: -0.3, nr: 1, nz: 0, s: OUT }, { r: 0.22, z: 0.1, nr: 1, nz: 0, s: OUT }, { r: 0.22, z: 0.1, nr: 0, nz: 1, s: EDGE }, { r: 0, z: 0.1, nr: 0, nz: 1, s: EDGE }], 32);
    extra.noFrame();
    // ressorts sous la dalle (quatre hélices)
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pts = [];
      for (let k = 0; k <= 80; k++) { const t = k / 80, a = t * Math.PI * 2 * 6; pts.push([sx * (w - 0.4) + Math.cos(a) * 0.12, yb - 0.6 + t * 0.6, sz * (d - 0.4) + Math.sin(a) * 0.12]); }
      tube(extra, pts, 0.022, 8, EDGE);
    }
  } else if (family === 'karman' && karman) {
    // poteau poli, du fond au-dessus de l'eau
    const px = D2(karman.post[0]), pz = D2(karman.post[1]), pr = D2(karman.radius);
    extra.frame([px, 0, pz], [1, 0, 0], [0, 0, -1], [0, 1, 0]);
    lathe(extra, [
      { r: 0, z: -hh, nr: 0, nz: -1, s: EDGE }, { r: pr * 1.6, z: -hh, nr: 0, nz: -1, s: EDGE },
      { r: pr * 1.6, z: -hh, nr: 1, nz: 0, s: EDGE }, { r: pr * 1.6, z: -hh + 0.08, nr: 1, nz: 0, s: EDGE },
      { r: pr, z: -hh + 0.12, nr: 1, nz: 0, s: OUT }, { r: pr, z: r + 0.6, nr: 1, nz: 0, s: OUT },
      { r: pr, z: r + 0.6, nr: 0, nz: 1, s: EDGE }, { r: 0, z: r + 0.62, nr: 0, nz: 1, s: EDGE },
    ], 40);
    extra.noFrame();
    // traverse qui tient le poteau, posée sur les parois latérales (en z)
    roundedBox(extra, [px, r + 0.5, 0], [0.08, 0.06, d + tw], 0.02, 6, EDGE, OUT);
    // grille de tranquillisation à l'entrée (x = −w), déversoir à la sortie
    const gx = -w + 0.12;
    for (let k = -8; k <= 8; k++) roundedBox(extra, [gx, (-hh + 0.1) / 2, (k / 8.5) * d], [0.04, (hh + 0.1) / 2, 0.012], 0.006, 6, EDGE, OUT);
    for (let k = 0; k < 10; k++) roundedBox(extra, [gx, -hh + (k + 0.5) * (hh / 10), 0], [0.05, 0.012, d], 0.006, 6, EDGE, OUT);
    // tuyau d'arrivée (au-dessus de la paroi gauche)
    tube(extra, [[-w - tw - 1.2, 0.8, -d * 0.3], [-w - 0.2, 0.8, -d * 0.3], [-w + 0.05, 0.5, -d * 0.3], [-w + 0.05, -0.2, -d * 0.3]], 0.16, 16, OUT);
  }

  const out = { shell: shell.out(), inner: inner.out(), frame: frame.out(), glass: glass.out(), rig: rig.out(), extra: extra.out() };
  if (movers.n) { out.movers = movers.out(); out.movers.foot = new Float32Array(feet); }
  return out;
}
