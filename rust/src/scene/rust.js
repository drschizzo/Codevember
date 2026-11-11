// La rouille (TSL) : le matériau de la pièce, du métal nu à la croûte.
//
// Le champ de corrosion (gen/corrosion.js) donne, en chaque point, l'instant
// d'apparition de la rouille (en temps d'humectation τ, front de propagation
// compris), la concavité, la coulure et l'humectation. Le shader en tire :
//
//  - la COUVERTURE : la rouille paraît quand τ dépasse l'instant
//    d'apparition, retardé autour de chaque germe (piqûre) — les taches
//    naissent aux germes et s'étendent en disques qui se rejoignent ;
//  - l'ÉPAISSEUR : loi de dose h = k·(τ − t₀)^½ (ISO 9224, n ≈ 0,5 : la couche
//    freine l'oxygène) ;
//  - la STRATIFICATION : voile de lépidocrocite orange (mince, poudreux, le
//    métal se voit au travers), brun de goethite, brun sombre, magnétite noire
//    dans les creux ; orange vif sur les arêtes (rouille fraîche, usée) ;
//  - le RELIEF (Pilling-Bedworth : la rouille gonfle) : cloques, croûte qui
//    se fend en écailles aux bords relevés, grain ; les piqûres restent dans
//    l'acier décapé ;
//  - les COULURES : traînées verticales sous chaque source, orangées ;
//  - l'EAU : la rouille mouillée fonce de moitié et se lustre (vernis d'eau),
//    l'eau reste dans les creux tournés vers le haut ;
//  - le DÉCAPAGE : l'instant où l'outil atteint le point (machines.js, même
//    formule) ; derrière lui, la finition de la machine (laser : acier
//    satiné strié ; sablage : gris mat ; bain : gris sombre) ; un point que
//    l'outil n'atteint pas reste rouillé toute la boucle.
import * as THREE from 'three/webgpu';
import {
  uniform, uniformArray, attribute, positionGeometry, normalGeometry, normalViewGeometry, texture, texture3D, vec2, vec3, vec4, float, int,
  mix, smoothstep, clamp, abs, max, min, sqrt, pow, floor, fract, dot, normalize, length, atan, exp, sin, cos, fwidth, select, Fn,
} from 'three/tsl';
import { fbm, noise, worley, perturb, NZ, stableVelocity, isLite } from './materials.js';

const ss = smoothstep;
const PI = Math.PI;

// uniformes partagés par le matériau de la pièce (l'horloge et les réglages)
export function rustUniforms() {
  return {
    tau: uniform(0), wet: uniform(0), u: uniform(0), wetPool: uniform(0),
    pits: uniform(20), streak: uniform(1), blister: uniform(0.6), flake: uniform(0.8), hue: uniform(0), depth: uniform(1),
    offset: uniform(new THREE.Vector3()),
    fLo: uniform(new THREE.Vector3()), fSize: uniform(new THREE.Vector3(1, 1, 1)),
    // machine
    rows: uniformArray(Array.from({ length: 64 }, () => new THREE.Vector4()), 'vec4'),
    yTop: uniform(1), band: uniform(0.1), nRows: uniform(1), head: uniform(new THREE.Vector3()), // (x, y, faisceau)
    frLo: uniform(new THREE.Vector2()), frSize: uniform(new THREE.Vector2(1, 1)),
    s: uniform(0), turns: uniform(6), nTop: uniform(1), nBot: uniform(0), foot: uniform(0.16), tilt: uniform(0.3), dir: uniform(1), az: uniform(1),
    radY0: uniform(0), radH: uniform(1),
    dK: uniform(32), dTW: uniform(1), dTH: uniform(1), dR: uniform(1), dY0: uniform(0), dCell: uniform(0.01),
    off: uniform(0), level: uniform(1), up0: uniform(0.7), emergeWet: uniform(0),
    // finition du métal décapé
    cleanRough: uniform(0.32), cleanTone: uniform(1), stripes: uniform(1),
  };
}

