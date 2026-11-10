// Architecture de la plante : tiges, feuilles bipennées, pinnules, folioles,
// fleurs, gousses ; et le graphe vasculaire sur lequel court le signal.
//
// Module pur (sans three.js) : importé par le worker, par la cinématique
// (pose.js) et par les tests Node.
//
// Unités : 1 u = 10 cm. Le sol du pot est en y = 0, l'axe du pot en x = z = 0.
//
// Une feuille de sensitive (Mimosa pudica) : un pétiole, renflé à sa base en
// pulvinus primaire, porte à son extrémité deux paires de pinnules en éventail
// (pulvinus secondaires) ; chaque pinnule porte 12 à 25 paires de folioles
// opposées (pulvinules). Quand la plante est touchée, chaque foliole tourne
// autour de sa pulvinule (une charnière : rotation d'axe fixe de la pose
// ouverte à la pose fermée), les pinnules se rapprochent, le pétiole tombe.
//
// Les poses ouverte et fermée d'une foliole sont choisies pour qu'aucune
// foliole n'en traverse une autre : toutes les folioles d'un même côté d'une
// pinnule ont la même orientation (elles restent parallèles pendant tout le
// mouvement), ouvertes elles sont côte à côte dans le plan de la pinnule
// (largeur < pas × sin α), fermées elles s'écartent de l'axe d'un angle γ, et
// deux folioles voisines sont alors dans des plans parallèles distants de
// pas × sin γ (les tuiles d'un toit). Voir test/plant.test.mjs.
import { createRng } from '../rng.js';
import { makeGrid } from '../grid.js';

const { sin, cos, sqrt, PI, max, min, abs, atan2, hypot } = Math;
const D = PI / 180;

// ── petites aides vectorielles (tableaux [x, y, z]) ─────────────────────────
export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const { add, sub, mul, dot, cross, norm } = v3;
const UP = [0, 1, 0];

// rotation de v autour de l'axe unitaire a, d'un angle t (Rodrigues)
export function rot(v, a, t) {
  const c = cos(t), s = sin(t), k = dot(a, v) * (1 - c), x = cross(a, v);
  return [v[0] * c + x[0] * s + a[0] * k, v[1] * c + x[1] * s + a[1] * k, v[2] * c + x[2] * s + a[2] * k];
}
// matrice 3×3 (colonnes X, Y, Z) → axe et angle de la rotation qui mène A à B
export function hingeBetween(A, B) {
  // R = B · Aᵀ
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // ligne-major : R[3i + j]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[3 * i + j] = A[0][j] * B[0][i] + A[1][j] * B[1][i] + A[2][j] * B[2][i];
  const tr = R[0] + R[4] + R[8];
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  let ax = [R[7] - R[5], R[2] - R[6], R[3] - R[1]];
  const l = v3.len(ax);
  if (l < 1e-9) return { axis: [1, 0, 0], angle: 0 };
  ax = mul(ax, 1 / l);
  return { axis: ax, angle: ang };
}
// repère orthonormé d'après une direction X et une normale approchée Z
export function frameXZ(X, Zapprox) {
  const x = norm(X);
  const z = norm(sub(Zapprox, mul(x, dot(Zapprox, x))));
  return [x, cross(z, x), z]; // [X, Y, Z] avec Y = Z × X
}

