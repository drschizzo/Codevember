// La machinerie du mirascope, dessinée comme des objets ordinaires (par-dessus
// le lancer de rayons, qui écrit sa profondeur) : un socle sous la coupe du
// bas, et l'appareil qui lève le couvercle — trois mécanismes :
//
//  crémaillère : pied de bois tourné ; potence de laiton à crémaillère, pignon
//                et manivelle ; bras à fourche qui pince le bord du couvercle.
//  vis         : socle de marbre ; trois tiges filetées autour des coupes,
//                entraînées ensemble par une chaîne sur trois pignons ; un
//                collier qui tient le couvercle monte sur leurs écrous.
//  poulies     : trépied de laiton ; potence haute dont la flèche porte une
//                araignée de trois poulies au-dessus de l'axe ; trois cordes
//                du bord du couvercle aux poulies, réunies en une seule qui
//                descend le long du mât jusqu'à un treuil à manivelle.
//
// Chaque pièce est portée par une autre ; ce qui bouge le fait de la levée L
// seule : la fourche, le collier, les cordes montent de L ; le pignon tourne
// de L/r, les tiges de 2π·L/pas, le tambour de L/r.
// Repère : axe des coupes en (0, 0), y vers le haut ; la machinerie est
// construite vers +x puis tournée de « yaw » autour de l'axe.
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, attribute, pow, mx_fractal_noise_float, positionLocal, smoothstep, mix, fract, sin, atan } from 'three/tsl';
import { Mesh, lathe } from '../gen/subjects.js';
import { PARAB } from '../gen/mirascope.js';
import { layout } from '../gen/layout.js';

export const SHELL = 0.0025; // (épaisseur des coupes, comme U.shell du lancer de rayons)
export const SCREW_PITCH = 0.002, PINION_R = 0.0075, DRUM_R = 0.006;

const BRASS = [205, 168, 98, 60], BRASS_D = [150, 112, 58, 90], STEEL = [150, 152, 158, 70], BLACK = [26, 24, 22, 120];
const WOOD = [92, 56, 32, 150], WOOD_D = [60, 36, 22, 170], CORD = [196, 184, 160, 230];