const F0 = { steel: vec3(0.56, 0.57, 0.58), cast: vec3(0.4, 0.39, 0.38), brass: vec3(0.91, 0.76, 0.46) };

// tex : { field, front, radial } (textures) ; kind : machine
export function rustMaterial(tex, U, kind) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry, nG = normalize(normalGeometry);
  const surf = attribute('surf', 'vec4');
  const wCast = surf.y, wBrass = surf.z, rnd = surf.w;
  const q = p.add(U.offset).toVar('rq');

  // ── champ ──
  const Fd = texture3D(tex.field, p.sub(U.fLo).div(U.fSize)).toVar('rF');
  const onset = Fd.x, conc = Fd.y.sub(0.5).div(2.2), streakF = Fd.z, tow = Fd.w;

  // ── accès de la machine : atteint ? reste-t-il de la rouille ? ──
  let reached, left, glow = float(0), freshT = float(1);
  if (kind === 'laser') {
    const fz = texture(tex.front, vec2(p.x.sub(U.frLo.x).div(U.frSize.x), p.y.sub(U.frLo.y).div(U.frSize.y))).x;
    const tol = float(0.012).add(clamp(float(0.6).sub(nG.z).div(0.6), 0, 1).mul(0.16));
    reached = ss(-0.12, -0.08, nG.z).mul(step01(p.z.sub(fz.sub(tol))));
    const k = int(clamp(floor(U.yTop.sub(p.y).div(U.band)), 0, U.nRows.sub(1)));
    const row = U.rows.element(k);
    const f = clamp(p.x.sub(row.x).div(row.y.sub(row.x)), 0, 1);
    const tc = row.z.add(f.mul(row.w.sub(row.z)));
    left = float(1).sub(step01(U.u.sub(tc)));
    // la ligne de balayage (plasma) et l'acier tout juste décapé, encore chaud
    const onLine = ss(0.007, 0.002, abs(p.x.sub(U.head.x))).mul(ss(U.band.mul(0.5), U.band.mul(0.42), abs(p.y.sub(U.head.y))));
    glow = onLine.mul(U.head.z).mul(reached);
    freshT = U.u.sub(tc);
  } else if (kind === 'sablage') {
    // la face se tourne vers la buse (azimut de sa normale horizontale) ; accès
    // par la carte de profondeur de la direction la plus proche (32 directions)
    const nh = length(nG.xz), wN = ss(0.12, 0.45, nh), rr = max(length(p.xz), 1e-4);
    const v = nG.xz.div(max(nh, 1e-4)).mul(wN).add(p.xz.div(rr).mul(float(1).sub(wN)));
    const phi = atan(v.y, v.x);
    const face = nh.mul(cos(U.tilt)).add(nG.y.mul(sin(U.tilt)));
    const K = U.dK, kf = floor(phi.div(2 * PI).mul(K).add(0.5));
    const k = kf.sub(floor(kf.div(K)).mul(K)), a = k.div(K).mul(2 * PI);
    const dx = cos(a), dz = sin(a);
    const dep = p.x.mul(dx).add(p.z.mul(dz)), lat = p.z.mul(dx).sub(p.x.mul(dz));
    const ci = clamp(floor(lat.add(U.dR).div(U.dCell)).add(1), 0, U.dTW.sub(1)), cj = clamp(floor(p.y.sub(U.dY0).div(U.dCell)).add(1), 0, U.dTH.sub(1));
    const kx = k.sub(floor(k.div(8)).mul(8)), ky = floor(k.div(8));
    const uvD = vec2(kx.mul(U.dTW).add(ci).add(0.5).div(U.dTW.mul(8)), ky.mul(U.dTH).add(cj).add(0.5).div(U.dTH.mul(4)));
    const dmax = texture(tex.dirs, uvD).x;
    reached = ss(0.03, 0.09, face).mul(step01(dep.sub(dmax.sub(0.02))));
    const span = U.nTop.sub(U.nBot), turn = U.turns.mul(2 * PI);
    const s1 = max(0, U.nTop.sub(p.y).sub(U.foot.mul(0.5)).div(span));
    const aa = U.dir.mul(U.az.sub(phi)).sub(turn.mul(s1));
    const sStar = s1.add(aa.sub(floor(aa.div(2 * PI)).mul(2 * PI)).div(turn));
    left = float(1).sub(ss(sStar, sStar.add(float(0.35).div(turn)), U.s));
  } else {
    // bain : décapé une fois remonté au-dessus du niveau
    reached = float(1);
    const above = step01(p.y.add(U.off).sub(U.level));
    left = float(1).sub(step01(U.u.sub(U.up0)).mul(above));
  }
  reached = reached.toVar('rReach'); left = left.toVar('rLeft');

  // τ effectif : un point jamais atteint garde sa rouille de fin de saison
  const tauE = mix(float(1), U.tau, reached).toVar('rTau');

  // ── germes, couverture, épaisseur ──
  const wP = worley(q.mul(U.pits)).toVar('rW');
  const n1 = fbm(q.mul(7), 3).toVar('rN1');
  const n2 = noise(q.mul(140));
  const o = clamp(onset.add(n1.mul(0.16)).add(wP.x.mul(0.09)).sub(0.03), 0, 1);
  const age = tauE.sub(o);
  const brassM = ss(0.5, 0.6, wBrass);
  const cov = ss(0.0, 0.03, age).mul(float(1).sub(brassM)).mul(left).toVar('rCov');
  const kTh = float(0.45).add(tow.mul(0.55)).mul(U.depth);
  const h = clamp(sqrt(max(age, 0).div(max(float(1).sub(o), 0.08))).mul(kTh), 0, 1).mul(left).toVar('rH');
  // épaisseur de fin de saison (pour les piqûres laissées dans l'acier décapé)
  const hEnd = clamp(sqrt(max(float(1).sub(o), 0).div(max(float(1).sub(o), 0.08))).mul(kTh), 0, 1);

  // ── couleurs (albédo linéaire) ──
  // trois échelles : la tache (champ), la plaque (≈ 5 cm : zones plus orangées
  // ou plus sombres), le grain (millimètres)
  const cFlash = vec3(0.62, 0.3, 0.085), cYoung = vec3(0.42, 0.165, 0.05), cMature = vec3(0.22, 0.085, 0.033), cOld = vec3(0.11, 0.05, 0.026), cBlack = vec3(0.032, 0.028, 0.026);
  const blot = fbm(q.mul(19), 3).toVar('rBlot'), blot2 = fbm(q.mul(46).add(7.1), 2);
  const hv = h.add(n1.mul(0.22)).add(blot.mul(0.25));
  let col = mix(cFlash, cYoung, ss(0.05, 0.32, hv));
  col = mix(col, cMature, ss(0.3, 0.7, hv));
  col = mix(col, cOld, ss(0.65, 1.05, hv).mul(0.7));
  // plaques orangées (lépidocrocite fraîche) et brun-noir (goethite, magnétite)
  col = mix(col, cYoung.mul(1.25), ss(0.12, 0.38, blot2).mul(0.55));
  col = mix(col, cOld.mul(0.8), ss(-0.15, -0.38, blot2).mul(ss(0.3, 0.8, h)).mul(0.6));
  col = mix(col, cBlack, ss(0.02, 0.14, conc).mul(ss(0.25, 0.75, h)).mul(0.85));
  col = mix(col, cFlash.mul(1.08), ss(0.04, 0.2, conc.negate()).mul(0.4));
  // fonte : croûte plus grise et grenue
  col = mix(col, col.mul(vec3(0.75, 0.82, 0.9)), wCast.mul(0.5));
  // chlorures : plus orangée
  col = mix(col, col.mul(vec3(1.18, 0.98, 0.78)), U.hue);
  const n3 = noise(q.mul(520));
  col = col.mul(n2.mul(0.2).add(0.92)).mul(n3.mul(0.12).add(1)).mul(rnd.mul(0.14).add(0.93));
  // voile mince : le métal se voit au travers de la rouille éclair
  const rustA = cov.mul(mix(float(0.5), float(1), ss(0.0, 0.22, h))).toVar('rA');

  // ── métal (acier, fonte, laiton) et sa finition de décapage ──
  const tarn = ss(0.0, 0.6, tauE).mul(left);
  let metal = mix(F0.steel, F0.cast, wCast).mul(U.cleanTone);
  metal = metal.mul(float(1).sub(tarn.mul(0.25)));
  const brassC = mix(F0.brass, vec3(0.42, 0.3, 0.17), tarn.mul(0.7));
  metal = mix(metal, brassC, brassM);
  // piqûres laissées par la croûte (statiques : identiques d'une boucle à l'autre)
  const pit = ss(0.2, 0.07, wP.x).mul(ss(0.55, 0.95, hEnd)).mul(reached).mul(float(1).sub(brassM));
  metal = metal.mul(float(1).sub(pit.mul(0.75)));
  // stries du balayage (laser), effacées avant la fréquence du pixel
  const pf = fwidth(p.y);
  const str = sin(p.y.mul(2 * PI / 0.0016)).mul(ss(0.0009, 0.0003, pf)).mul(U.stripes);
  let mRough = U.cleanRough.add(n3.mul(0.03)).add(wCast.mul(0.12)).add(str.mul(0.05)).add(tarn.mul(0.18)).add(pit.mul(0.3));
  mRough = mix(mRough, float(0.3).add(tarn.mul(0.25)), brassM);

  // ── coulures ──
  const stripes = ss(-0.05, 0.35, fbm(vec3(q.x.mul(55), q.y.mul(3.5), q.z.mul(55)), 2));
  const sv = clamp(streakF.mul(U.streak).mul(1.6).mul(ss(0.12, 0.7, tauE)).mul(stripes).mul(left).mul(float(1).sub(brassM)), 0, 0.85).toVar('rSv');
  const cStain = vec3(0.43, 0.17, 0.055);

  // ── composition ──
  let albedo = mix(metal, col, rustA);
  albedo = mix(albedo, cStain.mul(n2.mul(0.2).add(0.9)), sv.mul(float(1).sub(rustA.mul(0.7))).mul(0.7));
  let metalness = float(1).sub(rustA).mul(float(1).sub(sv.mul(0.75)));
  let rough = mix(mRough, float(0.86).add(n2.mul(0.06)), rustA);
  rough = mix(rough, float(0.7), sv.mul(float(1).sub(rustA)).mul(0.6));

  // ── poudre : écailles et poussière de rouille tombées sur les faces
  // tournées vers le ciel (sous la croûte qui s'effrite) ──
  const up = ss(0.6, 0.95, nG.y);
  const powder = up.mul(ss(0.55, 1.0, tauE)).mul(ss(0.0, 0.3, fbm(q.mul(28).add(3.1), 2).add(conc.mul(2)))).mul(left).mul(float(1).sub(brassM)).mul(0.7);
  albedo = mix(albedo, cYoung.mul(n2.mul(0.25).add(1.05)), powder.mul(0.6));
  metalness = metalness.mul(float(1).sub(powder));
  rough = mix(rough, float(0.95), powder);

  // ── eau ──
  const poolish = ss(0.55, 0.95, nG.y).mul(ss(0.0, 0.1, conc));
  const wetE = clamp(U.wet.add(poolish.mul(U.wetPool)).add(U.emergeWet), 0, 1).toVar('rWet');
  albedo = albedo.mul(mix(float(1), float(0.5), wetE.mul(float(1).sub(metalness))));
  rough = mix(rough, float(0.16), wetE.mul(0.85));
  // gouttes perlées (volume de bruit : cellules de ~3 mm) tant que la pièce est mouillée
  const dF = NZ(q.mul(280)).z;
  const dropR = float(0.32).add(noise(q.mul(140)).mul(0.12));
  const drop = ss(dropR, dropR.mul(0.4), dF).mul(ss(0.15, 0.6, U.wet.add(U.emergeWet))).mul(ss(-0.4, 0.2, nG.y));

  // ── relief (mètres) ──
  // écailles : seulement dans la croûte épaisse, par plaques, aux fentes
  // irrégulières (coordonnées déformées) dont les bords se relèvent
  const qw = q.mul(17).add(vec3(fbm(q.mul(9), 2), fbm(q.mul(9).add(3.3), 2), fbm(q.mul(9).add(7.7), 2)).mul(0.9));
  const wF = worley(qw).toVar('rWF');
  const edge = wF.y.sub(wF.x);
  const patch = ss(-0.05, 0.25, fbm(q.mul(6).add(1.7), 2));
  const flakeOn = ss(0.55, 0.9, h).mul(U.flake).mul(patch).toVar('rFl');
  const bl0 = float(1).sub(clamp(NZ(q.mul(48)).z, 0, 1)); const blister = bl0.mul(bl0).mul(bl0).mul(ss(0.3, 0.7, h)).mul(U.blister).mul(0.0014);
  const flakes = flakeOn.mul(ss(0.25, 0.02, edge).mul(0.0012).sub(ss(0.05, 0.0, edge).mul(0.0016)));
  const grain = fbm(q.mul(320), 2).mul(0.00032).add(n3.mul(0.00008));
  const Hr = rustA.mul(h.mul(0.0014).add(blister).add(flakes).add(grain).add(blot.mul(0.0004)));
  const Hm = float(1).sub(rustA).mul(pit.mul(-0.0006).add(str.mul(0.000015)).add(noise(q.mul(900)).mul(0.00002)));
  const H = Hr.add(Hm).add(sv.mul(0.00008)).add(drop.mul(drop).mul(0.0005));
  // fentes des écailles : on voit la couche sombre du dessous
  albedo = albedo.mul(float(1).sub(ss(0.045, 0.0, edge).mul(flakeOn).mul(rustA).mul(0.5)));
  // bords relevés : la tranche de l'écaille est plus orangée (cassure fraîche)
  albedo = mix(albedo, cFlash.mul(0.9), ss(0.12, 0.04, edge).mul(flakeOn).mul(rustA).mul(0.35));

  m.colorNode = albedo;
  m.metalnessNode = metalness;
  m.roughnessNode = clamp(rough, 0.05, 1);
  m.normalNode = perturb(H.mul(1.0), normalViewGeometry);
  m.clearcoatNode = clamp(wetE.mul(0.85).add(drop), 0, 1);
  m.clearcoatRoughnessNode = float(0.07);
  // ── lueur du décapage laser ──
  if (kind === 'laser') {
    const hot = ss(0.0, 0.0004, freshT).mul(exp(max(freshT, 0).negate().div(0.0025))).mul(reached); // (jamais exp(+∞) × 0 : NaN)
    m.emissiveNode = vec3(1.0, 0.86, 0.72).mul(glow.mul(9)).add(vec3(1.0, 0.3, 0.06).mul(hot.mul(1.6)));
  }
  m.mrtNode = stableVelocity();
  return m;
}

// marche nette (0 / 1) sans branche
function step01(x) { return clamp(x.mul(1e6), 0, 1); }

// ── textures du champ et des cartes d'accès ──
export function fieldTextures(C) {
  const [nx, ny, nz] = C.field.dims;
  const field = new THREE.Data3DTexture(C.field.data, nx, ny, nz);
  field.format = THREE.RGBAFormat; field.type = THREE.UnsignedByteType;
  field.minFilter = field.magFilter = THREE.LinearFilter;
  field.wrapS = field.wrapT = field.wrapR = THREE.ClampToEdgeWrapping;
  field.unpackAlignment = 1; field.needsUpdate = true;
  const map = (M, wrapS = THREE.ClampToEdgeWrapping) => {
    const t = new THREE.DataTexture(M.data, M.w, M.h, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.wrapS = wrapS; t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    return t;
  };
  return { field, front: map(C.front), radial: map(C.radial, THREE.RepeatWrapping), dirs: map(C.dirs) };
}
