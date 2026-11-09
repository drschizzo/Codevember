// La machine de Fourier : un plateau de laiton qui tourne à ω, et pour chaque
// astre une chaîne de bras (épicycles). Le bras i tourne à la vitesse entière
// kᵢ par rapport au plateau ; une roue dentée à chaque pivot rend le rapport
// lisible (plus k est grand, plus elle a de dents). Les N chaînes sont les
// mêmes, déphasées d'un N-ième de période : les bras de même rang sont
// étagés juste l'un au-dessus de l'autre, sans jamais se toucher.
import * as THREE from 'three/webgpu';
import { pivots } from './epicycles.js';

const TAU = Math.PI * 2;

export const Y_PLATE = -0.34;     // dessus du plateau
const Y_ARM0 = -0.3, DY = 0.03;   // étage du premier bras, pas entre étages
const ARM_W = 0.018, ARM_T = 0.006;

export function materials() {
  const brass = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.86, 0.64, 0.33), metalness: 1, roughness: 0.26, clearcoat: 0.4, clearcoatRoughness: 0.12 });
  // plateau : bronze patiné, sombre, pour que le verre incandescent domine
  const plate = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.3, 0.2, 0.11), metalness: 1, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const steel = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.1, 0.14, 0.32), metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08 });
  const bright = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color().setRGB(0.92, 0.92, 0.9), metalness: 1, roughness: 0.14 });
  return { brass, plate, steel, bright };
}

// roue dentée plate (dans le plan xz), dentures trapézoïdales, moyeu percé
const gearCache = new Map();
function gearGeometry(teeth, radius, thick) {
  const key = `${teeth}:${radius.toFixed(4)}`;
  if (gearCache.has(key)) return gearCache.get(key);
  const shape = new THREE.Shape(), depth = Math.min(radius * 0.18, (TAU * radius) / teeth * 0.55);
  const r0 = radius - depth, r1 = radius;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU, w = TAU / teeth;
    const pts = [[r0, a], [r1, a + w * 0.18], [r1, a + w * 0.45], [r0, a + w * 0.63]];
    for (const [r, b] of pts) {
      const x = r * Math.cos(b), y = r * Math.sin(b);
      i === 0 && r === r0 && b === a ? shape.moveTo(x, y) : shape.lineTo(x, y);
    }
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, radius * 0.22, 0, TAU, true);
  shape.holes.push(hole);
  // quatre ajours entre moyeu et denture, comme une roue d'horlogerie
  if (radius > 0.03) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.35, h = new THREE.Path();
      h.absarc(Math.cos(a) * radius * 0.52, Math.sin(a) * radius * 0.52, radius * 0.17, 0, TAU, true);
      shape.holes.push(h);
    }
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.15, bevelSize: thick * 0.15, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2);
  gearCache.set(key, g);
  return g;
}

