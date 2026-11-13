// Le sol : un disque qui suit la caméra, dont la matière est calculée dans le
// repère de la marche. Coordonnées (s, n) : s le long du chemin, n en travers.
// En ligne droite, s = x, n = z ; sur un arc (la marche tourne un peu à chaque
// pas), s = R·(angle autour du centre C), n = rayon − R. Tout motif est
// PÉRIODIQUE en s, de période P (le pas de la boucle) : à la fin du film, la
// structure est à la même place sur le même dessin (le bruit est lu dans le
// volume périodique à des fréquences qui font tenir un nombre entier de
// périodes dans P).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, positionWorld, vec2, vec3, vec4, float, floor as tFloor, fract, mod, abs, mix, smoothstep, length, atan, select,
  normalViewGeometry, faceDirection, sin, clamp, max as tmax, min as tmin, fwidth, dot,
} from 'three/tsl';
import { NZ, perturb, stableVelocity } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';
import { FLOORS, floorFreqs, jointSpacing } from '../floors.js';
export { floorFreqs, jointSpacing };

export { FLOORS };

export function createFloorUniforms() {
  return {
    arc: uniform(0), C: uniform(new THREE.Vector2()), Rref: uniform(1), sgn: uniform(1), a0: uniform(0),
    P: uniform(10), kS: uniform(new THREE.Vector4(1, 1, 1, 1)), W: uniform(1), Lj: uniform(8),
    c1: uniform(new THREE.Color()), c2: uniform(new THREE.Color()), c3: uniform(new THREE.Color()), rough: uniform(0.6), relief: uniform(1),
  };
}

const TAU = Math.PI * 2;
const hash21 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

