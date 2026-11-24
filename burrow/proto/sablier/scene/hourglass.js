// Le sablier : la caisse de verre qui tient le gel, le col, le bulbe soufflé,
// le métal du bulbe (lingot, flaque, filets), les platines, les colonnes, les
// tourillons, et le pied qui ne tourne pas.
//
// Tout ce qui tourne est dans `frame` (rotation autour de x, au pivot) ; le
// pied est dans `stand`. Le métal du bulbe : deux sphères (même rayon que
// l'intérieur du bulbe) coupées chacune par un plan — le lingot (solide, collé
// au plafond) et la flaque (liquide, au fond) ; la face arrière dessine la
// coupe (la surface libre, plane).
import * as THREE from 'three/webgpu';
import { Fn, uniform, positionWorld, positionLocal, vec3, vec4, float, dot, normalize, frontFacing, select, normalWorld, transformNormalToView, cameraViewMatrix, mix } from 'three/tsl';
import { BLOCK } from '../gen/burrows.js';
import { HG } from '../layout.js';
import { buildPieceMaterial, finishUniforms } from '../../../../shared/scene/materials.js';

// géométrie three → attributs attendus par le matériau commun (surf, tangent)
function prep(g, role = [255, 0, 0]) {
  const n = g.attributes.position.count;
  const surf = new Uint8Array(n * 4);
  const tint = 128;
  for (let i = 0; i < n; i++) { surf[i * 4] = role[0]; surf[i * 4 + 1] = role[1]; surf[i * 4 + 2] = role[2]; surf[i * 4 + 3] = tint; }
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
  if (g.attributes.uv && g.index) g.computeTangents();
  else {
    const t = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { t[i * 4] = 1; t[i * 4 + 3] = 1; }
    g.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
  }
  return g;
}

// profil tourné d'une colonne (baguettes, tores, gorges) : [rayon, y] de bas en haut
function columnProfile(r, L, style) {
  const P = [];
  const add = (rr, y) => P.push(new THREE.Vector2(rr, y));
  if (style === 'flat') { add(0.001, 0); add(r, 0); add(r, L); add(0.001, L); return P; }
  // base et chapiteau moulurés, fût légèrement galbé
  const ring = (y0, s) => { for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; add(r * (1.18 + 0.32 * Math.sin(a)), y0 + s * (i / 8) * 0.05); } };
  add(0.001, 0); add(r * 1.5, 0); add(r * 1.5, 0.02);
  ring(0.02, 1);
  add(r * 1.05, 0.085);
  for (let i = 1; i < 12; i++) { const y = 0.085 + (L - 0.17) * (i / 12); add(r * (1 + 0.08 * Math.sin(Math.PI * i / 12)), y); }
  add(r * 1.05, L - 0.085);
  ring(L - 0.07, 1);
  add(r * 1.5, L - 0.02); add(r * 1.5, L); add(0.001, L);
  return P;
}

