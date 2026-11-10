// Le banc d'essai de torsion, construit dans le worker (fonctions pures).
//
// Une pièce d'instrument de cabinet de physique : socle de fonte sur quatre
// pieds, deux colonnes tournées à bagues, traverse à congés ; sous la traverse
// le mandrin à trois mors, au-dessus sa poulie, une courroie ronde et le moteur
// debout ; la roue-programme (compte-tours : un tour par boucle) dont les
// trois cames poussent une tige, qui abaisse le levier de la glissière ; la
// glissière tient le bras du balancier (pendule de torsion : moyeu, pince,
// bras à boules, tige qui coulisse dans la douille du socle).
//
// Repère : celui de la simulation (mètres, mandrin à l'origine, y vers le
// haut), multiplié par S ; le dessus de la table est à y = −TABLE (sim).
// Chaque corps mobile est construit autour de son pivot (son origine) ; la
// scène le place et l'anime.
import { Buffers, lathe, roundedBox, torus, tube, sphere, OUT, IN, EDGE, norm } from './mesh.js';
import { makePlan } from '../plan.js';

export const S = 4;          // unités de la scène par mètre
export const TABLE = 0.835;  // le dessus de la table, sous le mandrin (m)
export const GEO = {
  colX: 0.34, beamY0: 0.035, beamY1: 0.095, beamZ: 0.045, beamX: 0.42,
  pulleyY: 0.197, pulleyR: 0.06, motorX: -0.22, motorR: 0.02,
  wheel: { x: 0.2, y: 0.18, z: 0, R: 0.052 },
  rail: { x: 0.24, z: -0.012, pivotY: 0.022, len: 0.79, maxAngle: 0.14 },
  lever: { tipX: 0.2, len: 0.04 },
  push: { x: 0.2, travel: 0.0056 },
  arm: { len: 0.235, y: -0.025, knob: 0.008 },
  hubR: 0.024, hubH: 0.05, plateY0: -0.82, plateY1: -0.79,
};

const PI = Math.PI;
// repère d'une révolution d'axe vertical (lathe tourne autour de z local)
const upFrame = (B, o) => B.frame(o, [1, 0, 0], [0, 0, -1], [0, 1, 0]);
// profil tourné : [[r, y], …] (de bas en haut), coins arrondis de rayon rc ;
// les arrondis prennent la finition « tranche », les plats et les fûts la finition externe
function turned(B, o, pts, rc = 0.003, M = 64, flat = OUT, edge = EDGE) {
  const prof = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i === 0 || i === n - 1) { // (extrémités sur l'axe : la normale est verticale)
      const q = i === 0 ? pts[1] : pts[n - 2];
      const nz = i === 0 ? -1 : 1;
      prof.push({ r: p[0], z: p[1], nr: 0, nz, s: flat });
      if (p[0] > 0) prof.push({ r: p[0], z: p[1], nr: 0, nz, s: flat });
      void q;
      continue;
    }
    const a = pts[i - 1], c = pts[i + 1];
    const d1 = norm([p[0] - a[0], p[1] - a[1], 0]), d2 = norm([c[0] - p[0], c[1] - p[1], 0]);
    const turn = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]);
    if (turn < 0.05 || rc <= 0) {
      const nn = norm([d1[1] + d2[1], -(d1[0] + d2[0]), 0]);
      prof.push({ r: p[0], z: p[1], nr: nn[0], nz: nn[1], s: flat });
      continue;
    }
    // congé : arc entre les deux segments
    const k = 5, rr = Math.min(rc, 0.45 * Math.hypot(p[0] - a[0], p[1] - a[1]), 0.45 * Math.hypot(c[0] - p[0], c[1] - p[1]));
    const P0 = [p[0] - d1[0] * rr, p[1] - d1[1] * rr], P1 = [p[0] + d2[0] * rr, p[1] + d2[1] * rr];
    for (let j = 0; j <= k; j++) {
      const t = j / k;
      // bézier quadratique (P0, p, P1) : assez proche d'un arc, normales exactes de la courbe
      const x = (1 - t) * (1 - t) * P0[0] + 2 * t * (1 - t) * p[0] + t * t * P1[0];
      const y = (1 - t) * (1 - t) * P0[1] + 2 * t * (1 - t) * p[1] + t * t * P1[1];
      const dx = 2 * (1 - t) * (p[0] - P0[0]) + 2 * t * (P1[0] - p[0]), dy = 2 * (1 - t) * (p[1] - P0[1]) + 2 * t * (P1[1] - p[1]);
      const nn = norm([dy, -dx, 0]);
      prof.push({ r: Math.max(0, x), z: y, nr: nn[0], nz: nn[1], s: j === 0 || j === k ? flat : edge });
    }
  }
  // (sens : les normales doivent pointer vers l'extérieur ; le profil va de bas en haut
  // côté extérieur, donc normale = (dy, −dx) tournée à droite ; vérifiée sur le fût)
  upFrame(B, o);
  lathe(B, prof, M);
  B.noFrame();
}
// boîte arrondie (centre, demi-tailles)
const box = (B, c, h, r, s = OUT, e = EDGE, t = null) => roundedBox(B, c, h, r, 6, e, s, t);
// cylindre d'axe quelconque (tube droit fermé)
const rod = (B, a, b, r, nr = 20, s = OUT) => tube(B, [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b], r, nr, s, true);

