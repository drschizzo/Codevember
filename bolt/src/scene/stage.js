// La scène : une table qui se relève en cyclorama, un récipient, son thé, un
// nuage (scene/cloud.js), un éclair (scene/lightning.js), la pluie.
//
// - update(ph) ne dépend que de la recette et de la phase (film.js) ;
// - un maillage reçoit son matériau quand SA géométrie est arrivée ;
// - les lumières sont créées une fois, dans un ordre fixe : la lampe de
//   l'humeur, son contre-jour, et l'éclair (un projecteur à ombres, placé sur
//   le canal : c'est lui qui jette l'ombre de la tasse sur la nappe).
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, attribute, uv, vec2, vec3, vec4, float, positionLocal, positionWorld, normalLocal, cameraPosition, normalize, cross, length, fract, floor, sin, exp, smoothstep, step, mix, mrt, dot, max as tMax, hash, transformNormalToView, select } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature, perturb, stableVelocity, NZ } from '../../../shared/scene/materials.js';
import { Buffers, OUT } from '../../../shared/gen/mesh.js';
import { revolve } from '../gen/vessels.js';
import { stateAt, PHYS } from '../film.js';
import { layout, ELEMENTS } from '../recipe.js';
import { createCloud, N_LIGHTS } from './cloud.js';
import { createLightning, MAX_STROKES } from './lightning.js';
import { buildTableMaterial, tableUniforms, applyTable } from './table.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setAttribute('heat', new THREE.BufferAttribute(o.anchor, 3)); // (place sur le chemin de la chaleur : gen/vessels.js, HEAT)
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const tri = (f) => ({ outer: f.outer ?? f, inner: f.inner ?? f, edge: f.edge ?? f, wear: 0 });
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(0) });

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 400, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 5;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 20;
  key.shadow.focus = 0.5; // (la carte d'ombre serrée sur le récipient)
  const rim = new THREE.SpotLight(0xffffff, 200, 0, 0.6, 0.9, 2);
  const flash = new THREE.SpotLight(0xffffff, 0, 0, 1.4, 1, 2);
  flash.castShadow = true;
  flash.shadow.bias = -0.0006; flash.shadow.normalBias = 0.01; flash.shadow.radius = 2.5;
  flash.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
  flash.shadow.camera.near = 0.08; flash.shadow.camera.far = 8;
  for (const l of [key, rim, flash]) { scene.add(l); scene.add(l.target); }

  // ── Table et cyclorama : un plateau qui se relève en gorge, loin derrière ──
  const table = new THREE.Mesh();
  {
    const B = new Buffers(1 << 14), prof = [{ r: 0, y: 0, s: OUT }];
    for (const r of [0.6, 1.2, 2, 3, 4.5, 6.5]) prof.push({ r, y: 0, s: OUT });
    for (let k = 1; k <= 12; k++) { const a = (Math.PI / 2) * (k / 12); prof.push({ r: 6.5 + 3 * Math.sin(a), y: 3 - 3 * Math.cos(a), s: OUT }); }
    prof.push({ r: 9.5, y: 14, s: OUT });
    // (profil parcouru du mur vers l'axe : la normale de revolve regarde alors vers le haut et vers l'intérieur)
    prof.reverse();
    revolve(B, prof, 128);
    const o = B.out();
    table.geometry = toGeometry(o);
  }
  table.receiveShadow = true;
  scene.add(table);
  let tableFin = null;

  // ── Récipient ──
  const group = new THREE.Group();
  scene.add(group);
  const slots = { body: null, metal: null, element: null, liquidBody: null };
  // la chaleur de la foudre : secondes depuis la jonction, ce qu'il en reste, phase de la boucle
  const heatU = { since: uniform(99), heat: uniform(0), phase: uniform(0), grain: uniform(9) }; // (grain : finesse des fissures — des braises aux galets)
  const liquidU = {
    color: uniform(new THREE.Color('#3d1508')), tau: uniform(-1), rain: uniform(0), boil: uniform(0), time: uniform(0), r: uniform(0.4),
    hits: uniformArray(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 99, 0)), 'vec4'), // x, z, instant, amplitude
    glows: uniformArray(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'), // ce qui rougit sous le thé : x, z, rayon (un anneau), poids
    hot: uniform(0), all: uniform(0),
  };
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), liquidMaterial(liquidU, lite));
  liquid.receiveShadow = true;
  liquid.visible = false;
  group.add(liquid);

  // ── Nuage, éclair, pluie ──
  const cloud = createCloud();
  const bolt = createLightning(scene, { lite });
  const rainU = { rate: uniform(0), time: uniform(0), top: uniform(2), fall: uniform(PHYS.fall), light: uniform(new THREE.Color(1, 1, 1)), gain: uniform(0.5) };
  const rainMat = rainMaterial(rainU, lite);
  let rain = null;
  // étincelles (au point que touche chaque arc), gouttes (le thé saisi par la
  // résistance) et bouffées de vapeur : attributs fixes, tout est dans le shader
  const sparkU = {
    tau: uniform(-1), light: uniform(new THREE.Color(1, 1, 1)),
    src: uniformArray(Array.from({ length: 5 }, () => new THREE.Vector4(0, 0, 0, 99)), 'vec4'), // x, y, z, instant (4 arcs, puis le thé)
    amp: uniformArray(Array.from({ length: 5 }, () => new THREE.Vector4(0, 0, 0, 0)), 'vec4'),  // intensité, rayon de la source
  };
  const sparks = buildSparks(sparkU, lite);
  scene.add(sparks);
  const puffU = { since: uniform(0), env: uniform(0), o: uniform(new THREE.Vector3()), dir: uniform(new THREE.Vector3(0, 1, 0)), r: uniform(0.1), jet: uniform(0), light: uniform(new THREE.Color(1, 1, 1)), seed: uniform(0) };
  const puffs = buildPuffs(puffU, lite);
  scene.add(puffs);

  let R = null, meta = null, L = null, boltInfo = null, pending = 0, total = 1, version = 0;

  // matériau d'une pièce ; les pièces de la machine rougissent (émission lue sur le chemin de la chaleur)
  const SEEDS = { body: [1.3, 2.1, 0.5], metal: [4.7, 0.3, 2.2], element: [2.9, 5.1, 1.4], liquidBody: [0, 0, 0] };
  function pieceMaterial(name, f, U) {
    const m = buildPieceMaterial(f, U, { seedOff: uniform(new THREE.Vector3(...SEEDS[name])) });
    if (name === 'metal' || name === 'element') m.emissiveNode = heatNode(heatU, name === 'element');
    return m;
  }
  function setPart(name, o, finish) {
    const old = slots[name];
    if (old) { group.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose(); slots[name] = null; }
    if (!o) return;
    const f = tri(finish), U = finishU(f);
    const mesh = new THREE.Mesh(toGeometry(o), pieceMaterial(name, f, U)); // (matériau construit APRÈS la géométrie)
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    slots[name] = { mesh, f, U, key: signature(f) };
  }

  function setRecipe(recipe) {
    R = recipe; meta = null; L = null; boltInfo = null;
    const v = ++version;
    pending = 3; total = 3;
    liquid.visible = false;
    if (bolt.mesh) bolt.mesh.visible = false;
    gen.request({ ...R.vessel, body: undefined, metal: undefined, tea: undefined }, 'vessel').then((out) => {
      if (v !== version) return;
      meta = out.meta;
      setPart('body', out.parts.body, R.finish.body);
      setPart('metal', out.parts.metal, R.finish.metal);
      setPart('element', out.parts.element, ELEMENTS[meta.heater.kind] ?? ELEMENTS.pierres);
      // (le thé vu à travers le verre : un corps opaque à la couleur du thé)
      const tea = { ...R.finish.metal, pattern: 'plain', metal: 0, color: R.vessel.tea, rough: 0.25, clearcoat: 0, aniso: 0, bump: 0, smudge: 0, irid: 0, emit: 1e-4, emitColor: '#ff5a14' }; // (émission compilée : le thé s'éclaire quand la résistance rougit)
      setPart('liquidBody', out.parts.liquidBody, tea);
      group.rotation.y = R.vessel.turn;
      liquid.visible = !meta.closed;
      liquid.scale.setScalar(meta.liquid.disc);
      liquidU.r.value = meta.liquid.r;
      // (ce qui rougit sous le thé : l'hélice du thermoplongeur, les pierres)
      for (let j = 0; j < 4; j++) { const g = meta.heater.spots[j]; liquidU.glows.array[j].set(...(g ? [g[0], g[1], g[2], 1] : [0, 0, 0, 0])); }
      liquidU.all.value = meta.heater.spots.length ? 0.25 : 1;
      L = layout(R, meta);
      buildRain();
      pending--;
      gen.request(L.plume, 'plume').then((P) => { if (v !== version) return; cloud.setSimulation(P); pending--; }).catch((e) => { console.error(e); pending = -1; });
      return gen.request({ spec: L.spec, rough: R.bolt.rough }, 'bolt').then((b) => {
        if (v !== version) return;
        boltInfo = b;
        bolt.setSegments(b.seg);
        pending--;
      });
    }).catch((e) => { console.error(e); pending = -1; });
    // support : une matière écrite pour lui (scene/table.js) ; sa nature choisit le shader
    setTable();
  }

  function setTable() {
    const tf = R.table.finish, kind = tf.kind ?? 'cloth';
    if (!tableFin || tableFin.key !== kind) {
      table.material?.dispose?.();
      tableFin = { key: kind, U: tableUniforms(tf) };
      table.material = buildTableMaterial(kind, tableFin.U, [key, flash]);
    } else applyTable(tableFin.U, tf);
  }

  // la pluie : des traits qui tombent de la base du nuage dans le récipient
  // (ou sur lui, s'il est fermé) ; attributs fixes, tout le mouvement est dans le shader
  function buildRain() {
    if (rain) { scene.remove(rain); rain.geometry.dispose(); }
    const N = lite ? 90 : 420;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv); g.setAttribute('normal', quad.attributes.normal);
    const a = new Float32Array(N * 4), b = new Float32Array(N * 4);
    let h = 12345;
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
    const closed = meta.closed, rr = closed ? 0.5 : meta.liquid.r * 0.86;
    const ell = L.spec.obstacles.filter((o) => o.type === 'ellipsoid').pop();
    for (let i = 0; i < N; i++) {
      const r = rr * Math.sqrt(rnd()), an = rnd() * Math.PI * 2, x = r * Math.cos(an), z = r * Math.sin(an);
      let yEnd = meta.liquid.y;
      if (closed && ell) { const q = 1 - (x * x) / (ell.r[0] * ell.r[0]) - (z * z) / (ell.r[2] * ell.r[2]); yEnd = q > 0 ? ell.c[1] + ell.r[1] * Math.sqrt(q) * 0.8 : 0.005; }
      a.set([x, z, rnd(), 0.05 + 0.9 * rnd()], i * 4);
      b.set([yEnd, 0.7 + 0.6 * rnd(), rnd(), 0], i * 4);
    }
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
    g.instanceCount = N;
    rain = new THREE.Mesh(g, rainMat);
    rain.frustumCulled = false;
    rain.renderOrder = 7;
    scene.add(rain);
  }

  // retouche d'une matière depuis le panneau
  function syncFinishes() {
    if (!R) return;
    for (const [name, fin] of [['body', R.finish.body], ['metal', R.finish.metal]]) {
      const s = slots[name];
      if (!s) continue;
      const f = tri(fin);
      if (signature(f) !== s.key) { const old = s.mesh.material; s.f = f; s.U = finishU(f); s.key = signature(f); s.mesh.material = pieceMaterial(name, f, s.U); old.dispose(); }
      else for (const k of ['outer', 'inner', 'edge']) applyFinish(s.U[k], f[k]);
    }
    setTable();
  }

  const place = (l, az, el, r, target) => {
    l.position.set(target[0] + Math.cos(az) * Math.cos(el) * r, target[1] + Math.sin(el) * r, target[2] + Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };
  const _c = new THREE.Color();
  let frame = 0;

  // ph : phase de la boucle [0, 1)
  function update(ph, camera, pixelHeight = 1080) {
    if (!R || !L) return null;
    const S = stateAt(R.film, ph), Li = R.light;
    const aim = [0, meta.top * 0.5, 0];
    place(key, Li.key.az, Li.key.el, 9, aim);
    key.color.set(Li.key.color); key.intensity = Li.key.intensity; key.angle = Li.key.angle; key.penumbra = Li.key.penumbra;
    place(rim, Li.rim.az, Li.rim.el, 8, aim);
    rim.color.set(Li.rim.color); rim.intensity = Li.rim.intensity * (lite ? 1.3 : 1);

    // ── le thé : son niveau suit l'eau du nuage (conservation) ──
    const tsec = ph * R.film.duration;
    liquid.position.y = meta.liquid.y + S.level * R.film.drop;
    liquidU.color.value.set(R.vessel.tea);
    liquidU.tau.value = S.tau; liquidU.rain.value = S.air > 0.0005 ? S.rain : 0; liquidU.time.value = tsec;
    if (slots.liquidBody) slots.liquidBody.mesh.scale.y = 1 + (S.level * R.film.drop) / (meta.liquid.y - meta.yBase);

    // ── l'éclair ──
    const B = bolt.U, st = R.film.strokes, info = boltInfo;
    const up = R.bolt.family === 'upward', K0 = R.cloud;
    B.a.value = S.a; B.tau.value = S.tau;
    B.last.value = st[st.length - 1].t;
    B.cloudY.value = L.base + 0.04;
    B.gain.value = 26 * R.bolt.power * (up ? 0.7 : 1);
    B.halo.value.set(R.bolt.color); B.core.value.set(R.bolt.core);
    B.leader.value.set(R.bolt.color).lerp(_c.set('#a58cff'), 0.55);
    B.width.value = 0.0085;
    B.pixel.value = (2 * Math.tan((camera.fov * Math.PI) / 360) / pixelHeight) * 0.75;
    let lx = 0, ly = 0, lz = 0, lw = 0, hx = 0, hy = 0, hz = 0;
    for (let j = 0; j < MAX_STROKES; j++) {
      const s = st[j], v = B.strokes.array[j];
      if (!s || !info) { v.set(0, 0, 1, 1); continue; }
      const path = up ? (j === 0 ? 0 : 1) : Math.min(s.path, info.strokes.length - 1);
      const K = info.strokes[up ? 0 : path];
      v.set(s.t, s.amp, 2 ** path, K.length);
      if (j < 4) liquidU.hits.array[j].set(...hitPoint(K.target), s.t + K.length / PHYS.wave * 0, meta.strike || !meta.closed ? s.amp : 0);
      // (la lumière de l'arc : au tiers bas du canal dominant, pondérée par les impulsions)
      const x = S.tau - s.t;
      const l = x > 0 ? s.amp * Math.min(1, x / 0.012) * (0.72 * Math.exp(-x / PHYS.tauFast) + 0.28 * Math.exp(-x / PHYS.tauSlow)) : 0;
      lx += K.low[0] * l; ly += K.low[1] * l; lz += K.low[2] * l; lw += l;
      hx += K.high[0] * l; hy += K.high[1] * l; hz += K.high[2] * l;
    }
    for (let j = st.length; j < 4; j++) liquidU.hits.array[j].set(0, 0, 99, 0);
    const lp = lw > 1e-5 ? [lx / lw, ly / lw, lz / lw] : (info ? info.strokes[0].low : [0, 1.5, 0]);
    const hp = lw > 1e-5 ? [hx / lw, hy / lw, hz / lw] : (info ? info.strokes[0].high : [0, 2, 0]);
    // (toujours au-dessus du récipient : c'est son ombre qu'on veut voir sur la table)
    flash.position.set(lp[0], Math.max(lp[1], meta.top + 0.4), lp[2]);
    flash.target.position.set(lp[0] * 0.3, 0, lp[2] * 0.3);
    flash.color.set(R.bolt.color).lerp(_c.set('#ffffff'), 0.45);
    // (le traceur éclaire à peine ; l'arc, lui, dix à vingt fois la lampe)
    const leaderLight = S.a >= 0 && S.tau < 0 ? 0.012 * (0.3 + 0.7 * S.a) : 0;
    flash.intensity = (S.light + leaderLight) * 150 * Li.flash * R.bolt.power * Math.max(0.45, 1.15 - K0.ambient); // (une scène claire en demande moins)

    // ── le nuage ──
    const C = cloud.U, K = R.cloud;
    camera.updateMatrixWorld();
    C.camPos.value.copy(camera.position); C.camWorld.value.copy(camera.matrixWorld); C.projInv.value.copy(camera.projectionMatrixInverse);
    C.near.value = camera.near; C.far.value = camera.far;
    C.c.value.set(L.center[0], L.base, L.center[2]);
    C.R.value = K.radius; C.H.value = K.height;
    C.shred.value = S.shred; C.dark.value = S.dark; C.dens.value = K.density;
    C.tint.value.set(K.tint); C.shade.value.set(K.shade); C.amb.value = K.ambient;
    C.sun.value.copy(key.position).sub(key.target.position).normalize();
    C.sunCol.value.set(Li.key.color);
    C.drift.value = -4 * K.drift * S.clock; // (un nombre entier de périodes du volume de bruit par boucle ; presque arrêté pendant le traceur)
    C.seed.value = K.seed;
    C.frame.value = frame = (frame + 1) % 4096;
    // la simulation du panache : son unité est la hauteur de la source au niveau
    // de condensation ; en travers, elle est mise à l'échelle du rayon du nuage
    C.steamP.value.set(...L.steam.p); C.span.value = L.span; C.kr.value = K.radius / (1.3 * L.span);
    C.simT.value = S.sim;
    C.lcol.value.set(R.bolt.color).lerp(_c.set('#ffffff'), 0.3);
    const lights = C.lights.array;
    // (0 : le canal sous le nuage ; 1 : le canal dans le nuage ; 2… : les lueurs de la charge)
    const tipGlow = S.a >= 0 && S.tau < 0 ? 0.25 + 0.5 * S.a : 0;
    lights[0].set(lp[0], Math.min(lp[1] + 0.3, L.base - 0.1), lp[2], S.light * 3.2 * R.bolt.power);
    const rootP = info ? (up ? info.strokes[0].high : L.spec.root) : [0, L.base, 0];
    lights[1].set(up ? hp[0] : rootP[0], (up ? hp[1] : rootP[1]) + 0.12, up ? hp[2] : rootP[2], (S.light * 9 + tipGlow * 0.5) * R.bolt.power);
    for (let k = 2; k < N_LIGHTS; k++) {
      const f = R.film.flickers[k - 2];
      if (f) lights[k].set(L.center[0] + f.p[0] * K.radius, L.base + f.p[1] * K.height, L.center[2] + f.p[2] * K.radius, S.glow[k - 2] * 2.6);
      else lights[k].set(0, 0, 0, 0);
    }

    // ── la chaleur de la foudre ──
    // Elle descend le métal depuis la pointe (PHYS.cond), la résistance rougit
    // et le reste : c'est elle qui fait repartir la vapeur après l'averse.
    // (pas de lampe de plus : le métal émet, le thé et la table s'éclairent
    // dans leur propre shader, le halo de la chaîne d'image fait le reste)
    const hot = S.heat, H = meta.heater;
    heatU.since.value = S.since; heatU.heat.value = hot; heatU.phase.value = ph; heatU.grain.value = H.kind === 'pierres' ? 21 : 9;
    // (l'élément n'est chaud qu'une fois la chaleur arrivée jusqu'à lui)
    const reached = Math.min(1, Math.max(0, (S.since - 0.58 * PHYS.cond) / 0.25)), glow = hot * reached;
    liquidU.hot.value = glow;
    liquidU.boil.value = Math.min(1, Math.max(0, glow - 0.1) * 0.9 + S.burst * 0.5);
    if (slots.liquidBody) slots.liquidBody.U.outer.emit.value = 0.9 * glow * glow;
    if (tableFin) {
      const c = H.glow.c, g = tableFin.U.glow.value;
      // (repère du récipient : il tourne de vessel.turn)
      const ca = Math.cos(R.vessel.turn), sa = Math.sin(R.vessel.turn);
      g.set(c[0] * ca + c[2] * sa, -c[0] * sa + c[2] * ca, Math.max(0.08, H.glow.y), H.glow.table ? 2.2 * glow * glow : 0);
    }

    // ── le choc : étincelles, gouttes, bouffées ──
    sparkU.tau.value = S.tau;
    for (let j = 0; j < 4; j++) {
      const s = st[j], K = s && info ? info.strokes[up ? 0 : Math.min(s.path, info.strokes.length - 1)] : null;
      const t = K ? (up ? L.strike : K.target) : null;
      if (t) { sparkU.src.array[j].set(t[0], t[1], t[2], s.t); sparkU.amp.array[j].set(s.amp, 0.004, 0, 0); } else sparkU.amp.array[j].set(0, 0, 0, 0);
    }
    {
      // (le thé jaillit quand la chaleur atteint la résistance ; repère du récipient → monde)
      const c = H.glow.c, ca = Math.cos(R.vessel.turn), sa = Math.sin(R.vessel.turn);
      sparkU.src.array[4].set(c[0] * ca + c[2] * sa, meta.liquid.y, -c[0] * sa + c[2] * ca, 0.58 * PHYS.cond);
      sparkU.amp.array[4].set(H.glow.liquid ? 1 : 0, Math.min(H.glow.r, meta.liquid.r * 0.6), 0, 0);
      sparkU.light.value.set(K0.tint).multiplyScalar(K0.ambient * 1.2 + S.light * 4);
      // bouffées : du thé autour de la résistance, ou du bec d'une théière (un jet)
      const closed = meta.closed, o = closed ? L.steam.p : [sparkU.src.array[4].x, meta.liquid.y, sparkU.src.array[4].z];
      puffU.o.value.set(o[0], o[1], o[2]);
      const d = closed && meta.steam.dir ? meta.steam.dir : [0, 1, 0];
      puffU.dir.value.set(d[0] * ca + d[2] * sa, d[1], -d[0] * sa + d[2] * ca).normalize();
      puffU.r.value = closed ? 0.03 : Math.max(0.06, sparkU.amp.array[4].y * 1.1);
      puffU.jet.value = closed ? 1 : 0;
      puffU.since.value = S.since; puffU.env.value = S.puffs; puffU.seed.value = K0.seed;
      puffU.light.value.set(K0.tint).multiplyScalar(Math.min(1.6, K0.ambient * 1.5 + 0.25 + S.light * 2.5));
    }

    // ── la pluie ──
    rainU.rate.value = S.rain; rainU.time.value = tsec; rainU.top.value = L.base + 0.02;
    rainU.light.value.set(K.tint).multiplyScalar(Math.max(0.45, K.ambient * 1.6) + S.light * 3); // (jamais éteinte : dans une scène sombre, c'est le contre-jour qui l'accroche)
    return S;
  }
  // point d'où partent les rides : là où l'arc touche le liquide (ou la cuillère qui y plonge)
  function hitPoint(t) {
    const r = Math.hypot(t[0], t[2]), k = r > meta.liquid.r * 0.75 ? (meta.liquid.r * 0.75) / r : 1;
    // (repère du récipient : la table tourne de vessel.turn)
    const ca = Math.cos(-R.vessel.turn), sa = Math.sin(-R.vessel.turn), x = t[0] * k, z = t[2] * k;
    return [x * ca + z * sa, -x * sa + z * ca];
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, syncFinishes, setShadowQuality, group, table, key, rim, flash, cloud, bolt, liquid,
    get layout() { return L; }, get meta() { return meta; }, get boltInfo() { return boltInfo; },
    ready: () => pending === 0,
    failed: () => pending < 0,
    progress: () => 1 - Math.max(0, pending) / total,
  };
}

