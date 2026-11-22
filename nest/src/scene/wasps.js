// Les guêpes : un corps et des ailes instanciés (deux maillages, deux shaders),
// posés à chaque image par la chorégraphie (flight.js, temps physique) et
// animés par un squelette (gen/wasp.js) dans le vertex shader.
//
// Tampon d'instance (48 flottants) : position + échelle, quaternion, les mêmes
// à l'image précédente (vecteurs vitesse), pose (phase de marche, part du vol,
// phase du battement, ailes repliées) et pose précédente, gestes (mâchoires,
// antennes, tête, gastre) et gestes précédents, appui (corps soulevé, puis
// la correction du fémur de chaque patte, legs.js) et appui précédent.
//
// Le squelette : chaque sommet tourne autour des articulations de sa chaîne,
// de la plus lointaine à la plus proche (cinématique directe), puis antennes
// et mandibules suivent la tête. Démarche en trépied : trois pattes au sol
// (elles reculent sous le corps), trois en l'air (le fémur se lève, le tibia se
// replie) ; en vol, les pattes pendent vers l'arrière.
import * as THREE from 'three/webgpu';
import {
  Fn, If, attribute, vec3, vec4, float, int, cross, cos, sin, mix, smoothstep, step, abs, floor, fract, clamp, length, min as tmin,
  normalLocal, positionPrevious, positionGeometry, select, dot, uniformArray, normalViewGeometry, fwidth,
} from 'three/tsl';
import { noise, noise2, stableVelocity, perturb } from '../../../shared/scene/materials.js';
import { WINGS, WING_COPIES, EYE_U, EYE_W, skeleton } from '../gen/wasp.js';
import { nzIf } from './nz.js';

export const MAXW = 128, STRIDE = 48;

// rotation d'un vecteur par un quaternion (x, y, z, w)
const qrot = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
// rotation de Rodrigues autour d'un axe unitaire
const rot = (v, axis, a) => v.mul(cos(a)).add(cross(axis, v).mul(sin(a))).add(axis.mul(dot(axis, v).mul(cos(a).oneMinus())));

