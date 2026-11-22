// Le décor : la poutre de chêne qui porte le nid et le mur de chaux derrière.
// Matières calculées (aucune texture téléchargée) : le chêne par ses cernes,
// ses rayons médullaires et ses fentes de séchage ; la chaux par son voile et
// ses coups de taloche.
import * as THREE from 'three/webgpu';
import {
  positionGeometry, normalViewGeometry, faceDirection, vec3, vec4, float, length, fract, abs, smoothstep, mix, uniform, fwidth, sin, vec2,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, stableVelocity } from '../../../shared/scene/materials.js';
import { Buffers, roundedBox, OUT, EDGE } from '../../../shared/gen/mesh.js';

const fadeOf = (p, s) => smoothstep(0.5, 0.15, length(fwidth(p)).mul(s));

function geo(B) {
  const o = B.out(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}

// chêne altéré : gris d'argent, cernes, fentes de séchage le long du fil (axe x)
export function oakMaterial(U) {
  const p = positionGeometry;
  // cernes : arcs larges (débit sur quartier), ondulés lentement le long du fil
  const q = p.add(vec3(0, fbm(p.mul(vec3(0.05, 0.9, 0.9)), 3).mul(0.015), fbm(p.mul(vec3(0.05, 0.8, 0.8)).add(4), 3).mul(0.015)));
  const r = length(q.yz.sub(vec2(9.5, -7.0))).mul(18);
  const fr = fadeOf(p, 18);
  const ring = sin(r.mul(2 * Math.PI)).mul(0.5).add(0.5).pow(3).mul(fr); // (bois d'été : bande fine, sombre)
  // fibres : traînées longues le long de x, fines en travers
  const fib = noise(p.mul(vec3(0.35, 9, 9)).add(11)).mul(0.6).add(noise(p.mul(vec3(0.9, 22, 22))).mul(0.4).mul(fadeOf(p, 22)));
  // fentes de séchage : rares, longues, fines
  const ck = abs(noise(p.mul(vec3(0.12, 3.5, 3.5)).add(vec3(0, 3, 0))));
  const check = smoothstep(0.012, 0.0, ck).mul(smoothstep(0.35, 0.6, noise2(p.mul(vec3(0.3, 2, 2)).add(9)).mul(0.5).add(0.5)));
  let col = mix(U.wood, U.woodDark, ring.mul(0.18).add(fib.mul(0.25)).add(0.15));
  col = col.mul(fbm(p.mul(vec3(0.3, 2, 2)), 3).mul(0.14).add(1));
  const wash = smoothstep(0.15, 0.55, fbm(p.mul(vec3(0.5, 3, 3)).add(17), 4)).mul(U.wash);
  col = mix(col, U.washColor, wash.mul(fib.mul(0.3).add(0.6)));
  col = col.mul(check.mul(-0.75).add(1));
  // bois altéré : le bois de printemps s'use, le bois d'été reste en relief
  const H = ring.mul(0.0008).add(fib.mul(0.0012)).sub(check.mul(0.006)).add(noise(p.mul(6)).mul(0.002));
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec4(col, 1);
  m.roughnessNode = mix(float(0.74), float(0.9), wash);
  m.metalnessNode = float(0);
  m.normalNode = perturb(H, normalViewGeometry.mul(faceDirection));
  m.sheenNode = vec3(0.06);
  m.sheenRoughnessNode = float(0.6);
  m.mrtNode = stableVelocity();
  return m;
}

// chaux : voile lent, coups de taloche, grain fin
export function limeMaterial(U) {
  const p = positionGeometry;
  const veil = fbm(p.mul(0.35), 4);
  const trowel = abs(noise(p.mul(vec3(1.7, 2.9, 1)).add(vec3(veil.mul(3), 0, 0)))).oneMinus().pow(10).mul(0.5);
  const fine = noise2(p.mul(80)).mul(fadeOf(p, 80));
  const col = U.lime.mul(veil.mul(0.1).add(1)).mul(trowel.mul(-0.05).add(1)).mul(fine.mul(0.03).add(1));
  const H = trowel.mul(0.004).add(veil.mul(0.01)).add(fine.mul(0.0008));
  const m = new THREE.MeshPhysicalNodeMaterial();
  // (dehors : un fond de brume, sans lumière propre — un dégradé du ciel, flou)
  const sky = mix(U.skyLow, U.skyHigh, smoothstep(-6, 10, p.y)).mul(veil.mul(0.06).add(1));
  m.colorNode = vec4(col.mul(U.outdoor.oneMinus()), 1);
  m.emissiveNode = sky.mul(U.outdoor);
  m.roughnessNode = float(0.95);
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(0.25).mul(U.outdoor.oneMinus());
  m.normalNode = perturb(H.mul(U.outdoor.oneMinus()), normalViewGeometry.mul(faceDirection));
  m.mrtNode = stableVelocity();
  return m;
}

// écorce (aubépine, noisetier) : gris-brun, crêtes longitudinales, lenticelles
export function barkMaterial(U) {
  const p = positionGeometry;
  const ridge = abs(noise(p.mul(vec3(0.6, 14, 14)).add(3))).oneMinus().pow(3);
  const len = smoothstep(0.6, 0.85, noise2(p.mul(vec3(9, 28, 28)))).mul(fadeOf(p, 28));
  const lich = smoothstep(0.25, 0.6, fbm(p.mul(2.2).add(11), 3)).mul(U.lichen);
  let col = mix(U.bark, U.barkDark, ridge.mul(0.6)).mul(fbm(p.mul(3), 3).mul(0.15).add(1));
  col = mix(col, vec3(0.62, 0.66, 0.55), lich.mul(0.5)).add(len.mul(0.05));
  const H = ridge.mul(0.004).add(len.mul(0.0008)).add(noise(p.mul(40)).mul(0.0006).mul(fadeOf(p, 40)));
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec4(col, 1);
  m.roughnessNode = float(0.85);
  m.metalnessNode = float(0);
  m.normalNode = perturb(H, normalViewGeometry.mul(faceDirection));
  m.mrtNode = stableVelocity();
  return m;
}

export function createDecor(scene) {
  const U = {
    wood: uniform(new THREE.Color('#8a8479')), woodDark: uniform(new THREE.Color('#4d4740')),
    wash: uniform(0.35), washColor: uniform(new THREE.Color('#d9d6cf')),
    lime: uniform(new THREE.Color('#c9c6bf')),
    outdoor: uniform(0), skyLow: uniform(new THREE.Color('#9aa39a')), skyHigh: uniform(new THREE.Color('#c9cfca')),
    bark: uniform(new THREE.Color('#6d655b')), barkDark: uniform(new THREE.Color('#3b352f')), lichen: uniform(0.3),
  };
  // poutre : 16 × 15 cm, arêtes arrondies (usées), le long de x
  const B = new Buffers();
  roundedBox(B, [0, 0, 0], [9, 0.8, 0.75], 0.05, 6, EDGE, OUT);
  const beam = new THREE.Mesh(geo(B), oakMaterial(U));
  beam.castShadow = beam.receiveShadow = true;
  // mur
  const wallG = new THREE.PlaneGeometry(40, 24, 1, 1);
  const wall = new THREE.Mesh(wallG, limeMaterial(U));
  wall.receiveShadow = true;
  // branche : un rameau légèrement courbe, en travers du cadre, au-dessus du nid
  const branchPts = [];
  for (let i = 0; i <= 40; i++) { const x = -7 + (14 * i) / 40; branchPts.push(new THREE.Vector3(x, 0.035 * x * x * 0.05 + 0.06 * Math.sin(x * 0.9), 0.08 * Math.sin(x * 0.5))); }
  const branchGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(branchPts), 160, 0.2, 24, false);
  const branch = new THREE.Mesh(branchGeo, barkMaterial(U));
  branch.castShadow = branch.receiveShadow = true;
  scene.add(beam, wall, branch);
  function setRecipe(R) {
    const D = R.decor;
    beam.visible = D.support !== 'branch';
    branch.visible = D.support === 'branch';
    beam.position.set(0, D.yBeam + 0.8, 0);
    branch.position.set(0, D.yBeam + 0.2, 0); // (dessous du rameau : là où le nid s'attache)
    wall.position.set(0, 2, -D.wall);
    U.outdoor.value = D.outdoor ? 1 : 0;
    if (D.sky) { U.skyLow.value.set(D.sky[0]); U.skyHigh.value.set(D.sky[1]); }
    U.wood.value.set(D.wood); U.woodDark.value.set(D.woodDark); U.wash.value = D.wash; U.washColor.value.set(D.washColor);
    U.lime.value.set(D.lime);
  }
  return { beam, wall, branch, U, setRecipe };
}
