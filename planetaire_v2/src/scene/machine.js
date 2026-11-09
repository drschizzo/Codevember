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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { designMachine, SLAB } from '../mech/design.js';
import { createDrive } from '../mech/drive.js';

const TAU = Math.PI * 2;
const BAR_T = 0.012, GEAR_T = 0.009, GEAR_DY = 0.016; // épaisseurs ; hauteur du train au-dessus du bras
const STUD_R = 0.0055;

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
  // émail des cadrans, encre des graduations, vis bleuies, courroies
  m.dial = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.86, 0.85, 0.8), metalness: 0, roughness: 0.25, clearcoat: 1 });
  m.ink = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.6 });
  m.screw = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.05, 0.08, 0.3), metalness: 1, roughness: 0.2, clearcoat: 0.6 });
  m.belt = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color().setRGB(0.05, 0.025, 0.015), roughness: 0.7 });
  // fond des sillons : la matière du plateau, assombrie et mate
  // (les courbes tournent dans un sens ou dans l'autre : rubans visibles des deux côtés)
  m.groove = new THREE.MeshPhysicalNodeMaterial({ metalness: 0.6, roughness: 0.75, side: THREE.DoubleSide });
  m.lip = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.18, side: THREE.DoubleSide });
  m.bridge = m.arms;
  m.bezel = m.foot;
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
export function flat(shape, thick, bevel = 0.25, curveSegments = 8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: thick * bevel * 0.5, bevelSize: thick * bevel * 0.5, bevelSegments: 1, curveSegments });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