function instanceAttrs(geo, buf) {
  const ib = new THREE.InstancedInterleavedBuffer(buf, STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11'].forEach((k, q) => geo.setAttribute(k, new THREE.InterleavedBufferAttribute(ib, 4, 4 * q)));
  return ib;
}

export function createWasps(scene) {
  const buf = new Float32Array(MAXW * STRIDE);
  const SK = skeleton();
  const PIV = uniformArray(Array.from({ length: 48 }, (_, i) => new THREE.Vector4(SK.piv[i * 4], SK.piv[i * 4 + 1], SK.piv[i * 4 + 2], 0)), 'vec4');
  const AX = uniformArray(Array.from({ length: 48 }, (_, i) => new THREE.Vector4(SK.ax[i * 4], SK.ax[i * 4 + 1], SK.ax[i * 4 + 2], 0)), 'vec4');
  // deux niveaux de détail : les guêpes proches (modèle complet) en tête du
  // tampon, les lointaines (allégées) dans un second tampon ; ailes pour toutes
  const bufLo = new Float32Array(MAXW * STRIDE), bufAll = new Float32Array(MAXW * STRIDE);
  const bodyGeo = new THREE.InstancedBufferGeometry(), loGeo = new THREE.InstancedBufferGeometry(), wingGeo = new THREE.InstancedBufferGeometry();
  const ibB = instanceAttrs(bodyGeo, buf), ibL = instanceAttrs(loGeo, bufLo), ibW = instanceAttrs(wingGeo, bufAll);
  bodyGeo.instanceCount = loGeo.instanceCount = wingGeo.instanceCount = 0;
  const I = () => ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10', 'i11'].map((k) => attribute(k, 'vec4'));

  // ── le squelette : angle de l'articulation j de la chaîne, selon la pose et
  // (foulée : un balayage de ±0,42 rad à ~4 cm de la hanche, soit ~3,4 mm par
  // pas ; flight.js règle la phase sur le chemin parcouru : les pieds ne glissent pas)
  // les gestes. Une vraie branche par famille de chaîne : chaque sommet ne
  // calcule que les angles de la sienne (le shader évaluait tout, pour tous) ──
  const angleFn = [0, 1, 2, 3].map((j) => Fn(([chain, P, E, D, D2]) => {
    const r = float(0).toVar();
    const fly = P.y;
    If(chain.lessThan(5.5), () => { // pattes (trépied : avant et arrière d'un côté avec le milieu de l'autre)
      const pair = floor(chain.mul(0.5)), side = chain.sub(pair.mul(2)), sgn = side.mul(-2).add(1);
      const ph = P.x.add(fract(pair.add(side).mul(0.5)).mul(2 * Math.PI));
      const air = sin(ph).max(0).mul(fly.oneMinus());
      r.assign([
        cos(ph).mul(-0.42).mul(fly.oneMinus()).sub(fly.mul(0.45).mul(pair.mul(0.4).add(0.6))).mul(sgn),
        // (D.x : le corps soulevé, le fémur descend d'autant ; D.yzw, D2.xyz :
        // l'appui de chaque patte, la correction du fémur qui pose le tarse sur
        // le papier sous lui — legs.js)
        air.mul(0.42).sub(fly.mul(0.35)).sub(D.x.mul(28)).add(select(chain.lessThan(0.5), D.y, select(chain.lessThan(1.5), D.z, select(chain.lessThan(2.5), D.w, select(chain.lessThan(3.5), D2.x, select(chain.lessThan(4.5), D2.y, D2.z)))))),
        air.mul(-0.5).sub(fly.mul(0.55)).add(D.x.mul(14)),
        air.mul(0.25).add(fly.mul(0.3)),
      ][j]);
    }).ElseIf(chain.lessThan(7.5), () => { // antennes : elles palpent
      const as = chain.sub(6), asg = as.mul(-2).add(1), ap = E.y;
      r.assign([
        sin(ap.add(as.mul(1.7))).mul(0.2).sub(fly.mul(0.15)).mul(asg),
        sin(ap.mul(1.37).add(1).add(as)).mul(0.16).add(fly.mul(0.25)),
        sin(ap.mul(0.83).add(2).add(as.mul(0.6))).mul(0.28).sub(0.05),
        sin(ap.mul(1.1).add(as)).mul(0.1).mul(asg),
      ][j]);
    }).ElseIf(chain.lessThan(9.5), () => { // mandibules : elles s'ouvrent et se ferment
      if (j === 0) r.assign(sin(E.x).mul(0.5).add(0.5).mul(0.42).mul(chain.sub(8).mul(-2).add(1)).negate());
    }).ElseIf(chain.lessThan(10.5), () => { // tête : elle tourne, hoche en mâchant
      if (j === 0) r.assign(E.z.mul(0.18));
      if (j === 1) r.assign(sin(E.x).mul(0.05).sub(E.z.mul(0.05)));
    }).Else(() => { // gastre : il pompe
      if (j === 0) r.assign(sin(E.w).mul(0.045).sub(fly.mul(0.12)));
    });
    return r;
  }));
  const jointAngle = (chain, j, P, E, D, D2) => angleFn[j](chain, P, E, D, D2);
  // un sommet : sa chaîne, de l'articulation la plus lointaine à la plus proche
  const skin = (p0, n0, cd, P, E, D, D2, maxJ = 3) => {
    const ch = select(cd.lessThan(0), float(-1), floor(cd.mul(0.125).add(0.001)));
    const sg = cd.sub(ch.mul(8));
    let p = p0, n = n0;
    const apply = (chain, j, on) => {
      const k = int(chain.max(0).mul(4).add(j));
      const piv = PIV.element(k).xyz, ax = AX.element(k).xyz;
      const a = jointAngle(chain, j, P, E, D, D2).mul(on);
      p = rot(p.sub(piv), ax, a).add(piv);
      n = rot(n, ax, a);
    };
    for (let j = maxJ; j >= 0; j--) apply(ch, j, step(j - 0.5, sg).mul(step(-0.5, ch)));
    // antennes et mandibules suivent la tête
    const kid = step(5.5, ch).mul(step(ch, 9.5)), headC = float(10);
    apply(headC, 1, kid); apply(headC, 0, kid);
    return { p, n };
  };

  // lo : les guêpes lointaines — squelette réduit (deux articulations), pas de
  // pose précédente du squelette (le vecteur vitesse vient du corps seul)
  const makeBodyMat = (lo) => {
  const bodyMat = new THREE.MeshSSSNodeMaterial();
  {
    const wp = attribute('wp', 'vec4');
    const [i0, i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11] = I();
    bodyMat.positionNode = Fn(() => {
      const p = positionGeometry, n = attribute('normal', 'vec3');
      const A = skin(p, n, wp.w, i4, i6, i8, i10, lo ? 1 : 3), B = lo ? A : skin(p, n, wp.w, i5, i7, i9, i11);
      positionPrevious.assign(qrot(i3, B.p.mul(i2.w)).add(i2.xyz));
      normalLocal.assign(qrot(i1, A.n));
      return qrot(i1, A.p.mul(i0.w)).add(i0.xyz);
    })();
    // ── le motif de Vespula vulgaris ──
    const part = wp.x, s = wp.y, a = wp.z, cd = wp.w;
    const P = positionGeometry;
    const isP = (k) => step(k - 0.5, part).mul(step(part, k + 0.5));
    const ca = cos(a), sa = sin(a);
    const YEL = vec3(0.66, 0.33, 0.006), BLK = vec3(0.011, 0.01, 0.009), BRN = vec3(0.12, 0.05, 0.015);
    // gastre : tergite et position dans le tergite, d'après x
    const S = clamp(P.x.sub(-0.0035).div(-0.079 + 0.0035), 0, 1);
    const segs = [0, 0.21, 0.38, 0.54, 0.69, 0.83, 1];
    let tk = float(0), f = float(0);
    for (let i = 0; i < 6; i++) { const inS = step(segs[i], S).mul(step(S, segs[i + 1])); tk = tk.add(inS.mul(i)); f = f.add(inS.mul(S.sub(segs[i]).div(segs[i + 1] - segs[i]))); }
    const up = P.y.add(0.0015).add(S.mul(S).mul(0.0065));
    const rr = length(vec3(0, up, P.z)).max(1e-5), caG = up.div(rr), sideG = abs(P.z).div(rr);
    const band = smoothstep(0.5, 0.56, f.add(caG.mul(0.06)).add(noise(P.mul(380)).mul(0.04)).add(sin(P.z.mul(900)).mul(0.012))); // (la partie avant de chaque tergite est cachée sous le précédent : le noir commence plus loin)
    const dorsal = smoothstep(0.6, 0.9, caG).mul(smoothstep(0.78, 0.56, f)).mul(step(0.5, tk)); // (triangle noir sur la ligne du dos)
    const dots = smoothstep(0.14, 0.06, length(vec3(f.sub(0.7).mul(1.5), sideG.sub(0.78), 0))).mul(step(0.5, tk)).mul(step(tk, 4.5));
    const gY = band.mul(dorsal.oneMinus()).mul(dots.oneMinus()).max(step(4.5, tk).mul(smoothstep(0.15, 0.35, f)));
    // thorax (s : de l'arrière vers le cou ; a : 0 en haut)
    const tY = smoothstep(0.8, 0.84, s).mul(smoothstep(0.93, 0.89, s)).mul(smoothstep(0.35, 0.6, abs(sa)))
      .max(smoothstep(0.04, 0.02, length(vec3(s.sub(0.355), abs(sa).sub(0.3), 0))))
      .max(smoothstep(0.035, 0.015, length(vec3(s.sub(0.27), abs(sa).sub(0.25), 0))))
      .max(smoothstep(0.05, 0.03, length(vec3(s.sub(0.62), abs(sa).sub(0.95), ca.mul(0.2)))));
    // tête (blob : s de bas en haut, a autour de y, 0 = l'avant). L'œil est
    // recalculé au pixel par la formule du bombement (gen/wasp.js, eyeBulge) :
    // un contour réniforme net, échancré, et pas l'attribut « pièce » interpolé
    // d'un triangle à l'autre (il dessinait des dents de scie)
    const hu = select(a.greaterThan(Math.PI), a.sub(2 * Math.PI), a), hv = s.mul(Math.PI).sub(Math.PI / 2);
    const edu = abs(hu).sub(EYE_U).div(EYE_W), edv = hv.sub(0.04).div(0.8);
    const ee = edu.mul(edu).add(edv.mul(edv));
    const end = edu.add(1.02).div(0.62).pow(2).add(edv.sub(0.3).div(0.4).pow(2));
    const notch = smoothstep(0.8, 1.35, end);
    const headP = isP(0).add(isP(1));
    const eyeM = smoothstep(1.0, 0.9, ee).mul(smoothstep(0.85, 1.05, end)).mul(headP);
    const front = smoothstep(0.2, 0.45, cos(a));
    // la face : jaune sous les antennes (s < 0,59), le front noir au-dessus ;
    // l'échancrure de l'œil remplie de jaune, l'orbite interne liserée de jaune
    const faceY = front.mul(smoothstep(0.62, 0.56, s));
    const sinus = smoothstep(1.2, 0.75, end).mul(smoothstep(1.6, 1.0, ee));
    const orbit = smoothstep(1.0, 1.06, ee).mul(smoothstep(1.4, 1.22, ee)).mul(smoothstep(EYE_U + 0.05, EYE_U - 0.25, abs(hu))).mul(smoothstep(0.75, 0.5, s));
    // les tempes : une bande jaune derrière l'œil, le vertex et l'occiput noirs
    const temple = smoothstep(1.04, 1.12, ee).mul(smoothstep(3.2, 2.4, ee)).mul(smoothstep(EYE_U + EYE_W * 0.5, EYE_U + EYE_W * 0.9, abs(hu))).mul(smoothstep(0.2, 0.3, s)).mul(smoothstep(0.82, 0.72, s));
    const hY = faceY.max(sinus).max(orbit).max(temple).mul(eyeM.oneMinus());
    // clypéus : jaune, l'ancre noire au milieu
    const anchor = smoothstep(0.16, 0.07, abs(sin(a))).mul(step(0.42, s)).max(smoothstep(0.07, 0.03, length(vec3(abs(sin(a)).sub(0.38), s.sub(0.55), 0))));
    // pattes : hanche et fémur noirs (le bout du fémur jaune), tibia et tarse jaunes
    const ch = floor(cd.mul(0.125).add(0.001)), sg = cd.sub(ch.mul(8));
    const lY = step(1.5, sg).max(step(0.5, sg).mul(step(sg, 1.5)).mul(smoothstep(0.75, 0.9, s)));
    const yel = headP.mul(hY).add(isP(3).mul(tY)).add(isP(5).mul(gY)).add(isP(6).mul(lY)).add(isP(10).mul(anchor.oneMinus())).add(isP(7)).clamp(0, 1);
    let col = mix(BLK, YEL, yel);
    col = mix(col, mix(YEL, BRN, smoothstep(0.55, 0.85, s)), isP(7));
    col = mix(col, mix(vec3(0.06, 0.045, 0.028), vec3(0.022, 0.017, 0.011), smoothstep(0.2, 1, ee)), eyeM); // (l'œil : brun sombre, plus clair au centre, distinct de la capsule noire)
    col = mix(col, vec3(0.09, 0.05, 0.02), isP(9));
    const darkHair = select(cd.lessThan(0).or(cd.greaterThan(80).and(cd.lessThan(87))), float(0.3), float(1)); // (thorax et tête : soies brun sombre ; gastre : dorées)
    col = mix(col, mix(vec3(0.05, 0.03, 0.015), mix(vec3(0.07, 0.045, 0.025), vec3(0.42, 0.3, 0.14), a.mul(a).mul(a).mul(darkHair)), s), isP(8)); // (soies : brunes à la base, dorées au bout, chacune sa nuance)
    col = mix(col, YEL.mul(0.75), isP(6).mul(step(2.5, sg)));
    // ponctuation de la cuticule : un grain fin, mat dans les creux
    const pf = length(fwidth(P)), fd = (k) => smoothstep(0.5, 0.15, pf.mul(k));
    // (lectures du bruit sautées quand leur détail est sous le pixel : nz.js)
    const n1 = nzIf(P.mul(900), fd(900)).x.mul(fd(900)).mul(0.5).add(0.5);
    const pits = smoothstep(0.35, 0.8, nzIf(P.mul(2600), fd(2600)).y).mul(fd(2600));
    col = col.mul(n1.mul(0.1).add(0.95)).mul(pits.mul(-0.18).add(1));
    bodyMat.colorNode = vec4(col, 1);
    const eye = eyeM.add(isP(9)).clamp(0, 1), hairP = isP(8);
    const KF = 3600;
    const hex = cos(P.y.mul(KF)).add(cos(P.y.mul(KF * 0.5).add(P.x.mul(KF * 0.866)))).add(cos(P.y.mul(KF * 0.5).sub(P.x.mul(KF * 0.866))));
    const H = mix(pits.mul(-0.00006).add(nzIf(P.mul(700), fd(700)).x.mul(0.00003).mul(fd(700))), hex.mul(0.000012).mul(fd(KF)), eye).mul(hairP.oneMinus());
    bodyMat.normalNode = perturb(H, normalViewGeometry);
    bodyMat.roughnessNode = mix(mix(float(0.58), float(0.36), yel), float(0.46), eye).add(n1.mul(0.06)).add(pits.mul(0.12)).max(hairP.mul(0.5));
    bodyMat.specularIntensityNode = mix(mix(float(0.45), float(0.85), yel), float(0.4), eye).mul(hairP.mul(-0.6).add(1)); // (les soies : un éclat discret, pas des points)
    bodyMat.metalnessNode = float(0);
    // la cuticule jaune est translucide : elle s'allume au contre-jour
    bodyMat.thicknessColorNode = YEL.mul(yel).mul(0.5);
    bodyMat.thicknessDistortionNode = float(0.2);
    bodyMat.thicknessAmbientNode = float(0);
    bodyMat.thicknessAttenuationNode = float(1);
    bodyMat.thicknessPowerNode = float(4);
    bodyMat.thicknessScaleNode = float(1.2);
    bodyMat.mrtNode = stableVelocity();
  }
  return bodyMat;
  };
  const body = new THREE.Mesh(bodyGeo, makeBodyMat(false)), bodyLo = new THREE.Mesh(loGeo, makeBodyMat(true));
  for (const m of [body, bodyLo]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
  bodyLo.castShadow = false; // (une guêpe lointaine : son ombre est sous le pixel)

  // ── ailes ──
  const wingMat = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  {
    const ww = attribute('ww', 'vec4');
    const [i0, i1, i2, i3, i4, i5] = I();
    const copy = floor(ww.x.mul(0.25).add(0.001)), wid = ww.x.sub(copy.mul(4)), u = ww.y, v = ww.z;
    const fore = step(wid, 1.5), sd = select(fract(wid.mul(0.5)).lessThan(0.25), float(1), float(-1));
    const F = WINGS[0], Hw = WINGS[1];
    const len = mix(float(Hw.len), float(F.len), fore), chord = mix(float(Hw.chord), float(F.chord), fore);
    const hinge = mix(vec3(...Hw.hinge), vec3(...F.hinge), fore);
    const place = (Q) => {
      // Q.y : part du vol ; Q.z : phase du battement ; Q.w : ailes repliées en long.
      // Chaque copie prend un instant du battement : en vol, l'aile floue.
      const fly = Q.y, phc = Q.z.add(copy.mul((2 * Math.PI) / WING_COPIES));
      const psi = mix(float(2.86).sub(fore.oneMinus().mul(0.06)), float(1.5).add(fore.oneMinus().mul(0.22)), fly);
      const d = vec3(cos(psi), 0, sin(psi)), c = vec3(sin(psi).negate(), 0, cos(psi));
      const vv = v.mul(mix(float(1), float(0.42), Q.w.mul(fore))); // (pli longitudinal des vespidés)
      const stroke = mix(float(0.1), sin(phc).mul(1.05).add(0.15), fly);
      const twist = cos(phc).mul(0.5).mul(fly); // (l'aile pivote à chaque demi-battement)
      let q = d.mul(u.mul(len)).add(c.mul(vv.mul(chord))).add(vec3(0, positionGeometry.y, 0));
      q = rot(q, d, twist);
      q = rot(q, vec3(1, 0, 0), stroke);
      q = q.add(hinge);
      return vec3(q.x, q.y, q.z.mul(sd));
    };
    wingMat.positionNode = Fn(() => {
      positionPrevious.assign(qrot(i3, place(i5).mul(i2.w)).add(i2.xyz));
      normalLocal.assign(qrot(i1, vec3(0, ww.w, 0)));
      return qrot(i1, place(i4).mul(i0.w)).add(i0.xyz);
    })();
    // nervures : costa, sous-costa, radius, cellule marginale, sous-marginales, media, cubitus
    const seg = (ax, ay, bx, by) => {
      const pa = vec3(u.sub(ax), v.sub(ay), 0), ba = vec3(bx - ax, by - ay, 0);
      const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
      return length(pa.sub(ba.mul(h)));
    };
    const vf = tmin(tmin(tmin(tmin(seg(0, 0.015, 0.68, 0.03), seg(0.05, 0.08, 0.6, 0.1)), tmin(seg(0.6, 0.1, 0.93, 0.18), seg(0.05, 0.2, 0.52, 0.3))),
      tmin(tmin(seg(0.52, 0.3, 0.84, 0.4), seg(0.08, 0.3, 0.45, 0.5)), tmin(seg(0.36, 0.19, 0.42, 0.48), seg(0.53, 0.11, 0.58, 0.32)))),
      tmin(tmin(seg(0.66, 0.08, 0.72, 0.36), seg(0.45, 0.5, 0.75, 0.62)), seg(0.12, 0.4, 0.22, 0.75)));
    const vh = tmin(tmin(seg(0, 0.015, 0.6, 0.025), seg(0.05, 0.1, 0.5, 0.22)), seg(0.1, 0.25, 0.4, 0.45));
    const vein = smoothstep(0.006, 0.0025, mix(vh, vf, fore)).max(smoothstep(0.03, 0.0, v).mul(0.7));
    const stigma = smoothstep(0.05, 0.03, length(vec3(u.sub(0.64), v.sub(0.055).mul(2.2), 0))).mul(fore);
    const flyNow = i4.y;
    // en vol, cinq copies à un tiers d'opacité chacune ; au repos, la seule copie 0
    const vis = mix(step(copy, 0.5), float(1.7 / WING_COPIES), flyNow);
    wingMat.colorNode = vec4(mix(vec3(0.55, 0.48, 0.36), vec3(0.1, 0.055, 0.022), vein.max(stigma)), 1);
    wingMat.opacityNode = mix(float(0.06), float(0.95), vein.max(stigma).mul(flyNow.mul(-0.6).add(1))).mul(smoothstep(0.0, 0.03, u)).mul(vis);
    wingMat.roughnessNode = float(0.1);
    wingMat.metalnessNode = float(0);
    wingMat.iridescenceNode = float(0.5);
    wingMat.iridescenceIORNode = float(1.5);
    wingMat.iridescenceThicknessNode = noise(vec3(u.mul(4), v.mul(6), wid)).mul(180).add(420);
    wingMat.mrtNode = stableVelocity();
  }
  const wings = new THREE.Mesh(wingGeo, wingMat);
  wings.frustumCulled = false; wings.castShadow = false; wings.renderOrder = 5;
  scene.add(body, bodyLo, wings);

  function setGeometry(b, w, lo) {
    for (const [G, o] of [[bodyGeo, b], [loGeo, lo ?? b]]) {
      G.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
      G.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
      G.setAttribute('wp', new THREE.BufferAttribute(o.wp, 4));
      G.setIndex(new THREE.BufferAttribute(o.index, 1));
    }
    wingGeo.setAttribute('position', new THREE.BufferAttribute(w.position, 3));
    wingGeo.setAttribute('normal', new THREE.BufferAttribute(w.normal, 3));
    wingGeo.setAttribute('ww', new THREE.BufferAttribute(w.ww, 4));
    wingGeo.setIndex(new THREE.BufferAttribute(w.index, 1));
  }
  // états : [{ p, q, s, pose: [marche, vol, battement, repli], ext?: [mâchoires, antennes, tête, gastre] }, …]
  const extOf = (A) => A.ext ?? [0, A.pose[0] * 0.6, 0, A.pose[0] * 0.3];
  const ext2Of = (A) => A.ext2 ?? [0, 0, 0, 0];
  const ext3Of = (A) => A.ext3 ?? [0, 0, 0, 0]; // (appui des pattes 3 à 5)
  // cam : position de la caméra et tangente du demi-champ ; une guêpe dont le
  // corps (13 mm × échelle) dépasse ~3 % de la hauteur de l'image est « proche »
  // (au plus 16 : les plus grandes à l'écran)
  const _order = [];
  function set(now, prev, cam = null) {
    const n = Math.min(MAXW, now.length);
    _order.length = 0;
    for (let i = 0; i < n; i++) {
      const A = now[i];
      const size = cam ? (0.13 * A.s) / (Math.max(1e-4, Math.hypot(A.p[0] - cam.p[0], A.p[1] - cam.p[1], A.p[2] - cam.p[2])) * cam.tan * 2) : 1;
      _order.push([size, i]);
    }
    _order.sort((x, y) => y[0] - x[0]);
    let nh = 0, nl = 0;
    _order.forEach(([size, i], r) => {
      const A = now[i], B = prev[i] ?? A;
      const row = [...A.p, A.s, ...A.q, ...B.p, B.s, ...B.q, ...A.pose, ...B.pose, ...extOf(A), ...extOf(B), ...ext2Of(A), ...ext2Of(B), ...ext3Of(A), ...ext3Of(B)];
      if (size > 0.03 && nh < 16) buf.set(row, STRIDE * nh++); else bufLo.set(row, STRIDE * nl++);
      bufAll.set(row, STRIDE * r);
    });
    bodyGeo.instanceCount = nh; loGeo.instanceCount = nl; wingGeo.instanceCount = n;
    body.visible = nh > 0; bodyLo.visible = nl > 0; wings.visible = n > 0;
    for (const ib of [ibB, ibL, ibW]) { ib.needsUpdate = true; ib.version++; }
  }
  return { body, bodyLo, wings, setGeometry, set, counts: () => [bodyGeo.instanceCount, loGeo.instanceCount] };
}