// ── Le métal qui rougit ──────────────────────────────────────────────────────
// Émission d'une pièce de la machine. Chaque sommet sait sa place sur le chemin
// de la chaleur (s : 0 à la pointe que la foudre touche, 1 au bout de la
// résistance) et sa nature : le métal mince rougit au passage du front et
// refroidit en PHYS.rod ; la résistance, les braises et les pierres gardent la
// chaleur du film (U.heat). Couleur : du blanc-jaune au rouge sombre.
function heatNode(U, rough) {
  const a = attribute('heat', 'vec3'), x = U.since.sub(a.x.mul(PHYS.cond));
  const arrived = smoothstep(0, 0.07, x), xs = x.max(0);
  const rodT = arrived.mul(exp(xs.div(-PHYS.rod)));
  let hotT = arrived.mul(U.heat.add(exp(xs.div(-0.35)).mul(0.3)).min(1.25));
  if (rough) {
    // (pierres, braises : la chaleur se voit dans les fissures et palpite — un nombre entier de battements par boucle)
    const n = NZ(positionLocal.mul(U.grain).add(a.z.mul(17))).level(0);
    const crack = n.z.min(1).pow(1.6), breath = sin(U.phase.mul(6.2832 * 20).add(a.z.mul(40))).mul(0.12).add(0.88);
    hotT = hotT.mul(crack.mul(0.6).add(0.4)).mul(breath).mul(a.z.mul(0.5).add(0.75));
  }
  const T = select(a.y.lessThan(0.5), float(0), select(a.y.lessThan(1.5), rodT, hotT));
  const col = mix(mix(vec3(1, 0.07, 0.01), vec3(1, 0.36, 0.05), smoothstep(0.2, 0.6, T)), vec3(1, 0.83, 0.55), smoothstep(0.62, 1.05, T));
  return col.mul(T.pow(2.3)).mul(rough ? 9 : 7);
}