// mise à l'échelle (mètres → unités de la scène)
function scaled(B) {
  const o = B.out();
  for (let i = 0; i < o.position.length; i++) o.position[i] *= S;
  return o;
}

// ── Les corps ────────────────────────────────────────────────────────────────
// Chaque fonction renvoie { rôle: maillage } ; rôles : frame (fonte), metal
// (laiton / nickel), accent, table.
function buildFrame() {
  const F = new Buffers(), Mt = new Buffers(), A = new Buffers();
  const g = GEO, yT = -TABLE;
  // pieds tournés
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) turned(Mt, [sx * 0.37, yT, sz * 0.105], [[0, 0], [0.018, 0], [0.018, 0.006], [0.012, 0.012], [0.014, g.plateY0 - yT], [0, g.plateY0 - yT]], 0.002, 32);
  // socle : plateau à moulure (deux gradins)
  box(F, [0, (g.plateY0 + g.plateY1) / 2 - 0.004, 0], [0.43, (g.plateY1 - g.plateY0) / 2 - 0.004, 0.13], 0.008);
  box(F, [0, g.plateY1 - 0.004, 0], [0.4, 0.006, 0.112], 0.005);
  // colonnes : embase, fût, bagues, chapiteau
  for (const sx of [-1, 1]) {
    const y0 = g.plateY1 + 0.002, y1 = g.beamY0;
    const H = y1 - y0;
    turned(F, [sx * g.colX, y0, 0], [[0, 0], [0.04, 0], [0.04, 0.012], [0.03, 0.022], [0.019, 0.04], [0.017, 0.06],
      [0.017, H * 0.33 - 0.01], [0.022, H * 0.33], [0.017, H * 0.33 + 0.01], [0.017, H * 0.66 - 0.01], [0.022, H * 0.66], [0.017, H * 0.66 + 0.01],
      [0.017, H - 0.05], [0.02, H - 0.03], [0.032, H - 0.012], [0.034, H], [0, H]], 0.003, 40);
    // bagues de laiton
    for (const t of [0.33, 0.66]) { upFrame(Mt, [sx * g.colX, y0 + H * t, 0]); torus(Mt, [0, 0, 0], 0.0225, 0.004, 48, 10, EDGE); Mt.noFrame(); }
  }
  // traverse
  box(F, [0, (g.beamY0 + g.beamY1) / 2, 0], [g.beamX, (g.beamY1 - g.beamY0) / 2, g.beamZ], 0.01);
  // chapeaux des colonnes sur la traverse (boulons)
  for (const sx of [-1, 1]) turned(Mt, [sx * g.colX, g.beamY1, 0], [[0, 0], [0.022, 0], [0.022, 0.008], [0.014, 0.014], [0, 0.016]], 0.002, 6, OUT, EDGE);
  // palier du mandrin (bossage traversant)
  turned(F, [0, g.beamY0 - 0.006, 0], [[0, 0], [0.042, 0], [0.042, g.beamY1 - g.beamY0 + 0.012], [0.03, g.beamY1 - g.beamY0 + 0.02], [0.03, 0.16 - g.beamY0], [0.026, 0.168 - g.beamY0], [0, 0.168 - g.beamY0]], 0.004, 48);
  // douille du balancier sur le socle (laiton)
  turned(Mt, [0, g.plateY1, 0], [[0, 0], [0.028, 0], [0.028, 0.006], [0.016, 0.014], [0.014, 0.05], [0.0055, 0.05], [0, 0.05]], 0.002, 40);
  // moteur debout : embase, carcasse, flasques, bornes
  const mx = g.motorX;
  turned(F, [mx, g.beamY1, 0], [[0, 0], [0.05, 0], [0.05, 0.008], [0.044, 0.014], [0.044, 0.07], [0.047, 0.074], [0.047, 0.082], [0.03, 0.09], [0.012, 0.094], [0, 0.094]], 0.003, 48);
  // carcasse ajourée : fenêtres sur le bobinage (accent cuivre)
  turned(A, [mx, g.beamY1 + 0.016, 0], [[0, 0], [0.0425, 0], [0.0425, 0.054], [0, 0.054]], 0.0, 48);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * PI;
    box(F, [mx + Math.cos(a) * 0.044, g.beamY1 + 0.043, Math.sin(a) * 0.044], [0.005, 0.03, 0.005], 0.002);
  }
  for (const sz of [-1, 1]) turned(Mt, [mx - 0.03, g.beamY1 + 0.074, sz * 0.025], [[0, 0], [0.006, 0], [0.006, 0.014], [0.004, 0.018], [0, 0.02]], 0.0015, 16);
  // support de la roue-programme : deux flasques et un carter de vis sans fin
  const W = g.wheel;
  for (const sz of [-1, 1]) box(F, [W.x, (g.beamY1 + W.y) / 2 + 0.006, sz * 0.03], [0.012, (W.y - g.beamY1) / 2 + 0.012, 0.004], 0.003);
  box(F, [0.1, g.beamY1 + 0.02, 0], [0.07, 0.02, 0.018], 0.006);
  // chape du pivot de la glissière (sous la traverse)
  const R = g.rail;
  for (const sz of [-1, 1]) box(F, [R.x, R.pivotY + 0.006, R.z + sz * 0.011], [0.012, 0.012, 0.003], 0.002);
  // guide du poussoir (douille traversant la traverse)
  turned(Mt, [g.push.x, g.beamY1, 0], [[0, 0], [0.008, 0], [0.008, 0.012], [0.005, 0.016], [0, 0.016]], 0.0015, 20);
  return { frame: scaled(F), metal: scaled(Mt), accent: scaled(A) };
}

