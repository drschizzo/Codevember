// Le décor : un cyclorama (le sol se courbe en paroi derrière la pièce : pas
// d'horizon) et la matière du sol propre à chaque humeur — béton lissé,
// époxy clair, tôle larmée, dalles, tôle d'usine, ardoise. Le sol mouille
// sous les averses (il fonce, l'eau reste dans les creux et luit). Le motif
// s'efface en montant sur la paroi, qui reste un fond neutre.
//
// Et les matières des accessoires : chêne des cales, acier peint des
// supports, peinture, acier nu et caoutchouc des machines.
import * as THREE from 'three/webgpu';
import {
  uniform, attribute, positionGeometry, positionWorld, normalGeometry, normalViewGeometry, color, vec2, vec3, vec4, float,
  mix, smoothstep, clamp, abs, max, min, floor, fract, sin, cos, length, dot, normalize, fwidth, step,
} from 'three/tsl';
import { fbm, noise, worley, perturb, NZ, stableVelocity } from './materials.js';

const ss = smoothstep;

// ── Cyclorama ────────────────────────────────────────────────────────────────
// grille : u le long de la largeur, v du devant (sol) vers le haut de la
// paroi ; profil : sol plat jusqu'à zw, gorge de rayon rc, paroi verticale
export function cycloGeometry({ width = 16, front = 8, zw = -2.6, rc = 2.2, height = 9, nu = 160, nv = 120 } = {}) {
  const prof = [];
  const flat = front - zw, arc = (Math.PI / 2) * rc, wall = height - rc, total = flat + arc + wall;
  for (let j = 0; j <= nv; j++) {
    const s = (j / nv) ** 1.0 * total;
    if (s <= flat) prof.push([front - s, 0, 0, 1]);
    else if (s <= flat + arc) { const a = (s - flat) / rc; prof.push([zw - rc * Math.sin(a), rc - rc * Math.cos(a), Math.sin(a), Math.cos(a)]); }
    else prof.push([zw - rc, rc + (s - flat - arc), 1, 0]);
  }
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), surf = new Uint8Array(n * 4), tan = new Float32Array(n * 4);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const k = j * (nu + 1) + i, x = (i / nu - 0.5) * width;
    const [z, y, nz, ny] = prof[j];
    pos.set([x, y, z], k * 3); nor.set([0, ny, nz], k * 3); surf.set([255, 0, 0, 128], k * 4); tan.set([1, 0, 0, 1], k * 4);
  }
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(surf, 4, true));
  g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  g.setIndex(idx);
  // (les sommets du sol plat sont rangés au début : la normale indique la paroi)
  return g;
}

export function floorUniforms() {
  return { tone: uniform(new THREE.Color('#888')), wall: uniform(new THREE.Color('#888')), wet: uniform(0), puddle: uniform(0), pit: uniform(new THREE.Vector4(1e3, 1e3, 1e3, 1e3)) };
}

