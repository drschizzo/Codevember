// La machine : pièces construites dans les workers, rangées en corps rigides
// (bâti fixe, chariot, poulies, maillons), chacun en quelques maillages par
// rôle de matière. update(state) les pose d'après l'état du film (angles
// absolus des maillons, coordonnée imposée) — la même cinématique que les
// tests (gen/pose.js).
import * as THREE from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { buildPieceMaterial, finishUniforms, applyFinish, signature } from './materials.js';
import { pieceFinish } from '../finishes.js';
import { layoutOf, poseOf, thickOf } from '../gen/pose.js';

export function toGeometry(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}

const WOOD = /mahogany|walnut|ebonized|oak/;

// Chronophotographie (Marey) : les poses passées des maillons, en traînée de
// fantômes additifs à pas de temps fixe ; ils s'effacent quand la chaîne ne
// bouge plus (pendant les tenues, une pose répétée ne dit rien).
export const GHOSTS = 10, GHOST_DT = 0.075; // (secondes du film entre deux poses)
function ghostMaterial(k) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.userData.u = uniform(0);
  m.colorNode = vec3(0.85, 0.83, 0.8).mul(m.userData.u);
  m.opacityNode = m.userData.u;
  return m;
}

export function createMachine(gen) {
  const group = new THREE.Group();
  let parts = [], bodies = {}, version = 0, pending = 0, total = 0, M = null, Lay = null, A = null, ghostsOn = false;
  const ghostMats = Array.from({ length: GHOSTS }, (_, k) => ghostMaterial(k));
  const ghostGroups = []; // [k][i] : groupes des maillons fantômes
  const mats = new Map(); // (une matière par rôle : partagée par les pièces du même rôle)

  function material(key, salt) {
    const k = `${key}|${salt}`;
    if (mats.has(k)) return mats.get(k).m;
    const finish = pieceFinish(key);
    const U = { outer: finishUniforms(finish.outer), inner: finishUniforms(finish.inner), edge: finishUniforms(finish.edge), wear: uniform(0) };
    const m = buildPieceMaterial(finish, U, { seedOff: uniform(new THREE.Vector3(salt * 1.37, salt * 0.71 + 2.1, salt * 2.3)) });
    mats.set(k, { m, finish, U, key });
    return m;
  }

  function clear() {
    for (const p of parts) { p.mesh.parent?.remove(p.mesh); p.mesh.geometry.dispose(); }
    parts = [];
    for (const b of Object.values(bodies)) group.remove(b);
    bodies = {};
    for (const { m } of mats.values()) m.dispose();
    mats.clear();
  }

  const body = (name) => {
    if (!bodies[name]) { const g = new THREE.Group(); g.name = name; bodies[name] = g; group.add(g); }
    return bodies[name];
  };

  // une pièce : demandée au worker, placée dans son corps avec la matière du rôle
  function piece(bodyName, role, spec, what, pick = (o) => o, salt = 0, xf = null) {
    const v = version;
    pending++; total++;
    return gen.request(spec, what).then((o) => {
      if (v !== version) return;
      const out = pick(o);
      if (out && out.position?.length) {
        const mesh = new THREE.Mesh(toGeometry(out), material(A[role] ?? role, salt));
        mesh.castShadow = mesh.receiveShadow = true;
        if (xf) xf(mesh);
        body(bodyName).add(mesh);
        parts.push({ mesh, role });
        // fantômes : la même géométrie, sans ombre, dans des groupes à part
        if (ghostsOn && /^link\d$/.test(bodyName) && role !== 'hub') {
          const i = +bodyName.slice(4);
          for (let k = 0; k < GHOSTS; k++) {
            const gm = new THREE.Mesh(mesh.geometry, ghostMats[k]);
            gm.castShadow = gm.receiveShadow = false;
            gm.renderOrder = 10;
            ghostGroups[k][i].add(gm);
          }
        }
      }
      pending--;
      return o;
    }).catch((e) => { console.error(e); pending--; throw e; });
  }

  function setRecipe(R) {
    version++;
    clear();
    pending = 0; total = 0;
    M = R.machine; A = R.accord; Lay = layoutOf(M);
    for (const row of ghostGroups) for (const g of row) group.remove(g);
    ghostGroups.length = 0;
    ghostsOn = !!R.stage.ghosts;
    if (ghostsOn) for (let k = 0; k < GHOSTS; k++) ghostGroups.push(M.links.map(() => { const g = new THREE.Group(); group.add(g); return g; }));
    const wood = WOOD.test(A.base);
    // maillons
    M.links.forEach((L, i) => {
      const spec = { L, dz: Lay.dz[i] };
      piece(`link${i}`, 'link', spec, 'link', (o) => o.body, 10 + i);
      piece(`link${i}`, 'hub', spec, 'link', (o) => o.hub, 20 + i);
      if (L.bob) piece(`link${i}`, 'accent', spec, 'link', (o) => o.bob, 30 + i);
    });
    if (M.family === 'cart') {
      const spec = { M: { rail: M.rail, height: M.height, motorSide: M.motorSide }, wood };
      piece('static', 'base', spec, 'cartBench', (o) => o.parts.base, 1);
      piece('static', 'frame', spec, 'cartBench', (o) => o.parts.frame, 2);
      piece('static', 'guide', spec, 'cartBench', (o) => o.parts.guide, 3);
      piece('static', 'accent', spec, 'cartBench', (o) => o.parts.accent, 4);
      const cs = { M: {}, dz: Lay.z0 };
      piece('carriage', 'frame', cs, 'carriage', (o) => o.body, 5);
      piece('carriage', 'hub', cs, 'carriage', (o) => o.hub, 6);
      const pulX = M.rail.half + 0.13, rodY = M.height - 0.012, by = rodY - 0.035;
      for (const sx of [-1, 1]) {
        piece(`pulley${sx}`, 'guide', { r: 0.022, w: 0.022 }, 'pulley', (o) => o.body, 7);
        piece(`pulley${sx}`, 'accent', { r: 0.022, w: 0.022 }, 'pulley', (o) => o.hub, 8);
        body(`pulley${sx}`).position.set(sx * pulX, by, 0);
      }
      piece('static', 'belt', { X: pulX, r: 0.022, w: 0.016, e: 0.0025 }, 'belt', (o) => o.body, 9, (m) => m.position.set(0, by, 0));
    } else if (M.family === 'rotary') {
      const spec = { M: { height: M.height } };
      piece('static', 'base', spec, 'rotaryBase', (o) => o.base, 1);
      piece('static', 'frame', spec, 'rotaryBase', (o) => o.frame, 2);
      piece('static', 'accent', spec, 'rotaryBase', (o) => o.accent, 3);
      const as = { M: { arm: M.arm }, Lay };
      piece('arm', 'frame', as, 'rotaryArm', (o) => o.arm, 4);
      piece('arm', 'hub', as, 'rotaryArm', (o) => o.hub, 5);
      piece('arm', 'accent', as, 'rotaryArm', (o) => o.accent, 6);
      body('arm').position.set(0, M.height, 0);
    } else if (M.family === 'acrobat') {
      const spec = { M: { height: M.height }, Lay, wood };
      piece('static', 'frame', spec, 'portal', (o) => o.frame, 1);
      piece('static', 'base', spec, 'portal', (o) => o.base, 2);
      piece('static', 'guide', spec, 'portal', (o) => o.guide, 3);
      const zBack = -(thickOf(M.links[0]) / 2 + 0.012);
      const ds = { L0: M.links[0], zBack, at: M.motor.at };
      piece('link0', 'accent', ds, 'acroDrive', (o) => o.accent, 4);
      piece('link0', 'belt', ds, 'acroDrive', (o) => o.belt, 5);
      piece('link0', 'guide', ds, 'acroDrive', (o) => o.guide, 6);
      const es = { re: 0.024, zBack: 0 };
      piece('elbow', 'guide', es, 'elbowPulley', (o) => o.body, 7);
      piece('elbow', 'accent', es, 'elbowPulley', (o) => o.hub, 8);
      body('elbow').userData.z = Lay.z[0] + zBack;
    } else if (M.family === 'wheel') {
      const spec = { M: { height: M.height }, Lay, wood };
      piece('static', 'frame', spec, 'gallows', (o) => o.frame, 1);
      piece('static', 'base', spec, 'gallows', (o) => o.base, 2);
      piece('static', 'hub', spec, 'gallows', (o) => o.hub, 3);
      const n = M.links.length;
      piece(`link${n - 1}`, 'accent', { L: M.links[n - 1], zBack: -(thickOf(M.links[n - 1]) / 2 + 0.004) }, 'wheelMotor', (o) => o, 4);
      piece('wheel', 'accent', { W: M.wheel }, 'flywheel', (o) => o.rim, 5);
      piece('wheel', 'guide', { W: M.wheel }, 'flywheel', (o) => o.hub, 6);
    }
  }

  // état du film → poses
  function update(st) {
    if (!M) return;
    const Q = poseOf(M, st.theta, st.s, Lay);
    M.links.forEach((L, i) => {
      const b = bodies[`link${i}`];
      if (!b) return;
      b.position.set(...Q.links[i].pos);
      b.rotation.set(0, Q.links[i].yaw, Q.links[i].angle, 'YXZ');
    });
    if (M.family === 'cart') {
      bodies.carriage?.position.set(st.s, M.height, 0);
      for (const sx of [-1, 1]) bodies[`pulley${sx}`]?.rotation.set(0, 0, -st.s / 0.022);
    } else if (M.family === 'rotary') {
      bodies.arm?.rotation.set(0, st.s, 0);
    } else if (M.family === 'acrobat') {
      const e = bodies.elbow;
      if (e) { e.position.set(Q.joints[1][0], Q.joints[1][1], e.userData.z ?? 0); e.rotation.set(0, 0, st.theta[1]); }
    } else if (M.family === 'wheel') {
      const n = M.links.length, w = bodies.wheel;
      if (w) { w.position.set(Q.joints[n][0], Q.joints[n][1], Lay.wheelZ); w.rotation.set(0, 0, st.theta[n - 1] + st.s); }
    }
  }

  // poses passées : states[k] = état du film à (temps courant − (k + 1)·GHOST_DT)
  function updateGhosts(cur, states) {
    if (!ghostsOn || !M) return;
    for (let k = 0; k < GHOSTS; k++) {
      const st = states[k], Q = poseOf(M, st.theta, st.s, Lay);
      // (visible seulement si la chaîne a bougé depuis : écart angulaire)
      let d = 0;
      st.theta.forEach((t, i) => { d = Math.max(d, Math.abs(Math.atan2(Math.sin(t - cur.theta[i]), Math.cos(t - cur.theta[i])))); });
      const vis = Math.min(1, Math.max(0, (d - 0.04) * 6)) * 0.42 * (1 - k / GHOSTS) ** 1.3;
      ghostMats[k].userData.u.value = vis;
      M.links.forEach((L, i) => {
        const g = ghostGroups[k][i];
        g.visible = vis > 0.003;
        g.position.set(...Q.links[i].pos);
        g.position.z -= 0.001 * (k + 1); // (derrière la pièce réelle)
        g.rotation.set(0, Q.links[i].yaw, Q.links[i].angle, 'YXZ');
      });
    }
  }

  function syncFinishes() {
    for (const e of mats.values()) {
      const f = pieceFinish(e.key);
      applyFinish(e.U.outer, f.outer); applyFinish(e.U.inner, f.inner); applyFinish(e.U.edge, f.edge);
    }
  }

  return {
    group, setRecipe, update, updateGhosts, syncFinishes,
    ready: () => pending === 0 && total > 0,
    progress: () => (total ? 1 - pending / total : 0),
    extent() { // boîte utile au cadrage et aux lumières
      if (!M) return { w: 2, h: 2, cy: 1 };
      const sumL = M.links.reduce((s, L) => s + L.l, 0);
      const w = M.family === 'cart' ? 2 * (M.rail.half + 0.35) : M.family === 'rotary' ? 2 * (M.arm.r + sumL) + 0.1 : M.family === 'wheel' ? 2 * (sumL + M.wheel.r) + 0.2 : 2 * sumL + 0.3;
      return { w, h: M.height + sumL, cy: (M.height + sumL) * 0.5, sumL, H: M.height };
    },
  };
}
export { thickOf };
