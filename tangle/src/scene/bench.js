// Le banc à l'écran : chaque corps du banc (bâti, mandrin, poulie du moteur,
// roue-programme, poussoir, glissière, balancier) en un ou plusieurs maillages
// (un par matière), placés et animés d'après l'état de la machine. La courroie
// ronde est construite ici (petite) ; son agrafe court le long du trajet.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { S, TABLE, GEO } from '../gen/bench.js';
import { Buffers, tube, roundedBox, EDGE, OUT } from '../../../shared/gen/mesh.js';

const TAU = Math.PI * 2;
export const Y0 = TABLE * S; // (hauteur, dans la scène, du mandrin : l'origine de la simulation)

function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });

// la courroie : deux brins tangents et deux arcs (plan horizontal y = pulleyY)
function beltPath() {
  const R1 = GEO.pulleyR - 0.004, R2 = GEO.motorR - 0.002, d = -GEO.motorX; // (centres : 0 et motorX ; gorges)
  const a = Math.asin((R1 - R2) / d); // (angle des brins tangents)
  const pts = [];
  const arc = (cx, r, a0, a1, n) => { for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(t), GEO.pulleyY, r * Math.sin(t)]); } };
  // grande poulie : côté +x ; petite : côté −x
  arc(0, R1, -(Math.PI / 2 + a), Math.PI / 2 + a, 64);
  arc(GEO.motorX, R2, Math.PI / 2 + a, 3 * Math.PI / 2 - a, 24);
  pts.push(pts[0]);
  // longueurs cumulées
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  return { pts, len, total: len[len.length - 1], R1 };
}

export function createBench(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const bodies = {}, meshes = [];
  let R = null, pending = 0;
  const belt = beltPath();
  const staple = new THREE.Group();

  // maillage d'un corps et d'une matière
  function addMesh(body, role, o, finish) {
    const M = { seedOff: uniform(new THREE.Vector3(meshes.length * 1.37, 2.11, 0.5)) };
    const U = finishU(finish);
    const mesh = new THREE.Mesh(toGeometry(o), buildPieceMaterial(finish, U, M));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData = { role, finish, U, M, key: signature(finish) };
    bodies[body].add(mesh);
    meshes.push(mesh);
  }
  // matière d'un maillage : rôle (fonte, métal, accent) et corps
  const roleFinish = (body, role) => {
    const B = R.bench;
    if (role === 'frame') return B.frame;
    if (role === 'metal') return B.metal;
    if (role === 'belt') return B.belt;
    if (body === 'fly') return B.arm;            // (bras et tige du balancier)
    if (body === 'frame') return B.copper;       // (bobinage du moteur)
    if (body === 'wheel') return B.dial;         // (cadran émaillé)
    return B.accent;                             // (rayons de la poulie)
  };

  function setRecipe(recipe, gen) {
    R = recipe;
    for (const m of meshes) { m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
    meshes.length = 0;
    for (const k of Object.keys(bodies)) root.remove(bodies[k]);
    for (const k of ['frame', 'chuck', 'motor', 'wheel', 'rail', 'push', 'fly', 'belt']) { bodies[k] = new THREE.Group(); root.add(bodies[k]); }
    pending = 1;
    const v = (setRecipe.v = (setRecipe.v || 0) + 1);
    return gen.request({ cycles: R.cycles }, 'bench').then((B) => {
      if (v !== setRecipe.v) return;
      for (const [body, parts] of Object.entries(B)) for (const [role, o] of Object.entries(parts)) addMesh(body, role, o, roleFinish(body, role));
      buildBelt();
      pending = 0;
    });
  }

  function buildBelt() {
    const Bf = new Buffers();
    const pts = belt.pts.map((p) => [p[0] * S, p[1] * S, p[2] * S]);
    tube(Bf, pts, 0.0032 * S, 10, OUT, false);
    addMesh('belt', 'belt', Bf.out(), R.bench.belt);
    // agrafe de la courroie (elle montre que la courroie avance)
    const Bs = new Buffers();
    roundedBox(Bs, [0, 0, 0], [0.006 * S, 0.0042 * S, 0.0042 * S], 0.0015 * S, 6, EDGE, OUT);
    addMesh('belt', 'metal', Bs.out(), R.bench.metal);
    const st = meshes[meshes.length - 1];
    bodies.belt.remove(st);
    staple.clear(); staple.add(st);
    bodies.belt.add(staple);
  }

  // retouche d'une matière depuis le panneau : uniformes, ou nouveau matériau
  function syncFinishes() {
    for (const m of meshes) {
      const { finish, U, M } = m.userData;
      if (signature(finish) !== m.userData.key) { m.material.dispose(); m.material = buildPieceMaterial(finish, U, M); m.userData.key = signature(finish); }
      else { applyFinish(U.outer, finish.outer); applyFinish(U.inner, finish.inner); applyFinish(U.edge, finish.edge); U.wear.value = finish.wear; }
    }
  }

  // état : { theta, bar (0 fermée … 1 écartée), flyY (m, repère de la simulation), flyPhi, N (tours par boucle) }
  function update(s) {
    if (!R || pending) return;
    const g = GEO;
    root.position.set(0, 0, 0);
    bodies.frame.position.set(0, Y0, 0);
    bodies.chuck.position.set(0, Y0, 0);
    bodies.chuck.rotation.set(0, s.theta, 0);
    bodies.motor.position.set(g.motorX * S, Y0, 0);
    bodies.motor.rotation.set(0, s.theta * (g.pulleyR / g.motorR), 0);
    bodies.wheel.position.set(g.wheel.x * S, Y0 + g.wheel.y * S, g.wheel.z * S);
    bodies.wheel.rotation.set(0, 0, s.theta / s.N);
    bodies.push.position.set(g.push.x * S, Y0 - g.push.travel * S * s.bar, 0);
    bodies.rail.position.set(g.rail.x * S, Y0 + g.rail.pivotY * S, g.rail.z * S);
    bodies.rail.rotation.set(0, 0, g.rail.maxAngle * s.bar);
    bodies.fly.position.set(0, Y0 + s.flyY * S, 0);
    bodies.fly.rotation.set(0, s.flyPhi, 0);
    bodies.belt.position.set(0, Y0, 0);
    // agrafe : avance avec la gorge de la poulie (θ·R1), arrondie à un nombre
    // entier de tours de courroie par boucle (sinon elle sauterait au raccord ;
    // l'écart, quelques pour cent, est un glissement invisible)
    const laps = Math.max(1, Math.round((2 * Math.PI * s.N * belt.R1) / belt.total));
    const d = (((s.theta / (2 * Math.PI * s.N)) * laps * belt.total) % belt.total + belt.total) % belt.total;
    let i = 1;
    while (i < belt.len.length - 1 && belt.len[i] < d) i++;
    const f = (d - belt.len[i - 1]) / (belt.len[i] - belt.len[i - 1] || 1), a = belt.pts[i - 1], b = belt.pts[i];
    staple.position.set((a[0] + (b[0] - a[0]) * f) * S, a[1] * S, (a[2] + (b[2] - a[2]) * f) * S);
    staple.rotation.set(0, -Math.atan2(b[2] - a[2], b[0] - a[0]), 0);
  }

  return { root, setRecipe, update, syncFinishes, ready: () => pending === 0, meshes, bodies };
}
