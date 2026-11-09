// Poussière d'or : des paillettes métalliques en suspension dans le nid,
// éclairées par le cœur et par la lampe, et prises dans leurs ombres — elles ne
// brillent que dans les rayons qui filtrent à travers les ajours, et
// scintillent en tournant.
//
// Comme les coquilles, la poussière vit à profondeur relative x : une paillette
// de profondeur propre xp est à x = xp − τ (ramené dans une période P, multiple
// du nombre de couches N), au rayon D·kˣ, avec une taille proportionnelle à ce
// rayon. La plongée l'entraîne donc avec le reste, et la boucle reste parfaite.
// Le calcul est fait dans le vertex shader (positions précédentes comprises,
// pour les vecteurs vitesse).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec3, vec4, mod, pow, sin, cos, cross, dot, normalize, smoothstep, fract,
  positionGeometry, positionWorld, normalLocal, positionPrevious, instancedBufferAttribute,
} from 'three/tsl';
import { createRng } from '../rng.js';
import { G, stableVelocity } from './materials.js';
import { MAIN, X_MIN } from './nest.js';

const TAU = Math.PI * 2;
const MAX = 6000;
// mobile : quatre fois moins de paillettes, un peu plus grandes (la même
// impression de poudre d'or, au quart du coût en sommets et en surdessin)
const LITE_COUNT = 0.25, LITE_SIZE = 1.35;

// paillette : octaèdre aplati
function flake() {
  const g = new THREE.OctahedronGeometry(1, 0);
  g.scale(1, 0.25, 0.8);
  g.computeVertexNormals();
  return g;
}

export function createDust(scene, { lite = false } = {}) {
  const rng = createRng('hollow-dust');
  // par paillette : direction (hors du cône de passage de la caméra), profondeur
  // propre (fraction de période), tirage (taille, vitesse de rotation, axe)
  const A = new Float32Array(MAX * 4), B = new Float32Array(MAX * 4);
  for (let i = 0; i < MAX; i++) {
    let d;
    do d = rng.dir(); while (d[2] > Math.cos(0.45));
    A.set([d[0], d[1], d[2], rng.next()], i * 4);
    B.set([rng.next(), rng.int(1, 3) * rng.sign(), rng.next(), rng.next()], i * 4);
  }
  const a = instancedBufferAttribute(new THREE.InstancedBufferAttribute(A, 4));
  const b = instancedBufferAttribute(new THREE.InstancedBufferAttribute(B, 4));

  const U = {
    tau: uniform(0), tauPrev: uniform(0), ratio: uniform(0.62), period: uniform(10), xMax: uniform(6),
    size: uniform(1), color: uniform(new THREE.Color('#e8c27a')),
  };
  const xMin = X_MIN + 0.2;

  // position d'une paillette pour une avancée τ donnée
  const place = (tau, withNormal) => {
    const x = mod(a.w.mul(U.period).sub(tau).sub(xMin), U.period).add(xMin);
    const r = G.D.mul(pow(U.ratio, x));
    // fondu aux deux bouts (derrière la caméra, au cœur) et dans le cœur
    const fade = smoothstep(xMin, xMin + 0.6, x).mul(smoothstep(U.xMax, U.xMax.sub(0.8), x)).mul(smoothstep(G.coreR.mul(1.2), G.coreR.mul(2), r));
    const s = r.mul(0.006).mul(b.x.mul(0.8).add(0.4)).mul(U.size).mul(fade);
    // rotation : un nombre entier de tours par boucle autour d'un axe propre
    const th = G.phase.mul(b.y).add(b.z).mul(TAU);
    const ax = normalize(vec3(sin(b.w.mul(17.3)), cos(b.w.mul(31.7)), sin(b.w.mul(9.1).add(1.3))));
    const c = cos(th), sn = sin(th);
    const rot = (v) => v.mul(c).add(cross(ax, v).mul(sn)).add(ax.mul(dot(ax, v)).mul(c.oneMinus()));
    if (withNormal) normalLocal.assign(rot(normalLocal));
    // (une légère dérive radiale : pas de paillettes alignées sur les coquilles)
    const jitter = fract(b.x.mul(7.13)).sub(0.5).mul(0.35);
    return a.xyz.mul(r.mul(jitter.add(1))).add(rot(positionGeometry).mul(s));
  };

  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec4(U.color, 1);
  // (un peu de diffus : une paillette éclairée se voit sous tous les angles ;
  // le métal donne les éclats quand une facette renvoie le cœur)
  m.metalnessNode = float(0.75);
  m.roughnessNode = float(0.35);
  m.positionNode = Fn(() => {
    if (!lite) positionPrevious.assign(place(U.tauPrev, false)); // (sans vecteurs vitesse en mobile)
    return place(U.tau, true);
  })();
  // près du cœur, les paillettes rougeoient dans son halo
  m.emissiveNode = G.coreColor.mul(U.color).mul(G.coreGlow).mul(G.coreR.mul(G.coreR).div(positionWorld.dot(positionWorld)).mul(0.08));
  m.mrtNode = stableVelocity();

  const mesh = new THREE.InstancedMesh(flake(), m, MAX);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.layers.mask = MAIN;
  mesh.count = 0;
  scene.add(mesh);

  let last = null;
  return {
    mesh, U,
    // s : { tau, N, ratio, xMax } ; R.dust : { amount, size, color }
    update(s, dust) {
      mesh.count = Math.round(MAX * (lite ? LITE_COUNT : 1) * Math.min(1, Math.max(0, dust?.amount ?? 0)));
      mesh.visible = mesh.count > 0;
      U.tauPrev.value = last ?? s.tau;
      U.tau.value = s.tau;
      last = s.tau;
      U.ratio.value = s.ratio;
      U.period.value = s.N * Math.ceil((s.xMax - xMin) / s.N);
      U.xMax.value = s.xMax;
      U.size.value = (dust?.size ?? 1) * (lite ? LITE_SIZE : 1);
      U.color.value.set(dust?.color ?? '#e8c27a');
    },
    // (saut dans la boucle : pas de vecteur vitesse)
    reset() { last = null; },
  };
}