export function createMachine({ arms, N, mats }) {
  const group = new THREE.Group();
  const geos = [];
  const keep = (g) => (geos.push(g), g);

  // plateau : disque, jonc au bord, graduations
  const plateR = 1.38;
  const plate = new THREE.Mesh(keep(new THREE.CylinderGeometry(plateR, plateR, 0.035, 160)), mats.plate);
  plate.position.y = Y_PLATE - 0.0175;
  plate.receiveShadow = true; plate.castShadow = true;
  group.add(plate);
  const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(plateR, 0.012, 12, 200)), mats.brass);
  rim.rotation.x = Math.PI / 2; rim.position.y = Y_PLATE;
  group.add(rim);
  const tickGeo = keep(new THREE.BoxGeometry(0.05, 0.004, 0.005));
  const ticks = new THREE.InstancedMesh(tickGeo, mats.bright, 120);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * TAU, long = i % 10 === 0 ? 2 : i % 5 === 0 ? 1.5 : 1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    p.set(Math.cos(a) * (plateR - 0.06 - 0.012 * long), Y_PLATE + 0.002, Math.sin(a) * (plateR - 0.06 - 0.012 * long));
    s.set(long, 1, 1);
    ticks.setMatrixAt(i, m4.compose(p, q, s));
  }
  ticks.receiveShadow = true;
  group.add(ticks);

  // arbre central : des tubes coaxiaux qui portent les premiers bras
  const top0 = Y_ARM0 + (N - 1) / N * DY + 0.01;
  const arbor = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.02, 0.026, top0 - Y_PLATE, 32)), mats.brass);
  arbor.position.y = (top0 + Y_PLATE) / 2;
  arbor.castShadow = true;
  group.add(arbor);

  // bras, moyeux, roues, et la goupille qui porte l'astre
  const barGeo = keep(new THREE.BoxGeometry(1, ARM_T, ARM_W));
  barGeo.translate(0.5, 0, 0);
  const hubGeo = keep(new THREE.CylinderGeometry(ARM_W * 0.75, ARM_W * 0.75, ARM_T * 1.6, 24));
  const pinGeo = keep(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 10));
  pinGeo.translate(0, 0.5, 0);
  const chains = [];
  for (let j = 0; j < N; j++) {
    const ch = { bars: [], hubs: [], gears: [], pin: null, ys: [] };
    arms.forEach((a, i) => {
      const y = Y_ARM0 + (i + j / N) * DY;
      ch.ys.push(y);
      const bar = new THREE.Mesh(barGeo, i % 2 ? mats.steel : mats.brass);
      bar.castShadow = bar.receiveShadow = true;
      group.add(bar); ch.bars.push(bar);
      const hub = new THREE.Mesh(hubGeo, mats.bright);
      hub.castShadow = true;
      group.add(hub); ch.hubs.push(hub);
      // roue au pivot : son nombre de dents dit la vitesse du bras
      const teeth = Math.min(60, 10 + 3 * Math.abs(a.k));
      const r = Math.min(0.07, Math.max(0.028, Math.abs(a.re) + Math.abs(a.im)) * 0.25 + 0.022);
      const gear = new THREE.Mesh(gearGeometry(teeth, r, 0.005), i % 2 ? mats.brass : mats.steel);
      gear.castShadow = true; gear.receiveShadow = true;
      group.add(gear); ch.gears.push(gear);
    });
    ch.pin = new THREE.Mesh(pinGeo, mats.bright);
    ch.pin.castShadow = true;
    group.add(ch.pin);
    chains.push(ch);
  }

  const P = new Float64Array(2 * arms.length + 2);
  // t : temps de l'orbite (période 2π), dans le repère du plateau
  function update(t, bodyXY) {
    for (let j = 0; j < N; j++) {
      const ch = chains[j];
      pivots(arms, t + (TAU * j) / N, P);
      for (let i = 0; i < arms.length; i++) {
        const x0 = P[2 * i], y0 = P[2 * i + 1], dx = P[2 * i + 2] - x0, dy = P[2 * i + 3] - y0;
        const L = Math.hypot(dx, dy), th = Math.atan2(dy, dx), y = ch.ys[i];
        const bar = ch.bars[i];
        bar.position.set(x0, y, -y0); bar.rotation.y = th; bar.scale.x = L;
        ch.hubs[i].position.set(x0, y + ARM_T * 0.3, -y0);
        const g = ch.gears[i];
        g.position.set(x0, y - ARM_T * 1.2, -y0); g.rotation.y = th;
      }
      // goupille : du bout de la chaîne jusqu'à l'astre (posé sur l'orbite exacte)
      const n = arms.length, yl = ch.ys[n - 1] ?? Y_ARM0;
      const bx = bodyXY[2 * j], by = bodyXY[2 * j + 1];
      ch.pin.position.set(bx, yl, -by);
      ch.pin.scale.y = -yl;
    }
  }

  return {
    group, update,
    dispose() { for (const g of geos) g.dispose(); },
  };
}
