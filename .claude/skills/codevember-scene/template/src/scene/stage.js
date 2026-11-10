// Plateau de démonstration : lampe à ombres douces, deux contre-jours, sol
// procédural, et des pièces générées dans les workers, animées en boucle
// parfaite (nombres entiers de tours par boucle).
//
// (À REMPLACER par la scène du thème. Garder les principes :
//  - update(R, phase) ne dépend que de la recette et de la phase ;
//  - un maillage reçoit son matériau quand SA géométrie est arrivée, et un
//    matériau neuf à chaque nouvelle géométrie (l'ancien est libéré) : three.js
//    ne recompile pas un objet dont on change seulement la géométrie ;
//  - toutes les lumières sont créées une fois, dans un ordre fixe, au premier
//    niveau de la scène : changer leur ordre recompile tous les matériaux.)
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';

const TAU = Math.PI * 2;
const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}

const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });
const finishKey = (f) => signature(f); // (ce qui impose une recompilation)

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 0.7, 2); // (décroissance physique : intensité en candelas)
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2; key.shadow.camera.far = 30;
  const rims = [new THREE.SpotLight(0xffffff, 300, 0, 0.6, 0.9, 2), new THREE.SpotLight(0xffffff, 100, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false; // (mobile : une lumière de moins par pixel)
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }

  // ── Sol ──
  const floorGeo = new THREE.CircleGeometry(30, 96).rotateX(-Math.PI / 2);
  {
    const n = floorGeo.attributes.position.count;
    const surf = new Uint8Array(n * 4).fill(0);
    const tan = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { surf[i * 4] = 255; surf[i * 4 + 3] = 128; tan[i * 4] = 1; tan[i * 4 + 3] = 1; }
    floorGeo.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
    floorGeo.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  }
  const floor = new THREE.Mesh(floorGeo);
  floor.receiveShadow = true;
  floor.position.y = -1.1;
  scene.add(floor);
  let floorFin = null;

  // ── Pièces ──
  const group = new THREE.Group();
  scene.add(group);
  let R = null, slots = [], pending = 0, total = 0, version = 0;

  function makeMaterial(slot) {
    const old = slot.mesh.material;
    slot.U = finishU(slot.finish);
    slot.key = finishKey(slot.finish);
    slot.mesh.material = buildPieceMaterial(slot.finish, slot.U, slot.M);
    if (old && old !== slot.mesh.material) old.dispose?.();
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    for (const s of slots) { group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material?.dispose?.(); }
    slots = [];
    total = R.pieces.length; pending = total;
    R.pieces.forEach((P, i) => {
      const M = { seedOff: uniform(new THREE.Vector3(i * 1.37, 2.11, 0.5)) };
      const slot = { P, M, finish: P.finish, mesh: new THREE.Mesh(new THREE.BufferGeometry()), U: null, key: '' };
      slot.mesh.castShadow = slot.mesh.receiveShadow = true;
      slot.mesh.visible = false;
      slots.push(slot);
      gen.request({ kind: P.kind, size: P.size, round: P.round }, 'piece').then((o) => {
        if (v !== version) return;
        slot.mesh.geometry.dispose();
        slot.mesh.geometry = toGeometry(o);
        makeMaterial(slot); // (matériau construit APRÈS la géométrie)
        slot.mesh.visible = true;
        group.add(slot.mesh);
        pending--;
      }).catch((e) => { console.error(e); pending--; }); // (.catch : rattrape aussi une erreur levée dans le traitement de la réponse)
    });
    // sol
    const fk = finishKey(R.floor.finish);
    if (!floorFin || floorFin.key !== fk) {
      floor.material?.dispose?.();
      floorFin = { key: fk, U: finishU(R.floor.finish), M: { seedOff: uniform(new THREE.Vector3(9, 9, 9)) } };
      floor.material = buildPieceMaterial(R.floor.finish, floorFin.U, floorFin.M);
    }
  }

  // retouche d'une matière depuis le panneau : uniformes seulement, sauf si la
  // structure du shader change (motif, vernis, transmission…)
  function syncFinishes() {
    for (const s of slots) {
      if (!s.U) continue;
      if (finishKey(s.finish) !== s.key) makeMaterial(s);
      else { applyFinish(s.U.outer, s.finish.outer); applyFinish(s.U.inner, s.finish.inner); applyFinish(s.U.edge, s.finish.edge); s.U.wear.value = s.finish.wear; }
    }
  }

  const place = (l, az, el, r, target = [0, 0, 0]) => {
    l.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // ph : phase de la boucle [0, 1) ; tout mouvement y fait un nombre entier de tours
  function update(ph) {
    if (!R) return;
    const L = R.light;
    place(key, L.key.az, L.key.el, 9);
    key.color.set(L.key.color); key.intensity = L.key.intensity; key.angle = L.key.angle; key.penumbra = L.key.penumbra;
    rims.forEach((l, i) => { const r = L.rim[i]; place(l, r.az, r.el, 8); l.color.set(r.color); l.intensity = r.intensity * (lite && i === 0 ? 1.4 : 1); });
    const Mo = R.motion, n = slots.length - 1;
    slots.forEach((s, i) => {
      const o = s.mesh;
      if (s.P.kind === 'hero') {
        o.rotation.set(0.35 * Math.sin(TAU * ph), TAU * Mo.spin * ph, 0);
        o.position.set(0, Mo.bobAmp * Math.sin(TAU * Mo.bob * ph), 0);
      } else {
        const a = TAU * (Mo.orbit * ph + (i - 1) / n);
        o.position.set(Math.cos(a) * 1.7, 0.35 * Math.sin(2 * a + i), Math.sin(a) * 1.7);
        o.rotation.set(TAU * ph * 2, a, 0);
      }
    });
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, syncFinishes, setShadowQuality, group, floor, key, rims,
    ready: () => pending === 0,
    progress: () => (total ? 1 - pending / total : 1),
  };
}