// ── Le thé : une surface qui ride ────────────────────────────────────────────
// Deux trains d'ondes : un anneau qui part de chaque impact d'arc (amorti), et
// les ronds de la pluie (une grille de cellules, un rond par cellule à une
// phase tirée). La hauteur perturbe la normale (Mikkelsen).
function liquidMaterial(U, lite) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionLocal.xz.mul(U.r); // (le disque est mis à l'échelle : coordonnées en unités de scène)
  let h = float(0);
  for (let j = 0; j < 4; j++) {
    const H = U.hits.element(j), x = U.tau.sub(H.z), r = length(p.sub(H.xy));
    const front = r.sub(x.max(0).mul(PHYS.ripple));
    h = h.add(sin(front.mul(70)).mul(exp(front.div(0.09).pow2().negate())).mul(exp(x.max(0).div(-1.4))).mul(step(0, x)).mul(smoothstep(0, 0.08, x)).mul(H.w));
  }
  const rings = (f, sp, salt) => {
    const q = p.mul(f).add(salt), c = floor(q), fr = fract(q).sub(0.5);
    const h1 = hash(c.x.mul(127.1).add(c.y.mul(311.7)).add(salt)), h2 = hash(c.x.mul(269.5).add(c.y.mul(183.3)).add(salt));
    const t = fract(U.time.mul(sp).add(h1));
    const d = length(fr.sub(vec2(h1, h2).sub(0.5).mul(0.5))), rr = t.mul(0.5);
    return sin(d.sub(rr).mul(46)).mul(exp(d.sub(rr).div(0.07).pow2().negate())).mul(t.oneMinus().pow2()).mul(step(h2, U.rain.mul(1.2)));
  };
  h = h.add(rings(7, 1.5, 3.1).add(lite ? 0 : rings(11, 2, 17.7)).mul(0.5).mul(smoothstep(0, 0.1, U.rain)));
  // le thé frémit après la foudre : de petites bulles serrées, qui s'espacent en refroidissant
  // ce qui rougit sous le thé : la lueur traverse le liquide, qui la teinte
  let under = float(0), near = float(0);
  for (let j = 0; j < 4; j++) {
    const Gj = U.glows.element(j), d = length(p.sub(Gj.xy));
    under = under.add(Gj.w.mul(exp(d.sub(Gj.z).div(0.035).pow2().negate()).add(exp(d.div(Gj.z.add(0.09)).pow2().negate()).mul(0.3))));
    near = near.add(Gj.w.mul(exp(d.div(Gj.z.add(0.1)).pow2().negate())));
  }
  near = near.min(1).mul(U.all.oneMinus()).add(U.all); // (le thé bout autour de la résistance ; partout si elle est sous le récipient)
  const boil = (f, sp, salt) => { const q = p.mul(f).add(salt), c = floor(q), fr = fract(q).sub(0.5); const h1 = hash(c.x.mul(127.1).add(c.y.mul(311.7)).add(salt)), h2 = hash(c.x.mul(269.5).add(c.y.mul(183.3)).add(salt)); const t = fract(U.time.mul(sp).add(h1)); const d = length(fr.sub(vec2(h1, h2).sub(0.5).mul(0.6))); return smoothstep(0.34, 0.0, d).mul(t.mul(3.14159).sin()).mul(step(h2, U.boil.mul(near))); };
  h = h.add(boil(16, 2.6, 5.3).add(lite ? 0 : boil(27, 3.4, 9.1)).mul(0.9).mul(smoothstep(0, 0.08, U.boil)));
  const edge = smoothstep(1, 0.93, length(positionLocal.xz).mul(1)); // (le ménisque : calme au bord)
  m.colorNode = vec4(U.color, 1);
  m.emissiveNode = mix(vec3(1, 0.16, 0.02), vec3(1, 0.5, 0.14), U.hot).mul(under.min(1.3)).mul(U.hot.mul(U.hot)).mul(3.2);
  m.roughnessNode = float(0.05);
  m.metalnessNode = float(0);
  m.normalNode = perturb(h.mul(edge).mul(0.0026), transformNormalToView(vec3(0, 1, 0)));
  m.clearcoatNode = float(0);
  m.mrtNode = stableVelocity();
  return m;
}

