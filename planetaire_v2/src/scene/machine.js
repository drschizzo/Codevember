// La machine, construite d'après sa conception (mech/design.js). Tout est
// porté : chaque roue tourne sur un tenon, chaque tenon est fixé à un bras,
// chaque bras pivote sur un canon, et la chaîne remonte jusqu'au poteau
// central (fixé au plateau) et au tube central (qui porte l'étoile des bras 0).
//
// Sous le plateau, montage concentrique : la couronne dentée est vissée sous
// le plateau, dont le canon repose sur un pont ; le tube central traverse le
// canon et porte sa roue sous le pont. Un arbre de renvoi, tenu entre le bâti
// et le pont, mène les deux par deux pignons ; le mouvement qui le fait
// tourner est dans le boîtier du pied.
//
// Angles, pour le bras i (θᵢ = kᵢ t + φᵢ) et le train qu'il porte (qui mène le
// bras i+1) : ψ = (k_{i−1} − kᵢ) t ; roue A (fixée au bras i−1) à θᵢ + ψ ;
// renvoi n et roue B, dans le repère du bras : (−1)ⁿ (z_A / z) ψ + off. Les
// décalages off calent chaque dent dans un creux à t = 0 ; rapports et
// entraxes exacts les y maintiennent.
//
// Coordonnées : le plan (x, y) de l'orbite est posé en (x, h, −y) ; une
// rotation d'angle θ autour de +y est la rotation du plan.
import * as THREE from 'three/webgpu';
import { uniform, positionLocal, float, vec2, sin, atan, length, fract, smoothstep, mix, abs, floor, mx_cell_noise_float } from 'three/tsl';
import { designMachine, SLAB } from '../mech/design.js';

const TAU = Math.PI * 2;
const BAR_T = 0.005, GEAR_T = 0.0035, GEAR_DY = 0.008; // épaisseurs ; hauteur du train au-dessus du bras
const STUD_R = 0.0028;

// matières par rôle, réglées à vif depuis la recette
export const ROLES = ['plate', 'arms', 'arms2', 'gears', 'pins', 'foot'];
export function materials() {
  const make = () => new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.3 });
  const m = Object.fromEntries(ROLES.map((r) => [r, make()]));
  // rubis des paliers
  m.jewel = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.55, 0.01, 0.04), metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 });
  // finition du plateau : motif procédural sur la rugosité et la teinte
  // (guilloché : vagues concentriques ; soleil : rayons fins ; perlage : cercles
  // brossés qui se chevauchent), dans le repère du plateau
  const PF = { scale: uniform(1), amp: uniform(0), rough: uniform(0.3), color: uniform(new THREE.Color()) };
  m.plateFinish = PF;
  m.setFinish = (kind, scale = 1) => {
    const p = vec2(positionLocal.x, positionLocal.z).mul(PF.scale);
    const r = length(p), th = atan(p.y, p.x);
    let v = float(0);
    if (kind === 'guilloche') v = sin(r.mul(140).add(sin(th.mul(24)).mul(1.6))).mul(0.5).add(0.5);
    else if (kind === 'soleil') v = sin(th.mul(720)).mul(0.5).add(0.5).mul(smoothstep(0.05, 0.25, r));
    else if (kind === 'perlage') {
      const q = p.mul(28), c = floor(q), f = fract(q).sub(0.5);
      const ring = fract(length(f).mul(9).add(mx_cell_noise_float(c).mul(3)));
      v = smoothstep(0.2, 0.8, ring).mul(smoothstep(0.5, 0.38, length(f)));
    }
    PF.scale.value = scale;
    PF.amp.value = kind === 'lisse' ? 0 : 1;
    m.plate.roughnessNode = PF.rough.add(v.sub(0.5).mul(0.22).mul(PF.amp)).clamp(0.02, 1);
    m.plate.colorNode = PF.color.mul(float(1).sub(v.mul(0.12).mul(PF.amp)));
    m.plate.needsUpdate = true;
  };
  // fond des sillons : la matière du plateau, assombrie et mate
  // (les courbes tournent dans un sens ou dans l'autre : rubans visibles des deux côtés)
  m.groove = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.6, roughness: 0.75, side: THREE.DoubleSide });
  m.lip = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.18, side: THREE.DoubleSide });
  m.apply = (matters, table) => {
    for (const role of ROLES) {
      const t = table[matters[role]], x = m[role];
      if (!t) continue;
      x.color.setRGB(...t.color); x.metalness = t.metal; x.roughness = t.rough;
      x.clearcoat = t.coat; x.clearcoatRoughness = 0.08;
      x.iridescence = t.irid || 0; x.sheen = t.sheen || 0;
    }
    const pl = table[matters.plate];
    if (pl) { PF.rough.value = pl.rough; PF.color.value.setRGB(...pl.color); }
    if (pl) { m.groove.color.setRGB(...pl.color.map((c) => c * 0.22)); m.groove.metalness = pl.metal * 0.6; }
    const pn = table[matters.pins];
    if (pn) { m.lip.color.setRGB(...pn.color); m.lip.metalness = pn.metal; }
  };
  return m;
}