// ── pièces à arêtes adoucies : une arête vive n'accroche pas la lumière ──
// boîte aux arêtes arrondies (rayon b) : chaque face est une grille resserrée
// près des bords, projetée sur la boîte arrondie (normale = direction depuis
// la boîte intérieure)
function box(M, c, h, col, yaw = 0, tilt = [0, 0], bev = null) {
  const b = Math.min(bev ?? 0.0007, 0.35 * Math.min(h[0], h[1], h[2]));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt[0]), st = Math.sin(tilt[0]), cz = Math.cos(tilt[1]), sz = Math.sin(tilt[1]);
  const Rt = (v) => {
    let [x, y, z] = v;
    [y, z] = [y * ct - z * st, y * st + z * ct];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [x * cy + z * sy, y, -x * sy + z * cy];
  };
  const ticks = (H) => { const t = [-H, -H + b * 0.15, -H + b * 0.5, -H + b, H - b, H - b * 0.5, H - b * 0.15, H]; return t; };
  const faces = [[0, 1, 2], [0, 2, 1], [1, 2, 0], [1, 0, 2], [2, 0, 1], [2, 1, 0]];
  for (const [ax, ua, wa] of faces) for (const sgn of [-1, 1]) {
    if ((ax === 0 && ua === 2) || (ax === 1 && ua === 0) || (ax === 2 && ua === 1)) continue; // (une seule orientation par axe)
    const U = ticks(h[ua]), W = ticks(h[wa]), base = M.count;
    for (const u of U) for (const w of W) {
      const p = [0, 0, 0]; p[ax] = sgn * h[ax]; p[ua] = u; p[wa] = w;
      const q = p.map((v, k) => Math.max(-(h[k] - b), Math.min(h[k] - b, v)));
      let n = p.map((v, k) => v - q[k]); const L = Math.hypot(...n) || 1; n = n.map((v) => v / L);
      const pos = q.map((v, k) => v + n[k] * b);
      const wp = Rt(pos), wn = Rt(n);
      M.v([c[0] + wp[0], c[1] + wp[1], c[2] + wp[2]], wn, col);
    }
    const nW = W.length;
    // orientation : (ua × wa) doit pointer selon +ax·sgn
    const e = [0, 0, 0]; e[ua] = 1; const f2 = [0, 0, 0]; f2[wa] = 1;
    const cr = [e[1] * f2[2] - e[2] * f2[1], e[2] * f2[0] - e[0] * f2[2], e[0] * f2[1] - e[1] * f2[0]];
    const flip = cr[ax] * sgn < 0;
    for (let i = 0; i < U.length - 1; i++) for (let j = 0; j < nW - 1; j++) {
      const a = base + i * nW + j, bb = a + nW;
      if (flip) { M.t(a, a + 1, bb); M.t(a + 1, bb + 1, bb); } else { M.t(a, bb, a + 1); M.t(a + 1, bb, bb + 1); }
    }
  }
}
// cylindre (ou cône) entre deux points, extrémités chanfreinées et adoucies
function cyl(M, a, b, r0, r1, col, seg = 10, caps = true) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d), ax = d.map((v) => v / L);
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]];
  const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  const bv = caps ? Math.min(0.35 * Math.min(r0, r1), 0.0006, L * 0.3) : 0;
  const sl = (r0 - r1) / L;
  // profil (rayon, position le long de l'axe, normale radiale, normale axiale)
  const P = [];
  if (caps && r0 > 0) { P.push([0, 0, 0, -1], [r0 - bv, 0, 0.2, -1], [r0 - bv * 0.3, bv * 0.08, 0.7, -0.7], [r0, bv, 1, sl]); } else P.push([r0, 0, 1, sl]);
  if (caps && r1 > 0) { P.push([r1, L - bv, 1, sl], [r1 - bv * 0.3, L - bv * 0.08, 0.7, 0.7], [r1 - bv, L, 0.2, 1], [0, L, 0, 1]); } else P.push([r1, L, 1, sl]);
  const segs = Math.max(seg, 12), base = M.count;
  for (let k = 0; k <= segs; k++) {
    const t = (k / segs) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const rd = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s];
    for (const [r, z, nr, na] of P) {
      let n = [rd[0] * nr + ax[0] * na, rd[1] * nr + ax[1] * na, rd[2] * nr + ax[2] * na]; const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
      M.v([a[0] + ax[0] * z + rd[0] * r, a[1] + ax[1] * z + rd[1] * r, a[2] + ax[2] * z + rd[2] * r], n, col);
    }
  }
  const N = P.length;
  for (let k = 0; k < segs; k++) for (let j = 0; j < N - 1; j++) { const i = base + k * N + j; M.t(i, i + N, i + 1); M.t(i + 1, i + N, i + N + 1); }
}