// mandrin, broche et poulie (tournent avec θ autour de l'axe y)
function buildChuck() {
  const Mt = new Buffers(), F = new Buffers();
  // corps du mandrin
  turned(Mt, [0, -0.0005, 0], [[0, 0], [0.026, 0], [0.032, 0.008], [0.032, 0.026], [0.024, 0.032], [0.024, 0.034], [0, 0.034]], 0.003, 48);
  // trois mors (dépassent sous le corps, serrent la corde)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * 2 * PI, c = Math.cos(a), s = Math.sin(a);
    Mt.frame([c * 0.0105, -0.0035, s * 0.0105], [c, 0, s], [0, 1, 0], [-s, 0, c]);
    box(Mt, [0, 0, 0], [0.0045, 0.0035, 0.0045], 0.0012);
    Mt.noFrame();
    // vis de serrage
    Mt.frame([c * 0.031, 0.017, s * 0.031], [0, 1, 0], [-s, 0, c], [c, 0, s]);
    turned(Mt, [0, 0, 0], [[0, 0], [0.004, 0], [0.004, 0.004], [0, 0.005]], 0.001, 12);
    Mt.noFrame();
  }
  // broche (au-dessus de la traverse) et poulie à gorge
  turned(Mt, [0, 0.165, 0], [[0, 0], [0.012, 0], [0.012, 0.018], [0.058, 0.018], [0.062, 0.022], [0.062, 0.026], [0.054, 0.032], [0.062, 0.038], [0.062, 0.042], [0.058, 0.046], [0.016, 0.046], [0.016, 0.054], [0, 0.056]], 0.0015, 64);
  // rayons de la poulie (marques de rotation)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * 2 * PI + 0.4;
    F.frame([Math.cos(a) * 0.035, 0.212, Math.sin(a) * 0.035], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]);
    box(F, [0, 0, 0], [0.018, 0.0012, 0.0035], 0.001);
    F.noFrame();
  }
  return { metal: scaled(Mt), accent: scaled(F) };
}

