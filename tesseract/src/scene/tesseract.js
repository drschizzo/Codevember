// Le tesseract : huit cellules, chacune faite de quatre maillages (ossature,
// panneaux, verre, objet exposé). Tous partagent le même principe : leurs
// sommets sont en coordonnées locales de la cellule, et une matrice 4D propre
// au maillage, recalculée à chaque image (dépliage, rotation 4D, rotation de
// l'objet exposé), les emmène en 4D avant la projection (voir project.js).
//
// Le groupe qui les porte assure le cadrage : centré, à une taille qui ne
// varie qu'en partie avec l'étendue du patron (déplié, il est bien plus grand
// que plié), soulevé au besoin pour ne jamais traverser le sol.
import * as THREE from 'three/webgpu';
import { uniform, lights } from 'three/tsl';
import { stateAt, cellTransforms, cellMatrix, apply, project, timelineFor, stepOrientations, depthOf, foldOrder, normalOf, smoothstep } from '../math4.js';
import { voyageFrames, voyageBlend } from './voyage.js';
import { meshUniforms, setMatrix, cellReveal } from './project.js';
import { faceLayout, voyageDoors, computeOpenings, cellOpenness } from './reveal.js';
import { buildPieceMaterial, buildGemMaterial, finishUniforms, applyFinish, signature, gemUniforms, applyGem } from './materials.js';
import { G } from './globals.js';
import { createGuides } from './guides.js';
import { createPracticals } from './practicals.js';

const ROLES = ['frame', 'panel', 'glass', 'content'];

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  const packed = (a) => !(a instanceof Float32Array);
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3, packed(o.normal)));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4, packed(o.tangent)));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setAttribute('pat', new THREE.BufferAttribute(o.pat, 3));
  g.setAttribute('anchor', new THREE.BufferAttribute(o.anchor, 3));
  g.setAttribute('span', new THREE.BufferAttribute(o.span, 1));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  return g;
}
// Géométrie qui partage les tampons d'une autre : les huit ossatures ont les
// mêmes sommets (seule leur matrice 4D diffère). Libérer l'une libère les
// tampons de toutes : elles sont toujours remplacées ensemble, dans la même
// tâche, avant l'image suivante.
function shareGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  g.setIndex(src.index);
  return g;
}

// Sphère englobante d'une cellule dans l'espace projeté (les positions sont
// calculées dans le shader : three ne peut pas la déduire des sommets). Elle
// est tirée de 27 points de la cellule (sommets, milieux des arêtes et des
// faces, centre) et élargie pour les arcs du gonflement ; une cellule qui
// touche presque l'œil 4D se projette à l'infini : elle n'est jamais éliminée.
const SAMPLES = [];
for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) SAMPLES.push([x, y, z]);
const BOUNDS_MARGIN = 1.25, NEAR_EYE = 0.35;
function cellSphere(A, d, inflate, out) {
  let cx = 0, cy = 0, cz = 0;
  const pts = SAMPLES.map((l) => {
    const y = [0, 1, 2, 3].map((r) => A[r * 4] * l[0] + A[r * 4 + 1] * l[1] + A[r * 4 + 2] * l[2] + A[r * 4 + 3]);
    const k = 1 + inflate * (2 / (Math.hypot(...y) || 1) - 1);
    if (d - y[3] * k < NEAR_EYE) return null;
    const p = project(y, d, inflate);
    cx += p[0]; cy += p[1]; cz += p[2];
    return p;
  });
  if (pts.includes(null)) { out.center.set(0, 0, 0); out.radius = Infinity; return; }
  const n = pts.length;
  out.center.set(cx / n, cy / n, cz / n);
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - out.center.x, p[1] - out.center.y, p[2] - out.center.z));
  out.radius = r * BOUNDS_MARGIN;
}

