// Aides à la lecture du pliage 4D, et lumière dans les cellules.
//
// Un cerveau humain ne se représente pas une rotation dans un plan qui
// contient une quatrième direction. On lui donne donc des prises :
//
//  • Le fantôme : la silhouette du tesseract plié (arêtes fines et
//    lumineuses), à l'endroit exact où les cellules vont se poser. Déplié, on
//    voit déjà la destination, et chaque cube y vole.
//
//  • Les coutures appariées, comme les languettes d'une maquette en papier
//    (« A sur A ») : chaque face porte un liseré lumineux de la couleur de la
//    face qu'elle rejoindra. Deux faces de même couleur se cherchent, leur
//    liseré s'avive à mesure qu'elles s'approchent et s'éteint au contact. Les
//    faces déjà jointes par une charnière du patron sont collées dès le
//    départ : leur liseré ne s'allume jamais.
//
//  • La profondeur 4D en couleur : sur l'ossature et le fantôme, froid du côté
//    opposé à l'œil 4D, chaud tout près. Pendant le quart de tour, on voit le
//    cube intérieur (bleu) passer à l'extérieur (orange).
//
// Et des lumières d'écrin : une petite source au cœur de chaque cellule, qui
// éclaire la doublure, fait briller l'objet exposé et filtre par les ajours.
import * as THREE from 'three/webgpu';
import { Fn, vec4, attribute, positionGeometry, uniformArray, uniform } from 'three/tsl';
import { cellTransforms, cellMatrix, apply, normalOf, project, cellAxis, cellSign, cellOf } from '../math4.js';
import { meshUniforms, setMatrix, mapPoint, depthW, depthColor } from './project.js';
import { buildFrame } from '../gen/cell.js';
import { G } from './globals.js';

// ── Géométries ───────────────────────────────────────────────────────────────
function toGeometry(o, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  for (const [k, [a, n]] of Object.entries(extra)) g.setAttribute(k, new THREE.BufferAttribute(a, n));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  return g;
}
// fantôme : les douze arêtes d'une cellule, en joncs fins
const ghostGeometry = () => toGeometry(buildFrame({ seed: 0, style: 'round', w: 0.011, chamfer: 0, node: 'none', nodeScale: 1 }));

// liserés : un cadre carré sur chaque face, juste à l'intérieur de l'ossature
function seamGeometry(e, w0, w1) {
  const pos = [], face = [], idx = [];
  const N = 10; // subdivisions (la projection gonflée courbe les faces)
  for (let f = 0; f < 6; f++) {
    const k = f >> 1, s = f & 1 ? 1 : -1, u = (k + 1) % 3, v = (k + 2) % 3;
    const P = (a, b) => { const p = [0, 0, 0]; p[k] = s * e; p[u] = a; p[v] = b; return p; };
    // quatre bandes (trapèzes) entre le carré extérieur w1 et intérieur w0
    for (let side = 0; side < 4; side++) {
      const rot = (x, y) => [[x, y], [-y, x], [-x, -y], [y, -x]][side];
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const t = -1 + (2 * i) / N;
        for (const [r, lim] of [[w1, w1], [w0, w0]]) {
          const [a, b] = rot(t * lim, r);
          pos.push(...P(a, b));
          face.push(f);
        }
      }
      for (let i = 0; i < N; i++) { const a = base + 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  return toGeometry({ position: new Float32Array(pos), index: new Uint32Array(idx) }, { face: [new Float32Array(face), 1] });
}

// ── Matériaux ────────────────────────────────────────────────────────────────
const placeNode = (M) => Fn(() => {
  depthW.assign(M.A.mul(vec4(positionGeometry, 1)).w);
  return mapPoint(positionGeometry, M.A, G.d, G.inflate);
})();

function ghostMaterial(M, U) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.positionNode = placeNode(M);
  m.colorNode = vec4(depthColor(depthW).mul(U.ghost), 1);
  return m;
}
function seamMaterial(M, colors, glow) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  m.positionNode = placeNode(M);
  const f = attribute('face', 'float').add(0.5).toInt();
  const g = glow.element(f);
  m.colorNode = vec4(colors.element(f).mul(g), 1);
  m.maskNode = g.greaterThan(0.02);
  return m;
}

// couleurs vives et bien séparées (angle d'or sur la roue des teintes)
const pairColor = (i) => new THREE.Color().setHSL((i * 0.618034) % 1, 0.85, 0.55);

