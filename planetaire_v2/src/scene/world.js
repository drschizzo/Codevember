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
import { positionLocal, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import { epicycles, sampleArms } from './epicycles.js';
import { createOrbitVisual } from './orbit3d.js';
import { createMachine, materials } from './machine.js';
import { makeEnvironment } from './env.js';
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
    const n = 8, bar = keep(new THREE.CylinderGeometry(rg * 0.02, rg * 0.02, rg * 2.1, 6));
    for (let i = 0; i < n; i++) { const b = new THREE.Mesh(bar, metal); const a = (i / n) * TAU; b.position.set(Math.cos(a) * rg * 1.06, 0, Math.sin(a) * rg * 1.06); b.castShadow = true; g.add(b); }
    for (const y of [-1, 1]) { const r = ring(rg * 1.06, rg * 0.03, Math.PI / 2); r.position.y = y * rg * 1.04; }
    const cap = new THREE.Mesh(keep(new THREE.ConeGeometry(rg * 0.5, rg * 0.4, 24)), metal);
    cap.position.y = rg * 1.3; cap.castShadow = true; g.add(cap);
  }
  return { group: g, rings };
}

// ── Un monde ─────────────────────────────────────────────────────────────────

export function createWorld({ orbit, L, lite = false, shadows, seed }) {
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
  const machine = createMachine({ arms: epi.arms, N, mats, omegaFrac: p.omegaFrac, yFloor: Y_FLOOR });
  const plate = new THREE.Group();
  plate.add(machine.group);
  group.add(plate, machine.stand);
  // verre filé, sous les boules
  const curve = sampleArms(epi.arms, 2400);
  const trail = createOrbitVisual({ curve, N, radius: 0.0065 * L.trace.thick, traceKind: L.trace.kind, bodies: false });
  trail.setStyle(L);
  trail.group.position.y = L.trace.kind === 'gravure' ? machine.yPlate + 0.0015 : machine.yBody - 0.03;
  plate.add(trail.group);

  // sol et coque de fond (vue de l'intérieur ; un dégradé de studio)
  const RG = 5.2;
  const floorMat = new THREE.MeshStandardNodeMaterial({ color: L.light.floor, roughness: 0.95 });
  const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(RG * 0.985, 128)), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = Y_FLOOR; floor.receiveShadow = true;
  group.add(floor);
  const bg = new THREE.Color(L.light.bg);
  const shellMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const bgU = uniform(bg);
  shellMat.colorNode = mix(bgU.mul(0.55), bgU.mul(1.25), smoothstep(-0.3, 0.6, positionLocal.y.div(RG)));
  const shell = new THREE.Mesh(keep(new THREE.SphereGeometry(RG, 64, 32)), shellMat);
  shell.castShadow = false; shell.receiveShadow = false;
  group.add(shell);

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
  group.add(key, key.target, rim, rim.target);

  // ── astres : boules de verre sur cardan (elles restent droites quand le plateau tourne)
  const rg = Math.min(0.075, 0.38 * o.info.ratio);
  const yGlobe = machine.yBody + rg - 0.018;
  const glassMat = new THREE.MeshPhysicalNodeMaterial({ color: GLASS_TINTS[L.bodies.tint] || '#ffffff', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.16, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: L.bodies.irid ?? 0.2 });
  const glassGeo = keep(new THREE.SphereGeometry(rg, 48, 24));
  const globes = [];
  for (let j = 0; j < N; j++) {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.renderOrder = 5;
    const inner = new THREE.Group(); // contenu : le monde suivant ou sa miniature
    const mount = globeMount(L.bodies.globe, rg, mats.pins, keep);
    g.add(inner, glass, mount.group);
    plate.add(g);
    globes.push({ group: g, inner, mount, mini: null });
  }

  // tout ce monde reflète son propre studio
  group.traverse((x) => {
    if (!x.material || x.material === shellMat) return;
    x.material.envMap = env;
    x.material.envMapIntensity = L.light.envIntensity;
  });

  // ── temps : le monde ne dépend que de u (sa profondeur relative), donc d'une
  // couche à la même couche, une boucle plus tard, tout est identique
  const q = p.omegaFrac[1];
  const beats = beatsFor(coef, p, q, seed, L.motion.slowmo);
  const Omega = TAU * L.motion.periodsPerLayer; // temps de l'orbite parcouru par couche
  const bodyXY = new Float64Array(2 * N);
  const local = Array.from({ length: N }, () => new THREE.Vector3()); // centres des boules (repère du monde)
  let flare = new Float64Array(N);

  function update(u) {
    const { tau, open } = warp(Omega * u, beats);
    const th = p.omega * tau, c = Math.cos(th), s = Math.sin(th);
    plate.rotation.y = th;
    trail.phase.value = ((tau / TAU) % 1 + 1) % 1;
    machine.update(tau, bodyXY);
    for (let j = 0; j < N; j++) {
      const x = bodyXY[2 * j], y = bodyXY[2 * j + 1], G = globes[j];
      G.group.position.set(x, yGlobe, -y);
      G.group.rotation.y = -th; // (cardan : la boule reste droite dans le studio)
      for (const [i, r] of G.mount.rings.entries()) r.rotation.y = (i ? -1 : 1) * tau * 0.7;
      local[j].set(x * c - y * s, yGlobe, -x * s - y * c);
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
  function setScale(sc) {
    key.intensity = L.light.key.intensity * sc * sc;
    rim.intensity = L.light.rim.intensity * 4 * sc * sc;
    key.shadow.camera.near = 0.3 * sc; key.shadow.camera.far = 12 * sc;
    key.distance = 0;
  }

  // la miniature du monde suivant, pour les boules qui ne sont pas visées
  function setNext(next) {
    const k = rg / next.RG;
    for (const G of globes) {
      if (G.mini) { G.inner.remove(G.mini); G.mini = null; }
      const m = new THREE.Group();
      m.scale.setScalar(k);
      m.add(next.miniature());
      G.inner.add(m);
      G.mini = m;
    }
    return k;
  }

  // ce qu'il faut pour être la miniature d'un autre monde
  function miniature() {
    const m = new THREE.Group();
    const sh = new THREE.Mesh(shell.geometry, shellMat); m.add(sh);
    const fl = new THREE.Mesh(floor.geometry, floorMat); fl.rotation.x = -Math.PI / 2; fl.position.y = Y_FLOOR; m.add(fl);
    const lineMat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(L.bodies.color).multiplyScalar(4) });
    const pts = [];
    for (let i = 0; i < curve.length / 2; i += 4) pts.push(new THREE.Vector3(curve[2 * i], machine.yBody, -curve[2 * i + 1]));
    pts.push(pts[0].clone()); // (courbe fermée)
    const line = new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(pts)), lineMat);
    m.add(line);
    const pl = new THREE.Mesh(keep(new THREE.CylinderGeometry(machine.plateR, machine.plateR, 0.035, 64)), mats.plate);
    pl.position.y = machine.yPlate - 0.0175; m.add(pl);
    return m;
  }

  return {
    group, plate, machine, globes, local, flare, N, RG, rg, yGlobe, update, setScale, setNext, miniature,
    bg, epi, orbit: o, params: p, info: o.info, L,
    dispose() { for (const g of geos) g.dispose(); machine.dispose(); trail.dispose(); env.dispose(); },
  };
}