// ── Géométries ───────────────────────────────────────────────────────────────

// pose une forme du plan (x, y) à plat : (x, 0, −y), épaisseur centrée sur 0
function flat(shape, thick, bevel = 0.25) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: thick * bevel * 0.5, bevelSize: thick * bevel * 0.5, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

// roue dentée : dents trapézoïdales centrées sur les angles 2πi/z, alésage,
// bras (rayons) pour les grandes roues, ou couronne (anneau) ; une denture plus
// fine que le pixel devient un simple disque
const gearCache = new Map();
function gearGeometry(z, r, { thick = GEAR_T, ring = 0 } = {}) {
  const key = `${z}:${r.toFixed(5)}:${thick}:${ring}`;
  if (gearCache.has(key)) return gearCache.get(key);
  const m = (2 * r) / z, p = TAU / z;
  const rTip = r + m, rRoot = Math.max(r * 0.5, r - 1.25 * m);
  const shape = new THREE.Shape();
  if (m < 0.0014) shape.absarc(0, 0, r, 0, TAU, false);
  else {
    for (let i = 0; i < z; i++) {
      const a = i * p;
      const pts = [[rRoot, a - 0.3 * p], [rTip, a - 0.13 * p], [rTip, a + 0.13 * p], [rRoot, a + 0.3 * p]];
      pts.forEach(([rr, b], kk) => (i === 0 && kk === 0 ? shape.moveTo(rr * Math.cos(b), rr * Math.sin(b)) : shape.lineTo(rr * Math.cos(b), rr * Math.sin(b))));
    }
    shape.closePath();
  }
  const bore = new THREE.Path();
  bore.absarc(0, 0, ring ? rRoot - ring : Math.max(STUD_R * 1.15, r * 0.1), 0, TAU, true);
  shape.holes.push(bore);
  // bras de roue (horlogerie) : 5 ajours entre moyeu et serge
  if (!ring && r > 0.035) {
    const ns = 5, rIn = r * 0.26, rOut = rRoot - Math.max(0.006, r * 0.1);
    const gapO = Math.max(0.005, r * 0.06) / rOut, gapI = Math.max(0.005, r * 0.06) / rIn;
    for (let s = 0; s < ns; s++) {
      const a0 = (s / ns) * TAU, a1 = ((s + 1) / ns) * TAU;
      const h = new THREE.Path();
      h.absarc(0, 0, rOut, a0 + gapO, a1 - gapO, false);
      h.absarc(0, 0, rIn, a1 - gapI, a0 + gapI, true);
      h.closePath();
      shape.holes.push(h);
    }
  }
  const g = flat(shape, thick, 0.3);
  gearCache.set(key, g);
  return g;
}