export function buildFloorMaterial(type, U) {
  const F = FLOORS[type];
  const m = new THREE.MeshPhysicalNodeMaterial();
  // coordonnées de la marche
  const sn = Fn(() => {
    const p = positionWorld.xz;
    const d = p.sub(U.C), r = length(d), a = atan(d.y, d.x).sub(U.a0);
    const aw = a.sub(tFloor(a.div(TAU).add(0.5)).mul(TAU));
    const arcSN = vec2(aw.mul(U.Rref).mul(U.sgn), r.sub(U.Rref));
    return select(U.arc.greaterThan(0.5), arcSN, p);
  })().toVar('floorSN');
  const s = sn.x, n = sn.y;
  // bruit périodique en s (période P), libre en n
  // (n entre aussi dans la 3e coordonnée, en pente irrationnelle : le volume,
  //  périodique sur chaque axe, ne se répète plus en travers)
  const nz = (k, fn, z = 0) => NZ(vec3(s.mul(k), n.mul(fn), n.mul(fn * 0.6180339).add(s.mul(k)).add(z)));
  const pf = fwidth(s).add(fwidth(n)); // (empreinte du pixel, pour effacer les traits fins au loin)
  const fade = (w) => smoothstep(w.mul(2.5), w.mul(0.6), pf); // (un trait de largeur w disparaît sous le pixel)

  let color, rough, h;
  const c1 = vec3(U.c1), c2 = vec3(U.c2), c3 = vec3(U.c3);
  if (F.kind === 'planks') {
    const row = tFloor(n.div(U.W)), fn = fract(n.div(U.W));
    const off = hash21(vec2(row, 3.1)).mul(U.Lj);
    const sl = mod(s.add(off), U.Lj), seg = tFloor(s.add(off).div(U.Lj));
    const segId = mod(seg, U.P.div(U.Lj).add(0.5).floor()); // (périodique)
    const tone = hash21(vec2(row, segId)).sub(0.5);
    // fil du bois : traînées longues le long de s
    const grain = nz(U.kS.y, 18, row.mul(1.7)).x.mul(0.5).add(nz(U.kS.z, 32, row.mul(2.3)).x.mul(0.2));
    const figure = smoothstep(-0.2, 0.6, grain);
    const gap = 0.012;
    const joint = tmax(smoothstep(gap * 2.2, gap * 0.6, tmin(fn, fn.oneMinus()).mul(U.W)), smoothstep(gap * 2.2, gap * 0.6, tmin(sl, U.Lj.sub(sl)))).mul(fade(float(gap)));
    color = mix(c1, c2, figure.mul(0.7)).mul(tone.mul(0.18).add(1));
    if (F.worn) {
      // peinture usée : le bois paraît aux arêtes et aux passages
      // (le bois paraît par traînées étroites, le long des lames, là où l'on passe)
      const wear = smoothstep(0.55, 0.85, nz(U.kS.x, 5, row.mul(1.3).add(5)).x.mul(0.5).add(0.5)).mul(smoothstep(0.2, 0.6, nz(U.kS.y, 0.8, 2).y.mul(0.5).add(0.5)));
      color = mix(color, vec3(0.26, 0.2, 0.15), wear.mul(0.22));
    }
    color = mix(color, c3, joint);
    rough = float(U.rough).add(figure.mul(0.08)).sub(joint.mul(0.1));
    h = joint.negate().mul(1.5).add(grain.mul(0.25));
  } else if (F.kind === 'tiles' || F.kind === 'slabs') {
    const row = tFloor(n.div(U.W)), fn = fract(n.div(U.W));
    const sl = mod(s, U.Lj), seg = mod(tFloor(s.div(U.Lj)), U.P.div(U.Lj).add(0.5).floor());
    const tone = hash21(vec2(row, seg)).sub(0.5);
    const gap = F.kind === 'tiles' ? 0.01 : 0.008;
    const joint = tmax(smoothstep(gap * 2.5, gap * 0.5, tmin(fn, fn.oneMinus()).mul(U.W)), smoothstep(gap * 2.5, gap * 0.5, tmin(sl, U.Lj.sub(sl)))).mul(fade(float(gap)));
    const mott = nz(U.kS.x, 0.35, 1.3).x.mul(0.6).add(nz(U.kS.y, 1.6, 2.1).x.mul(0.3));
    const fine = nz(U.kS.w, 28, 3.7).x;
    color = mix(c1, c2, smoothstep(-0.7, 0.9, mott).mul(F.kind === 'tiles' ? 1 : 0.55)).mul(tone.mul(F.kind === 'tiles' ? 0.14 : 0.06).add(1));
    if (F.kind === 'tiles') {
      // micas : quelques paillettes qui accrochent la lumière (rugosité plus basse)
      const mica = smoothstep(0.82, 0.95, nz(U.kS.w, 28, 7.7).y.mul(0.5).add(0.5)).mul(smoothstep(0.1, 0.5, nz(U.kS.y, 1.6, 3.3).y));
      rough = float(U.rough).sub(mica.mul(0.25));
      h = mott.mul(0.8).add(fine.mul(0.15)).sub(joint.mul(1.2));
    } else {
      const pores = smoothstep(0.62, 0.8, fine.mul(0.5).add(0.5));
      color = color.mul(pores.mul(-0.25).add(1));
      rough = float(U.rough).add(mott.mul(0.06));
      h = mott.mul(0.3).sub(pores.mul(0.4)).sub(joint.mul(1));
    }
    color = mix(color, c3, joint);
    if (F.wet) {
      // flaques : rugosité basse et teinte plus sombre là où l'eau reste
      // (des flaques rares aux bords doux : l'eau reste dans les creux de la dalle)
      const puddle = smoothstep(0.28, 0.62, nz(U.kS.x, 0.22, 8.1).x.add(nz(U.kS.y, 1.2, 4.4).x.mul(0.15)));
      rough = mix(rough, float(0.08), puddle);
      color = color.mul(mix(float(1), float(0.75), puddle));
      h = h.mul(puddle.oneMinus());
    }
  } else if (F.kind === 'brick') {
    const row = tFloor(n.div(U.W)), fn = fract(n.div(U.W));
    const off = mod(row, 2).mul(0.5).mul(U.Lj);
    const sl = mod(s.add(off), U.Lj), seg = mod(tFloor(s.add(off).div(U.Lj)), U.P.div(U.Lj).add(0.5).floor());
    const tone = hash21(vec2(row, seg)).sub(0.5);
    const gap = 0.05;
    const mortar = tmax(smoothstep(gap, gap * 0.55, tmin(fn, fn.oneMinus()).mul(U.W)), smoothstep(gap, gap * 0.55, tmin(sl, U.Lj.sub(sl))));
    const tex = nz(U.kS.z, 7, row).x, speck = nz(U.kS.w, 28, row.add(3)).x;
    const burnt = smoothstep(0.2, 0.8, nz(U.kS.y, 1.6, row.mul(0.7)).x.mul(0.5).add(0.5));
    color = mix(c1, c2, burnt.mul(0.8)).mul(tone.mul(0.24).add(1)).mul(speck.mul(0.08).add(1));
    color = mix(color, c3.mul(nz(U.kS.w, 28, 9).x.mul(0.1).add(1)), mortar);
    rough = float(U.rough).add(tex.mul(0.05));
    // briques bombées, joints creux
    const bulge = smoothstep(0, 0.25, tmin(fn, fn.oneMinus())).mul(smoothstep(0, 0.4, tmin(sl, U.Lj.sub(sl))));
    h = bulge.mul(0.8).add(tex.mul(0.2)).sub(mortar.mul(1.4));
  } else {
    // linoléum moucheté : un semis sur une grille hachée (période entière en s)
    const cs = U.kS.w.mul(0.25); // (cellules par unité le long de s, entières par période)
    const cell = vec2(tFloor(s.mul(cs.mul(4))), tFloor(n.mul(28)));
    const cellW = vec2(mod(cell.x, U.P.mul(cs.mul(4)).add(0.5).floor()), cell.y);
    const jit = vec2(hash21(cellW), hash21(cellW.add(17.3)));
    const local = vec2(fract(s.mul(cs.mul(4))), fract(n.mul(28)));
    const dd = length(local.sub(jit.mul(0.7).add(0.15)));
    const keep = hash21(cellW.add(5.1));
    const dotA = smoothstep(0.24, 0.12, dd).mul(smoothstep(0.55, 0.6, keep)).mul(fade(float(0.01)));
    const dotB = smoothstep(0.2, 0.1, dd).mul(smoothstep(0.92, 0.95, keep)).mul(fade(float(0.01)));
    const mott = nz(U.kS.x, 0.35, 2).x;
    color = mix(c1.mul(mott.mul(0.05).add(1)), c2, dotA.mul(0.7));
    color = mix(color, c3, dotB.mul(0.8));
    rough = float(U.rough).add(mott.mul(0.04));
    h = mott.mul(0.1);
  }
  m.colorNode = vec4(clamp(color, 0, 1), 1);
  m.roughnessNode = clamp(rough, 0.04, 1).mul(G.roughFloor.mul(0).add(1));
  m.metalnessNode = float(0);
  const N0 = normalViewGeometry.mul(faceDirection);
  m.normalNode = perturb(h.mul(0.004).mul(U.relief).mul(G.microDetail), N0);
  m.mrtNode = stableVelocity();
  return m;
}

export function floorGeometry(R = 70) {
  const g = new THREE.CircleGeometry(R, 128).rotateX(-Math.PI / 2);
  const n = g.attributes.position.count;
  const surf = new Uint8Array(n * 4), tan = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { surf[i * 4] = 255; tan[i * 4] = 1; tan[i * 4 + 3] = 1; }
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
  g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  return g;
}
