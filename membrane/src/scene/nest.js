// Le nid : N couches différentes (« modèles »), répétées à l'infini en
// profondeur, de rayon décroissant d'un facteur q d'une couche à la suivante.
//
// À la profondeur relative x (0 : la couche que la caméra traverse), une
// couche a pour rayon D·qˣ ; x = d − τ, où d est l'indice de la couche et τ
// l'avancée. Le modèle d'une couche est d mod N : la scène à τ + N est
// identique à la scène à τ, la boucle est parfaite par construction. Tout —
// taille, orientation, instant de l'éclosion, visibilité — ne dépend que de x.
//
// L'éclosion d'une couche se joue entre x = open et x = end : la simulation
// (texture d'animation) et l'armature avancent avec x. Avant, la couche est
// close et respire ; après, elle entoure la caméra et se perd dans la brume.
//
// Instances : M emplacements (M multiple de N) ; l'emplacement j montre
// toujours le modèle j mod N, et ne change de couche qu'en passant de
// derrière la caméra (x = XMIN) au cœur (x = XMIN + M), invisible aux deux
// bouts — jamais de changement de géométrie, jamais de saut visible.
//
// Ordre de dessin : armatures et fibrilles d'abord ; puis les faces arrière
// des membranes, de l'extérieur vers l'intérieur ; puis les faces avant, de
// l'intérieur vers l'extérieur. Chaque face de membrane prend sa copie de
// l'image juste avant d'être dessinée : elle voit au travers tout ce qui est
// derrière elle, couches intérieures comprises.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { membraneGeometry, fibrilGeometry, lookUniforms, applyLook, lookSignature, buildMembraneMaterial, buildFibrilMaterial } from './membrane.js';
import { MEMBRANES, MEMBRANE_DEFAULTS, PHYS_KEYS } from '../membranes.js';
import { G } from './globals.js';
import { simulate, createPoser } from './gpusim.js';

export const MAIN = 1, KEY = 2, BACK = 4;
export const XMIN = -2.2, XMAX = 3.6;

const Z = new THREE.Vector3(0, 0, 1);
const _q1 = new THREE.Quaternion();
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function armatureGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  for (const k of ['rigA', 'rigB', 'rigC', 'rigD']) g.setAttribute(k, new THREE.BufferAttribute(o[k], 4));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return g;
}

// spécification envoyée au worker (tout ce qui change la simulation)
export function levelSpec(lv, R) {
  const phys = {};
  for (const k of PHYS_KEYS) phys[k] = lv.phys[k];
  return { arm: lv.arm, mem: { ...phys, seed: lv.seed }, sim: { ...R.sim }, inner: R.nest.ratio };
}