// bras : un plat aux bouts arrondis, de −cw (contrepoids) à L, ajouré s'il est long
function barGeometry(L, w, cw) {
  const s = new THREE.Shape(), h = w / 2;
  s.absarc(L, 0, h, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-cw, 0, h * 1.25, Math.PI / 2, (3 * Math.PI) / 2, false);
  s.closePath();
  if (L > 0.14) {
    const a = L * 0.2, b = L * 0.8, hh = h * 0.42, hole = new THREE.Path();
    hole.absarc(b, 0, hh, -Math.PI / 2, Math.PI / 2, false);
    hole.absarc(a, 0, hh, Math.PI / 2, (3 * Math.PI) / 2, false);
    hole.closePath();
    s.holes.push(hole);
  }
  return flat(s, BAR_T, 0.3);
}

// cylindre posé sur y = 0
const cyl = (r, h, seg = 20, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, Math.max(h, 1e-4), seg); g.translate(0, Math.max(h, 1e-4) / 2, 0); return g; };

// ── Calage des dents ─────────────────────────────────────────────────────────
// gears alignées sur +x (centres croissants), angles relatifs à t = 0 : la
// première dent de la première roue pointe vers +x ; chaque roue suivante
// présente un creux à la dent qui la mène
function meshOffsets(zs) {
  const off = [0];
  for (let g = 1; g < zs.length; g++) {
    const pPrev = TAU / zs[g - 1], p = TAU / zs[g];
    const fPrev = ((((0 - off[g - 1]) / pPrev) % 1) + 1) % 1;
    const f = (((0.5 - fPrev) % 1) + 1) % 1;
    off.push(Math.PI - f * p);
  }
  return off;
}