// ── La pluie ─────────────────────────────────────────────────────────────────
// Chaque goutte tombe en PHYS.fall de la base du nuage à son point de chute, un
// nombre entier de fois par boucle ; elle n'existe que si le débit dépasse son
// seuil (les premières gouttes, puis l'averse, puis les dernières).
function rainMaterial(U, lite) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const a = attribute('iA', 'vec4'), b = attribute('iB', 'vec4');
  const t = uv();
  const cyc = fract(U.time.div(U.fall.mul(b.y)).add(a.z));
  // (elle accélère ; le dernier dixième de son cycle, elle s'écrase : un éclat court et large à son point de chute)
  const fl = cyc.div(0.9).min(1), hit = step(0.9, cyc), k = cyc.sub(0.9).div(0.1).clamp(0, 1);
  const y = mix(U.top, b.x, fl.mul(fl).mul(0.5).add(fl.mul(0.5))).add(hit.mul(0.012));
  const alive = smoothstep(a.w.sub(0.08), a.w, U.rate);
  const len = mix(float(0.1).mul(cyc.mul(0.7).add(0.5)), float(0.022), hit), wdt = mix(float(0.006), k.mul(0.05).add(0.02), hit);
  const P = vec3(a.x, y, a.y);
  const toCam = normalize(cameraPosition.sub(P)), side = normalize(cross(vec3(0, 1, 0), toCam));
  m.positionNode = P.add(vec3(0, 1, 0).mul(t.y.sub(0.5).mul(len))).add(side.mul(t.x.sub(0.5).mul(wdt).mul(alive)));
  const across = smoothstep(0.5, 0.1, t.x.sub(0.5).abs()), along = smoothstep(0, 0.5, t.y).mul(smoothstep(1, 0.8, t.y));
  m.colorNode = vec3(U.light).mul(across).mul(along).mul(alive).mul(U.gain).mul(smoothstep(0, 0.04, cyc)).mul(mix(float(1), k.oneMinus().mul(1.6), hit));
  if (!lite) m.mrtNode = mrt({ velocity: vec4(0), refl: vec4(0) });
  return m;
}