export function createHourglass({ lite = false } = {}) {
  const frame = new THREE.Group(), stand = new THREE.Group();
  const U = {
    // métal du bulbe : plan de coupe (repère monde) n·x < k, pour le lingot et la flaque
    ingotN: uniform(new THREE.Vector3(0, 1, 0)), ingotK: uniform(-1),
    poolN: uniform(new THREE.Vector3(0, -1, 0)), poolK: uniform(-1),
    neck: uniform(0), drip: uniform(0),
    liquid: uniform(new THREE.Color(0.72, 0.73, 0.75)), solid: uniform(new THREE.Color(0.56, 0.6, 0.66)),
  };
  const metals = { frame: null, accent: null, stand: null };
  const parts = { frame: [], accent: [], stand: [] };
  const addPart = (group, role, geo, pos, rot = null) => {
    const m = new THREE.Mesh(prep(geo));
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    parts[role].push(m);
    return m;
  };

  // ── la caisse de verre (le gel est dessiné par gel.js) : cornières ──
  const cw = 0.03;
  const hx = BLOCK.hx + HG.caseT, hy = BLOCK.hy + HG.caseT, hz = BLOCK.hz + HG.caseT;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addPart(frame, 'accent', new THREE.BoxGeometry(cw, 2 * hy, cw), [sx * (hx - cw / 2 + 0.006), HG.blockY, sz * (hz - cw / 2 + 0.006)]);
  }
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) addPart(frame, 'accent', new THREE.BoxGeometry(2 * hx, cw, cw), [0, HG.blockY + sy * (hy - cw / 2 + 0.006), sz * (hz - cw / 2 + 0.006)]);
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) addPart(frame, 'accent', new THREE.BoxGeometry(cw, cw, 2 * hz), [sx * (hx - cw / 2 + 0.006), HG.blockY + sy * (hy - cw / 2 + 0.006), 0]);

  // ── platines ──
  const plateGeo = () => new THREE.BoxGeometry(2 * HG.plateX, HG.plate, 2 * HG.plateZ, 1, 1, 1);
  addPart(frame, 'frame', plateGeo(), [0, HG.plateBot - HG.plate / 2, 0]);
  addPart(frame, 'frame', plateGeo(), [0, HG.plateTop + HG.plate / 2, 0]);
  // bague du col sur la caisse, et sous la platine du haut
  addPart(frame, 'accent', new THREE.CylinderGeometry(0.075, 0.08, 0.035, 48), [0, HG.neckY0 + 0.0175, 0]);
  addPart(frame, 'accent', new THREE.CylinderGeometry(0.07, 0.06, 0.03, 48), [0, HG.plateTop - 0.015, 0]);
  // ── colonnes ──
  const L = HG.plateTop - HG.plateBot;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addPart(frame, 'frame', new THREE.LatheGeometry(columnProfile(HG.colR, L, 'turned'), 40), [sx * HG.colX, HG.plateBot, sz * HG.colZ]);
  }
  // ── traverses des tourillons et tourillons ──
  for (const sx of [-1, 1]) {
    addPart(frame, 'frame', new THREE.BoxGeometry(0.05, 0.08, 2 * HG.colZ), [sx * HG.colX, 0, 0]);
    const pinL = HG.uprightX + 0.07 - HG.colX;
    addPart(frame, 'accent', new THREE.CylinderGeometry(HG.pinR, HG.pinR, pinL, 32).rotateZ(Math.PI / 2), [sx * (HG.colX + pinL / 2), 0, 0]);
    addPart(frame, 'accent', new THREE.CylinderGeometry(0.06, 0.06, 0.03, 40).rotateZ(Math.PI / 2), [sx * (HG.colX + 0.04), 0, 0]);
  }
  // ── le pied (fixe) : deux montants, leurs patins, les paliers ──
  for (const sx of [-1, 1]) {
    const x = sx * HG.uprightX, H = HG.pivotY;
    addPart(stand, 'stand', new THREE.LatheGeometry(columnProfile(HG.uprightR, H + 0.06, 'turned'), 40), [x, 0, 0]);
    addPart(stand, 'stand', new THREE.BoxGeometry(0.16, HG.footH, 2 * HG.footL), [x, HG.footH / 2, 0]);
    addPart(stand, 'accent', new THREE.TorusGeometry(0.05, 0.018, 16, 40).rotateY(Math.PI / 2), [x, H, 0]);
  }

  // ── verre : caisse (bord fin), col, bulbe ──
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, ior: 1.5, thickness: 0.02, transparent: false });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(HG.bulbR, 64, 40), glass);
  bulb.position.set(0, HG.bulbC, 0);
  frame.add(bulb);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, HG.neckL + 0.02, 40, 1, true), glass);
  neck.position.set(0, HG.neckY0 + HG.neckL / 2, 0);
  frame.add(neck);

  // ── le métal du bulbe ──
  const metalMat = (nU, kU, solid) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: solid ? 0.26 : 0.04, side: THREE.DoubleSide });
    m.colorNode = solid ? vec3(U.solid) : vec3(U.liquid);
    m.maskNode = Fn(() => dot(positionWorld, nU).lessThan(kU))();
    // la face arrière vue par la coupe : la surface plane (normale = −n)
    m.normalNode = Fn(() => {
      const nV = cameraViewMatrix.mul(vec4(nU.negate(), 0)).xyz;
      return select(frontFacing, transformNormalToView(normalWorld), normalize(nV).negate());
    })();
    return m;
  };
  const rIn = HG.bulbR - HG.bulbT;
  const ingot = new THREE.Mesh(new THREE.SphereGeometry(rIn - 0.002, 64, 40), metalMat(U.ingotN, U.ingotK, true));
  const pool = new THREE.Mesh(new THREE.SphereGeometry(rIn - 0.002, 64, 40), metalMat(U.poolN, U.poolK, false));
  for (const m of [ingot, pool]) { m.position.set(0, HG.bulbC, 0); m.castShadow = true; frame.add(m); }
  // filet du col et goutte du bulbe (cylindres fins, échelle 0 quand rien ne coule)
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 12), new THREE.MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.04 }));
  thread.material.colorNode = vec3(U.liquid);
  frame.add(thread);
  const drip = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 12), thread.material);
  frame.add(drip);

  function setFinishes(F) {
    for (const role of ['frame', 'accent', 'stand']) {
      const fin = F[role];
      const Ut = { outer: finishUniforms(fin.outer), inner: finishUniforms(fin.inner), edge: finishUniforms(fin.edge), wear: uniform(fin.wear || 0) };
      const M = { seedOff: uniform(new THREE.Vector3(role.length * 1.3, 2.1, 0.7)) };
      const mat = buildPieceMaterial(fin, Ut, M);
      for (const m of parts[role]) { m.material?.dispose?.(); m.material = mat; }
    }
  }

  return { frame, stand, bulb, neck, ingot, pool, thread, drip, U, setFinishes, glass };
}