// sol : kind ∈ beton, epoxy, larmee, dalle, tole, ardoise
export function floorMaterial(kind, U) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry; // (repère du cyclorama : y = hauteur)
  const onFloor = ss(0.35, 0.05, p.y); // (le motif s'efface sur la paroi)
  const x = p.x, z = p.z;
  const q = vec3(x, 0, z);
  const pf = fwidth(x).add(fwidth(z));
  const aa = (f) => ss(0.5, 0.15, pf.mul(f)); // fréquence (cycles / m) → atténuation
  const big = fbm(q.mul(0.6), 3), mid = fbm(q.mul(3.1), 3), fine = noise(q.mul(40));
  let col = vec3(U.tone), rough = float(0.8), metal = float(0), H = float(0);
  if (kind === 'beton') {
    col = col.mul(big.mul(0.22).add(1)).mul(mid.mul(0.12).add(1)).mul(fine.mul(0.06).mul(aa(40)).add(1));
    rough = float(0.72).add(mid.mul(0.12));
    // joints sciés tous les 3 m
    const j = min(abs(fract(x.div(3).add(0.5)).sub(0.5)), abs(fract(z.div(3).add(0.5)).sub(0.5))).mul(3);
    const joint = ss(0.006, 0.002, j).mul(aa(6));
    col = col.mul(float(1).sub(joint.mul(0.5)));
    H = joint.mul(-0.002).add(fine.mul(0.00015));
  } else if (kind === 'epoxy') {
    col = col.mul(big.mul(0.06).add(1));
    rough = float(0.36).add(mid.mul(0.06));
    H = noise(q.mul(60)).mul(0.00004);
  } else if (kind === 'larmee') {
    // tôle larmée : losanges en relief, alternés en chevrons, sommets usés
    const s = 0.032, gx = x.div(s), gz = z.div(s);
    const cell = floor(gx).add(floor(gz));
    const fx = fract(gx).sub(0.5), fz = fract(gz).sub(0.5);
    const odd = fract(cell.mul(0.5)).mul(2); // (0 / 1 : orientation)
    const a = mix(fx.add(fz), fx.sub(fz), odd).mul(0.7071), b = mix(fx.sub(fz), fx.add(fz), odd).mul(0.7071);
    const lz = length(vec2(a.div(0.42), b.div(0.1)));
    const bump = ss(1.0, 0.75, lz).mul(aa(1 / s));
    col = mix(col.mul(mid.mul(0.15).add(0.85)), col.mul(1.5), bump.mul(0.5));
    metal = bump.mul(0.6).add(0.2);
    rough = mix(float(0.65), float(0.4), bump);
    H = bump.mul(0.0018);
  } else if (kind === 'dalle') {
    const s = 1.2, jx = abs(fract(x.div(s)).sub(0.5)).mul(s), jz = abs(fract(z.div(s)).sub(0.5)).mul(s);
    const joint = ss(0.585, 0.596, max(jx, jz)).mul(aa(1 / s));
    const slabRnd = noise(floor(vec3(x.div(s), 0, z.div(s))).mul(1.7)).mul(0.06);
    col = col.mul(big.mul(0.1).add(1)).mul(mid.mul(0.1).add(1)).mul(slabRnd.add(1)).mul(float(1).sub(joint.mul(0.45)));
    rough = float(0.82).add(mid.mul(0.08));
    H = joint.mul(-0.003).add(fine.mul(0.0002));
  } else if (kind === 'tole') {
    const s = 1.5, jx = abs(fract(x.div(s * 1.6)).sub(0.5)).mul(s * 1.6), jz = abs(fract(z.div(s)).sub(0.5)).mul(s);
    const seam = ss(0.012, 0.004, min(float(s * 0.8).sub(jx), float(s / 2).sub(jz)).abs()).mul(aa(1 / s));
    col = col.mul(big.mul(0.25).add(1)).mul(mid.mul(0.15).add(1));
    metal = float(0.55); rough = float(0.5).add(mid.mul(0.15)).add(big.mul(0.1));
    H = seam.mul(0.0015).add(fine.mul(0.0001));
  } else { // ardoise
    const w = worley(q.mul(1.4));
    const crack = ss(0.05, 0.0, w.y.sub(w.x)).mul(aa(3));
    col = col.mul(big.mul(0.18).add(1)).mul(mid.mul(0.12).add(1)).mul(float(1).sub(crack.mul(0.4)));
    rough = float(0.6).add(mid.mul(0.12));
    H = crack.mul(-0.002).add(fbm(q.mul(18), 2).mul(0.0004));
  }
  // paroi : fond neutre, uni
  col = mix(vec3(U.wall).mul(big.mul(0.05).add(1)), col, onFloor);
  rough = mix(float(0.9), rough, onFloor);
  metal = metal.mul(onFloor);
  H = H.mul(onFloor);
  // eau : le sol fonce, l'eau reste dans les creux et luit
  const puddle = ss(0.05, 0.2, big.add(mid.mul(0.3)).negate().add(U.puddle.mul(0.3))).mul(onFloor);
  const wet = clamp(U.wet.mul(onFloor), 0, 1);
  col = col.mul(mix(float(1), float(0.62), wet));
  rough = mix(rough, mix(float(0.3), float(0.09), puddle), wet); // (flaque : un reflet adouci, pas une tache blanche de miroir)
  H = H.mul(float(1).sub(puddle.mul(wet)));
  m.colorNode = col;
  m.roughnessNode = rough;
  m.metalnessNode = metal;
  m.normalNode = perturb(H, normalViewGeometry);
  // (fosse du bain : le sol s'ouvre)
  const wp = positionWorld;
  const inPit = step(U.pit.x, wp.x).mul(step(wp.x, U.pit.y)).mul(step(U.pit.z, wp.z)).mul(step(wp.z, U.pit.w));
  m.maskNode = inPit.lessThan(0.5);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Accessoires : cales de chêne (OUT) et acier peint (IN) ──────────────────
