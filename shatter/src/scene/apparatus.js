// Les déclencheurs : chaque rupture a une cause visible, et chaque appareil
// est porté par une tige qui descend d'un portique au-dessus de la scène,
// se met en place, agit, puis remonte (rien n'apparaît ni ne disparaît).
//
// - pendule : une bille d'acier au bout d'un fil, tenue écartée par un
//   électro-aimant, lâchée un quart de période avant le choc (ω = √(g/L)) ;
//   elle traverse la paroi et continue, amortie ;
// - haut-parleur : la membrane bat à la fréquence propre du verre, de plus en
//   plus fort, jusqu'à la rupture ;
// - marteau de percussion : il se lève, puis frappe (verre trempé) ;
// - chalumeau : une flamme bleue à pointe orangée chauffe un point de la
//   paroi, puis s'éteint au moment où le verre se fend.
//
// Tout est fonction du temps local de l'étape, et pendant le ralenti du
// temps physique (cycle.js, physTime) : la bille ralentit avec les éclats.
import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, positionGeometry, sin, smoothstep, mix, time } from 'three/tsl';
import { buildPieceMaterial, finishUniforms } from './materials.js';
import { Buffers, sphere, roundedBox, OUT, EDGE } from '../../../shared/gen/mesh.js';
import { PH, physTime } from '../cycle.js';
import { pendulum, hammer, resonanceAmp, torchOn, PENDULUM, HAMMER, TORCH, RES_FREQ } from '../kinematics.js';

const finishU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });

function geometry(B) {
  const o = B.out(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
// solide de révolution d'axe y : [[r, y], …], normales du profil
function revolve(B, prof, cols = 40, s = OUT) {
  const rows = prof.map(([r, y], k) => {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(prof.length - 1, k + 1)];
    let nr = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nr, ny) || 1; nr /= l; ny /= l;
    return Array.from({ length: cols }, (_, i) => { const t = (i / cols) * Math.PI * 2; return B.vert([r * Math.cos(t), y, r * Math.sin(t)], [nr * Math.cos(t), ny, nr * Math.sin(t)], s, [-Math.sin(t), 0, Math.cos(t)]); });
  });
  B.grid(rows, true);
}
const mesh = (B, fin, shadow = true) => {
  const m = new THREE.Mesh(geometry(B), buildPieceMaterial(fin, finishU(fin), { seedOff: uniform(new THREE.Vector3(3, 1, 2)) }));
  m.castShadow = shadow; m.receiveShadow = true; m.visible = false;
  return m;
};

