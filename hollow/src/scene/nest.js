// Le nid : N coquilles différentes (« modèles »), répétées à l'infini en
// profondeur, de rayon décroissant d'un facteur k d'une couche à la suivante.
//
// La plongée : à la profondeur relative x (0 = la coquille que la caméra
// traverse), une coquille a pour rayon D·kˣ ; x = d − τ où d est l'indice
// (entier) de la couche et τ l'avancée de la plongée. Le modèle d'une couche
// est d mod N, donc la scène à τ + N est identique à la scène à τ : la boucle
// est parfaite par construction. Tout ce qui ne dépend que de x (taille,
// lumière, brouillard, détail) est identique d'une couche à l'autre.
//
// La caméra traverse chaque coquille par son oculus (+z local). Les coquilles
// culbutent pendant leur remontée et s'immobilisent, oculus face à la caméra,
// à l'approche du passage (seule leur rotation autour de l'axe de visée reste
// libre).
//
// Ombres : chaque instance a un maillage d'affichage (LOD 0–2, calque
// principal) et un maillage d'ombre grossier (LOD 2, calques des lumières).
// Les cartes d'ombre ne voient que les maillages grossiers.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  buildShellMaterial, buildShadowMaterial, finishUniforms, applyFinish, signature,
  crystalUniforms, buildCrystalMaterial,
} from './materials.js';
import { crystalGeometry } from '../gen/crystals.js';

export const MAIN = 1, CORE = 2, KEY = 4; // masques de calques
export const X_MIN = -2.3;                // au-delà (coquilles derrière la caméra) : noyées dans le brouillard

const Z = new THREE.Vector3(0, 0, 1);
const _qz = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _axis = new THREE.Vector3();

function toGeometry(o, bounds = 1.05) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  if (o.tangent) g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  if (o.surf) g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  if (o.index) g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), bounds);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-bounds, -bounds, -bounds), new THREE.Vector3(bounds, bounds, bounds));
  return g;
}

const crystalGeos = [0, 1, 2].map((v) => toGeometry(crystalGeometry(v), 1.2));
const placeholder = new THREE.BufferGeometry();

class Design {
  constructor(nest, index) {
    this.nest = nest;
    this.index = index;
    this.geoms = [null, null, null];
    this.specKey = '';
    this.crystalKey = '';
    this.crystal = null; // { attrs: [InstancedBufferAttribute ×3] }
    this.copies = [];
    this.material = null;
    this.sig = '';
  }

  // (re)lit la couche de la recette : géométrie (asynchrone), matériau, cristaux
  set(layer) {
    this.layer = layer;
    this.syncMaterial();
    const key = JSON.stringify(layer.geo);
    if (key !== this.specKey) {
      this.specKey = key;
      const token = key;
      for (const lod of [2, 1, 0]) {
        this.nest.gen.request(layer.geo, lod).then((out) => {
          if (this.specKey !== token || this.disposed) return;
          const old = this.geoms[lod];
          this.geoms[lod] = toGeometry(out);
          for (const c of this.copies) {
            c.display[lod].geometry = this.geoms[lod];
            if (lod === 2) c.proxy.geometry = this.geoms[2];
          }
          if (old) old.dispose();
          this.nest.onProgress?.();
        }).catch((e) => { if (e.message !== 'cancelled') console.error(e); });
      }
    }
    // cristaux (géode)
    const ck = layer.type === 'geode' ? key : '';
    if (ck !== this.crystalKey) {
      this.crystalKey = ck;
      this.setCrystals(null);
      if (ck) {
        this.nest.gen.request(layer.geo, 0, 'crystals').then((out) => {
          if (this.crystalKey !== ck || this.disposed) return;
          this.setCrystals(out);
        }).catch((e) => console.error(e));
      }
    }
    if (this.crystalU) {
      const c = layer.crystal;
      this.crystalU.tip.value.set(c.tip); this.crystalU.base.value.set(c.base);
      this.crystalU.rough.value = c.rough; this.crystalU.dispersion.value = c.dispersion; this.crystalU.ior.value = c.ior;
    }
  }