// ruban posé à plat le long d'une courbe fermée du plan (sillon) : y constant,
// largeur w ; coordonnées (x, y) → (x, h, −y)
function ribbonGeometry(pts, w, h) {
  const n = pts.length / 2, pos = new Float32Array(n * 2 * 3), nrm = new Float32Array(n * 2 * 3), idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    let tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = -ty, ny = tx, x = pts[2 * i], y = pts[2 * i + 1];
    for (let sd = 0; sd < 2; sd++) {
      const o = (i * 2 + sd) * 3, f = sd ? -w / 2 : w / 2;
      pos[o] = x + nx * f; pos[o + 1] = h; pos[o + 2] = -(y + ny * f);
      nrm[o + 1] = 1;
    }
    const i2 = (i + 1) % n;
    idx.push(i * 2, i2 * 2, i * 2 + 1, i2 * 2, i2 * 2 + 1, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// ── La machine ───────────────────────────────────────────────────────────────
//
// La pile monte depuis le plateau : l'étoile des bras 0 juste au-dessus de
// lui, chaque bras un étage plus haut que celui qui le porte, son train
// d'engrenages au-dessus de lui ; les astres au sommet, au-dessus de toutes
// les roues, chacun sur sa goupille. L'étoile, qui porte tout, roule sur des
// galets dont les patins glissent dans des sillons circulaires du plateau ;
// les autres bras qui le peuvent reposent aussi sur une colonne et un sillon
// (mech/design.js choisit où la poser pour qu'aucune pièce ne la croise).

export const Y_PLATE = -0.34;
const CLEAR = 0.035;      // du plateau au dessous de la pile (hauteur des galets de l'étoile)
const BODY_CLEAR = 0.07;  // du sommet de la pile au plan des astres
const GAP = 0.003;        // jeu entre un bras et le train qu'il porte

export function createMachine({ arms, N, mats, omegaFrac, yFloor = -0.72 }) {
  const D = designMachine(arms, N);
  const n = D.n, k = D.k, L = D.L, phi = D.phi;
  const group = new THREE.Group();   // tourne avec le plateau
  const stand = new THREE.Group();   // fixe (studio)
  const geos = new Set();
  const keep = (g) => (geos.add(g), g);
  const mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; o.receiveShadow = true; return o; };

  // ── hauteurs
  const yPlate = Y_PLATE;
  const yTop = yPlate + CLEAR + D.height;
  const slabBase = (i, j) => yPlate + CLEAR + D.base[i] + D.level[i][j] * SLAB;
  const yBar = (i, j) => slabBase(i, j) + BAR_T / 2;                      // milieu du bras
  const yGear = (i, j) => slabBase(i, j) + BAR_T + GAP + GEAR_T / 2;      // milieu du train porté par le bras i
  const yGroove = yPlate + 0.0004, yBody = yTop + BODY_CLEAR;

  // ── plateau, jonc, graduations
  let reach = 0;
  for (const l of L) reach += l;
  const plateR = Math.max(1.38, reach + 0.18);
  const plate = mesh(keep(new THREE.CylinderGeometry(plateR, plateR, 0.035, 180)), mats.plate);
  plate.position.y = yPlate - 0.0175;
  group.add(plate);
  const rim = mesh(keep(new THREE.TorusGeometry(plateR, 0.012, 12, 220)), mats.arms);
  rim.rotation.x = Math.PI / 2; rim.position.y = yPlate;
  group.add(rim);
  {
    const tick = keep(new THREE.BoxGeometry(0.05, 0.003, 0.005));
    const ticks = new THREE.InstancedMesh(tick, mats.pins, 120);
    const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU, long = i % 10 === 0 ? 2 : i % 5 === 0 ? 1.5 : 1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      p.set(Math.cos(a) * (plateR - 0.06 - 0.012 * long), yPlate + 0.0015, Math.sin(a) * (plateR - 0.06 - 0.012 * long));
      s.set(long, 1, 1);
      ticks.setMatrixAt(i, M4.compose(p, q, s));
    }
    ticks.receiveShadow = true;
    group.add(ticks);
  }

  // ── sillons : la courbe décrite par chaque patin (la même pour toutes les chaînes)
  const P = new Float64Array(2 * n + 2);
  const grooveCurves = [];
  D.supports.forEach((us, a) => (us || []).forEach((u) => {
    const m = 1600, pts = new Float32Array(m * 2);
    for (let s = 0; s < m; s++) {
      D.pivots((TAU * s) / m, P);
      pts[2 * s] = P[2 * a] + u * (P[2 * a + 2] - P[2 * a]);
      pts[2 * s + 1] = P[2 * a + 1] + u * (P[2 * a + 3] - P[2 * a + 1]);
    }
    grooveCurves.push({ a, pts });
    const floor = mesh(keep(ribbonGeometry(pts, 0.016, yGroove)), mats.groove, false);
    group.add(floor);
    for (const sd of [-1, 1]) {
      // lèvres du sillon (chanfrein qui accroche la lumière)
      const lipPts = new Float32Array(pts.length);
      for (let s = 0; s < m; s++) {
        const a2 = (s + m - 1) % m, b2 = (s + 1) % m;
        let tx = pts[2 * b2] - pts[2 * a2], ty = pts[2 * b2 + 1] - pts[2 * a2 + 1];
        const l = Math.hypot(tx, ty) || 1;
        lipPts[2 * s] = pts[2 * s] - (ty / l) * sd * 0.0088;
        lipPts[2 * s + 1] = pts[2 * s + 1] + (tx / l) * sd * 0.0088;
      }
      group.add(mesh(keep(ribbonGeometry(lipPts, 0.0018, yPlate + 0.0007)), mats.lip, false));
    }
  }));

  // ── centre : poteau fixé au plateau (porte la roue solaire, au-dessus de
  // l'étoile), tube tournant autour de lui (porte l'étoile)
  const train0 = D.trains[1];
  const ySun = yGear(0, 0);
  const post = mesh(keep(cyl(0.0055, ySun + GEAR_T / 2 + 0.006 - yPlate)), mats.pins);
  post.position.y = yPlate; group.add(post);
  let sun = null;
  if (train0) {
    sun = mesh(gearGeometry(train0.gears[0].z, train0.gears[0].r), mats.gears);
    sun.position.y = ySun;
    group.add(sun);
  }
  const starHub = mesh(keep(cyl(0.022, BAR_T * 1.8, 32)), mats.arms);
  starHub.position.y = yBar(0, 0) - BAR_T * 0.9;
  group.add(starHub);
  const finial = mesh(keep(new THREE.SphereGeometry(0.009, 20, 12)), mats.pins);
  finial.position.y = ySun + GEAR_T / 2 + 0.01;
  group.add(finial);

  // ── les chaînes
  const chains = [];
  const barGeos = L.map((l, i) => keep(barGeometry(l, D.barW[i], D.cw[i])));
  for (const tr of D.trains) if (tr) tr.off = meshOffsets(tr.gears.map((g) => g.z));
  for (let j = 0; j < N; j++) {
    const ch = { arm: [], idlers: [], tipA: [] };
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const oy = yBar(i, j); // origine du groupe : milieu du bras
      g.position.y = oy;
      g.add(mesh(barGeos[i], i % 2 ? mats.arms2 : mats.arms));
      // contrepoids
      const cwR = Math.max(0.006, D.barW[i] * 0.95);
      const cwm = mesh(keep(cyl(cwR, BAR_T * 2.4, 24)), mats.arms);
      cwm.position.set(-D.cw[i], -BAR_T * 1.2, 0);
      g.add(cwm);
      // moyeu, rubis, vis
      const hubR = Math.max(0.0045, D.barW[i] * 0.42);
      const hub = mesh(keep(cyl(hubR, BAR_T * 1.6, 20)), mats.pins);
      hub.position.y = -BAR_T * 0.8;
      g.add(hub);
      const jewel = mesh(keep(cyl(hubR * 0.45, 0.0008, 16)), mats.jewel, false);
      jewel.position.y = BAR_T * 0.8;
      g.add(jewel);
      if (L[i] > 0.08) {
        for (const sx of [0.1, 0.9]) {
          const screw = mesh(keep(cyl(D.barW[i] * 0.15, 0.0014, 12)), mats.pins, false);
          screw.position.set(L[i] * sx, BAR_T / 2, 0);
          g.add(screw);
        }
      }
      const top = BAR_T / 2, bottom = -BAR_T / 2; // dessus et dessous du bras, dans son repère
      // train porté par ce bras (mène le bras i + 1), au-dessus de lui : renvois sur tenons
      const tr = D.trains[i + 1], idl = [];
      if (tr) {
        tr.gears.forEach((gear, gi) => {
          if (gear.role !== 'I') return;
          const yg = yGear(i, j) - oy;
          const stud = mesh(keep(cyl(STUD_R, yg + GEAR_T / 2 + 0.0015 - top)), mats.pins);
          stud.position.set(gear.x, top, 0);
          g.add(stud);
          const gm = mesh(gearGeometry(gear.z, gear.r), mats.gears);
          gm.position.set(gear.x, yg, 0);
          g.add(gm);
          idl.push({ m: gm, z: gear.z, off: tr.off[gi], sign: gi % 2 ? -1 : 1, zA: tr.gears[0].z });
        });
      }
      ch.idlers.push(idl);
      // au bout du bras : l'axe qui porte le bras suivant (et, au-dessus de lui,
      // la roue A du train suivant, solidaire de ce bras) ; au dernier bras, la
      // goupille de l'astre et son chaton
      if (i < n - 1) {
        const trNext = D.trains[i + 2];
        const yHigh = (trNext ? yGear(i + 1, j) + GEAR_T / 2 : yBar(i + 1, j) + BAR_T / 2) + 0.003 - oy;
        const axle = mesh(keep(cyl(STUD_R * 1.3, yHigh - top)), mats.pins);
        axle.position.set(L[i], top, 0);
        g.add(axle);
        if (trNext) {
          const A = mesh(gearGeometry(trNext.gears[0].z, trNext.gears[0].r), mats.gears);
          A.position.set(L[i], yGear(i + 1, j) - oy, 0);
          g.add(A);
          ch.tipA.push({ A, i });
        }
      } else {
        const pin = mesh(keep(cyl(0.0032, yBody - 0.03 - (oy + top))), mats.pins);
        pin.position.set(L[i], top, 0);
        g.add(pin);
        const cup = mesh(keep(new THREE.CylinderGeometry(0.014, 0.005, 0.012, 20)), mats.pins);
        cup.position.set(L[i], yBody - 0.024 - oy, 0);
        g.add(cup);
      }
      // galets : colonnes du dessous du bras jusqu'aux sillons, patins
      for (const u of D.supports[i] || []) {
        const x = u * L[i], yFoot = yPlate + 0.006 - oy;
        const col = mesh(keep(cyl(0.0034, bottom - yFoot)), mats.pins);
        col.position.set(x, yFoot, 0);
        g.add(col);
        const shoe = mesh(keep(cyl(0.0065, 0.006, 20, 0.0045)), mats.foot);
        shoe.position.set(x, yPlate + 0.0004 - oy, 0);
        g.add(shoe);
        const collar = mesh(keep(cyl(0.006, 0.004, 20)), mats.pins);
        collar.position.set(x, bottom - 0.004, 0);
        g.add(collar);
      }
      // roue B du train précédent : solidaire de ce bras, sous lui, et son canon
      const trPrev = D.trains[i];
      if (trPrev) {
        const gB = trPrev.gears[trPrev.gears.length - 1];
        const yB = yGear(i - 1, j) - oy;
        const B = mesh(gearGeometry(gB.z, gB.r), mats.gears);
        B.position.y = yB;
        B.userData.off = trPrev.off[trPrev.gears.length - 1];
        g.add(B);
        const canonH = bottom - (yB + GEAR_T / 2);
        if (canonH > 0) {
          const canon = mesh(keep(cyl(Math.max(STUD_R * 2.2, hubR * 0.8), canonH + 0.0005, 16)), mats.arms);
          canon.position.y = yB + GEAR_T / 2;
          g.add(canon);
        }
        g.userData.B = B;
      }
      group.add(g);
      ch.arm.push(g);
    }
    chains.push(ch);
  }

  // ── sous le plateau
  const [pw, qw] = omegaFrac;
  const OmP = pw / qw, OmT = pw / qw + k[0]; // vitesses (studio) du plateau et du tube
  const d = 0.6;                           // entraxe de l'arbre de renvoi
  const yRing = yPlate - 0.035 - 0.004, yUB = yRing - 0.03, yT = yUB - 0.03, yFrame = yT - 0.045;
  const big = Math.round(3 * Math.max(Math.abs(pw), Math.abs(pw + k[0] * qw))); // |Ω_arbre| · q
  const pair = (a, b) => { const g = (x, y) => (y ? g(y, x % y) : x), gg = g(a, b); a /= gg; b /= gg; const t = Math.max(1, Math.ceil(12 / Math.min(a, b))); return [a * t, b * t]; };
  const wheels = [];
  if (OmP !== 0) wheels.push({ y: yRing, Om: OmP, speedQ: Math.abs(pw), onTube: false });
  if (OmT !== 0) wheels.push({ y: yT, Om: OmT, speedQ: Math.abs(pw + k[0] * qw), onTube: true });
  for (const w of wheels) {
    const [zW, zP] = pair(big, w.speedQ);
    // tous les pignons de l'arbre tournent dans le même sens : renvoi si besoin
    w.idler = wheels.length === 2 && w.onTube && Math.sign(OmT) !== Math.sign(OmP);
    const zI = w.idler ? 14 : 0;
    const m = (2 * d) / (zW + zP + 2 * zI);
    w.zW = zW; w.zP = zP; w.zI = zI;
    const rW = (m * zW) / 2, rP = (m * zP) / 2, rI = (m * zI) / 2;
    w.wheel = mesh(gearGeometry(zW, rW, { thick: 0.006, ring: w.onTube ? 0 : Math.min(0.035, rW * 0.12) }), mats.gears);
    w.wheel.position.y = w.y;
    group.add(w.wheel);
    w.pinion = mesh(gearGeometry(zP, rP, { thick: 0.006 }), mats.gears);
    w.pinion.position.set(d, w.y, 0);
    stand.add(w.pinion);
    if (zI) {
      w.idlerM = mesh(gearGeometry(zI, rI, { thick: 0.006 }), mats.gears);
      w.idlerM.position.set(rW + rI, w.y, 0);
      stand.add(w.idlerM);
      const st = mesh(keep(cyl(STUD_R, 0.02)), mats.pins);
      st.position.set(rW + rI, w.y - 0.02, 0); stand.add(st);
    }
    w.off = meshOffsets(zI ? [zW, zI, zP] : [zW, zP]);
  }
  const plateSleeve = mesh(keep(cyl(0.03, yPlate - 0.035 - yUB, 40)), mats.foot); // (canon du plateau, sous lui)
  plateSleeve.position.y = yUB; group.add(plateSleeve);
  const tube = mesh(keep(cyl(0.012, yBar(0, 0) + BAR_T / 2 - (yFrame + 0.006), 24)), mats.arms);
  tube.position.y = yFrame + 0.006; group.add(tube);
  const bridge = mesh(keep(new THREE.BoxGeometry(d + 0.06, 0.01, 0.045)), mats.foot);
  bridge.position.set((d + 0.03) / 2 - 0.015, yUB - 0.005, 0); stand.add(bridge);
  const frame = mesh(keep(new THREE.CylinderGeometry(d + 0.1, d + 0.1, 0.024, 120)), mats.foot);
  frame.position.y = yFrame - 0.012; stand.add(frame);
  const bearing = mesh(keep(cyl(0.03, 0.012, 32)), mats.pins);
  bearing.position.y = yFrame; stand.add(bearing);
  const pillar = mesh(keep(cyl(0.01, yUB - 0.01 - yFrame, 20)), mats.foot);
  pillar.position.set(d + 0.03, yFrame, 0.03); stand.add(pillar);
  const shaft = mesh(keep(cyl(0.0055, yRing + 0.01 - yFrame, 16)), mats.pins);
  shaft.position.set(d, yFrame, 0); stand.add(shaft);
  const box = mesh(keep(new THREE.CylinderGeometry(0.16, 0.19, 0.12, 64)), mats.foot);
  box.position.y = yFrame - 0.024 - 0.06; stand.add(box);
  const footTop = yFrame - 0.024 - 0.12;
  const foot = mesh(keep(cyl(0.11, footTop - yFloor - 0.04, 48, 0.07)), mats.foot);
  foot.position.y = yFloor + 0.04; stand.add(foot);
  const base = mesh(keep(new THREE.CylinderGeometry(0.42, 0.46, 0.04, 96)), mats.foot);
  base.position.y = yFloor + 0.02; stand.add(base);

  // ── animation : tau, temps de l'orbite ; bodyXY reçoit la position des astres
  function update(tau, bodyXY) {
    for (let j = 0; j < N; j++) {
      const t = tau + (TAU * j) / N, ch = chains[j];
      D.pivots(t, P);
      for (let i = 0; i < n; i++) {
        const g = ch.arm[i];
        g.position.x = P[2 * i]; g.position.z = -P[2 * i + 1];
        g.rotation.y = k[i] * t + phi[i];
        const psi = ((i ? k[i - 1] : 0) - k[i]) * t;
        for (const it of ch.idlers[i]) it.m.rotation.y = it.sign * (it.zA / it.z) * psi + it.off;
        if (g.userData.B) g.userData.B.rotation.y = g.userData.B.userData.off + phi[i - 1] - phi[i];
      }
      for (const { A, i } of ch.tipA) A.rotation.y = phi[i + 1] - phi[i];
      bodyXY[2 * j] = P[2 * n]; bodyXY[2 * j + 1] = P[2 * n + 1];
    }
    if (sun) sun.rotation.y = phi[0];
    for (const w of wheels) {
      const aW = w.Om * tau;
      if (w.onTube) w.wheel.rotation.y = k[0] * tau;
      if (w.zI) {
        w.idlerM.rotation.y = -(w.zW / w.zI) * aW + w.off[1];
        w.pinion.rotation.y = (w.zW / w.zP) * aW + w.off[2];
      } else w.pinion.rotation.y = -(w.zW / w.zP) * aW + w.off[1];
    }
    if (wheels[0]) shaft.rotation.y = wheels[0].pinion.rotation.y;
  }

  return {
    group, stand, update, design: D, yPlate, yTop, yBody, plateR, grooveCurves,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
