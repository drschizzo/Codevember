// Le lancer de rayons du mirascope, au pixel (un quadrilatère plein écran).
//
// Chaque pixel suit son rayon : il rencontre les faces extérieures des deux
// coupes (argent guilloché, qui reflète le studio), la table, ou passe par
// l'ouverture (ou par le jour du couvercle levé) dans la cavité, où il se
// réfléchit sur les faces intérieures argentées (même calcul que
// gen/mirascope.js : intersection d'un rayon et d'un paraboloïde, normale par
// le gradient) jusqu'à rencontrer l'objet, posé au fond — défini par une
// fonction de distance (sphere tracing) — ou ressortir vers le studio.
// L'image réelle au-dessus de l'ouverture n'est pas dessinée : elle se forme.
//
// Le quadrilatère écrit la profondeur de son premier impact, pour que le
// mécanisme (potence, bras, pied), dessiné ensuite comme des objets ordinaires,
// s'emboîte avec lui.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, vec2, vec3, vec4, float, screenUV, mix, clamp, abs, max, min, exp, sin, cos, sqrt, pow, fract, floor, dot,
  select, mrt, smoothstep, cameraProjectionMatrixInverse, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, cameraPosition,
  positionGeometry, normalize, length, reflect, equirectUV, If, Loop, Break, sign, atan, step,
} from 'three/tsl';
import { TOP, CASE, CROWN, DIAL_Y, CANDLE, WICK, WAX_Y, TEA_R, FLAME_Y, BOUND } from '../gen/profiles.js';
import { G } from './globals.js';

const BIG = 1e6;