// poulie du moteur (tourne : 3 θ)
function buildMotorPulley() {
  const Mt = new Buffers();
  turned(Mt, [0, 0.1805 - 0.0, 0], [[0, 0], [0.006, 0], [0.006, 0.006], [0.018, 0.006], [0.021, 0.009], [0.021, 0.012], [0.016, 0.017], [0.021, 0.022], [0.021, 0.025], [0.018, 0.028], [0.005, 0.028], [0, 0.03]], 0.001, 40);
  Mt.frame([0.012, 0.21, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  box(Mt, [0, 0, 0], [0.004, 0.0015, 0.002], 0.0008);
  Mt.noFrame();
  return { metal: scaled(Mt) };
}

// roue-programme : cames calculées d'après le plan (la levée de la came est
// l'ouverture de la barre, à chaque instant), cadran de graduations
export function camProfile(R, M = 720) {
  const plan = makePlan(R), N = plan.N;
  const lift = new Float32Array(M);
  for (let j = 0; j < M; j++) lift[j] = plan.camLift(j / M);
  return { lift, N };
}
function buildWheel(R) {
  const Mt = new Buffers(), A = new Buffers();
  const W = GEO.wheel, { lift } = camProfile(R), M = lift.length;
  // came : disque extrudé de rayon W.R + levée, épaisseur 1 cm, chants arrondis
  // (la tige appuie au point le plus bas de la roue : ψ = −π/2 dans le repère de la roue)
  const travel = GEO.push.travel, rows = [];
  const zs = [[-0.005, -1], [-0.0045, -0.5], [0.0045, 0.5], [0.005, 1]];
  for (let j = 0; j <= M; j++) {
    const jj = j % M, a = (jj / M) * 2 * PI - PI / 2;
    // la came lue à l'angle a (dans le repère de la roue, qui tourne de ψ) : levée au point bas quand ψ = j/M·2π
    const r = W.R + travel * lift[(M - jj) % M];
    const row = [];
    for (const [z, nz] of zs) row.push(Mt.vert([Math.cos(a) * r, Math.sin(a) * r, z], norm([Math.cos(a) * (1 - Math.abs(nz) * 0.7), Math.sin(a) * (1 - Math.abs(nz) * 0.7), nz * 0.7]), Math.abs(nz) > 0.9 ? OUT : EDGE));
    rows.push(row);
  }
  for (let j = 0; j < M; j++) for (let k = 0; k < 3; k++) Mt.quad(rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]);
  // flancs (disques)
  for (const [z, nz] of [[-0.005, -1], [0.005, 1]]) {
    const c = Mt.vert([0, 0, z], [0, 0, nz], OUT);
    const ring = [];
    for (let j = 0; j < M; j++) { const a = (j / M) * 2 * PI - PI / 2, r = (W.R + travel * lift[(M - j) % M]) * 0.985; ring.push(Mt.vert([Math.cos(a) * r, Math.sin(a) * r, z], [0, 0, nz], OUT)); }
    for (let j = 0; j < M; j++) Mt.tri(c, ring[j], ring[(j + 1) % M]);
  }
  // moyeu et axe
  Mt.frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  turned(Mt, [0, 0, -0.034], [[0, 0], [0.006, 0], [0.006, 0.068], [0, 0.068]], 0.001, 20);
  Mt.noFrame();
  // cadran émaillé devant (z > 0) : disque et graduations (un trait par tour du mandrin)
  const zc = 0.012;
  const ring = [], c = A.vert([0, 0, zc], [0, 0, 1], OUT);
  for (let j = 0; j < 96; j++) { const a = (j / 96) * 2 * PI; ring.push(A.vert([Math.cos(a) * 0.044, Math.sin(a) * 0.044, zc], [0, 0, 1], OUT)); }
  for (let j = 0; j < 96; j++) A.tri(c, ring[j], ring[(j + 1) % 96]);
  torus(A, [0, 0, zc], 0.044, 0.0022, 96, 10, EDGE);
  const N = camProfile(R, 8).N;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * PI - PI / 2, ca = Math.cos(a), sa = Math.sin(a);
    Mt.frame([ca * 0.038, sa * 0.038, zc + 0.0008], [ca, sa, 0], [-sa, ca, 0], [0, 0, 1]);
    box(Mt, [0, 0, 0], [0.004, 0.0008, 0.0006], 0.0003);
    Mt.noFrame();
  }
  // (rayons de la roue : derrière le cadran, entre came et moyeu)
  return { metal: scaled(Mt), accent: scaled(A) };
}