export function createGuides(group, scene) {
  const U = { ghost: uniform(0) };
  const ghostGeo = ghostGeometry();
  const ghosts = [], seams = [], lights = [];
  let seamGeo = null, seamKey = '';
  for (let c = 0; c < 8; c++) {
    const M = meshUniforms();
    const gm = new THREE.Mesh(ghostGeo, ghostMaterial(M, U));
    gm.frustumCulled = false; gm.renderOrder = 10;
    group.add(gm);
    ghosts.push({ mesh: gm, M });
    const SM = meshUniforms();
    const colors = uniformArray(new Array(6).fill(0).map(() => new THREE.Color()), 'color');
    const glow = uniformArray(new Array(6).fill(0), 'float');
    const sm = new THREE.Mesh(new THREE.BufferGeometry(), seamMaterial(SM, colors, glow));
    sm.frustumCulled = false;
    group.add(sm);
    seams.push({ mesh: sm, M: SM, colors, glow });
    const L = new THREE.PointLight(0xffffff, 0, 1, 2);
    L.castShadow = false;
    scene.add(L);
    lights.push(L);
  }

  // partenaire d'une face : la cellule dont la normale est la direction de la face
  const others = (c) => [0, 1, 2, 3].filter((x) => x !== cellAxis(c));
  const partner = (c, f) => cellOf(others(c)[f >> 1], f & 1 ? 1 : -1);
  const faceToward = (c, d) => { const o = others(c), j = o.indexOf(cellAxis(d)); return 2 * j + (cellSign(d) > 0 ? 1 : 0); };
  // une couleur par paire de faces (24 paires) ; les charnières du patron
  // sont déjà jointes
  function setPairs(parent) {
    const ids = new Map();
    let n = 0;
    for (let c = 0; c < 8; c++) for (let f = 0; f < 6; f++) {
      const d = partner(c, f), key = c < d ? `${c}-${d}` : `${d}-${c}`;
      if (!ids.has(key)) ids.set(key, n++);
      seams[c].colors.array[f].copy(pairColor(ids.get(key)));
    }
  }

  const _v = new THREE.Vector3(), _tint = new THREE.Color();
  return {
    seams, ghosts, lights,
    setRecipe(R) {
      setPairs(R.net.parent);
      const e = 1 - R.frame.w, key = `${R.frame.w}|${R.frame.style}`;
      if (key !== seamKey) {
        seamKey = key;
        const old = seamGeo;
        const inner = e - R.frame.w * (R.frame.style === 'angle' ? 2.3 : 1.2);
        seamGeo = seamGeometry(e + R.frame.w * 0.75, inner - 0.075, inner);
        for (const S of seams) S.mesh.geometry = seamGeo;
        old?.dispose();
      }
    },
    // st : état ; T : transformations des cellules ; scale : échelle du groupe
    update(R, st, T, inset, scale) {
      const V = R.view;
      // fantôme : la forme pliée dans l'orientation en cours
      const Tf = cellTransforms({ ...st, move: null, theta: new Array(8).fill(0) }, R.net.parent);
      const fold = Math.min(1, Math.max(0, st.fold));
      U.ghost.value = V.ghost * (1 - fold) ** 1.5 * 1.6;
      // profondeur 4D : lisible plié, surtout pendant le quart de tour
      const tt = Math.min(1, Math.max(0, st.turn)), bump = st.move ? Math.sin(Math.PI * tt) : 0;
      G.depthTint.value = 0.14 * V.depth * fold ** 4 * (0.2 + 0.8 * bump);
      for (let c = 0; c < 8; c++) {
        const Ag = cellMatrix(Tf[c], c, 1);
        setMatrix(ghosts[c].M.A, Ag);
        ghosts[c].mesh.visible = U.ghost.value > 0.003;
        // liserés : selon la distance 4D entre la face et celle qu'elle rejoindra
        const A = cellMatrix(T[c], c, inset);
        setMatrix(seams[c].M.A, A);
        // (faces jointes : séparées du retrait des deux cellules, ≤ 2·(1 − inset))
        const gap = 2.2 * (1 - inset);
        let any = 0;
        for (let f = 0; f < 6; f++) {
          const d = partner(c, f), fd = faceToward(d, c);
          const lc = [0, 0, 0]; lc[f >> 1] = f & 1 ? 1 : -1;
          const ld = [0, 0, 0]; ld[fd >> 1] = fd & 1 ? 1 : -1;
          const pa = apply(T[c], [...embedLocal(c, lc, inset)]), pb = apply(T[d], [...embedLocal(d, ld, inset)]);
          const dist = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2], pa[3] - pb[3]);
          const near = smooth(2.6, 0.35, dist), off = smooth(gap + 0.02, gap + 0.25, dist);
          const g = V.seams * (0.5 + 3.5 * near * near) * off * 2.4;
          seams[c].glow.array[f] = g;
          any = Math.max(any, g);
        }
        seams[c].mesh.visible = any > 0.02;
        // lumière d'écrin : au centre projeté de la cellule ; éteinte quand la
        // cellule passe à l'extérieur (son objet s'est rentré)
        const w = apply(T[c], normalOf(c))[3];
        const out = smooth(0.3, 0.9, w) * (R.proj.reveal ?? 1);
        const kv = G.pass.value; // (voyage intérieur)
        // En voyage, chaque pièce est éclairée à sa taille projetée (les
        // pièces voisines, plus loin de la caméra, sont projetées plus
        // grandes) : on les voit éclairées avant d'y entrer. La lampe est
        // décalée vers le « plafond » de la pièce (au centre, elle serait
        // dans l'objet) et chaque pièce a sa nuance.
        const ctr = apply(T[c], normalOf(c));
        const off = apply(T[c], embedLocal(c, [0, 0.42 * kv, 0], 1));
        const p = project(off, G.d.value, G.inflate.value);
        const p0 = project(ctr, G.d.value, G.inflate.value);
        const p1 = project(apply(T[c], embedLocal(c, [0.3, 0, 0], 1)), G.d.value, G.inflate.value);
        const lam = Math.min(4, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / 0.3);
        const size = 1 + (lam - 1) * kv;
        _v.set(p[0], p[1], p[2]);
        group.localToWorld(_v);
        const L = lights[c];
        L.position.copy(_v);
        L.color.set(V.practicalColor);
        if (kv > 0) L.color.lerp(_tint.setHSL((c * 0.137 + 0.05) % 1, 0.55, 0.62), 0.35 * kv);
        L.intensity = V.practical * (1 - out) * scale * scale * size ** 1.6 * (1 - 0.25 * kv);
        L.distance = 2.4 * scale * size * (1 + 0.25 * kv);
      }
    },
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// point local de la cellule c (retrait inset) → 4D, avant la transformation de la cellule
function embedLocal(c, l, inset) {
  const k = cellAxis(c), o = [0, 1, 2, 3].filter((x) => x !== k), x = normalOf(c);
  o.forEach((a, i) => { x[a] += l[i] * inset; });
  return x;
}
