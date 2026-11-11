// Matériau d'une pièce de verre : tous ses éclats dans un seul maillage, leur
// physique calculée dans le vertex shader à partir des attributs de chaque
// éclat (gen/fracture.js). Les formules sont celles de cycle.js : soufflage,
// caméra rapide, vol balistique sous gravité vraie, choc sur la sole en
// cuvette, rebond, glissement, l'éclat qui se couche, refonte.
//
// Attributs : rigA = centre de l'éclat, instant de fissure ; rigB = vitesse
// (u/s, temps physique), vitesse de rotation ; rigC = axe, début de la fonte ;
// rigD = paramètre de soufflage (≥ 2 : partie posée après coup), rayon de
// l'éclat, normale moyenne (octaédrique) ; surf = paroi externe / interne /
// chant, nuance.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, attribute, varyingProperty, vec3, vec4, float, mix, smoothstep, clamp, exp, max, min, sin, cos, cross, dot, abs, sqrt, acos,
  length, normalize, atan, positionGeometry, normalLocal, positionPrevious, faceDirection, normalViewGeometry, mod, step, select,
} from 'three/tsl';
import { G } from './globals.js';
import { GLASSES } from '../glasses.js';
import { PH, GRAV, DISH_H, DISH_W, MU, BOUNCE } from '../cycle.js';

// hauteur de la sole (cycle.js, floorH), r² donné
const floorH = (r2) => exp(r2.div(-(DISH_W * DISH_W))).oneMinus().mul(DISH_H);
import { noise, perturb, ditherThreshold, stableVelocity, isLite } from './materials.js';

export { GLASSES };

export function glassUniforms() {
  return {
    start: uniform(0), loopT: uniform(36), Ts: uniform(12),
    k: uniform(16), pre: uniform(-0.09), plat: uniform(2), post: uniform(1), // (caméra rapide)
    origin: uniform(new THREE.Vector3()), size: uniform(2), thick: uniform(0.036),
    res: uniform(0), therm: uniform(0), // (mécanisme : résonance, chalumeau)
    tint: uniform(new THREE.Color()), edge: uniform(new THREE.Color()), glow: uniform(new THREE.Color()),
    att: uniform(2), ior: uniform(1.5), disp: uniform(0.3), irid: uniform(0), heatGain: uniform(1),
    fil: uniform(0), filN: uniform(16), filTwist: uniform(1), // (filigrane : fils de verre blanc)
  };
}
export function applyGlass(U, g) {
  const G0 = GLASSES[g.key] ?? GLASSES.cristal;
  U.tint.value.set(G0.tint); U.edge.value.set(G0.edge); U.glow.value.set(G0.glow ?? '#000000');
  U.att.value = G0.att; U.ior.value = G0.ior; U.disp.value = G0.disp * (g.fire ?? 1); U.irid.value = G0.irid ?? 0;
}

const rod = (v, a, th) => { const c = cos(th), s = sin(th); return v.mul(c).add(cross(a, v).mul(s)).add(a.mul(dot(a, v)).mul(c.oneMinus())); };
const Gi = (u) => u.mul(u).mul(u).sub(u.mul(u).mul(u).mul(u).mul(0.5)); // ∫ smoothstep
const sm = (u) => u.mul(u).mul(float(3).sub(u.mul(2)));

// couleur et intensité d'incandescence (h : 0 froid → 1 à ~1 500 K)
// (le verre de travail est à ~1 100 °C : jaune orangé, pas blanc ; l'intensité
// reste sous le plafond des hautes lumières pour que la forme se lise)
export const blackbody = (h) => vec3(1, h.pow(1.6).mul(0.55).add(0.05), h.pow(4).mul(0.22)).mul(h.pow(2.6).mul(7).add(h.mul(0.4)));

const vCyc = varyingProperty('vec4', 'vCalcin');

