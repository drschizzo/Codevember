// L'appareil à l'écran : matières (aluminium brossé, acrylique clair, acier,
// inox, noir) et mouvements (le portique roule, la lame descend et pousse,
// la guillotine du déversoir descend avec le niveau de base, le flotteur du
// débitmètre monte avec le débit). La géométrie vient de gen/apparatus.js.
import * as THREE from 'three/webgpu';
import { lights as tLights, uv, uniform, float, vec3, mix, abs, fract, smoothstep } from 'three/tsl';
import { noise } from './materials.js';
import { buildStatic, buildGantry, buildBlade, buildGate, buildFloat, DIM } from '../gen/apparatus.js';
import { TABLE, longProfile, crossProfile } from '../gen/table.js';

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

  // La nappe : l'eau qui déborde de la lèvre de la boîte et tombe sur le sable
  // (sans elle, l'eau naissait de rien sous la lèvre). Un ruban en parabole, plus
  // ou moins opaque selon le débit, parcouru de filets qui descendent (deux
  // lectures du bruit décalées d'une demi-période : la boucle est exacte).
  const nU = { flow: uniform(0), q: uniform(0) };
  const nMat = M({ color: 0xd9d2c6, metalness: 0, roughness: 0.06, transparent: true, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide });
  {
    const p0 = fract(nU.flow), p1 = fract(nU.flow.add(0.5)), w = abs(p0.sub(0.5)).mul(2);
    const st = (ph, o) => noise(vec3(uv().x.mul(26), uv().y.mul(5).sub(ph.mul(5)), o));
    const streak = mix(st(p0, 0.3), st(p1, 4.1), w);
    nMat.opacityNode = nU.q.mul(float(0.5).add(streak.mul(0.3))).mul(smoothstep(0.0, 0.08, uv().y)).clamp(0, 0.85);
  }
  const nappe = new THREE.Mesh(new THREE.BufferGeometry(), nMat);
  nappe.renderOrder = 3; nappe.visible = false;
  root.add(nappe);
  function buildNappe(S) {
    nappe.geometry.dispose();
    nappe.visible = false;
    if (!S.src) return;
    const zc = S.src.y - HZ, w = Math.max(0.06, S.src.w) / 2 + 0.02 - 0.008;
    // bout de la lèvre (voir gen/apparatus.js : goulotte inclinée de 0,02 m, pente −0,34/0,94)
    const x0 = -HX + 0.0188, y0 = 0.1112, v0 = 0.22, g = 9.81;
    const ground = longProfile(S.form, 0.03) + crossProfile(S.form, S.src.y) - 0.002;
    // durée de chute jusqu'au sable
    const vy = -0.34 * v0, tf = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0.002, y0 - ground))) / g;
    const NS = 16, NZ = 12, P = [], Uv = [], I = [];
    for (let i = 0; i <= NS; i++) {
      const t = (i / NS) * tf, x = x0 + 0.94 * v0 * t, y = y0 + vy * t - 0.5 * g * t * t;
      const ww = w * (1 - 0.12 * (i / NS)); // (la nappe se contracte en tombant)
      for (let j = 0; j <= NZ; j++) { P.push(x, y, zc - ww + (2 * ww * j) / NZ); Uv.push(j / NZ, 1 - i / NS); }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NZ; j++) { const a = i * (NZ + 1) + j, b = a + 1, c = a + NZ + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(Uv, 2));
    geo.setIndex(I); geo.computeVertexNormals();
    nappe.geometry = geo;
  }

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
    buildNappe(S);
    api.S = S;
  }

  const api = {
    root, gantry, bladeG, mats, S: null,
    setRecipe,
    // F : état du film (timeline.js)
    update(F, ph) {
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
      // la nappe : opacité selon le débit (0,12 L/s et plus : pleine)
      const qn = S.src ? Math.min(1, F.inflow / 0.00012) : 0;
      nU.q.value = qn; nappe.visible = qn > 0.002;
      nU.flow.value = (ph ?? 0) * Math.round((api.duration ?? 48) * 1.5);
      if (flt) {
        const q = F.inflow / 0.0009; // (débit relatif à la graduation haute)
        const zc = S.src ? S.src.y - HZ : 0, w = S.src ? Math.max(0.06, S.src.w) / 2 + 0.02 : 0;
        flt.position.set(-HX - 0.004 - 0.12, 0.148 + 0.16 * Math.min(1, Math.sqrt(Math.max(0, q))), zc - w - 0.02);
      }
    },
  };
  return api;
}
