// Les complications : la couronne du plateau, au-delà de ce que balaient les
// chaînes, et la gravure de son centre. Selon l'archétype de la machine :
//   - horlogerie : balancier spiral qui oscille, échappement à ancre qui avance
//     par crans, rouage engrené jusqu'au barillet (rochet et cliquet), ponts
//     vissés sur rubis, cadrans émaillés ;
//   - classique : anneau zodiacal en douze plaques, cadrans, sphère armillaire
//     au sommet du poteau central (si aucun astre n'y passe) ;
//   - atelier : volant d'inertie à manivelle et bielle, régulateur à boules,
//     courroie ;
//   - astrolabe : araignée ajourée qui tourne sur un tympan gravé.
// Tout est dans le repère du plateau (il tourne avec lui) ; update(tau) anime.
import * as THREE from 'three/webgpu';
import { gearGeometry, cyl, ribbonGeometry, flat } from '../scene/machine.js';

const TAU = Math.PI * 2;
const ss5 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

// une roue, centrée en (r, φ) sur le plateau
const polar = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

export function createComplications({ archetype, rIn, plateR, yPlate, mats, keep, center, styleGear }) {
  const g = new THREE.Group();
  const anim = [];
  const mesh = (geo, mat, shadow = true) => { const o = new THREE.Mesh(geo, mat); o.castShadow = shadow; o.receiveShadow = true; return o; };
  const place = (o, x, y, h) => { o.position.set(x, yPlate + h, -y); g.add(o); return o; };
  const W = plateR - rIn, rc = (rIn + plateR) / 2;
  const sc = Math.min(1, W / 0.48);
  const engrave = mats.groove;

  // ── gravure du centre : cercles et lignes horaires (à plat, sous la machine)
  {
    for (const f of [0.22, 0.45, 0.7, 0.95]) {
      const n = 360, pts = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts[2 * i] = Math.cos(a) * rIn * f; pts[2 * i + 1] = Math.sin(a) * rIn * f; }
      g.add(new THREE.Mesh(keep(ribbonGeometry(pts, 0.003, yPlate + 0.0003)), engrave));
    }
    const line = keep(new THREE.BoxGeometry(rIn * 0.7, 0.0004, 0.0025));
    const lines = new THREE.InstancedMesh(line, engrave, 24);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, rr = rIn * (0.22 + 0.35);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      p.set(Math.cos(a) * rr, yPlate + 0.0003, -Math.sin(a) * rr);
      lines.setMatrixAt(i, M.compose(p, q, s));
    }
    g.add(lines);
  }

  // ── cadrans émaillés : disque, chapitre, aiguille bleuie
  function dial(a, rate, r = 0.065 * sc) {
    const [x, y] = polar(rc, a);
    place(mesh(keep(cyl(r * 1.08, 0.006, 48)), mats.arms), x, y, 0);
    place(mesh(keep(cyl(r, 0.0072, 48)), mats.dial), x, y, 0);
    const tick = keep(new THREE.BoxGeometry(r * 0.16, 0.001, r * 0.025));
    const ticks = new THREE.InstancedMesh(tick, mats.ink, 12);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const b = (i / 12) * TAU;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b);
      p.set(x + Math.cos(b) * r * 0.82, yPlate + 0.0076, -(y + Math.sin(b) * r * 0.82));
      ticks.setMatrixAt(i, M.compose(p, q, s));
    }
    g.add(ticks);
    const hand = new THREE.Group();
    const hs = new THREE.Shape(); hs.moveTo(-r * 0.15, -r * 0.05); hs.lineTo(r * 0.78, -r * 0.012); hs.lineTo(r * 0.78, r * 0.012); hs.lineTo(-r * 0.15, r * 0.05); hs.closePath();
    hand.add(mesh(keep(flat(hs, 0.0012, 0)), mats.arms2, false));
    place(hand, x, y, 0.0085);
    place(mesh(keep(cyl(r * 0.07, 0.003, 12)), mats.pins, false), x, y, 0.008);
    anim.push((tau) => { hand.rotation.y = -tau * rate; });
  }

  // un rouage engrené le long de l'anneau : roues aux entraxes exacts, dents calées
  function geartrain(a0, specs, m, drive) {
    let a = a0;
    const wheels = [];
    specs.forEach((sp, i) => {
      const r = (m * sp.z) / 2;
      if (i) a += 2 * Math.asin((wheels[i - 1].r + r) / (2 * rc));
      const [x, y] = polar(rc, a);
      const w = mesh(gearGeometry(sp.z, r, { thick: 0.004, style: sp.style || styleGear }), mats.gears);
      place(w, x, y, sp.h ?? 0.012);
      place(mesh(keep(cyl(0.0035, (sp.h ?? 0.012) + 0.006)), mats.pins), x, y, 0);
      wheels.push({ ...sp, r, x, y, a, m: w });
    });
    // calage : contact le long de la droite des centres
    const off = [0];
    for (let i = 1; i < wheels.length; i++) {
      const A = wheels[i - 1], B = wheels[i];
      const dir = Math.atan2(B.y - A.y, B.x - A.x);
      const pA = TAU / A.z, pB = TAU / B.z;
      const fA = ((((dir - off[i - 1]) / pA) % 1) + 1) % 1;
      const fB = (((0.5 - fA) % 1) + 1) % 1;
      off.push(dir + Math.PI - fB * pB);
    }
    anim.push((tau) => {
      const th = drive(tau);
      let ang = th;
      wheels.forEach((w, i) => {
        if (i) ang = -ang * (wheels[i - 1].z / w.z);
        w.m.rotation.y = ang + off[i] - (i ? 0 : 0);
      });
    });
    // (les rapports s'enchaînent : chaque roue tourne à −z_précédente / z fois la précédente)
    return wheels;
  }

  // prolonge un rouage autour de l'anneau jusqu'à l'angle aEnd (roues alternées)
  function fillSpecs(a0, first, m, pattern, aEnd) {
    const specs = first.slice();
    let a = a0;
    for (let i = 1; i < specs.length; i++) a += 2 * Math.asin(((specs[i - 1].z + specs[i].z) * m) / 4 / rc);
    for (let i = 0; i < 80; i++) {
      const z = pattern[i % pattern.length], prev = specs[specs.length - 1];
      const da = 2 * Math.asin(((prev.z + z) * m) / 4 / rc);
      if (a + da + 0.12 > aEnd) break;
      a += da;
      specs.push({ z, h: i % 2 ? 0.012 : 0.017 });
    }
    return specs;
  }

  // un pont vissé : du bord du plateau au-dessus d'une roue, rubis au centre
  function bridge(x, y, h, len = 0.14 * sc) {
    const a = Math.atan2(y, x), rr = Math.hypot(x, y);
    const s = new THREE.Shape(), w = 0.022 * sc;
    s.absarc(0, 0, w * 0.8, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.lineTo(len, -w * 0.5); s.absarc(len, 0, w * 0.5, -Math.PI / 2, Math.PI / 2, false); s.closePath();
    const b = mesh(keep(flat(s, 0.004, 0.4)), mats.bridge);
    b.rotation.y = a; place(b, x, y, h);
    place(mesh(keep(cyl(0.0042, 0.0012, 12)), mats.jewel, false), x, y, h + 0.002);
    const [sx, sy] = [x + Math.cos(a) * len * 0.8, y + Math.sin(a) * len * 0.8];
    place(mesh(keep(cyl(0.005, 0.0016, 12)), mats.screw, false), sx, sy, h + 0.002);
    // pilier sous l'extrémité extérieure
    place(mesh(keep(cyl(0.006, h - 0.002)), mats.pins), x + Math.cos(a) * len, y + Math.sin(a) * len, 0);
    return rr;
  }

  if (archetype === 'horlogerie') {
    // balancier spiral
    const aB = 0.25, [bx, by] = polar(rc, aB), rb = 0.075 * sc;
    const bal = new THREE.Group();
    const rim = mesh(keep(new THREE.TorusGeometry(rb, 0.0045 * sc, 8, 64)), mats.gears); rim.rotation.x = Math.PI / 2; bal.add(rim);
    for (let i = 0; i < 3; i++) { const arm = mesh(keep(new THREE.BoxGeometry(rb * 2, 0.002, 0.004 * sc)), mats.gears); arm.rotation.y = (i / 3) * Math.PI; bal.add(arm); }
    for (let i = 0; i < 8; i++) { const sw = mesh(keep(cyl(0.004 * sc, 0.004)), mats.screw, false); const b = (i / 8) * TAU; sw.position.set(Math.cos(b) * rb, -0.002, Math.sin(b) * rb); bal.add(sw); }
    // spiral : une spirale plate sous le pont
    const sp = [];
    for (let i = 0; i <= 300; i++) { const t = i / 300, r = rb * (0.12 + 0.6 * t), b = t * TAU * 9; sp.push(new THREE.Vector3(Math.cos(b) * r, 0.006, Math.sin(b) * r)); }
    bal.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 600, 0.0007, 4, false)), mats.gears, false));
    place(bal, bx, by, 0.022);
    bridge(bx, by, 0.034, W * 0.5);
    const beat = 9;
    anim.push((tau) => { bal.rotation.y = 1.3 * Math.sin(beat * tau); });
    // échappement : la roue avance d'une dent par alternance, l'ancre bascule
    const zE = 20;
    const step = (tau) => { const x = (beat * tau) / Math.PI; const n = Math.floor(x); return (TAU / zE) * (n + ss5((x - n - 0.72) / 0.18)); };
    // rouage : de la roue d'échappement, tout autour de l'anneau, jusqu'au barillet
    const mT = 0.0034 * sc, aT0 = aB + 2 * Math.asin((rb + 0.05 * sc) / (2 * rc));
    const specs = fillSpecs(aT0, [{ z: zE, style: 'escape', h: 0.012 }, { z: 48, h: 0.017 }], mT, [64, 40, 72, 44], aB + TAU - 0.55);
    const train = geartrain(aT0, specs, mT, (tau) => -step(tau));
    // ancre entre balancier et roue d'échappement
    const E = train[0], [ax, ay] = [(bx + E.x) / 2, (by + E.y) / 2];
    const anchor = new THREE.Group();
    const bar = mesh(keep(new THREE.BoxGeometry(0.05 * sc, 0.003, 0.006 * sc)), mats.arms2); anchor.add(bar);
    for (const sd of [-1, 1]) { const st = mesh(keep(new THREE.BoxGeometry(0.008 * sc, 0.0035, 0.004 * sc)), mats.jewel, false); st.position.set(sd * 0.022 * sc, 0, 0.006 * sc); anchor.add(st); }
    anchor.rotation.y = Math.atan2(E.y - by, E.x - bx);
    place(anchor, ax, ay, 0.014);
    const a0 = anchor.rotation.y;
    anim.push((tau) => { anchor.rotation.y = a0 + 0.18 * Math.tanh(4 * Math.sin(beat * tau)); });
    // ponts sur les roues du rouage, barillet (rochet et cliquet) après la dernière
    for (const w of train.slice(1)) bridge(w.x, w.y, 0.026, W * 0.48);
    const last = train[train.length - 1], aBar = last.a + 2 * Math.asin((last.r + 0.11 * sc) / (2 * rc)), [rx, ry] = polar(rc, aBar);
    place(mesh(keep(cyl(0.1 * sc, 0.026, 64)), mats.gears), rx, ry, 0.001);
    const ratchet = mesh(gearGeometry(40, 0.085 * sc, { thick: 0.004, style: 'escape' }), mats.arms2);
    place(ratchet, rx, ry, 0.03);
    const click = mesh(keep(new THREE.BoxGeometry(0.035 * sc, 0.003, 0.006 * sc)), mats.arms2);
    click.rotation.y = -aBar + 0.6; place(click, rx + Math.cos(aBar + 0.7) * 0.1 * sc, ry + Math.sin(aBar + 0.7) * 0.1 * sc, 0.031);
    anim.push((tau) => { ratchet.rotation.y = tau * 0.05; });
  } else if (archetype === 'classique') {
    // anneau zodiacal : douze plaques gravées, alternées
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * TAU + 0.01, a1 = ((i + 1) / 12) * TAU - 0.01, s = new THREE.Shape();
      s.absarc(0, 0, plateR - 0.04, a0, a1, false); s.absarc(0, 0, rIn + 0.04, a1, a0, true); s.closePath();
      const pl = mesh(keep(flat(s, 0.003, 0.3)), i % 2 ? mats.arms : mats.arms2, false);
      place(pl, 0, 0, 0.0015);
      // le « signe » : un médaillon au milieu de la plaque
      const [x, y] = polar(rc, (a0 + a1) / 2);
      place(mesh(keep(cyl(0.022 * sc, 0.004, 24)), i % 2 ? mats.arms2 : mats.arms, false), x, y, 0.002);
    }
    dial(Math.PI * 0.5, 1, 0.075 * sc);
    // (la sphère armillaire au sommet est posée par la machine, si la voie est libre)
  } else if (archetype === 'atelier') {
    // volant d'inertie à six bras, manivelle et bielle ; régulateur à boules ; courroie
    const aF = 0.4, [fx, fy] = polar(rc, aF), rF = 0.15 * sc;
    const fly = mesh(gearGeometry(1, rF, { thick: 0.014, style: 'pulley' }), mats.gears);
    place(fly, fx, fy, 0.03);
    place(mesh(keep(cyl(0.012, 0.045)), mats.pins), fx, fy, 0);
    const crank = new THREE.Group();
    const pin = mesh(keep(cyl(0.006, 0.02)), mats.pins); pin.position.set(rF * 0.7, 0.007, 0); crank.add(pin);
    place(crank, fx, fy, 0.03);
    const rod = mesh(keep(new THREE.BoxGeometry(1, 0.006, 0.01)), mats.arms2); g.add(rod);
    const slider = mesh(keep(new THREE.BoxGeometry(0.04, 0.02, 0.025)), mats.arms); g.add(slider);
    const tang = aF + Math.PI / 2, lRod = rF * 2.2;
    anim.push((tau) => {
      const th = tau * 1.5;
      fly.rotation.y = th; crank.rotation.y = th;
      // bielle : du maneton à une glissière sur la tangente de l'anneau
      // maneton (rotation.y = angle dans le plan)
      const mx = fx + Math.cos(th) * rF * 0.7, my = fy + Math.sin(th) * rF * 0.7;
      const ux = Math.cos(tang), uy = Math.sin(tang);
      const along = (mx - fx) * ux + (my - fy) * uy, perp = Math.hypot((mx - fx) - along * ux, (my - fy) - along * uy);
      const d = along + Math.sqrt(Math.max(0, lRod * lRod - perp * perp));
      const sx = fx + ux * d, sy = fy + uy * d;
      slider.position.set(sx, yPlate + 0.045, -sy);
      slider.rotation.y = tang;
      rod.position.set((mx + sx) / 2, yPlate + 0.045, -(my + sy) / 2);
      rod.scale.x = Math.hypot(sx - mx, sy - my);
      rod.rotation.y = Math.atan2(sy - my, sx - mx);
    });
    // régulateur à boules : broche, deux bras écartés, deux boules
    const aG = aF + 0.85, [gx, gy] = polar(rc, aG);
    place(mesh(keep(cyl(0.005, 0.16)), mats.pins), gx, gy, 0);
    const gov = new THREE.Group();
    for (const sd of [-1, 1]) {
      const armG = mesh(keep(new THREE.BoxGeometry(0.004, 0.09, 0.004)), mats.arms2); armG.position.set(sd * 0.03, -0.035, 0); armG.rotation.z = sd * 0.75; gov.add(armG);
      const ball = mesh(keep(new THREE.SphereGeometry(0.018 * sc, 20, 12)), mats.gears); ball.position.set(sd * 0.065, -0.07, 0); gov.add(ball);
    }
    place(gov, gx, gy, 0.16);
    anim.push((tau) => { gov.rotation.y = tau * 6; });
    // poulie au pied du régulateur et courroie jusqu'au volant
    const rP = 0.04 * sc;
    place(mesh(gearGeometry(1, rP, { thick: 0.01, style: 'pulley' }), mats.gears), gx, gy, 0.03);
    const belt = [];
    const dx = gx - fx, dy = gy - fy, L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), al = Math.asin((rF - rP) / L);
    for (let i = 0; i <= 40; i++) { const b = ang + Math.PI / 2 + al + (i / 40) * (Math.PI - 2 * al); belt.push(new THREE.Vector3(fx + Math.cos(b) * rF, yPlate + 0.03, -(fy + Math.sin(b) * rF))); }
    for (let i = 0; i <= 20; i++) { const b = ang - Math.PI / 2 - al + (i / 20) * (Math.PI + 2 * al) - Math.PI; belt.push(new THREE.Vector3(gx + Math.cos(b + Math.PI) * rP, yPlate + 0.03, -(gy + Math.sin(b + Math.PI) * rP))); }
    g.add(mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(belt, true), 160, 0.003, 5, true)), mats.belt, false));
    // un rouage de roues de fonte tout autour, mené par un pignon du volant
    const mA = 0.0045 * sc, aA0 = aG + 2 * Math.asin((0.05 * sc + 0.06 * sc) / (2 * rc));
    const specsA = fillSpecs(aA0, [{ z: 26, h: 0.014 }], mA, [44, 30, 52, 30], aF + TAU - 0.35);
    const ringA = geartrain(aA0, specsA, mA, (tau) => tau * 1.5);
    for (const w of ringA.filter((_, i) => i % 2)) bridge(w.x, w.y, 0.028, W * 0.46);
  } else if (archetype === 'astrolabe') {
    // araignée : un anneau ajouré à pointes, qui tourne lentement sur le tympan
    const s = new THREE.Shape();
    s.absarc(0, 0, plateR - 0.035, 0, TAU, false);
    const inner = new THREE.Path(); inner.absarc(0, 0, rIn + 0.03, 0, TAU, true); s.holes.push(inner);
    const nH = 36;
    for (let i = 0; i < nH; i++) {
      const a = (i / nH) * TAU, h = new THREE.Path();
      h.absarc(Math.cos(a) * rc, Math.sin(a) * rc, W * 0.16, 0, TAU, true);
      s.holes.push(h);
    }
    const rete = new THREE.Group();
    rete.add(mesh(keep(flat(s, 0.004, 0.3)), mats.arms));
    // pointes d'étoiles (flammes) vers l'intérieur
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.2, fl = new THREE.Shape(), r0 = rIn + 0.03;
      fl.moveTo(r0, -0.018); fl.lineTo(r0 - 0.07 * sc, 0); fl.lineTo(r0, 0.018); fl.closePath();
      const f = mesh(keep(flat(fl, 0.003, 0)), mats.arms2, false); f.rotation.y = a; rete.add(f);
    }
    place(rete, 0, 0, 0.02);
    for (let i = 0; i < 6; i++) { const [x, y] = polar(plateR - 0.06, (i / 6) * TAU); place(mesh(keep(cyl(0.008, 0.02)), mats.pins), x, y, 0); }
    anim.push((tau) => { rete.rotation.y = tau * 0.08; });
    // tympan : cercles décentrés (almucantarats) gravés sous l'araignée
    for (let i = 1; i <= 5; i++) {
      const n = 240, pts = new Float32Array(n * 2), r = rc * (0.3 + 0.12 * i), oy = rc * 0.25 * (1 - i / 6);
      for (let k = 0; k < n; k++) { const a = (k / n) * TAU; pts[2 * k] = Math.cos(a) * r; pts[2 * k + 1] = Math.sin(a) * r + oy; }
      const m2 = new THREE.Mesh(keep(ribbonGeometry(pts, 0.0025, yPlate + 0.0004)), engrave);
      g.add(m2);
    }
  }

  void center;
  return { group: g, update: (tau) => { for (const f of anim) f(tau); } };
}
