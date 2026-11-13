// La pièce : un cyclorama de révolution (sol, gorge, mur), une baie ou un
// paravent lumineux selon l'humeur. Le décor est neutre : il porte les ombres
// projetées des lanternes, rien d'autre.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, positionWorld, positionGeometry, mix, smoothstep, abs, fract, floor, max, min, step, length, color } from 'three/tsl';
import { noise, fbm, stableVelocity } from '../../../shared/scene/materials.js';

const TAU = Math.PI * 2;
export const ROOM = { Rw: 3.0, rc: 0.8, Hw: 4.5, off: 0.8 };

export function buildRoomGeometry() {
  const { Rw, rc, Hw } = ROOM;
  const prof = []; // (r, y, nr, ny) normales vers l'intérieur
  for (let i = 0; i <= 24; i++) { const r = ((Rw - rc) * i) / 24; prof.push([r, 0, 0, 1]); }
  for (let i = 1; i <= 16; i++) { const a = (Math.PI / 2) * (i / 16); prof.push([Rw - rc + rc * Math.sin(a), rc - rc * Math.cos(a), -Math.sin(a), Math.cos(a)]); }
  for (let i = 1; i <= 16; i++) { const y = rc + ((Hw - rc) * i) / 16; prof.push([Rw, y, -1, 0]); }
  const M = 160, pos = [], nor = [], idx = [];
  for (const [r, y, nr, ny] of prof) for (let k = 0; k <= M; k++) { const a = (k / M) * TAU; pos.push(r * Math.cos(a), y, r * Math.sin(a)); nor.push(nr * Math.cos(a), ny, nr * Math.sin(a)); }
  const W = M + 1;
  for (let j = 0; j + 1 < prof.length; j++) for (let k = 0; k < M; k++) { const a = j * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function roomUniforms() {
  return {
    wall: uniform(new THREE.Color('#888888')), floor: uniform(new THREE.Color('#666666')),
    wallRough: uniform(0.9), floorRough: uniform(0.8), tiles: uniform(0), concrete: uniform(0),
  };
}

export function roomMaterial(U) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
  const p = positionWorld;
  const onFloor = smoothstep(0.35, 0.05, p.y); // (sol, puis la gorge se fond dans le mur)
  const g = fbm(p.mul(1.7), 3).mul(0.5).add(0.5);
  const fine = noise(p.mul(37)).mul(0.5).add(0.5);
  // tomettes (sol de la magnanerie) : hexagones de 16 cm, joints clairs
  const q = p.xz.div(0.16);
  const hx = abs(fract(q.x.add(floor(q.y).mul(0.5))).sub(0.5)), hy = abs(fract(q.y).sub(0.5));
  const joint = smoothstep(0.43, 0.47, max(hx, hy)).mul(U.tiles).mul(onFloor);
  const tileTone = noise(vec3(floor(q.x.add(floor(q.y).mul(0.5))), floor(q.y), 3.3)).mul(0.12).mul(U.tiles);
  const base = mix(U.wall, U.floor, onFloor);
  const conc = fbm(p.mul(vec3(6, 6, 6)), 3).mul(0.14).mul(U.concrete);
  const c = base.mul(g.mul(0.08).add(0.96)).mul(fine.mul(0.04).add(0.98)).mul(tileTone.add(1)).mul(conc.add(1)).mul(joint.mul(0.25).add(1));
  m.colorNode = c;
  m.roughnessNode = mix(U.wallRough, U.floorRough, onFloor).add(fine.mul(0.05)).sub(joint.mul(0.1));
  m.metalnessNode = float(0);
  m.mrtNode = stableVelocity();
  return m;
}

// baie (heure bleue) ou paravent (shōji) : un panneau lumineux à croisillons,
// posé contre le mur, face à la caméra
export function buildPanel() {
  const g = new THREE.PlaneGeometry(3.2, 2.9, 1, 1);
  return g;
}
export function panelMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const uv = positionGeometry.xy.add(vec3(1.6, 1.45, 0).xy);
  // croisillons : 4 × 3 grands carreaux (baie) ou 6 × 8 petits (shōji)
  const cells = mix(vec3(4, 3, 0).xy, vec3(7, 9, 0).xy, U.shoji);
  const f = uv.div(vec3(3.2, 2.9, 0).xy).mul(cells);
  const bar = mix(float(0.035), float(0.05), U.shoji);
  const d = abs(fract(f).sub(0.5));
  const lattice = smoothstep(float(0.5).sub(bar), float(0.5).sub(bar).add(0.004), max(d.x, d.y));
  const frame = step(0.04, uv.x).mul(step(uv.x, 3.16)).mul(step(0.04, uv.y)).mul(step(uv.y, 2.86));
  const grad = mix(float(1.15), float(0.8), uv.y.div(2.9)).mul(mix(float(1), noise(vec3(uv.mul(6), 1)).mul(0.08).add(0.96), U.shoji));
  const lit = U.panel.mul(grad).mul(frame).mul(lattice.oneMinus());
  m.colorNode = vec4(lit.add(U.frameColor.mul(lattice.max(frame.oneMinus()))), 1);
  m.mrtNode = stableVelocity();
  return m;
}
