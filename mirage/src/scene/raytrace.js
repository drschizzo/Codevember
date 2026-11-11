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
  positionGeometry, normalize, length, reflect, equirectUV, If, Loop, Break, sign, atan, step, mx_fractal_noise_float,
} from 'three/tsl';
import { TOP, TOP_TIP, CASE, CROWN, BOW, DIAL_Y, CANDLE, WICK, WAX_Y, TEA_R, FLAME_Y, COMPASS, CARD_Y, PIVOT, NEEDLE, COMP_RING, COIN, COINS, BOUND } from '../gen/profiles.js';
import { G } from './globals.js';

const BIG = 1e6;

export function createRaytrace({ lite = false, kind = 0 } = {}) {
  const v3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
  const col = (h) => uniform(new THREE.Color(h));
  const U = {
    f: uniform(0.05), lift: uniform(0), holeR: uniform(0.021), rimR: uniform(0.0707), shell: uniform(0.0025),
    tableY: uniform(-0.03), inner: col('#f2f0ea'), outer: col('#e8e4dc'), outerRough: uniform(0.18), engrave: uniform(1),
    table: col('#3a2a22'), tableRough: uniform(0.7), tableKind: uniform(0), envI: uniform(1),
    keyDir: v3(0.4, 0.8, 0.3), keyCol: v3(2, 1.9, 1.8), ambient: v3(0.25, 0.25, 0.27),
    // l'objet
    kind: uniform(0), spin: uniform(0), tilt: uniform(0), hands: v3(0, 0, 0), needle: uniform(0), cardRot: uniform(0), flicker: uniform(0), objCol: col('#b33a2a'), objCol2: col('#e8d9b0'),
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
  const rot2 = (q, a) => vec2(q.x.mul(cos(a)).add(q.y.mul(sin(a))), q.y.mul(cos(a)).sub(q.x.mul(sin(a)))); // (repère tourné de a)
  // anneau couché à plat (tore d'axe y) ; cylindre d'axe y aux arêtes adoucies
  const sdRingFlat = (p, c, R, r) => length(vec2(length(p.xz.sub(vec2(c[0], 0))).sub(R), p.y.sub(c[1]))).sub(r);
  const sdCylR = (q, r, h, e) => {
    const dx = length(q.xz).sub(r - e), dy = abs(q.y).sub(h / 2 - e);
    return min(max(dx, dy), 0).add(length(vec2(max(dx, 0), max(dy, 0)))).sub(e);
  };
  // losange 2D (iq), demi-diagonales b
  const sdRhombus = (q, b) => {
    const a = abs(q), bb = vec2(...b);
    const h = clamp(bb.x.mul(bb.x.sub(a.x.mul(2))).sub(bb.y.mul(bb.y.sub(a.y.mul(2)))).div(dot(bb, bb)), -1, 1);
    const d = length(a.sub(bb.mul(vec2(float(1).sub(h), float(1).add(h))).mul(0.5)));
    return d.mul(sign(a.x.mul(b[1]).add(a.y.mul(b[0])).sub(b[0] * b[1])));
  };
  const coinSDF = (p, k) => { const c = COINS[k]; return sdCylR(p.sub(vec3(c.x, c.y + COIN.h / 2, c.z)), COIN.r, COIN.h, 0.00022); };

  // les objets (un shader par famille : seul l'objet de la scène est compilé)
  //  0 toupie : pointe d'acier, cône, bourrelet, dôme, tige et bouton
  //  1 montre : boîtier, couronne, bélière couchée
  //  2 chauffe-plat : godet, cire, mèche
  //  3 boussole : boîtier, pivot, aiguille, anneau
  //  4 pièces : pile de quatre pièces décalées
  const objSDF = (p) => {
    if (kind === 0) return sdRev(rotX(p, U.tilt), TOP);
    if (kind === 1) return min(min(sdRev(p, CASE), length(vec3(p.x.sub(CROWN[0]), p.y.sub(CROWN[1]), p.z)).sub(CROWN[2])), sdRingFlat(p, BOW, BOW[2], BOW[3]));
    if (kind === 2) return min(sdRev(p, CANDLE), max(length(p.xz).sub(WICK.r), abs(p.y.sub((WICK.y0 + WICK.y1) / 2)).sub((WICK.y1 - WICK.y0) / 2)));
    if (kind === 3) {
      const nq = rot2(p.xz, U.needle);
      const needle = max(sdRhombus(nq, [NEEDLE.len, NEEDLE.w / 2]), abs(p.y.sub(NEEDLE.y)).sub(NEEDLE.th));
      const pivot = max(length(p.xz).sub(PIVOT.r), abs(p.y.sub((CARD_Y + PIVOT.y1) / 2)).sub((PIVOT.y1 - CARD_Y) / 2));
      const knob = length(vec3(p.x.sub(0.0118), p.y.sub(COMP_RING[1]), p.z)).sub(0.0009);
      return min(min(min(sdRev(p, COMPASS), needle), min(pivot, knob)), sdRingFlat(p, COMP_RING, COMP_RING[2], COMP_RING[3]));
    }
    let d = coinSDF(p, 0);
    for (let k = 1; k < COINS.length; k++) d = min(d, coinSDF(p, k));
    return d;
  };

  // couleur de l'objet au point p (repère objet), de normale n, vu depuis v
  // cav : vu par les miroirs (dans la cavité close, l'objet est éclairé par la
  // lumière entrée par l'ouverture et renvoyée de tous côtés par l'argent :
  // un éclairage enveloppant, plus fort par-dessus, au lieu de la lampe seule)
  const shadeObj = (p, n, v, cav) => {
    const kd = normalize(U.keyDir);
    const lamKey = max(dot(n, kd), 0);
    const lamCav = n.y.mul(0.35).add(0.65).mul(0.75);
    const lam = mix(lamKey, lamCav, cav);
    const rv = reflect(v, n);
    const spec = pow(max(dot(rv, kd), 0), 60);
    const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(dot(n, v.negate()), 0)), 5)));
    const light = U.ambient.add(U.keyCol.mul(lam));
    // un métal : la couleur teinte le reflet du décor (flouté selon la rugosité) et de la lampe
    const metal = (c, rough) => c.mul(env(rv, float(rough)).mul(0.85).add(light.mul(0.25))).add(c.mul(spec).mul(1.4));
    // un vernis (laque, émail, cire) : diffus + reflet de Fresnel
    const lacquer = (c, k = 1) => c.mul(light).add(env(rv, float(0.05)).mul(fres).mul(k)).add(spec.mul(0.5 * k));
    const out = vec3(0).toVar();
    if (kind === 0) {
      // toupie : laque à deux tons, filets d'or, spirale peinte sur le dôme qui
      // tourne avec elle, pointe d'acier, bouton de buis
      const q = rotY(rotX(p, U.tilt), U.spin.negate());
      const r = length(q.xz), a = atan(q.z, q.x);
      const sw = step(0.5, fract(a.mul(3 / Math.PI).add(r.mul(260)))); // (spirale)
      const body = mix(U.objCol, U.objCol2, sw.mul(step(0.0061, q.y)).mul(step(r, 0.0094)));
      const bands = step(0.5, fract(q.y.mul(700))).mul(step(0.0016, q.y)).mul(step(q.y, 0.0036));
      const c = mix(body, U.objCol2, bands);
      const gold = step(abs(q.y.sub(0.0049)), 0.00022).add(step(abs(q.y.sub(0.0063)), 0.00018)).add(step(abs(r.sub(0.0035)), 0.0002).mul(step(0.0072, q.y)));
      const wood = vec3(0.62, 0.45, 0.26);
      const lac = lacquer(mix(c, select(q.y.greaterThan(0.0094), wood, c), 1));
      const g = metal(vec3(1.0, 0.78, 0.4), 0.2);
      const steel = metal(vec3(0.62, 0.63, 0.66), 0.12);
      out.assign(select(q.y.lessThan(TOP_TIP), steel, mix(lac, g, min(gold, 1))));
    } else if (kind === 1) {
      // montre : cadran émaillé bleu nuit guilloché en soleil, chemin de fer,
      // index et aiguilles dorés, petite seconde à 6 h, lunette moletée, bélière
      const r = length(p.xz), a = atan(p.z, p.x);
      const onDial = step(DIAL_Y - 0.0002, p.y).mul(step(r, 0.0115));
      const sun = sin(a.mul(180)).mul(0.5).add(0.5).mul(0.12).add(0.94);
      const idx = step(0.9, fract(a.mul(12 / (2 * Math.PI)).add(0.45))).mul(step(0.0080, r)).mul(step(r, 0.0104));
      const track = step(abs(r.sub(0.0108)), 0.00012).add(step(0.8, fract(a.mul(60 / (2 * Math.PI)).add(0.4))).mul(step(abs(r.sub(0.01095)), 0.00045)));
      const hand = (ang, L, w, c) => {
        const q2 = rot2(p.xz.sub(vec2(...c)), ang);
        return step(-0.0012, q2.x).mul(step(q2.x, L)).mul(step(abs(q2.y), mix(float(w), float(w * 0.25), clamp(q2.x.div(L), 0, 1))));
      };
      const sub = vec2(-0.0056, 0), sr = length(p.xz.sub(sub));
      const subRing = step(abs(sr.sub(0.0024)), 0.0001).add(step(0.85, fract(atan(p.z.sub(sub.y), p.x.sub(sub.x)).mul(12 / (2 * Math.PI)))).mul(step(abs(sr.sub(0.0021)), 0.0003)));
      const hands = max(max(hand(U.hands.x, 0.0062, 0.0008, [0, 0]), hand(U.hands.y, 0.0094, 0.0006, [0, 0])), hand(U.hands.z, 0.0020, 0.00018, [-0.0056, 0]));
      const marks = min(idx.add(track).add(subRing).add(hands).add(step(r, 0.0006)), 1);
      const enamel = vec3(0.03, 0.045, 0.11).mul(sun).mul(select(sr.lessThan(0.0024), float(0.8), float(1)));
      const dial = mix(lacquer(enamel, 0.7), metal(vec3(1.0, 0.84, 0.52), 0.15), marks);
      const knurl = step(0.5, fract(a.mul(90 / Math.PI))).mul(step(0.0118, r)).mul(step(DIAL_Y - 0.0008, p.y));
      const gold = metal(vec3(0.95, 0.76, 0.42).mul(float(1).sub(knurl.mul(0.25))), 0.12);
      out.assign(mix(gold, dial, onDial));
    } else if (kind === 2) {
      // chauffe-plat : godet d'aluminium embouti (cannelures), cire colorée qui
      // s'éclaire de sa flamme, mèche noircie
      const r = length(p.xz), a = atan(p.z, p.x);
      const flute = sin(a.mul(48)).mul(0.5).add(0.5);
      const alu = metal(vec3(0.78, 0.79, 0.82).mul(flute.mul(0.18).add(0.82)), 0.18);
      const fl = vec3(1.0, 0.6, 0.25).mul(smoothstep(0.012, 0.0, length(p.sub(vec3(0, FLAME_Y, 0)))).mul(0.9));
      const wax = U.objCol.mul(U.ambient.mul(0.5).add(U.keyCol.mul(lam).mul(0.35)).add(fl)).add(env(rv, float(0.15)).mul(fres).mul(0.5));
      const isWick = step(p.y, WICK.y1 + 0.0001).mul(step(WICK.y0 + 0.0001, p.y)).mul(step(r, WICK.r * 1.6));
      const isAlu = step(TEA_R - 0.0002, r).max(step(p.y, WAX_Y - 0.0002));
      out.assign(mix(mix(wax, alu, isAlu), vec3(0.02).add(fl.mul(0.2)), isWick));
    } else if (kind === 3) {
      // boussole : rose des vents à huit pointes sur carton ivoire, couronne de
      // degrés, aiguille rouge (nord) et acier bleui (sud), boîtier de laiton
      const r = length(p.xz), a = atan(p.z, p.x).sub(U.cardRot);
      const onCard = step(p.y, CARD_Y + 0.0002).mul(step(r, 0.0099));
      const sector = fract(a.mul(4 / Math.PI)), k = abs(sector.sub(0.5)).mul(2); // (0 au milieu d'un secteur, 1 sur une pointe)
      const main = step(fract(floor(a.mul(4 / Math.PI).add(0.5)).mul(0.5)), 0.25); // (pointes cardinales : la pointe la plus proche est d'indice pair)
      const rStar = mix(float(0.0022), select(main.greaterThan(0.5), float(0.0086), float(0.0060)), pow(k, 3));
      const star = step(r, rStar), half = step(0.5, sector);
      const ring = step(abs(r.sub(0.0093)), 0.0001).add(step(0.75, fract(a.mul(36 / Math.PI))).mul(step(abs(r.sub(0.0096)), 0.0003)));
      const north = step(abs(a), 0.06).mul(step(0.0086, r)).mul(step(r, 0.0098));
      const ink = vec3(0.12, 0.1, 0.09), red = vec3(0.62, 0.08, 0.06);
      const card = mix(mix(U.objCol2, mix(ink, U.objCol2.mul(0.55), half), star), ink, min(ring, 1));
      const cardC = lacquer(mix(card, red, north), 0.4);
      const nq = rot2(p.xz, U.needle);
      const onNeedle = step(abs(p.y.sub(NEEDLE.y)), NEEDLE.th + 0.00008).mul(step(PIVOT.r * 1.05, length(p.xz)));
      const needle = select(nq.x.greaterThan(0), lacquer(U.objCol, 0.8), metal(vec3(0.22, 0.28, 0.5), 0.1));
      const brass = metal(vec3(0.95, 0.75, 0.42), 0.16);
      out.assign(mix(mix(brass, cardC, onCard.mul(step(PIVOT.r * 1.1, r))), needle, onNeedle));
    } else {
      // pièces d'or : grènetis au bord, filet, couronne de perles (la légende),
      // soleil rayonnant au centre ; tranche cannelée
      const c3 = vec3(0).toVar(), best = float(1).toVar(), rot = float(0).toVar();
      for (let k = 0; k < COINS.length; k++) {
        const d = abs(coinSDF(p, k));
        If(d.lessThan(best), () => { best.assign(d); c3.assign(vec3(COINS[k].x, 0, COINS[k].z)); rot.assign(COINS[k].rot); });
      }
      const q = rot2(p.xz.sub(c3.xz), rot), r = length(q), a = atan(q.y, q.x);
      const face = step(0.7, abs(n.y));
      const dent = step(0.5, fract(a.mul(70 / Math.PI))).mul(step(0.0080, r));
      const fil = step(abs(r.sub(0.0077)), 0.00012);
      const pearls = step(length(vec2(r.sub(0.0068), fract(a.mul(18 / Math.PI)).sub(0.5).mul(r).mul(Math.PI / 9))), 0.00028);
      const rays = step(0.55, fract(a.mul(8 / Math.PI))).mul(step(0.0018, r)).mul(step(r, mix(float(0.0058), float(0.0040), step(0.5, fract(a.mul(4 / Math.PI))))));
      const boss = step(r, 0.0018);
      const relief = face.mul(min(dent.add(fil).add(pearls).add(rays).add(boss), 1));
      const edge = float(1).sub(face).mul(step(0.5, fract(a.mul(110 / Math.PI))));
      const base = U.objCol.mul(float(1).sub(edge.mul(0.3)));
      out.assign(mix(metal(base.mul(0.82), 0.3), metal(base, 0.06), relief));
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
        const sh = float(1); // (l'ombre portée vient de la carte d'ombre, sur le plan posé sur la table)
        const occ = smoothstep(U.rimR.mul(0.3), U.rimR.mul(1.25), r).mul(0.7).add(0.3);
        const lam = max(normalize(U.keyDir).y, 0);
        // la matière : 0 noyer en lames, 1 chêne d'établi, 2 marbre veiné, 3 feutre
        const tk = U.tableKind;
        // bois : lames de 8,5 cm, aboutées en quinconce ; chaque lame a sa teinte
        // et son morceau de grume — cernes de croissance coupés en biais (dessin
        // en flammes qui dérive le long de la lame), bois d'été plus sombre,
        // fibres et pores fins dans le fil, joints creux
        const BW = 0.085, BL = 0.62;
        const row = floor(p.z.div(BW)), v = p.z.sub(row.mul(BW));
        const xs = p.x.add(hash(vec2(row, 3.7)).mul(BL));
        const board = floor(xs.div(BL)), uu = xs.sub(board.mul(BL));
        const sB = hash(vec2(row, board)), sB2 = hash(vec2(board.add(11.3), row));
        const drift = mx_fractal_noise_float(vec3(uu.mul(2.2), sB.mul(17), 0.3), 3, 2, 0.5).mul(0.03);
        const wob = mx_fractal_noise_float(vec3(uu.mul(9), v.mul(40), sB2.mul(9)), 2, 2, 0.5).mul(0.0025);
        const rr = length(vec2(v.sub(BW * 0.5).sub(sB.sub(0.5).mul(BW * 1.4)).add(drift), sB2.mul(0.05).add(0.012))).add(wob);
        const phase = fract(rr.mul(sB.mul(260).add(480)));
        const late = smoothstep(0.7, 0.92, phase).mul(float(1).sub(smoothstep(0.96, 1.0, phase)));
        const fiber = mx_fractal_noise_float(vec3(uu.mul(40), v.mul(1800), sB.mul(31)), 4, 2, 0.6).mul(0.26);
        const pores = smoothstep(0.55, 0.85, mx_fractal_noise_float(vec3(uu.mul(240), v.mul(5200), sB2.mul(13)), 1, 2, 0.5)).mul(late.mul(0.5).add(0.2)).mul(0.25);
        const seam = float(1).sub(smoothstep(0.0, 0.0007, min(v, float(BW).sub(v)))).add(float(1).sub(smoothstep(0.0, 0.0006, min(uu, float(BL).sub(uu))))).min(1);
        const tint = vec3(1, 0.97, 0.93).mul(sB.mul(0.32).add(0.84)).add(vec3(0.05, 0.0, -0.04).mul(sB2.sub(0.5)));
        const figure = mx_fractal_noise_float(vec3(uu.mul(6), v.mul(90), sB2.mul(5)), 3, 2, 0.5).mul(0.1); // (nuages du fil)
        const woodC = tint.mul(mix(float(1.08), float(0.8), late).add(fiber).add(figure).sub(pores)).mul(float(1).sub(seam.mul(0.5)));
        const wood = woodC;
        const grainW = fiber.mul(6);
        const scratch = smoothstep(0.985, 1.0, sin(p.x.mul(900).add(p.z.mul(310)).add(grainW.mul(40))).mul(0.5).add(0.5)).mul(0.25);
        // marbre : veines fines sur un fond nuageux, le long d'un domaine déformé
        const wq = p.xz.mul(9).add(vec2(mx_fractal_noise_float(vec3(p.xz.mul(5), 1.7), 4, 2, 0.5), mx_fractal_noise_float(vec3(p.xz.mul(5), 4.2), 4, 2, 0.5)).mul(1.1));
        const mn = mx_fractal_noise_float(vec3(wq, 3.1), 5, 2, 0.5);
        const cloud = mx_fractal_noise_float(vec3(p.xz.mul(22), 0.7), 4, 2, 0.55);
        const marble = float(1).sub(smoothstep(0.03, 0.0, abs(mn)).mul(0.28)).sub(smoothstep(0.16, 0.0, abs(mn)).mul(0.08)).add(cloud.mul(0.05));
        const felt = hash(floor(p.xz.mul(9000))).mul(0.12).add(0.94).mul(mx_fractal_noise_float(vec3(p.xz.mul(160), 1.3), 2, 2, 0.5).mul(0.1).add(1));
        const tex = select(tk.lessThan(1.5), wood.add(scratch.mul(tk)), vec3(select(tk.lessThan(2.5), marble, felt)));
        const c = U.table.mul(tex).mul(U.ambient.mul(occ).add(U.keyCol.mul(lam).mul(sh).mul(0.6)));
        const fresT = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(d.y.negate(), 0)), 5)));
        const gloss = select(tk.lessThan(2.5), select(tk.greaterThan(1.5), float(0.6), float(0.3).mul(float(1).sub(seam)).mul(late.mul(0.4).add(0.8))), float(0.0));
        out.addAssign(thr.mul(c.add(env(reflect(d, vec3(0, 1, 0)), U.tableRough).mul(fresT).mul(gloss.mul(occ)))));
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
