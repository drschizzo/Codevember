// La scène : la sole (une cuvette au fond d'un cyclorama), le plateau tournant
// encastré au centre, le bain de verre en fusion, les pièces (un maillage
// d'éclats chacune), les déclencheurs, la gueule du four, les lumières.
//
// Tout est fonction du temps de la boucle t : la pièce k vit dans
// ℓ_k = mod(t − k·Ts, T) ; sa rotation (le plateau) est posée ici, le reste est
// calculé dans les shaders (glass.js) ou dans apparatus.js.
//
// Les lumières sont créées une fois, dans un ordre fixe, au premier niveau de
// la scène ; les maillages reçoivent leur matériau quand leur géométrie est
// arrivée, et un matériau neuf à chaque nouvelle géométrie.
import * as THREE from 'three/webgpu';
import { uniform, lights, vec2, vec3, smoothstep, length, normalize, positionWorld, cameraPosition, acos, clamp, dot, exp, float, uv, mix, abs, floor as tFloor, fract, min, select, mx_cell_noise_float, sin, cos } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, signature, noise } from './materials.js';
import { glassUniforms, applyGlass, buildGlassMaterial, buildGlassShadowCaster, SHADOW_LAYER, blackbody, GLASSES } from './glass.js';
import { createApparatus } from './apparatus.js';
import { G } from './globals.js';
const TAU6 = Math.PI * 12;
import { pieceSpec, finishOf, floorFinish } from '../recipe.js';
import { PH, floorH, spinAngle } from '../cycle.js';
import { Buffers, OUT, EDGE } from '../../../shared/gen/mesh.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function pieceGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  for (const k of ['rigA', 'rigB', 'rigC', 'rigD']) g.setAttribute(k, new THREE.BufferAttribute(o[k], 4));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 7); // (les éclats s'envolent)
  return g;
}
function bufGeometry(B) {
  const o = B.out(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
// solide de révolution d'axe y : [[r, y], …]
function revolve(B, prof, cols = 64, s = OUT) {
  const rows = prof.map(([r, y], k) => {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)];
    let nr = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    return Array.from({ length: cols }, (_, i) => { const t = (i / cols) * Math.PI * 2; return B.vert([r * Math.cos(t), y, r * Math.sin(t)], [nr * Math.cos(t), ny, nr * Math.sin(t)], s, [-Math.sin(t), 0, Math.cos(t)]); });
  });
  B.grid(rows, true);
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 700, 0, 0.45, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015; key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 3; key.shadow.camera.far = 30;
  key.shadow.camera.layers.enable(2); // (les porteurs d'ombre du verre, voir glass.js)
  const rims = [new THREE.SpotLight(0xffffff, 400, 0, 0.55, 0.9, 2), new THREE.SpotLight(0xffffff, 150, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false;
  const glow = new THREE.PointLight(0xff8a3a, 0, 0, 2);       // le verre en fusion, la sole qui chauffe
  // la gueule du four (ou la fenêtre) : un projecteur placé dans l'ouverture et
  // tourné vers la pièce. Une lumière ponctuelle collée au mur éclairait d'abord
  // le mur et la sole autour d'elle : tout l'Atelier virait au saumon laiteux.
  const furnaceLight = new THREE.SpotLight(0xff7a2a, 0, 0, 0.55, 1, 2);
  furnaceLight.castShadow = false;
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }
  scene.add(glow, furnaceLight, furnaceLight.target);

  // ── Cyclorama et sole ──
  // La sole est une cuvette (cycle.js, floorH : la même dans la physique) : les éclats y
  // glissent et le verre fondu y coule vers le centre. Au-delà, le sol se
  // courbe en paroi (gorge, mur) : aucun horizon. Le verre teinté ne se lit
  // que devant du clair : une lueur douce est peinte sur la paroi, à l'opposé
  // de la caméra (« fond clair » des photographes de verrerie), et la sole
  // rougeoie quand elle chauffe.
  const BD = { c0: uniform(new THREE.Color()), gain: uniform(0.4), heat: uniform(0), heatGain: uniform(1) };
  const R0 = 11, Y0 = floorH(R0);
  const floorGeo = (() => {
    const rc = 4, prof = [];
    for (let i = 0; i <= 60; i++) { const r = (R0 * i) / 60, sl = (floorH(r + 1e-3) - floorH(r - 1e-3)) / 2e-3, l = Math.hypot(sl, 1); prof.push([r, floorH(r), -sl / l, 1 / l]); }
    for (let i = 1; i <= 16; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 16); prof.push([R0 + rc * Math.cos(a), Y0 + rc + rc * Math.sin(a), -Math.cos(a), -Math.sin(a)]); }
    for (let i = 1; i <= 10; i++) prof.push([R0 + rc, Y0 + rc + (14 * i) / 10, -1, 0]);
    const cols = 160, pos = [], nor = [], surf = [], tan = [], idx = [];
    for (const [r, y, nr, ny] of prof) for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(r * ca, y, r * sa); nor.push(nr * ca, ny, nr * sa); surf.push(255, 0, 0, 128); tan.push(-sa, 0, ca, 1);
    }
    for (let k = 0; k < prof.length - 1; k++) for (let c = 0; c < cols; c++) {
      const a = k * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, d, b, e, d); // (faces tournées vers l'intérieur : en double face, three.js retourne la normale des faces vues de dos)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('tangent', new THREE.Float32BufferAttribute(tan, 4));
    g.setAttribute('surf', new THREE.BufferAttribute(Uint8Array.from(surf), 4, true));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  })();
  const floor = new THREE.Mesh(floorGeo);
  floor.receiveShadow = true; floor.frustumCulled = false;
  scene.add(floor);
  let floorKey = '';
  const floorEmissive = () => {
    const p = positionWorld, r = length(p.xz);
    const away = normalize(vec2(cameraPosition.x, cameraPosition.z)).negate();
    const ang = acos(clamp(dot(normalize(p.xz), away), -1, 1));
    const back = BD.c0.mul(BD.gain).mul(exp(ang.mul(ang).div(-0.55))).mul(smoothstep(5, 12, r)).mul(smoothstep(Y0 + 12, Y0 + 2, p.y));
    // la sole qui chauffe : plus fort au centre, marbrée
    const h = BD.heat.mul(smoothstep(1.9, 0.2, r)).mul(noise(p.mul(2.2)).mul(0.25).add(0.85));
    return back.add(blackbody(h.mul(0.62)).mul(BD.heatGain));
  };

  // ── Plateau tournant encastré ──
  const plate = (() => {
    const B = new Buffers();
    revolve(B, [[0, -0.001], [0.6, -0.001], [0.62, -0.006], [0.62, -0.05]], 96, EDGE);
    const f = floorFinish('blackSteel');
    for (const k of ['outer', 'inner', 'edge']) { f[k].color = '#8d8f93'; f[k].metal = 1; f[k].rough = 0.32; f[k].pattern = 'brushed'; f[k].aniso = 0.6; }
    const m = new THREE.Mesh(bufGeometry(B), buildPieceMaterial(f, finishU(f), { seedOff: uniform(new THREE.Vector3(5, 5, 5)) }));
    m.receiveShadow = true;
    scene.add(m);
    return m;
  })();

  // ── Bain de verre en fusion ──
  const POOL = { heat: uniform(1), gain: uniform(1) };
  const pool = (() => {
    const B = new Buffers();
    const prof = [];
    for (let i = 0; i <= 16; i++) { const r = 1 - i / 16; prof.push([r, 0.16 * (1 - r * r) ** 0.7]); }
    revolve(B, prof, 64, OUT);
    const m = new THREE.MeshPhysicalNodeMaterial();
    m.colorNode = vec3(0.05, 0.03, 0.02);
    m.roughnessNode = float(0.08);
    m.emissiveNode = blackbody(POOL.heat.mul(noise(positionWorld.mul(3)).mul(0.08).add(0.92))).mul(POOL.gain);
    const mesh = new THREE.Mesh(bufGeometry(B), m);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();

  // ── Sources de lumière visibles dans le fond ──
  // la gueule d'un four (Atelier) : un disque blanc-orange, plus chaud au centre ;
  // une fenêtre en lancette à vitraux (Cathédrale) : losanges colorés sertis de
  // plombs, sous un arc brisé. Chacune éclaire la scène (lumière ponctuelle).
  const FU = { on: uniform(0), seed: uniform(0) };
  const furnace = (() => {
    // ouvreau : un anneau de fonte sombre, une lèvre rouge, et au fond le bain
    // jaune orangé, plus chaud au centre, qui palpite à peine
    const m = new THREE.MeshBasicNodeMaterial({ fog: false });
    const d = length(uv().sub(0.5)).mul(2);
    const hot = mix(vec3(1.0, 0.55, 0.18), vec3(0.75, 0.16, 0.03), smoothstep(0.05, 0.74, d))
      // (palpitation périodique dans la boucle : six tours de bruit par boucle)
      .mul(noise(vec3(uv().mul(5).add(vec2(cos(G.phase.mul(TAU6)), sin(G.phase.mul(TAU6))).mul(0.7)), 0.5)).mul(0.12).add(0.94)).mul(1.6);
    const lip = vec3(0.5, 0.07, 0.01).mul(smoothstep(0.86, 0.76, d)).mul(0.6);
    const iron = vec3(0.018, 0.015, 0.013);
    m.colorNode = mix(hot, lip, smoothstep(0.7, 0.76, d)).mul(FU.on).max(iron.mul(smoothstep(0.76, 0.8, d)));
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), m);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();
  const windowM = (() => {
    const m = new THREE.MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: false });
    const X = uv().x.sub(0.5), Y = uv().y.mul(2.7);
    const arch = length(vec2(X.sub(0.45), Y.sub(1.9))).lessThan(0.9).and(length(vec2(X.add(0.45), Y.sub(1.9))).lessThan(0.9));
    const inside = abs(X).lessThan(0.45).and(Y.lessThan(1.9).or(arch));
    const q = vec2(X.add(Y), Y.sub(X)).mul(4.5), cell = tFloor(q), f = fract(q);
    const lead = smoothstep(0.05, 0.09, min(min(f.x, f.y), min(f.x.oneMinus(), f.y.oneMinus())));
    const h = mx_cell_noise_float(vec3(cell, FU.seed));
    const col = select(h.lessThan(0.3), vec3(0.9, 0.18, 0.12), select(h.lessThan(0.55), vec3(0.15, 0.3, 1.0), select(h.lessThan(0.8), vec3(1.0, 0.75, 0.2), vec3(0.2, 0.8, 0.45))));
    const frame = smoothstep(0.43, 0.41, abs(X));
    m.colorNode = col.mul(lead).mul(frame).mul(FU.on).mul(5);
    m.opacityNode = select(inside, float(1), float(0));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), m);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();

  const apparatus = createApparatus(scene, { finishOf });

  // ── Pièces ──
  let R = null, version = 0, pending = 0, total = 0;
  let pieces = [];
  const clear = () => {
    for (const p of pieces) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material?.dispose?.(); p.track?.dispose(); }
    pieces = [];
  };

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    clear();
    total = R.pieces.length; pending = total;
    R.pieces.forEach((P, k) => {
      const U = glassUniforms();
      const slot = { k, P, U, mesh: new THREE.Mesh(new THREE.BufferGeometry()), info: null, glassKey: P.glass, track: null };
      slot.mesh.castShadow = true; slot.mesh.receiveShadow = true; slot.mesh.visible = false;
      slot.mesh.frustumCulled = false;
      pieces.push(slot);
      gen.request(pieceSpec(R, k), 'piece').then((o) => {
        if (v !== version) return;
        slot.mesh.geometry.dispose();
        slot.mesh.geometry = pieceGeometry(o.mesh);
        slot.info = o.info;
        // trajectoires simulées des éclats (gen/sim.js) : une ligne par éclat,
        // deux texels (centre ; quaternion) par échantillon
        slot.track?.dispose();
        slot.track = new THREE.DataTexture(o.track, 2 * o.info.samples, o.info.frags, THREE.RGBAFormat, THREE.FloatType);
        slot.track.needsUpdate = true;
        U.samples.value = o.info.samples; U.rate.value = o.info.rate;
        slot.mesh.material?.dispose?.();
        slot.mesh.material = buildGlassMaterial(U, { glassKey: P.glass, track: slot.track }); // (après la géométrie)
        // le verre transmissif ne porte pas d'ombre : un double invisible la porte
        if (slot.caster) { slot.mesh.remove(slot.caster); slot.caster.material.dispose(); }
        slot.caster = new THREE.Mesh(slot.mesh.geometry, buildGlassShadowCaster(U, slot.mesh.material));
        slot.caster.layers.set(SHADOW_LAYER); slot.caster.castShadow = true; slot.caster.frustumCulled = false;
        slot.mesh.castShadow = GLASSES[P.glass]?.opaque ?? false; // (l'obsidienne porte la sienne)
        if (!GLASSES[P.glass]?.opaque) slot.mesh.add(slot.caster);
        scene.add(slot.mesh);
        pending--;
      }, (e) => { console.error(e); pending--; });
    });
    setFloor(R);
  }
  function setFloor(recipe) {
    const fk = `${recipe.floor.finish.set}|${recipe.floor.finish.outer.color}|${signature(recipe.floor.finish)}`;
    if (fk !== floorKey) {
      floorKey = fk;
      floor.material?.dispose?.();
      floor.material = buildPieceMaterial(recipe.floor.finish, finishU(recipe.floor.finish), { seedOff: uniform(new THREE.Vector3(9, 9, 9)) });
      floor.material.emissiveNode = floorEmissive();
      // (sole mate, poussiéreuse : un reflet rasant atténué — la lumière doit
      // tomber sur la pièce, pas sur le sol entre elle et la caméra)
      floor.material.specularIntensityNode = float(0.22);
      // (les contre-jours n'éclairent que le verre et les appareils : sur le sol,
      // ils effaceraient les ombres portées, et la pièce semblerait flotter)
      floor.material.lightsNode = lights([key, glow, furnaceLight]);
    }
  }

  // retouche d'un verre depuis le panneau
  function syncGlass() {
    for (const p of pieces) {
      if (!p.info) continue;
      if (!!GLASSES[p.P.glass]?.opaque !== !!GLASSES[p.glassKey]?.opaque) {
        p.mesh.material.dispose();
        p.mesh.material = buildGlassMaterial(p.U, { glassKey: p.P.glass, track: p.track });
      }
      p.glassKey = p.P.glass;
    }
  }

  const place = (l, az, el, r, target = [0, 0.6, 0]) => {
    l.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    l.target.position.set(...target);
  };

  // angle du plateau : il s'arrête en présentant le point d'impact de profil à
  // la caméra (un peu tourné vers elle), pour que le geste du déclencheur se
  // lise de côté (le pendule dans son plan, le marteau, la flamme, la membrane)
  const presentAngle = (p, l, Ts, k, camAz) => {
    const P = p.P;
    if (!p.info || !camAz) return spinAngle(P, l, Ts);
    const thC = Math.PI / 2 - camAz((k + PH.rupture) * Ts); // (caméra : angle dans le plan (x, z))
    const want = thC + (P.side ?? 1) * 1.25;
    const phiO = Math.atan2(p.info.origin[2], p.info.origin[0]);
    const corr = phiO - want - spinAngle(P, Ts, Ts);
    return spinAngle(P, l, Ts) + corr;
  };

  function update(t, camera, camAz = null) {
    if (!R) return;
    const N = R.pieces.length, Ts = R.loop.stage, T = Ts * N, S = R.size;
    const L = R.light;
    BD.c0.value.set(R.backdrop?.color ?? '#808080'); BD.gain.value = R.backdrop?.gain ?? 0.4; BD.heatGain.value = L.heat;
    place(key, L.key.az, L.key.el, 11);
    key.color.set(L.key.color); key.intensity = L.key.intensity; key.angle = L.key.angle; key.penumbra = L.key.penumbra;
    // carte d'ombre resserrée sur la sole (± 3,5 u), quelle que soit l'ouverture du
    // faisceau : sinon elle s'étale sur toute la scène et les ombres disparaissent
    key.shadow.focus = Math.min(1, Math.atan(3.5 / 11) / L.key.angle);
    // contre-jours : derrière la pièce par rapport à la caméra, de part et d'autre
    // (ils dessinent les bords du verre, quel que soit l'angle de vue)
    const camAng = camera ? Math.atan2(camera.position.z, camera.position.x) : 0;
    rims.forEach((l, i) => { const r = L.rim[i]; place(l, camAng + Math.PI + r.az, r.el, 9); l.color.set(r.color); l.intensity = r.intensity * (lite && i === 0 ? 1.4 : 1); });
    // four, fenêtre
    const pr = L.prop;
    furnace.visible = pr?.kind === 'four'; windowM.visible = pr?.kind === 'vitrail';
    if (pr) {
      // (décollés de la paroi courbe : un disque posé à 3 cm la coupait sur ses
      // côtés, et la gueule du four prenait la forme d'une applique)
      const a = pr.az, rw = R0 + 4 - 0.25, fy = Y0 + 5.2;
      FU.on.value = pr.intensity; FU.seed.value = pr.seed ?? 0;
      if (pr.kind === 'four') {
        furnace.position.set(Math.cos(a) * rw, fy, Math.sin(a) * rw); furnace.lookAt(0, fy, 0); furnace.scale.setScalar(1.6);
        furnaceLight.color.set('#ff6a1a'); furnaceLight.intensity = 650 * pr.intensity; furnaceLight.angle = 0.42;
      } else {
        windowM.position.set(Math.cos(a) * rw, Y0 + 4.2, Math.sin(a) * rw); windowM.lookAt(0, Y0 + 4.2, 0); windowM.scale.set(2.6, 7, 1);
        furnaceLight.color.set('#c890ff'); furnaceLight.intensity = 1100 * pr.intensity; furnaceLight.angle = 0.3;
      }
      furnaceLight.position.set(Math.cos(a) * (rw - 0.3), pr.kind === 'four' ? fy : Y0 + 6, Math.sin(a) * (rw - 0.3));
      furnaceLight.target.position.set(0, 0.7, 0);
    } else furnaceLight.intensity = 0;

    let glowI = 0, poolR = 0, floorHeat = 0, active = null, plateAngle = 0;
    const acc = PH.acc * Ts, cool = PH.cool * Ts;
    pieces.forEach((p, k) => {
      const l = (((t - k * Ts) % T) + T) % T;
      const P = p.P;
      p.mesh.visible = !!p.info && l < Ts;
      const a = presentAngle(p, l, Ts, k, camAz);
      p.mesh.rotation.y = a;
      const U = p.U;
      U.start.value = k * Ts; U.loopT.value = T; U.Ts.value = Ts; U.size.value = S;
      U.k.value = R.loop.slow.k; U.pre.value = R.loop.slow.pre; U.plat.value = R.loop.slow.plat; U.post.value = R.loop.slow.post;
      U.thick.value = S * P.thickness * (P.form === 'dome' ? 2 : 1);
      U.res.value = P.mech === 'resonance' ? 1 : 0; U.therm.value = P.mech === 'thermal' ? 1 : 0;
      U.heatGain.value = L.heat;
      U.fil.value = P.fil ?? 0; U.filN.value = P.filN ?? 16; U.filTwist.value = P.filTwist ?? 1;
      applyGlass(U, { key: P.glass, fire: P.fire });
      if (p.info) U.origin.value.set(...p.info.origin);
      if (l < Ts) {
        // chaleur visible : soufflage, refroidissement, fonte
        glowI += Math.max(0, Math.min(1, l / (acc * 0.3)) * (1 - Math.max(0, l - acc) / cool)) ** 3;
        const melt = sm(PH.melt * Ts, (PH.melt + PH.meltSpan + PH.meltDur) * Ts, l);
        glowI += melt * 0.5;
        poolR = Math.max(poolR, 0.6 * melt, 0.6 * (1 - sm(0, acc * 0.85, l))); // (le bain nourrit le soufflage, puis il se reforme de la fonte)
        floorHeat = Math.max(floorHeat, sm((PH.melt - 0.03) * Ts, PH.melt * Ts, l), 1 - sm(acc * 0.5, acc * 1.6, l));
        active = p; plateAngle = a;
      }
    });
    plate.rotation.y = plateAngle;
    pool.visible = poolR > 0.01;
    pool.scale.set(poolR, Math.max(0.2, poolR), poolR);
    BD.heat.value = Math.min(1, floorHeat);
    POOL.gain.value = L.heat;
    glow.intensity = (glowI * 90 + floorHeat * 40) * L.heat * S * S;
    glow.position.set(0, 0.5, 0);
    // déclencheur de la pièce active (le plateau est arrêté quand il agit)
    if (active) {
      const l = (((t - active.k * Ts) % T) + T) % T;
      apparatus.update(active.P, active.info, presentAngle(active, Ts, Ts, active.k, camAz), l, Ts, R.loop.slow, S);
    } else apparatus.update(null);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, setFloor, update, syncGlass, setShadowQuality, floor, key, rims, glow, pool, plate, apparatus,
    get pieces() { return pieces; },
    // (la plus haute pièce de la scène : le cadrage la contient en entier)
    maxHeight: () => Math.max(1, ...pieces.map((p) => p.info?.height ?? 0)),
    group: scene,
    ready: () => pending === 0,
    progress: () => (total ? 1 - pending / total : 1),
  };
}
