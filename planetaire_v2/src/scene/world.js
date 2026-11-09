// Un monde : la machine d'une couche avec tout ce qui l'entoure — sol, coque
// de fond, lampe et contre-jour, matières et studio HDR propres, verre filé,
// et ses astres, qui sont des boules de verre. La boule visée par la plongée
// contient le monde suivant (réduit d'un facteur k) ; les autres, une
// miniature de ce monde (son fond, son sol, la courbe de son orbite).
//
// Unités : celles de la machine (orbite de taille 1). La coque de fond est une
// sphère de rayon RG centrée sur l'origine, vue de l'intérieur ; la caméra de
// la couche reste à l'intérieur. Une boule de rayon rg contient donc le monde
// suivant réduit de k = rg / RG : vue de l'intérieur, elle est exactement ce
// monde.
import * as THREE from 'three/webgpu';
import { positionLocal, mix, smoothstep, uniform, vec2, vec3, vec4, float, length, lights, output, normalView, positionViewDirection, abs, dot, pow, fract, screenCoordinate, frameId } from 'three/tsl';
import { epicycles, sampleArms } from './epicycles.js';
import { createOrbitVisual } from './orbit3d.js';
import { createMachine, materials } from './machine.js';
import { makeEnvironment } from './env.js';
import { createAtmosphere } from './atmosphere.js';
import { beatsFor, warp } from './choreo.js';
import { ARM_TOL } from '../orbit/search.js';
import { MATTERS } from '../recipe.js';

const TAU = Math.PI * 2;
export const Y_FLOOR = -0.72;

// ── Les astres : boules de verre et leurs montures ───────────────────────────
// verre : une sphère et un jonc à l'équateur ; cardan : deux anneaux croisés
// qui tournent ; armillaire : une cage de méridiens et de parallèles ;
// griffes : serties dans quatre griffes sur un chaton ; lanterne : une cage de
// barreaux sous un chapeau
export const GLOBE_KINDS = { verre: 'Boule de verre', cardan: 'Sur cardan', armillaire: 'Cage armillaire', griffes: 'Sertie à griffes', lanterne: 'Lanterne' };
export const GLASS_TINTS = { clair: '#ffffff', fume: '#9aa0a8', bleute: '#a9c6ff', ambre: '#ffcf8a', vert: '#bfe8c8' };

function globeMount(kind, rg, metal, keep) {
  const g = new THREE.Group();
  const ring = (r, t, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(keep(new THREE.TorusGeometry(r, t, 10, 72)), metal);
    m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m;
  };
  const rings = [];
  if (kind === 'verre') ring(rg * 1.01, rg * 0.035, Math.PI / 2);
  else if (kind === 'cardan') { rings.push(ring(rg * 1.12, rg * 0.04, 0, 0)); rings.push(ring(rg * 1.22, rg * 0.04, Math.PI / 2, 0)); }
  else if (kind === 'armillaire') {
    for (let i = 0; i < 4; i++) ring(rg * 1.04, rg * 0.022, 0, (i / 4) * Math.PI).rotation.y = (i / 4) * Math.PI;
    ring(rg * 1.04, rg * 0.03, Math.PI / 2);
    for (const y of [-0.55, 0.55]) { const r = ring(rg * 1.04 * Math.cos(Math.asin(y)), rg * 0.018, Math.PI / 2); r.position.y = rg * y; }
  } else if (kind === 'griffes') {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4, claw = new THREE.Mesh(keep(new THREE.TorusGeometry(rg * 1.02, rg * 0.05, 8, 24, Math.PI * 0.42)), metal);
      claw.rotation.set(0, -a, -Math.PI / 2 - 0.15); claw.castShadow = true; g.add(claw);
    }
  } else if (kind === 'lanterne') {
    // (barreaux découpés en hauteur : le passage de la caméra se calcule sur les sommets de la monture)
    const n = 8, bar = keep(new THREE.CylinderGeometry(rg * 0.02, rg * 0.02, rg * 2.1, 6, 16));
    for (let i = 0; i < n; i++) { const b = new THREE.Mesh(bar, metal); const a = (i / n) * TAU; b.position.set(Math.cos(a) * rg * 1.06, 0, Math.sin(a) * rg * 1.06); b.castShadow = true; g.add(b); }
    // (le chapeau reste en place : la caméra entre par le côté, entre deux barreaux)
    for (const y of [-1, 1]) ring(rg * 1.06, rg * 0.03, Math.PI / 2).position.y = y * rg * 1.04;
    const cap = new THREE.Mesh(keep(new THREE.ConeGeometry(rg * 0.5, rg * 0.4, 24)), metal);
    cap.position.y = rg * 1.3; cap.castShadow = true; g.add(cap);
  }
  return { group: g, rings };
}