export function buildGlassMaterial(U, { glassKey = 'cristal' } = {}) {
  const lite = isLite();
  const opaque = !!GLASSES[glassKey]?.opaque;
  const A = attribute('rigA', 'vec4'), B = attribute('rigB', 'vec4'), C = attribute('rigC', 'vec4'), Dd = attribute('rigD', 'vec4');
  const surfA = attribute('surf', 'vec4');
  const g = float(GRAV);

  // temps physique (cycle.js, physTime)
  const physTime = (l) => {
    const t0 = U.Ts.mul(PH.rupture), rin = 0.12; // (cycle.js, physTime)
    const a0 = t0.sub(U.pre).sub(rin), b0 = t0.add(U.plat);
    const u1 = clamp(l.sub(a0).div(rin), 0, 1), u2 = clamp(l.sub(b0).div(U.post), 0, 1);
    const I = Gi(u1).mul(rin).add(clamp(l.sub(a0.add(rin)), 0, b0.sub(a0.add(rin)))).add(U.post.mul(u2.sub(Gi(u2))));
    return l.sub(float(1).sub(float(1).div(U.k)).mul(I));
  };
  const octDecode = (o) => {
    const y = float(1).sub(abs(o.x)).sub(abs(o.y)), t = max(y.negate(), 0);
    const x = o.x.add(select(o.x.greaterThanEqual(0), t.negate(), t)), z = o.y.add(select(o.y.greaterThanEqual(0), t.negate(), t));
    return normalize(vec3(x, y, z));
  };

  // pose d'un sommet au temps local l : { p, nrm, m }
  const pose = (l, nIn) => {
    const rest = Dd.y; // (hauteur du centre au repos : position stable de l'éclat, fracture.js)
    const c = A.xyz, v = B.xyz, w = B.w, ax = C.xyz;
    const tau = max(physTime(l).sub(physTime(A.w)), 0);
    // instant du choc sur la sole (deux itérations sur la cuvette)
    const solve = (h) => max(v.y.add(sqrt(max(v.y.mul(v.y).add(g.mul(2).mul(c.y.sub(h))), 0))).div(g), 0);
    let tL = solve(rest);
    for (let i = 0; i < 2; i++) { const xz = c.xz.add(v.xz.mul(tL)); tL = solve(floorH(xz.dot(xz)).add(rest)); }
    const air = tau.lessThanEqual(tL);
    const cf = c.add(v.mul(tau)).sub(vec3(0, g.mul(0.5).mul(tau).mul(tau), 0));
    const s2 = max(tau.sub(tL), 0);
    const vh = v.xz.mul(0.3), ts = length(vh).div(g.mul(MU)).add(1e-6), sx = min(s2, ts);
    const xz = c.xz.add(v.xz.mul(tL)).add(vh.mul(sx.sub(sx.mul(sx).div(ts.mul(2)))));
    const yb = max(abs(v.y.sub(g.mul(tL))).mul(BOUNCE).mul(s2).sub(g.mul(0.5).mul(s2).mul(s2)), 0);
    const cg = vec3(xz.x, floorH(xz.dot(xz)).add(rest).add(yb), xz.y);
    const cen = select(air, cf, cg);
    const th = w.mul(select(air, tau, tL.add(exp(s2.div(-0.05)).oneMinus().mul(0.004))));
    let q = rod(positionGeometry.sub(c), ax, th);
    let nrm = rod(nIn, ax, th);
    // au sol, l'éclat bascule dans sa position stable : sa direction d vers le bas
    // (sa direction d vient contre la sole, selon la normale de la cuvette : cycle.js, floorN)
    const n = rod(octDecode(Dd.zw), ax, th);
    const kf = exp(cg.xz.dot(cg.xz).div(-(DISH_W * DISH_W))).mul((DISH_H * 2) / (DISH_W * DISH_W));
    const tdown = normalize(vec3(cg.x.mul(kf), -1, cg.z.mul(kf)));
    const cx = cross(n, tdown), lc = length(cx);
    const ax2 = select(lc.greaterThan(1e-5), cx.div(max(lc, 1e-5)), vec3(1, 0, 0));
    const ang = acos(clamp(dot(n, tdown), -1, 1)).mul(clamp(s2.div(0.07), 0, 1)).mul(step(1e-6, s2));
    q = rod(q, ax2, ang); nrm = rod(nrm, ax2, ang);
    // refonte : il s'affaisse, s'étale et coule vers le centre de la cuvette
    const m = clamp(l.sub(C.w).div(U.Ts.mul(PH.meltDur)), 0, 1);
    const flow = float(1).sub(sm(m).mul(0.97));
    q = q.mul(vec3(m.mul(-0.4).add(1), m.mul(-0.9).add(1), m.mul(-0.4).add(1)));
    const x = cen.xz.mul(flow).add(q.xz);
    let p = vec3(x.x, max(cen.y.add(q.y), floorH(x.dot(x)).add(0.002)), x.y);
    // résonance : le bord s'ovalise (mode (2,0)) de plus en plus fort, jusqu'à la rupture
    // (kinematics.js, resonanceAmp : même montée et même phase que la membrane)
    const grow = exp(l.sub(U.Ts.mul(PH.rupture)).mul(0.9)).min(1);
    const amp = U.res.mul(U.size).mul(0.035).mul(grow).mul(min(Dd.x, 1).pow(2)).mul(step(l, A.w)).mul(step(Dd.x, 1.5));
    const ang2 = atan(positionGeometry.z, positionGeometry.x);
    const n2 = vec3(positionGeometry.x, 0, positionGeometry.z).div(length(positionGeometry.xz).max(1e-4));
    p = p.add(n2.mul(amp.mul(cos(ang2.mul(2))).mul(sin(l.mul(2 * Math.PI * 3.2)))));
    // soufflage : la paraison monte du bain (au pied) et prend sa forme
    const body = step(Dd.x, 1.5);
    const prog = l.div(U.Ts.mul(PH.acc));
    const gi = sm(clamp(prog.sub(min(Dd.x, 1).mul(0.55)).div(0.45), 0, 1));
    const pool = vec3(positionGeometry.x.mul(0.22), positionGeometry.y.mul(0.04), positionGeometry.z.mul(0.22));
    const breath = sin(gi.mul(Math.PI)).mul(0.06).add(1);
    const infl = mix(pool, positionGeometry.mul(vec3(breath, 1, breath)), gi);
    const blowing = l.lessThan(U.Ts.mul(PH.acc)).and(body.greaterThan(0.5));
    return { p: select(blowing, infl, p), nrm, m };
  };

  const position = Fn(() => {
    const l = mod(G.time.sub(U.start), U.loopT), lp = mod(G.timePrev.sub(U.start), U.loopT);
    const now = pose(l, normalLocal);
    if (!lite) positionPrevious.assign(pose(lp, normalLocal).p);
    normalLocal.assign(now.nrm);
    // chaleur : en sortant du bain le verre est à ~1 500 K, puis il refroidit ;
    // les parties posées après coup (anse, bouchon, fil) arrivent chaudes ;
    // la fonte le rallume
    const isPart = step(1.5, Dd.x);
    const tPlace = U.Ts.mul(PH.acc).mul(min(Dd.x, 1).mul(0.55).add(0.45)).mul(0.6);
    const tApp = U.Ts.mul(PH.acc).mul(Dd.x.sub(2).clamp(0, 1).mul(0.15).add(0.85));
    let heat = clamp(float(1).sub(l.sub(mix(tPlace, tApp, isPart)).div(U.Ts.mul(PH.cool))), 0, 1);
    heat = max(heat, smoothstep(0, 0.35, now.m).mul(0.92));
    // chalumeau : la flamme chauffe un point avant le choc thermique
    // (kinematics.js, torchOn : le point rougit pendant que la flamme le touche,
    // puis refroidit lentement ; c'est de là que part la fissure)
    const spot = smoothstep(U.size.mul(0.2), 0, length(positionGeometry.sub(U.origin))).pow(1.5);
    const ramp = smoothstep(U.Ts.mul(PH.rupture - 0.16), U.Ts.mul(PH.rupture), l).mul(smoothstep(U.Ts.mul(PH.rupture + 0.2), U.Ts.mul(PH.rupture), l));
    heat = max(heat, U.therm.mul(spot).mul(ramp).mul(0.9));
    // fissure : 0 avant le passage du front ; ensuite 1, plus une impulsion (jusqu'à 3)
    // au passage, qui s'efface ; le trait lui-même s'estompe en 2 s
    const dt = l.sub(A.w);
    const crack = smoothstep(0.0, 0.03, dt).mul(smoothstep(2.5, 0.8, dt).mul(0.9).add(0.1)).add(smoothstep(0.0, 0.03, dt).mul(smoothstep(0.45, 0.05, dt)).mul(2));
    // marges : apparition d'une partie (> 0 : visible), fonte (< 1 : visible)
    vCyc.assign(vec4(mix(float(1), l.sub(tApp), isPart), now.m, heat, crack));
    return now.p;
  })();

  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.FrontSide });
  m.positionNode = position;
  const isEdge = smoothstep(0.5, 0.8, surfA.z);
  const heat = vCyc.z;
  const pg = positionGeometry;

  // chants : lignes de Wallner autour de l'origine de la rupture
  const wall = sin(length(pg.sub(U.origin)).div(U.size).mul(220).add(noise(pg.mul(6)).mul(3))).mul(0.5).add(noise(pg.mul(40)).mul(0.5));
  const N0 = normalViewGeometry.mul(faceDirection);
  m.normalNode = perturb(wall.mul(isEdge).mul(U.thick).mul(0.04), N0);

  // filigrane : fils de verre blanc opaque pris dans la paroi, en spirale
  const th = atan(pg.z, pg.x);
  const band = cos(th.mul(U.filN).add(pg.y.div(U.size).mul(U.filTwist).mul(2 * Math.PI))).mul(0.5).add(0.5);
  const fil = smoothstep(0.86, 0.93, band).mul(U.fil).mul(float(1).sub(isEdge.mul(0.5)));

  const tint = mix(U.tint, U.edge, isEdge);
  m.colorNode = opaque ? vec4(mix(vec3(0.012), U.edge.mul(0.05), isEdge), 1) : vec4(mix(vec3(1), vec3(0.92, 0.92, 0.9), fil), 1);
  m.roughnessNode = mix(mix(float(0.015), float(0.09), isEdge), float(0.35), fil);
  m.metalnessNode = float(0);
  m.specularIntensityNode = float(1);
  m.iorNode = U.ior;
  if (!opaque && !lite) {
    m.transmissionNode = float(1).sub(heat.pow(2).mul(0.6)).mul(float(1).sub(fil));
    m.thicknessNode = U.thick.mul(mix(float(1.6), float(3), isEdge));
    m.attenuationColorNode = tint;
    m.attenuationDistanceNode = U.thick.mul(U.att).mul(mix(float(1), float(0.35), isEdge));
    m.dispersionNode = U.disp;
  } else if (!opaque) {
    m.transparent = true;
    m.colorNode = vec4(mix(tint.mul(0.35), vec3(0.9), fil), 1);
    const fres = float(1).sub(dot(normalViewGeometry, vec3(0, 0, 1)).abs()).pow(3);
    // (les chants internes, entre éclats encore joints, ne doivent pas dessiner les
    // fissures avant la rupture : ils restent aussi transparents que la paroi)
    m.opacityNode = clamp(float(0.18).add(fres.mul(0.6)).add(heat).add(fil), 0, 1);
    m.clearcoatNode = float(1); m.clearcoatRoughnessNode = float(0.02);
  }
  if (opaque) { m.clearcoatNode = float(1); m.clearcoatRoughnessNode = float(0.01); }
  m.iridescenceNode = U.irid;
  m.iridescenceIORNode = float(1.8);
  m.iridescenceThicknessNode = mix(float(250), float(800), noise(pg.mul(3)).mul(0.5).add(0.5));
  // fissures : un trait argenté sur la paroi, qui s'allume au passage du front
  // (lisible même tant que les éclats se tiennent encore)
  const crackLine = smoothstep(0.55, 0.95, surfA.w).mul(float(1).sub(isEdge)).mul(min(vCyc.w, 1));
  m.emissiveNode = blackbody(heat).mul(U.heatGain)
    .add(U.edge.add(0.4).mul(max(vCyc.w.sub(1), 0).mul(0.5)).mul(isEdge).mul(0.35))
    .add(vec3(0.9, 0.95, 1).mul(crackLine).mul(max(vCyc.w.sub(1), 0).mul(0.8).add(0.35)))
    .add(U.glow.mul(G.uvLight).mul(float(0.04).add(isEdge.mul(0.5)).add(float(1).sub(dot(normalViewGeometry, vec3(0, 0, 1)).abs()).pow(3).mul(0.35))));
  // parties qui apparaissent, éclats fondus dans le bain : tramés, lissés par le TRAA
  const keep = vCyc.x.greaterThan(ditherThreshold(1).mul(0.3)).and(vCyc.y.lessThan(float(0.97).sub(ditherThreshold(2).mul(0.08))));
  m.maskNode = keep;
  // (passe d'ombre : recalculé depuis les attributs, sans la variable du vertex
  // shader principal, qui n'y est pas transmise — sinon le verre ne porte aucune ombre)
  {
    const l = mod(G.time.sub(U.start), U.loopT);
    const isPartS = step(1.5, Dd.x);
    const tAppS = U.Ts.mul(PH.acc).mul(Dd.x.sub(2).clamp(0, 1).mul(0.15).add(0.85));
    const mS = clamp(l.sub(C.w).div(U.Ts.mul(PH.meltDur)), 0, 1);
    m.maskShadowNode = mix(float(1), l.sub(tAppS), isPartS).greaterThan(0.15).and(mS.lessThan(0.93));
  }
  // ombre du verre : teintée et assez dense dans les parois (la lumière y est
  // en partie absorbée et surtout déviée), franche sous les chants et les parties
  // épaisses ; un verre ne laisse jamais une ombre aussi claire que le jour
  if (!opaque) m.castShadowNode = vec4(mix(U.tint.mul(0.5).add(0.06), vec3(0.08), isEdge), 1);
  m.mrtNode = stableVelocity();
  return m;
}