// ── Étincelles et gouttes ────────────────────────────────────────────────────
// Des traits balistiques, additifs. Les étincelles partent du point que touche
// chaque arc, à son instant ; les gouttes jaillissent du thé quand la chaleur
// atteint la résistance. Position : fonction pure de τ (secondes depuis la
// jonction) — rien n'est intégré, la boucle reste exacte.
function buildSparks(U, lite) {
  const N = lite ? 90 : 200, G0 = 9; // (pesanteur du ralenti léger, unités / s²)
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  for (const k of ['position', 'uv', 'normal']) g.setAttribute(k, quad.attributes[k]);
  const a = new Float32Array(N * 4), b = new Float32Array(N * 4);
  let h = 977;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) {
    const drop = i % 4 === 3, src = drop ? 4 : i % 4 === 0 ? 0 : (i >> 2) % 4; // (un quart de gouttes ; le premier arc a le plus d'étincelles)
    const th = drop ? rnd() * 0.5 : Math.acos(1 - rnd() * 1.5), an = rnd() * Math.PI * 2, sp = drop ? 0.9 + 1.3 * rnd() : (0.5 + 2.6 * rnd() * rnd());
    a.set([Math.sin(th) * Math.cos(an) * sp, Math.cos(th) * sp, Math.sin(th) * Math.sin(an) * sp, drop ? 0.9 : 0.25 + 0.6 * rnd()], i * 4);
    b.set([rnd() * (drop ? 0.5 : 0.05), 0.5 + rnd(), src, rnd()], i * 4);
  }
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
  g.instanceCount = N;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), t2 = uv();
  // (la source de l'étincelle : les masques s'excluent, une somme suffit)
  let O = vec4(0), A = vec4(0);
  for (let j = 0; j < 5; j++) { const on = step(j - 0.5, iB.z).mul(step(iB.z, j + 0.5)); O = O.add(U.src.element(j).mul(on)); A = A.add(U.amp.element(j).mul(on)); }
  const drop = step(3.5, iB.z);
  const t = U.tau.sub(O.w).sub(iB.x), life = iA.w, tt = t.clamp(0, 9);
  const v0 = iA.xyz, grav = float(G0);
  // (source étalée sur le rayon de la résistance, pour les gouttes)
  const start = O.xyz.add(vec3(iA.x, 0, iA.z).mul(A.y).mul(0.55));
  const P = start.add(v0.mul(tt)).add(vec3(0, -0.5, 0).mul(grav).mul(tt).mul(tt));
  const vel = v0.add(vec3(0, -1, 0).mul(grav).mul(tt)), sp = length(vel).max(1e-4), ax = vel.div(sp);
  const toCam = normalize(cameraPosition.sub(P)), side = normalize(cross(ax, toCam));
  const alive = step(0, t).mul(step(t, life)).mul(step(0.001, A.x));
  const len = sp.mul(mix(0.03, 0.012, drop)).add(0.006), wdt = mix(float(0.0045), float(0.007), drop).mul(iB.y);
  m.positionNode = P.add(ax.mul(t2.y.sub(0.5).mul(len))).add(side.mul(t2.x.sub(0.5).mul(wdt).mul(alive)));
  const k = tt.div(life), across = smoothstep(0.5, 0.05, t2.x.sub(0.5).abs()), along = smoothstep(0, 0.7, t2.y).mul(smoothstep(1, 0.85, t2.y));
  // étincelle : blanc-jaune, puis orange, puis rouge en refroidissant ; goutte : un éclat de la lumière ambiante
  const hotC = mix(vec3(1, 0.9, 0.7), vec3(1, 0.3, 0.04), smoothstep(0.05, 0.7, k)).mul(k.oneMinus().pow(1.5)).mul(14).mul(A.x);
  const dropC = vec3(U.light).mul(0.5).mul(smoothstep(1, 0.7, k)).mul(smoothstep(0, 0.05, k));
  m.colorNode = mix(hotC, dropC, drop).mul(across).mul(along).mul(alive);
  if (!lite) m.mrtNode = mrt({ velocity: vec4(0), refl: vec4(0) });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 9;
  return mesh;
}