// ── Archétypes ───────────────────────────────────────────────────────────────
// Tout ce qui distingue une plante d'une autre : architecture, nombres,
// proportions. Le reste (positions exactes) vient de la graine.
// Familles : chacune plie AUTREMENT (silhouette et mouvement), pas seulement
// d'autres proportions.
//   sensitive  — folioles en peigne qui se ferment par paires, vers le haut ;
//                pinnules qui se rapprochent ; pétiole qui tombe
//   biophytum  — un petit palmier : folioles qui se rabattent vers le bas
//   trèfle     — trois folioles qui se plient en deux le long de leur
//                nervure, vers le bas, et retombent : un parapluie qui se ferme
//   dionée     — un piège de deux lobes ciliés qui claquent l'un contre l'autre
export const FAMILIES = {
  sensitive: { label: 'Sensitive (Mimosa pudica)' },
  biophytum: { label: 'Biophytum, le palmier sensitif' },
  oxalis: { label: 'Trèfle (Oxalis)' },
  dionaea: { label: 'Dionée (Dionaea muscipula)' },
};
export const PLANTS = {
  bush: { family: 'sensitive', label: 'Sensitive buissonnante', stems: [4, 6], nodes: [8, 11], branch: 0.5, pinnae: 4, pairs: [16, 24], flowers: [1, 3], pods: 0, lean: 0.55, height: [1.9, 2.4] },
  seedling: { family: 'sensitive', label: 'Plantule', stems: [1, 1], nodes: [6, 8], branch: 0, pinnae: 4, pairs: [14, 20], flowers: [0, 0], pods: 0, lean: 0.15, height: [1.4, 1.8], bigLeaf: 1.3 },
  trailing: { family: 'sensitive', label: 'Retombante', stems: [3, 5], nodes: [9, 12], branch: 0.35, pinnae: 4, pairs: [16, 22], flowers: [1, 2], pods: 0, lean: 1.2, height: [1.4, 1.9], trail: true },
  flowering: { family: 'sensitive', label: 'En fleurs', stems: [3, 5], nodes: [8, 10], branch: 0.45, pinnae: 4, pairs: [16, 22], flowers: [6, 10], pods: 0, lean: 0.5, height: [1.9, 2.4] },
  fruiting: { family: 'sensitive', label: 'En gousses', stems: [3, 5], nodes: [8, 10], branch: 0.45, pinnae: 4, pairs: [15, 22], flowers: [1, 3], pods: [3, 5], lean: 0.5, height: [1.9, 2.4] },
  bijuga: { family: 'sensitive', label: 'Deux pinnules', stems: [3, 4], nodes: [9, 12], branch: 0.45, pinnae: 2, pairs: [18, 26], flowers: [1, 3], pods: 0, lean: 0.45, height: [1.9, 2.4], bigLeaf: 1.1 },
  biophytum: { family: 'biophytum', label: 'Biophytum (palmier nain)', stems: [1, 1], nodes: [14, 20], branch: 0, pinnae: 1, pairs: [9, 13], flowers: [3, 6], pods: 0, lean: 0.05, height: [1.0, 1.4], crown: true },
  // rosettes : les feuilles partent du collet, pas de tige
  oxalis: { family: 'oxalis', label: 'Trèfle (Oxalis)', rosette: true, nodes: [30, 36], pinnae: 3, flowers: [0, 0], pods: 0, height: [1.1, 1.6] },
  dionaea: { family: 'dionaea', label: 'Dionée', rosette: true, nodes: [6, 9], pinnae: 1, flowers: [0, 0], pods: 0, height: [0.5, 0.8] },
};
// pli des demi-limbes (trèfle, dionée) : rotation autour de la nervure, de
// l'angle ouvert à l'angle fermé (positif : vers le haut)
export const HALF = {
  oxalis: { half: true, open: 9 * D, closed: -72 * D, shape: 'oxalis' },
  dionaea: { half: true, open: 40 * D, closed: 74 * D, shape: 'trap' },
};
// Le vrai pli (trèfle, dionée) : le limbe est d'un seul tenant ; de part et
// d'autre de la nervure, une bande de demi-largeur y0 se courbe en arc de
// cercle (la pliure), au-delà le limbe reste plan, tourné de l'angle θ (le
// même des deux côtés, en miroir). Le gabarit est en coordonnées locales de
// la feuille (x le long de la nervure, y en travers, z la face supérieure) ;
// la même formule est écrite dans le shader (scene/plant.js).
export const FOLD_Y0 = 0.12;
export const foldAngle = (fold, f) => fold.open + (fold.closed - fold.open) * f;
export function foldPoint(p, th, y0 = FOLD_Y0) {
  const s = p[1] >= 0 ? 1 : -1, ay = Math.abs(p[1]);
  const t = Math.min(1, ay / y0), a = th * t;
  const ths = Math.abs(th) < 1e-4 ? 1e-4 : th, out = Math.max(0, ay - y0);
  const Y = (y0 * Math.sin(a)) / ths + out * Math.cos(th);
  const Z = (y0 * (1 - Math.cos(a))) / ths + out * Math.sin(th);
  return [p[0], s * (Y - Math.sin(a) * p[2]), Z + Math.cos(a) * p[2]];
}
// la dionée claque par flambage : en se fermant, chaque lobe passe de concave
// (cuvette) à convexe ; décalage de z (en largeurs) à la fermeture f
export const trapFlip = (u, v, f) => -2 * Math.min(1, f) * 0.15 * Math.min(1, v * v) * (0.6 + 0.4 * Math.sin(Math.PI * u));
// point du limbe entier (les deux moitiés), v ∈ [−1, 1]
export const fullPoint = (shape, u, v) => halfPoint(shape, u, Math.abs(v), v >= 0 ? 1 : -1);

// constantes de forme des folioles (voir l'en-tête)
export const LEAFLET = {
  alphaOpen: 68 * D,   // angle avec le rachis, ouverte
  tiltOpen: 6 * D,     // relèvement au-dessus du plan de la pinnule, ouverte
  gamma: 15 * D,       // écart à l'axe, fermée (les tuiles)
  lift: 14 * D,        // relèvement de la pointe, fermée
  fill: 0.82,          // largeur = fill × pas × sin α
  cup: 0.035,          // creusement (en largeurs)
  rachisR: 0.0042,     // rayon du rachis (u)
};