export function createRaytrace({ lite = false, kind = 0 } = {}) {
  const v3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
  const col = (h) => uniform(new THREE.Color(h));
  const U = {
    f: uniform(0.05), lift: uniform(0), holeR: uniform(0.021), rimR: uniform(0.0707), shell: uniform(0.0025),
    tableY: uniform(-0.03), inner: col('#f2f0ea'), outer: col('#e8e4dc'), outerRough: uniform(0.18), engrave: uniform(1),
    table: col('#3a2a22'), tableRough: uniform(0.7), envI: uniform(1),
    keyDir: v3(0.4, 0.8, 0.3), keyCol: v3(2, 1.9, 1.8), ambient: v3(0.25, 0.25, 0.27),
    // l'objet
    kind: uniform(0), spin: uniform(0), tilt: uniform(0), hands: v3(0, 0, 0), flicker: uniform(0), objCol: col('#b33a2a'), objCol2: col('#e8d9b0'),
    time: uniform(0),
    debug: uniform(0), // (1 : couleur = où s'arrête le rayon — studio rouge, objet vert, table bleu, coque jaune, épuisé magenta)
  };
  const empty = new THREE.DataTexture(new Uint16Array(4 * 4), 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const T = { env: texture(empty) };

  const env = (d, rough = float(0)) => T.env.sample(equirectUV(d)).level(rough.mul(7)).rgb.mul(U.envI);
  const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

  // intersection avec y = a·r² + b, la plus proche au-delà de eps, r ∈ [rMin, rMax]
  // (forme stable : q = −½(B + sgn B·√D), t₁ = q/A, t₂ = C/q)
  const parab = (o, d, a, b, rMin, rMax) => {
    const A = a.mul(d.x.mul(d.x).add(d.z.mul(d.z)));
    const B = a.mul(o.x.mul(d.x).add(o.z.mul(d.z))).mul(2).sub(d.y);
    const C = a.mul(o.x.mul(o.x).add(o.z.mul(o.z))).add(b).sub(o.y);
    const D = B.mul(B).sub(A.mul(C).mul(4));
    const sD = sqrt(max(D, 0));
    const q = B.add(select(B.greaterThanEqual(0), sD, sD.negate())).mul(-0.5);
    const t1 = q.div(select(abs(A).lessThan(1e-12), float(1e-12), A)), t2 = C.div(select(abs(q).lessThan(1e-12), float(1e-12), q));
    const tl = min(t1, t2), th = max(t1, t2);
    const ok = (t) => {
      const p = o.add(d.mul(t)), r = length(p.xz);
      return t.greaterThan(1e-6).and(r.greaterThanEqual(rMin)).and(r.lessThanEqual(rMax)).and(D.greaterThanEqual(0));
    };
    return select(ok(tl), tl, select(ok(th), th, float(BIG)));
  };
  const nParab = (p, a) => normalize(vec3(p.x.mul(a).mul(2), -1, p.z.mul(a).mul(2)));

  // ── l'objet : fonctions de distance (repère de l'objet, y vers le haut, mètres) ──
  // profil de révolution polygonal (iq, sdPolygon), points (r, y)
  const sdRev = (p, pts) => {
    const q = vec2(length(p.xz), p.y);
    const v0 = vec2(...pts[0]);
    let d = dot(q.sub(v0), q.sub(v0)), s = float(1);
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
      const vi = vec2(...pts[i]), vj = vec2(...pts[j]);
      const e = vj.sub(vi), w = q.sub(vi);
      const b = w.sub(e.mul(clamp(dot(w, e).div(dot(e, e)), 0, 1)));
      d = min(d, dot(b, b));
      const c1 = q.y.greaterThanEqual(pts[i][1]), c2 = q.y.lessThan(pts[j][1]), c3 = e.x.mul(w.y).greaterThan(e.y.mul(w.x));
      s = s.mul(select(c1.and(c2).and(c3).or(c1.not().and(c2.not()).and(c3.not())), float(-1), float(1)));
    }
    return s.mul(sqrt(d));
  };
  const rotY = (p, a) => vec3(p.x.mul(cos(a)).sub(p.z.mul(sin(a))), p.y, p.x.mul(sin(a)).add(p.z.mul(cos(a))));
  const rotX = (p, a) => vec3(p.x, p.y.mul(cos(a)).sub(p.z.mul(sin(a))), p.y.mul(sin(a)).add(p.z.mul(cos(a))));
  // toupie : pointe d'acier, corps tourné, tige ; montre : boîtier, cadran, aiguilles ; bougie : cire, mèche
  const objSDF = (p) => {
    const top = kind === 0 ? sdRev(rotX(p, U.tilt), TOP) : null;
    const candle = kind === 2 ? min(sdRev(p, CANDLE), max(length(p.xz).sub(WICK.r), abs(p.y.sub((WICK.y0 + WICK.y1) / 2)).sub((WICK.y1 - WICK.y0) / 2))) : null; // (et sa mèche)
    const watch = kind === 1 ? min(sdRev(p, CASE), length(vec3(p.x.sub(CROWN[0]), p.y.sub(CROWN[1]), p.z)).sub(CROWN[2])) : null; // (boîtier et couronne)
    // (un shader par famille : seul l'objet de la scène est compilé)
    return kind === 0 ? top : kind === 1 ? watch : candle;
  };

  // couleur de l'objet au point p (repère objet), de normale n, vu depuis v
  // cav : vu par les miroirs (dans la cavité close, l'objet est éclairé par la
  // lumière entrée par l'ouverture et renvoyée de tous côtés par l'argent :
  // un éclairage enveloppant, plus fort par-dessus, au lieu de la lampe seule)
  const shadeObj = (p, n, v, cav) => {
    const lamKey = max(dot(n, normalize(U.keyDir)), 0);
    const lamCav = n.y.mul(0.35).add(0.65).mul(0.75);
    const lam = mix(lamKey, lamCav, cav);
    const spec = pow(max(dot(reflect(v, n), normalize(U.keyDir)), 0), 40);
    const out = vec3(0).toVar();
    if (kind === 0) {
      // toupie : laque à bandes, pointe d'acier, rayures qui tournent avec elle
      const q = rotY(rotX(p, U.tilt), U.spin.negate());
      const az = atan(q.z, q.x).mul(4 / Math.PI);
      const band = step(0.5, fract(q.y.mul(380)));
      const stripe = step(0.5, fract(az));
      const c = mix(U.objCol, U.objCol2, band.mul(step(0.006, q.y)).mul(step(q.y, 0.0098)).mul(stripe.mul(0.5).add(0.5)));
      const steel = vec3(0.6, 0.6, 0.62);
      const base = select(q.y.lessThan(0.0014), steel, c);
      out.assign(base.mul(U.ambient.add(U.keyCol.mul(lam))).add(spec.mul(0.6)));
    } else if (kind === 1) {
      // montre ouverte : cadran émaillé, index, aiguilles d'acier bleui
      const r = length(p.xz), a = atan(p.z, p.x);
      const onDial = step(DIAL_Y - 0.0002, p.y).mul(step(r, 0.0115));
      const tick = step(0.88, fract(a.mul(12 / (2 * Math.PI)).add(0.5))).mul(step(0.0086, r)).mul(step(r, 0.0112));
      const hand = (ang, L, w) => {
        const dir = vec2(cos(ang), sin(ang)), q2 = p.xz, along = dot(q2, dir), across = abs(q2.x.mul(dir.y).sub(q2.y.mul(dir.x)));
        return step(-0.0015, along).mul(step(along, L)).mul(step(across, w));
      };
      const hands = max(max(hand(U.hands.x, 0.0064, 0.0007), hand(U.hands.y, 0.0095, 0.00045)), hand(U.hands.z, 0.0104, 0.0002));
      const dial = mix(vec3(0.035, 0.05, 0.12), vec3(1.0, 0.82, 0.5), max(tick, hands)); // (émail bleu nuit, index et aiguilles dorés)
      const gold = vec3(0.95, 0.78, 0.45);
      const base = mix(gold, dial, onDial);
      out.assign(base.mul(U.ambient.add(U.keyCol.mul(lam))).add(gold.mul(spec).mul(float(1).sub(onDial.mul(0.7)))));
    } else {
      // bougie chauffe-plat : godet d'aluminium embouti, cire, mèche ; la
      // cire s'éclaire de sa flamme
      const r = length(p.xz);
      const alu = vec3(0.62, 0.63, 0.65).mul(U.ambient.add(U.keyCol.mul(lam))).add(spec.mul(0.9));
      const fl = vec3(1.0, 0.6, 0.25).mul(smoothstep(0.012, 0.0, length(p.sub(vec3(0, FLAME_Y, 0)))).mul(0.8));
      const wax = U.objCol.mul(U.ambient.mul(0.5).add(U.keyCol.mul(lam).mul(0.35)).add(fl));
      const isWick = step(p.y, WICK.y1 + 0.0001).mul(step(WICK.y0 + 0.0001, p.y)).mul(step(r, WICK.r * 1.6));
      const isAlu = step(TEA_R - 0.0002, r).max(step(p.y, WAX_Y - 0.0002));
      out.assign(mix(mix(wax, alu, isAlu), vec3(0.02), isWick));
    }
    return out;
  };
  const objNormal = (p) => {
    const e = 0.00012;
    return normalize(vec3(
      objSDF(p.add(vec3(e, 0, 0))).sub(objSDF(p.sub(vec3(e, 0, 0)))),
      objSDF(p.add(vec3(0, e, 0))).sub(objSDF(p.sub(vec3(0, e, 0)))),
      objSDF(p.add(vec3(0, 0, e))).sub(objSDF(p.sub(vec3(0, 0, e))))));
  };

  // l'argent guilloché de l'extérieur : cercles concentriques gravés
  const outerColor = (p, n, d) => {
    const r = length(p.xz);
    const guil = sin(r.mul(2600).add(sin(atan(p.z, p.x).mul(36)).mul(1.2))).mul(0.5).add(0.5).mul(U.engrave);
    const rough = U.outerRough.add(guil.mul(0.12));
    const R = reflect(d, n);
    const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(dot(n, d.negate()), 0)), 5)));
    const refl = env(R, rough).mul(U.outer).mul(mix(float(1), fres, 0.15));
    // le dessous du reflet voit la table
    return mix(refl, U.table.mul(0.15), smoothstep(0.0, -0.4, R.y).mul(0.7)).mul(float(1).sub(guil.mul(0.08)));
  };

  const result = Fn(() => {
    const ndc = vec4(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1), 1, 1);
    const vv = cameraProjectionMatrixInverse.mul(ndc);
    const o = cameraPosition.toVar(), d = normalize(cameraWorldMatrix.mul(vec4(vv.xyz.div(vv.w), 0)).xyz).toVar();
    const thr = vec3(1).toVar(), out = vec3(0).toVar(), firstT = float(BIG).toVar(), glow = vec3(0).toVar();
    const done = float(0).toVar(), dbg = vec3(1, 0, 1).toVar();
    const f = U.f, a = float(1).div(f.mul(4)), L = U.lift, t = U.shell;
    Loop({ start: 0, end: lite ? 6 : 9 }, ({ i }) => {
      // surfaces : intérieur bas (miroir), extérieur bas, intérieur haut (miroir), extérieur haut, table
      const tInLo = parab(o, d, a, float(0), float(0), U.rimR).toVar();
      const tOutLo = parab(o, d, a, t.negate(), float(0), U.rimR.add(t)).toVar();
      const tInHi = parab(o, d, a.negate(), f.add(L), U.holeR, U.rimR).toVar();
      const tOutHi = parab(o, d, a.negate(), f.add(L).add(t), U.holeR, U.rimR.add(t)).toVar();
      const tTab = select(d.y.lessThan(-1e-5), U.tableY.sub(o.y).div(d.y), float(BIG)).toVar();
      // l'objet : sphère englobante au fond, puis sphere tracing
      const tObj = float(BIG).toVar();
      const cav = min(float(i), 1);
      const oc = o.sub(vec3(0, BOUND.y, 0)), bb = dot(oc, d), cc = dot(oc, oc).sub(BOUND.r * BOUND.r), disc = bb.mul(bb).sub(cc);
      const tMin = min(min(min(tInLo, tOutLo), min(tInHi, tOutHi)), tTab).toVar();
      If(disc.greaterThan(0), () => {
        const t0 = max(bb.negate().sub(sqrt(disc)), 0), t1 = min(bb.negate().add(sqrt(disc)), tMin);
        // (sans Break : un Break dans cette boucle imbriquée interrompait aussi
        // la boucle des rebonds — les rayons de l'ouverture restaient sans couleur)
        const tt = t0.toVar(), going = float(1).toVar();
        Loop({ start: 0, end: lite ? 40 : 64, name: 'k' }, () => {
          If(going.greaterThan(0.5).and(tt.lessThanEqual(t1)), () => {
            const p = o.add(d.mul(tt));
            const ds = objSDF(p);
            If(ds.lessThan(0.00005), () => { tObj.assign(tt); going.assign(0); }).Else(() => {
              tt.addAssign(max(ds.mul(0.9), float(0.00004)));
            });
          });
        });
      });
      const tN = min(tMin, tObj).toVar();
      if (kind === 2) {
        // la flamme : une goutte d'émission ; on intègre sa lueur le long du
        // segment du rayon (au point le plus proche de son cœur, gaussienne)
        const c = vec3(sin(U.time.mul(11)).mul(0.0002).mul(U.flicker), FLAME_Y, 0);
        const ts = clamp(dot(c.sub(o), d), 0, min(tN, 1));
        const q = o.add(d.mul(ts)).sub(c), e2 = q.x.mul(q.x).add(q.z.mul(q.z)).mul(5).add(q.y.mul(q.y).mul(select(q.y.greaterThan(0), float(0.45), float(2.2))));
        const fl = float(0.9).add(U.flicker.mul(0.1).mul(sin(U.time.mul(17))));
        glow.addAssign(vec3(1.0, 0.55, 0.16).mul(exp(e2.div(-0.0000042))).mul(fl).mul(thr).mul(4).add(vec3(1, 0.32, 0.05).mul(exp(e2.div(-0.00004))).mul(thr).mul(0.18)));
      }
      If(i.equal(0), () => { firstT.assign(tN); });
      If(tN.greaterThanEqual(BIG * 0.5), () => {
        out.addAssign(thr.mul(env(d)));
        dbg.assign(vec3(1, 0, 0).mul(float(i).add(1).div(4)));
        done.assign(1); Break();
      });
      const p = o.add(d.mul(tN)).toVar();
      If(tObj.lessThanEqual(tMin), () => {
        out.addAssign(thr.mul(shadeObj(p, objNormal(p), d, cav)));
        dbg.assign(vec3(0, 1, 0).mul(float(i).add(1).div(4)));
        done.assign(1); Break();
      });
      If(tTab.lessThanEqual(tN), () => {
        // table : matière de l'humeur, ombre douce du mirascope, reflet du studio
        const r = length(p.xz);
        const sh = smoothstep(U.rimR.mul(0.6), U.rimR.mul(1.6), length(p.xz.sub(normalize(U.keyDir).xz.mul(U.rimR.mul(-0.25)))));
        const occ = smoothstep(U.rimR.mul(0.3), U.rimR.mul(1.25), r).mul(0.7).add(0.3);
        const lam = max(normalize(U.keyDir).y, 0);
        const grain = hash(floor(p.xz.mul(4000))).mul(0.06).add(0.97);
        const c = U.table.mul(grain).mul(U.ambient.mul(occ).add(U.keyCol.mul(lam).mul(sh).mul(0.6)));
        out.addAssign(thr.mul(c.add(env(reflect(d, vec3(0, 1, 0)), U.tableRough).mul(0.04))));
        dbg.assign(vec3(0, 0, 1).mul(float(i).add(1).div(4)));
        done.assign(1); Break();
      });
      If(tOutLo.lessThanEqual(tN).or(tOutHi.lessThanEqual(tN)), () => {
        const lo = tOutLo.lessThanEqual(tOutHi);
        const n = select(lo, nParab(p.sub(vec3(0, t.negate(), 0)), a), nParab(p.sub(vec3(0, f.add(L).add(t), 0)), a.negate()).negate());
        out.addAssign(thr.mul(outerColor(p, n, d)));
        dbg.assign(vec3(1, 1, 0).mul(float(i).add(1).div(4)));
        done.assign(1); Break();
      });
      // miroir intérieur : on se réfléchit et on continue
      const lo = tInLo.lessThanEqual(tInHi);
      const n = select(lo, nParab(p, a), nParab(p.sub(vec3(0, f.add(L), 0)), a.negate()).negate());
      thr.mulAssign(U.inner);
      // (le rayon réfléchi repart un peu devant la paroi, du côté où il va :
      // décalé selon la normale, il passait de l'autre côté de la coque mince)
      d.assign(reflect(d, n));
      o.assign(p.add(d.mul(2e-5)));
    });
    // (rayon encore piégé après tous les rebonds : on lui donne le studio)
    If(done.lessThan(0.5), () => { out.addAssign(thr.mul(env(d))); });
    out.addAssign(glow);
    return vec4(mix(out, dbg, U.debug), firstT);
  });

  const R = result();
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(R.rgb, 1);
  // profondeur du premier impact (pour que le mécanisme dessiné ensuite s'emboîte)
  const ndc0 = vec4(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1), 1, 1);
  const vv0 = cameraProjectionMatrixInverse.mul(ndc0);
  const d0 = normalize(cameraWorldMatrix.mul(vec4(vv0.xyz.div(vv0.w), 0)).xyz);
  const hitW = cameraPosition.add(d0.mul(min(R.w, 50)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(hitW, 1)));
  material.depthNode = clamp(clip.z.div(clip.w), 0, 1);
  material.depthWrite = true;
  material.depthTest = false;
  material.fog = false;
  material.toneMapped = false;
  if (!lite) material.mrtNode = mrt({ velocity: vec4(0) });
  material.vertexNode = vec4(positionGeometry.xy, 0.5, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quad.renderOrder = -10;
  void G; void sign;
  return { quad, material, U, T };
}
