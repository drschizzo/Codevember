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
  mix, smoothstep, clamp, abs, max, min, sqrt, pow, floor, fract, dot, normalize, length, atan, acos, exp, sin, cos, fwidth, select, Fn,
} from 'three/tsl';
import { JET_COS, ACCESS_STEPS } from '../machines.js';
import { fbm, fbmNT, noise, noiseNT, worley, worleyNT, perturb, NZ, stableVelocity, isLite, hash33 } from './materials.js';

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
    s: uniform(0), Rn: uniform(0.5), tanT: uniform(0.3), turns: uniform(6), nTop: uniform(1), nBot: uniform(0), foot: uniform(0.16), tilt: uniform(0.3), dir: uniform(1), az: uniform(1),
    radY0: uniform(0), radH: uniform(1),
    dK: uniform(32), dTW: uniform(1), dTH: uniform(1), dR: uniform(1), dY0: uniform(0), dCell: uniform(0.01),
    off: uniform(0), level: uniform(1), up0: uniform(0.7), emergeWet: uniform(0), rinseY: uniform(10),
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
  let reached, left, glow = float(0), freshT = float(1), sludge = float(0);
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
    // même loi que machines.js (turnAccess, turnCleanS) : la face est décapée
    // quand, en tournant, elle entre dans le champ de la rampe de buses avec
    // une incidence utile (JET_COS), au premier azimut où rien ne la masque
    // (cartes de profondeur de 32 directions), à la hauteur où le jet incliné
    // la frappe
    const nh = length(nG.xz), wN = ss(0.12, 0.45, nh), rr = max(length(p.xz), 1e-4);
    const v = nG.xz.div(max(nh, 1e-4)).mul(wN).add(p.xz.div(rr).mul(float(1).sub(wN)));
    const phiF = atan(v.y, v.x);
    const face = nh.mul(cos(U.tilt)).add(nG.y.mul(sin(U.tilt)));
    const cw = float(JET_COS).sub(nG.y.mul(sin(U.tilt))).div(max(nh.mul(cos(U.tilt)), 1e-4));
    const W = min(acos(clamp(cw, 0, 1)), 1.2).mul(wN);
    const phiE = phiF.add(U.dir.mul(W));
    const K = U.dK;
    const visible = (ang) => {
      const kf = floor(ang.div(2 * PI).mul(K).add(0.5));
      const k = kf.sub(floor(kf.div(K)).mul(K)), a = k.div(K).mul(2 * PI);
      const dx = cos(a), dz = sin(a);
      const dep = p.x.mul(dx).add(p.z.mul(dz)), lat = p.z.mul(dx).sub(p.x.mul(dz));
      const ci = clamp(floor(lat.add(U.dR).div(U.dCell)).add(1), 0, U.dTW.sub(1)), cj = clamp(floor(p.y.sub(U.dY0).div(U.dCell)).add(1), 0, U.dTH.sub(1));
      const kx = k.sub(floor(k.div(8)).mul(8)), ky = floor(k.div(8));
      const uvD = vec2(kx.mul(U.dTW).add(ci).add(0.5).div(U.dTW.mul(8)), ky.mul(U.dTH).add(cj).add(0.5).div(U.dTH.mul(4)));
      return step01(dep.sub(texture(tex.dirs, uvD).level(0).x.sub(0.02)));
    };
    // (balayage de l'entrée à la sortie : le premier azimut visible)
    let phi = phiE, found = float(0);
    for (let i = 0; i < ACCESS_STEPS; i++) {
      const ang = phiE.add(phiF.sub(phiE).mul((2 * i) / (ACCESS_STEPS - 1)));
      const vi = visible(ang).mul(float(1).sub(found));
      phi = mix(phi, ang, vi); found = found.add(vi);
    }
    phi = phi.toVar('rPhi');
    reached = ss(0.03, 0.09, face).mul(found);
    const span = U.nTop.sub(U.nBot), turn = U.turns.mul(2 * PI);
    // hauteur de la rampe dont le jet incliné frappe ce point (machines.js, impactY)
    const yImp = p.y.add(U.tanT.mul(U.Rn.sub(p.x.mul(cos(phi)).add(p.z.mul(sin(phi))))));
    const s1 = max(0, U.nTop.sub(yImp).sub(U.foot.mul(0.5)).div(span));
    const aa = U.dir.mul(U.az.sub(phi)).sub(turn.mul(s1));
    const sStar = s1.add(aa.sub(floor(aa.div(2 * PI)).mul(2 * PI)).div(turn));
    left = float(1).sub(ss(sStar, sStar.add(float(0.35).div(turn)), U.s));
  } else {
    // bain : décapé une fois remonté au-dessus du niveau
    reached = float(1);
    const above = step01(p.y.add(U.off).sub(U.level));
    const emerged = step01(U.u.sub(U.up0)).mul(above);
    left = float(1).sub(emerged);
    // la croûte réduite sort en boue noire ; la rampe la chasse en descendant
    const yW = p.y.add(U.off);
    sludge = emerged.mul(ss(U.rinseY.add(0.012), U.rinseY.sub(0.004), yW));
  }
  reached = reached.toVar('rReach'); left = left.toVar('rLeft');

  // τ effectif : un point jamais atteint garde sa rouille de fin de saison
  const tauE = mix(float(1), U.tau, reached).toVar('rTau');

  // ── germes, couverture, épaisseur ──
  const wP = worley(q.mul(U.pits)).toVar('rW');
  const n1 = fbmNT(q.mul(7), 3).toVar('rN1');
  const n2 = noiseNT(q.mul(140));
  const o = clamp(onset.add(n1.mul(0.16)).add(wP.x.mul(0.09)).sub(0.03), 0, 1);
  const age = tauE.sub(o);
  const brassM = ss(0.5, 0.6, wBrass);
  const cov = ss(0.0, 0.03, age).mul(float(1).sub(brassM)).mul(left).toVar('rCov');
  const kTh = float(0.45).add(tow.mul(0.55)).mul(U.depth);
  const h = clamp(sqrt(max(age, 0).div(max(float(1).sub(o), 0.08))).mul(kTh), 0, 1).mul(left).toVar('rH');
  // épaisseur de fin de saison (pour les piqûres laissées dans l'acier décapé)
  const hEnd = clamp(sqrt(max(float(1).sub(o), 0).div(max(float(1).sub(o), 0.08))).mul(kTh), 0, 1);

  let slH = float(0), slC = float(0);
  // ── structure de la croûte (avant la couleur : la couleur suit le relief) ──
  // Une croûte épaisse n'est pas un bruit isotrope : c'est une mosaïque
  // d'écailles (lamelles de goethite) séparées par des fentes, chacune un peu
  // inclinée (chaque écaille prend la lumière à sa façon), aux bords qui se
  // relèvent en séchant ; certaines sont tombées et découvrent la couche
  // profonde, dense et sombre, en contrebas (une falaise de 1 à 3 mm) ; la
  // croûte elle-même ondule (tubercules, λ ≈ 3 cm) ; des cloques en dôme.
  const lump = fbmNT(q.mul(30).add(5.3), 3).toVar('rLump');
  const lumpy = clamp(lump.mul(1.1).add(0.8), 0.2, 1.5);
  const T = h.mul(0.0026).mul(U.depth).toVar('rT'); // épaisseur de croûte (m)
  const qw = q.mul(19).add(vec3(fbm(q.mul(9), 2), fbm(q.mul(9).add(3.3), 2), fbm(q.mul(9).add(7.7), 2)).mul(0.9));
  const W = worleyId(qw);
  const edge = W.f2.sub(W.f1).toVar('rEdge');
  const eAA = fwidth(edge).mul(0.7).add(0.012); // (largeur des fentes, jamais sous le pixel)
  const patch = ss(-0.1, 0.2, fbmNT(q.mul(6).add(1.7), 2));
  const flakeOn = ss(0.58, 0.95, h).mul(U.flake).mul(patch).toVar('rFl');
  const fall = ss(0.34, 0.26, W.id.x).mul(flakeOn).toVar('rFall'); // écaille tombée
  const lift = ss(0.32, 0.02, edge); // bord qui se relève
  // (fente : pas sur tout le pourtour — une croûte qui se fend n'est pas un
  // réseau continu de traits noirs, qui se lirait comme une peinture craquelée)
  const gap = ss(eAA.add(0.03), eAA, edge).mul(flakeOn).mul(ss(-0.15, 0.25, noise(q.mul(31).add(6.1)))).toVar('rGap'); // fente
  const tilt = dot(W.dv, W.id.mul(2).sub(1)).mul(0.0009);
  const plate = T.mul(lumpy).add(flakeOn.mul(T.mul(lift).mul(0.7).add(tilt.mul(ss(0.5, 0.9, h)))));
  const deep = T.mul(0.22).mul(lumpy);
  let crust = mix(plate, deep, fall);
  crust = mix(crust, T.mul(0.08), gap);
  // cloques (dômes de 1 à 2 cm), surtout sur la croûte non écaillée
  const bF = clamp(worleyNT(q.mul(52)), 0, 1);
  const dome = ss(0.62, 0.0, bF);
  const blister = dome.mul(dome).mul(ss(0.3, 0.7, h)).mul(U.blister).mul(float(1).sub(fall)).mul(0.0016);
  // creux : fentes, pied des falaises, piqûres de la rouille jeune, angles
  const cav = clamp(gap.mul(0.6).add(fall.mul(ss(0.16, 0.0, edge)).mul(0.5)).add(ss(0.02, 0.14, conc).mul(0.35)).add(ss(0.18, 0.05, wP.x).mul(ss(0.5, 0.05, h)).mul(0.4)), 0, 1).toVar('rCav');

  // ── couleurs (albédo linéaire) ──
  // trois échelles : la tache (champ), la plaque (≈ 5 cm : zones plus orangées
  // ou plus sombres), le grain (millimètres)
  const cFlash = vec3(0.62, 0.3, 0.085), cYoung = vec3(0.42, 0.165, 0.05), cMature = vec3(0.22, 0.085, 0.033), cOld = vec3(0.11, 0.05, 0.026), cBlack = vec3(0.032, 0.028, 0.026);
  const blot = fbmNT(q.mul(19), 3).toVar('rBlot'), blot2 = fbmNT(q.mul(46).add(7.1), 2);
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
  // la couleur suit le relief : dessus des tubercules et des écailles plus
  // clairs (oxydés, secs), chaque écaille sa nuance ; couche profonde
  // découverte rouge-noir, dense ; creux presque noirs
  col = col.mul(ss(-0.5, 0.6, lump).mul(0.32).add(0.72)).mul(W.id.y.sub(0.5).mul(0.3).mul(flakeOn).add(1));
  col = mix(col, vec3(0.085, 0.034, 0.02).mul(n2.mul(0.3).add(1)), fall.mul(0.85));
  col = col.mul(float(1).sub(cav.mul(0.72)));
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
  // l'acier nu n'est jamais uniforme : voiles plus sombres et plus mats
  // (calamine résiduelle, traces de manutention) à l'échelle de la main, et une
  // rugosité qui varie par plages — sinon il se lit comme du plastique gris
  const veil = ss(-0.15, 0.4, fbm(q.mul(4.5).add(9.1), 3)).mul(float(1).sub(brassM));
  metal = metal.mul(mix(vec3(1), vec3(0.74, 0.76, 0.82), veil.mul(0.55)));
  let mRough = U.cleanRough.add(n3.mul(0.03)).add(veil.mul(0.1)).add(fbm(q.mul(13).add(4.4), 2).mul(0.07)).add(wCast.mul(0.12)).add(str.mul(0.05)).add(tarn.mul(0.18)).add(pit.mul(0.3));
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

  // ── boue du bain (magnétite réduite) : noire, grasse, en paquets qui
  // coulent ; un reste dans les creux après le rinçage ──
  if (kind === 'bain') {
    const resid = ss(0.05, 0.16, conc).mul(float(1).sub(sludge)).mul(float(1).sub(rustA)).mul(0.5); // (constant : la boucle se referme)
    const sl = clamp(sludge.add(resid), 0, 1).mul(float(1).sub(brassM.mul(0.6))).toVar('rSl');
    const drip = ss(-0.1, 0.4, fbm(vec3(q.x.mul(70), q.y.mul(6), q.z.mul(70)), 2));
    albedo = mix(albedo, vec3(0.03, 0.026, 0.022).mul(n2.mul(0.35).add(1)).mul(drip.mul(0.5).add(0.75)), sl);
    metalness = mix(metalness, float(0.15), sl);
    // (boue grasse : lustre doux, relief faible — fort, sous le vernis d'eau,
    // elle scintillait comme du papier d'aluminium froissé)
    rough = mix(rough, float(0.55).sub(drip.mul(0.1)), sl);
    slH = sl.mul(fbm(q.mul(24).add(2.2), 2).mul(0.00035).add(drip.mul(0.00015)));
    slC = sl;
  }

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
  const grain = fbm(q.mul(320), 2).mul(0.00028).add(n3.mul(0.00008)).mul(float(1).sub(fall.mul(0.6)));
  const Hr = rustA.mul(crust.add(blister).add(grain).add(blot.mul(0.0003)));
  const Hm = float(1).sub(rustA).mul(pit.mul(-0.0006).add(str.mul(0.000015)).add(noise(q.mul(900)).mul(0.00002)));
  const H = Hr.add(Hm).add(sv.mul(0.00008)).add(drop.mul(drop).mul(0.0005)).add(slH);
  // tranche des écailles relevées : cassure fraîche, plus orangée
  albedo = mix(albedo, cFlash.mul(0.8), ss(0.14, 0.05, edge).mul(float(1).sub(gap)).mul(flakeOn).mul(float(1).sub(fall)).mul(rustA).mul(0.3));
  // couche profonde : dense, un peu lustrée
  rough = mix(rough, float(0.62), fall.mul(rustA).mul(float(1).sub(wetE)));

  m.colorNode = albedo;
  // (les creux voient moins le studio : occlusion de l'éclairage indirect)
  m.aoNode = float(1).sub(cav.mul(rustA).mul(0.75));
  m.metalnessNode = metalness;
  m.roughnessNode = clamp(rough, 0.05, 1);
  m.normalNode = perturb(H.mul(1.0), normalViewGeometry);
  m.clearcoatNode = clamp(wetE.mul(0.85).add(drop), 0, 1).mul(float(1).sub(slC.mul(0.6)));
  m.clearcoatRoughnessNode = float(0.07);
  // ── lueur du décapage laser ──
  if (kind === 'laser') {
    // (l'acier chauffé ne rougeoie qu'un instant juste derrière la ligne : un
    // liseré, pas une plaque — la tête avance de ~0,5 m/s)
    const hot = ss(0.0, 0.0001, freshT).mul(exp(max(freshT, 0).negate().div(0.0006))).mul(reached); // (jamais exp(+∞) × 0 : NaN)
    m.emissiveNode = vec3(1.0, 0.86, 0.72).mul(glow.mul(9)).add(vec3(1.0, 0.22, 0.03).mul(hot.mul(hot).mul(1.1)));
  }
  m.mrtNode = stableVelocity();
  return m;
}

// Worley avec l'identité de la cellule la plus proche : F1, F2 (en
// cellules), un tirage propre à la cellule (vec3 dans [0, 1)) et le vecteur
// vers son germe (pour incliner chaque écaille). Version allégée : le volume
// de bruit (F1, F2 − F1), sans identité (ni écailles tombées ni inclinaison).
function worleyId(p) {
  if (isLite()) { const w = worley(p); return { f1: w.x, f2: w.y, id: vec3(0.5), dv: vec3(0) }; }
  const i = floor(p), f = fract(p);
  let f1 = float(8), f2 = float(8), id = vec3(0.5), dv = vec3(0);
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const o = vec3(x, y, z), c = i.add(o), hs = hash33(c);
    const r = o.add(hs).sub(f), d = length(r);
    const near = d.lessThan(f1);
    f2 = f2.min(f1.max(d));
    id = select(near, hash33(c.add(17.17)), id);
    dv = select(near, r, dv);
    f1 = f1.min(d);
  }
  return { f1: f1.toVar('rWf1'), f2: f2.toVar('rWf2'), id: id.toVar('rWid'), dv: dv.toVar('rWdv') };
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
