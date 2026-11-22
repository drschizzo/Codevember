// La scène : le décor (poutre, mur), le nid, les lumières.
//
// Principes (gabarit de la skill) :
//  - update(ph) ne dépend que de la recette et de la phase ;
//  - un maillage reçoit son matériau quand SA géométrie est arrivée, et un
//    matériau neuf à chaque nouvelle géométrie (l'ancien est libéré) ;
//  - toutes les lumières sont créées une fois, dans un ordre fixe, au premier
//    niveau de la scène.
import * as THREE from 'three/webgpu';
import { uniformArray, uniform, Fn, vec2, vec3, float, abs, fract, smoothstep, min as tmin, mix } from 'three/tsl';
import { createDecor } from './decor.js';
import { createWasps } from './wasps.js';
import { waspsAt, reliefMap } from '../flight.js';
import { FILM, SLOW } from '../season.js';
import { frameQuat, nestShape } from '../flight.js';
import { cameraScale, cameraOrbit, filmCamera } from '../camera.js';
import { stableVelocity } from '../../../shared/scene/materials.js';
import { legLifts, smoothLifts, smoothCols, legSeek, packLeg, unpackLeg, legTip, legAngles, headPoint, qrot as qrotL } from '../legs.js';
import { buildPaper, buildCombPaper, bandTexture, SEASON_U, heroUniforms } from './paper.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 1, 2); // (la fenêtre : grande, douce)
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.008;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 4; key.shadow.camera.far = 40;
  key.shadow.focus = 0.6;
  // la fenêtre hors champ : son cadre et ses croisillons, adoucis par la
  // distance (la lumière du ciel vient d'une source étendue : pénombre large)
  const win = { cols: uniform(2), rows: uniform(3), bar: uniform(0.035), soft: uniform(0.03), size: uniform(0.36), on: uniform(1) };
  key.colorNode = Fn(([uv]) => {
    const q = uv.xy.sub(0.5);
    const inside = smoothstep(win.size.add(win.soft), win.size.sub(win.soft), abs(q.x)).mul(smoothstep(win.size.mul(1.35).add(win.soft), win.size.mul(1.35).sub(win.soft), abs(q.y)));
    const cell = q.div(vec2(win.size.mul(2), win.size.mul(2.7))).add(0.5).mul(vec2(win.cols, win.rows));
    const f = fract(cell), d = tmin(tmin(f.x, f.x.oneMinus()).div(win.cols), tmin(f.y, f.y.oneMinus()).div(win.rows));
    const bars = smoothstep(win.bar.mul(0.5).sub(win.soft.mul(0.5)), win.bar.mul(0.5).add(win.soft.mul(0.5)), d);
    return vec3(mix(float(1), inside.mul(bars), win.on));
  });
  const rim = new THREE.SpotLight(0xffffff, 100, 0, 0.6, 1, 2);
  for (const l of [key, rim]) { scene.add(l); scene.add(l.target); }

  const decor = createDecor(scene);
  // les cloches emboîtées : un maillage chacune (la plus petite d'abord)
  // la boule de pâte de l'ouvrière du temps fort : la bande vient de là
  // (pâte de la couleur du volet raclé, humide : sombre et lustrée)
  const ballColor = uniform(new THREE.Color());
  const ballMat = new THREE.MeshPhysicalNodeMaterial();
  ballMat.colorNode = vec3(ballColor).mul(0.55);
  ballMat.roughnessNode = float(0.38);
  ballMat.mrtNode = stableVelocity();
  const pulp = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), ballMat);
  pulp.castShadow = true; pulp.receiveShadow = true; pulp.visible = false; pulp.frustumCulled = false;
  scene.add(pulp);
  const nestGroup = new THREE.Group();
  scene.add(nestGroup);
  let bells = [];
  // la cicatrice : le haut arraché de la dernière cloche, sur la poutre
  const scar = new THREE.Mesh(new THREE.BufferGeometry());
  scar.castShadow = scar.receiveShadow = true; scar.frustumCulled = false;
  scene.add(scar);
  let scarReady = false, scarTex = null;
  const found = new THREE.Mesh(new THREE.BufferGeometry());
  found.castShadow = found.receiveShadow = true; found.frustumCulled = false;
  nestGroup.add(found);
  let foundReady = false;
  const wasps = createWasps(scene);
  let waspReady = false;
  gen.request({}, 'wasp').then((o) => { wasps.setGeometry(o.body, o.wings, o.bodyLo); waspReady = true; }).catch((e) => console.error(e));
  const palette = uniformArray(Array.from({ length: 8 }, () => new THREE.Color()), 'color');

  let R = null, P = null, pending = 0, total = 0, version = 0;

  let clock = null, lastU = 0, maps = [];
  function setRecipe(recipe, plan, clk) {
    R = recipe; P = plan; clock = clk; maps = [];
    const v = ++version;
    decor.setRecipe(R);
    R.nest.palette.forEach((c, i) => palette.array[i].set(c));
    foundReady = false; hero = null; heroes = []; picking = null; picked = new Set();
    for (const B of bells) { nestGroup.remove(B.mesh, B.front, B.pre); B.mesh.geometry.dispose(); B.mesh.material?.dispose?.(); B.front.material?.dispose?.(); B.pre.material?.dispose?.(); B.tex?.dispose(); }
    bells = P.bells.map((b) => {
      // deux tracés d'une même géométrie : les écailles finies (sans masque) et le front
      const mesh = new THREE.Mesh(new THREE.BufferGeometry());
      const front = new THREE.Mesh(mesh.geometry);
      for (const o of [mesh, front]) { o.castShadow = o.receiveShadow = true; o.visible = false; o.frustumCulled = false; nestGroup.add(o); }
      // une pré-passe de profondeur des écailles finies : les écailles se
      // recouvrent en tuiles sur plusieurs couches, et sans elle chaque pixel
      // évaluait le papier (bandes, fibres, relief, lumière) une fois par couche
      const pre = new THREE.Mesh(mesh.geometry);
      pre.renderOrder = -10; pre.visible = false; pre.frustumCulled = false;
      nestGroup.add(pre);
      return { ...b, mesh, front, pre, tex: null, ready: false, hideAt: 2, hero: heroUniforms(), info: null };
    });
    // une cloche est recouverte (et rongée de l'intérieur) quand la suivante est fermée
    bells.forEach((B, k) => { if (bells[k + 1]) B.hideAt = bells[k + 1].s1 + 0.004; });
    total = pending = bells.length + 2;
    scarReady = false;
    const B5 = P.bells[P.bells.length - 1];
    gen.request({ seed: R.seed, yBeam: R.decor.yBeam, radius: R.nest.scar ?? 0.5 }, 'scar').then((o) => {
      if (v !== version) return;
      const g = new THREE.BufferGeometry();
      for (const [k, n] of [['position', 3], ['normal', 3], ['pat', 4], ['grow', 2]]) g.setAttribute(k, new THREE.BufferAttribute(o[k], n));
      g.setIndex(new THREE.BufferAttribute(o.index, 1));
      g.computeBoundingSphere();
      scar.geometry.dispose(); scar.geometry = g;
      scarTex?.dispose(); scarTex = bandTexture(o.bands, o.nScales);
      scar.material?.dispose?.();
      scar.material = buildPaper({ bandTex: scarTex, palette, nPal: R.nest.palette.length });
      scarReady = true;
      pending--;
    }).catch((e) => { console.error(e); pending--; });
    // la fondation : pétiole et premier rayon (de la reine à la fermeture de la cloche 0)
    found.visible = false;
    gen.request({ seed: R.seed, yBeam: R.decor.yBeam, s0: P.queen, s1: P.comb, n: 12 }, 'foundation').then((o) => {
      if (v !== version) return;
      const g = new THREE.BufferGeometry();
      for (const [k, n] of [['position', 3], ['normal', 3], ['grow', 2], ['cell', 4]]) g.setAttribute(k, new THREE.BufferAttribute(o[k], n));
      g.setIndex(new THREE.BufferAttribute(o.index, 1));
      g.computeBoundingSphere();
      found.geometry.dispose(); found.geometry = g;
      found.material?.dispose?.();
      found.material = buildCombPaper({ palette, nPal: R.nest.palette.length });
      foundReady = true;
      pending--;
    }).catch((e) => { console.error(e); pending--; });
    bells.forEach((B) => {
      gen.request({ ...R.nest.spec, k: B.k, lam: B.lam, s0: B.s0, s1: B.s1, lite }, 'envelope').then((o) => {
        if (v !== version) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
        g.setAttribute('pat', new THREE.BufferAttribute(o.pat, 4));
        g.setAttribute('grow', new THREE.BufferAttribute(o.grow, 2));
        g.setIndex(new THREE.BufferAttribute(o.index, 1));
        g.computeBoundingSphere();
        B.mesh.geometry.dispose();
        B.mesh.geometry = g; B.front.geometry = g; B.pre.geometry = g;
        B.tex = bandTexture(o.bands, o.nScales);
        B.mesh.material?.dispose?.(); B.front.material?.dispose?.();
        B.mesh.material = buildPaper({ bandTex: B.tex, palette, nPal: R.nest.palette.length, hero: B.hero, part: 'done' });
        B.front.material = buildPaper({ bandTex: B.tex, palette, nPal: R.nest.palette.length, hero: B.hero, part: 'front' });
        // (même sommet que la passe « finie », un rien plus loin : la passe de
        // papier ne perd aucun de ses pixels à l'égalité des profondeurs)
        B.pre.material?.dispose?.();
        B.pre.material = new THREE.MeshBasicNodeMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
        B.pre.material.positionNode = B.mesh.material.positionNode;
        B.mesh.position.y = o.yOff; B.front.position.y = o.yOff; B.pre.position.y = o.yOff;
        B.info = o.info; B.grid = o.grid;
        maps[B.k] = reliefMap(o.position);
        tryPicks(); // (une ouvrière par bande, chacune sur sa cloche, choisies dans l'ordre du film)
        B.ready = true;
        pending--;
      }).catch((e) => { console.error(e); pending--; });
    });
  }

  // ── Le temps fort : une ouvrière pose une bande au bord d'une écaille du front ──
  // (choisie à la saison du ralenti : à moitié faite, tournée vers la caméra, dans
  // la moitié haute du nid)
  // les ouvrières des temps forts : une par ralenti (SLOW strip0…2), chacune
  // sur sa cloche ; `hero` et `HU` désignent celle qu'on calcule (useHero)
  let hero = null, heroes = [], picking = null, HU = null, picked = new Set();
  // (dans l'ordre des bandes, quel que soit l'ordre d'arrivée des cloches :
  // chacune est choisie du côté de la précédente — le choix est déterministe)
  function tryPicks() {
    for (let j = 0; j < P.strips.length; j++) {
      if (picked.has(j)) continue;
      const sj = P.strips[j], B = bells.find((b) => b.s0 <= sj && sj < b.s1);
      if (!B || !B.info) return;
      pickHero(B, j); picked.add(j);
    }
  }
  const huOf = (W) => ({ land: W.c - W.half - 0.012, start: W.c - W.half + 0.01, end: W.c + W.half - 0.002, off: W.c + W.half + 0.014 });
  const useHero = (h) => { hero = h; HU = h.HU; };
  // celle dont le ralenti est le plus proche de u
  const heroFor = (u) => { u -= Math.floor(u); let b = null, bd = 0.2; for (const h of heroes) { const d = Math.abs(u - (h.HU.start + h.HU.end) / 2); if (d < bd) { bd = d; b = h; } } return b; };
  // (l'arrivée en vol — approche, vol stationnaire, pose — prend le début du
  // ralenti ; le travail, le milieu ; le vrombissement puis l'envol, la fin)
  const BUZZ = 0.006; // (ailes qui vrombissent sur le papier avant l'envol)
  // le travail par coups : NS fois, un pas en arrière (38 % du coup) puis une
  // pause où la tête balaie le bord en mâchant ; k : la part du bord posée
  const NS = 6;
  function heroStroke(u) {
    const x = Math.min(1, Math.max(0, (u - HU.start) / (HU.end - HU.start))) * NS;
    const i = Math.min(NS - 1, Math.floor(x)), f = x - i;
    const sm = (a, b, v) => { const q = Math.min(1, Math.max(0, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
    return { k: (i + sm(0, 0.38, f)) / NS, pause: sm(0.38, 0.5, f) * (1 - sm(0.9, 1, f)) * (u > HU.start && u < HU.end ? 1 : 0) };
  }
  function gridPoint(B, id, t, a) {
    const [NT, NA, tMin] = B.grid, v0 = B.info[id * 4];
    const jf = Math.pow(Math.max(0, (t - tMin) / (1 - tMin)), 1 / 0.85) * NT, j = Math.min(NT - 1, Math.floor(jf)), fj = jf - j;
    const af = Math.min(1, Math.max(0, a)) * NA, i = Math.min(NA - 1, Math.floor(af)), fi = af - i;
    const P3 = B.mesh.geometry.attributes.position.array, N3 = B.mesh.geometry.attributes.normal.array;
    const at = (A, jj, ii) => { const v = (v0 + jj * (NA + 1) + ii) * 3; return [A[v], A[v + 1], A[v + 2]]; };
    const bl = (A) => { const a00 = at(A, j, i), a01 = at(A, j, i + 1), a10 = at(A, j + 1, i), a11 = at(A, j + 1, i + 1); return [0, 1, 2].map((k) => (a00[k] * (1 - fi) + a01[k] * fi) * (1 - fj) + (a10[k] * (1 - fi) + a11[k] * fi) * fj); };
    const p = bl(P3); p[1] += B.mesh.position.y;
    const n = bl(N3); const l = Math.hypot(...n) || 1;
    return { p, n: n.map((x) => x / l) };
  }
  function pickHero(B, j) {
    const SJ = P.strips[j];
    HU = huOf(SLOW.find((w) => w.name === `strip${j}`));
    // (la caméra du film telle qu'elle est quand la descente commence : l'orbite
    // l'a déjà tournée — l'écaille doit faire face à celle-là)
    const FC0 = filmCamera(R.camera, R.decor.yBeam, cameraScale(clock, P)(HU.land - 0.035), cameraOrbit()(HU.land - 0.035));
    // (après la première, la référence est le gros plan précédent : la
    // suivante est prise du même côté du nid, et le transfert de l'une à
    // l'autre remonte et redescend au lieu de faire le tour du nid)
    const prevH = heroes.find((x) => x.j === j - 1);
    const refDir = prevH?.camDir ?? FC0.pos.map((x, i) => x - FC0.target[i]);
    const camDir = new THREE.Vector3(...refDir).normalize();
    let best = null, bs = -1e9;
    const n = B.info.length / 4;
    // (grille des sommets du dessus des écailles : une écaille n'est retenue que
    // si rien ne recouvre le bord où l'ouvrière va travailler)
    const P3 = B.mesh.geometry.attributes.position.array, PT = B.mesh.geometry.attributes.pat.array, yo = B.mesh.position.y;
    const cellSz = 0.03, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cellSz)},${Math.floor(y / cellSz)},${Math.floor(z / cellSz)}`;
    for (let v = 0; v < P3.length / 3; v += 2) {
      const code = PT[v * 4 + 3], idc = Math.floor(code / 4 + 0.01);
      if (code - idc * 4 > 0.5) continue;
      const k = key(P3[v * 3], P3[v * 3 + 1] + yo, P3[v * 3 + 2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(v);
    }
    const covered = (sid, p, nn) => {
      const [cx, cy, cz] = [Math.floor(p[0] / cellSz), Math.floor(p[1] / cellSz), Math.floor(p[2] / cellSz)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          if (Math.floor(PT[v * 4 + 3] / 4 + 0.01) - 1 === sid) continue;
          const d = [P3[v * 3] - p[0], P3[v * 3 + 1] + yo - p[1], P3[v * 3 + 2] - p[2]];
          const along = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2];
          if (along > 0.002 && along < 0.05 && Math.hypot(...d.map((x, i) => x - nn[i] * along)) < 0.03) return true;
        }
      }
      return false;
    };
    // (passes de plus en plus larges : il y a toujours un temps fort)
    const cl = [];
    const passes = [{ g: [0.74, 0.9], face: 0.2, cover: true }, { g: [0.6, 0.96], face: 0.0, cover: true }, { g: [0.5, 0.98], face: -0.2, cover: true }, { g: [0.74, 0.9], face: 0.2, cover: false }, { g: [0.45, 0.99], face: -0.3, cover: false }];
    for (const [pi, ps] of passes.entries()) {
      for (let id = 0; id < n; id++) {
        const b = B.info[id * 4 + 1], d = B.info[id * 4 + 2], nb = B.info[id * 4 + 3];
        const g0 = (SJ - b) / d;
        if (!(g0 > ps.g[0] && g0 < ps.g[1]) || nb < 8) continue;
        const c = gridPoint(B, id, g0, 0.5);
        const face = c.n[0] * camDir.x + c.n[1] * camDir.y + c.n[2] * camDir.z;
        if (face < ps.face) continue;
        if (ps.cover && [0.3, 0.45, 0.6].some((aa) => { const q = gridPoint(B, id, Math.min(1, g0 + 0.04), aa); return covered(id, q.p, q.n); })) continue;
        const sc = face * 2 - Math.abs(c.p[1] - 0.15) * 1.2 - Math.abs(c.p[0] - 0.25) * 0.4;
        if (!cl.some((x) => x.id === id)) cl.push({ sc: sc - pi * 10, id, g0, w: 1.3 / nb });
      }
    }
    if (!cl.length) return;
    // (parmi les six meilleures écailles, celle où l'ouvrière, une fois placée,
    // a le plus de pattes sur le papier : au bord libre d'une écaille dont
    // l'intérieur est recouvert, la moitié de ses pattes marchaient dans le vide)
    cl.sort((x, y) => y.sc - x.sc);
    // (jusqu'à douze, dans l'ordre des passes et du score ; on s'arrête dès
    // qu'une écaille donne un bon appui — plus de 45 % des tarses sur le papier)
    let bestH = null;
    for (const cand of cl.slice(0, 12)) {
    if (bestH && bestH.support >= 0.45) break;
    hero = { B, j, HU, ...cand, a0: 0.18 + ((cand.id * 0.618) % 1) * 0.2, grid, cellSz, P3, yo };
    picking = hero;
    // ── dégagement : l'ouvrière enveloppée de quatre volumes (gastre, thorax,
    // tête, ailes repliées), confrontés à tous les sommets du papier proches ;
    // pour chaque point de la course, le plus petit déplacement (vers le dehors,
    // vers le bord libre) qui ne laisse aucun sommet dedans ──
    {
      const NRM = B.mesh.geometry.attributes.position.count;
      const c0 = heroFrame(HU.start).body;
      const near = [];
      for (let v = 0; v < NRM; v++) { const x = P3[v * 3] - c0[0], y = P3[v * 3 + 1] + yo - c0[1], z = P3[v * 3 + 2] - c0[2]; if (x * x + y * y + z * z < 0.09) near.push(v); }
      const ELL = [[-0.04, -0.004, 0, 0.042, 0.021, 0.023], [0.026, 0.004, 0, 0.023, 0.019, 0.017], [0.056, 0.002, 0, 0.012, 0.018, 0.021], [-0.02, 0.017, 0, 0.052, 0.005, 0.013]];
      const hits = (F, al, be) => {
        const o = F.body.map((x, i) => x + F.n[i] * al + F.toEdge[i] * be);
        let h = 0;
        for (const v of near) {
          const d = [P3[v * 3] - o[0], P3[v * 3 + 1] + yo - o[1], P3[v * 3 + 2] - o[2]];
          const l = [d[0] * F.fwd[0] + d[1] * F.fwd[1] + d[2] * F.fwd[2], d[0] * F.n[0] + d[1] * F.n[1] + d[2] * F.n[2], d[0] * F.side[0] + d[1] * F.side[1] + d[2] * F.side[2]];
          for (const e of ELL) { const q = ((l[0] - e[0]) / e[3]) ** 2 + ((l[1] - e[1]) / e[4]) ** 2 + ((l[2] - e[2]) / e[5]) ** 2; if (q < 1) { h++; break; } }
          if (h) return h;
        }
        return h;
      };
      // le placement : un décalage vers le bord libre (β, négatif : vers
      // l'intérieur de l'écaille) le même sur tout le passage, et pour chaque
      // point de la course le plus petit soulèvement (α) sans aucun sommet dans
      // l'ouvrière ; parmi les β possibles, celui où le plus de tarses trouvent
      // du papier à portée (une patte ne descend ni ne monte de plus de 4 mm) —
      // pousser l'ouvrière vers le bord la dégageait, mais la moitié de ses
      // pattes marchaient alors dans le vide
      const ALS = []; for (let al = 0; al <= 0.06; al += 0.003) ALS.push(al);
      // (au plus 3 mm vers l'intérieur : ses mandibules restent sur la bande qu'elle pose au bord)
      const BES = []; for (let be = -0.03; be <= 0.0401; be += 0.01) BES.push(+be.toFixed(3));
      const frames = [];
      for (let kk = 0; kk <= 8; kk++) {
        // (u tel que la progression k vaut kk / 8)
        let lo = HU.start, hi = HU.end;
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; (heroStroke(m).k < kk / 8 ? (lo = m) : (hi = m)); }
        frames.push(heroFrame((lo + hi) / 2));
      }
      const support = (F, al, be) => {
        const o = F.body.map((x, i) => x + F.n[i] * al + F.toEdge[i] * be), q = frameQuat(F.fwd, F.n), hf = paperHeight(F.n, o, -(0.025 + al));
        let nOk = 0;
        for (const g of [0, 1.6, 3.1, 4.7]) for (let c = 0; c < 6; c++) {
          const w = qrotL(q, legTip(c, legAngles(c, [g, 0, 0, 1], 0, 0, true))), h = hf(w.map((x, i) => x + o[i]));
          if (h != null && Math.abs(w[0] * F.n[0] + w[1] * F.n[1] + w[2] * F.n[2] - h) < 0.004) nOk++;
        }
        return nOk;
      };
      hero.clear = null;
      let best = null;
      for (const be of BES) {
        const als = frames.map((F) => ALS.find((al) => hits(F, al, be) === 0));
        if (als.some((x) => x == null)) continue;
        const sup = frames.reduce((acc, F, kk) => acc + support(F, als[kk], be), 0);
        const sc = sup - Math.abs(be) * 10 - als.reduce((x, y) => x + y, 0) * 6;
        if (!best || sc > best.sc) best = { sc, be, als, sup };
      }
      if (!best) best = { be: 0.04, als: frames.map(() => 0.036), sup: 0 };
      hero.support = best.sup / (frames.length * 24);
      const out = best.als.map((al) => [al, best.be]);
      // (α dilaté puis lissé : jamais sous le dégagement nécessaire, sans à-coup)
      const dil = out.map((_, kk) => Math.max(out[Math.max(0, kk - 1)][0], out[kk][0], out[Math.min(out.length - 1, kk + 1)][0]));
      for (let kk = 0; kk < out.length; kk++) out[kk] = [(dil[Math.max(0, kk - 1)] + 2 * dil[kk] + dil[Math.min(out.length - 1, kk + 1)]) / 4, best.be];
      hero.clear = out;
    }
    if (!bestH || hero.support > bestH.support + 1e-9) bestH = hero;
    }
    hero = bestH; picking = hero; best = { id: hero.id, g0: hero.g0, w: hero.w };
    // l'angle de la caméra : le premier, parmi quelques-uns, dont la ligne de
    // visée ne rentre pas dans l'enveloppe (sinon une écaille voisine masque
    // l'ouvrière) ; testé sur l'ellipsoïde de la cloche, écailles relevées comprises
    const N = nestShape(R.nest.spec, P, SJ);
    hero.shell = { a: N.a, b: N.b, cy: N.cy }; // (l'enveloppe, pour que la caméra n'y entre pas en revenant)
    const mid = heroFrame((HU.start + HU.end) / 2);
    const inside = (q) => { const x = q[0] / N.a, y = (q[1] - N.cy) / N.b, z = q[2] / N.a; return Math.hypot(x, y, z) < 1 + 0.05 / N.b; };
    const cands = [[0.24, 0.12, 0.12], [0.24, 0.12, -0.12], [0.3, 0.02, 0.14], [0.3, 0.02, -0.14], [0.28, 0.08, 0.2], [0.28, 0.08, -0.2], [0.34, 0.15, 0], [0.42, 0, 0]];
    hero.camOff = cands[cands.length - 1];
    // (parmi les angles dégagés : le plus proche de la direction d'où arrive la
    // caméra du film — elle n'a pas à faire le tour du nid pour descendre —,
    // l'ordre de la liste départageant les angles voisins)
    const fdir = nrm3([camDir.x, camDir.y, camDir.z]);
    let bestC = Infinity;
    cands.forEach((c, ci) => {
      // (dégagée sur tout l'arc du travelling, pas seulement au milieu)
      let clear = true;
      for (const kc of [0, 0.25, 0.5, 0.75, 1]) {
        const cam = heroCamPos(mid.body, mid.n, mid.toEdge, mid.along, kc, c);
        if (cam[1] > R.decor.yBeam - 0.05) { clear = false; break; }
        for (let k = 1; k < 12 && clear; k++) { const f = k / 12, q = [0, 1, 2].map((i) => cam[i] + (mid.body[i] - cam[i]) * f * 0.85); if (inside(q)) clear = false; }
        if (!clear) break;
      }
      if (!clear) return;
      const cd = nrm3(heroCamPos(mid.body, mid.n, mid.toEdge, mid.along, 0, c).map((x, i) => x - mid.body[i]));
      const sc = Math.acos(Math.max(-1, Math.min(1, cd[0] * fdir[0] + cd[1] * fdir[1] + cd[2] * fdir[2]))) + 0.15 * ci;
      if (sc < bestC) { bestC = sc; hero.camOff = c; }
    });
    // (la descente dure d'autant plus que la caméra a d'angle à parcourir :
    // la même vitesse de rotation pour un détour de 25° ou de 85°)
    {
      const cd = nrm3(heroCamPos(mid.body, mid.n, mid.toEdge, mid.along, 0).map((x, i) => x - mid.body[i]));
      const ang = Math.acos(Math.max(-1, Math.min(1, cd[0] * fdir[0] + cd[1] * fdir[1] + cd[2] * fdir[2])));
      hero.angK = Math.min(2.6, Math.max(1, ang / 0.55));
      hero.camDir = nrm3(heroCamPos(mid.body, mid.n, mid.toEdge, mid.along, 1).map((x, i) => x - mid.body[i]));
      hero.approach = 0.045 * hero.angK;
    }
    // l'appui des pattes, image par image sur toute la course (au rythme du
    // film : 60 i/s, ralenti ×0,5), puis comblé et lissé dans le temps
    {
      hero.lifts = null;
      const du = 1 / (R.loop.duration * 60), rawL = [], rawY = [];
      for (let u = HU.start; u < HU.end; u += du) {
        const H = heroAt(u);
        if (!H?.st?.legL) { rawL.push([NaN, NaN, NaN, NaN, NaN, NaN]); rawY.push([0, 0, 0, 0, 0, 0]); continue; }
        const st = H.st, L = [...st.legL], Y = [0, 0, 0, 0, 0, 0], ref = -(0.025 + (hero.al ?? 0));
        const hf0 = paperHeight(H.n, st.p, ref), near = paperNear(H.n, st.p, ref);
        for (let c = 0; c < 6; c++) {
          if (Number.isFinite(L[c])) continue;
          // (au-dessus du vide : la patte va chercher le bord le plus proche)
          const r = legSeek(st, H.n, c, hf0, { rim: (x) => { const q = near(x); return q ? Math.hypot(q[0] - x[0], q[1] - x[1], q[2] - x[2]) : null; } });
          if (r) { L[c] = r[0]; Y[c] = r[1]; continue; }
          // (rien à portée : la patte ne fait pas de pas dans le vide — elle est
          // relevée et tenue immobile, le balancement de la marche annulé à la hanche)
          const pair = Math.floor(c / 2), side = c - pair * 2, ph = st.pose[0] + ((pair + side) * 0.5 % 1) * 2 * Math.PI;
          L[c] = 0.45; Y[c] = Math.cos(ph) * 0.42 * (1 - 2 * side);
        }
        rawL.push(L); rawY.push(Y);
      }
      if (rawL.length > 1) {
        // (lissage simple — un maximum glissant levait chaque patte au plus haut
        // de ses voisines dans le temps, et elle flottait —, puis une
        // résolution exacte à chaque image, partie de la valeur lissée)
        const filled = smoothLifts(rawL, 0.01), sm = smoothCols(filled, 1.2), sy = smoothCols(rawY, 2.5);
        // (vérification après lissage : là où un tarse, avec la correction
        // lissée, serait dans le papier, le solveur repart de cette correction
        // ; puis, au bord d'une lèvre — une marche —, la patte se lève par
        // petits pas jusqu'à poser sur la couche du dessous)
        hero.lifts = { u0: HU.start, du, rows: sm.map((r, k) => [...r, ...sy[k]]) };
        // 1. résolution exacte à chaque image, partie de la valeur lissée
        const frames = [];
        let k = 0;
        for (let u = HU.start; u < HU.end && k < sm.length; u += du, k++) {
          const H = heroAt(u);
          if (!H?.st) { frames.push(null); continue; }
          const st = { ...H.st, ext2: [0] }, hf = paperHeight(H.n, H.st.p, -(0.025 + (hero.al ?? 0)));
          const L2 = legLifts(st, H.n, hf, { init: sm[k], yaw: sy[k] });
          for (let c = 0; c < 6; c++) if (Number.isFinite(L2[c])) sm[k][c] = L2[c];
          frames.push({ st, hf, n: H.n });
        }
        // 2. un lissage léger (une image) : pas de saut d'une image à l'autre
        const sm2 = smoothCols(sm, 1.0), sy2 = smoothCols(sy, 1.0);
        // 3. au bord d'une lèvre (une marche), si un tarse reste dans le papier,
        // la patte se lève par petits pas jusqu'à poser sur la couche du dessous
        hero.lifts = { u0: HU.start, du, rows: sm2.map((r, i) => [...r, ...sy2[i]]) };
        frames.forEach((F, i) => {
          if (!F) return;
          for (let c = 0; c < 6; c++) {
            const y = sy2[i][c];
            let l = sm2[i][c];
            for (let it = 0; it < 24; it++) {
              const t = legTip(c, legAngles(c, F.st.pose, 0, l, true, y)), w = qrotL(F.st.q, t), x = w.map((q, j) => q + F.st.p[j]), h = F.hf(x);
              if (h == null || w[0] * F.n[0] + w[1] * F.n[1] + w[2] * F.n[2] >= h - 1e-5) break;
              l += 0.04;
            }
            hero.lifts.rows[i][c] = l;
          }
        });
      }
    }
    B.hero.id.value = best.id; B.hero.g0.value = best.g0; B.hero.w.value = best.w;
    // (chaque ouvrière apporte la pâte d'une autre planche : la bande du milieu,
    // la peinture du village ; les deux autres, ses voisines dans la palette)
    const nPal = R.nest.palette.length, paint = R.nest.paint ?? 3;
    hero.color = R.nest.palette[(paint + [nPal - 1, 0, 1][j]) % nPal];
    B.hero.color.value.set(hero.color);
    heroes.push(hero); picking = null;
  }
  // la hauteur du papier (le long de n, depuis p0) sous un point du monde, sur
  // la couche où se tient l'ouvrière (la plus proche de ref : l'écaille du
  // dessous, quelques millimètres plus bas au-delà du bord, n'est pas son
  // appui), moyennée sur un petit disque (sans marche d'un sommet à l'autre) ;
  // au-dessus du vide, le bord le plus proche de cette couche ; null : rien
  function paperHeight(n, p0, ref0 = -0.025, perFoot = true) {
    const { grid, cellSz, P3, yo } = hero;
    return (x) => {
      // (la couche la plus proche du tarse lui-même : l'ouvrière peut se tenir
      // à cheval sur deux écailles, une patte sur la lèvre de celle du dessus)
      const ref = perFoot ? Math.max(ref0 - 0.004, Math.min(ref0 + 0.03, (x[0] - p0[0]) * n[0] + (x[1] - p0[1]) * n[1] + (x[2] - p0[2]) * n[2])) : ref0;
      for (const r of [0.007, 0.014, 0.03]) { // (enfin : le bord le plus proche, que la patte agrippe)
        const cx = Math.floor(x[0] / cellSz), cy = Math.floor(x[1] / cellSz), cz = Math.floor(x[2] / cellSz);
        const got = [];
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = [P3[v * 3] - x[0], P3[v * 3 + 1] + yo - x[1], P3[v * 3 + 2] - x[2]];
            const a = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
            if (a < -0.06 || a > 0.02) continue; // (une autre écaille, loin dessous ou dessus ; le corps peut être soulevé de 4 mm)
            const lat = Math.hypot(d[0] - n[0] * a, d[1] - n[1] * a, d[2] - n[2] * a);
            if (lat < r) got.push([(P3[v * 3] - p0[0]) * n[0] + (P3[v * 3 + 1] + yo - p0[1]) * n[1] + (P3[v * 3 + 2] - p0[2]) * n[2], (1 - lat / r) ** 2]);
          }
        }
        if (!got.length) continue;
        // (poids continus, sans choix tranché d'une couche : autour de ref, puis
        // resserrés autour de ce premier résultat — la hauteur ne fait pas de marche)
        let h1 = ref;
        for (const sg of [0.004, 0.0012]) {
          let sw = 0, sh = 0;
          for (const [h, w] of got) { const k = (w + 1e-3) * Math.exp(-(((h - h1) / sg) ** 2)); sw += k; sh += h * k; }
          if (sw < 1e-6) { h1 = null; break; }
          h1 = sh / sw;
        }
        if (h1 == null || Math.abs(h1 - ref) > 0.012) continue; // (pas la couche de l'appui)
        return h1;
      }
      return null;
    };
  }
  // la caméra du temps fort : le décalage choisi (camOff, en normale, vers le
  // bord, le long), tourné autour de la normale d'un arc de ±0,2 rad et
  // rapproché de 1,3 à 0,85 au fil du passage (kc : 0 → 1) — un travelling
  // le long du bord, jamais un zoom
  const nrm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  function heroCamPos(body, n, toEdge, along, kc, o = hero.camOff) {
    const th = (kc - 0.5) * 0.4, sc = 1.3 - 0.45 * kc, c = Math.cos(th), s = Math.sin(th);
    return body.map((x, i) => x + (n[i] * o[0] + (toEdge[i] * c + along[i] * s) * o[1] + (along[i] * c - toEdge[i] * s) * o[2]) * sc);
  }
  // le point de papier le plus proche d'un tarse au-dessus du vide (à moins
  // de 8 mm, sur la couche où se tient l'ouvrière) : le bord qu'il agrippe ;
  // moyenné sur les sommets voisins du plus proche (pas de saut d'un sommet à l'autre)
  function paperNear(n, p0, ref = -0.025) {
    const { grid, cellSz, P3, yo } = hero;
    return (x) => {
      const cx = Math.floor(x[0] / cellSz), cy = Math.floor(x[1] / cellSz), cz = Math.floor(x[2] / cellSz);
      const got = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const q = [P3[v * 3], P3[v * 3 + 1] + yo, P3[v * 3 + 2]];
          const h = (q[0] - p0[0]) * n[0] + (q[1] - p0[1]) * n[1] + (q[2] - p0[2]) * n[2];
          if (Math.abs(h - ref) > 0.012) continue; // (pas la couche de l'appui)
          const d = Math.hypot(q[0] - x[0], q[1] - x[1], q[2] - x[2]);
          if (d < 0.008) got.push([d, q]);
        }
      }
      if (!got.length) return null;
      const d0 = Math.min(...got.map((g) => g[0]));
      let sw = 0; const m = [0, 0, 0];
      for (const [d, q] of got) { const w = Math.exp(-(((d - d0) / 0.0008) ** 2)); sw += w; for (let i = 0; i < 3; i++) m[i] += q[i] * w; }
      return m.map((v) => v / sw);
    };
  }
  // la pose de l'ouvrière du temps fort, et la caméra qui la suit
  function heroFrame(u) { return heroAt(u, true); }
  function heroAt(u, frameOnly = false, h = null) {
    h = h ?? picking ?? heroFor(u);
    if (!h) return null;
    useHero(h);
    const Dl = R.loop.duration;
    const { B, id, g0, w } = hero;
    const tm = g0 + w * 0.5;
    const sst = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
    const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    // elle pose un tiers du bord : sa tête (là où sort la pâte) avance de a0 à a1
    const a0 = hero.a0, a1 = a0 + 0.34;
    const SK = heroStroke(u), k = SK.k;
    const chew = Math.sin(u * Dl * 60 * 2 * Math.PI * 0.05) * SK.pause; // (~3 Hz au ralenti ×0,5 : elle presse la pâte pendant les pauses)
    const aHead = a0 + (a1 - a0) * k;
    // repère local du bord : le long (vers les a croissants), vers le bord libre, normale
    // (un repère fixe pour tout le passage, pris sur la corde de l'arc posé : le
    // bord se courbe, mais elle ne pivote pas à chaque pas)
    const S0 = gridPoint(B, id, tm, aHead + 0.05), A0 = gridPoint(B, id, tm, a0), A1 = gridPoint(B, id, tm, a1 + 0.1);
    const Mid = gridPoint(B, id, tm, (a0 + a1) / 2 + 0.05), E = gridPoint(B, id, Math.min(1, tm + 0.12), (a0 + a1) / 2 + 0.05);
    const along = nrm(A1.p.map((x, i) => x - A0.p[i])), toEdge = nrm(E.p.map((x, i) => x - Mid.p[i])), n = nrm(S0.n.map((x, i) => x + Mid.n[i]));
    // le corps le long du bord, la tête vers la bande déjà posée (elle recule en la posant)
    const fwd = nrm(along.map((x, i) => -x * 0.85 + toEdge[i] * 0.35));
    const LH = 0.025;
    let body = S0.p.map((x, i) => x + n[i] * LH + fwd[i] * (0.0008 * chew));
    const side = nrm([fwd[1] * n[2] - fwd[2] * n[1], fwd[2] * n[0] - fwd[0] * n[2], fwd[0] * n[1] - fwd[1] * n[0]]);
    // dégagement contre le papier (dessous comme dessus), calculé au choix de
    // l'écaille sur toute la course et interpolé : le corps ne tremble pas
    if (hero.clear) {
      const cl = hero.clear, x = k * (cl.length - 1), i0 = Math.min(cl.length - 2, Math.floor(x)), f = x - i0;
      const al = cl[i0][0] * (1 - f) + cl[i0 + 1][0] * f, be = cl[i0][1] * (1 - f) + cl[i0 + 1][1] * f;
      body = body.map((v, i) => v + n[i] * al + toEdge[i] * be);
      hero.al = al; // (le corps soulevé d'autant : l'appui est plus bas)
    }
    const fwdP = fwd;
    if (frameOnly) return { body, n, toEdge, along, fwd, side };
    // (pose.w : ailes repliées ; buzz les déplie et les fait battre sans que le corps vole)
    const pose = (gait, fly, buzz = 0) => [gait, fly, u * Dl * 120 * 2 * Math.PI, 1 - Math.max(fly, buzz)];
    const dist = Math.hypot(...A1.p.map((x, i) => x - A0.p[i])) * k; // (le chemin parcouru le long du bord : la foulée en découle)
    const tt = u * Dl, TAU = 2 * Math.PI; // (secondes de film)
    const lerp3 = (a, b, q) => a.map((x, i) => x + (b[i] - x) * q);
    const hover = body.map((x, i) => x + n[i] * 0.055 + toEdge[i] * 0.03 - fwd[i] * 0.012);
    let st = null;
    if (u >= HU.land && u < HU.start) {
      // elle arrive en vol, sa boule de pâte aux mandibules : elle ralentit, se
      // tient en vol stationnaire au-dessus du bord (une hésitation en zigzag,
      // comme une guêpe qui inspecte), puis descend et se pose
      const q = (u - HU.land) / (HU.start - HU.land);
      // (elle vient du côté opposé à la caméra : elle traverse le cadre vers
      // l'écaille, jamais devant l'objectif)
      const away = (hero.camOff?.[2] ?? 0) >= 0 ? -1 : 1;
      const from = body.map((x, i) => x + n[i] * 0.3 + toEdge[i] * 0.12 + along[i] * 0.32 * away);
      let p, look = fwd;
      if (q < 0.5) {
        const a = 1 - (1 - q / 0.5) ** 2;
        p = lerp3(from, hover, a);
        look = nrm(lerp3(nrm(hover.map((x, i) => x - from[i])), fwd, sst(0.15, 0.5, q)));
      } else if (q < 0.78) {
        const h = (q - 0.5) / 0.28, damp = 1 - h;
        p = hover.map((x, i) => x + side[i] * Math.sin(h * TAU * 1.5) * 0.006 * damp + n[i] * Math.sin(h * TAU * 2.2) * 0.002 * damp);
        look = nrm(fwd.map((x, i) => x + side[i] * Math.sin(h * TAU * 1.5 + 0.8) * 0.25 * damp));
      } else p = lerp3(hover, body, sst(0.78, 1, q));
      const up = nrm(lerp3([0, 1, 0], n, sst(0.25, 0.8, q)));
      st = { p, q: frameQuat(look, up), s: 1, pose: pose(tt * TAU * 3, 1 - sst(0.86, 1, q)), ext: [tt * TAU * 2, tt * TAU * 2.6, 0, tt * TAU * 1.4] };
    } else if (u >= HU.start && u < HU.end + BUZZ) {
      // le travail : par coups (heroStroke) ; pendant les pauses, la tête
      // balaie le bord en mâchant, les antennes s'abaissent et tapotent le
      // papier ; à la fin, les ailes vrombissent sur place
      const buzz = sst(HU.end, HU.end + BUZZ, u);
      st = { p: body, q: frameQuat(fwdP, n), s: 1, pose: pose((dist / 0.034) * 2 * Math.PI, 0, buzz), ext: [tt * TAU * 3, tt * TAU * (1.6 + 1.2 * SK.pause), SK.pause * Math.sin(tt * TAU * 1.3) * 0.8, tt * TAU * 1.4] };
      // chaque tarse sur le papier sous lui (legs.js : le squelette du shader,
      // la correction du fémur) ; une patte au-dessus du vide garde sa pose
      // (et la hanche de chaque patte au-dessus du vide, qui la porte jusqu'au
      // bord le plus proche : 12 valeurs par image, fémur puis hanche)
      let L, Y = [0, 0, 0, 0, 0, 0];
      if (hero.lifts) { // (calculées d'avance sur la course, lissées : interpolées)
        const T = hero.lifts, x = Math.min(T.rows.length - 1.001, Math.max(0, (u - T.u0) / T.du)), i0 = Math.floor(x), f = x - i0;
        const r = T.rows[i0].map((v, c) => v * (1 - f) + T.rows[i0 + 1][c] * f);
        L = r.slice(0, 6); Y = r.slice(6, 12);
      } else L = legLifts(st, n, paperHeight(n, body, -(LH + (hero.al ?? 0))));
      st.legL = L; st.legY = Y;
      const pk = (c) => (Number.isFinite(L[c]) ? packLeg(L[c], Y[c]) : 0);
      st.ext2 = [0, pk(0), pk(1), pk(2)]; st.ext3 = [pk(3), pk(4), pk(5), 0.25 + 0.6 * SK.pause];
    } else if (u >= HU.end + BUZZ && u < HU.off) {
      // l'envol : elle se soulève, les pattes se replient, elle s'éloigne
      const away = (hero.camOff?.[2] ?? 0) >= 0 ? -1 : 1;
      const q = sst(HU.end + BUZZ, HU.off, u), to = body.map((x, i) => x + n[i] * 0.4 + toEdge[i] * 0.15 + along[i] * 0.3 * away);
      st = { p: lerp3(body, to, q * q), q: frameQuat(nrm(lerp3(fwd, nrm(to.map((x, i) => x - body[i])), q)), n), s: 1, pose: pose(u * 900, sst(0, 0.25, q), 1) };
    }
    B.hero.a.value = u < HU.start ? (u >= HU.end ? a1 : 0) : aHead;
    B.hero.a0.value = a0;
    B.hero.wet.value = u < HU.off + 0.02 ? 1 : 0; // (humide pendant le ralenti ; sèche aussitôt dans l'accéléré)
    // la boule de pâte, entre les mandibules : elle maigrit à mesure que la
    // bande est posée, pressée jusqu'au bout pendant le vrombissement
    const ball = u >= HU.land && u < HU.end + BUZZ ? 0.0085 * Math.cbrt(Math.max(0, 1 - 0.97 * k)) * (1 - sst(HU.end, HU.end + BUZZ * 0.8, u)) : 0;
    // ── la caméra du temps fort : elle descend en arc vers l'écaille pendant
    // que l'accéléré ralentit, suit l'ouvrière qui arrive (la visée va sur
    // elle), glisse le long du bord pendant le travail en se rapprochant, la
    // suit qui s'envole, et c'est l'envol qui la ramène en arrière ──
    // (si le retour de l'ouvrière précédente n'est pas fini, la descente vers
    // celle-ci commence dès l'envol de la précédente : un plan de transfert
    // d'un gros plan à l'autre, sur tout le temps disponible)
    const prev = heroes.find((x) => x.j === hero.j - 1);
    let a0u = HU.land - (hero.approach ?? 0.035);
    if (prev) { const pEnd = prev.HU.off + 0.065 * (prev.angK ?? 1); if (pEnd > a0u) a0u = Math.min(a0u, prev.HU.end + BUZZ); }
    const wc = sst(a0u, HU.start - 0.002, u) * (1 - sst(HU.end + BUZZ * 0.5, HU.off + 0.065 * (hero.angK ?? 1), u)); // (le recul commence au décollage : elle sort du cadre en un instant)
    const kc = sst(HU.land - 0.03, HU.off + 0.03, u);
    // (à moitié : le point de pose reste dans le cadre, la caméra ne fouette pas)
    const follow = 0.5 * sst(HU.land + 0.007, HU.land + 0.02, u) * (1 - sst(HU.start - 0.006, HU.start + 0.004, u)); // (seulement pendant le vol stationnaire et la pose : au travail, la visée glisse avec le bord, pas avec ses pas) // (elle la lâche pendant qu'elle vrombit encore sur place)
    // (ancrée sur une progression continue le long du bord et une normale fixe
    // pour tout le passage : elle glisse, elle ne suit pas les à-coups des pas)
    const kL = sst(HU.start - 0.01, HU.end + 0.01, u), SC = gridPoint(B, id, tm, a0 + (a1 - a0) * kL + 0.05);
    const nC = nrm(Mid.n), anchor = SC.p.map((x, i) => x + nC[i] * (LH + (hero.al ?? 0)));
    const target = st ? lerp3(anchor, st.p, follow) : anchor;
    const pos = heroCamPos(anchor, nC, toEdge, along, kc);
    return { st, body, n, ball, hero: h, color: hero.color, cam: { w: wc, target, pos, shell: hero.shell } };
  }
  const _c = new THREE.Color(), _w = new THREE.Color();
  const place = (l, az, el, r, target) => {
    l.position.set(target[0] + Math.sin(az) * Math.cos(el) * r, target[1] + Math.sin(el) * r, target[2] + Math.cos(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // S : la saison ; warm : tout montrer (préchauffage des shaders)
  function update(ph, S, warm = false) {
    if (!R) return;
    SEASON_U.s.value = S;
    const sst = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
    // hiver : humidité, gelée (fondues au printemps : nulles à s = 0 comme à s = 1)
    const thaw = 1 - sst(P.fall + 0.01, P.spring, S);
    SEASON_U.damp.value = sst(P.wet, P.frost, S) * thaw;
    SEASON_U.frost.value = sst(P.frost, P.frost + 0.05, S) * thaw;
    // la chute : le pétiole mouillé cède. Une seconde avant, le nid s'affaisse et
    // penche (le papier se déchire à l'attache) ; puis chute libre, g = 9,81 m/s²
    const t = clock.t(ph), tf = clock.t(FILM.fall);
    const pre = sst(-1.2, 0, t - tf), dt = Math.max(0, t - tf);
    const falling = S > P.fall - 0.01 && S < P.spring && t > tf - 2;
    const yB = R.decor.yBeam;
    nestGroup.position.set(0, 0, 0); nestGroup.rotation.set(0, 0, 0);
    if (falling) {
      const drop = 0.012 * pre + 0.5 * 98.1 * dt * dt; // (unités : 1 = 10 cm)
      const tilt = 0.035 * pre + 1.2 * dt * dt;
      // rotation autour du point d'attache, puis la chute
      const piv = new THREE.Vector3(0.35, yB, 0);
      nestGroup.rotation.set(tilt * 0.6, 0, -tilt);
      const off = piv.clone().sub(piv.clone().applyEuler(nestGroup.rotation));
      nestGroup.position.set(off.x, off.y - drop, off.z);
    }
    nestGroup.visible = !(S >= P.fall && dt > 1.2); // (hors du cadre)
    const B5 = bells[bells.length - 1];
    scar.visible = scarReady;
    found.visible = foundReady && (warm || (S >= P.queen && S < P.spring)) && api.only == null;
    pulp.visible = false;
    if (waspReady && api.testWasps) wasps.set(api.testWasps, api.testWasps);
    else if (waspReady && !warm) {
      // dans l'accéléré, une prise de vue toutes les 1/12 s de film (la cadence
      // d'un vrai accéléré) : chaque guêpe se lit, nette, entre deux prises
      const D = R.loop.duration, fast = clock.speed(ph) > 30;
      const q = (u) => (fast ? Math.floor(u * D * 12) / (D * 12) : u);
      const uq = q(ph), up = q(lastU);
      const now = waspsAt(uq, clock, P, R.nest.spec, 110, maps), prev = up === uq ? now : waspsAt(up, clock, P, R.nest.spec, 110, maps);
      const A = [], B = [];
      now.forEach((w, i) => { if (w) { A.push(w); B.push(prev[i] ?? w); } });
      for (const hh of heroes) heroAt(ph, false, hh); // (la bande de chaque cloche suit la phase)
      const h = heroAt(ph), hp = h ? heroAt(lastU, false, h.hero) : null;
      // la boule de pâte entre les mandibules (le cou suit ses gestes : legs.js)
      pulp.visible = !!(h?.st && h.ball > 1e-4);
      if (pulp.visible) {
        ballColor.value.set(h.color);
        const r = h.ball, loc = headPoint(h.st.ext ?? [0, 0, 0, 0], [0.0745 + r * 0.55, -0.0128, 0]);
        const w = qrotL(h.st.q, loc);
        pulp.position.set(h.st.p[0] + w[0], h.st.p[1] + w[1], h.st.p[2] + w[2]);
        pulp.scale.set(r * 1.1, r * 0.9, r); pulp.quaternion.set(...h.st.q);
      }
      if (h?.st) { A.push(h.st); B.push(hp?.st ?? h.st); }
      // (pendant le temps fort, les autres ne passent pas devant elle)
      // (et, dans l'accéléré, aucune ne passe devant l'objectif pendant que la caméra descend vers elle)
      const cp = api.camera?.position;
      if (h && h.cam.w > 0) for (let i = A.length - (h.st ? 2 : 1); i >= 0; i--) {
        const d = Math.hypot(...A[i].p.map((x, k) => x - h.body[k])), dc = cp ? Math.hypot(A[i].p[0] - cp.x, A[i].p[1] - cp.y, A[i].p[2] - cp.z) : 9;
        if (d < 0.45 || (fast && dc < 0.8)) { A.splice(i, 1); B.splice(i, 1); } // (dans l'accéléré seulement : au ralenti, une guêpe qui disparaîtrait en vol se verrait)
      }
      wasps.set(A, B, api.camera ? { p: api.camera.position.toArray(), tan: Math.tan((api.camera.fov * Math.PI) / 360) } : null);
    } else if (warm && waspReady) {
      const w = { p: [0, 0.5, 0], q: [0, 0, 0, 1], s: 1, pose: [0, 0.5, 0, 0.5] };
      wasps.set([w], [w]);
    }
    lastU = ph;
    for (const B of bells) {
      B.mesh.visible = B.ready && (warm || (S >= B.s0 && S < B.hideAt)) && (api.only == null || api.only === B.k);
      B.front.visible = B.mesh.visible && (warm || S < B.s1 + 0.002 || hero?.B === B);
      B.pre.visible = B.mesh.visible && !!B.pre.material;
    }
    const L = R.light;
    // la lumière suit la saison (une seule horloge) : le soleil d'été monte et
    // déplace la tache de la fenêtre sur le mur ; l'hiver est bas, froid, couvert
    const summer = Math.sin(Math.PI * Math.min(1, S / 0.75)), winter = sst(0.68, 0.8, S) * (1 - sst(0.93, 1, S));
    place(key, L.key.az + 0.22 * (S - 0.4), L.key.el + 0.14 * summer - 0.06 * winter, L.key.dist, [0, 0.3, 0]);
    _c.set(L.key.color).lerp(_w.set('#cfe0ff'), 0.35 * winter);
    key.color.copy(_c); key.intensity = L.key.intensity * (0.8 + 0.3 * summer) * (1 - 0.45 * winter); key.angle = L.key.angle; key.penumbra = L.key.pen ?? 0.15;
    win.on.value = L.key.gobo ?? 1;
    scene.environmentIntensity = R.env.intensity * (1 + 0.5 * winter);
    // les guêpes ne reflètent qu'une part du studio : sous la poutre, contre le
    // papier, presque tout ce qu'elles voient est sombre (sans cela, vue d'en
    // dessous, la cuticule noire reflétait le studio clair et virait au gris bleu ;
    // l'occlusion ambiante ne touche pas les reflets)
    for (const m of [wasps.body.material, wasps.bodyLo.material, wasps.wings.material]) {
      if (m.envMap !== scene.environment) { m.envMap = scene.environment; m.needsUpdate = true; }
      m.envMapIntensity = scene.environmentIntensity * 0.35;
      m.envMapRotation.copy(scene.environmentRotation);
    }
    place(rim, L.rim.az, L.rim.el, 10, [0, 0, 0]);
    rim.color.set(L.rim.color); rim.intensity = L.rim.intensity;
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  const api = {
    only: null, testWasps: null, wasps, heroCam: (u) => heroAt(u)?.cam ?? null,
    // les caméras des temps forts actives à la phase u, dans l'ordre du film :
    // le cœur les compose (le retour de l'une enchaîne sur la descente de la suivante)
    heroCams: (u) => [...heroes].sort((a, b) => a.HU.start - b.HU.start).map((hh) => heroAt(u, false, hh)?.cam).filter((c) => c && c.w > 0),
    // la reine, pour la caméra de la fondation (sa tête : là où elle travaille)
    queenAt(u) { if (!R) return null; const Q = waspsAt(u, clock, P, R.nest.spec, 0)[0]; return Q ? { p: Q.p, q: Q.q, s: Q.s } : null; },
    // (mise au point) l'écart de chaque tarse au papier sous lui, en mm, à la phase u
    get heroLifts() { return hero?.lifts ?? null; },
    get heroes() { return heroes.map((h) => ({ j: h.j, bell: h.B.k, id: h.id, angK: h.angK, support: h.support, be: h.clear?.[0]?.[1] })); },
    heroLegY(u) { const H = heroAt(u); return H?.st?.legY ? [H.st.legL.map((v) => +v.toFixed(3)), H.st.legY.map((v) => +v.toFixed(3))] : null; },
    heroLegs(u) {
      const H = heroAt(u); if (!H?.st?.ext3) return null;
      const st = H.st, n = H.n, hf = paperHeight(n, st.p, -(0.025 + (hero.al ?? 0))), L = st.legL, Y = st.legY;
      return L.map((l, c) => {
        const t = legTip(c, legAngles(c, st.pose, 0, l, true, Y[c])), w = qrotL(st.q, t);
        const x = w.map((v, i) => v + st.p[i]), h = hf(x);
        if (h == null) { const q = paperNear(n, st.p, -(0.025 + (hero.al ?? 0)))(x); return q && Math.hypot(q[0] - x[0], q[1] - x[1], q[2] - x[2]) < 0.003 ? 'bord' : null; }
        return h == null ? null : +(((w[0] * n[0] + w[1] * n[1] + w[2] * n[2]) - h) * 100).toFixed(2);
      });
    },
    setRecipe, update, setShadowQuality, nestGroup, get bells() { return bells; }, decor, key, rim,
    syncFinishes() {},
    ready: () => pending === 0 && waspReady,
    progress: () => (total ? 1 - pending / total : 1),
  };
  return api;
}
