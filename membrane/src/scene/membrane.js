// La membrane à l'image : maillage animé par la texture de simulation, et
// matériau d'une couche mince diffusante.
//
// Sommets (vertex shader) : chaque sommet rendu lit les trois particules de
// son triangle simulé (attribut tri, voir gen/tess.js) dans la pose de
// l'image, et se place sur le patch cubique des triangles PN défini par leurs
// positions et normales ; sa normale suit l'interpolation quadratique des
// triangles PN. La position à l'image précédente donne les vecteurs vitesse.
//
// Matière (fragment) :
//   - épaisseur relative h = (irrégularité × vaisseaux × fibres) / J : une
//     zone étirée s'amincit ; les lèvres déchirées sont épaisses ;
//   - transmission de Beer-Lambert T = absorb^(h·densité) × absorption du sang ;
//     blanchiment sous tension ;
//   - ce qui est derrière : une copie de l'image (propre à la couche, prise au
//     moment où elle est dessinée : les couches intérieures sont déjà là),
//     vue nette pour la part non diffusée, floue (niveaux de mipmap) pour la
//     part diffusée, réfractée selon la normale et l'épaisseur ;
//   - translucidité (lumière venue de derrière : silhouettes de l'armature
//     dans la membrane), film humide (vernis à sa propre normale), lustre,
//     irisation (épaisseur du film en 1/J), feuille de métal.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, vec2, vec3, vec4, float, int, ivec2, mix, max, min, clamp, smoothstep, normalize, dot, cross, length, abs, pow, exp, step, sin, cos,
  storage, texture, varyingProperty, normalLocal, positionPrevious, viewportMipTexture, screenUV, screenSize, positionViewDirection,
  faceDirection, normalViewGeometry, log2, modelScale, sign, dFdx, dFdy, fract,
  viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, positionView, cameraProjectionMatrix,
} from 'three/tsl';
import { noise, noise2, fbm, worley, perturb, stableVelocity } from './materials.js';
import { LOOK_KEYS } from '../membranes.js';
import { G } from './globals.js';

const PI = Math.PI;