// ── Un monde ─────────────────────────────────────────────────────────────────

// layer : le calque propre à ce monde (sa lampe n'ombre que lui)
// hold() : la part de la couche avant la plongée (voir le ralenti, plus bas)
export function createWorld({ orbit, L, lite = false, shadows, seed, layer = 1, design = null, hold = () => 1 }) {
  const o = orbit, p = o.params, N = p.N;
  const kScale = 1 / o.info.size;
  const coef = Float64Array.from(o.coef, (v) => v * kScale);
  const group = new THREE.Group();
  const geos = new Set();
  const keep = (g) => (geos.add(g), g);

  // matières de ce monde, et son studio HDR (les reflets restent ceux de sa couche)
  const mats = materials();
  mats.apply(L.matters, MATTERS);
  mats.setFinish(L.stage.finish, L.stage.finishScale);
  const env = makeEnvironment(L.light.env, 0, lite ? 512 : 1024);

  // la machine (les bras retenus tracent la courbe à ARM_TOL près)
  const epi = epicycles(coef, p, 1, { tol: ARM_TOL, max: 14 });
  const machine = createMachine({ arms: epi.arms, N, mats, omegaFrac: p.omegaFrac, yFloor: Y_FLOOR, archetype: L.stage.archetype, design });
  const plate = new THREE.Group();
  plate.add(machine.group);
  group.add(plate, machine.stand);
  // verre filé, sous les boules
  const curve = sampleArms(epi.arms, 2400);
  const rg0 = Math.min(0.075, 0.38 * o.info.ratio); // (rayon des boules, voir plus bas)
  // la gravure est au ras du plateau : si la courbe en sort (les astres
  // survolent le bâti), elle flotterait dans le vide ; la trace devient alors du
  // verre filé, en hauteur, sous les astres
  let curveR = 0;
  for (let i = 0; i < curve.length; i += 2) curveR = Math.max(curveR, Math.hypot(curve[i], curve[i + 1]));
  const traceKind = L.trace.kind === 'gravure' && curveR > machine.plateR - 0.03 ? 'verre' : L.trace.kind;
  const trail = createOrbitVisual({ curve, N, gap: rg0, radius: 0.0042 * L.trace.thick, traceKind, bodies: false });
  trail.setStyle(L);
  trail.group.position.y = traceKind === 'gravure' ? machine.yPlate + 0.0015 : machine.yBody - 0.03;
  plate.add(trail.group);

  // sol et coque de fond (vue de l'intérieur ; un dégradé de studio)
  const RG = 5.2;
  // Le sol se fond dans la coque : pas de bord ni d'horizon nets. La coque est un
  // cyclorama (un dégradé vertical, plus sombre et plus dense vers le bas) ; le
  // sol, éclairé près de la machine, glisse vers la couleur de la coque au ras
  // du sol (la même, au même endroit), et une brume légère monte du sol pour
  // effacer la ligne où ils se rejoignent.
  const bg = new THREE.Color(L.light.bg);
  const bgU = uniform(bg);
  const shellAt = (y) => mix(bgU.mul(0.8), bgU.mul(1.9), smoothstep(-0.3, 0.6, y));
  const horizon = shellAt(float(Y_FLOOR / RG));
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: L.light.floor, roughness: 0.95 });
  {
    const r = length(positionLocal.xy).div(RG);
    const f = smoothstep(0.34, 0.9, r);
    floorMat.outputNode = vec4(mix(output.rgb, horizon, f.mul(f).mul(float(3).sub(f.mul(2)))), output.a);
  }
  const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(Math.sqrt(RG * RG - Y_FLOOR * Y_FLOOR) * 0.998, 160)), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = Y_FLOOR; floor.receiveShadow = true;
  group.add(floor);
  const shellMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  {
    const y = positionLocal.y.div(RG);
    // brume au ras du sol : la coque reprend la couleur de l'horizon juste au-dessus du sol
    const haze = smoothstep(Y_FLOOR / RG + 0.22, Y_FLOOR / RG, y);
    shellMat.colorNode = mix(shellAt(y), horizon, haze);
  }
  const shell = new THREE.Mesh(keep(new THREE.SphereGeometry(RG, 64, 32)), shellMat);
  shell.castShadow = false; shell.receiveShadow = false;
  group.add(shell);
  // fond de la coque, vu de l'extérieur : la calotte sous le sol, tournée vers
  // dehors. De l'intérieur on ne la voit jamais (le sol la cache, et ses faces
  // sont de dos) ; quand ce monde est dans une boule, elle cache ce qui est
  // sous la boule (son chaton, sa goupille), qu'on verrait sinon au travers
  const capMat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  capMat.colorNode = horizon;
  const thF = Math.acos(Y_FLOOR / RG) - 0.02;
  const cap = new THREE.Mesh(keep(new THREE.SphereGeometry(RG * 0.999, 64, 12, 0, TAU, thF, Math.PI - thF)), capMat);
  group.add(cap);

  // lampe et contre-jour (projecteurs : leur intensité suit l'échelle du monde)
  const key = new THREE.SpotLight(L.light.key.color, 1, 0, 0.42, 0.85, 2);
  key.position.set(-2.4, 3.6, 1.7);
  key.target.position.set(0, machine.yPlate, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(shadows.key, shadows.key);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  const rim = new THREE.SpotLight(L.light.rim.color, 1, 0, 0.6, 1, 2);
  rim.position.set(1.8, 1.6, -2.8);
  rim.target.position.set(0, machine.yPlate, 0);
  // les lumières de ce monde sont dans un gréement à part, placé directement
  // dans la scène (main.js recopie sur lui la position du monde à chaque image) :
  // l'ordre des lumières de la scène ne change donc jamais quand les mondes
  // s'emboîtent autrement (three.js recompilerait sinon tous les matériaux, d'où
  // un gel à chaque plongée)
  const rig = new THREE.Group();
  rig.matrixAutoUpdate = false;
  rig.add(key, key.target, rim, rim.target);
  key.shadow.camera.layers.mask = 1 << layer; // (n'ombre que ce monde)
  const bodyLights = Array.from({ length: N }, () => { const l = new THREE.PointLight(L.bodies.color, 0, 0, 2); rig.add(l); return l; });

  // atmosphère : poussières, faisceau, brume, braises (voir atmosphere.js)
  const atmo = createAtmosphere({
    atmo: L.atmo || { dust: 0.8, beam: 0.8, haze: 0.4, embers: 0 }, keyColor: L.light.key.color, bg: L.light.bg,
    floorY: Y_FLOOR, plateY: machine.yPlate, plateR: machine.plateR, RG, lite,
    keyPos: key.position.toArray(), keyTarget: key.target.position.toArray(), keyAngle: key.angle,
  });
  group.add(atmo.group);

  // ── astres : boules de verre sur cardan (elles restent droites quand le plateau tourne)
  const rg = Math.min(0.075, 0.38 * o.info.ratio);
  // la boule repose sur le chaton (coupe de rayon 0,02 dont le bord est à
  // yBody − 0,016) sans y entrer : rien de la goupille ne paraît dedans
  const cupR = 0.02, cupTop = machine.yBody - 0.016;
  const yGlobe = cupTop + Math.sqrt(Math.max(0, rg * rg - cupR * cupR)) + 0.0004;
  // Le verre : presque invisible de face, de plus en plus réfléchissant vers le
  // bord (Fresnel), avec un liseré clair ; la boule visée s'efface quand elle
  // remplit l'image (on la traverse sans voile)
  const tint = new THREE.Color(GLASS_TINTS[L.bodies.tint] || '#ffffff');
  const glassFade = uniform(1);
  const makeGlass = (fade) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ color: tint, metalness: 0, roughness: 0.03, transparent: true, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: L.bodies.irid ?? 0.2, iridescenceIOR: 1.4 });
    const nv = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
    const fr = pow(float(1).sub(nv), 4);
    m.opacityNode = mix(float(0.05), float(0.9), fr).mul(fade ?? 1);
    // liseré : une fine couronne lumineuse teintée au ras de la silhouette
    m.emissiveNode = vec3(tint.r, tint.g, tint.b).mul(pow(float(1).sub(nv), 10).mul(0.35)).mul(fade ?? 1);
    return m;
  };
  const glassMat = makeGlass(null), glassMatT = makeGlass(glassFade);
  const glassGeo = keep(new THREE.SphereGeometry(rg, 96, 64));
  const globes = [];
  for (let j = 0; j < N; j++) {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.renderOrder = 5;
    const inner = new THREE.Group(); // contenu : le monde suivant ou sa miniature
    const mount = globeMount(L.bodies.globe, rg, mats.pins, keep);
    g.add(inner, glass, mount.group);
    plate.add(g);
    globes.push({ group: g, inner, mount, mini: null, glass });
  }

  // tout ce monde reflète son propre studio, et n'est éclairé que par ses
  // propres lumières (lampe, contre-jour, astres) : un monde emboîté n'est pas
  // inondé par celles du monde qui le contient, et la plongée est auto-similaire
  const lightsNode = lights([key, rim, ...bodyLights]);
  const lit = new Set([glassMatT]);
  group.traverse((x) => {
    if (!x.material || x.material === shellMat || x.material === capMat || x.material.userData.unlit) return;
    lit.add(x.material);
  });
  for (const m of lit) {
    m.envMap = env;
    m.envMapIntensity = L.light.envIntensity;
    if (!m.isMeshBasicMaterial && !m.isLineBasicMaterial) m.lightsNode = lightsNode;
  }
  // (le calque de ce monde, pour son ombre ; les miniatures s'y ajoutent dans setNext)
  const tag = (o) => o.traverse((x) => x.layers.enable(layer));
  tag(group);

  // ── temps : le monde ne dépend que de u (sa profondeur relative), donc d'une
  // couche à la même couche, une boucle plus tard, tout est identique
  const q = p.omegaFrac[1];
  const beats = beatsFor(coef, p, q, seed, L.motion.slowmo);
  const Omega = TAU * L.motion.periodsPerLayer; // temps de l'orbite parcouru par couche
  const bodyXY = new Float64Array(2 * N);
  const local = Array.from({ length: N }, () => new THREE.Vector3()); // centres des boules (repère du monde)
  let flare = new Float64Array(N);

  const clock = { tau: 0, th: 0 }; // (temps de l'orbite et angle du plateau à la dernière mise à jour)
  // Le ralenti de la plongée. Quand la caméra part vers une boule, le temps de
  // ce monde ralentit (jusqu'à 8 % de son allure, en 40 % de la plongée) : la
  // boule visée, fixée au centre de l'image, ne bouge presque plus, et la
  // machine, agrandie des dizaines de fois, ne défile plus autour d'elle (elle
  // basculait d'un côté à l'autre de la boule en un instant, comme dans un
  // miroir). Le monde qu'on rejoint, lui, tourne à son allure. Tout reste une
  // fonction de u : T(u) = u avant la plongée, puis l'intégrale de l'allure.
  const SLOW = 0.08;
  const localTime = (u) => {
    const h = hold();
    if (u <= h) return u;
    const d = 0.4 * (1 - h), x = Math.min(1, (u - h) / d);
    return h + d * (x - (1 - SLOW) * (x * x * x - (x * x * x * x) / 2)) + SLOW * Math.max(0, u - h - d);
  };
  function update(u) {
    const { tau, open } = warp(Omega * localTime(u), beats);
    atmo.update(u * 14); // (secondes : une couche dure de 12 à 16 s)
    const th = p.omega * tau, c = Math.cos(th), s = Math.sin(th);
    plate.rotation.y = th;
    clock.tau = tau; clock.th = th;
    trail.phase.value = ((tau / TAU) % 1 + 1) % 1;
    machine.update(tau, bodyXY);
    for (let j = 0; j < N; j++) {
      const x = bodyXY[2 * j], y = bodyXY[2 * j + 1], G = globes[j];
      G.group.position.set(x, yGlobe, -y);
      G.group.rotation.y = -th; // (cardan : la boule reste droite dans le studio)
      for (const [i, r] of G.mount.rings.entries()) r.rotation.y = (i ? -1 : 1) * tau * 0.7;
      local[j].set(x * c - y * s, yGlobe, -x * s - y * c);
      trail.bodyUniforms[j].value.set(x, y);
    }
    // embrasement : un astre s'avive quand il en frôle un autre
    for (let j = 0; j < N; j++) {
      let d = Infinity;
      for (let i = 0; i < N; i++) if (i !== j) d = Math.min(d, Math.hypot(bodyXY[2 * i] - bodyXY[2 * j], bodyXY[2 * i + 1] - bodyXY[2 * j + 1]));
      flare[j] = 1 + L.bodies.flare * Math.exp(-((d / (1.7 * o.info.ratio)) ** 2));
    }
    return { open };
  }

  // échelle de ce monde dans l'image : les lumières suivent (intensité × échelle²)
  function setScale(sc, shadow = true) {
    key.intensity = L.light.key.intensity * sc * sc;
    rim.intensity = L.light.rim.intensity * 6 * sc * sc;
    key.shadow.camera.near = 0.3 * sc; key.shadow.camera.far = 12 * sc;
    key.distance = 0;
    key.shadow.autoUpdate = shadow; // (monde invisible : carte d'ombre figée)
    const b = L.bodies.light * sc * sc;
    for (let j = 0; j < N; j++) { bodyLights[j].position.copy(local[j]); bodyLights[j].intensity = b * flare[j]; }
  }

  // le gréement des lumières suit le monde (sa transformation dans la scène)
  function syncRig() {
    group.updateWorldMatrix(true, false);
    rig.matrix.copy(group.matrixWorld);
    rig.matrixWorldNeedsUpdate = true;
    atmo.sync(group.matrixWorld, key.position, key.target.position);
  }

  // la boule visée par la plongée : son verre s'efface quand il remplit l'image
  // (sa monture, elle, pivote pour laisser passer la caméra : voir main.js)
  function setTarget(j) {
    globes.forEach((G, i) => { G.glass.material = i === j ? glassMatT : glassMat; });
  }

  // la miniature du monde suivant, pour les boules qui ne sont pas visées
  function setNext(next) {
    const k = rg / next.RG;
    for (const G of globes) {
      if (G.mini) { G.inner.remove(G.mini); G.mini = null; }
      const m = new THREE.Group();
      m.scale.setScalar(k);
      m.add(next.miniature());
      tag(m);
      G.inner.add(m);
      G.mini = m;
    }
    return k;
  }

  // ce qu'il faut pour être la miniature d'un autre monde (matières sans
  // lumière : la miniature est dans la boule d'un autre monde, loin des siennes)
  const miniFloor = new THREE.MeshBasicNodeMaterial();
  miniFloor.colorNode = mix(vec3(...new THREE.Color(L.light.floor).multiplyScalar(0.35).toArray()), horizon, smoothstep(0.34, 0.9, length(positionLocal.xy).div(RG)));
  const miniPlate = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(...(MATTERS[L.matters.plate]?.color || [0.5, 0.4, 0.3])).multiplyScalar(0.45) });
  function miniature() {
    const m = new THREE.Group();
    const sh = new THREE.Mesh(shell.geometry, shellMat); m.add(sh);
    const fl = new THREE.Mesh(floor.geometry, miniFloor); fl.rotation.x = -Math.PI / 2; fl.position.y = Y_FLOOR; m.add(fl);
    const lineMat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(L.bodies.color).multiplyScalar(4) });
    const pts = [];
    for (let i = 0; i < curve.length / 2; i += 4) pts.push(new THREE.Vector3(curve[2 * i], machine.yBody, -curve[2 * i + 1]));
    pts.push(pts[0].clone()); // (courbe fermée)
    const line = new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(pts)), lineMat);
    m.add(line);
    const pl = new THREE.Mesh(keep(new THREE.CylinderGeometry(machine.plateR, machine.plateR, 0.035, 64)), miniPlate);
    pl.position.y = machine.yPlate - 0.0175; m.add(pl);
    return m;
  }

  return {
    group, plate, machine, globes, local, flare, N, RG, rg, yGlobe, update, setScale, setNext, miniature, rig, syncRig, setTarget, glassFade,
    bg, env, clock, epi, orbit: o, params: p, info: o.info, L,
    dispose() {
      for (const g of geos) g.dispose(); machine.dispose(); trail.dispose(); env.dispose();
      rig.removeFromParent(); key.shadow.dispose?.(); atmo.dispose();
      for (const m of [floorMat, shellMat, capMat, glassMat, glassMatT, miniFloor, miniPlate, ...lit]) m.dispose();
    },
  };
}
