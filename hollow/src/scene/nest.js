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
  buildShellMaterial, buildShadowMaterial, finishUniforms, applyFinish, signature, tpmsUniforms, applyTpms, poreUniforms, applyPores,
  crystalUniforms, applyCrystal, buildCrystalMaterial, gemUniforms, applyGem, buildGemMaterial, paneUniforms, applyPane, buildPaneMaterial,
} from './materials.js';
import { crystalGeometry } from '../gen/crystals.js';
import { gemGeometry, spineGeometry } from '../gen/jewels.js';
import { IMPLICIT } from '../types.js';
import { isRigged, rigUniforms, applyRig } from './rig.js';

export const MAIN = 1, CORE = 2, KEY = 4; // masques de calques
export const X_MIN = -2.3;                // au-delà (coquilles derrière la caméra) : noyées dans le brouillard

const Z = new THREE.Vector3(0, 0, 1);
const _qz = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _axis = new THREE.Vector3();

function toGeometry(o, bounds = 1.05) {
  const g = new THREE.BufferGeometry();
  // (normale et tangente éventuellement entières, normalisées : voir gen/worker.js)
  const packed = (a) => !(a instanceof Float32Array);
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3, packed(o.normal)));
  if (o.tangent) g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4, packed(o.tangent)));
  if (o.surf) g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  if (o.color) g.setAttribute('color', new THREE.BufferAttribute(o.color, 3));
  if (o.center) g.setAttribute('center', new THREE.BufferAttribute(o.center, 3));
  if (o.bev) g.setAttribute('bev', new THREE.BufferAttribute(o.bev, 4, packed(o.bev)));
  if (o.rigA) { g.setAttribute('rigA', new THREE.BufferAttribute(o.rigA, 4)); g.setAttribute('rigB', new THREE.BufferAttribute(o.rigB, 4)); }
  if (o.index) g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), bounds);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-bounds, -bounds, -bounds), new THREE.Vector3(bounds, bounds, bounds));
  return g;
}

const placeholder = new THREE.BufferGeometry();

// Ornements (instances) : géométries par variante, et matériau. Les épines
// ont les finitions de la coquille (la tranche), dans leur propre matériau :
// partagé avec les coquilles, le calcul des vecteurs vitesse se dérègle) et
// projettent une ombre (sans en recevoir) ; cristaux et pierres sont
// transmissifs, sans ombre.
const ORNAMENTS = {
  crystals: { geos: [0, 1, 2].map((v) => toGeometry(crystalGeometry(v), 1.2)), material: (d) => d.crystalMat },
  gems: { geos: [toGeometry(gemGeometry(), 1.2)], material: (d) => d.gemMat },
  spines: { geos: [toGeometry(spineGeometry(), 1.2)], material: (d) => d.spineMat, shadow: true, selfShadow: false },
  panes: { mesh: true, material: (d) => d.paneMat, shadow: true, selfShadow: false }, // (vitraux : un maillage, pas des instances)
};
const needsOrnaments = (g) => (g.crystals || 0) > 0 || (g.setting === 'gem' && g.rivets > 0) || (g.spines || 0) > 0 || !!g.panes;

class Design {
  constructor(nest, index) {
    this.nest = nest;
    this.index = index;
    this.geoms = [null, null, null, null]; // 0–2 : affichage ; 3 : ombres
    this.specKey = '';
    this.pending = null; // lot de géométries en cours de génération
    this.orn = []; // ornements : [{ kind, variant, attr }]
    this.copies = [];
    this.material = null;
    this.sig = '';
  }

  // (re)lit la couche de la recette : géométrie (asynchrone), matériau, ornements
  set(layer) {
    this.layer = layer;
    this.syncMaterial();
    // Géométrie (et ornements) : tous les niveaux sont demandés ensemble et
    // basculés d'un coup quand le dernier arrive — jamais de mélange entre
    // l'ancienne et la nouvelle forme, ni de niveau qui change de forme.
    const key = `${layer.type}|${JSON.stringify(layer.geo)}`;
    if (key !== this.specKey) {
      this.specKey = key;
      // (surfaces minimales : les ombres utilisent le niveau moyen, pas de niveau 3)
      const isT = IMPLICIT.has(layer.geo.type), orn = needsOrnaments(layer.geo);
      const lods = isT ? [2, 1, 0] : [3, 2, 1, 0];
      const batch = { key, need: lods.length + (orn ? 1 : 0), got: 0, geoms: [null, null, null, null], ornaments: null };
      this.pending = batch;
      const arrived = () => {
        batch.got++;
        this.nest.onProgress?.();
        if (batch.got === batch.need && this.pending === batch) this.commit(batch, isT);
      };
      for (const lod of lods) {
        this.nest.gen.request(layer.geo, lod).then((out) => {
          if (this.pending !== batch || this.disposed) return;
          batch.geoms[lod] = toGeometry(out);
          arrived();
        }).catch((e) => { if (e.message !== 'cancelled') console.error(e); });
      }
      if (orn) {
        this.nest.gen.request(layer.geo, 0, 'ornaments').then((out) => {
          if (this.pending !== batch || this.disposed) return;
          batch.ornaments = out;
          arrived();
        }).catch((e) => console.error(e));
      }
    }
    if (this.crystalU) applyCrystal(this.crystalU, layer.crystal);
    if (this.gemU && layer.gem) applyGem(this.gemU, layer.gem);
    if (this.paneU && layer.pane) applyPane(this.paneU, layer.pane);
  }

