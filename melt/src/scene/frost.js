// Les causes du froid, visibles : le givre et la poussière de diamant.
//
// Givre : des aiguilles de glace (prismes hexagonaux effilés, 15–25 µm de
// large, 40–160 µm de long) dressées sur le support — sur la pointe des
// fibres de laine, sur le velours, la feuille, l'ardoise. Elles poussent dès
// que le froid revient et fondent les premières au soleil (elles sont plus
// fines que le cristal) : c'est la même horloge (timeline.js, frost).
//
// Poussière de diamant : de minuscules plaquettes de glace qui tombent dans
// l'air glacé et scintillent ; leur chute est périodique (un nombre entier de
// passages par boucle), leur nombre suit le froid.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, vec3, vec4, float, normalize, cross, mix, smoothstep, fract, sin, cos, positionLocal, normalLocal,
  positionPrevious, max as tmax, clamp, length, abs, dot, normalView, positionViewDirection,
} from 'three/tsl';
import { createRng } from '../rng.js';
import { stableVelocity, isLite } from './materials.js';

// prisme hexagonal effilé, axe +y de 0 à 1, rayon 1 à la base
function needleGeometry() {
  const p = [], n = [], idx = [];
  const sides = 6;
  for (let k = 0; k <= 4; k++) {
    const t = k / 4, r = k < 4 ? 1 - 0.25 * t : 0;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      p.push(Math.cos(a) * r, t, Math.sin(a) * r);
      n.push(Math.cos(a), k === 4 ? 1 : 0.15, Math.sin(a));
    }
  }
  for (let k = 0; k < 4; k++) for (let s = 0; s < sides; s++) {
    const a = k * sides + s, b = k * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

// points : [x, y, z, nx, ny, nz] (surface du support), clear : rayon de
// l'emprise du cristal, laissée libre
export function createFrost(scene, { lite = false } = {}) {
  const U = { frost: uniform(0), frostP: uniform(0), cold: uniform(1), dust: uniform(0), dustP: uniform(0) };
  const group = new THREE.Group();
  scene.add(group);
  let needles = null, dust = null;

  function needleMaterial() {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'); // (position, seuil) ; (direction, longueur)
    const grow = (f) => smoothstep(iA.w, iA.w.add(0.25), f);
    const place = (f) => {
      const d = normalize(iB.xyz), side = normalize(cross(d, vec3(0.31, 0.12, 0.94)));
      const fwd = cross(side, d);
      const L = iB.w.mul(grow(f)), r = float(0.0045).mul(grow(f).sqrt());
      return iA.xyz.add(side.mul(positionLocal.x.mul(r))).add(d.mul(positionLocal.y.mul(L))).add(fwd.mul(positionLocal.z.mul(r)));
    };
    m.positionNode = Fn(() => {
      const d = normalize(iB.xyz), side = normalize(cross(d, vec3(0.31, 0.12, 0.94))), fwd = cross(side, d);
      normalLocal.assign(normalize(side.mul(normalLocal.x).add(d.mul(normalLocal.y)).add(fwd.mul(normalLocal.z))));
      if (!isLite()) positionPrevious.assign(place(U.frostP));
      return place(U.frost);
    })();
    // givre : blanc, un peu translucide, brillant aux arêtes
    m.colorNode = vec4(0.82, 0.86, 0.92, 1);
    m.roughnessNode = float(0.18);
    m.metalnessNode = float(0);
    m.specularIntensityNode = float(1);
    m.iorNode = float(1.31);
    m.mrtNode = stableVelocity();
    return m;
  }

  function dustMaterial() {
    const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
    const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'); // (x, y0, z, phase) ; (axe de rotation, taille)
    const at = (d) => {
      // chute périodique : hauteur 9 mm parcourue un nombre entier de fois
      const fall = fract(iA.w.add(d.mul(3)));
      const y = float(7).sub(fall.mul(9));
      const sway = sin(fall.mul(6.283).mul(2).add(iA.w.mul(40))).mul(0.25);
      // visible seulement pendant le froid ; naît et meurt hors de la vue (en haut, au sol)
      const vis = smoothstep(0, 0.06, fall).mul(smoothstep(1, 0.92, fall)).mul(smoothstep(iB.w.mul(3).sub(0.2), iB.w.mul(3), U.cold));
      const sz = float(0.012).add(iB.w.mul(0.02)).mul(vis);
      const a = fall.mul(30).add(iA.w.mul(10));
      const ax = normalize(iB.xyz);
      const px = positionLocal.mul(sz);
      const rot = px.mul(cos(a)).add(cross(ax, px).mul(sin(a)));
      return vec3(iA.x.add(sway), y, iA.z.add(sway.mul(0.6))).add(rot);
    };
    m.positionNode = Fn(() => {
      if (!isLite()) positionPrevious.assign(at(U.dustP));
      return at(U.dust);
    })();
    // une plaquette ne se voit que quand sa facette renvoie la lumière vers
    // l'objectif : un éclat bref (dans le flou, une pastille de bokeh), sinon rien
    m.colorNode = vec4(0, 0, 0, 1);
    m.roughnessNode = float(0.05);
    m.metalnessNode = float(0);
    m.specularIntensityNode = float(0.4);
    const face = abs(dot(normalView, positionViewDirection));
    m.emissiveNode = vec3(0.85, 0.9, 1).mul(smoothstep(0.86, 0.99, face).mul(6)).mul(U.cold);
    m.transparent = true;
    m.opacityNode = smoothstep(0.7, 0.95, face).mul(U.cold);
    m.mrtNode = stableVelocity();
    return m;
  }

  function setRecipe(R, points, clear) {
    for (const o of [needles, dust]) if (o) { group.remove(o); o.geometry.dispose(); o.material.dispose(); }
    const rng = createRng(`${R.seed}:frost`);
    // ── givre ──
    const g = needleGeometry();
    const n = Math.min(points.length / 6, lite ? 1200 : 3000);
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    let m = 0;
    for (let i = 0; i < points.length / 6 && m < n; i++) {
      const j = Math.floor(rng.next() * (points.length / 6)) * 6;
      const x = points[j], y = points[j + 1], z = points[j + 2];
      if (Math.hypot(x, z) < clear) continue;
      const nr = [points[j + 3] + rng.range(-0.5, 0.5), points[j + 4] + rng.range(0, 0.6), points[j + 5] + rng.range(-0.5, 0.5)];
      A.set([x, y, z, rng.range(0, 0.7)], m * 4);
      B.set([...nr, rng.range(0.018, 0.06)], m * 4);
      m++;
    }
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    g.instanceCount = m;
    needles = new THREE.Mesh(g, needleMaterial());
    needles.frustumCulled = false;
    needles.castShadow = false;
    needles.receiveShadow = true;
    group.add(needles);
    // ── poussière de diamant ──
    const h = new THREE.InstancedBufferGeometry();
    const hex = [];
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2, b = ((s + 1) / 6) * Math.PI * 2;
      hex.push(0, 0, 0, Math.cos(a), 0, Math.sin(a), Math.cos(b), 0, Math.sin(b));
    }
    h.setAttribute('position', new THREE.Float32BufferAttribute(hex, 3));
    h.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: hex.length }, (_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const nd = lite ? 120 : 260;
    const DA = new Float32Array(nd * 4), DB = new Float32Array(nd * 4);
    for (let i = 0; i < nd; i++) {
      const r = 1.5 + 7 * Math.sqrt(rng.next()), a = rng.range(0, Math.PI * 2);
      DA.set([Math.cos(a) * r, 0, Math.sin(a) * r, rng.next()], i * 4);
      DB.set([...rng.dir(), rng.next()], i * 4);
    }
    h.setAttribute('iA', new THREE.InstancedBufferAttribute(DA, 4));
    h.setAttribute('iB', new THREE.InstancedBufferAttribute(DB, 4));
    h.instanceCount = nd;
    dust = new THREE.Mesh(h, dustMaterial());
    dust.frustumCulled = false;
    dust.castShadow = false;
    group.add(dust);
  }

  return {
    group, U, setRecipe,
    update(k, kp, ph, php) {
      U.frost.value = k.frost; U.frostP.value = kp.frost;
      U.cold.value = k.cold;
      U.dust.value = ph; U.dustP.value = php;
    },
  };
}