// ── Construction ─────────────────────────────────────────────────────────────
// spec : { kind, seed, rimR (rayon intérieur du pot au niveau du sol), rimH
// (hauteur de la lèvre au-dessus du sol), size (échelle) }
export function growPlant(spec) {
  const A = PLANTS[spec.kind] ?? PLANTS.bush;
  const rng = createRng(`${spec.seed}:plant`);
  const size = spec.size ?? 1;
  const rimR = spec.rimR ?? 0.55, rimH = spec.rimH ?? 0.12;
  const H = rng.range(...A.height) * size;
  const stems = [], leaves = [], flowers = [], pods = [], prickles = [];
  const rs = rng.fork('stems');
  const nStems = A.rosette ? 0 : rs.int(...A.stems);

  // ── tiges : courbes intégrées (tropisme vers le haut, inclinaison, retombée)
  const stemSpecs = [];
  for (let s = 0; s < nStems; s++) {
    const az = (s / nStems) * 2 * PI + rs.range(-0.5, 0.5);
    const r0 = nStems === 1 ? 0 : rs.range(0.04, 0.16);
    const lean = A.lean * rs.range(0.6, 1.2) * (nStems === 1 ? 1 : 1);
    const h = H * (s === 0 ? 1 : rs.range(0.7, 0.95));
    stemSpecs.push({ az, r0, lean, h });
  }
  // (toute la plante penche un peu vers la lumière de la pièce)
  const la = rng.fork('light').range(0, 2 * PI), lightDir = [cos(la), 0, sin(la)];
  // rameaux : partent d'un nœud d'une tige principale, vers l'extérieur
  const rb = rng.fork('branches');
  const nMain = stemSpecs.length;
  for (let s = 0; s < nMain; s++) if (A.branch && rb.chance(A.branch)) {
    const S = stemSpecs[s];
    stemSpecs.push({ az: S.az + rb.range(-0.9, 0.9), r0: 0, lean: S.lean + rb.range(0.4, 0.8), h: S.h * rb.range(0.45, 0.6), parent: s, t0: rb.range(0.3, 0.55) });
  }
  for (const [si, S] of stemSpecs.entries()) {
    const pts = [], rad = [];
    const horiz = [cos(S.az), 0, sin(S.az)];
    let p, d;
    if (S.parent != null) {
      const at = sampleCurve(stems[S.parent], S.t0);
      p = add(at.p, mul(horiz, at.r * 0.6));
      d = norm(add(mul(at.d, 0.6), add(mul(horiz, 0.8), mul(UP, 0.2))));
    } else {
      p = [cos(S.az) * S.r0, -0.02, sin(S.az) * S.r0];
      d = norm(add(UP, mul(horiz, S.lean * 0.5)));
    }
    const n = 48, len = S.h * (A.trail ? 1.6 : 1.08);
    const step = len / n;
    const r0 = S.parent != null ? stems[S.parent].rad[Math.round(S.t0 * 48)] * 0.75 : 0.021 * (si === 0 ? 1 : 0.88) * (A.crown ? 1.25 : 1);
    // le désordre d'une vraie tige : ondulations irrégulières (deux fréquences
    // dans deux plans), coudes aux nœuds (zigzag alterné de légumineuse),
    // renflement des nœuds, et une préférence pour la lumière
    const rw = rng.fork(`wiggle${si}`);
    const w = [rw.range(0.04, 0.09), rw.range(0.5, 0.9), rw.range(0, 6.3), rw.range(0.02, 0.05), rw.range(1.3, 2.1), rw.range(0, 6.3), rw.range(0.03, 0.07), rw.range(0.4, 0.8), rw.range(0, 6.3)];
    const kInt = rw.int(4, 6), kAng = rw.range(5, 11) * D * (A.crown ? 0.3 : 1);
    let kSide = rw.chance(0.5) ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      pts.push(p);
      const t = i / n;
      const node = Math.exp(-(((i % kInt) / 0.7) ** 2));
      rad.push(r0 * (1 - 0.62 * t) * (1 + 0.16 * node) * (1 + 0.05 * sin(i * 2.3 + w[2])));
      if (i === n) break;
      // tropisme : redresse la tige ; retombante : elle s'incline vers le bord
      // puis retombe par-dessus la lèvre du pot (soutenue par la lèvre)
      let target;
      if (A.trail && S.parent == null) {
        const out = norm(add(horiz, mul(UP, 0.1)));
        const fall = smooth(0.35, 0.75, t);
        target = norm(add(mul(norm(add(UP, mul(horiz, S.lean))), 1 - fall), mul(norm(add(out, mul(UP, -0.85))), fall)));
      } else {
        // la tige s'écarte, puis se redresse vers la lumière
        target = norm(add(add(UP, mul(horiz, S.lean * (0.9 - 0.5 * t))), mul(lightDir, 0.22 * t)));
      }
      d = norm(add(mul(d, 0.88), mul(target, 0.12)));
      const side = norm(cross(d, UP).every((x) => abs(x) < 1e-6) ? [1, 0, 0] : cross(d, UP));
      const bin = norm(cross(side, d));
      // coude au nœud, d'un côté puis de l'autre
      if (i > 0 && i % kInt === 0) { d = norm(add(d, mul(side, kSide * Math.tan(kAng)))); kSide = -kSide; }
      const wob = w[0] * sin(i * w[1] + w[2]) + w[3] * sin(i * w[4] + w[5]), wob2 = w[6] * sin(i * w[7] + w[8]);
      p = add(p, mul(norm(add(add(d, mul(side, wob)), mul(bin, wob2))), step));
      const rr = hypot(p[0], p[2]);
      if (A.trail && rr > rimR - 0.02 && rr < rimR + 0.12 && p[1] < rimH + 0.05) p[1] = rimH + 0.05;
    }
    stems.push({ pts, rad, parent: S.parent ?? null, t0: S.t0 ?? 0 });
  }

  // ── feuilles aux nœuds (phyllotaxie 2/5)
  const rl = rng.fork('leaves');
  const golden = 144 * D;
  const sizeLeaf = (A.bigLeaf ?? 1) * 1.2 * size; // (des feuilles assez grandes pour que le pli se lise)
  stems.forEach((S, si) => {
    const nNodes = A.crown ? rl.int(...A.nodes) : Math.max(3, Math.round(rl.int(...A.nodes) * (S.parent != null ? 0.55 : si === 0 ? 1 : 0.8)));
    let phase = rl.range(0, 2 * PI);
    for (let k = 0; k < nNodes; k++) {
      // position le long de la tige : feuilles de la base vers la pointe
      // (Biophytum : en couronne au sommet)
      const t = A.crown ? 0.8 + 0.2 * (k / nNodes) : (S.parent != null ? 0.25 : 0.12) + (S.parent != null ? 0.73 : 0.86) * ((k + 0.5) / nNodes);
      const at = sampleCurve(S, t);
      const young = A.crown ? smooth(0.85, 1.0, t) * 0.8 : smooth(0.75, 1.02, t); // feuilles du bout plus petites et plus dressées
      phase += golden + rl.range(-0.15, 0.15);
      const az = phase;
      const horiz = [cos(az), 0, sin(az)];
      // élévation du pétiole : les jeunes plus dressées
      // Biophytum : la couronne s'étage, les feuilles du bas s'étalent, celles du haut se dressent
      const elev = A.crown ? (-14 + 52 * ((t - 0.8) / 0.2) + rl.range(-5, 5)) * D : (rl.range(24, 44) + 24 * young) * D;
      const dir = norm(add(mul(horiz, cos(elev)), mul(UP, sin(elev))));
      const scale = sizeLeaf * (1 - 0.45 * young) * rl.range(0.88, 1.08);
      const pet = A.crown ? 0.05 * scale : rl.range(0.22, 0.36) * scale;
      const base = add(at.p, mul(horiz, at.r * 0.9));
      const leaf = makeLeaf(rl, A, { base, dir, az, pet, scale, young, stem: si, t });
      leaves.push(leaf);
      // aiguillons recourbés au nœud
      if (!A.crown) for (let j = 0; j < 2; j++) prickles.push({ stem: si, t: t + (j - 0.5) * 0.02, az: az + PI * (0.6 + 0.8 * j) + rl.range(-0.3, 0.3), len: 0.03 + 0.015 * rl.next() });
    }
  });

  // ── rosettes (trèfle, dionée) : les feuilles partent du collet ; les
  // jeunes, au centre, plus dressées et plus petites
  if (A.rosette) {
    const n = rl.int(...A.nodes);
    let phase = rl.range(0, 2 * PI);
    for (let k = 0; k < n; k++) {
      phase += golden + rl.range(-0.12, 0.12);
      const az = phase, horiz = [cos(az), 0, sin(az)];
      const young = 1 - k / Math.max(1, n - 1); // (les premières : extérieures, âgées)
      const elev = (A.family === 'oxalis' ? rl.range(52, 66) + 18 * young : rl.range(8, 18) + 26 * young) * D;
      const dir = norm(add(mul(horiz, cos(elev)), mul(UP, sin(elev))));
      const scale = size * (1 - 0.3 * young) * rl.range(0.9, 1.08);
      const pet = (A.family === 'oxalis' ? rl.range(0.7, 1.7) : rl.range(0.3, 0.44)) * scale;
      const base = add(mul(horiz, 0.03 + 0.05 * (1 - young)), [0, 0.01, 0]);
      leaves.push(makeLeaf(rl, A, { base, dir, az, pet, scale, young: young * 0.6, stem: -1, t: 0 }));
    }
  }

  // ── fleurs et gousses : à l'aisselle des feuilles du haut
  const rf = rng.fork('flowers');
  const nFl = rf.int(...A.flowers), nPods = A.pods ? rf.int(...A.pods) : 0;
  const axils = leaves.filter((L) => L.t > 0.45 || A.crown).sort(() => 0).slice();
  shuffle(rf, axils);
  for (let i = 0; i < Math.min(axils.length, nFl + nPods); i++) {
    const L = axils[i];
    const az = L.az + rf.range(0.7, 1.3) * (rf.chance(0.5) ? 1 : -1);
    const horiz = [cos(az), 0, sin(az)];
    const el = rf.range(35, 70) * D;
    const d = norm(add(mul(horiz, cos(el)), mul(UP, sin(el))));
    const plen = (A.crown ? rf.range(0.25, 0.45) : rf.range(0.18, 0.32)) * size;
    const p0 = L.base, p1 = add(p0, mul(d, plen));
    const item = { base: p0, dir: d, len: plen, head: p1, leaf: L.id };
    if (i < nFl) flowers.push({ ...item, r: (A.crown ? 0.035 : rf.range(0.06, 0.085)) * size, open: rf.range(0.6, 1), seed: rf.int(0, 1e6) });
    else pods.push({ ...item, n: rf.int(3, 5), len: rf.range(0.11, 0.16) * size, seed: rf.int(0, 1e6) });
  }

  // (rosette : hauteur réelle d'après les feuilles)
  const Hr = A.rosette ? leaves.reduce((m, L) => Math.max(m, L.tip[1] + 0.1), 0.3) : H;
  const plant = { kind: spec.kind, family: A.family, stems, leaves, flowers, pods, prickles, H: Hr };
  separate(plant);
  plant.graph = buildGraph(plant);
  return plant;
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