// (tous les niveaux de détail ont les mêmes attributs : un maillage peut
// passer de l'un à l'autre sans recompiler son matériau)
export function membraneGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geo.rest, 3));
  // (la normale vient du vertex shader, mais three.js lit encore l'attribut :
  // sans lui, l'éclairage des faces est faux — faces arrière noires)
  g.setAttribute('normal', new THREE.BufferAttribute(geo.rest, 3));
  g.setAttribute('tri', new THREE.BufferAttribute(geo.tri, 3));
  g.setAttribute('bary', new THREE.BufferAttribute(geo.bary, 2));
  g.setAttribute('rest', new THREE.BufferAttribute(geo.rest, 3));
  g.setAttribute('kind', new THREE.BufferAttribute(Float32Array.from(geo.kind), 1));
  g.setIndex(new THREE.BufferAttribute(geo.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return g;
}

export function fibrilGeometry(fib) {
  const g = new THREE.BufferGeometry();
  const n = fib.fIdx.length / 4;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('fIdx', new THREE.BufferAttribute(fib.fIdx, 4));
  g.setAttribute('fPar', new THREE.BufferAttribute(fib.fPar, 4));
  g.setAttribute('fTime', new THREE.BufferAttribute(fib.fTime, 4));
  g.setIndex(new THREE.BufferAttribute(fib.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return g;
}

// ── Uniformes d'aspect d'une membrane ───────────────────────────────────────
export function lookUniforms(spec) {
  const U = {};
  for (const k of LOOK_KEYS) U[k] = typeof spec[k] === 'string' ? uniform(new THREE.Color(spec[k])) : uniform(spec[k]);
  return U;
}
export function applyLook(U, spec) {
  for (const k of LOOK_KEYS) { if (U[k].value.isColor) U[k].value.set(spec[k]); else U[k].value = spec[k]; }
}
// ce qui impose une recompilation
export const lookSignature = (s) => [s.sheen > 0, s.irid > 0, s.metal > 0, s.wet > 0, s.fibers > 0, s.vessels > 0 || s.capillary > 0].join('');

// ── Lecture de la pose (tampons écrits par le GPU, voir gpusim.js) ──────────
// T : { VV, cur, prv, nor } (attributs de stockage de l'instance)
//   cur[i] = position, w : courbure (variation de la normale par unité de
//   longueur) ; prv[i] = position à l'image précédente, w : endommagement
//   nor[i] = normale, w : dilatation de surface J
const poseReader = (T) => ({
  cur: storage(T.cur, 'vec4', T.VV).toReadOnly(),
  prv: storage(T.prv, 'vec4', T.VV).toReadOnly(),
  nor: storage(T.nor, 'vec4', T.VV).toReadOnly(),
});

const vJ = varyingProperty('float', 'vMemJ');
const vDmg = varyingProperty('float', 'vMemDmg');
const vCurv = varyingProperty('float', 'vMemCurv');

// Triangle PN (Vlachos et al., 2001) : points de contrôle du patch cubique
// tirés des positions P et normales N des coins ; w : barycentriques.
function pnPosition(P1, P2, P3, N1, N2, N3, w) {
  const e = (Pi, Pj, Ni) => Pi.mul(2).add(Pj).sub(Ni.mul(dot(Pj.sub(Pi), Ni))).div(3);
  const b210 = e(P1, P2, N1), b120 = e(P2, P1, N2), b021 = e(P2, P3, N2);
  const b012 = e(P3, P2, N3), b102 = e(P3, P1, N3), b201 = e(P1, P3, N1);
  const E = b210.add(b120).add(b021).add(b012).add(b102).add(b201).div(6);
  const b111 = E.mul(1.5).sub(P1.add(P2).add(P3).div(6));
  const [a, b, c] = [w.x, w.y, w.z];
  return P1.mul(a.mul(a).mul(a)).add(P2.mul(b.mul(b).mul(b))).add(P3.mul(c.mul(c).mul(c)))
    .add(b210.mul(a.mul(a).mul(b)).add(b120.mul(a.mul(b).mul(b))).add(b201.mul(a.mul(a).mul(c)))
      .add(b021.mul(b.mul(b).mul(c))).add(b102.mul(a.mul(c).mul(c))).add(b012.mul(b.mul(c).mul(c))).mul(3))
    .add(b111.mul(a.mul(b).mul(c).mul(6)));
}
// normale quadratique : milieux d'arête réfléchis par le plan médian de l'arête
function pnNormal(P1, P2, P3, N1, N2, N3, w) {
  const h = (Pi, Pj, Ni, Nj) => {
    const d = Pj.sub(Pi), s = Ni.add(Nj);
    const n = s.sub(d.mul(dot(d, s).mul(2).div(dot(d, d).max(1e-12))));
    return mix(Ni, normalize(n.add(vec3(0, 0, 1e-9))), step(1e-4, length(n)));
  };
  const [a, b, c] = [w.x, w.y, w.z];
  const n = N1.mul(a.mul(a)).add(N2.mul(b.mul(b))).add(N3.mul(c.mul(c)))
    .add(h(P1, P2, N1, N2).mul(a.mul(b))).add(h(P2, P3, N2, N3).mul(b.mul(c))).add(h(P3, P1, N3, N1).mul(a.mul(c)));
  return normalize(n.add(vec3(0, 0, 1e-7)));
}

export function membranePosition(T, S, full) {
  const B = poseReader(T);
  return Fn(() => {
    const t = attribute('tri', 'vec3'), bw = attribute('bary', 'vec2');
    const w = vec3(bw.x.add(bw.y).oneMinus(), bw.x, bw.y);
    const i1 = int(t.x.add(0.5)), i2 = int(t.y.add(0.5)), i3 = int(t.z.add(0.5));
    const n1 = B.nor.element(i1), n2 = B.nor.element(i2), n3 = B.nor.element(i3);
    const c1 = B.cur.element(i1), c2 = B.cur.element(i2), c3 = B.cur.element(i3);
    const lerp = (x1, x2, x3) => x1.mul(w.x).add(x2.mul(w.y)).add(x3.mul(w.z));
    const p = pnPosition(c1.xyz, c2.xyz, c3.xyz, n1.xyz, n2.xyz, n3.xyz, w).toVar('memP');
    if (full) {
      normalLocal.assign(pnNormal(c1.xyz, c2.xyz, c3.xyz, n1.xyz, n2.xyz, n3.xyz, w));
      vJ.assign(lerp(n1.w, n2.w, n3.w));
      vCurv.assign(lerp(c1.w, c2.w, c3.w));
      const q1 = B.prv.element(i1), q2 = B.prv.element(i2), q3 = B.prv.element(i3);
      vDmg.assign(lerp(q1.w, q2.w, q3.w));
      // (normales de l'image courante : l'écart est négligeable sur une image)
      positionPrevious.assign(pnPosition(q1.xyz, q2.xyz, q3.xyz, n1.xyz, n2.xyz, n3.xyz, w));
    }
    return p;
  })();
}

// carte octaédrique (direction → uv)
const octUV = (d) => {
  const n = d.div(abs(d.x).add(abs(d.y)).add(abs(d.z)));
  const sg = (v) => step(0, v).mul(2).sub(1);
  const fold = vec2(abs(n.y).oneMinus().mul(sg(n.x)), abs(n.x).oneMinus().mul(sg(n.y)));
  const xy = mix(n.xy, fold, step(n.z, 0));
  return xy.mul(0.5).add(0.5);
};

// ── Anticrénelage du reflet ──────────────────────────────────────────────────
// Variance de la normale dans l'empreinte du pixel, ajoutée à α² (Kaplanyan,
// Tokuyoshi) : celle du relief (dérivées écran de l'écart à la normale
// géométrique), et celle de la forme, tirée de la courbure κ (par sommet,
// continue) et de la taille du pixel à cette distance (isotrope, allongée en
// incidence rasante). Les dérivées écran de la normale interpolée, elles,
// sont constantes par triangle : le reflet dessinerait les facettes.
function specularAA(N, N0, curv) {
  const bump = N.sub(N0);
  const dB = dFdx(bump).dot(dFdx(bump)).add(dFdy(bump).dot(dFdy(bump)));
  // taille du pixel en unités locales (rayon de la couche au repos ≈ 1)
  const px = positionView.z.negate().mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y)).div(modelScale.x);
  const cosV = abs(dot(N0, positionViewDirection)).max(0.2);
  const gN = curv.mul(px);
  const dN = dB.add(gN.mul(gN).mul(cosV.mul(cosV).reciprocal().add(1)));
  return (r) => r.pow(4).add(dN.mul(0.5).min(0.18)).pow(0.25);
}

// ── Matériau ─────────────────────────────────────────────────────────────────
// T : tampons de pose de l'instance ; S : uniformes de l'instance (f, fPrev, vis) ;
// L : uniformes d'aspect ; spec : la membrane (fonctions activées) ;
// opts.backdrop : voir au travers (copie de l'image) ; opts.vessels : carte
export function buildMembraneMaterial(T, S, L, spec, { side = THREE.FrontSide, backdrop = true, vessels = null, depthBlur = true } = {}) {
  const m = new THREE.MeshSSSNodeMaterial({ side });
  m.positionNode = membranePosition(T, S, true);
  const p = normalize(attribute('rest', 'vec3'));
  const lip = attribute('kind', 'float');
  const J = vJ.max(0.15), dmg = vDmg.clamp(0, 1);
  const vis = S.vis;

  // irrégularités d'épaisseur
  const n1 = fbm(p.mul(L.mottleScale.mul(2.6)), 3);
  const mot = n1.mul(L.mottle).add(1).max(0.25);
  // vaisseaux et capillaires
  let cov = float(0), halo = float(0), vr = float(0), cap = float(0);
  if (spec.vessels > 0 || spec.capillary > 0) {
    const ves = texture(vessels, octUV(p));
    cov = ves.r.mul(L.vessels); halo = ves.a.mul(L.vessels); vr = ves.g;
    const wv = worley(p.mul(26));
    cap = smoothstep(0.1, 0.0, wv.y.sub(wv.x)).mul(halo.mul(0.8).add(0.2)).mul(L.capillary);
  }
  // fibres (vélin : fibres croisées ; soie : trame)
  let fib = float(0);
  if (spec.fibers > 0) {
    const fs = L.fiberScale;
    const a = abs(noise(p.mul(vec3(5, 130, 5)).mul(fs))), b = abs(noise2(vec3(p.y, p.z, p.x).mul(vec3(130, 5, 5)).mul(fs))), c = abs(noise(vec3(p.z, p.x, p.y).mul(vec3(5, 5, 130)).mul(fs).add(3.1)));
    fib = smoothstep(0.25, 0.0, a.min(b).min(c)).mul(L.fibers);
  }
  // épaisseur relative
  const h0 = mot.mul(cov.mul(1.3).add(1)).mul(fib.mul(0.5).add(1)).div(J);
  const h = mix(h0, L.lipDensity, lip);
  // transmission
  // trajet optique : une couche mince vue de biais est traversée sur une
  // épaisseur h / cos — la silhouette d'une peau est plus dense que son centre
  const cosG = abs(dot(normalViewGeometry, positionViewDirection)).clamp(0.12, 1);
  const hv = h.div(mix(float(1), cosG, G.grazing));
  const dens = L.density.mul(vis);
  let Tr = pow(L.absorb.max(vec3(1e-3)), vec3(hv.mul(dens).max(1e-4)));
  // sang : les gros vaisseaux absorbent beaucoup, les fins à peine (rayon : vr)
  const blood = cov.mul(vr.mul(0.75).add(0.25)).add(cap.mul(0.25)).add(halo.mul(0.06));
  Tr = Tr.mul(pow(L.vesselColor.max(vec3(1e-3)), vec3(blood.mul(vis).max(1e-4))));
  // blanchiment : tension (crazing), voisinage d'une déchirure, lèvres
  const wh = smoothstep(1.04, 1.6, J).mul(L.whiten).add(dmg.mul(L.edgeWhite)).add(lip.mul(0.35)).clamp(0, 1).mul(vis);
  Tr = Tr.mul(wh.mul(-0.55).add(1));
  const Tavg = dot(Tr, vec3(1 / 3));
  const crisp = pow(Tr, vec3(L.clarity.oneMinus().mul(4).add(1)));
  const diffused = Tr.sub(crisp).max(vec3(0));
  // albédo : la part de lumière qui ne traverse pas est diffusée vers l'arrière
  let alb = L.scatter.mul(Tavg.oneMinus());
  alb = alb.mul(mix(vec3(1), L.vesselColor.mul(2.4).min(vec3(1)), blood.clamp(0, 1).mul(0.8)));
  // halo : le sang diffusé autour des vaisseaux réchauffe la membrane
  alb = alb.mul(mix(vec3(1), L.sssColor.mul(1.2).min(vec3(1)), halo.mul(0.25)));
  alb = mix(alb, L.whitenColor, wh.mul(0.7));
  alb = mix(alb, L.lipColor, lip.mul(0.6));
  if (spec.metal > 0) alb = mix(alb, L.metalColor, L.metal);
  m.colorNode = vec4(alb.mul(vis), 1);
  m.metalnessNode = spec.metal > 0 ? L.metal.mul(vis).mul(lip.mul(-0.5).add(1)) : float(0);
  m.specularIntensityNode = L.spec.mul(vis);

  // relief : vaisseaux en saillie, plis de compression, fibres, ondulation
  const world = modelScale.x;
  // plis : ceux de la compression, et (feuille de métal) un froissé permanent
  const comp = smoothstep(0.98, 0.72, J).max(spec.metal > 0 ? 0.45 : 0.06).mul(L.wrinkles);
  const wr = abs(noise(p.mul(vec3(34, 9, 34)))).oneMinus().pow(3).add(abs(noise2(p.mul(vec3(9, 34, 9)))).oneMinus().pow(3)).mul(comp);
  const H = cov.mul(vr.add(0.35)).mul(L.vesselRelief).add(cap.mul(0.25)).add(wr.mul(0.8)).add(fib.mul(0.35)).add(n1.mul(0.25)).add(dmg.mul(noise(p.mul(70)).mul(0.6)));
  const N0 = normalViewGeometry.mul(faceDirection);
  const N = perturb(H.mul(0.0028).mul(world).mul(G.microDetail).mul(vis), N0);
  m.normalNode = N;
  const aaRough = specularAA(N, N0, vCurv);
  const soft = (r, f) => r.mul(r).add(f.mul(f)).sqrt().clamp(0.02, 1);
  m.roughnessNode = aaRough(soft(L.rough.add(fib.mul(0.08)).add(lip.mul(0.12)).add(wh.mul(0.1)).add(wr.mul(0.06)), G.roughFloor));
  if (spec.wet > 0) {
    m.clearcoatNode = L.wet.mul(vis).mul(lip.mul(-0.4).add(1));
    m.clearcoatRoughnessNode = aaRough(soft(L.wetRough, G.roughFloor.mul(0.6)));
    // film humide : ondulations lentes, indépendantes du relief de la matière
    const wave = fbm(p.mul(9).add(vec3(0, 0, G.phase.mul(2))), 2).mul(L.wetWave);
    m.clearcoatNormalNode = perturb(wave.mul(0.0025).mul(world).mul(vis), N0);
  }
  if (spec.sheen > 0) { m.sheenNode = L.sheenColor.mul(L.sheen).mul(vis); m.sheenRoughnessNode = L.sheenRough; }
  if (spec.irid > 0) {
    m.iridescenceNode = L.irid.mul(vis);
    m.iridescenceIORNode = L.iridIOR;
    m.iridescenceThicknessNode = L.iridNm.mul(n1.mul(0.6).add(1)).div(J).clamp(60, 1400);
  }
  // translucidité : lumière venue de derrière, teintée par la traversée
  m.thicknessColorNode = L.sssColor.mul(Tr.add(0.12).min(vec3(1))).mul(L.sss).mul(G.sssBoost).mul(vis).mul(lip.mul(0.8).add(1));
  m.thicknessDistortionNode = L.sssDistort;
  m.thicknessPowerNode = L.sssPower;
  m.thicknessScaleNode = float(2);
  m.thicknessAmbientNode = float(0.0);
  m.thicknessAttenuationNode = float(1);

  // ce qui est derrière
  const cosV = abs(dot(N0, positionViewDirection)).clamp(0, 1);
  const fres = float(0.03).add(float(0.97).mul(cosV.oneMinus().pow(5)));
  if (backdrop) {
    const bd = viewportMipTexture();
    const aspect = screenSize.y.div(screenSize.x);
    const off = N.xy.mul(vec2(aspect, 1)).mul(L.refract.mul(h.min(4))).mul(vis).negate();
    const uv = screenUV.add(off);
    const levels = log2(screenSize.y).sub(1);
    // flou selon la distance entre la membrane et ce qui est derrière (verre
    // dépoli) : ce qui la touche reste net, le lointain se dissout
    let near = float(1);
    if (depthBlur) {
      const dz = viewportDepthTexture(uv, null, new THREE.DepthTexture());
      const behind = perspectiveDepthToViewZ(dz.r, cameraNear, cameraFar);
      const sep = positionView.z.sub(behind).max(0).div(modelScale.x);
      near = smoothstep(0.0, 0.7, sep).mul(0.85).add(0.15);
    }
    const lod = L.blur.mul(G.backdropBlur).mul(h.min(3).mul(0.25).add(0.75)).mul(levels).mul(0.85).mul(near);
    const sharp = bd.sample(uv).level(float(0));
    const soft2 = bd.sample(uv).level(lod);
    const through = sharp.rgb.mul(crisp).add(soft2.rgb.mul(diffused));
    m.emissiveNode = through.mul(fres.oneMinus()).mul(spec.metal > 0 ? L.metal.mul(-0.3).add(1) : float(1));
  } else {
    // sans copie de l'image : on laisse passer la couleur du fond (approximation)
    m.emissiveNode = G.bgColor.mul(crisp.add(diffused)).mul(fres.oneMinus());
  }
  m.mrtNode = stableVelocity();
  return m;
}

// ── Fibrilles ────────────────────────────────────────────────────────────────
// Un filament entre les deux lèvres d'une couture rompue : il s'étire et
// s'amincit (volume constant), ploie, puis claque ; chaque moitié se rétracte
// vers sa lèvre en oscillant, en s'épaississant.
export function fibrilPosition(T, S, full) {
  const B = poseReader(T);
  const FT = storage(T.fibT, 'vec4', Math.max(1, T.nf)).toReadOnly();
  return Fn(() => {
    const I = attribute('fIdx', 'vec4'), P = attribute('fPar', 'vec4'), Tm = attribute('fTime', 'vec4');
    const ix = (v) => int(v.add(0.5));
    const times = FT.element(ix(Tm.x));
    const brk = times.x, snp = times.y;
    const shape = (buf, f) => {
      const at = (v) => buf.element(ix(v)).xyz;
      const A = mix(at(I.x), at(I.y), P.x), B2 = mix(at(I.z), at(I.w), P.x);
      const na = normalize(B.nor.element(ix(I.x)).xyz.add(B.nor.element(ix(I.z)).xyz).add(vec3(0, 0, 1e-5)));
      const D = B2.sub(A), Lr = length(D).max(1e-5), td = D.div(Lr);
      const alive = step(brk, f), snapped = step(snp, f);
      const since = f.sub(snp).max(0);
      const ret = exp(since.mul(-0.32)).mul(sin(since.mul(0.9).add(Tm.w.mul(6))).mul(0.12).mul(exp(since.mul(-0.2))).add(1)).clamp(0, 1.1);
      const u = P.y, side = step(0.5, u);
      const uu = mix(u, mix(u.mul(ret), u.oneMinus().mul(ret).oneMinus(), side), snapped);
      const sag = Tm.z.mul(Lr).mul(0.18).mul(sin(uu.mul(PI))).mul(snapped.oneMinus());
      const e1 = normalize(cross(td, na).add(vec3(1e-5, 0, 0))), e2 = cross(e1, td);
      const c = mix(A, B2, uu).add(e2.mul(sag));
      const Lref = float(0.02);
      const neck = sin(uu.mul(PI)).pow(2).mul(0.55).mul(snapped.oneMinus());
      const blob = snapped.mul(smoothstep(0.2, 0.0, abs(u.sub(0.5)))).mul(0.8);
      const r = P.w.mul(Lref.div(Lr.max(Lref)).sqrt()).mul(neck.oneMinus()).mul(blob.add(1)).mul(alive).mul(S.vis);
      const nrm = e1.mul(cos(P.z)).add(e2.mul(sin(P.z)));
      return { p: c.add(nrm.mul(r)), n: nrm };
    };
    const now = shape(B.cur, S.f);
    if (full) { normalLocal.assign(now.n); positionPrevious.assign(shape(B.prv, S.fPrev).p); }
    return now.p;
  })();
}

export function buildFibrilMaterial(T, S, L, spec) {
  const m = new THREE.MeshSSSNodeMaterial();
  m.positionNode = fibrilPosition(T, S, true);
  m.colorNode = vec4(mix(L.scatter, L.lipColor, 0.5).mul(S.vis), 1);
  m.roughnessNode = L.rough.mul(0.5).add(0.05);
  m.metalnessNode = spec.metal > 0 ? L.metal : float(0);
  if (spec.wet > 0) { m.clearcoatNode = L.wet; m.clearcoatRoughnessNode = L.wetRough.add(0.02); }
  if (spec.sheen > 0) { m.sheenNode = L.sheenColor.mul(L.sheen); m.sheenRoughnessNode = L.sheenRough; }
  m.thicknessColorNode = L.sssColor.mul(L.sss).mul(G.sssBoost).mul(0.8);
  m.thicknessDistortionNode = float(0.3);
  m.thicknessPowerNode = float(2);
  m.thicknessScaleNode = float(3);
  m.mrtNode = stableVelocity();
  return m;
}

export { uniform };