// Porteur d'ombre : three.js (WebGPU) ne fait porter aucune ombre à un matériau
// à transmission, quels que soient castShadowNode et shadowMap.transmitted. Un
// double invisible (même géométrie, même déformation, matériau opaque, rangé
// dans un calque que seule la carte d'ombre voit) porte l'ombre à sa place :
// teintée et assez dense dans les parois, franche sous les chants.
export const SHADOW_LAYER = 2;
export function buildGlassShadowCaster(U, glassMat) {
  const Dd = attribute('rigD', 'vec4'), C = attribute('rigC', 'vec4'), surfA = attribute('surf', 'vec4');
  const m = new THREE.MeshBasicNodeMaterial();
  m.positionNode = glassMat.positionNode;
  const isEdge = smoothstep(0.5, 0.8, surfA.z);
  m.castShadowNode = vec4(mix(U.tint.mul(0.45).add(0.04), vec3(0.06), isEdge), 1);
  const l = mod(G.time.sub(U.start), U.loopT);
  const isPart = step(1.5, Dd.x);
  const tApp = U.Ts.mul(PH.acc).mul(Dd.x.sub(2).clamp(0, 1).mul(0.15).add(0.85));
  const melt = clamp(l.sub(C.w).div(U.Ts.mul(PH.meltDur)), 0, 1);
  m.maskShadowNode = mix(float(1), l.sub(tApp), isPart).greaterThan(0.15).and(melt.lessThan(0.93));
  return m;
}