// point de la tige au paramètre t ∈ [0, 1]
export function sampleCurve(S, t) {
  const n = S.pts.length - 1, x = Math.max(0, Math.min(n, t * n)), i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const p = v3.lerp(S.pts[i], S.pts[i + 1], f);
  return { p, r: S.rad[i] + (S.rad[i + 1] - S.rad[i]) * f, d: norm(sub(S.pts[i + 1], S.pts[i])) };
}

// ── Une feuille ──────────────────────────────────────────────────────────────
function makeLeaf(rl, A, { base, dir, az, pet, scale, young, stem, t }) {
  const id = -1; // (numérotée après l'écartement)
  const tip = add(base, mul(dir, pet));
  if (A.rosette) {
    const fold = HALF[A.family];
    // trèfle : trois folioles à 120°, qui retombent en se pliant ;
    // dionée : un piège dans le prolongement du pétiole
    const fan = A.family === 'oxalis' ? [0, 120, 240] : [0];
    const off = rl.range(0, 2 * PI);
    const pinnae = fan.map((f) => {
      const a = A.family === 'oxalis' ? az + off + f * D : az;
      const horiz = [cos(a), 0, sin(a)];
      const pel = (A.family === 'oxalis' ? rl.range(2, 8) : rl.range(4, 12)) * D;
      const d0 = norm(add(mul(horiz, cos(pel)), mul(UP, sin(pel))));
      const pelC = A.family === 'oxalis' ? -58 * D : pel;
      const d1 = norm(add(mul(horiz, cos(pelC)), mul(UP, sin(pelC))));
      const len = (A.family === 'oxalis' ? rl.range(0.26, 0.34) : rl.range(0.32, 0.42)) * scale;
      const wid = len * (A.family === 'oxalis' ? 0.5 : 0.42);
      return { dir0: d0, dir1: d1, len, pairs: [{ s: 0, len, wid }], step: len, alpha: 0, down: false, fold };
    });
    // pétiole du trèfle : long, arqué, un peu dévié ; aile de la dionée : droite
    const bow = A.family === 'oxalis' ? [rl.range(-0.07, 0.07) * pet, rl.range(0.05, 0.11) * pet] : [0, rl.range(0, 0.02) * pet];
    return { id, stem, t, base, dir, az, pet, tip, scale, young, pinnae, droop: 0, droopMax: 0, bow };
  }
  const nP = A.pinnae;
  const fan = nP === 4 ? [-38, -12, 12, 38] : nP === 2 ? [-21, 21] : [0];
  const pairs = rl.int(...A.pairs) - Math.round(young * 4);
  const pinnae = fan.map((f, pi) => {
    const fa = (f + rl.range(-4, 4)) * D;
    const horiz = [cos(az + fa), 0, sin(az + fa)];
    // les pinnules s'étalent plus à plat que le pétiole
    const pel = (A.crown ? asin(dir[1]) - 4 * D : asin(dir[1]) * 0.25 + rl.range(-6, 6) * D);
    const d0 = norm(add(mul(horiz, cos(pel)), mul(UP, sin(pel))));
    // fermée : les pinnules se rapprochent de l'axe de la feuille et s'abaissent un peu
    const hc = [cos(az + fa * 0.22), 0, sin(az + fa * 0.22)];
    const pelC = pel - (A.crown ? 10 : 6) * D;
    const d1 = norm(add(mul(hc, cos(pelC)), mul(UP, sin(pelC))));
    const len = (A.crown ? rl.range(0.55, 0.85) : (nP === 4 ? (abs(f) > 20 ? 0.36 : 0.44) : 0.5) * rl.range(0.92, 1.08)) * scale;
    // folioles : paires de la base vers la pointe, plus petites aux deux bouts
    const s0 = A.crown ? 0.12 : 0.06, s1 = 0.97;
    const step = ((s1 - s0) * len) / Math.max(1, pairs - 1);
    const Lmax = (A.crown ? 0.13 : 0.1) * scale * rl.range(0.9, 1.1);
    const alpha = LEAFLET.alphaOpen * (A.crown ? 1.18 : 1);
    const wid = LEAFLET.fill * step * sin(alpha) * (A.crown ? 1.0 : 1);
    const list = [];
    for (let i = 0; i < pairs; i++) {
      const u = pairs === 1 ? 0.5 : i / (pairs - 1);
      const s = s0 + (s1 - s0) * u;
      const prof = 0.55 + 0.45 * sin(PI * (0.12 + 0.78 * u));
      list.push({ s, len: Lmax * prof, wid: Math.min(wid, Lmax * prof * 0.32) });
    }
    // le rachis fléchit sous le poids de ses folioles (la pointe plus basse)
    const sag = -rl.range(A.crown ? 0.03 : 0.04, A.crown ? 0.08 : 0.1) * len;
    return { dir0: d0, dir1: d1, len, pairs: list, step, alpha, down: !!A.crown, sag };
  });
  // pétiole arqué (vers le haut), un peu dévié de côté
  const bow = A.crown ? [0, 0] : [rl.range(-0.04, 0.04) * pet, rl.range(0.02, 0.07) * pet];
  return { id, stem, t, base, dir, az, pet, tip, scale, young, pinnae, droop: 0, droopMax: (A.crown ? 32 : 55) * D, bow };
}
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x)));

