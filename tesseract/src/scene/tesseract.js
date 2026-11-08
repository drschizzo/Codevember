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
import { uniform } from 'three/tsl';
import { stateAt, cellTransforms, cellMatrix, apply, project, stepTimeline, stepOrientations, depthOf, foldOrder, normalOf } from '../math4.js';
import { meshUniforms, setMatrix } from './project.js';
import { buildPieceMaterial, buildGemMaterial, finishUniforms, applyFinish, signature, gemUniforms, applyGem } from './materials.js';
import { G } from './globals.js';

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
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  // (positions calculées dans le shader : boîte englobante large, et pas d'élimination)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  return g;
}

// rotation 3D (ligne-major) d'axe a et d'angle t
function axisAngle(a, t) {
  const [x, y, z] = a, c = Math.cos(t), s = Math.sin(t), k = 1 - c;
  return [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k];
}
const mul3 = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const normv = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export function createTesseract(scene, gen) {
  const group = new THREE.Group();
  scene.add(group);
  let R = null, cache = null, refRadius = 0, generation = 0, pendingCount = 0, totalCount = 1, readyFlag = false;

  // pièce : un maillage, ses uniformes 4D, son matériau
  const pieces = [];
  for (let c = 0; c < 8; c++) for (const role of ROLES) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), null);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pieces.push({ c, role, mesh, M: meshUniforms(), F: null, gemU: null, sig: '', prev: null, has: false });
  }
  const pieceOf = (c, role) => pieces[c * ROLES.length + ROLES.indexOf(role)];
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
      P.mesh.material = buildGemMaterial(P.gemU, P.M);
      P.sig = 'gem';
    } else {
      const fin = finishOf(P);
      let U;
      if (P.role === 'frame') { frameU ??= finishUniformsFor(fin); U = frameU; } else { U = finishUniformsFor(fin); }
      P.F = U;
      const tint = P.role === 'glass' ? U.outer.color2 : null;
      P.mesh.material = buildPieceMaterial(fin, U, P.M, { shadowTint: tint, reveal: P.role === 'panel' || P.role === 'glass' });
      P.sig = signature(fin);
    }
    old?.dispose();
  }
  const finishUniformsFor = (fin) => ({ outer: finishUniforms(fin.outer), inner: finishUniforms(fin.inner), edge: finishUniforms(fin.edge), wear: uniform(fin.wear || 0) });

  function setGeometry(P, out) {
    const old = P.mesh.geometry;
    if (out) {
      P.mesh.geometry = toGeometry(out);
      P.has = true;
    } else {
      P.mesh.geometry = new THREE.BufferGeometry();
      P.has = false;
    }
    old.dispose();
    if (P.has) buildMaterial(P);
    P.mesh.visible = P.has;
    P.mesh.castShadow = P.has;
  }

  const frameSpec = () => ({ ...R.frame, finish: undefined, set: undefined });
  const cellSpec = (c) => { const k = R.cells[c]; return { seed: k.seed, faces: k.faces, panelT: k.panelT, glassT: k.glassT, perf: k.perf, louvre: k.louvre, grid: k.grid }; };
  const contentSpec = (c) => { const k = R.cells[c].content; return { type: k.type, size: k.size }; };

  // Demande toutes les géométries ; la scène bascule d'un coup quand tout est arrivé.
  function setRecipe(recipe) {
    R = recipe;
    frameU = null;
    refRadius = 0;
    const gen0 = ++generation;
    readyFlag = false;
    cache = {
      timeline: stepTimeline(R.chor), Q: stepOrientations(R.moves), depth: depthOf(R.net.parent), order: foldOrder(R.net.parent),
    };
    const jobs = [gen.request(frameSpec(), 'frame')];
    for (let c = 0; c < 8; c++) { jobs.push(gen.request({ cell: cellSpec(c), frame: frameSpec() }, 'panels')); jobs.push(gen.request(contentSpec(c), 'content')); }
    totalCount = jobs.length; pendingCount = jobs.length;
    jobs.forEach((j) => j.then(() => { if (gen0 === generation) pendingCount--; }, () => {}));
    Promise.all(jobs).then(([frame, ...rest]) => {
      if (gen0 !== generation) return;
      for (let c = 0; c < 8; c++) {
        const panels = rest[2 * c], content = rest[2 * c + 1];
        setGeometry(pieceOf(c, 'frame'), frame);
        setGeometry(pieceOf(c, 'panel'), panels.panel);
        setGeometry(pieceOf(c, 'glass'), panels.glass);
        setGeometry(pieceOf(c, 'content'), R.cells[c].content.type === 'none' ? null : content);
      }
      for (const P of pieces) P.prev = null;
      readyFlag = true;
    }, (e) => console.error(e));
  }

  // une cellule (ou l'ossature) a changé de forme : nouvelles géométries
  function syncGeometry(c = null) {
    if (!R) return;
    const gen0 = generation;
    if (c === null) { // ossature (et panneaux : leur assise dépend de l'ossature)
      const jobs = [gen.request(frameSpec(), 'frame'), ...Array.from({ length: 8 }, (_, i) => gen.request({ cell: cellSpec(i), frame: frameSpec() }, 'panels'))];
      Promise.all(jobs).then(([frame, ...panels]) => {
        if (gen0 !== generation) return;
        frameU = null;
        for (let i = 0; i < 8; i++) { setGeometry(pieceOf(i, 'frame'), frame); setGeometry(pieceOf(i, 'panel'), panels[i].panel); setGeometry(pieceOf(i, 'glass'), panels[i].glass); }
      });
      return;
    }
    Promise.all([gen.request({ cell: cellSpec(c), frame: frameSpec() }, 'panels'), gen.request(contentSpec(c), 'content')]).then(([panels, content]) => {
      if (gen0 !== generation) return;
      setGeometry(pieceOf(c, 'panel'), panels.panel);
      setGeometry(pieceOf(c, 'glass'), panels.glass);
      setGeometry(pieceOf(c, 'content'), R.cells[c].content.type === 'none' ? null : content);
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
  function projectedPoints(T, inset) {
    const pts = [];
    for (let c = 0; c < 8; c++) {
      const A = cellMatrix(T[c], c, inset);
      for (const l of probe) {
        const y = [0, 1, 2, 3].map((r) => A[r * 4] * l[0] + A[r * 4 + 1] * l[1] + A[r * 4 + 2] * l[2] + A[r * 4 + 3]);
        pts.push(project(y, R.proj.d, G.inflate.value));
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

  const euler = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3();
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
    G.inflate.value = R.proj.inflate * Math.min(1, Math.max(0, st.fold)) ** 2;
    G.d.value = R.proj.d;
    G.reveal.value = R.proj.reveal ?? 1;
    G.revealLo.value = R.proj.revealLo ?? -0.5;
    G.revealHi.value = R.proj.revealHi ?? 0.85;
    if (reset) { G.dPrev.value = G.d.value; G.inflatePrev.value = G.inflate.value; }

    // cadrage
    const pts = projectedPoints(T, inset);
    const { c, r } = radiusOf(pts);
    if (!refRadius || reset) {
      // rayon de référence : le tesseract plié
      const T0 = cellTransforms({ ...st, move: null, theta: new Array(8).fill(0), Q: cache.Q[0] }, R.net.parent);
      refRadius = radiusOf(projectedPoints(T0, inset)).r;
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
    for (const p of pts) { const y = new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(q).y * s - v.y; minY = Math.min(minY, y); }
    const lift = Math.max(0, floorY + 0.06 * target - minY);
    group.position.set(-v.x, -v.y + lift, -v.z);

    // matrices de chaque pièce
    for (let cc = 0; cc < 8; cc++) {
      const cell = R.cells[cc], con = cell.content;
      const Afr = cellMatrix(T[cc], cc, inset);
      // objet exposé : tourne d'un nombre entier de tours par boucle
      // la cellule qui passe à l'extérieur (vers l'œil 4D) rentre son objet :
      // projeté, il se superposerait à celui de la cellule intérieure
      const w = apply(T[cc], normalOf(cc))[3];
      const t = Math.min(1, Math.max(0, (w - 0.3) / 0.6)), shrink = 1 - (R.proj.reveal ?? 1) * t * t * (3 - 2 * t);
      const rot = mul3(axisAngle(normv(con.axis), Math.PI * 2 * con.turns * ph), axisAngle(normv(con.tilt), 0.6)).map((x) => x * Math.max(1e-3, shrink));
      const Aco = cellMatrix(T[cc], cc, inset, { m3: rot, t3: [0, 0, 0] });
      for (const role of ROLES) {
        const P = pieceOf(cc, role);
        if (!P.has) continue;
        const A = role === 'content' ? Aco : Afr;
        setMatrix(P.M.Aprev, reset || !P.prev ? A : P.prev);
        setMatrix(P.M.A, A);
        P.prev = A;
      }
    }
    return { state: st, scale: s, lift };
  }

  // la chorégraphie, le patron ou les mouvements ont changé (rien à reconstruire)
  function refresh() {
    if (!R) return;
    cache = { timeline: stepTimeline(R.chor), Q: stepOrientations(R.moves), depth: depthOf(R.net.parent), order: foldOrder(R.net.parent) };
    refRadius = 0;
  }

  return {
    group, setRecipe, refresh, syncGeometry, syncMaterial, update, pieces,
    ready: () => readyFlag,
    progress: () => (totalCount ? 1 - pendingCount / totalCount : 1),
    // (après un saut dans la boucle : pas de vecteurs vitesse)
    resetMotion: () => { for (const P of pieces) P.prev = null; },
    invalidateFraming: () => { refRadius = 0; },
  };
}