export function standMaterial(paint = '#3b4148') {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry, s = attribute('surf', 'vec4');
  const wood = s.x;
  // chêne : cernes le long de l'axe principal de la cale, rayons médullaires
  const g = vec3(p.x.mul(9), p.y.mul(70), p.z.mul(70)).add(vec3(fbm(p.mul(3), 2).mul(4), 0, 0));
  // (cernes de 4 à 7 mm, comme un vrai chêne : à 6 cm, ils se lisaient comme
  // un dessin animé ; bois de calage grisé, taché)
  const ring = fract(length(g.yz).mul(2.4).add(fbm(p.mul(6), 2).mul(2.5)));
  const stain = ss(-0.2, 0.4, fbm(p.mul(7).add(2.7), 3));
  const oak = mix(vec3(0.2, 0.13, 0.075), vec3(0.3, 0.21, 0.13), ss(0.15, 0.85, ring)).mul(mix(float(1), float(0.62), stain)).mul(noise(p.mul(200)).mul(0.08).add(0.95)).mul(s.w.mul(0.2).add(0.85));
  const steel = color(new THREE.Color(paint)).mul(fbm(p.mul(8), 2).mul(0.08).add(1));
  m.colorNode = mix(steel, oak, wood);
  m.roughnessNode = mix(float(0.55), float(0.82), wood);
  m.metalnessNode = float(0);
  m.normalNode = perturb(wood.mul(fbm(vec3(p.x.mul(30), p.y.mul(300), p.z.mul(300)), 2).mul(0.0002)), normalViewGeometry);
  m.mrtNode = stableVelocity();
  return m;
}

// ── Machines : peinture (OUT), acier nu ou inox (IN), caoutchouc (EDGE) ──────
export function machineMaterial(paint = '#d9a21b', { clipY = null } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry, s = attribute('surf', 'vec4');
  const P = color(new THREE.Color(paint));
  // peinture industrielle usée : marbrée, éclats qui montrent l'apprêt sombre,
  // coulures de crasse verticales, salie dans le bas ; jamais un jouet neuf
  const dirt = ss(0.9, 0.0, positionWorld.y).mul(0.35);
  const grime = ss(0.0, 0.5, fbm(vec3(p.x.mul(26), p.y.mul(1.8), p.z.mul(26)), 3)).mul(0.28);
  const chip = ss(0.5, 0.56, fbm(p.mul(19).add(3.3), 3).add(noise(p.mul(90)).mul(0.12))).mul(s.x);
  const paintC = mix(P.mul(0.82).mul(fbm(p.mul(5), 2).mul(0.08).add(1)).mul(float(1).sub(dirt)).mul(float(1).sub(grime)), vec3(0.07, 0.065, 0.06), chip);
  const steel = vec3(0.6, 0.6, 0.61).mul(fbm(p.mul(30), 2).mul(0.05).add(1));
  const rubber = vec3(0.025, 0.025, 0.027);
  m.colorNode = paintC.mul(s.x).add(steel.mul(s.y)).add(rubber.mul(s.z));
  m.metalnessNode = s.y;
  m.roughnessNode = s.x.mul(float(0.48).add(dirt).add(grime.mul(0.5)).add(chip.mul(0.2))).add(s.y.mul(0.4)).add(s.z.mul(0.72));
  m.clearcoatNode = s.x.mul(0.12).mul(float(1).sub(chip));
  m.clearcoatRoughnessNode = float(0.25);
  if (clipY !== null) m.maskNode = positionWorld.y.lessThan(clipY);
  m.mrtNode = stableVelocity();
  return m;
}