// ── Repères des folioles (pose de repos du pinnule) ─────────────────────────
// Pour une pinnule de direction t et de normale n (vers le ciel), côté σ
// (+1 à gauche) : repères ouvert et fermé [X (longueur), Y (largeur), Z (face
// supérieure)], et la charnière qui mène de l'un à l'autre.
export function leafletFrames(t, n, sigma, down = false) {
  const y = cross(n, t); // gauche
  if (down && down.half) {
    // demi-limbe (trèfle, dionée) : repère [nervure, côté, face supérieure],
    // tourné autour de la nervure ; le gabarit de gauche s'étend vers +y, celui
    // de droite vers −y (gabarit miroir) : même repère de base des deux côtés
    const base = [t, y, n];
    const R = (a) => base.map((v) => rot(v, t, sigma * a));
    return { open: R(down.open), closed: R(down.closed), hinge: { axis: t, angle: sigma * (down.closed - down.open) } };
  }
  const L = LEAFLET;
  const a = L.alphaOpen * (down ? 1.18 : 1);
  const Xo = norm(add(add(mul(t, cos(a)), mul(y, sigma * sin(a))), mul(n, sin(L.tiltOpen))));
  const Fo = frameXZ(Xo, n);
  // fermée : écartée de γ, pointe relevée (Biophytum : rabattue vers le bas)
  const lift = down ? -2.2 * L.lift : L.lift;
  const g = L.gamma * (down ? 1.4 : 1);
  const Xc = norm(add(add(mul(t, cos(g) * cos(lift)), mul(y, sigma * sin(g) * cos(lift))), mul(n, sin(lift))));
  // face supérieure tournée vers la partenaire (vers le plan médian) ;
  // Biophytum : les faces inférieures se rejoignent sous le rachis
  const Zc0 = mul(y, down ? sigma : -sigma);
  const Fc = frameXZ(Xc, Zc0);
  // (Y suit Z × X : la moitié large de la foliole reste du côté de la pointe)
  return { open: Fo, closed: Fc, hinge: hingeBetween(Fo, Fc) };
}
// normale « vers le ciel » d'une pinnule de direction t
export const pinnaUp = (t) => norm(sub(UP, mul(t, dot(UP, t))));