// ── Bouffées de vapeur ───────────────────────────────────────────────────────
// De petits nuages qui montent de la résistance (ou sortent du bec en jet) :
// au choc, puis quand la pluie grésille sur le métal chaud, puis jusqu'à ce que
// la colonne reparte. Chaque bouffée recommence un nombre de fois par seconde
// tiré une fois ; son âge se lit dans le temps écoulé depuis la jonction.
function buildPuffs(U, lite) {
  const N = lite ? 20 : 44;
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  for (const k of ['position', 'uv', 'normal']) g.setAttribute(k, quad.attributes[k]);
  const a = new Float32Array(N * 4);
  let h = 4242;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) a.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = N;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const r = attribute('iA', 'vec4'), t2 = uv().sub(0.5);
  const period = r.x.mul(0.9).add(1.1), k = fract(U.since.div(period).add(r.y)), age = k.mul(period);
  const an = r.z.mul(6.2832), rad = r.w.sqrt();
  // (elle monte en ralentissant, s'écarte, grossit ; en jet elle part dans l'axe du bec)
  const up = mix(vec3(0, 1, 0), U.dir, U.jet.mul(exp(age.mul(-1.6))));
  const lateral = vec3(sin(an), 0, sin(an.add(1.5708))).mul(rad);
  const rise = age.mul(0.34).mul(age.mul(-0.22).add(1)).add(U.jet.mul(0.12).mul(exp(age.mul(-3)).oneMinus()));
  const sway = vec3(sin(age.mul(2.1).add(r.z.mul(9))), 0, sin(age.mul(1.7).add(r.w.mul(9)))).mul(0.06).mul(age);
  const P = U.o.add(lateral.mul(U.r.mul(k.mul(1.5).add(0.6)))).add(up.mul(rise)).add(sway);
  const size = mix(float(0.1), float(0.42), k.pow(0.7)).mul(r.w.mul(0.5).add(0.75)).mul(mix(1, 0.75, U.jet));
  const toCam = normalize(cameraPosition.sub(P)), sx = normalize(cross(vec3(0, 1, 0), toCam)), sy = cross(toCam, sx);
  // (chaque bouffée tourne lentement sur elle-même)
  const rot = r.y.mul(6.2832).add(age.mul(r.x.sub(0.5)).mul(0.8)), cr = sin(rot.add(1.5708)), sr = sin(rot);
  const q = vec2(t2.x.mul(cr).sub(t2.y.mul(sr)), t2.x.mul(sr).add(t2.y.mul(cr)));
  m.positionNode = P.add(sx.mul(q.x).add(sy.mul(q.y)).mul(size));
  // forme : un disque doux rongé par le bruit commun (lu dans le plan de la bouffée, à un décalage qui lui est propre)
  const d = length(t2).mul(2);
  const n = NZ(vec3(t2.mul(1.6).add(r.xy.mul(7)), r.z.mul(4).add(age.mul(0.12)).add(U.seed))).level(0);
  const body = smoothstep(1, 0.1, d.add(n.z.min(1).mul(0.42)).add(n.x.mul(0.25)));
  const alpha = body.mul(smoothstep(0, 0.12, k)).mul(smoothstep(1, 0.45, k)).mul(U.env).mul(0.4);
  m.colorNode = vec4(U.light, 1);
  m.opacityNode = alpha;
  if (!lite) m.mrtNode = mrt({ velocity: vec4(0), refl: vec4(0) });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  return mesh;
}
