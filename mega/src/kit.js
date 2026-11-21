// Ce que les jours ont en commun dans la méga-scène : la cible où un jour se
// dessine, le générateur qui lance le worker du jour (et non celui de la page),
// la préparation (génération, puis compilation étalée sur les images de
// l'hôte) et la libération.
//
// Contrat d'un jour (<projet>/src/day.js) :
//   export const meta = { id, name, subtitle, seed }
//   export async function createDay(ctx) → makeDay({ … })
// ctx = { renderer, pipes, width, height }. Un jour ne touche jamais au canvas :
// il dessine dans day.rt, l'hôte compose.
import * as THREE from 'three/webgpu';
import { warmScene } from '../../shared/app/warmup.js';
import { createGenerator } from '../../shared/gen/client.js';

// ── Registre des textures GPU par projet ──
// Un jour crée des textures qu'on ne retrouve pas en parcourant sa scène :
// cartes d'ombre, cibles de sa chaîne d'image, studio préfiltré (PMREM),
// textures de données lues seulement dans ses shaders TSL. Chaque création
// est rattachée au projet dont le code est sur la pile d'appel
// (/<projet>/src/…) ; libérer le jour libère tout ce qu'il a créé.
const ledgers = new Map();
let drawing = null; // (le projet dont un dessin est en cours)
// Qui s'en sert : three.js crée des ressources globales pendant le dessin d'un
// jour (la table DFG_LUT des matériaux physiques, la cible de travail du
// générateur PMREM, la géométrie des passes plein écran…). Rendues avec le
// premier jour qui les a créées, elles cassaient l'éclairage des suivants (la
// tasse de Bolt brûlée, les algues de Kelp trop claires, après Melt et
// Caustic). On ne rend donc que ce qu'aucun autre jour n'a utilisé.
const users = new WeakMap();
const use = (x) => { if (!drawing || !x) return; let u = users.get(x); if (!u) users.set(x, (u = new Set())); u.add(drawing); };
const NEVER = new Set(['DFG_LUT']); // (globales connues, jamais rendues)
// (et les géométries que three.js partage entre tous les objets d'un type :
// celle des sprites, celle des passes plein écran. Créées pendant le premier
// jour qui s'en sert — Orrery, seul à avoir des sprites —, elles lui étaient
// rattachées et rendues avec lui ; le Orrery du tour suivant reprenait un
// tampon détruit, le moteur refusait chaque image : animation figée)
const SHARED = new WeakSet();
for (const g of [new THREE.Sprite().geometry, new THREE.QuadMesh().geometry]) {
  for (const a of [...Object.values(g.attributes), g.index]) if (a) { SHARED.add(a); if (a.data) SHARED.add(a.data); }
}
export function installLedger(renderer) {
  const be = renderer.backend;
  if (be.__ledger) return;
  be.__ledger = true;
  const note = (thing) => {
    if (thing.isTexture && thing.name?.startsWith('mega:')) return; // (les emplacements de l'hôte ne sont à aucun jour)
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 80;
    const stack = new Error().stack ?? '';
    Error.stackTraceLimit = limit;
    let owner = null;
    for (const m of stack.matchAll(/\/([a-z0-9_]+)\/src\//g)) if (m[1] !== 'mega') { owner = m[1]; break; }
    // (sinon : le jour en train de dessiner — le studio préfiltré est créé
    // par three.js sans le code du jour sur la pile)
    owner ??= drawing;
    if (owner) {
      if (!ledgers.has(owner)) ledgers.set(owner, new Set());
      ledgers.get(owner).add(thing);
    }
  };
  const create = be.createTexture.bind(be);
  be.createTexture = (texture, options) => { note(texture); return create(texture, options); };
  // (et les tampons : sommets, indices, tampons de calcul — les particules de
  // Melt ne sont rattachées à aucune géométrie de la scène)
  for (const k of ['createAttribute', 'createIndexAttribute', 'createStorageAttribute', 'createIndirectStorageAttribute']) {
    const f = be[k]?.bind(be);
    if (f) be[k] = (attribute) => { note(attribute); return f(attribute); };
  }
  // (usage : chaque cible où l'on dessine, chaque texture liée, chaque tampon mis à jour)
  const T = renderer._textures, A = renderer._attributes;
  if (T?.updateRenderTarget) {
    const urt = T.updateRenderTarget.bind(T);
    T.updateRenderTarget = (rt, ...a) => { use(rt.texture); for (const t of rt.textures ?? []) use(t); use(rt.depthTexture); return urt(rt, ...a); };
  }
  if (T?.updateTexture) {
    const ut = T.updateTexture.bind(T);
    T.updateTexture = (t, ...a) => { use(t); return ut(t, ...a); };
  }
  if (A?.update) {
    const ua = A.update.bind(A);
    A.update = (x, ...a) => { use(x); return ua(x, ...a); };
  }
  ledgerRenderer = renderer;
}
let ledgerRenderer = null;
function releaseTextures(project) {
  const set = ledgers.get(project);
  if (!set) return 0;
  let n = 0;
  for (const x of set) {
    if ((x.isTexture && NEVER.has(x.name)) || SHARED.has(x)) continue;
    const u = users.get(x);
    if (u && [...u].some((p) => p !== project)) continue; // (un autre jour s'en sert : globale)
    n++;
    // (une ressource déjà rendue par le jour lui-même ne doit pas casser la
    // libération : l'exception remontait jusqu'à la boucle de l'hôte, et le
    // jour suivant n'était jamais préparé)
    try {
      if (x.isTexture) x.dispose();
      else ledgerRenderer?._attributes?.delete(x); // (libère le tampon GPU)
    } catch (e) { console.warn('registre :', e.message); }
  }
  ledgers.delete(project);
  return n;
}
// (deux jours du même projet en même temps : le registre ne sait pas les
// séparer, on ne libère alors que ce que la scène permet de retrouver)
const alive = new Map();

// size : nombre de workers (un jour qui découpe sa génération en tranches en
// demande davantage) ; maxCache : comme createGenerator
export function generatorFor(project, size = 3, { maxCache = 96 } = {}) {
  return createGenerator(size, { worker: new URL(`../../${project}/src/gen/worker.js`, import.meta.url), maxCache });
}

// tout ce qu'une scène tient en mémoire GPU et qu'on peut retrouver depuis
// ses objets : géométries, matériaux, textures des matériaux, ombres, studio
export function disposeScene(scene) {
  const seen = new Set();
  const tex = (v) => { if (v?.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } };
  scene.traverse((o) => {
    if (!SHARED.has(o.geometry?.index)) o.geometry?.dispose?.(); // (pas la géométrie commune des sprites)
    for (const m of [o.material].flat()) {
      if (!m) continue;
      for (const v of Object.values(m)) tex(v);
      m.dispose?.();
    }
    if (o.isLight) o.dispose?.(); // (avec son ombre)
  });
  tex(scene.environment);
  if (scene.background?.isTexture) tex(scene.background);
}

// Un jour prêt à l'emploi à partir de ses pièces.
//   renderAt(u, look) : dessine la phase u (déroulée) ; look.push ∈ [0, 1) :
//     la caméra avance vers ce qu'elle regarde (entrée et sortie du relais)
//   isReady() : géométrie (et studio) arrivés
//   warmPhases : les moments à compiler sous la préparation
export function makeDay({ meta, renderer, pipes, width, height, scene, camera, post, gen, duration, isReady, progress, renderAt, warmPhases, onResize, extraDispose }) {
  // la cible où le jour dessine : un emplacement fourni par l'hôte
  // (useTarget), sinon la sienne, créée au premier besoin
  let rt = null, own = null;
  const target = () => rt ?? (rt = own = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false }));
  installLedger(renderer);
  alive.set(meta.id, (alive.get(meta.id) ?? 0) + 1);
  let live = true;
  const draw = (u, look) => {
    const prev = renderer.getRenderTarget();
    // Un jour ne dessine jamais dans le canvas : beaucoup de projets reviennent
    // à setRenderTarget(null) après une passe à eux (le champ de lave de Magma),
    // ce qui envoyait la suite de leur image dans le canvas (écran noir quand
    // le jour joue, image qui surgit pendant qu'il se prépare). Pendant le
    // dessin d'un jour, « null » veut dire sa cible.
    const set = renderer.setRenderTarget;
    const dst = target();
    renderer.setRenderTarget = function (t, ...rest) { return set.call(this, t ?? dst, ...rest); };
    renderer.setRenderTarget(dst);
    // (réglages communs du moteur qu'une chaîne d'image change en passant —
    // celle de Kelp pose renderer.toneMapping : rendus tels quels après)
    const tm = renderer.toneMapping, te = renderer.toneMappingExposure;
    drawing = meta.id;
    try { renderAt(u, look ?? { push: 0 }); } finally {
      drawing = null;
      renderer.setRenderTarget = set;
      renderer.toneMapping = tm; renderer.toneMappingExposure = te;
    }
    renderer.setRenderTarget(prev);
  };
  return {
    meta, scene, camera, post, gen,
    get rt() { return target(); },
    useTarget(t) { if (own) { own.dispose(); own = null; } rt = t; },
    get duration() { return duration(); },
    u: 0, // (phase déroulée, tenue par l'hôte)
    state: 'generating',
    progress,
    render: draw,
    // génération puis compilation ; yieldFn : attendre l'image suivante de l'hôte
    async prepare({ yieldFn, onProgress, background = false }) {
      while (!isReady()) {
        if (!live) return false;
        onProgress?.(0.6 * progress());
        await yieldFn();
      }
      this.state = 'warming';
      const ok = await warmScene({
        renderer, scene, pipes, render: (ph) => draw(ph), phases: warmPhases(),
        onProgress: (f) => onProgress?.(0.6 + 0.4 * f), alive: () => live, yieldFn,
        // (en arrière-plan : quelques ms de construction par image, pas 100 —
        // le jour qui joue ne doit pas sauter d'image)
        budget: background ? 6 : 100,
      });
      if (!ok) return false;
      // Le studio refiltré une dernière fois, découpage coupé (warmScene est
      // fini : la porte est fermée). En arrière-plan, avec 6 ms par dessin, le
      // préfiltrage (PMREM : une suite de petites cibles, chacune « nouvelle »
      // pour le découpage) était en partie sauté et le studio restait faux :
      // la tasse de Bolt brûlée, les algues de Kelp trop claires.
      for (const t of [scene.environment, scene.background]) if (t?.isTexture) t.needsPMREMUpdate = true;
      draw(0);
      // quelques images pour l'historique de l'anticrénelage temporel
      for (let i = 0; i < 6 && live; i++) { draw(0); await yieldFn(); }
      this.state = 'ready';
      return live;
    },
    resize(w, h) {
      own?.setSize(w, h); // (un emplacement de l'hôte est redimensionné par l'hôte)
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      onResize?.(w, h);
    },
    dispose() {
      live = false;
      this.state = 'disposed';
      const safe = (f) => { try { f(); } catch (e) { console.warn(`${meta.id} : libération`, e.message); } };
      safe(() => gen.terminate());
      if (extraDispose) safe(extraDispose);
      safe(() => { for (const n of Object.values(post.nodes ?? {})) n?.dispose?.(); });
      safe(() => post.pipeline?.dispose?.());
      safe(() => disposeScene(scene));
      safe(() => own?.dispose());
      const n = alive.get(meta.id) - 1;
      alive.set(meta.id, n);
      this.released = 0;
      if (n === 0) safe(() => { this.released = releaseTextures(meta.id); });
    },
  };
}