// tube le long d'une ligne brisée (cordes, filets, chaîne)
function tube(M, pts, r, col, seg = 6, closed = false) {
  const n = pts.length, base = M.count;
  let prevU = null;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    let u = prevU ? prevU.clone().sub(t.clone().multiplyScalar(prevU.dot(t))) : new THREE.Vector3(0, 1, 0).cross(t);
    if (u.lengthSq() < 1e-8) u = new THREE.Vector3(1, 0, 0).cross(t);
    u.normalize(); prevU = u;
    const w = t.clone().cross(u);
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const nn = [u.x * c + w.x * s, u.y * c + w.y * s, u.z * c + w.z * s];
      M.v([pts[i][0] + nn[0] * r, pts[i][1] + nn[1] * r, pts[i][2] + nn[2] * r], nn, col);
    }
  }
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) for (let k = 0; k < seg; k++) {
    const a = base + i * (seg + 1) + k, b = base + ((i + 1) % n) * (seg + 1) + k;
    M.t(a, b, a + 1); M.t(a + 1, b, b + 1);
  }
}
// tore couché (axe y) de centre (x, y, z)
function ring(M, x, y, z, R, r, col, seg = 64) {
  const pts = [];
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; pts.push([x + R * Math.cos(a), y, z + R * Math.sin(a)]); }
  tube(M, pts, r, col, 10, true);
}
// pignon : disque et dents, d'axe donné (y ou z), centré en c
function gear(M, c, R, th, teeth, col, axis = 'y') {
  const A = axis === 'y' ? [0, th / 2, 0] : [0, 0, th / 2];
  cyl(M, [c[0] - A[0], c[1] - A[1], c[2] - A[2]], [c[0] + A[0], c[1] + A[1], c[2] + A[2]], R, R, col, 32);
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * Math.PI * 2;
    if (axis === 'y') box(M, [c[0] + Math.cos(a) * (R + 0.0006), c[1], c[2] + Math.sin(a) * (R + 0.0006)], [0.0007, th / 2, 0.00045], col, -a);
    else box(M, [c[0] + Math.cos(a) * (R + 0.0006), c[1] + Math.sin(a) * (R + 0.0006), c[2]], [0.0007, 0.00045, th / 2], col, 0, [0, a]);
  }
}
// bouton moleté d'axe z
function knurled(M, c, R, L, col, n = 28) {
  cyl(M, [c[0], c[1], c[2] - L / 2], [c[0], c[1], c[2] + L / 2], R, R, col, 40);
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; box(M, [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, c[2]], [0.00035, 0.00035, L / 2 - 0.0004], col, 0, [0, a]); }
}
// tête de vis fendue, posée sur une face de normale +y
function screwHead(M, x, y, z, r, col, a = 0.6) {
  lathe(M, x, z, [[0, y], [r, y], [r * 0.95, y + r * 0.35], [r * 0.6, y + r * 0.55], [0, y + r * 0.6]], col, 16);
  box(M, [x, y + r * 0.6, z], [r * 0.95, r * 0.12, r * 0.15], BLACK, a);
}

// ── les socles ──
function pedestalWood(M, W, f, TABLE_Y) {
  // pied tourné : base moulurée, balustre, coupelle qui épouse la coque du bas
  lathe(W, 0, 0, [[0, TABLE_Y], [0.036, TABLE_Y], [0.037, TABLE_Y + 0.002], [0.035, TABLE_Y + 0.0045], [0.03, TABLE_Y + 0.006], [0.028, TABLE_Y + 0.0075],
    [0.022, TABLE_Y + 0.009], [0.014, TABLE_Y + 0.012], [0.0105, TABLE_Y + 0.016], [0.0125, TABLE_Y + 0.018], [0.0105, TABLE_Y + 0.0205], [0.011, TABLE_Y + 0.022],
    ...[0.019, 0.015, 0.01, 0.005, 0].map((r) => [r, (r * r) / (4 * f) - SHELL])], WOOD, 64);
  lathe(M, 0, 0, [[0.0192, (0.019 ** 2) / (4 * f) - SHELL - 0.0016], [0.0196, (0.019 ** 2) / (4 * f) - SHELL - 0.0008], [0.0192, (0.019 ** 2) / (4 * f) - SHELL]], BRASS, 64); // (bague)
}
function pedestalMarble(S, M, f, TABLE_Y, Rp) {
  // socle de marbre rond, mouluré ; colonnette de laiton et coupelle
  lathe(S, 0, 0, [[0, TABLE_Y], [Rp, TABLE_Y], [Rp + 0.002, TABLE_Y + 0.003], [Rp + 0.002, TABLE_Y + 0.009], [Rp, TABLE_Y + 0.011], [Rp - 0.004, TABLE_Y + 0.012], [0, TABLE_Y + 0.012]], [235, 230, 222, 40], 96);
  const y0 = TABLE_Y + 0.012;
  lathe(M, 0, 0, [[0, y0], [0.016, y0], [0.0155, y0 + 0.002], [0.009, y0 + 0.004], [0.0065, y0 + 0.008], [0.0075, y0 + 0.011], [0.0062, y0 + 0.013],
    ...[0.014, 0.01, 0.005, 0].map((r) => [r, (r * r) / (4 * f) - SHELL])], BRASS, 48);
}
function pedestalTripod(M, f, TABLE_Y) {
  // trépied : collier sous la coupe, trois pieds galbés à boules
  const yc = -SHELL - 0.004;
  lathe(M, 0, 0, [[0, yc - 0.004], [0.012, yc - 0.004], [0.013, yc], [0.0125, yc + 0.0025], ...[0.012, 0.006, 0].map((r) => [r, (r * r) / (4 * f) - SHELL])], BRASS, 48);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6, c = Math.cos(a), s = Math.sin(a), pts = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, r = 0.011 + 0.045 * t, y = yc - 0.002 - (yc - 0.002 - (TABLE_Y + 0.003)) * Math.pow(t, 0.7) + 0.004 * Math.sin(Math.PI * t); pts.push([c * r, y, s * r]); }
    tube(M, pts, 0.0022, BRASS, 10);
    lathe(M, c * 0.056, s * 0.056, [[0, TABLE_Y], [0.0028, TABLE_Y + 0.0006], [0.0034, TABLE_Y + 0.003], [0.0024, TABLE_Y + 0.0052], [0, TABLE_Y + 0.0056]], BRASS_D, 16);
  }
}