// roue dentée : dents trapézoïdales centrées sur les angles 2πi/z, alésage,
// bras (rayons) pour les grandes roues, ou couronne (anneau) ; une denture plus
// fine que le pixel devient un simple disque
const gearCache = new Map();
// styles : spokes5 (horlogerie), spokes8 (astrolabe), holes (planétaire
// classique : ajours ronds), solid (atelier : pleine), pulley (poulie lisse),
// escape (roue d'échappement : dents pointues)
export function gearGeometry(z, r, { thick = GEAR_T, ring = 0, style = 'spokes5' } = {}) {
  const key = `${z}:${r.toFixed(5)}:${thick}:${ring}:${style}`;
  if (gearCache.has(key)) return gearCache.get(key);
  const m = (2 * r) / z, p = TAU / z;
  const rTip = r + m, rRoot = Math.max(r * 0.5, r - 1.25 * m);
  const shape = new THREE.Shape();
  if (m < 0.0014 || style === 'pulley') shape.absarc(0, 0, style === 'pulley' ? r : r, 0, TAU, false);
  else if (style === 'escape') {
    for (let i = 0; i < z; i++) {
      const a = i * p;
      const pts = [[rRoot, a - 0.42 * p], [rTip * 1.04, a + 0.05 * p], [rTip * 0.96, a + 0.18 * p], [rRoot, a + 0.3 * p]];
      pts.forEach(([rr, b], kk) => (i === 0 && kk === 0 ? shape.moveTo(rr * Math.cos(b), rr * Math.sin(b)) : shape.lineTo(rr * Math.cos(b), rr * Math.sin(b))));
    }
    shape.closePath();
  } else {
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
  // ajours : ronds (classique), ou bras de roue entre moyeu et serge
  if (!ring && style === 'holes' && r > 0.025) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU, h = new THREE.Path();
      h.absarc(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56, r * 0.17, 0, TAU, true);
      shape.holes.push(h);
    }
  } else if (!ring && style === 'pulley' && r > 0.025) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4, h = new THREE.Path();
      h.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.2, 0, TAU, true);
      shape.holes.push(h);
    }
  } else if (!ring && (style === 'spokes5' || style === 'spokes8' || style === 'escape') && r > 0.03) {
    const ns = style === 'spokes8' ? 8 : style === 'escape' ? 4 : 5, rIn = r * 0.26, rOut = rRoot - Math.max(0.006, r * 0.1);
    const wSp = style === 'spokes8' ? 0.035 : 0.06;
    const gapO = Math.max(0.004, r * wSp) / rOut, gapI = Math.max(0.004, r * wSp) / rIn;
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
// styles : plain (horlogerie : pont ajouré), lyre (classique : effilé vers le
// bout), truss (atelier : treillis à ajours triangulaires), scroll (astrolabe :
// chapelet d'ajours ronds)
function barGeometry(L, w, cw, style = 'plain') {
  const s = new THREE.Shape(), h = w / 2;
  if (style === 'lyre') {
    s.moveTo(L, -h * 0.55);
    s.absarc(L, 0, h * 0.55, -Math.PI / 2, Math.PI / 2, false);
    s.lineTo(0, h * 1.35);
    s.absarc(-cw, 0, h * 1.35, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.lineTo(L, -h * 0.55);
    if (L > 0.1) { const ho = new THREE.Path(); ho.absarc(L * 0.16, 0, h * 0.62, 0, TAU, true); s.holes.push(ho); }
    return flat(s, BAR_T, 0.3);
  }
  s.absarc(L, 0, h, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-cw, 0, h * 1.25, Math.PI / 2, (3 * Math.PI) / 2, false);
  s.closePath();
  if (style === 'truss' && L > 0.1) {
    const n = Math.max(2, Math.floor((L * 0.8) / (w * 1.3))), step = (L * 0.8) / n, x0 = L * 0.1, hh = h * 0.55;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * step + w * 0.12, xb = x0 + (i + 1) * step - w * 0.12, up = i % 2 ? 1 : -1, t = new THREE.Path();
      t.moveTo(xa, -up * hh); t.lineTo(xb, -up * hh); t.lineTo((xa + xb) / 2, up * hh); t.closePath();
      s.holes.push(t);
    }
    return flat(s, BAR_T, 0.3);
  }
  if (style === 'scroll' && L > 0.08) {
    const n = Math.max(1, Math.floor((L * 0.75) / (w * 1.1)));
    for (let i = 0; i < n; i++) { const ho = new THREE.Path(); ho.absarc(L * 0.14 + (i + 0.5) * ((L * 0.72) / n), 0, h * 0.5, 0, TAU, true); s.holes.push(ho); }
    return flat(s, BAR_T, 0.3);
  }
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
export const cyl = (r, h, seg = 20, r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, Math.max(h, 1e-4), seg); g.translate(0, Math.max(h, 1e-4) / 2, 0); return g; };

// ── Calage des dents ─────────────────────────────────────────────────────────
// gears alignées sur +x (centres croissants), angles relatifs à t = 0 : la
// première dent de la première roue pointe vers +x ; chaque roue suivante
// présente un creux à la dent qui la mène
export function meshOffsets(zs) {
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
export function ribbonGeometry(pts, w, h) {
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

// ── Fusion des pièces fixes ──────────────────────────────────────────────────
function mergeStatic(roots, update, keep) {
  const P = new Float64Array(2 * 64);
  const seen = new Map(); // mesh → matrice locale au premier instant
  const moved = new Set();
  [0.37, 2.91, 5.13].forEach((tau, s) => {
    update(tau, P);
    for (const r of roots) r.traverse((o) => {
      if (!o.isMesh) return;
      o.updateMatrix();
      if (!s) seen.set(o, o.matrix.clone());
      else if (!o.matrix.equals(seen.get(o))) moved.add(o);
    });
  });
  const parents = new Set();
  for (const o of seen.keys()) parents.add(o.parent);
  for (const parent of parents) {
    const buckets = new Map();
    for (const o of parent.children) {
      if (!o.isMesh || o.isInstancedMesh || moved.has(o) || o.children.length || !o.visible || o.renderOrder) continue;
      const k = `${o.material.id}:${o.castShadow}:${o.receiveShadow}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(o);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map((o) => {
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.clearGroups();
        return g.applyMatrix4(o.matrix);
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const m = new THREE.Mesh(keep(merged), list[0].material);
      m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
      for (const o of list) parent.remove(o);
      parent.add(m);
    }
  }
}

// ── Chaînes instanciées ──────────────────────────────────────────────────────
// Les bras restent des groupes (détachés de la scène) qui portent les
// transformations ; leurs pièces sont dessinées par des InstancedMesh (une
// instance par chaîne), avec leurs propres matières (une matière partagée entre
// objets instanciés et non instanciés fausse les vitesses de l'anticrénelage).
function instanceChains(chains, group, n, N) {
  const parts = [];
  const clones = new Map();
  const matFor = (m) => { if (!clones.has(m)) clones.set(m, m.clone()); return clones.get(m); };
  for (let i = 0; i < n; i++) {
    const gs = chains.map((ch) => ch.arm[i]);
    const kids = gs[0].children;
    // même structure dans toutes les chaînes (sinon, ce bras reste tel quel) ;
    // les pièces fusionnées sont des copies identiques d'une chaîne à l'autre
    const nv = (c) => c.geometry.attributes.position.count;
    const same = gs.every((g) => g.children.length === kids.length && g.children.every((c, ci) => c.isMesh && !c.children.length && c.material === kids[ci].material && nv(c) === nv(kids[ci])));
    if (!same) continue;
    kids.forEach((c0, ci) => {
      const im = new THREE.InstancedMesh(c0.geometry, matFor(c0.material), N);
      im.castShadow = c0.castShadow; im.receiveShadow = c0.receiveShadow;
      im.frustumCulled = false; // (les instances bougent : la sphère englobante serait fausse)
      group.add(im);
      parts.push({ im, gs, src: gs.map((g) => g.children[ci]) });
    });
    for (const g of gs) g.removeFromParent();
  }
  const M4 = new THREE.Matrix4();
  const groups = new Set(parts.flatMap((p) => p.gs));
  return () => {
    for (const g of groups) g.updateMatrix();
    for (const { im, gs, src } of parts) {
      for (let j = 0; j < N; j++) { src[j].updateMatrix(); im.setMatrixAt(j, M4.multiplyMatrices(gs[j].matrix, src[j].matrix)); }
      im.instanceMatrix.needsUpdate = true;
    }
  };
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
const CLEAR = 0.05;      // du plateau au dessous de la pile (hauteur des galets de l'étoile)
const BODY_CLEAR = 0.07;  // du sommet de la pile au plan des astres
const GAP = 0.004;        // jeu entre un bras et le train qu'il porte

// archétypes : style des roues, des bras, transmission (courroies : atelier)
export const ARCHETYPES = {
  horlogerie: { label: 'Mouvement d’horlogerie', gear: 'spokes5', bar: 'plain', belts: false },
  classique: { label: 'Planétaire classique', gear: 'holes', bar: 'lyre', belts: false },
  atelier: { label: 'Atelier (courroies)', gear: 'solid', bar: 'truss', belts: true },
  astrolabe: { label: 'Astrolabe', gear: 'spokes8', bar: 'scroll', belts: false },
};

export function createMachine({ arms, N, mats, omegaFrac, yFloor = -0.72, archetype = 'horlogerie' }) {
  const D = designMachine(arms, N);
  const AR = ARCHETYPES[archetype] || ARCHETYPES.horlogerie;
  const GS = { style: AR.gear };
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
  // le plateau : un peu plus que ce que balaient les chaînes ; le mouvement est
  // sur un bâti fixe autour de lui (mech/drive.js)
  const plateR = Math.max(1.15, reach + 0.12);
  const plate = mesh(keep(new THREE.CylinderGeometry(plateR, plateR, 0.06, 180)), mats.plate);
  plate.position.y = yPlate - 0.03;
  group.add(plate);
  const rim = mesh(keep(new THREE.TorusGeometry(plateR - 0.02, 0.016, 12, 220)), mats.arms);
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
    const floor = mesh(keep(ribbonGeometry(pts, 0.032, yGroove)), mats.groove, false);
    group.add(floor);
    for (const sd of [-1, 1]) {
      // lèvres du sillon (chanfrein qui accroche la lumière)
      const lipPts = new Float32Array(pts.length);
      for (let s = 0; s < m; s++) {
        const a2 = (s + m - 1) % m, b2 = (s + 1) % m;
        let tx = pts[2 * b2] - pts[2 * a2], ty = pts[2 * b2 + 1] - pts[2 * a2 + 1];
        const l = Math.hypot(tx, ty) || 1;
        lipPts[2 * s] = pts[2 * s] - (ty / l) * sd * 0.017;
        lipPts[2 * s + 1] = pts[2 * s + 1] + (tx / l) * sd * 0.017;
      }
      group.add(mesh(keep(ribbonGeometry(lipPts, 0.003, yPlate + 0.0007)), mats.lip, false));
    }
  }));

  // ── centre : poteau fixé au plateau (porte la roue solaire, au-dessus de
  // l'étoile), tube tournant autour de lui (porte l'étoile)
  const train0 = D.trains[1];
  const ySun = yGear(0, 0);
  const post = mesh(keep(cyl(0.011, ySun + GEAR_T / 2 + 0.01 - yPlate)), mats.pins);
  post.position.y = yPlate; group.add(post);
  let sun = null;
  if (train0) {
    sun = mesh(gearGeometry(train0.gears[0].z, train0.gears[0].r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
    sun.position.y = ySun;
    group.add(sun);
  }
  const starHub = mesh(keep(cyl(0.045, BAR_T * 1.8, 32)), mats.arms);
  starHub.position.y = yBar(0, 0) - BAR_T * 0.9;
  group.add(starHub);
  const finial = mesh(keep(new THREE.SphereGeometry(0.018, 20, 12)), mats.pins);
  finial.position.y = ySun + GEAR_T / 2 + 0.01;
  group.add(finial);

  // planétaire classique : sphère armillaire au sommet du poteau, si aucun astre
  // ne passe au-dessus du centre
  let armillary = null;
  {
    let rMin = Infinity;
    const Pq = new Float64Array(2 * n + 2);
    for (let s = 0; s < 256; s++) { D.pivots((TAU * s) / 256, Pq); rMin = Math.min(rMin, Math.hypot(Pq[2 * n], Pq[2 * n + 1])); }
    if (archetype === 'classique' && rMin > 0.2) {
      armillary = new THREE.Group();
      const ra = 0.07;
      for (let i = 0; i < 3; i++) { const t = mesh(keep(new THREE.TorusGeometry(ra, 0.003, 8, 64)), mats.arms); t.rotation.set(Math.PI / 2 + (i === 1 ? 0.41 : 0), i * 1.05, 0); armillary.add(t); }
      const globe = mesh(keep(new THREE.SphereGeometry(ra * 0.3, 24, 12)), mats.arms2); armillary.add(globe);
      armillary.position.y = yPlate + CLEAR + D.height + 0.04;
      group.add(armillary);
      group.add(Object.assign(mesh(keep(cyl(0.004, armillary.position.y - yPlate)), mats.pins), { position: new THREE.Vector3(0, yPlate, 0) }));
    }
  }

  // ── les chaînes
  const chains = [];
  const barGeos = L.map((l, i) => keep(barGeometry(l, D.barW[i], D.cw[i], AR.bar)));
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
      const hubR = Math.max(0.009, D.barW[i] * 0.5);
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
      if (tr && AR.belts) {
        // courroie de A à B : ouverte si le rapport est positif, croisée sinon
        const rA = tr.gears[0].r, rB = tr.gears[tr.gears.length - 1].r, Ld = L[i], yb = yGear(i, j) - oy, pts = [];
        if (tr.ratio > 0) {
          const al = Math.asin(Math.max(-1, Math.min(1, (rA - rB) / Ld)));
          for (let q = 0; q <= 32; q++) { const b = Math.PI / 2 + al + (q / 32) * (Math.PI - 2 * al); pts.push(new THREE.Vector3(Math.cos(b) * rA, yb, -Math.sin(b) * rA)); }
          for (let q = 0; q <= 32; q++) { const b = -Math.PI / 2 - al + (q / 32) * (Math.PI + 2 * al); pts.push(new THREE.Vector3(Ld + Math.cos(b) * rB, yb, -Math.sin(b) * rB)); }
        } else {
          const be = Math.acos(Math.max(-1, Math.min(1, (rA + rB) / Ld)));
          for (let q = 0; q <= 32; q++) { const b = be + (q / 32) * (TAU - 2 * be); pts.push(new THREE.Vector3(Math.cos(b) * rA, yb + 0.0012 * Math.sin(q / 5), -Math.sin(b) * rA)); }
          for (let q = 0; q <= 32; q++) { const b = Math.PI - be - (q / 32) * (TAU - 2 * be); pts.push(new THREE.Vector3(Ld + Math.cos(b) * rB, yb, -Math.sin(b) * rB)); }
        }
        g.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 200, Math.max(0.0012, rB * 0.06), 5, true)), mats.belt, false));
      } else if (tr) {
        tr.gears.forEach((gear, gi) => {
          if (gear.role !== 'I') return;
          const yg = yGear(i, j) - oy;
          const stud = mesh(keep(cyl(STUD_R, yg + GEAR_T / 2 + 0.0015 - top)), mats.pins);
          stud.position.set(gear.x, top, 0);
          g.add(stud);
          const gm = mesh(gearGeometry(gear.z, gear.r, GS), mats.gears);
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
          const A = mesh(gearGeometry(trNext.gears[0].z, trNext.gears[0].r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
          A.position.set(L[i], yGear(i + 1, j) - oy, 0);
          g.add(A);
          ch.tipA.push({ A, i });
        }
      } else {
        const pin = mesh(keep(cyl(0.007, yBody - 0.03 - (oy + top))), mats.pins);
        pin.position.set(L[i], top, 0);
        g.add(pin);
        const cup = mesh(keep(new THREE.CylinderGeometry(0.02, 0.009, 0.016, 20)), mats.pins);
        cup.position.set(L[i], yBody - 0.024 - oy, 0);
        g.add(cup);
      }
      // galets : colonnes du dessous du bras jusqu'aux sillons, patins
      for (const u of D.supports[i] || []) {
        const x = u * L[i], yFoot = yPlate + 0.006 - oy;
        const col = mesh(keep(cyl(0.008, bottom - yFoot)), mats.pins);
        col.position.set(x, yFoot, 0);
        g.add(col);
        const shoe = mesh(keep(cyl(0.014, 0.01, 20, 0.009)), mats.foot);
        shoe.position.set(x, yPlate + 0.0004 - oy, 0);
        g.add(shoe);
        const collar = mesh(keep(cyl(0.013, 0.008, 20)), mats.pins);
        collar.position.set(x, bottom - 0.004, 0);
        g.add(collar);
      }
      // roue B du train précédent : solidaire de ce bras, sous lui, et son canon
      const trPrev = D.trains[i];
      if (trPrev) {
        const gB = trPrev.gears[trPrev.gears.length - 1];
        const yB = yGear(i - 1, j) - oy;
        const B = mesh(gearGeometry(gB.z, gB.r, AR.belts ? { style: 'pulley' } : GS), mats.gears);
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

  // ── le mouvement : bâti, rouage, échappement ou vapeur, arbre de sortie,
  // denture du plateau, roue du tube central, pied
  const drive = createDrive({ archetype, plateR, yPlate, yFloor, k0: k[0], omegaFrac, mats, keep, plateGroup: group, stand, styleGear: AR.gear, yTubeTop: yBar(0, 0) + BAR_T / 2 });

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
    drive.update(tau);
    if (armillary) armillary.rotation.y = tau * 0.2;
  }

  // ── pièces fixes fusionnées : chaque bras, le plateau et le bâti portent des
  // dizaines de pièces solidaires (vis, rubis, colonnes, galets, roues calées…)
  // qui ne bougent pas dans le repère de leur parent. On les repère en faisant
  // tourner la machine à trois instants, puis on fusionne, parent par parent,
  // celles qui partagent une matière : 4 à 6 fois moins d'appels de dessin.
  mergeStatic([group, stand], update, keep);
  // puis les N chaînes, identiques à un décalage de phase près : chaque pièce
  // d'un bras devient un seul dessin instancié N fois
  const syncInstances = instanceChains(chains, group, n, N);
  const updateAll = (tau, xy) => { update(tau, xy); syncInstances(); };
  syncInstances();

  return {
    group, stand, update: updateAll, design: D, yPlate, yTop, yBody, plateR, bezelR: drive.bezelR, grooveCurves,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