// (en JS : le smoothstep importé de TSL est un nœud de shader)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// descente depuis le portique : 0 en place, 1 tout en haut
const rig = (l, Ts) => {
  const down = sstep(PH.spinStop[0] * Ts, PH.spinStop[1] * Ts, l), up = sstep((PH.melt - 0.02) * Ts, (PH.melt + 0.08) * Ts, l);
  return 1 - Math.max(0, Math.min(1, down - up));
};
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function createApparatus(scene, { finishOf }) {
  const steel = finishOf('chrome'), brass = finishOf('brassVelvet'), black = finishOf('ceramicBlack'), dark = finishOf('blackSteel');
  const UP = 7; // course de la descente

  // ── Pendule ──
  const pend = new THREE.Group();
  const bob = (() => { const B = new Buffers(); sphere(B, [0, 0, 0], 1, 40, 20, OUT); return mesh(B, steel); })();
  const wire = (() => { const B = new Buffers(); revolve(B, [[0, 0], [1, 0], [1, 1], [0, 1]], 10); return mesh(B, dark, false); })();
  const magnet = (() => { const B = new Buffers(); revolve(B, [[0, -0.5], [1, -0.5], [1, 0.4], [0.7, 0.5], [0, 0.5]], 28); return mesh(B, black); })();
  pend.add(bob, wire, magnet);

  // ── Haut-parleur ──
  const spk = new THREE.Group();
  const cab = (() => { const B = new Buffers(); roundedBox(B, [0, 0, 0], [0.34, 0.34, 0.22], 0.04, 6, EDGE, OUT); return mesh(B, black); })();
  const cone = (() => { const B = new Buffers(); revolve(B, [[0.29, 0], [0.27, 0.025], [0.2, 0.02], [0.08, -0.07], [0.05, -0.07], [0.05, -0.05], [0, -0.04]], 48); return mesh(B, dark); })();
  const ringM = (() => { const B = new Buffers(); revolve(B, [[0.3, 0.005], [0.32, 0.02], [0.3, 0.035], [0.28, 0.02]], 48); return mesh(B, steel); })();
  spk.add(cab, cone, ringM);

  // ── Marteau ──
  const ham = new THREE.Group();
  const arm = (() => { const B = new Buffers(); roundedBox(B, [0, 0, -0.42], [0.025, 0.025, 0.42], 0.012, 6, EDGE, OUT); return mesh(B, brass); })();
  const head = (() => { const B = new Buffers(); revolve(B, [[0, -0.09], [0.02, -0.095], [0.05, -0.07], [0.055, 0.07], [0.04, 0.09], [0, 0.095]], 32); return mesh(B, steel); })();
  const hub = (() => { const B = new Buffers(); revolve(B, [[0, -0.06], [0.06, -0.06], [0.06, 0.06], [0, 0.06]], 24); return mesh(B, dark); })();
  ham.add(arm, head, hub);

  // ── Chalumeau ──
  const torch = new THREE.Group();
  const body = (() => { const B = new Buffers(); revolve(B, [[0, -0.5], [0.05, -0.5], [0.05, -0.1], [0.035, 0], [0.025, 0.12], [0.03, 0.14], [0, 0.14]], 28); return mesh(B, brass); })();
  const FL = { on: uniform(0), len: uniform(0.5) };
  const flame = (() => {
    // un cône de lumière : cœur bleu, pointe orangée, qui palpite
    const g = new THREE.ConeGeometry(0.028, 1, 20, 12, true).translate(0, 0.5, 0);
    // (mélange normal, pas additif : sur un fond clair, une flamme additive
    // disparaît ; dard bleu vif, panache orangé qui s'écrase sur le verre)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const y = positionGeometry.y, flick = sin(time.mul(37).add(y.mul(23))).mul(0.12).add(0.88);
    const core = mix(vec3(0.35, 0.6, 2.4), vec3(2.2, 0.9, 0.2), smoothstep(0.4, 0.95, y));
    m.colorNode = vec4(core.mul(flick), 1);
    m.opacityNode = FL.on.mul(smoothstep(0, 0.08, y)).mul(mix(float(0.95), float(0.55), y));
    const f = new THREE.Mesh(g, m);
    f.renderOrder = 10; f.visible = false;
    return f;
  })();
  torch.add(body, flame);

  // tiges du portique
  const rods = [0, 1, 2, 3].map(() => { const B = new Buffers(); revolve(B, [[0, 0], [1, 0], [1, 1], [0, 1]], 10); return mesh(B, dark, false); });
  for (const o of [pend, spk, ham, torch, ...rods]) scene.add(o);
  const all = [pend, spk, ham, torch];

  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const rodTo = (r, p, top = 12) => { r.visible = true; r.position.set(p.x, p.y, p.z); r.scale.set(0.012, top - p.y, 0.012); };

  // P : pièce de l'étape active ; info : origine, normale, direction (repère
  // de la pièce) ; a : angle du plateau (arrêté) ; l : temps local ; S : taille
  function update(P, info, a, l, Ts, slow, S) {
    for (const g of all) g.visible = false;
    for (const r of rods) r.visible = false;
    for (const g of all) g.traverse((o) => { if (o.isMesh) o.visible = false; });
    if (!P || !info) return;
    const rot = (v) => { const c = Math.cos(a), s = Math.sin(a); return new THREE.Vector3(c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]); };
    const O = rot(info.origin), n = rot(info.normal);
    const nh = new THREE.Vector3(n.x, 0, n.z).normalize();
    const lift = rig(l, Ts) * UP;
    const tp = physTime(l, Ts, slow) - physTime(PH.rupture * Ts, Ts, slow); // (temps physique depuis le choc)
    const show = (g) => { g.visible = true; g.traverse((o) => { if (o.isMesh && o !== flame) o.visible = true; }); };
    const V = (a3) => new THREE.Vector3(a3[0], a3[1], a3[2]);
    const Oa = [O.x, O.y, O.z], na = [nh.x, nh.y, nh.z], L4 = new THREE.Vector3(0, lift, 0);
    if (P.mech === 'ball') {
      show(pend);
      // (kinematics.js : la bille touche O exactement au choc, jamais avant)
      const K = pendulum(Oa, na, tp, l, Ts), rb = PENDULUM.rb;
      const piv = V(K.pivot).add(L4), bobP = V(K.center).add(L4);
      bob.position.copy(bobP); bob.scale.setScalar(rb);
      tmp.subVectors(piv, bobP);
      wire.position.copy(bobP); wire.scale.set(0.006, tmp.length(), 0.006); wire.quaternion.setFromUnitVectors(up, tmp.clone().normalize());
      const th0 = PENDULUM.th0, L = PENDULUM.L;
      const magP = piv.clone().addScaledVector(nh, L * Math.sin(th0) + rb * 1.6).add(new THREE.Vector3(0, -L * Math.cos(th0), 0));
      magnet.position.copy(magP); magnet.scale.set(0.07, 0.14, 0.07); magnet.quaternion.setFromUnitVectors(up, nh.clone().negate());
      rodTo(rods[0], magP.clone().add(new THREE.Vector3(0, 0.07, 0)));
    } else if (P.mech === 'resonance') {
      show(spk);
      // face au bord, à hauteur du point d'impact, la membrane bat en phase avec le verre
      spk.position.copy(O).addScaledVector(nh, 0.42).add(new THREE.Vector3(0, lift, 0));
      spk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nh.clone().negate());
      cab.position.set(0, 0, -0.12); ringM.position.set(0, 0, 0.1); ringM.rotation.set(Math.PI / 2, 0, 0);
      const amp = resonanceAmp(l, Ts);
      cone.position.set(0, 0, 0.1 + 0.035 * amp * Math.sin(l * 2 * Math.PI * RES_FREQ)); cone.rotation.set(Math.PI / 2, 0, 0);
      cab.position.x = 0.006 * amp * Math.sin(l * 2 * Math.PI * RES_FREQ * 2); // (le caisson tremble)
      rodTo(rods[1], spk.position.clone().add(new THREE.Vector3(0, 0.34, 0)));
    } else if (P.mech === 'tempered') {
      show(ham);
      // (kinematics.js : la face de la tête touche O exactement au choc)
      const K = hammer(Oa, na, tp, l, Ts);
      ham.position.copy(V(K.pivot)).add(L4);
      ham.rotation.set(0, Math.atan2(nh.x, nh.z), 0, 'YXZ'); ham.rotateX(K.ph);
      head.position.set(0, 0, -HAMMER.L); head.rotation.set(0, 0, 0);
      rodTo(rods[2], ham.position.clone().add(new THREE.Vector3(0, 0.06, 0)));
    } else if (P.mech === 'thermal') {
      show(torch);
      // la buse est de biais, un peu au-dessus ; le dard de la flamme touche O
      const tip = O.clone().addScaledVector(nh, TORCH.dist).add(new THREE.Vector3(0, 0.18 + lift, 0));
      torch.position.copy(tip);
      const aim = O.clone().sub(tip).normalize();
      torch.quaternion.setFromUnitVectors(up, aim);
      body.position.set(0, -0.14, 0);
      const on = torchOn(l, Ts);
      FL.on.value = on;
      flame.visible = on > 0.01;
      flame.scale.set(1 + 0.6 * on, O.distanceTo(tip), 1 + 0.6 * on);
      rodTo(rods[3], tip.clone().addScaledVector(aim, -0.62).add(new THREE.Vector3(0, 0.02, 0)));
    }
  }

  return { update, groups: all };
}