// les bords des coupes : un jonc à la jointure de chacune, et la lèvre de l'ouverture
function rims(Lo, Hi, f) {
  const R = PARAB.rimK * f, rh = PARAB.holeK * f, col = [235, 232, 226, 40];
  ring(Lo, 0, f / 2 - SHELL + 0.0011, 0, R + 0.0012, 0.0013, col, 128);
  ring(Hi, 0, f / 2 + SHELL + 0.0001, 0, R + 0.0012, 0.0013, col, 128);
  ring(Hi, 0, f - (rh * rh) / (4 * f) + SHELL / 2, 0, rh, 0.0013, col, 96);
}

export function buildMachine(kind, f, TABLE_Y) {
  const R = PARAB.rimK * f;
  const P = { metal: new Mesh(), wood: new Mesh(), stone: new Mesh(), cord: new Mesh(), lo: new Mesh() };
  const mov = {}; // pièces mobiles : { nom: { mesh: Mesh, metal, pivot, axe } }
  const mobile = (name, pivot = [0, 0, 0], axis = null) => (mov[name] = { M: new Mesh(), W: new Mesh(), pivot, axis });
  const hi = mobile('lid'); // (monte de L avec le couvercle)
  rims(P.lo, hi.M, f);

  if (kind === 'cremaillere') {
    pedestalWood(P.metal, P.wood, f, TABLE_Y);
    const { cx } = layout(kind, f);
    // socle de la potence : planche de noyer aux arêtes chanfreinées, vis
    box(P.wood, [cx, TABLE_Y + 0.004, 0], [0.026, 0.004, 0.022], WOOD_D);
    box(P.wood, [cx, TABLE_Y + 0.0085, 0], [0.024, 0.0005, 0.02], WOOD_D);
    for (const [dx, dz] of [[-0.019, -0.015], [0.019, -0.015], [-0.019, 0.015], [0.019, 0.015]]) screwHead(P.metal, cx + dx, TABLE_Y + 0.009, dz, 0.0016, BRASS_D, dx * 40);
    // embase, colonne, chapeau
    lathe(P.metal, cx, 0, [[0.012, TABLE_Y + 0.009], [0.0125, TABLE_Y + 0.011], [0.011, TABLE_Y + 0.013], [0.008, TABLE_Y + 0.016], [0.0072, TABLE_Y + 0.02], [0.0065, TABLE_Y + 0.022]], BRASS, 40);
    cyl(P.metal, [cx, TABLE_Y + 0.021, 0], [cx, 0.17, 0], 0.0062, 0.0058, BRASS, 32);
    lathe(P.metal, cx, 0, [[0.0062, 0.166], [0.0085, 0.169], [0.009, 0.172], [0.0065, 0.176], [0.003, 0.179], [0, 0.18]], BRASS, 32);
    // crémaillère : barre plate et dents
    box(P.metal, [cx + 0.0068, 0.08, 0], [0.0009, 0.09, 0.0024], BRASS_D);
    for (let k = 0; k < 68; k++) box(P.metal, [cx + 0.0081, -0.006 + k * 0.0025, 0], [0.0007, 0.00055, 0.0022], BRASS);
    // bras : coulisseau à vis de serrage, potence, fourche qui pince le jonc du bord
    const yA = f / 2 + 0.006;
    box(hi.M, [cx, yA, 0], [0.0105, 0.012, 0.0105], BRASS);
    box(hi.M, [cx, yA + 0.012, 0], [0.011, 0.0008, 0.011], BRASS_D);
    box(hi.M, [cx, yA - 0.012, 0], [0.011, 0.0008, 0.011], BRASS_D);
    cyl(hi.M, [cx + 0.0105, yA + 0.004, 0], [cx + 0.017, yA + 0.004, 0], 0.0012, 0.0012, STEEL, 12);
    cyl(hi.M, [cx + 0.017, yA + 0.004, -0.004], [cx + 0.017, yA + 0.004, 0.004], 0.0011, 0.0011, STEEL, 12);
    cyl(hi.M, [cx - 0.004, yA + 0.006, 0], [R + 0.014, yA + 0.006, 0], 0.0034, 0.0034, BRASS, 20);
    lathe(hi.M, R + 0.014, 0, [[0, yA + 0.002], [0.0045, yA + 0.002], [0.0045, yA + 0.01], [0, yA + 0.01]], BRASS, 20);
    for (const s of [-1, 1]) {
      const a = s * 0.5, ex = (R + 0.004) * Math.cos(a), ez = (R + 0.004) * Math.sin(a);
      cyl(hi.M, [R + 0.014, yA + 0.006, 0], [ex, yA + 0.004, ez], 0.0024, 0.0024, BRASS, 14);
      // mâchoire : deux lèvres de part et d'autre du jonc, garnies de feutre
      box(hi.M, [(R + 0.003) * Math.cos(a), f / 2 + 0.0032, (R + 0.003) * Math.sin(a)], [0.0032, 0.0006, 0.0028], BRASS_D, -a);
      box(hi.M, [(R + 0.003) * Math.cos(a), f / 2 - 0.0005, (R + 0.003) * Math.sin(a)], [0.0032, 0.0006, 0.0028], BRASS_D, -a);
      box(hi.M, [(R + 0.0055) * Math.cos(a), f / 2 + 0.0014, (R + 0.0055) * Math.sin(a)], [0.0008, 0.0024, 0.0028], BRASS_D, -a);
      cyl(hi.M, [ex, yA + 0.004, ez], [(R + 0.005) * Math.cos(a), f / 2 + 0.0038, (R + 0.005) * Math.sin(a)], 0.0018, 0.0018, BRASS, 12);
    }
    // pignon porté par le coulisseau, en prise sur la crémaillère : il roule
    // dessus quand on tourne la manivelle (le tout monte de L, tourne de L/r)
    const kx = cx + 0.0088 + PINION_R;
    box(hi.M, [kx - 0.002, yA, 0.0118], [0.009, 0.0095, 0.0012], BRASS_D); // (flasque du palier)
    const kn = mobile('knob', [kx, yA, 0], 'z');
    gear(kn.M, [0, 0, 0], PINION_R - 0.0006, 0.004, 14, BRASS, 'z');
    cyl(kn.M, [0, 0, 0], [0, 0, 0.014], 0.0016, 0.0016, STEEL, 12);
    knurled(kn.M, [0, 0, 0.018], 0.0068, 0.008, BRASS);
    cyl(kn.M, [0, 0, 0.022], [0.019, 0, 0.0235], 0.0018, 0.0016, BRASS, 12);
    cyl(kn.W, [0.019, 0, 0.0235], [0.019, 0, 0.0255], 0.0012, 0.0012, STEEL, 10);
    const hp = [[0.0026, 0], [0.0032, 0.003], [0.0034, 0.008], [0.0026, 0.012], [0, 0.0125]];
    for (let i = 0; i < hp.length - 1; i++) cyl(kn.W, [0.019, 0, 0.0255 + hp[i][1]], [0.019, 0, 0.0255 + hp[i + 1][1]], hp[i][0], hp[i + 1][0], WOOD, 14);
    kn.rides = true; // (monte avec le couvercle)
  } else if (kind === 'vis') {
    const { Rc } = layout(kind, f), Rp = Rc + 0.016;
    pedestalMarble(P.stone, P.metal, f, TABLE_Y, Rp);
    // trois tiges filetées ; en bas, au ras du marbre, un pignon sur chacune et
    // la chaîne qui les entraîne ensemble ; en haut, un fleuron, et sur la
    // première la manivelle
    const yTop = 0.118, yG = TABLE_Y + 0.019;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2, x = Rc * Math.cos(a), z = Rc * Math.sin(a);
      lathe(P.metal, x, z, [[0.0085, TABLE_Y + 0.012], [0.0088, TABLE_Y + 0.0135], [0.0062, TABLE_Y + 0.015], [0.0048, TABLE_Y + 0.0165]], BRASS, 32); // (embase)
      const sc = mobile(`screw${k}`, [x, 0, z], 'y');
      cyl(sc.M, [0, TABLE_Y + 0.016, 0], [0, yTop, 0], 0.0034, 0.0034, STEEL, 20);
      const hel = [];
      for (let t = 0; t <= ((yTop - 0.004 - (yG + 0.004)) / SCREW_PITCH) * 24; t++) { const th = (t / 24) * Math.PI * 2, y = yG + 0.004 + (t / 24) * SCREW_PITCH; hel.push([0.0037 * Math.cos(th), y, 0.0037 * Math.sin(th)]); }
      tube(sc.M, hel, 0.00055, STEEL, 5);
      gear(sc.M, [0, yG, 0], 0.0072, 0.003, 18, BRASS, 'y');
      // fleuron
      lathe(sc.M, 0, 0, [[0.0036, yTop], [0.0048, yTop + 0.0015], [0.0042, yTop + 0.004], [0.0022, yTop + 0.0065], [0.0026, yTop + 0.008], [0, yTop + 0.0095]], BRASS, 20);
      // écrou à six pans et bras du collier (montent avec le couvercle)
      const yN = f / 2 + 0.006;
      cyl(hi.M, [x, yN - 0.004, z], [x, yN + 0.004, z], 0.0068, 0.0068, BRASS, 6);
      cyl(hi.M, [x * 0.93, yN, z * 0.93], [(R + 0.009) * Math.cos(a), f / 2 + 0.004, (R + 0.009) * Math.sin(a)], 0.0024, 0.0024, BRASS, 12);
    }
    // collier qui embrasse le jonc du couvercle
    ring(hi.M, 0, f / 2 + 0.004, 0, R + 0.0085, 0.0022, BRASS, 128);
    ring(hi.M, 0, f / 2 + 0.001, 0, R + 0.0085, 0.0012, BRASS_D, 128);
    // la chaîne : une boucle tendue autour des trois pignons
    const chain = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      for (let j = 0; j <= 20; j++) { const b = a - Math.PI / 3 + (j / 20) * (2 * Math.PI / 3); chain.push([Rc * Math.cos(a) + 0.008 * Math.cos(b), yG, Rc * Math.sin(a) + 0.008 * Math.sin(b)]); }
    }
    tube(P.cord, chain, 0.0008, [60, 58, 55, 90], 5, true);
    // manivelle au sommet de la première tige
    const sc0 = mov.screw0;
    cyl(sc0.M, [0, yTop + 0.009, 0], [0.017, yTop + 0.011, 0], 0.0016, 0.0014, BRASS, 12);
    cyl(sc0.W, [0.017, yTop + 0.011, 0], [0.017, yTop + 0.025, 0], 0.0026, 0.0022, WOOD, 14);
  } else {
    pedestalTripod(P.metal, f, TABLE_Y);
    const { px, yS } = layout(kind, f);
    // mât : semelle de bois, pied, colonne ; flèche horizontale ; araignée à trois poulies
    box(P.wood, [px, TABLE_Y + 0.004, 0], [0.024, 0.004, 0.024], WOOD_D);
    lathe(P.metal, px, 0, [[0.012, TABLE_Y + 0.008], [0.0125, TABLE_Y + 0.01], [0.0095, TABLE_Y + 0.013], [0.0068, TABLE_Y + 0.02]], BRASS, 32);
    cyl(P.metal, [px, TABLE_Y + 0.019, 0], [px, yS + 0.02, 0], 0.0066, 0.006, BRASS, 28);
    lathe(P.metal, px, 0, [[0.006, yS + 0.019], [0.009, yS + 0.022], [0.0075, yS + 0.026], [0, yS + 0.028]], BRASS, 24);
    cyl(P.metal, [px, yS + 0.012, 0], [0, yS + 0.012, 0], 0.0032, 0.0032, BRASS, 16);
    cyl(P.metal, [px * 0.6, yS + 0.012, 0], [px - 0.004, yS - 0.02, 0], 0.0018, 0.0018, BRASS_D, 10); // (jambe de force)
    lathe(P.metal, 0, 0, [[0, yS + 0.006], [0.006, yS + 0.006], [0.0065, yS + 0.012], [0.005, yS + 0.018], [0, yS + 0.019]], BRASS, 24); // (moyeu)
    const pul = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 3, c = Math.cos(a), s = Math.sin(a), rr = R;
      cyl(P.metal, [c * 0.005, yS + 0.012, s * 0.005], [c * rr, yS + 0.012, s * rr], 0.0016, 0.0016, BRASS, 10);
      // chape et poulie (axe tangent)
      box(P.metal, [c * rr, yS + 0.008, s * rr], [0.0006, 0.005, 0.004], BRASS_D, -a + Math.PI / 2);
      const t = [-s, 0, c], pc = [c * rr, yS + 0.005, s * rr];
      cyl(P.metal, [pc[0] - t[0] * 0.0018, pc[1], pc[2] - t[2] * 0.0018], [pc[0] + t[0] * 0.0018, pc[1], pc[2] + t[2] * 0.0018], 0.0042, 0.0042, BRASS, 24);
      pul.push([c, s, rr, pc]);
      // corde : du sommet de la poulie au moyeu (fixe)
      tube(P.cord, [[c * rr, yS + 0.0095, s * rr], [c * 0.006, yS + 0.0095, s * 0.006]], 0.0005, CORD, 6);
      // œillet sur le jonc du couvercle
      lathe(hi.M, c * (R + 0.004), s * (R + 0.004), [[0, f / 2 + SHELL], [0.0018, f / 2 + SHELL], [0.0018, f / 2 + SHELL + 0.002], [0, f / 2 + SHELL + 0.002]], BRASS, 12);
      ring(hi.M, c * (R + 0.004), f / 2 + SHELL + 0.0032, s * (R + 0.004), 0.0014, 0.00045, BRASS, 16);
    }
    // corde unique : moyeu → long de la flèche → poulie du mât → tambour du treuil
    cyl(P.metal, [px - 0.002, yS + 0.012, -0.002], [px - 0.002, yS + 0.012, 0.002], 0.0045, 0.0045, BRASS, 24);
    tube(P.cord, [[0, yS + 0.016, 0], [px - 0.0065, yS + 0.0165, 0], [px - 0.0068, 0.04, 0]], 0.0006, CORD, 6);
    const dr = mobile('drum', [px - 0.012, 0.035, 0], 'z');
    cyl(dr.M, [0, 0, -0.008], [0, 0, 0.008], DRUM_R, DRUM_R, WOOD_D, 24);
    for (const z of [-0.0085, 0.0085]) cyl(dr.M, [0, 0, z - 0.0007], [0, 0, z + 0.0007], DRUM_R + 0.004, DRUM_R + 0.004, BRASS, 24);
    const coil = [];
    for (let t = 0; t <= 6 * 24; t++) { const th = (t / 24) * Math.PI * 2; coil.push([(DRUM_R + 0.0006) * Math.cos(th), (DRUM_R + 0.0006) * Math.sin(th), -0.006 + (t / (6 * 24)) * 0.012]); }
    tube(dr.M, coil, 0.0006, CORD, 5);
    cyl(dr.M, [0, 0, 0.0092], [0, 0, 0.012], 0.0014, 0.0014, STEEL, 10);
    cyl(dr.M, [0, 0, 0.012], [0.018, 0, 0.013], 0.0016, 0.0014, BRASS, 10);
    cyl(dr.W, [0.018, 0, 0.013], [0.018, 0, 0.027], 0.0028, 0.0024, WOOD, 14);
    // flasques du treuil sur le mât, cliquet
    for (const z of [-0.0115, 0.0115]) box(P.metal, [px - 0.006, 0.035, z], [0.009, 0.011, 0.0008], BRASS_D);
    box(P.metal, [px - 0.012, 0.035 + DRUM_R + 0.0065, 0.0095], [0.004, 0.0006, 0.0008], STEEL, 0.4);
    mov.cords = { pul, R, f, yS };
  }
  return { P, mov, kind };
}