// ── Écartement : aucune feuille ouverte n'en touche une autre ───────────────
// Proxies : quelques points par foliole. Une feuille qui en gêne une autre
// déjà placée tourne un peu sur sa tige, puis se raccourcit ; au pire elle
// est retirée.
function separate(plant) {
  const grid = makeGrid(0.05);
  const keep = [];
  const pts3 = (a) => { const o = []; for (let i = 0; i < a.length; i += 3) o.push([a[i], a[i + 1], a[i + 2]]); return o; };
  const clash = (pts, d) => pts.some((p) => grid.any(p, d));
  for (const L of plant.leaves) {
    let ok = false;
    const az0 = L.az;
    for (let tries = 0; tries < 16 && !ok; tries++) {
      // pendant tout le pli (cinq instants), à distance des autres feuilles —
      // ouvertes, à mi-course, fermées — et de leurs pétioles
      ok = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].every((f) => !clash(pts3(leafPoints(L, f, f, 0, true)), f === 0 ? 0.026 : 0.02));
      if (!ok) {
        // tourne de ±15°, ±30°… autour de son azimut, puis raccourcit
        const k = Math.floor(tries / 2) + 1;
        retarget(L, az0 + (tries % 2 ? 1 : -1) * 0.26 * k, tries > 7 ? 0.94 : 1);
      }
    }
    if (ok) {
      keep.push(L);
      for (const f of [0, 0.5, 1]) for (const p of pts3(leafPoints(L, f, f, 0, true))) grid.add(p, 1);
    }
  }
  plant.leaves = keep;
  keep.forEach((L, i) => { L.id = i; });
}
function retarget(L, az, shrink) {
  const dAz = az - L.az;
  const R = (v) => rot(v, UP, -dAz);
  // (rotation autour de la verticale passant par la base)
  L.dir = R(L.dir);
  L.az = az;
  L._pf = null; // (repère du pétiole arqué : à recalculer)
  L.pet *= shrink;
  L.tip = add(L.base, mul(L.dir, L.pet));
  for (const P of L.pinnae) {
    P.dir0 = R(P.dir0); P.dir1 = R(P.dir1);
    P.len *= shrink; P.step *= shrink;
    for (const q of P.pairs) { q.len *= shrink; q.wid *= shrink; }
  }
}