  // bascule atomique vers la nouvelle forme
  commit(batch, isT) {
    const old = [...this.geoms];
    this.geoms = batch.geoms;
    if (isT) this.geoms[3] = this.geoms[1]; // (ombres = niveau moyen)
    for (const c of this.copies) {
      c.display.forEach((m, l) => { m.geometry = this.geoms[l]; });
      c.proxy.geometry = this.geoms[3];
    }
    for (const g of new Set(old)) if (g && !this.geoms.includes(g)) g.dispose(); // (une géométrie peut servir à deux niveaux)
    this.setOrnaments(batch.ornaments);
    this.pending = null;
    this.nest.onProgress?.();
  }

  get ready() { return !this.pending && !!this.geoms[0]; }
  get progress() { return this.pending ? this.pending.got / this.pending.need : 1; }

  syncMaterial() {
    const f = this.layer.finish;
    const g = this.layer.geo;
    const isT = g.type === 'tpms', rig = isRigged(g), pore = (g.pores || 0) > 0;
    const sig = `${signature(f)}|${g.type}` + (isT ? `|tpms:${g.surface}:${g.sheet}` : '') + (rig ? '|rig' : '') + (pore ? '|pores' : '');
    if (pore) { this.PU ??= poreUniforms(); applyPores(this.PU, g); }
    if (isT) { this.TU ??= tpmsUniforms(); applyTpms(this.TU, g); }
    if (rig) { this.RU ??= rigUniforms(); applyRig(this.RU, g); }
    if (!this.U) {
      this.U = {
        outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge),
        wear: uniform(f.wear), groove: uniform(f.groove || 0), grooveAt: uniform(f.grooveAt ?? 0.5), seam: uniform(f.seam || 0),
      };
    } else {
      applyFinish(this.U.outer, f.outer); applyFinish(this.U.inner, f.inner); applyFinish(this.U.edge, f.edge);
      this.U.wear.value = f.wear;
      this.U.groove.value = f.groove || 0;
      this.U.grooveAt.value = f.grooveAt ?? 0.5;
      this.U.seam.value = f.seam || 0;
    }
    if (sig !== this.sig) {
      this.sig = sig;
      const old = this.material;
      this.material = buildShellMaterial(f, this.U, {
        tpms: isT ? { spec: g, U: this.TU } : null, rig: rig ? this.RU : null, pore: pore ? this.PU : null,
        meshNormal: IMPLICIT.has(g.type) && !isT,
      });
      const oldSpine = this.spineMat;
      this.spineMat = buildShellMaterial(f, this.U);
      for (const c of this.copies) {
        for (const m of c.display) m.material = this.material;
        for (const m of c.ornaments) if (m.userData.kind === 'spines') m.material = this.spineMat;
      }
      if (old) old.dispose();
      oldSpine?.dispose();
      // ombre : les pièces animées s'y déforment comme à l'image
      const oldShadow = this.shadowMat;
      this.shadowMat = rig || pore ? buildShadowMaterial(rig ? this.RU : null, pore ? this.PU : null) : null;
      for (const c of this.copies) c.proxy.material = this.shadowMat || this.nest.shadowMat;
      oldShadow?.dispose();
    }
  }

  setOrnaments(out) {
    for (const c of this.copies) { for (const m of c.ornaments) c.group.remove(m); c.ornaments = []; }
    for (const o of this.orn) o.geometry?.dispose();
    this.orn = [];
    if (!out) return;
    if (out.crystals && !this.crystalMat) {
      this.crystalU = crystalUniforms(this.layer.crystal);
      this.crystalMat = buildCrystalMaterial(this.crystalU);
    }
    if (out.gems && !this.gemMat) {
      this.gemU = gemUniforms(this.layer.gem);
      this.gemMat = buildGemMaterial(this.gemU);
    }
    if (out.panes && !this.paneMat) {
      this.paneU = paneUniforms(this.layer.pane);
      this.paneMat = buildPaneMaterial(this.paneU);
    }
    if (out.panes?.index.length) this.orn.push({ kind: 'panes', geometry: toGeometry(out.panes) });
    const attr = (m, idx) => {
      const a = new Float32Array(idx.length * 16);
      idx.forEach((i, k) => a.set(m.subarray(i * 16, i * 16 + 16), k * 16));
      return new THREE.InstancedBufferAttribute(a, 16);
    };
    for (const kind of Object.keys(ORNAMENTS)) {
      const o = out[kind];
      if (!o || !o.count || ORNAMENTS[kind].mesh) continue;
      // une série d'instances par variante
      ORNAMENTS[kind].geos.forEach((_, v) => {
        const idx = [];
        for (let i = 0; i < o.count; i++) if ((o.variants?.[i] ?? 0) === v) idx.push(i);
        if (idx.length) this.orn.push({ kind, variant: v, attr: attr(o.matrices, idx) });
      });
    }
    for (const c of this.copies) this.attachOrnaments(c);
  }

  attachOrnaments(c) {
    c.ornaments = this.orn.map(({ kind, variant, attr, geometry }) => {
      const K = ORNAMENTS[kind];
      let m;
      if (K.mesh) m = new THREE.Mesh(geometry, K.material(this));
      else { m = new THREE.InstancedMesh(K.geos[variant], K.material(this), attr.count); m.instanceMatrix = attr; }
      m.frustumCulled = false;
      m.castShadow = !!K.shadow;
      m.receiveShadow = K.selfShadow !== false; // (cônes fins : leur propre ombre les noircirait)
      m.layers.mask = 0;
      m.userData.kind = kind;
      c.group.add(m);
      return m;
    });
  }

  ensureCopies(n) {
    while (this.copies.length < n) {
      const group = new THREE.Group();
      const display = [0, 1, 2].map((l) => { // (niveaux affichés ; le 3 sert aux ombres)
        const m = new THREE.Mesh(this.geoms[l] || placeholder, this.material);
        m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; m.layers.mask = 0;
        group.add(m);
        return m;
      });
      const proxy = new THREE.Mesh(this.geoms[3] || placeholder, this.shadowMat || this.nest.shadowMat);
      proxy.castShadow = true; proxy.receiveShadow = false; proxy.frustumCulled = false; proxy.layers.mask = 0;
      group.add(proxy);
      const c = { group, display, proxy, ornaments: [] };
      this.attachOrnaments(c);
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
    for (const g of new Set(this.geoms)) g?.dispose();
    this.material?.dispose();
    this.spineMat?.dispose();
    this.shadowMat?.dispose();
    this.crystalMat?.dispose();
    this.gemMat?.dispose();
    this.paneMat?.dispose();
    for (const o of this.orn) o.geometry?.dispose();
  }
}