// rotation 3D (ligne-major) d'axe a et d'angle t
function axisAngle(a, t) {
  const [x, y, z] = a, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
const mul3 = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const normv = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

// studioLights : lumières du plateau, qui éclairent toutes les cellules
export function createTesseract(scene, gen, { studioLights = [] } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  let R = null, cache = null, refRadius = 0, generation = 0, pendingCount = 0, totalCount = 1, readyFlag = false;

  // pièce : un maillage, ses uniformes 4D, son matériau
  const pieces = [];
  // sphère englobante de chaque cellule (espace projeté), partagée par ses
  // pièces : three élimine ainsi celles qui sortent du champ, pour la caméra
  // comme pour la carte d'ombre
  const bounds = Array.from({ length: 8 }, () => new THREE.Sphere(new THREE.Vector3(), Infinity));
  for (let c = 0; c < 8; c++) for (const role of ROLES) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), null);
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const M = meshUniforms();
    if (role === 'frame') M.keep = uniform(1); // (ossature en place / rentrée)
    pieces.push({ c, role, mesh, M, F: null, gemU: null, sig: '', prev: null, has: false });
  }
  const guides = createGuides(group);
  const practicals = createPracticals(group, scene);
  // Éclairage sélectif : chaque cellule ne reçoit que les lumières du plateau
  // et sa propre lumière d'écrin (sans ombre, celle-ci traverserait sinon les
  // parois pleines et éclairerait la doublure des cellules voisines ; et
  // chaque pixel évaluerait toutes les lumières) ; son objet exposé reçoit en
  // plus sa lumière de vedette.
  const cellLights = practicals.lights.map((L) => lights([...studioLights, L]));
  const objectLights = practicals.lights.map((L, c) => lights([...studioLights, L, practicals.heroes[c]]));
  const pieceOf = (c, role) => pieces[c * ROLES.length + ROLES.indexOf(role)];
  // ajourage des six faces de chaque cellule (voir reveal.js), partagé par
  // ses panneaux et son verre
  const reveals = Array.from({ length: 8 }, cellReveal);
  const openArrays = reveals.map((u) => u.open.array), openness = new Array(8);
  let frameU = null; // uniformes de finition de l'ossature (partagés par les huit cellules)

  const finishOf = (P) => {
    if (P.role === 'frame') return R.frame.finish;
    const cell = R.cells[P.c];
    if (P.role === 'panel') return cell.panel;
    if (P.role === 'glass') return cell.glass;
    return cell.content.finish;
  };

  // (Re)construit le matériau d'une pièce. Un matériau neuf à chaque nouvelle
  // géométrie : le shader dépend des attributs présents au premier rendu, et
  // la carte d'ombre garde le pipeline du premier matériau tant qu'il vit.
  function buildMaterial(P) {
    const old = P.mesh.material;
    const cell = R.cells[P.c];
    if (P.role === 'content' && cell.content.type === 'gem') {
      P.gemU = gemUniforms(cell.content.gem);
      P.mesh.material = buildGemMaterial(P.gemU, P.M, reveals[P.c].openness);
      P.sig = 'gem';
    } else {
      const fin = finishOf(P);
      let U;
      if (P.role === 'frame') { frameU ??= finishUniformsFor(fin); U = frameU; } else { U = finishUniformsFor(fin); }
      P.F = U;
      const tint = P.role === 'glass' ? U.outer.color2 : null;
      P.mesh.material = buildPieceMaterial(fin, U, P.M, { shadowTint: tint, reveal: P.role === 'panel' || P.role === 'glass' ? reveals[P.c] : null, depth: P.role === 'frame', openness: P.role === 'content' ? reveals[P.c].openness : null, merge: P.role === 'frame', patina: P.role === 'panel' });
      P.sig = signature(fin);
    }
    P.mesh.material.lightsNode = (P.role === 'content' ? objectLights : cellLights)[P.c];
    old?.dispose();
  }
  const finishUniformsFor = (fin) => ({ outer: finishUniforms(fin.outer), inner: finishUniforms(fin.inner), edge: finishUniforms(fin.edge), wear: uniform(fin.wear || 0) });

  // geo : la nouvelle géométrie de la pièce, ou null (pièce absente)
  function setGeometry(P, geo) {
    const old = P.mesh.geometry;
    P.has = !!geo;
    P.mesh.geometry = geo ?? new THREE.BufferGeometry();
    P.mesh.geometry.boundingSphere = bounds[P.c];
    old.dispose();
    if (P.has) buildMaterial(P);
    P.mesh.visible = P.has;
    P.mesh.castShadow = P.has;
  }

  // panneaux, verre et (s'il est donné) objet exposé de la cellule c
  const geometryOf = (out) => (out ? toGeometry(out) : null);
  function setPanels(c, panels, content) {
    setGeometry(pieceOf(c, 'panel'), geometryOf(panels.panel));
    setGeometry(pieceOf(c, 'glass'), geometryOf(panels.glass));
    if (content !== undefined) setGeometry(pieceOf(c, 'content'), R.cells[c].content.type === 'none' ? null : geometryOf(content));
  }

  const frameSpec = () => ({ ...R.frame, finish: undefined, set: undefined });
  const cellSpec = (c) => { const k = R.cells[c]; return { seed: k.seed, faces: k.faces, panelT: k.panelT, glassT: k.glassT, perf: k.perf, louvre: k.louvre, grid: k.grid, stud: k.stud, corr: k.corr, leaded: k.leaded, bars: k.bars, target: k.target, miura: k.miura, ripple: k.ripple, twist: k.twist, scales: k.scales, comb: k.comb, oculus: k.oculus }; };
  const contentSpec = (c) => { const k = R.cells[c].content; return { type: k.type, size: k.size }; };

  // Demande toutes les géométries ; la scène bascule d'un coup quand tout est arrivé.
  function setRecipe(recipe) {
    R = recipe;
    frameU = null;
    refRadius = 0;
    const gen0 = ++generation;
    readyFlag = false;
    guides.setRecipe(R);
    cache = makeCache();
    syncLayout();
    const jobs = [gen.request(frameSpec(), 'frame')];
    for (let c = 0; c < 8; c++) { jobs.push(gen.request({ cell: cellSpec(c), frame: frameSpec() }, 'panels')); jobs.push(gen.request(contentSpec(c), 'content')); }
    totalCount = jobs.length; pendingCount = jobs.length;
    jobs.forEach((j) => j.then(() => { if (gen0 === generation) pendingCount--; }, () => {}));
    Promise.all(jobs).then(([frame, ...rest]) => {
      if (gen0 !== generation) return;
      const frameGeo = toGeometry(frame);
      for (let c = 0; c < 8; c++) {
        const panels = rest[2 * c], content = rest[2 * c + 1];
        setGeometry(pieceOf(c, 'frame'), shareGeometry(frameGeo));
        setPanels(c, panels, content);
      }
      for (const P of pieces) P.prev = null;
      readyFlag = true;
    }, (e) => console.error(e));
  }

  // disposition des faces (ancrages, trames des tôles perforées)
  function syncLayout() {
    cache.layout = faceLayout(R);
    cache.layout.forEach((faces, c) => faces.forEach(({ grid }, f) => reveals[c].grid.array[f].set(grid[0], grid[1])));
  }

  function makeCache() {
    const C = { timeline: timelineFor(R), Q: stepOrientations(R.moves), depth: depthOf(R.net.parent), order: foldOrder(R.net.parent) };
    C.frames = voyageFrames(R, C);
    return C;
  }

  // une cellule (ou l'ossature) a changé de forme : nouvelles géométries
  function syncGeometry(c = null) {
    if (!R) return;
    syncLayout(); // (faces, épaisseurs ou ossature changées)
    const gen0 = generation;
    if (c === null) { // ossature (et panneaux : leur assise dépend de l'ossature)
      guides.setRecipe(R);
      const jobs = [gen.request(frameSpec(), 'frame'), ...Array.from({ length: 8 }, (_, i) => gen.request({ cell: cellSpec(i), frame: frameSpec() }, 'panels'))];
      Promise.all(jobs).then(([frame, ...panels]) => {
        if (gen0 !== generation) return;
        frameU = null;
        const frameGeo = toGeometry(frame);
        for (let i = 0; i < 8; i++) { setGeometry(pieceOf(i, 'frame'), shareGeometry(frameGeo)); setPanels(i, panels[i]); }
      });
      return;
    }
    Promise.all([gen.request({ cell: cellSpec(c), frame: frameSpec() }, 'panels'), gen.request(contentSpec(c), 'content')]).then(([panels, content]) => {
      if (gen0 !== generation) return;
      setPanels(c, panels, content);
    });
  }

  // une finition a changé : uniformes, ou nouveau matériau si la structure
  // change. c = null : l'ossature (finition partagée par les huit cellules).
  function syncMaterial(c = null) {
    if (!R) return;
    if (c === null) {
      const fin = R.frame.finish, frames = pieces.filter((P) => P.role === 'frame' && P.has);
      if (!frames.length) return;
      if (signature(fin) !== frames[0].sig) { frameU = null; frames.forEach(buildMaterial); return; }
      for (const side of ['outer', 'inner', 'edge']) applyFinish(frameU[side], fin[side]);
      frameU.wear.value = fin.wear || 0;
      return;
    }
    for (const P of pieces) {
      if (!P.has || P.c !== c || P.role === 'frame') continue;
      if (P.role === 'content' && R.cells[c].content.type === 'gem') {
        if (P.sig === 'gem') applyGem(P.gemU, R.cells[c].content.gem); else buildMaterial(P);
        continue;
      }
      const fin = finishOf(P);
      if (P.sig === 'gem' || signature(fin) !== P.sig) { buildMaterial(P); continue; }
      for (const side of ['outer', 'inner', 'edge']) applyFinish(P.F[side], fin[side]);
      P.F.wear.value = fin.wear || 0;
    }
  }

  // ── Image ──────────────────────────────────────────────────────────────────
  // points témoins : coins et centre de chaque cellule (cadrage)
  const probe = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) probe.push([x, y, z, 1]);
  function projectedPoints(T, inset, inflate) {
    const pts = [];
    for (let c = 0; c < 8; c++) {
      const A = cellMatrix(T[c], c, inset);
      for (const l of probe) {
        const y = [0, 1, 2, 3].map((r) => A[r * 4] * l[0] + A[r * 4 + 1] * l[1] + A[r * 4 + 2] * l[2] + A[r * 4 + 3]);
        pts.push(project(y, R.proj.d, inflate));
      }
    }
    return pts;
  }
  const radiusOf = (pts) => {
    const c = [0, 0, 0];
    for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; }
    let r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
    return { c, r };
  };

  const euler = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), _p = new THREE.Vector3();
  const cellA = new Array(8); // matrice de chaque cellule (ossature, panneaux)
  let view = null; // ce que l'ajourage retient de la dernière image
  // ph : phase de la boucle ; reset : pas de mouvement depuis l'image précédente
  function update(ph, { target = 1.9, floorY = -2.6, reset = false } = {}) {
    if (!R || !readyFlag) return null;
    const st = stateAt(ph, R, cache);
    const T = cellTransforms(st, R.net.parent);
    const inset = R.proj.inset;
    // (paramètres de l'image précédente, pour les vecteurs vitesse)
    G.dPrev.value = G.d.value;
    G.inflatePrev.value = G.inflate.value;
    // gonflement : seulement plié (déplié, le patron reste fait de cubes)
    const inflate0 = R.proj.inflate * Math.min(1, Math.max(0, st.fold)) ** 2;
    // voyage intérieur : l'œil 4D se pose sur l'hypersphère (projection
    // stéréographique exacte, voir math4.js)
    const { kp, kc } = voyageBlend(st);
    const lerp = (a, b, t) => a + (b - a) * t;
    G.inflate.value = lerp(inflate0, 1, kp);
    G.d.value = lerp(R.proj.d, 2, kp);
    // De l'intérieur, plus de coque à effacer : les parois s'ajourent d'autant
    // plus qu'elles sont loin de la pièce où l'on se tient (on voit les pièces
    // d'après par les ajours des voisines) ; celles de la pièce restent
    // pleines (w = −1) : seules les portes s'y ouvrent, l'œil sait où se poser.
    const shell = {
      amount: lerp(R.proj.reveal ?? 1, R.voyage?.see ?? 0.9, kp),
      lo: lerp(R.proj.revealLo ?? -0.5, -0.75, kp), hi: lerp(R.proj.revealHi ?? 0.85, 2.6, kp),
    };
    G.voyageK.value = kc; // (part du voyage, pour l'éclairage)
    if (reset) { G.dPrev.value = G.d.value; G.inflatePrev.value = G.inflate.value; }

    // cadrage (celui de la vue extérieure, même pendant le voyage)
    const pts = projectedPoints(T, inset, inflate0);
    const { c, r } = radiusOf(pts);
    if (!refRadius || reset) {
      // rayon de référence : le tesseract plié
      const T0 = cellTransforms({ ...st, move: null, theta: new Array(8).fill(0), Q: cache.Q[0] }, R.net.parent);
      refRadius = radiusOf(projectedPoints(T0, inset, R.proj.inflate)).r;
    }
    const a = R.proj.framing;
    const s = (target * R.proj.size) / (refRadius ** (1 - a) * r ** a);
    euler.set(R.proj.tiltX, Math.PI * 2 * R.proj.spin * ph, R.proj.tiltZ, 'YXZ');
    q.setFromEuler(euler);
    group.quaternion.copy(q);
    group.scale.setScalar(s);
    v.set(c[0], c[1], c[2]).applyQuaternion(q).multiplyScalar(s);
    // point le plus bas : l'objet ne traverse jamais le sol
    let minY = Infinity;
    for (const p of pts) minY = Math.min(minY, _p.set(p[0], p[1], p[2]).applyQuaternion(q).y * s - v.y);
    const lift = Math.max(0, floorY + 0.06 * target - minY);
    group.position.set(-v.x, -v.y + lift, -v.z);

    // Une fois plié, seule la cellule extérieure (face à l'œil 4D, projetée
    // en cube sans déformation) garde son ossature : elle dessine le contour
    // de l'hypercube, sans les barres empilées des cellules voisines. Les
    // autres se rétractent à la fin du pliage ; pendant un quart de tour, le
    // contour passe d'une cellule à l'autre. Dans l'hypersphère, plus
    // d'ossature du tout.
    const fm = Math.min(1, Math.max(0, (st.fold - 0.86) / 0.14)), merge = fm * fm * (3 - 2 * fm);
    // matrices de chaque pièce
    for (let cc = 0; cc < 8; cc++) {
      const cell = R.cells[cc], con = cell.content;
      const outer = smoothstep(0.55, 0.95, apply(T[cc], normalOf(cc))[3]);
      const keep = (1 - merge + merge * outer) * (1 - kp);
      const Pf = pieceOf(cc, 'frame');
      Pf.M.keep.value = keep;
      const Afr = cellMatrix(T[cc], cc, inset);
      cellA[cc] = Afr;
      cellSphere(Afr, G.d.value, G.inflate.value, bounds[cc]);
      // objet exposé : tourne d'un nombre entier de tours par boucle
      // la cellule qui passe à l'extérieur (vers l'œil 4D) rentre son objet :
      // projeté, il se superposerait à celui de la cellule intérieure
      const w = apply(T[cc], normalOf(cc))[3];
      const t = Math.min(1, Math.max(0, (w - 0.3) / 0.6)), shrink = 1 - Math.max(R.proj.reveal ?? 1, kp) * t * t * (3 - 2 * t);
      // (en voyage, l'objet se fait plus petit : la caméra passe tout près)
      // (et dès que la caméra entre : elle se pose tout près du centre)
      const vs = lerp(1, Math.min(1, (R.voyage?.objScale ?? 0.27) / con.size), Math.max(kp, kc));
      const k3 = Math.max(1e-3, shrink) * vs;
      const rot = mul3(axisAngle(normv(con.axis), Math.PI * 2 * con.turns * ph), axisAngle(normv(con.tilt), 0.6)).map((x) => x * k3);
      const Aco = cellMatrix(T[cc], cc, inset, { m3: rot, t3: [0, 0, 0] });
      for (const role of ROLES) {
        const P = pieceOf(cc, role);
        if (!P.has) continue;
        const A = role === 'content' ? Aco : Afr;
        // (objet rentré : invisible ; près de l'œil 4D, sa projection exploserait)
        if (role === 'content') { const on = shrink > 0.02; P.mesh.visible = on; P.mesh.castShadow = on; }
        setMatrix(P.M.Aprev, reset || !P.prev ? A : P.prev);
        setMatrix(P.M.A, A);
        P.prev = A;
      }
    }
    group.updateMatrixWorld();
    guides.update(R, st, T, inset, s);
    practicals.update(R, T, s);
    // (l'ajourage dépend aussi de la caméra : voir setViewer)
    view = {
      A: cellA, layout: cache.layout, d: G.d.value, inflate: G.inflate.value, toWorld: group.matrixWorld, shell,
      // coupe côté caméra : sans objet de l'intérieur ; parois traversées :
      // ouvertes dès que le voyage commence (la caméra est alors loin)
      cutaway: R.view.cutaway * (1 - kp), pass: kp > 0.001,
      doors: voyageDoors(st, R, cache.frames, T, G.d.value, G.inflate.value),
    };
    return { state: st, scale: s, lift, timeline: cache.timeline, kp, kc, frames: cache.frames };
  }

  // Ce qui dépend de la caméra du film (position monde), une fois celle-ci
  // placée : les lumières de vedette, et l'ajourage des faces (la carte
  // d'ombre voit les mêmes ouvertures).
  const _cam = new THREE.Vector3();
  function setViewer(pos) {
    if (!view) return;
    practicals.aim(pos);
    computeOpenings(openArrays, { ...view, viewPos: pos, camLocal: group.worldToLocal(_cam.copy(pos)) });
    // (dans les pièces du voyage, les parois restent pleines : un plancher,
    // sinon pierres et cristaux, qui ne vivent que de reflets, virent au noir)
    const floor = 0.55 * G.voyageK.value;
    cellOpenness(view.layout, openArrays, openness).forEach((k, c) => { reveals[c].openness.value = Math.max(k, floor); });
  }

  // la chorégraphie, le patron ou les mouvements ont changé (rien à reconstruire)
  function refresh() {
    if (!R) return;
    cache = makeCache();
    syncLayout();
    refRadius = 0;
  }

  return {
    group, guides, practicals, reveals, setRecipe, refresh, syncGeometry, syncMaterial, update, setViewer, pieces,
    ready: () => readyFlag,
    progress: () => (totalCount ? 1 - pendingCount / totalCount : 1),
    // (après un saut dans la boucle : pas de vecteurs vitesse)
    resetMotion: () => { for (const P of pieces) P.prev = null; },
    invalidateFraming: () => { refRadius = 0; },
  };
}
