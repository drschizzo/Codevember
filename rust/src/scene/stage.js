// Le plateau : décor (cyclorama), lumières, la pièce et son support, la
// machine, la pluie et les effets du décapage. Tout est une fonction de la
// recette et de la phase (update(ph)).
//
// Principes (gabarit) : un maillage reçoit son matériau quand SA géométrie
// est arrivée (three.js ne recompile pas un objet dont on change seulement la
// géométrie) ; les lumières sont créées une fois, dans un ordre fixe, au
// premier niveau de la scène.
import * as THREE from 'three/webgpu';
import { uniform, positionGeometry, vec3, float, mix, smoothstep, sin, length, normalViewGeometry, color } from 'three/tsl';
import { rustUniforms, rustMaterial, fieldTextures } from './rust.js';
import { cycloGeometry, floorUniforms, floorMaterial, standMaterial, machineMaterial } from './floor.js';
import { createParticles, hash } from './particles.js';
import { perturb, fbm, noise, stableVelocity } from './materials.js';
import { tauAt, rainAt, wetAt, overcastAt, sstep } from '../timeline.js';
import { laserPlan, laserHead, laserRig, frontAt, turnPlan, turnS, turnAngle, nozzleY, radialAt, bathPlan, bathOffset, TAU } from '../machines.js';
import { cameraPath } from '../camera.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const PAINTS = { atelier: '#4d6a4f', labo: '#9fb3c6', cale: '#d3a321', jour: '#2f5582', nuit: '#c9a227', brume: '#c8931f' };
const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

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

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  const key = new THREE.SpotLight(0xffffff, 600, 0, 0.5, 0.7, 2);
  key.castShadow = true;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015; key.shadow.radius = 5;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2; key.shadow.camera.far = 20;
  const rims = [new THREE.SpotLight(0xffffff, 200, 0, 0.6, 0.9, 2), new THREE.SpotLight(0xffffff, 100, 0, 0.6, 0.9, 2)];
  if (lite) rims[1].visible = false;
  const spot = new THREE.PointLight(0xfff1e0, 0, 0, 2); // (éclair du laser)
  for (const l of [key, ...rims]) { scene.add(l); scene.add(l.target); }
  scene.add(spot);

  // ── Décor ──
  const FU = floorUniforms();
  const cyclo = new THREE.Mesh(cycloGeometry());
  cyclo.receiveShadow = true;
  scene.add(cyclo);
  let floorKind = '';

  // ── Pièce, support, machine ──
  const root = new THREE.Group(); scene.add(root);
  const pieceG = new THREE.Group(); root.add(pieceG); // (repère de la pièce : tourne, monte, descend)
  const RU = rustUniforms();
  const standMat = standMaterial();
  let body = null, stand = null, machine = null, tex = null, info = null, plan = null, cam = null, C = null;
  let R = null, version = 0, pending = 0, total = 2;

  // ── Particules ──
  const P = {
    rainA: createParticles(scene, { max: 2600, kind: 'streak', blend: 'add', tint: '#cfdcff' }),
    rainN: createParticles(scene, { max: 2600, kind: 'streak', blend: 'normal', tint: '#eef2f6' }),
    splash: createParticles(scene, { max: 600, kind: 'puff', blend: 'normal', tint: '#f2f6fa' }),
    sparks: createParticles(scene, { max: 700, kind: 'streak', blend: 'add', tint: '#ffb35c' }),
    grit: createParticles(scene, { max: 900, kind: 'streak', blend: 'add', tint: '#d8d2c6' }),
    dust: createParticles(scene, { max: 260, kind: 'puff', blend: 'normal', tint: '#b9b2a6' }),
    bubbles: createParticles(scene, { max: 400, kind: 'puff', blend: 'normal', tint: '#c9c6b8' }),
    drips: createParticles(scene, { max: 300, kind: 'streak', blend: 'normal', tint: '#d7dde2' }),
  };

  // ── Liquide du bain ──
  const LU = { t: uniform(0), stir: uniform(0), ring: uniform(0), center: uniform(new THREE.Vector2()) };
  let liquid = null;
  function liquidMaterial() {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const p = positionGeometry;
    const r = length(p.xz.sub(LU.center));
    const ring = sin(r.mul(60).sub(LU.t.mul(9))).mul(smoothstep(0.9, 0.0, r)).mul(LU.ring).mul(0.0008);
    const boil = fbm(vec3(p.x.mul(14), LU.t.mul(1.4), p.z.mul(14)), 3).mul(LU.stir).mul(0.0012);
    m.colorNode = vec3(0.045, 0.05, 0.038).mul(noise(p.mul(3)).mul(0.1).add(1));
    m.roughnessNode = float(0.05);
    m.metalnessNode = float(0);
    m.normalNode = perturb(ring.add(boil), normalViewGeometry);
    m.mrtNode = stableVelocity();
    return m;
  }

  // réglages qui ne demandent qu'une mise à jour d'uniformes
  function applyLive() {
    const MP = R.rust;
    RU.pits.value = MP.pits; RU.streak.value = MP.streak; RU.blister.value = MP.blister; RU.flake.value = MP.flake; RU.hue.value = MP.hue; RU.depth.value = MP.depth;
    RU.offset.value.set(...MP.offset);
  }

  function disposeMesh(o) { if (!o) return; o.parent?.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); }
  function clearMachine() {
    if (!machine) return;
    for (const o of machine.meshes) disposeMesh(o);
    for (const g of machine.groups ?? []) g.parent?.remove(g);
    machine = null;
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    disposeMesh(body); disposeMesh(stand); body = stand = null; clearMachine();
    disposeMesh(liquid); liquid = null;
    tex && Object.values(tex).forEach((t) => t.dispose()); tex = null;
    pending = total = 2; plan = null; cam = null; C = null; info = null;
    FU.pit.value.set(1e3, 1e3, 1e3, 1e3); pieceG.position.set(0, 0, 0); pieceG.rotation.set(0, 0, 0);
    // décor
    if (floorKind !== R.floor.kind) { cyclo.material?.dispose?.(); cyclo.material = floorMaterial(R.floor.kind, FU); floorKind = R.floor.kind; }
    const tone = new THREE.Color(R.floor.tone);
    FU.tone.value.copy(tone);
    FU.wall.value.copy(new THREE.Color(R.fog.color)).lerp(tone, 0.3);
    applyLive();
    const fin = { laser: [0.36, 0.97, 1], sablage: [0.58, 0.92, 0], bain: [0.42, 0.78, 0] }[R.machine.kind];
    RU.cleanRough.value = fin[0]; RU.cleanTone.value = fin[1]; RU.stripes.value = fin[2];
    gen.request({ family: R.piece.family, params: R.piece.params, seed: R.seed, lite }, 'piece').then((o) => {
      if (v !== version) return;
      const Cn = o.corrosion;
      C = Cn; info = o.info;
      tex = fieldTextures(Cn);
      const [nx, ny, nz] = Cn.field.dims;
      RU.fLo.value.set(...Cn.field.lo); RU.fSize.value.set(nx * Cn.field.vox, ny * Cn.field.vox, nz * Cn.field.vox);
      RU.frLo.value.set(...Cn.front.lo); RU.frSize.value.set(Cn.front.w * Cn.front.cell, Cn.front.h * Cn.front.cell);
      RU.radY0.value = Cn.radial.y0; RU.radH.value = Cn.radial.h * Cn.radial.cell;
      const Dd = Cn.dirs; RU.dK.value = Dd.K; RU.dTW.value = Dd.tw; RU.dTH.value = Dd.th; RU.dR.value = Dd.r; RU.dY0.value = Dd.y0; RU.dCell.value = Dd.cell;
      body = new THREE.Mesh(toGeometry(o.body));
      body.material = rustMaterial(tex, RU, R.machine.kind);
      body.castShadow = body.receiveShadow = true;
      pieceG.add(body);
      if (R.machine.kind !== 'bain') {
        stand = new THREE.Mesh(toGeometry(o.stand), standMat);
        stand.castShadow = stand.receiveShadow = true;
        pieceG.add(stand);
      }
      pending--;
      buildPlan();
    }).catch((e) => { console.error(e); pending--; });
  }

  // plan de la machine (d'après la pièce), puis sa géométrie
  function buildPlan() {
    const v = version, lo = info.lo, hi = info.hi;
    const kind = R.machine.kind;
    let spec;
    if (kind === 'laser') {
      plan = laserPlan(R, C.front, lo, hi);
      plan.rows.forEach((r, k) => RU.rows.array[k].set(r.xs, r.xe, r.t0, r.t1));
      RU.yTop.value = plan.yTop; RU.band.value = plan.w; RU.nRows.value = plan.n;
      spec = { kind, lo, hi, zHead: plan.zHead };
    } else if (kind === 'sablage') {
      plan = turnPlan(R, C.radial, lo, hi);
      plan.platen = 0.3;
      RU.turns.value = plan.N; RU.nTop.value = plan.yTop; RU.nBot.value = plan.yBot; RU.foot.value = plan.foot; RU.tilt.value = plan.tilt; RU.dir.value = plan.dir; RU.az.value = plan.az;
      spec = { kind, lo, hi, rMax: plan.rMax, platen: plan.platen, tilt: plan.tilt };
    } else {
      plan = bathPlan(R, lo, hi, info.lifts);
      RU.level.value = plan.L; RU.up0.value = plan.u.up0;
      spec = { kind, lo, hi, tank: plan.tank, hook: plan.hook, lifts: info.lifts, rest: plan.rest };
    }
    gen.request(spec, 'machine').then((o) => {
      if (v !== version) return;
      buildMachine(o);
      cam = makeCamera();
      pending--;
    }).catch((e) => { console.error(e); pending--; });
  }

  function buildMachine(o) {
    const mat = machineMaterial(R.machinePaint ?? PAINTS[R.mood] ?? '#c9a227');
    const meshes = [], groups = [];
    const mk = (part, parent = root) => { const m = new THREE.Mesh(toGeometry(part), mat); m.castShadow = m.receiveShadow = true; parent.add(m); meshes.push(m); return m; };
    const M = { kind: plan.kind, meshes, groups, info: o.info, mat };
    if (plan.kind === 'laser') {
      M.rails = mk(o.parts.rails); M.portal = mk(o.parts.portal); M.carriage = mk(o.parts.carriage); M.head = mk(o.parts.head);
    } else if (plan.kind === 'sablage') {
      M.base = mk(o.parts.base); M.platen = mk(o.parts.platen);
      const colG = new THREE.Group(); root.add(colG); groups.push(colG);
      colG.rotation.y = -plan.az;
      M.column = mk(o.parts.column, colG);
      M.armG = new THREE.Group(); colG.add(M.armG); groups.push(M.armG);
      M.arm = mk(o.parts.arm, M.armG);
      M.Rc = o.info.Rc;
    } else {
      M.tank = mk(o.parts.tank); M.crane = mk(o.parts.crane);
      M.lid = mk(o.parts.lid);
      M.hook = mk(o.parts.hook, pieceG);
      // (la chaîne qui dépasse au-dessus du palan entre dans son corps : masquée)
      M.hook.material = machineMaterial(R.machinePaint ?? PAINTS[R.mood] ?? '#c9a227', { clipY: o.info.beamY - 0.3 });
      // (la chaîne de levage au-dessus du palan est masquée)
      const T = plan.tank;
      M.lid.position.set(T.cx, 0, T.cz);
      liquid = new THREE.Mesh(new THREE.PlaneGeometry(2 * T.hx, 2 * T.hz, 1, 1).rotateX(-Math.PI / 2), liquidMaterial());
      liquid.position.set(T.cx, plan.L, T.cz);
      liquid.receiveShadow = true;
      root.add(liquid);
      LU.center.value.set(0, 0);
      FU.pit.value.set(T.cx - T.hx - 0.012, T.cx + T.hx + 0.012, T.cz - T.hz - 0.012, T.cz + T.hz + 0.012);
    }
    machine = M;
  }

  // boîtes (monde) et point suivi par la caméra
  function makeCamera() {
    const lo = info.lo, hi = info.hi, k = plan.kind;
    const yOff = k === 'sablage' ? plan.platen : k === 'bain' ? plan.rest : 0;
    const box = { lo: [lo[0], 0, lo[2]], hi: [hi[0], hi[1] + yOff, hi[2]] };
    let frameBox = box, focus;
    if (k === 'laser') {
      focus = (u) => { if (u < R.timing.setup0 - 0.05 || u > R.timing.retract1 + 0.05) return null; const h = laserHead(plan, Math.min(Math.max(u, plan.rows[0].t0), plan.rows[plan.rows.length - 1].t1)); const fz = frontAt(C.front, h.x, h.y); return [h.x, h.y, fz > -900 ? fz : hi[2]]; };
    } else if (k === 'sablage') {
      const r = plan.rMax + 0.1;
      frameBox = { lo: [-r, 0, -r], hi: [r, hi[1] + yOff, r] };
      focus = (u) => { const s = turnS(R, u); return [plan.rMax * 0.6 * Math.cos(plan.az), nozzleY(plan, s) + yOff, plan.rMax * 0.6 * Math.sin(plan.az)]; };
    } else {
      const T = plan.tank;
      frameBox = { lo: [T.cx - T.hx, -0.2, T.cz - T.hz], hi: [T.cx + T.hx, hi[1] + plan.rest, T.cz + T.hz] };
      focus = (u) => [T.cx, Math.max(plan.L + 0.15, Math.min(hi[1] + plan.rest - 0.3, plan.L + 0.35)), T.cz];
    }
    // le décor s'oriente : sa paroi à l'opposé de la caméra
    cyclo.rotation.y = R.camera.az;
    const c = [(frameBox.lo[0] + frameBox.hi[0]) / 2, (frameBox.lo[2] + frameBox.hi[2]) / 2];
    cyclo.position.set(c[0], 0, c[1]);
    return cameraPath(R, { box, focus, frameBox });
  }

  // ── Effets ──
  const D = () => R.loop.duration;
  function rainFX(u, rain) {
    const sys = R.floor.kind === 'epoxy' || R.mood === 'jour' || R.mood === 'brume' ? P.rainN : P.rainA;
    const other = sys === P.rainA ? P.rainN : P.rainA;
    other.begin(); other.end();
    sys.begin(); P.splash.begin();
    if (rain > 0.001 && info) {
      const t = u * D(), Rn = R.rain, N = Math.round(2400 * Rn.density * (lite ? 0.6 : 1));
      const v = 7.5, yTop = 3.6, len = Rn.len * 1.4, wind = Rn.wind;
      const cx = (info.lo[0] + info.hi[0]) / 2, cz = (info.lo[2] + info.hi[2]) / 2;
      const yOff = plan?.kind === 'sablage' ? plan.platen : plan?.kind === 'bain' ? plan.rest : 0;
      const T = C.top;
      for (let i = 0; i < N; i++) {
        if (hash(i, 1) > rain) continue;
        const x = cx + (hash(i, 2) - 0.5) * 3.6, z = cz + (hash(i, 3) - 0.5) * 3.0;
        // surface sous la goutte : la pièce (carte du dessus) ou le sol
        let ySurf = 0;
        const ti = Math.floor((x - T.lo[0]) / T.cell), tj = Math.floor((z - T.lo[1]) / T.cell);
        if (ti >= 0 && tj >= 0 && ti < T.w && tj < T.h && T.data[tj * T.w + ti] > -999) ySurf = T.data[tj * T.w + ti] + yOff;
        const fall = (yTop - ySurf) / v, per = fall + 0.08 + hash(i, 4) * 0.3;
        const lt = (t + hash(i, 5) * 7.3) % per;
        if (lt < fall) {
          const y = yTop - v * lt;
          sys.push(x + wind * (yTop - y) * 0.2, y, z, wind * len * 0.2, len, 0, 0.0016 * Rn.size + 0.0008, 0.32, 0.9);
        } else if (lt < fall + 0.08) {
          const a = (lt - fall) / 0.08;
          P.splash.push(x + wind * (yTop - ySurf) * 0.2, ySurf + 0.004, z, 0, 0, 0, 0.012 + 0.03 * a, 0.35 * (1 - a), 0.9, 1);
        }
      }
    }
    sys.end(); P.splash.end();
  }

  function laserFX(u, head) {
    P.sparks.begin();
    if (plan?.kind === 'laser') {
      const t = u * D(), g = 9.81;
      for (let i = 0; i < 520; i++) {
        const per = 0.45 + hash(i, 11) * 0.5, ph = hash(i, 12) * per;
        const k = Math.floor((t - ph) / per), tb = k * per + ph, age = t - tb;
        const ub = tb / D();
        const hb = laserHead(plan, ub);
        if (!hb.on || age > per * 0.9) continue;
        const y0 = hb.y + (hash(i, 13 + k) - 0.5) * plan.w * 0.9, x0 = hb.x;
        const z0 = frontAt(C.front, x0, y0) + 0.005;
        if (z0 < -900) continue;
        const sp = 1.2 + 2.5 * hash(i, 14 + k), a = hash(i, 15 + k) * Math.PI * 2;
        let vx = Math.cos(a) * sp * 0.7, vy = Math.abs(Math.sin(a)) * sp * 0.6 + 0.4, vz = sp * (0.6 + 0.4 * hash(i, 16 + k));
        let x = x0 + vx * age, y = y0 + vy * age - 0.5 * g * age * age, z = z0 + vz * age, vyy = vy - g * age;
        if (y < 0.004) { // un rebond sur le sol
          const tl = (vy + Math.sqrt(vy * vy + 2 * g * y0)) / g, dtb = age - tl;
          vx *= 0.4; vz *= 0.4; const vb = (vy - g * tl) * -0.3;
          x = x0 + vx / 0.4 * tl + vx * dtb; z = z0 + vz / 0.4 * tl + vz * dtb; y = Math.max(0.003, vb * dtb - 0.5 * g * dtb * dtb); vyy = vb - g * dtb;
        }
        const life = 1 - age / (per * 0.9);
        const sh = 1 / 60;
        P.sparks.push(x, y, z, vx * sh, vyy * sh, vz * sh, 0.0022, Math.min(1, life * 1.6), 2.5 + 5 * life * life);
      }
      // éclair : lumière ponctuelle au point d'impact
      if (head.on) {
        const fl = 0.75 + 0.25 * Math.sin(t * 91.7) * Math.sin(t * 37.3);
        { const fz = frontAt(C.front, head.x, head.y); spot.position.set(head.x, head.y, (fz > -900 ? fz : info.hi[2]) + 0.06); }
        spot.intensity = 0.55 * fl;
      } else spot.intensity = 0;
    } else spot.intensity = 0;
    P.sparks.end();
  }

  function blastFX(u, s, yOff) {
    P.grit.begin(); P.dust.begin();
    if (plan?.kind === 'sablage' && machine) {
      const t = u * D(), on = s > 0 && s < 1 ? 1 : 0;
      const Rn = machine.Rc - (machine.info.reach ?? 0.3);
      const ny = nozzleY(plan, s) + yOff, az = plan.az;
      const dir = [-Math.cos(plan.tilt) * Math.cos(az), -Math.sin(plan.tilt), -Math.cos(plan.tilt) * Math.sin(az)];
      const tip = [Rn * Math.cos(az), ny, Rn * Math.sin(az)];
      // point d'impact : la surface de la pièce face à la buse, à sa hauteur
      const rHit = (sv) => { const ny0 = nozzleY(plan, sv); let r = 0; for (let k = -2; k <= 2; k++) r = Math.max(r, radialAt(C.radial, az - turnAngle(plan, sv) + k * 0.04, ny0 - Math.tan(plan.tilt) * 0.2)); return Math.max(0.05, r); };
      const hitD = Math.max(0.08, (Rn - rHit(s)) / Math.cos(plan.tilt));
      if (on) {
        for (let i = 0; i < 700; i++) {
          const per = 0.09, ph = hash(i, 21) * per, a = ((t + ph) % per) / per;
          const sp = 0.08 * hash(i, 22), th = hash(i, 23) * TAU;
          const d = a * hitD * 1.05;
          const off = [Math.cos(th) * sp * a, Math.sin(th) * sp * a];
          const x = tip[0] + dir[0] * d + off[0] * Math.sin(az), y = tip[1] + dir[1] * d + off[1], z = tip[2] + dir[2] * d - off[0] * Math.cos(az);
          P.grit.push(x, y, z, dir[0] * 0.07, dir[1] * 0.07, dir[2] * 0.07, 0.0016, 0.75, 1.1);
        }
      }
      // poussière : bouffées nées au point d'impact (pendant le sablage), qui
      // roulent, montent, s'étalent et retombent
      const hit = [tip[0] + dir[0] * hitD, tip[1] + dir[1] * hitD, tip[2] + dir[2] * hitD];
      for (let i = 0; i < 220; i++) {
        const per = 2.6, ph = hash(i, 31) * per, k = Math.floor((t - ph) / per), tb = k * per + ph, age = t - tb;
        const sb = turnS(R, tb / D());
        if (!(sb > 0 && sb < 1)) continue;
        const hd = Math.max(0.08, (Rn - rHit(sb)) / Math.cos(plan.tilt));
        const hb = [Rn * Math.cos(az) + dir[0] * hd, nozzleY(plan, sb) + yOff + dir[1] * hd, Rn * Math.sin(az) + dir[2] * hd];
        const a = age / per, th = hash(i, 32 + k) * TAU, sp = 0.25 + 0.5 * hash(i, 33 + k);
        const x = hb[0] + Math.cos(th) * sp * Math.sqrt(age) * 0.6 + Math.cos(az) * 0.25 * age;
        const z = hb[2] + Math.sin(th) * sp * Math.sqrt(age) * 0.6 + Math.sin(az) * 0.25 * age;
        const y = Math.max(0.05, hb[1] + 0.12 * Math.sqrt(age) - 0.06 * age * age);
        P.dust.push(x, y, z, 0, 0, 0, 0.08 + 0.32 * Math.sqrt(a), 0.16 * (1 - a) * Math.min(1, a * 8), 1);
      }
      void hit;
    }
    P.grit.end(); P.dust.end();
  }

  function bathFX(u, off) {
    P.bubbles.begin(); P.drips.begin();
    if (plan?.kind === 'bain' && info) {
      const t = u * D(), U = plan.u, T = plan.tank;
      const under = u > U.down0 + 0.02 && u < U.up1 - 0.01;
      if (under) {
        // bulles d'hydrogène qui crèvent à la surface autour de la pièce
        for (let i = 0; i < 380; i++) {
          const per = 0.5 + hash(i, 41) * 0.6, ph = hash(i, 42) * per, k = Math.floor((t - ph) / per), a = ((t - ph) % per) / per;
          const x = info.lo[0] + (info.hi[0] - info.lo[0]) * hash(i, 43 + k), z = info.lo[2] + (info.hi[2] - info.lo[2]) * hash(i, 44 + k);
          P.bubbles.push(x, plan.L + 0.002, z, 0, 0, 0, 0.006 + 0.012 * a, 0.5 * Math.sin(Math.PI * a), 0.9, 1);
        }
      }
      // gouttes qui tombent de la pièce remontée (de moins en moins)
      if (u > U.up0) {
        const since = (u - U.up0) * D();
        for (let i = 0; i < 260; i++) {
          const per = 0.35 + hash(i, 51) * 0.5, ph = hash(i, 52) * per, k = Math.floor((t - ph) / per), age = ((t - ph) % per);
          if (hash(i, 53 + k) > Math.exp(-since / 6)) continue;
          const x = info.lo[0] + (info.hi[0] - info.lo[0]) * hash(i, 54 + k), z = info.lo[2] + (info.hi[2] - info.lo[2]) * hash(i, 55 + k);
          const y0 = info.lo[1] + off + 0.01, y = y0 - 0.5 * 9.81 * age * age;
          if (y < plan.L) continue;
          P.drips.push(x, y, z, 0, -Math.max(0.02, 9.81 * age / 60), 0, 0.0035, 0.55, 1);
        }
      }
      LU.t.value = t;
      LU.stir.value = under ? 1 : Math.max(0, 1 - (u - U.up1) * 20);
      LU.ring.value = sstep(U.down0, U.down0 + 0.01, u) * (1 - sstep(U.down1, U.down1 + 0.05, u)) + sstep(U.up0, U.up0 + 0.01, u) * (1 - sstep(U.up1, U.up1 + 0.04, u)) * 0.6;
      void T;
    }
    P.bubbles.end(); P.drips.end();
  }

  // ── Mise à jour : la recette et la phase ──
  const place = (l, az, el, r, tgt) => { l.position.set(tgt[0] + Math.sin(az) * Math.cos(el) * r, tgt[1] + Math.sin(el) * r, tgt[2] + Math.cos(az) * Math.cos(el) * r); l.target.position.set(...tgt); };
  function update(ph) {
    if (!R || !plan || !machine) return;
    const u = ph, T = R.timing;
    const tau = tauAt(R, u), rain = rainAt(R, u), wet = wetAt(R, u), sky = overcastAt(R, u);
    RU.tau.value = tau; RU.u.value = u; RU.wet.value = wet;
    RU.wetPool.value = Math.min(1, wetAt({ timing: { ...T, dry: T.dry * 2.5 } }, u) * 1.2);
    FU.wet.value = Math.min(1, wet * 1.1); FU.puddle.value = tau;
    // lumières (la caméra et la pièce : centre de la boîte)
    const lo = info.lo, hi = info.hi;
    const yOff = plan.kind === 'sablage' ? plan.platen : plan.kind === 'bain' ? plan.rest : 0;
    const ctr = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 + yOff, (lo[2] + hi[2]) / 2];
    const L = R.light, dim = 1 - 0.6 * sky;
    place(key, L.key.az + R.camera.az, L.key.el, 7, ctr);
    key.color.set(L.key.color); key.intensity = 900 * L.key.power * dim; key.angle = Math.min(0.55, L.key.angle); key.penumbra = L.key.penumbra;
    rims.forEach((l, i) => { const r = L.rim[i]; place(l, r.az + R.camera.az, r.el, 6.5, ctr); l.color.set(r.color); l.intensity = 520 * r.power * (1 - 0.3 * sky) * (lite && i === 0 ? 1.4 : 1); l.angle = 0.45; l.penumbra = 0.8; });
    scene.environmentIntensity = R.env.intensity * (1 - 0.3 * sky);
    // machine
    let head = { on: 0 };
    if (plan.kind === 'laser') {
      const M = machine, rig = laserRig(R, plan, u, info.hi[1], M.info.zb);
      head = { x: rig.x, y: rig.scanY, on: rig.on };
      M.portal.position.z = rig.z; M.carriage.position.set(rig.x, 0, rig.z); M.head.position.set(rig.x, rig.y, rig.z);
      RU.head.value.set(head.x, head.y, head.on);
    } else if (plan.kind === 'sablage') {
      const M = machine, s = turnS(R, u), th = turnAngle(plan, s);
      pieceG.rotation.y = -th; M.platen.rotation.y = -th;
      pieceG.position.y = plan.platen;
      // bras : pivote vers la pièce pendant la mise en place, repart au retrait
      const swing = 1.25 * (1 - ease((u - T.setup0) / (T.clean0 - T.setup0 - 0.01))) + 1.25 * ease((u - T.clean1 - 0.005) / (T.retract1 - T.clean1 - 0.005));
      const back = ease((u - T.clean1 - 0.005) / (T.retract1 - T.clean1 - 0.005));
      const ny = nozzleY(plan, s) * (1 - back) + plan.yTop * back + plan.platen;
      M.armG.position.set(M.Rc, ny, 0);
      M.armG.rotation.y = swing;
      RU.s.value = s;
      blastFX(u, s, plan.platen);
    } else {
      const M = machine, off = bathOffset(plan, u);
      pieceG.position.y = off;
      // léger balancement de la charge au bout des élingues (période entière)
      pieceG.rotation.z = R.machine.swing * Math.sin(TAU * 3 * u) * (1 - 0.8 * sstep(T.clean0, T.clean0 + 0.05, u) * (1 - sstep(T.clean1, T.retract1, u)));
      const open = ease((u - plan.lid[0]) / (plan.lid[1] - plan.lid[0])) * (1 - ease((u - plan.lid[2]) / (plan.lid[3] - plan.lid[2])));
      M.lid.position.x = plan.tank.cx + open * (2 * plan.tank.hx + 0.3) * (R.camera.az >= 0 ? -1 : 1); // (roule vers le côté opposé à la caméra)
      RU.off.value = off;
      RU.emergeWet.value = sstep(plan.u.up0, plan.u.up0 + 0.005, u) * Math.exp(-Math.max(0, u - plan.u.up1) / 0.035);
      bathFX(u, off);
    }
    if (plan.kind !== 'sablage') blastFX(u, 0, 0);
    if (plan.kind !== 'bain') bathFX(u, 0);
    laserFX(u, head);
    rainFX(u, rain);
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, applyLive, recomputeCamera: () => { if (plan && machine) cam = makeCamera(); }, root, pieceG, cyclo, key, rims, spot, particles: P, RU, FU,
    camera: (u) => cam?.at(u),
    get plan() { return plan; }, get info() { return info; }, get corrosion() { return C; }, get machine() { return machine; },
    ready: () => pending === 0 && !!cam,
    progress: () => (total ? 1 - pending / total : 1),
    syncFinishes() {},
  };
}
