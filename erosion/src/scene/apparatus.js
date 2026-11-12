// L'appareil à l'écran : matières (aluminium brossé, acrylique clair, acier,
// inox, noir) et mouvements (le portique roule, la lame descend et pousse,
// la guillotine du déversoir descend avec le niveau de base, le flotteur du
// débitmètre monte avec le débit). La géométrie vient de gen/apparatus.js.
import * as THREE from 'three/webgpu';
import { lights as tLights } from 'three/tsl';
import { buildStatic, buildGantry, buildBlade, buildGate, buildFloat, DIM } from '../gen/apparatus.js';
import { TABLE, longProfile } from '../gen/table.js';

const HX = TABLE.Lx / 2, HZ = TABLE.Ly / 2;

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}

export function createApparatus(scene, { lite = false, lights = [] } = {}) {
  const L = tLights(lights);
  const M = (o) => { const m = new THREE.MeshPhysicalNodeMaterial(o); m.lightsNode = L; return m; };
  const mats = {
    // (aluminium microbillé, acier et inox satinés : les reflets de la lampe le
    // long des profilés étaient les points les plus vifs de l'image et tiraient l'œil hors du sable)
    alu: M({ color: 0xb9bbbe, metalness: 1, roughness: 0.52 }),
    acr: M({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
    steel: M({ color: 0xb4b5b6, metalness: 1, roughness: 0.3 }),
    inox: M({ color: 0xbab8b4, metalness: 1, roughness: 0.42 }),
    black: M({ color: 0x141416, metalness: 0, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    base: M({ color: 0x2b2c2e, metalness: 0, roughness: 0.6 }),
    blade: M({ color: 0x9aa0a6, metalness: 1, roughness: 0.3 }),
  };
  mats.acr.side = THREE.DoubleSide;
  const root = new THREE.Group();
  scene.add(root);
  let statics = [];
  const gantry = new THREE.Group(), bladeG = new THREE.Group();
  root.add(gantry); gantry.add(bladeG);
  for (const [k, o] of Object.entries(buildGantry())) {
    // (le portique et le châssis ne portent pas d'ombre sur le paysage : une barre d'ombre en travers du sable se lirait comme un défaut ; seule la lame, au contact, en porte)
    const m = new THREE.Mesh(toGeometry(o), mats[k]); m.castShadow = false; m.receiveShadow = true; gantry.add(m);
  }
  let blade = null, gate = null, flt = null, specKey = '';

  function setRecipe(R, S) {
    const key = JSON.stringify([S.form, S.src]);
    if (key === specKey) return;
    specKey = key;
    for (const m of statics) { root.remove(m); m.geometry.dispose(); }
    statics = [];
    for (const [k, o] of Object.entries(buildStatic(S))) {
      const m = new THREE.Mesh(toGeometry(o), mats[k]);
      m.castShadow = false; m.receiveShadow = true;
      if (k === 'acr') m.renderOrder = 2;
      root.add(m); statics.push(m);
    }
    if (blade) { bladeG.remove(blade); blade.geometry.dispose(); }
    blade = new THREE.Mesh(toGeometry(buildBlade(S.form)), mats.blade);
    blade.castShadow = blade.receiveShadow = true;
    bladeG.add(blade);
    if (!gate) {
      gate = new THREE.Mesh(toGeometry(buildGate()), mats.inox); gate.castShadow = true; root.add(gate);
      flt = new THREE.Mesh(toGeometry(buildFloat()), mats.black); root.add(flt);
    }
    flt.visible = !!S.src;
    api.S = S;
  }

  const api = {
    root, gantry, bladeG, mats, S: null,
    setRecipe,
    // F : état du film (timeline.js)
    update(F) {
      const S = api.S;
      if (!S) return;
      const x = F.gantryX;
      gantry.position.set(x - HX, 0, 0);
      // la lame suit le programme de hauteur du gabarit : son bord bas est la surface b₀
      const xs = Math.min(TABLE.Lx, Math.max(0, x));
      bladeG.position.set(0, longProfile(S.form, xs) + F.bladeLift, 0);
      // (la lame ne porte d'ombre que près du sable : garée, son ombre rasante traverserait le paysage)
      if (blade) blade.castShadow = F.bladeLift < 0.05 && x > -0.01;
      gate.position.set(HX + 0.006, Math.max(0.006, F.base), 0);
      if (flt) {
        const q = F.inflow / 0.0009; // (débit relatif à la graduation haute)
        const zc = S.src ? S.src.y - HZ : 0, w = S.src ? Math.max(0.06, S.src.w) / 2 + 0.02 : 0;
        flt.position.set(-HX - 0.004 - 0.12, 0.148 + 0.16 * Math.min(1, Math.sqrt(Math.max(0, q))), zc - w - 0.02);
      }
    },
  };
  return api;
}
