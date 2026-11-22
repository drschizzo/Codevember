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
import { legLifts, smoothLifts, legTip, legAngles, qrot as qrotL } from '../legs.js';
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
    foundReady = false; hero = null;
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
        if (B.s0 <= P.strip && P.strip < B.s1) pickHero(B);
        B.ready = true;
        pending--;
      }).catch((e) => { console.error(e); pending--; });
    });
  }

  // ── Le temps fort : une ouvrière pose une bande au bord d'une écaille du front ──
  // (choisie à la saison du ralenti : à moitié faite, tournée vers la caméra, dans
  // la moitié haute du nid)
  let hero = null;
  const W0 = SLOW.find((w) => w.name === 'strip');
  const HU = { land: W0.c - W0.half - 0.01, start: W0.c - W0.half + 0.004, end: W0.c + W0.half - 0.002, off: W0.c + W0.half + 0.014 };
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
  function pickHero(B) {
    const camDir = new THREE.Vector3(...R.camera.pos).sub(new THREE.Vector3(...R.camera.target)).normalize();
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
    const passes = [{ g: [0.74, 0.9], face: 0.2, cover: true }, { g: [0.6, 0.96], face: 0.0, cover: true }, { g: [0.5, 0.98], face: -0.2, cover: true }, { g: [0.74, 0.9], face: 0.2, cover: false }];
    for (const ps of passes) {
      for (let id = 0; id < n; id++) {
        const b = B.info[id * 4 + 1], d = B.info[id * 4 + 2], nb = B.info[id * 4 + 3];
        const g0 = (P.strip - b) / d;
        if (!(g0 > ps.g[0] && g0 < ps.g[1]) || nb < 8) continue;
        const c = gridPoint(B, id, g0, 0.5);
        const face = c.n[0] * camDir.x + c.n[1] * camDir.y + c.n[2] * camDir.z;
        if (face < ps.face) continue;
        if (ps.cover && [0.3, 0.45, 0.6].some((aa) => { const q = gridPoint(B, id, Math.min(1, g0 + 0.04), aa); return covered(id, q.p, q.n); })) continue;
        const sc = face * 2 - Math.abs(c.p[1] - 0.15) * 1.2 - Math.abs(c.p[0] - 0.25) * 0.4;
        if (sc > bs) { bs = sc; best = { id, g0, w: 1.3 / nb }; }
      }
      if (best) break;
    }
    if (!best) return;
    hero = { B, ...best, a0: 0.18 + ((best.id * 0.618) % 1) * 0.2, grid, cellSz, P3, yo };
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
      const cands = [];
      for (let al = 0; al <= 0.036; al += 0.003) for (let be = 0; be <= 0.04; be += 0.005) cands.push([al, be]);
      cands.sort((x, y) => x[0] * x[0] + x[1] * x[1] - y[0] * y[0] - y[1] * y[1]);
      hero.clear = null;
      const out = [];
      for (let kk = 0; kk <= 8; kk++) {
        // (u tel que la progression k vaut kk / 8)
        let lo = HU.start, hi = HU.end;
        for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2, q = Math.min(1, Math.max(0, (m - HU.start) / (HU.end - HU.start))); (q * q * (3 - 2 * q) < kk / 8 ? (lo = m) : (hi = m)); }
        const F = heroFrame((lo + hi) / 2);
        out.push(cands.find(([al, be]) => hits(F, al, be) === 0) ?? cands[cands.length - 1]);
      }
      // (dilaté puis lissé : jamais sous le dégagement nécessaire, sans à-coup)
      const dil = out.map((_, kk) => [0, 1].map((c) => Math.max(out[Math.max(0, kk - 1)][c], out[kk][c], out[Math.min(out.length - 1, kk + 1)][c])));
      for (let kk = 0; kk < out.length; kk++) out[kk] = [0, 1].map((c) => (dil[Math.max(0, kk - 1)][c] + 2 * dil[kk][c] + dil[Math.min(out.length - 1, kk + 1)][c]) / 4);
      hero.clear = out;
    }
    // l'angle de la caméra : le premier, parmi quelques-uns, dont la ligne de
    // visée ne rentre pas dans l'enveloppe (sinon une écaille voisine masque
    // l'ouvrière) ; testé sur l'ellipsoïde de la cloche, écailles relevées comprises
    const N = nestShape(R.nest.spec, P, P.strip);
    const mid = heroFrame((HU.start + HU.end) / 2);
    const inside = (q) => { const x = q[0] / N.a, y = (q[1] - N.cy) / N.b, z = q[2] / N.a; return Math.hypot(x, y, z) < 1 + 0.05 / N.b; };
    const cands = [[0.24, 0.12, 0.12], [0.24, 0.12, -0.12], [0.3, 0.02, 0.14], [0.3, 0.02, -0.14], [0.34, 0.15, 0], [0.42, 0, 0]];
    hero.camOff = cands[cands.length - 1];
    for (const c of cands) {
      const cam = [0, 1, 2].map((i) => mid.body[i] + mid.n[i] * c[0] + mid.toEdge[i] * c[1] + mid.along[i] * c[2]);
      let clear = cam[1] < R.decor.yBeam - 0.05;
      for (let k = 1; k < 12 && clear; k++) { const f = k / 12, q = [0, 1, 2].map((i) => cam[i] + (mid.body[i] - cam[i]) * f * 0.85); if (inside(q)) clear = false; }
      if (clear) { hero.camOff = c; break; }
    }
    // l'appui des pattes, image par image sur toute la course (au rythme du
    // film : 60 i/s, ralenti ×0,5), puis comblé et lissé dans le temps
    {
      hero.lifts = null;
      const du = 1 / (64 * 60), rows = [];
      for (let u = HU.start; u < HU.end; u += du) {
        const H = heroAt(u);
        rows.push(H?.st?.ext3 ? [...H.st.ext2.slice(1), ...H.st.ext3.slice(0, 3)] : [NaN, NaN, NaN, NaN, NaN, NaN]);
      }
      if (rows.length > 1) hero.lifts = { u0: HU.start, du, rows: smoothLifts(rows, 1.5) };
    }
    B.hero.id.value = best.id; B.hero.g0.value = best.g0; B.hero.w.value = best.w;
    B.hero.color.value.set(R.nest.palette[R.nest.paint ?? 3]);
  }
  // la hauteur du papier (le long de n, depuis p0) sous un point du monde, sur
  // la couche où se tient l'ouvrière (la plus proche de ref : l'écaille du
  // dessous, quelques millimètres plus bas au-delà du bord, n'est pas son
  // appui), moyennée sur un petit disque (sans marche d'un sommet à l'autre) ;
  // au-dessus du vide, le bord le plus proche de cette couche ; null : rien
  function paperHeight(n, p0, ref = -0.025) {
    const { grid, cellSz, P3, yo } = hero;
    return (x) => {
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
  // la pose de l'ouvrière du temps fort, et la caméra qui la suit
  function heroFrame(u) { return heroAt(u, true); }
  function heroAt(u, frameOnly = false) {
    if (!hero) return null;
    const { B, id, g0, w } = hero;
    const tm = g0 + w * 0.5;
    const sst = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
    const nrm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    // elle pose un tiers du bord : sa tête (là où sort la pâte) avance de a0 à a1
    const a0 = hero.a0, a1 = a0 + 0.34;
    const k = sst(HU.start, HU.end, u);
    const chew = Math.sin(u * 64 * 60 * 2 * Math.PI * 0.05) * (u > HU.start && u < HU.end ? 1 : 0); // (~3 Hz au ralenti ×0,5)
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
    const pose = (gait, fly) => [gait, fly, u * 64 * 120 * 2 * Math.PI, 1 - fly];
    const dist = Math.hypot(...A1.p.map((x, i) => x - A0.p[i])) * k; // (le chemin parcouru le long du bord : la foulée en découle)
    let st = null;
    if (u >= HU.land && u < HU.start) { // elle arrive en vol, ralentit, se pose
      const q = sst(HU.land, HU.start, u), from = body.map((x, i) => x + n[i] * 0.35 + toEdge[i] * 0.25 - along[i] * 0.15);
      const p = from.map((x, i) => x + (body[i] - x) * (1 - (1 - q) ** 2));
      st = { p, q: frameQuat(fwdP, nrm(n.map((x, i) => x * q + (1 - q) * [0, 1, 0][i]))), s: 1, pose: pose(u * 900, 1 - sst(0.75, 1, q)) };
    } else if (u >= HU.start && u < HU.end) {
      st = { p: body, q: frameQuat(fwdP, n), s: 1, pose: pose((dist / 0.034) * 2 * Math.PI, 0), ext: [u * 64 * 2 * Math.PI * 3, u * 64 * 2 * Math.PI * 1.2, Math.sin(u * 64 * 1.3) * 0.6, u * 64 * 2 * Math.PI * 1.4] };
      // chaque tarse sur le papier sous lui (legs.js : le squelette du shader,
      // la correction du fémur) ; une patte au-dessus du vide garde sa pose
      let L;
      if (hero.lifts) { // (calculées d'avance sur la course, lissées : interpolées)
        const T = hero.lifts, x = Math.min(T.rows.length - 1.001, Math.max(0, (u - T.u0) / T.du)), i0 = Math.floor(x), f = x - i0;
        L = T.rows[i0].map((v, c) => v * (1 - f) + T.rows[i0 + 1][c] * f);
      } else L = legLifts(st, n, paperHeight(n, body, -(LH + (hero.al ?? 0))));
      st.ext2 = [0, L[0], L[1], L[2]]; st.ext3 = [L[3], L[4], L[5], 0];
    }
    else if (u >= HU.end && u < HU.off) {
      const q = sst(HU.end, HU.off, u), to = body.map((x, i) => x + n[i] * 0.4 + toEdge[i] * 0.2 + along[i] * 0.2);
      st = { p: body.map((x, i) => x + (to[i] - x) * q * q), q: frameQuat(fwd.map((x, i) => x * (1 - q) + (to[i] - body[i]) * q), n), s: 1, pose: pose(u * 900, sst(0, 0.2, q)) };
    }
    B.hero.a.value = u < HU.start ? (u >= HU.end ? a1 : 0) : aHead;
    B.hero.a0.value = a0;
    B.hero.wet.value = u < HU.off + 0.02 ? 1 : 0; // (humide pendant le ralenti ; sèche aussitôt dans l'accéléré)
    // la caméra suit l'ouvrière, de trois quarts, depuis le dehors du bord libre
    const wc = sst(HU.land - 0.04, HU.start, u) * (1 - sst(HU.end, HU.off + 0.03, u));
    // (la cible : l'ouvrière elle-même, posée ; pendant l'arrivée et le départ,
    // le point où elle se pose — la caméra ne la poursuit pas dans les airs)
    return { st, body, cam: { w: wc, target: body, n, e: toEdge, side: along, off: hero.camOff } };
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
      const h = heroAt(ph), hp = heroAt(lastU);
      if (h?.st) { A.push(h.st); B.push(hp?.st ?? h.st); }
      // (pendant le temps fort, les autres ne passent pas devant elle)
      if (h && h.cam.w > 0) for (let i = A.length - (h.st ? 2 : 1); i >= 0; i--) { const d = Math.hypot(...A[i].p.map((x, k) => x - h.body[k])); if (d < 0.45) { A.splice(i, 1); B.splice(i, 1); } }
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
    place(rim, L.rim.az, L.rim.el, 10, [0, 0, 0]);
    rim.color.set(L.rim.color); rim.intensity = L.rim.intensity;
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  const api = {
    only: null, testWasps: null, wasps, heroCam: (u) => heroAt(u)?.cam ?? null,
    // (mise au point) l'écart de chaque tarse au papier sous lui, en mm, à la phase u
    get heroLifts() { return hero?.lifts ?? null; },
    heroLegs(u) {
      const H = heroAt(u); if (!H?.st?.ext3) return null;
      const st = H.st, n = H.cam.n, hf = paperHeight(n, st.p, -(0.025 + (hero.al ?? 0))), L = [...st.ext2.slice(1), ...st.ext3.slice(0, 3)];
      return L.map((l, c) => {
        const t = legTip(c, legAngles(c, st.pose, 0, l, true)), w = qrotL(st.q, t);
        const x = w.map((v, i) => v + st.p[i]), h = hf(x);
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