class Template {
  constructor(nest, index) {
    this.nest = nest; this.index = index;
    this.data = null; this.key = ''; this.vkey = ''; this.pending = null; this.version = 0;
    this.vessels = null;
    this.L = null; this.AU = null; this.info = null;
  }
  set(lv, R) {
    this.lv = lv;
    const spec = levelSpec(lv, R);
    const key = JSON.stringify(spec);
    // aspect : uniformes (sans recompilation tant que la signature ne change pas)
    const look = { ...MEMBRANE_DEFAULTS, ...lv.look };
    if (!this.L) this.L = lookUniforms(look); else applyLook(this.L, look);
    const f = lv.armFinish;
    const mkU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });
    const setU = (U, f) => { applyFinish(U.outer, f.outer); applyFinish(U.inner, f.inner); applyFinish(U.edge, f.edge); U.wear.value = f.wear; };
    const f2 = lv.accentFinish ?? f;
    if (!this.AU) { this.AU = mkU(f); this.AU2 = mkU(f2); } else { setU(this.AU, f); setU(this.AU2, f2); }
    this.sig = `${lookSignature(look)}|${signature(f)}|${signature(f2)}`;
    if (key !== this.key) {
      this.key = key;
      const job = { key };
      this.pending = job;
      this.simProgress = 0;
      this.nest.gen.request(spec, 'level').then((out) => {
        if (this.pending !== job || this.disposed) return null;
        return this.commit(out, job);
      }).catch((e) => { console.error(e); this.nest.onError?.(e); });
    }
    const vkey = `${lv.seed}:${look.vessels > 0 || look.capillary > 0}`;
    if (vkey !== this.vkey) {
      this.vkey = vkey;
      this.nest.gen.request({ seed: lv.seed }, 'vessels').then((v) => {
        if (this.disposed) return;
        const t = new THREE.DataTexture(v.data, v.size, v.size, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
        const old = this.vessels;
        this.vessels = t;
        this.version++;
        old?.dispose();
      });
    }
    this.lookSpec = look;
  }
  // la préparation est arrivée du worker : simulation sur le GPU
  async commit(out, job) {
    const n = this.nest, dev = n.renderer.backend.device;
    const prep = out.prep, a = this.lv.arm, ns = a.struggle ?? 0;
    const S = { ...prep.params, armDur: a.dur, st: { n: ns, a: a.strAmp ?? 0.35, f: ns > 0 ? (a.strFrac ?? 0.5) : 0 } };
    const fibT = n.storageAttr(Math.max(1, prep.nf));
    const t0 = performance.now();
    const gpu = await simulate(dev, prep, S, prep.nf ? n.gpuBuffer(fibT) : null, (k) => { this.simProgress = k; n.onProgress?.(); });
    if (this.pending !== job || this.disposed) { this.free({ gpu, fibT }); return; }
    const old = this.data;
    this.data = {
      prep, S, gpu, fibT, F: S.frames,
      geo: membraneGeometry(prep.geo), fib: prep.nf ? fibrilGeometry(prep.fib) : null, arm: armatureGeometry(out.armature), arm2: out.accent?.index.length ? armatureGeometry(out.accent) : null,
    };
    this.info = { ...prep.info, ...gpu.stats, gpuMs: Math.round(performance.now() - t0) };
    this.version++;
    this.pending = null;
    n.onProgress?.();
    // (les instances quittent l'ancienne version à leur prochaine mise à jour)
    if (old) setTimeout(() => this.free(old), 500);
  }
  free(d) {
    if (!d) return;
    for (const k of ['frames', 'meta', 'csr', 'bonds']) d.gpu?.[k]?.destroy();
    d.geo?.dispose(); d.fib?.dispose(); d.arm?.dispose(); d.arm2?.dispose();
  }
  get ready() { return !!this.data && !this.pending && !!this.vessels; }
  dispose() { this.disposed = true; this.free(this.data); this.vessels?.dispose(); }
}