// levier, glissière et galet (pivotent autour de z au pivot)
function buildRail() {
  const Mt = new Buffers(), F = new Buffers();
  const R = GEO.rail, L = GEO.lever;
  // axe du pivot
  Mt.frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  turned(Mt, [0, 0, -0.012], [[0, 0], [0.004, 0], [0.004, 0.024], [0, 0.024]], 0.001, 16);
  Mt.noFrame();
  // glissière : barre plate qui descend du pivot jusqu'au-dessus du socle
  box(F, [0, -R.len / 2, 0], [0.006, R.len / 2, 0.003], 0.0015, OUT, EDGE, [0, 1, 0]);
  // tête et levier vers l'intérieur
  box(F, [0, 0, 0], [0.009, 0.009, 0.0045], 0.003);
  box(F, [-L.len / 2, 0, 0], [L.len / 2, 0.004, 0.003], 0.0015, OUT, EDGE, [1, 0, 0]);
  // ressort de rappel (hélice) entre le levier et la traverse
  const pts = [];
  for (let i = 0; i <= 160; i++) { const t = i / 160, a = t * 2 * PI * 8; pts.push([-0.02 + Math.cos(a) * 0.004, 0.004 + t * 0.008, Math.sin(a) * 0.004]); }
  tube(Mt, pts, 0.0007, 6, EDGE, true);
  return { metal: scaled(Mt), frame: scaled(F) };
}

// poussoir (translation verticale)
function buildPush() {
  const Mt = new Buffers();
  const g = GEO;
  // de la came (bas de la roue) jusqu'au levier
  const top = g.wheel.y - g.wheel.R, bot = g.rail.pivotY + 0.004;
  turned(Mt, [0, bot, 0], [[0, 0], [0.003, 0], [0.003, top - bot - 0.004], [0.0045, top - bot - 0.002], [0.0045, top - bot], [0, top - bot]], 0.0008, 16);
  return { metal: scaled(Mt) };
}

// balancier : moyeu, pince, bras à boules, tige (translation y, rotation φ)
function buildFly() {
  const Mt = new Buffers(), A = new Buffers();
  const g = GEO, h = g.hubH;
  // moyeu de laiton à gorges, pince (collet) au-dessus
  turned(Mt, [0, -h, 0], [[0, 0], [0.008, 0], [0.018, 0.004], [g.hubR, 0.012], [g.hubR, 0.02], [g.hubR - 0.003, 0.023], [g.hubR, 0.026], [g.hubR, 0.04], [0.016, h], [0.0105, h], [0.0105, h + 0.012], [0.0085, h + 0.019], [0.006, h + 0.02], [0, h + 0.02]], 0.002, 48);
  // fentes de la pince
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * 2 * PI;
    A.frame([Math.cos(a) * 0.0102, 0.012, Math.sin(a) * 0.0102], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]);
    box(A, [0, 0, 0], [0.0006, 0.006, 0.0008], 0.0003);
    A.noFrame();
  }
  // bras (tube d'acier) et boules de laiton ; l'un des bouts porte l'ergot qui
  // court dans la glissière
  const ya = g.arm.y, L = g.arm.len;
  rod(A, [-L, ya, 0], [L, ya, 0], 0.0045, 20);
  for (const sx of [-1, 1]) {
    sphere(Mt, [sx * L, ya, 0], g.arm.knob, 28, 16);
  }
  // tige (coulisse dans la douille du socle et dans la table)
  rod(A, [0, -h - 0.7, 0], [0, -h, 0], 0.0045, 16);
  return { metal: scaled(Mt), accent: scaled(A) };
}

export function buildBench(R) {
  return {
    frame: buildFrame(), chuck: buildChuck(), motor: buildMotorPulley(), wheel: buildWheel(R),
    rail: buildRail(), push: buildPush(), fly: buildFly(),
  };
}
