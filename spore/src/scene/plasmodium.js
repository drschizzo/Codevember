// Le plasmodium à l'écran : la nappe (une courbe de niveau de T, épaisse au
// front, amincie derrière en film) et les veines (tubes posés sur le bois,
// rayon lu dans la table des instantanés de Tero, vidés dans les perles à la
// condensation). Les deux sont un gel jaune, humide et translucide ; les
// granules coulent dans les veines dans le sens du flux (la navette) ; les
// veines battent d'une onde péristaltique (Alim et al., 2013) qui court de
// l'arrière vers le front.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, float, vec2, vec3, vec4, texture, smoothstep, mix, clamp, sin, abs, normalize, max as tmax, min as tmin,
  positionLocal, positionPrevious, normalLocal, positionGeometry, modelViewMatrix, normalViewGeometry, varying, fwidth, color, exp, dot, positionWorld,
} from 'three/tsl';
import { noise, perturb, stableVelocity, isLite, ditherThreshold } from './materials.js';
import { T as TL } from '../timeline.js';

const sst = (a, b, x) => smoothstep(float(a), float(b), x);
export const H_FRONT = 0.028, H_FILM = 0.005; // (cm : 0,28 mm au front, 50 µm de film)

// épaisseur de la nappe selon l'âge (phase depuis l'arrivée du front) et la phase
export function sheetThickness(age, s) {
  const rise = sst(0, 0.004, age);
  const thin = mix(float(H_FRONT), float(H_FILM), sst(0.02, 0.075, age));
  const condense = float(1).sub(sst(TL.condense[0], TL.condense[1], s).mul(0.85));
  return rise.mul(thin).mul(condense).mul(age.greaterThan(0).select(1, 0));
}
// battement : onde qui part de l'arrière (T petit) vers le front, période ~1,6 s
const pulse = (s, Tm, amp) => sin(s.mul(25).sub(Tm.mul(160))).mul(amp).mul(sst(0.1, 0.16, s)).mul(float(1).sub(sst(0.4, 0.47, s)));

function gelMaterial(ctx, { colorNode, normalNode, thick, saturate = 1 }) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  // (les veines, plus épaisses, sont d'un jaune plus dense que le film)
  const c0 = new THREE.Color(ctx.sp.plasmodium), hsl = {};
  c0.getHSL(hsl); c0.setHSL(hsl.h, Math.min(1, hsl.s * saturate), hsl.l * (saturate > 1 ? 0.92 : 1));
  const base = color(c0);
  // translucide : plus épais = plus saturé et plus sombre (Beer-Lambert), bord mince pâle
  const k = clamp(thick.div(H_FRONT), 0, 1.6);
  const deep = base.pow(saturate > 1 ? 1.25 : 1.6).mul(0.95);
  m.colorNode = colorNode ? colorNode(mix(base, deep, k.mul(0.55))) : mix(base, deep, k.mul(0.55));
  m.roughnessNode = float(0.32);
  m.clearcoatNode = float(1);
  m.clearcoatRoughnessNode = float(0.06);
  m.metalnessNode = float(0);
  // diffusion sous la surface : la lumière ressort, teintée, d'autant plus que la nappe est mince
  m.emissiveNode = base.mul(base).mul(saturate > 1 ? 0.12 : 0.05).mul(float(1.2).sub(k.mul(0.5)));
  if (normalNode) m.normalNode = normalNode;
  m.mrtNode = stableVelocity();
  return m;
}