// matériaux : le laiton est brossé (des stries fines dans un sens, une
// rugosité et une teinte qui varient un peu, comme une pièce manipulée) ;
// l'acier aussi, plus froid ; le bois est verni (vernis en couche claire) et a
// un fil — cernes et fibres ; le marbre est veiné
export function machineMaterial(kind) {
  const isWood = kind === 'wood';
  const m = isWood ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
  const a = attribute('mat', 'vec4');
  let col = pow(a.rgb, vec3(2.2));
  let rough = a.a.mul(0.9).add(0.06);
  const P = positionLocal;
  if (kind === 'stone') {
    const w = P.mul(30).add(mx_fractal_noise_float(P.mul(18), 3, 2, 0.5).mul(1.2));
    const n = mx_fractal_noise_float(w, 4, 2, 0.5);
    col = col.mul(float(1).sub(smoothstep(0.035, 0.0, n.abs()).mul(0.3)).sub(smoothstep(0.16, 0.0, n.abs()).mul(0.07)));
  } else if (isWood) {
    // fil vertical (pièces tournées et planches debout) ou horizontal : on
    // prend des cernes autour d'un axe incliné et des fibres le long de y et x
    const warp = mx_fractal_noise_float(P.mul(vec3(30, 6, 30)), 3, 2, 0.5).mul(0.004);
    const ring = fract(P.xz.add(vec2(0.013, -0.021)).length().add(P.y.mul(0.08)).add(warp).mul(420));
    const late = smoothstep(0.6, 0.9, ring).mul(float(1).sub(smoothstep(0.93, 1.0, ring)));
    const fib = mx_fractal_noise_float(P.mul(vec3(2400, 60, 2400)), 2, 2, 0.6).mul(0.12);
    col = col.mul(mix(float(1.12), float(0.7), late).add(fib));
    rough = rough.add(late.mul(0.08));
    m.clearcoatNode = float(0.55);
    m.clearcoatRoughnessNode = float(0.22);
  } else if (kind === 'metal') {
    // stries de brossage (le long de y, plus fines en travers), taches de
    // manipulation, teinte qui varie de quelques pour cent
    const brush = mx_fractal_noise_float(P.mul(vec3(5200, 90, 5200)), 2, 2, 0.5);
    const smudge = mx_fractal_noise_float(P.mul(160), 3, 2, 0.5);
    col = col.mul(smudge.mul(0.07).add(1)).mul(vec3(1, float(1).add(smudge.mul(0.02)), float(1).sub(smudge.mul(0.04))));
    rough = rough.add(brush.mul(0.07)).add(smudge.mul(0.06)).clamp(0.05, 1);
  } else if (kind === 'cord') {
    const tw = sin(P.y.mul(5000).add(atan(P.z, P.x).mul(3)));
    col = col.mul(tw.mul(0.1).add(0.95));
  }
  m.colorNode = col;
  m.roughnessNode = rough;
  m.metalnessNode = float(kind === 'metal' ? 1 : 0);
  return m;
}