class Slot {
  constructor(nest, j) {
    this.nest = nest; this.j = j;
    this.group = new THREE.Group();
    this.S = { f: uniform(0), fPrev: uniform(0), vis: uniform(1) };
    this.RU = { t: uniform(0), tPrev: uniform(0), dur: uniform(0.5), vis: uniform(1), style: uniform(0), sn: uniform(0), sa: uniform(0), sf: uniform(0), seedOff: uniform(new THREE.Vector3()) };
    this.meshes = {};
    this.built = '';
    this.lastX = null;
    nest.root.add(this.group);
  }
  get tpl() { return this.nest.templates[this.j % this.nest.templates.length]; }
  // (re)construit maillages et matériaux quand le modèle a changé
  sync() {
    const T = this.tpl;
    if (!T?.data || !T.vessels) return false;
    const key = `${T.index}:${T.version}:${T.sig}`;
    if (key === this.built) return true;
    this.built = key;
    for (const m of Object.values(this.meshes)) { this.group.remove(m); m.material.dispose(); if (m.userData.lite) m.userData.lite.dispose(); }
    this.meshes = {};
    const d = T.data, spec = T.lookSpec, n = this.nest;
    // tampons de pose de l'instance (écrits par le GPU à chaque image) — refaits
    // seulement si la taille change
    const VV = d.prep.VV;
    if (!this.pose || this.pose.VV !== VV) {
      if (this.pose) for (const k of ['cur', 'prv', 'nor']) n.freeAttr(this.pose[k]);
      this.pose = { VV, cur: n.storageAttr(VV), prv: n.storageAttr(VV), nor: n.storageAttr(VV) };
    }
    this.poser?.dispose();
    this.poser = createPoser(n.renderer.backend.device, d.gpu, d.prep, d.S, { cur: n.gpuBuffer(this.pose.cur), prv: n.gpuBuffer(this.pose.prv), nor: n.gpuBuffer(this.pose.nor) });
    const PT = { ...this.pose, fibT: d.fibT, nf: d.prep.nf };
    this.RU.dur.value = T.lv.arm.dur;
    { const a = T.lv.arm, n = a.struggle ?? 0; this.RU.style.value = a.style ?? 0; this.RU.sn.value = n; this.RU.sa.value = a.strAmp ?? 0.35; this.RU.sf.value = n > 0 ? (a.strFrac ?? 0.5) : 0; }
    this.RU.seedOff.value.set(this.j * 1.37, T.index * 2.11, 0.5);
    const mk = (geo, mat, order, shadow) => {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false; m.renderOrder = order; m.castShadow = shadow; m.receiveShadow = true; m.layers.mask = 0;
      this.group.add(m);
      return m;
    };
    const armMat = buildPieceMaterial(T.lv.armFinish, T.AU, this.RU, { content: G.armEnv });
    this.meshes.arm = mk(d.arm, armMat, 0, true);
    if (d.arm2) this.meshes.arm2 = mk(d.arm2, buildPieceMaterial(T.lv.accentFinish ?? T.lv.armFinish, T.AU2, this.RU, { content: G.armEnv }), 0, true);
    const opts = { vessels: T.vessels };
    this.meshes.back = mk(d.geo, buildMembraneMaterial(PT, this.S, T.L, spec, { ...opts, side: THREE.BackSide }), 10, false);
    this.meshes.front = mk(d.geo, buildMembraneMaterial(PT, this.S, T.L, spec, { ...opts, side: THREE.FrontSide }), 100, false);
    // variantes sans copie de l'image (couches lointaines : derrière la caméra, ou au cœur)
    this.meshes.back.userData.full = this.meshes.back.material;
    this.meshes.back.userData.lite = buildMembraneMaterial(PT, this.S, T.L, spec, { ...opts, side: THREE.BackSide, backdrop: false });
    this.meshes.front.userData.full = this.meshes.front.material;
    this.meshes.front.userData.lite = buildMembraneMaterial(PT, this.S, T.L, spec, { ...opts, side: THREE.FrontSide, backdrop: false });
    if (d.fib) this.meshes.fib = mk(d.fib, buildFibrilMaterial(PT, this.S, T.L, spec), 0, false);
    this.lastX = null;
    return true;
  }
  dispose() {
    this.poser?.dispose();
    if (this.pose) for (const k of ['cur', 'prv', 'nor']) this.nest.freeAttr(this.pose[k]);
    for (const m of Object.values(this.meshes)) { m.material.dispose(); if (m.userData.lite && m.userData.lite !== m.material) m.userData.lite.dispose(); if (m.userData.full && m.userData.full !== m.material) m.userData.full.dispose(); }
    this.nest.root.remove(this.group);
  }
}