// Points témoins d'une feuille dans une pose donnée : fl (fermeture des
// folioles), fp (des pinnules), dp (affaissement du pétiole, en part de
// droopMax). Sert à l'écartement, au calcul de l'affaissement permis et aux
// tests.
export function leafPoints(L, fl, fp, dp, dense = false) {
  const out = [];
  const droopAxis = norm(cross(L.dir, UP));
  const ang = -L.droopMax * dp;
  const R = (p) => add(L.base, rot(sub(p, L.base), droopAxis, ang));
  const push = (p) => { const q = R(p); out.push(q[0], q[1], q[2]); };
  for (const P of L.pinnae) {
    const pr = pinnaPose(P, fp);
    // (toutes les folioles d'un même côté partagent le même repère)
    const side = [1, -1].map((sg) => ({ sg, fr: interpFrame(leafletFrames(pr.t, pr.n, sg, P.fold ?? P.down), fl), off: mul(cross(pr.n, pr.t), sg * LEAFLET.rachisR) }));
    // (points témoins à pas fixe d'environ 2,5 mm : une grande foliole en a plus)
    const nk = (q) => (dense ? Math.max(4, Math.ceil(q.len / 0.025)) : 2);
    const ksOf = (q) => (dense ? Array.from({ length: nk(q) }, (_, i) => 0.08 + (0.92 * i) / (nk(q) - 1)) : [0.35, 0.95]);
    const ysOf = (q, half) => { if (!dense) return half ? [0.5] : [0]; const n = Math.max(3, Math.ceil(q.wid / 0.025) + 1); return Array.from({ length: n }, (_, i) => (half ? 0.1 + (0.9 * i) / (n - 1) : -0.5 + i / (n - 1))); };
    for (const q of P.pairs) {
      const B = rachisPoint(L, P, pr.t, pr.n, q.s);
      for (const { fr, off, sg } of side) {
        const ys = P.fold ? ysOf(q, true).map((v) => v * sg) : ysOf(q, false), ks = ksOf(q);
        for (const k of ks) for (const yy of ys) push(add(add(add(B, mul(fr[0], k * q.len)), mul(fr[1], yy * q.wid)), off));
      }
    }
    for (const k of [0.25, 0.5, 0.75, 1]) push(rachisPoint(L, P, pr.t, pr.n, k));
  }
  // le pétiole entier (un obstacle pour les autres feuilles)
  const np = dense ? Math.max(2, Math.ceil(L.pet / 0.03)) : 2;
  for (let k = 1; k <= np; k++) push(petiolePoint(L, k / np));
  return out;
}
// repère du pétiole (gabarit le long de +X) et point du pétiole arqué à k ∈ [0, 1]
// (l'arc s'annule aux deux bouts : la feuille reste attachée au même point)
export const petioleFrame = (L) => frameXZ(L.dir, sub(UP, mul(L.dir, L.dir[1])));
export function petiolePoint(L, k) {
  const F = L._pf ?? (L._pf = petioleFrame(L)), b = L.bow ?? [0, 0], s = Math.sin(Math.PI * k);
  return add(add(add(L.base, mul(F[0], k * L.pet)), mul(F[1], b[0] * s)), mul(F[2], b[1] * s));
}
// point du rachis fléchi : abscisse s ∈ [0, 1] dans la pose (t, n) de la pinnule
export const rachisPoint = (L, P, t, n, s) => add(add(L.tip, mul(t, s * P.len)), mul(n, (P.sag ?? 0) * s * s));

// direction et normale d'une pinnule à la fermeture f (rotation d'axe fixe)
export function pinnaPose(P, f) {
  if (!P._h) {
    const A = frameXZ(P.dir0, pinnaUp(P.dir0)), B = frameXZ(P.dir1, pinnaUp(P.dir1));
    P._h = hingeBetween(A, B); P._A = A;
  }
  const h = P._h, A = P._A;
  return { t: rot(A[0], h.axis, h.angle * f), n: rot(A[2], h.axis, h.angle * f) };
}
export function interpFrame(F, f) {
  const { axis, angle } = F.hinge;
  return F.open.map((v) => rot(v, axis, angle * f));
}