export function createPlasmodium(ctx) {
  const { S, U, Wn, Tat, inBox, TX, R, sp } = ctx;
  const meshes = [];
  // ── la nappe ──
  const Sh = S.sheet, step = 1;
  const nx = Math.floor((Sh.Gx - 1) / step), nz = Math.floor((Sh.Gz - 1) / step);
  const geo = new THREE.PlaneGeometry(Sh.h * (Sh.Gx - 1), Sh.h * (Sh.Gz - 1), nx, nz).rotateX(-Math.PI / 2);
  geo.translate(Sh.x0 + (Sh.h * (Sh.Gx - 1)) / 2, 0, Sh.z0 + (Sh.h * (Sh.Gz - 1)) / 2);
  const sheetAt = (x, z, s, level) => {
    const T = Tat(x, z, level);
    return { T, h: sheetThickness(s.sub(T), s) };
  };
  const pos = (s) => Fn(() => {
    const p = positionLocal;
    const { T, h } = sheetAt(p.x, p.z, s, true);
    const hp = h.mul(pulse(s, T, 0.1).add(1));
    // le gel remplit les creux : sa surface est au-dessus du bois lissé, jamais
    // sous le bois (hors de la nappe : sous le bois ; la frontière exacte est
    // découpée au pixel)
    const xw = p.x.add(U.xoff), wood = Wn.height(xw, p.z);
    const y = hp.greaterThan(0.00005).select(tmax(wood.add(0.0004), Wn.smooth(xw, p.z).add(hp)), wood.sub(0.004));
    return vec3(p.x.add(U.xoff), y, p.z);
  })();
  const sm = (() => {
    const g = positionGeometry;
    const { T, h } = sheetAt(g.x, g.z, U.s, false);
    // canaux fins de l'éventail : stries allongées dans le sens de l'avancée (∇T)
    const e = Sh.h * 1.5;
    const gx = Tat(g.x.add(e), g.z).sub(Tat(g.x.sub(e), g.z)), gz = Tat(g.x, g.z.add(e)).sub(Tat(g.x, g.z.sub(e)));
    const gd = normalize(vec2(gx, gz).add(vec2(1e-6, 0)));
    const along = g.x.mul(gd.x).add(g.z.mul(gd.y)), across = g.x.mul(gd.y).sub(g.z.mul(gd.x));
    const streak = noise(vec3(across.mul(140), along.mul(14), 0.3)).mul(0.5).add(0.5);
    const hh = h.mul(streak.mul(0.45).add(0.75));
    const xw = g.x.add(U.xoff);
    const surf = tmax(Wn.height(xw, g.z).add(0.0004), Wn.smooth(xw, g.z).add(hh));
    const m = gelMaterial(ctx, { thick: hh, normalNode: perturb(surf, normalViewGeometry), colorNode: (c) => c.mul(streak.mul(0.25).add(0.85)) });
    // un film translucide derrière le front, opaque dans le front ; il se retire
    // dans les perles à la condensation
    m.transparent = true;
    m.opacityNode = clamp(hh.sub(H_FILM).div(H_FRONT * 0.55), 0, 1).mul(0.86).add(0.09).mul(float(1).sub(sst(TL.condense[0], TL.condense[1] - 0.02, U.s)));
    const age = U.s.sub(T);
    m.maskNode = age.greaterThan(0).and(h.greaterThan(0.00008)).and(inBox(g.x, g.z)).and(U.s.lessThan(TL.condense[1]));
    return m;
  })();
  sm.positionNode = Fn(() => { const q = pos(U.s); if (!isLite()) positionPrevious.assign(pos(U.sPrev)); return q; })();
  sm.castShadowPositionNode = pos(U.s);
  sm.maskShadowNode = Tat(positionGeometry.x, positionGeometry.z).lessThan(U.s);
  const sheet = new THREE.Mesh(geo, sm);
  sheet.castShadow = false; sheet.receiveShadow = true; sheet.frustumCulled = false; sheet.renderOrder = 2;
  meshes.push(sheet);

  // ── les veines ──
  const V = S.veins, E = S.edges;
  const vg = new THREE.BufferGeometry();
  vg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V.count * 3), 3));
  vg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(V.count * 3).fill(0.5), 3));
  vg.setAttribute('vc', new THREE.BufferAttribute(V.c, 4));
  vg.setAttribute('vo', new THREE.BufferAttribute(V.o, 4));
  vg.setAttribute('ve', new THREE.BufferAttribute(V.e, 2));
  vg.setIndex(new THREE.BufferAttribute(V.index, 1));
  vg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
  const kOf = (s) => clamp(s.sub(E.s0).div(E.s1 - E.s0).mul(E.K - 1), 0, E.K - 1);
  const row = (r, s) => texture(TX.edges, vec2(kOf(s).add(0.5).div(E.K), r.add(0.5).div(E.rows))).level(0);
  const fruitNet = sp.mode === 'net';
  // rayon effectif d'une arête : instantané × battement × vidange (ou gonflement du fruit)
  const radius = (ed, s) => {
    const r = ed.x, drain = ed.z, Tm = ed.w;
    const isFruit = drain.lessThan(-0.5);
    const c = sst(0, 0.03, s.sub(float(TL.condense[0]).add(clamp(drain, 0, 1).mul(0.055))));
    const shrink = isFruit.select(float(1).add(sst(TL.condense[0], TL.rise[1], s).mul(0.45)), float(1).sub(c));
    return r.mul(pulse(s, Tm, 0.14).add(1)).mul(shrink);
  };
  const vc = attribute('vc', 'vec4'), vo = attribute('vo', 'vec4'), ve = attribute('ve', 'vec2');
  const vRad = varying(float(0), 'vRad'), vFlux = varying(float(0), 'vFlux'), vTop = varying(float(0), 'vTop'), vOpen = varying(float(0), 'vOpen');
  const place = (s, write) => {
    const ea = row(ve.x, s), eb = row(ve.y, s);
    const r = mix(radius(ea, s), radius(eb, s), vo.w);
    const q = mix(ea.y, eb.y, vo.w);
    const tx = vc.z, tz = vc.w;
    const side = vec3(tz.negate(), 0, tx), up = vec3(0, 1, 0), tan = vec3(tx, 0, tz);
    const xw = vc.x.add(U.xoff);
    const yc = Wn.height(xw, vc.y);
    let off = side.mul(vo.x.mul(r)).add(up.mul(vo.y.mul(0.62).add(0.4).mul(r))).add(tan.mul(vo.z.mul(r)));
    // Hemitrichia : mûrs, les tubes se fendent sur le dessus et moussent
    // d'élatères (un bourrelet doré, floconneux, qui gonfle hors de la fente)
    let op = float(0);
    if (fruitNet) {
      const isFruit = ea.z.lessThan(-0.5).and(eb.z.lessThan(-0.5));
      const hsh = clamp(ea.w.mul(7.1).fract(), 0, 1);
      op = isFruit.select(sst(TL.open[0], TL.open[1], s.sub(hsh.mul(0.05))), float(0));
      const fluff = noise(vec3(xw.mul(160), vc.y.mul(160), vo.x.mul(3))).mul(0.5).add(0.75);
      const top = clamp(vo.y, 0, 1);
      off = off.add(up.mul(top.mul(r).mul(op).mul(fluff).mul(1.3))).add(side.mul(vo.x.mul(r).mul(op).mul(0.35)));
    }
    if (write) {
      vRad.assign(r); vFlux.assign(q); vTop.assign(vo.y); vOpen.assign(op);
      normalLocal.assign(normalize(side.mul(vo.x).add(up.mul(vo.y.div(0.62))).add(tan.mul(vo.z))));
    }
    return vec3(xw, yc, vc.y).add(off);
  };
  const vm = gelMaterial(ctx, {
    thick: vRad.mul(1.2), saturate: 1.35,
    colorNode: (c) => {
      // granules qui coulent dans le sens du flux (navette)
      const along = dot(positionWorld.xz, vec2(vc.z, vc.w));
      const g = noise(vec3(along.mul(90).sub(vFlux.mul(U.s).mul(1800)), positionWorld.z.mul(40), 0.5)).mul(0.5).add(0.5);
      let col = c.mul(g.mul(0.35).add(0.82));
      if (fruitNet) {
        // les veines-fruits dorent : jaune pâle, or, puis or bruni (pas assombries par l'épaisseur)
        const Cf = sp.colors;
        const mat = sst(TL.mature[0], TL.mature[1], U.s), half = sst(TL.condense[0], TL.mature[0], U.s);
        const fc = mix(mix(color(new THREE.Color(Cf.young)), color(new THREE.Color(Cf.mid)), half), color(new THREE.Color(Cf.ripe)), mat);
        col = mix(col, fc.mul(g.mul(0.12).add(0.94)), half);
        col = mix(col, color(new THREE.Color(Cf.net)).mul(g.mul(0.3).add(0.85)), vOpen.mul(sst(0.1, 0.7, vTop)));
      }
      return col;
    },
  });
  if (fruitNet) {
    const fl = vOpen.mul(sst(0.1, 0.7, vTop));
    vm.roughnessNode = mix(mix(float(0.32), float(0.5), sst(TL.mature[0], TL.mature[1], U.s)), float(0.85), fl);
    vm.clearcoatNode = float(1).sub(sst(TL.rise[0], TL.mature[1], U.s));
    vm.sheenNode = fl.mul(0.9);
    vm.sheenColorNode = color(new THREE.Color(sp.colors.net));
  }
  vm.positionNode = Fn(() => { const q = place(U.s, true); if (!isLite()) positionPrevious.assign(place(U.sPrev, false)); return q; })();
  vm.castShadowPositionNode = place(U.s, false);
  const veins = new THREE.Mesh(vg, vm);
  veins.castShadow = true; veins.receiveShadow = true; veins.frustumCulled = false;
  meshes.push(veins);

  return {
    meshes,
    // mouillure du bois (point local) : la nappe l'a mouillé, il sèche après la fructification
    trailAt: (x, z) => {
      const T = Tat(x, z);
      const age = U.s.sub(T);
      return inBox(x, z).select(sst(0, 0.01, age).mul(float(1).sub(sst(0.55, 0.85, U.s))).mul(0.9), float(0));
    },
  };
}