export function createNest(scene, gen, renderer) {
  const root = new THREE.Group();
  scene.add(root);
  const nest = { root, gen, renderer, templates: [], slots: [], onProgress: null, onError: null };
  // attribut de stockage de three.js, et son tampon GPU (écrit par nos shaders de calcul)
  nest.storageAttr = (count) => new THREE.StorageBufferAttribute(new Float32Array(count * 4), 4);
  nest.gpuBuffer = (attr) => { renderer.backend.createStorageAttribute(attr); return renderer.backend.get(attr).buffer; };
  nest.freeAttr = (attr) => { try { renderer.backend.destroyAttribute(attr); } catch { /* déjà libéré */ } };

  nest.setRecipe = (R) => {
    const N = R.levels.length;
    while (nest.templates.length > N) nest.templates.pop().dispose();
    while (nest.templates.length < N) nest.templates.push(new Template(nest, nest.templates.length));
    nest.templates.forEach((t, i) => t.set(R.levels[i], R));
    const M = N * Math.ceil((XMAX - XMIN + 0.2) / N);
    while (nest.slots.length > M) nest.slots.pop().dispose();
    while (nest.slots.length < M) nest.slots.push(new Slot(nest, nest.slots.length));
    for (const s of nest.slots) s.built = s.built && s.built.startsWith(`${s.j % N}:`) ? s.built : '';
  };
  nest.syncLevel = (i, R) => nest.templates[i]?.set(R.levels[i], R);
  nest.ready = () => nest.templates.length > 0 && nest.templates.every((t) => t.ready);
  nest.progress = () => (nest.templates.length ? nest.templates.reduce((a, t) => a + (t.ready ? 1 : (t.simProgress ?? 0) * 0.9), 0) / nest.templates.length : 0);

  // s : { tau (déroulée), D, R, reset }
  nest.update = (s) => {
    const R = s.R, M = nest.slots.length, N = nest.templates.length;
    if (!M) return { shown: 0 };
    const q = R.nest.ratio, open = R.nest.open, end = R.nest.end;
    const bd = R.nest.backdrop ?? [-1.2, XMAX];
    let shown = 0;
    const poses = [];
    for (const sl of nest.slots) {
      const ok = sl.sync();
      const x = XMIN + ((((sl.j - s.tau - XMIN) % M) + M) % M);
      const T = sl.tpl, lv = T?.lv;
      const visible = ok && x < XMAX;
      sl.group.visible = visible;
      if (!ok) { sl.lastX = null; continue; }
      const F = T.data.F;
      const sOf = (xx) => Math.min(1, Math.max(0, (open - xx) / (open - end)));
      const jump = s.reset || sl.lastX === null || Math.abs(x - sl.lastX) > 0.5;
      const xPrev = jump ? x : sl.lastX;
      sl.lastX = x;
      sl.S.f.value = sOf(x) * (F - 1);
      sl.S.fPrev.value = sOf(xPrev) * (F - 1);
      sl.RU.t.value = sOf(x);
      sl.RU.tPrev.value = sOf(xPrev);
      // apparition au cœur ; disparition des couches passées derrière la caméra
      // (leurs lambeaux ont quitté le champ ; la brume fait le reste)
      const fadeOut = R.nest.fade ?? [-0.95, -0.2];
      sl.S.vis.value = ss(XMAX - 0.4, XMAX - 1.1, x) * ss(fadeOut[0], fadeOut[1], x);
      // taille et orientation. Chaque couche repose dans la coupe de la
      // précédente : leur orientation relative est fixe (même vitesse de
      // rotation pour toutes, un décalage propre à chaque modèle) — rien ne
      // flotte, rien ne glisse.
      sl.group.scale.setScalar(s.D * q ** x);
      _q1.setFromAxisAngle(Z, lv.motion.roll + (R.nest.spin ?? 0.3) * x);
      sl.group.quaternion.copy(_q1);
      if (!visible) { for (const m of Object.values(sl.meshes)) m.layers.mask = 0; continue; }
      shown++;
      const me = sl.meshes;
      const useBackdrop = x > bd[0] && x < bd[1] && s.backdrop;
      const memOn = sl.S.vis.value > 0.002;
      for (const k of ['back', 'front']) {
        const m = me[k], want = useBackdrop ? m.userData.full : m.userData.lite;
        if (m.material !== want) m.material = want;
        m.layers.mask = memOn ? MAIN : 0;
      }
      // ordre : faces arrière de l'extérieur vers l'intérieur, puis faces avant
      // de l'intérieur vers l'extérieur
      me.back.renderOrder = 10 + (x - XMIN);
      me.front.renderOrder = 100 + (XMAX - x);
      // l'armature s'efface (avec son ombre) quand sa couche passe derrière la
      // caméra : aucune ombre ne disparaît d'un coup
      sl.RU.vis.value = ss(-1.75, -0.95, x) * ss(XMAX - 0.3, XMAX - 0.9, x);
      me.arm.layers.mask = sl.RU.vis.value > 0.001 ? MAIN | KEY | BACK : 0;
      if (me.arm2) me.arm2.layers.mask = me.arm.layers.mask;
      if (me.fib) me.fib.layers.mask = sOf(x) > 0 && memOn ? MAIN : 0;
      if (memOn) poses.push([sl, sl.S.f.value, sl.S.fPrev.value]);
    }
    // pose des membranes affichées (sur le GPU, avant le rendu)
    if (poses.length) {
      const enc = renderer.backend.device.createCommandEncoder();
      for (const [sl, f, fp] of poses) sl.poser.encode(enc, f, fp);
      renderer.backend.device.queue.submit([enc.finish()]);
    }
    return { shown, N };
  };
  nest.dispose = () => { for (const s of nest.slots) s.dispose(); for (const t of nest.templates) t.dispose(); };
  return nest;
}

export { MEMBRANES };