  syncMaterial() {
    const f = this.layer.finish;
    const sig = signature(f);
    if (!this.U) {
      this.U = { outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) };
    } else {
      applyFinish(this.U.outer, f.outer); applyFinish(this.U.inner, f.inner); applyFinish(this.U.edge, f.edge);
      this.U.wear.value = f.wear;
    }
    if (sig !== this.sig) {
      this.sig = sig;
      const old = this.material;
      this.material = buildShellMaterial(f, this.U);
      for (const c of this.copies) for (const m of c.display) m.material = this.material;
      if (old) old.dispose();
    }
  }

  setCrystals(out) {
    for (const c of this.copies) { for (const m of c.crystals) c.group.remove(m); c.crystals = []; }
    this.crystal = null;
    if (!out) return;
    if (!this.crystalMat) {
      this.crystalU = crystalUniforms(this.layer.crystal);
      this.crystalMat = buildCrystalMaterial(this.crystalU);
    }
    // une série d'instances par variante de cristal
    const attrs = [0, 1, 2].map((v) => {
      const idx = [];
      for (let i = 0; i < out.count; i++) if (out.variants[i] === v) idx.push(i);
      const a = new Float32Array(idx.length * 16);
      idx.forEach((i, k) => a.set(out.matrices.subarray(i * 16, i * 16 + 16), k * 16));
      return new THREE.InstancedBufferAttribute(a, 16);
    });
    this.crystal = { attrs };
    for (const c of this.copies) this.attachCrystals(c);
  }

  attachCrystals(c) {
    if (!this.crystal) return;
    c.crystals = this.crystal.attrs.map((attr, v) => {
      const m = new THREE.InstancedMesh(crystalGeos[v], this.crystalMat, attr.count);
      m.instanceMatrix = attr;
      m.frustumCulled = false;
      m.layers.mask = 0;
      c.group.add(m);
      return m;
    });
  }

  ensureCopies(n) {
    while (this.copies.length < n) {
      const group = new THREE.Group();
      const display = [0, 1, 2].map((l) => {
        const m = new THREE.Mesh(this.geoms[l] || placeholder, this.material);
        m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; m.layers.mask = 0;
        group.add(m);
        return m;
      });
      const proxy = new THREE.Mesh(this.geoms[2] || placeholder, this.nest.shadowMat);
      proxy.castShadow = true; proxy.receiveShadow = false; proxy.frustumCulled = false; proxy.layers.mask = 0;
      group.add(proxy);
      const c = { group, display, proxy, crystals: [] };
      this.attachCrystals(c);
      this.nest.root.add(group);
      this.copies.push(c);
    }
  }

  // orientation de la couche (quaternion) — voir l'en-tête
  orient(q, tau, phi, N, dive) {
    const m = this.layer.motion;
    _qz.setFromAxisAngle(Z, Math.PI * 2 * m.spin * phi + m.phase);
    let a;
    if (dive) {
      const s = (((tau - this.index) / N) % 1 + 1) % 1;
      const w = Math.min(0.45, 1.25 / N), u = Math.min(1, Math.max(0, (s - w) / (1 - 2 * w)));
      a = Math.PI * 2 * m.tumble * u * u * u * (u * (u * 6 - 15) + 10);
    } else a = Math.PI * 2 * m.tumble * phi;
    _axis.fromArray(m.axis).normalize();
    _qa.setFromAxisAngle(_axis, a);
    return q.multiplyQuaternions(_qz, _qa);
  }

  dispose() {
    this.disposed = true;
    for (const c of this.copies) this.nest.root.remove(c.group);
    for (const g of this.geoms) g?.dispose();
    this.material?.dispose();
    this.crystalMat?.dispose();
  }
}

export function createNest(scene, gen) {
  const root = new THREE.Group();
  root.name = 'nest';
  scene.add(root);
  const nest = { root, gen, shadowMat: buildShadowMaterial(), designs: [], onProgress: null, solo: null };

  // applique la recette (les couches inchangées ne sont pas reconstruites)
  nest.setRecipe = (recipe) => {
    const L = recipe.layers;
    while (nest.designs.length > L.length) nest.designs.pop().dispose();
    while (nest.designs.length < L.length) nest.designs.push(new Design(nest, nest.designs.length));
    nest.designs.forEach((d, i) => d.set(L[i]));
  };
  nest.syncLayer = (i) => nest.designs[i]?.set(nest.designs[i].layer);

  // profondeur de naissance (au cœur) : la première couche entièrement cachée
  // par le cœur pendant toute la croissance de son ombre
  nest.birthDepth = (ratio, coreRel) => Math.ceil(Math.log(coreRel) / Math.log(ratio)) + 1;

  // s : { tau, phi, dive, ratio, D, coreRel, detail }
  nest.update = (s) => {
    const N = nest.designs.length;
    if (!N) return;
    const XB = nest.birthDepth(s.ratio, s.coreRel);
    const C = Math.ceil((XB - X_MIN + 1) / N) + 1;
    for (const d of nest.designs) { d.ensureCopies(C); for (const c of d.copies) c.group.visible = false; }
    const t0 = 1.15 * s.detail, t1 = 2.8 * s.detail;
    const xCore = Math.log(s.coreRel) / Math.log(s.ratio);
    let shells = 0;
    for (let d = Math.ceil(s.tau + X_MIN); d <= Math.floor(s.tau + XB); d++) {
      const x = d - s.tau;
      const j = ((d % N) + N) % N, copy = ((Math.floor(d / N) % C) + C) % C;
      const des = nest.designs[j], inst = des.copies[copy];
      if (nest.solo != null && nest.solo !== j) continue; // (débogage : une seule couche)
      inst.group.visible = true;
      inst.group.scale.setScalar(s.D * s.ratio ** x);
      des.orient(inst.group.quaternion, s.tau, s.phi, N, s.dive);
      // affichage : meilleur niveau disponible (cachée si entièrement dans le cœur)
      let lod = x < t0 ? 0 : x < t1 ? 1 : 2;
      while (lod < 2 && !des.geoms[lod]) lod++;
      while (lod > 0 && !des.geoms[lod]) lod--;
      const shown = des.geoms[lod] && x < xCore - 0.02;
      inst.display.forEach((m, l) => { m.layers.mask = shown && l === lod ? MAIN : 0; });
      if (shown) shells++;
      // ombres : toutes les couches pour la lampe frontale ; pour le cœur, celles
      // entre le cœur et la caméra (au-delà, la lumière du cœur est nulle)
      inst.proxy.layers.mask = des.geoms[2] ? KEY | (x > -0.35 ? CORE : 0) : 0;
      inst.proxy.userData.birth = Math.min(1, Math.max(0, XB - x));
      const cr = shown && x < 3.2 && x > X_MIN + 0.5 ? MAIN : 0;
      for (const m of inst.crystals) m.layers.mask = cr;
    }
    return { shells, birth: XB };
  };
  return nest;
}