export function createNest(scene, gen) {
  const root = new THREE.Group();
  root.name = 'nest';
  scene.add(root);
  const nest = { root, gen, shadowMat: buildShadowMaterial(), designs: [], onProgress: null, solo: null };
  let frame = 0;

  // applique la recette (les couches inchangées ne sont pas reconstruites)
  nest.setRecipe = (recipe) => {
    const L = recipe.layers;
    while (nest.designs.length > L.length) nest.designs.pop().dispose();
    while (nest.designs.length < L.length) nest.designs.push(new Design(nest, nest.designs.length));
    nest.designs.forEach((d, i) => d.set(L[i]));
  };
  nest.syncLayer = (i) => nest.designs[i]?.set(nest.designs[i].layer);
  // toutes les couches ont leur forme définitive (tous niveaux, cristaux)
  nest.ready = () => nest.designs.length > 0 && nest.designs.every((d) => d.ready);
  nest.progress = () => (nest.designs.length ? nest.designs.reduce((a, d) => a + d.progress, 0) / nest.designs.length : 0);

  // profondeur de naissance (au cœur) : la première couche entièrement cachée
  // par le cœur pendant toute la croissance de son ombre
  nest.birthDepth = (ratio, coreRel) => Math.ceil(Math.log(coreRel) / Math.log(ratio)) + 1;

  // s : { tau, phi, cycle, dive, ratio, D, coreRel, detail, pxPerUnit }
  // (cycle : nombre de boucles accomplies ; les instances gardent ainsi la même
  // couche d'une boucle à l'autre, et leurs vecteurs vitesse restent justes)
  nest.update = (s) => {
    const N = nest.designs.length;
    if (!N) return;
    const XB = nest.birthDepth(s.ratio, s.coreRel);
    const C = Math.ceil((XB - X_MIN + 1) / N) + 1;
    for (const d of nest.designs) { d.ensureCopies(C); for (const c of d.copies) c.group.visible = false; }
    const xCore = Math.log(s.coreRel) / Math.log(s.ratio);
    let shells = 0;
    const base = (s.cycle || 0) * N;
    for (let d = Math.ceil(s.tau + X_MIN); d <= Math.floor(s.tau + XB); d++) {
      const x = d - s.tau;
      const j = ((d % N) + N) % N, copy = ((Math.floor((d + base) / N) % C) + C) % C;
      const des = nest.designs[j], inst = des.copies[copy];
      if (nest.solo != null && nest.solo !== j) continue; // (débogage : une seule couche)
      inst.group.visible = true;
      // une instance qui reprend du service (autre couche, ou absente à l'image
      // précédente) n'a pas d'historique de mouvement valable
      const moved = inst.lastD !== d + base || inst.lastFrame !== frame - 1;
      inst.lastD = d + base;
      inst.lastFrame = frame;
      inst.group.scale.setScalar(s.D * s.ratio ** x);
      des.orient(inst.group.quaternion, s.tau, s.phi, N, s.dive);
      // niveau de détail selon la taille à l'écran (rayon en pixels) : les seuils
      // sont choisis pour que l'écart entre deux niveaux reste sous le pixel
      // (surfaces minimales : maillage implicite plus exigeant, seuils relevés)
      const rpx = x <= 0 ? Infinity : ((s.D * s.ratio ** x) / s.D) * s.pxPerUnit * s.detail * (IMPLICIT.has(des.layer.geo.type) ? 1.8 : 1);
      // (la tranche a sa normale par pixel : les niveaux ne diffèrent plus que par
      // la silhouette des biseaux, d'où des seuils plus hauts)
      let lod = rpx > 1100 ? 0 : rpx > 280 ? 1 : 2;
      while (lod < 2 && !des.geoms[lod]) lod++;
      while (lod > 0 && !des.geoms[lod]) lod--;
      // (affichée dès l'intérieur du cœur, qui la cache : elle en sort sans apparaître)
      const shown = des.geoms[lod] && x < xCore + 0.8;
      inst.display.forEach((m, l) => {
        const on = shown && l === lod;
        // d'avant en arrière (toutes les coquilles ont le même centre : le tri par
        // distance de three.js serait indécis) — la coquille traversée, puis les
        // suivantes vers le cœur ; les coquilles qui entourent la caméra en dernier
        m.renderOrder = x >= 0 ? 1 + x : 100 - x;
        m.userData.still = moved || !m.userData.on ? 0 : 1; // (vecteur vitesse nul à la première image)
        m.userData.on = on;
        m.userData.x = x; // (pièces animées)
        m.layers.mask = on ? MAIN : 0;
      });
      if (shown) shells++;
      // ombres : toutes les couches, pour les deux lumières. (Aucune coquille ne
      // cesse d'en projeter tant qu'elle est rendue : sinon l'éclairage saute.)
      inst.proxy.layers.mask = des.geoms[3] ? KEY | CORE : 0;
      inst.proxy.userData.birth = Math.min(1, Math.max(0, XB - x));
      inst.proxy.userData.x = x;
      const cr = shown && rpx > 25 && x > X_MIN + 0.5;
      for (const m of inst.ornaments) {
        m.renderOrder = x >= 0 ? 1.5 + x : 100.5 - x;
        m.userData.still = moved || !m.userData.on ? 0 : 1;
        m.userData.on = cr;
        m.userData.x = x;
        // (vitraux : leur ombre colorée naît avec la coquille, voir paneGrow)
        const g = Math.min(1, Math.max(0, (XB - 1.5 - x) / 2.5));
        m.userData.grow = g * g * (3 - 2 * g);
        // (les épines projettent leur ombre tant que la coquille en projette)
        m.layers.mask = (cr ? MAIN : 0) | (m.castShadow && des.geoms[3] ? KEY | CORE : 0);
      }
    }
    // les instances inutilisées perdent leur historique
    for (const des of nest.designs) for (const c of des.copies) if (!c.group.visible) {
      for (const m of c.display) m.userData.on = false;
      for (const m of c.ornaments) m.userData.on = false;
    }
    frame++;
    return { shells, birth: XB };
  };
  return nest;
}