// ── Graphe vasculaire ────────────────────────────────────────────────────────
// Nœuds : racine (collet), points des tiges, pulvinus primaire (P) et
// secondaire (S) de chaque feuille, une paire de folioles par nœud (F).
// Arêtes : longueur (u) et organe (vitesse et atténuation du signal propres).
export const ORGANS = { stem: 0, petiole: 1, rachis: 2, root: 3 };
function buildGraph(plant) {
  const nodes = [], edges = [];
  const node = (o) => { nodes.push(o); return nodes.length - 1; };
  const link = (a, b, len, organ) => { edges.push([a, b, len, organ]); };
  const root = node({ kind: 'root', pos: [0, 0, 0] });
  const stemNodes = plant.stems.map((S) => {
    const ids = S.pts.map((p) => node({ kind: 'stem', pos: p }));
    for (let i = 0; i + 1 < ids.length; i++) link(ids[i], ids[i + 1], v3.len(sub(S.pts[i + 1], S.pts[i])), ORGANS.stem);
    return ids;
  });
  plant.stems.forEach((S, si) => {
    if (S.parent == null) link(root, stemNodes[si][0], v3.len(S.pts[0]), ORGANS.root);
    else link(stemNodes[S.parent][Math.round(S.t0 * (plant.stems[S.parent].pts.length - 1))], stemNodes[si][0], 0.01, ORGANS.stem);
  });
  for (const L of plant.leaves) {
    L.nodeP = node({ kind: 'P', leaf: L.id, pos: L.base });
    if (L.stem < 0) link(root, L.nodeP, v3.len(L.base) + 0.02, ORGANS.root); // (rosette : du collet)
    else {
      const S = plant.stems[L.stem], n = S.pts.length - 1;
      link(stemNodes[L.stem][Math.round(L.t * n)], L.nodeP, 0.01, ORGANS.stem);
    }
    L.nodeS = node({ kind: 'S', leaf: L.id, pos: L.tip });
    link(L.nodeP, L.nodeS, L.pet, ORGANS.petiole);
    L.pinnae.forEach((P, pi) => {
      let prev = L.nodeS, prevS = 0;
      P.pairs.forEach((q, qi) => {
        q.node = node({ kind: 'F', leaf: L.id, pinna: pi, pair: qi, pos: add(L.tip, mul(P.dir0, q.s * P.len)) });
        link(prev, q.node, (q.s - prevS) * P.len, ORGANS.rachis);
        prev = q.node; prevS = q.s;
      });
    });
  }
  return { nodes, edges, root };
}

// ── Gabarit d'une foliole (coordonnées normalisées) ─────────────────────────
// u ∈ [0, 1] le long de la foliole (pulvinule en 0), v ∈ [−1, 1] en travers ;
// X = u (× longueur), Y = demi-largeur (× largeur), Z = creusement (× largeur).
// Limbe oblong, base arrondie et oblique, pointe aiguë ; nervure médiane
// excentrée (la moitié du côté de la pointe du rachis est plus large).
export function leafletHalfWidth(u, side) {
  const base = Math.pow(Math.min(1, u / 0.12), 0.55);          // base arrondie
  const tip = Math.pow(Math.max(0, 1 - Math.pow(u, 2.4)), 0.7); // pointe
  const w = base * tip;
  return (side > 0 ? 0.58 : 0.42) * w * (side > 0 ? 1 : Math.min(1, Math.max(0, (u - 0.04) / 0.2)));
}
export function leafletPoint(u, v) {
  const y = v * leafletHalfWidth(u, v);
  // creusement en gouttière, nul sur la nervure ; la pointe se relève à peine
  const z = LEAFLET.cup * 4 * y * y - 0.05 * u * u * u; // (la pointe s'incurve vers le bas)
  return [u, y, z];
}

// Demi-limbe (trèfle, dionée) : u le long de la nervure, v ∈ [0, 1] vers le
// bord ; sg = +1 (gauche, vers +y) ou −1 (gabarit miroir)
export const halfWidthOf = (shape, u) => (shape === 'trap' ? 0.98 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) : Math.pow(u, 0.85) * (1 - 0.3 * Math.pow(u, 8)));
export function halfPoint(shape, u, v, sg = 1) {
  const x = shape === 'trap' ? u : u * (0.9 + 0.1 * Math.pow(v, 0.6)); // (échancrure du trèfle)
  const y = v * halfWidthOf(shape, u);
  // lobe en cuvette (il bombe vers l'extérieur) ; foliole de trèfle à peine
  // creusée, qui s'incurve vers sa pointe et ondule au bord
  const z = shape === 'trap' ? 0.15 * v * v * (0.6 + 0.4 * Math.sin(Math.PI * u)) : 0.03 * v * v + 0.04 * u * u * u + 0.01 * v * Math.sin(9 * u);
  return [x, sg * y, z];
}
