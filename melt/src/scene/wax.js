// La cire : une boîte (la grille de simulation) dont le fragment marche dans
// les champs déposés par la simulation (sim/mpm.js).
//
// Surface = l'objet d'origine évalué en p − d (d : déplacement de la part
// solide ; net tant que rien n'a bougé), rogné là où le liquide a pris la
// place du solide, réuni en douceur à l'iso-densité de la part liquide.
// L'objet d'origine est une texture 3D de distance (une par figurine).
//
// La matière s'éclaire elle-même (elle n'est pas dans la passe de lumière de
// three.js) : deux lampes et la source de chaleur, avec pour chacune l'épaisseur
// de cire traversée (ombre propre et translucidité), un reflet et un studio
// analytique. Les directions et les teintes sont celles des lampes de la scène.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, Discard, uniform, float, vec3, vec4, max, min, pow, clamp, mix, smoothstep, length, normalize, dot, abs, exp, reflect, select,
  texture3D, cameraPosition, positionWorld, cameraViewMatrix, cameraNear, cameraFar, viewZToPerspectiveDepth, viewZToOrthographicDepth,
} from 'three/tsl';
import { GX, GY, GZ, O, CELL, RH } from '../sim/mpm.js';
import { BOX } from '../objects.js';
import { stableVelocity } from '../../../shared/scene/materials.js';

export function createWax(sim) {
  const U = {
    origin: uniform(new THREE.Vector3()), // coin de la grille dans le monde
    a: uniform(new THREE.Color(0.78, 0.2, 0.24)), b: uniform(new THREE.Color(0.9, 0.8, 0.66)),
    keyDir: uniform(new THREE.Vector3(0, 1, 0)), keyCol: uniform(new THREE.Color(1, 1, 1)),
    rimDir: uniform(new THREE.Vector3(0, 1, 0)), rimCol: uniform(new THREE.Color(1, 1, 1)),
    heatDir: uniform(new THREE.Vector3(0, 1, 0)), heatCol: uniform(new THREE.Color(0, 0, 0)),
    amb: uniform(new THREE.Color(0.05, 0.05, 0.05)),
  };
  const blank = new THREE.Data3DTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(4)]), 1, 1, 1);
  blank.format = THREE.RedFormat; blank.type = THREE.HalfFloatType; blank.needsUpdate = true;
  const tS = texture3D(blank, null, 0), tA = texture3D(sim.texA, null, 0), tB = texture3D(sim.texB, null, 0);
  const Gv = vec3(GX, GY, GZ), Ov = vec3(...O);
  const sdObj = (p) => {
    const q = p.sub(vec3(...BOX.min)).div(vec3(...BOX.size));
    const out = length(max(abs(q.sub(0.5)).sub(0.5), 0).mul(vec3(...BOX.size))); // (hors de la boîte : la distance au bord s'ajoute)
    return tS.sample(clamp(q, 0, 1)).r.add(out);
  };
  const ISO_L = 0.9 * RH, KF = 0.3 / RH, KU = 0.9; // (seuils en densité de particules)
  const parts = (p) => {
    const uvw = p.div(Gv);
    const A = tA.sample(uvw), Bq = tB.sample(uvw);
    const ms = A.w, d = A.xyz.div(ms.max(1e-3));
    const frac = ms.div(ms.add(Bq.x).max(1e-3));
    const ps = max(sdObj(p.sub(Ov).sub(d)), float(0.3).sub(frac).mul(1.5));
    // (loin de toute matière, la distance vaut un grand pas : sans cela la marche piétine dans le vide
    //  de la boîte — c'est ce qui empêchait le rayon d'ombre d'atteindre l'objet)
    const pl = mix(float(1.2), float(ISO_L).sub(Bq.x).mul(KF), smoothstep(0.004 * RH, 0.03 * RH, ms.add(Bq.x)));
    return { ps: mix(float(1.2), ps, smoothstep(0.004 * RH, 0.03 * RH, ms)), pl, A, Bq };
  };
  const inBox = (p) => p.x.greaterThan(1).and(p.x.lessThan(GX - 1)).and(p.y.greaterThan(1)).and(p.y.lessThan(GY - 1)).and(p.z.greaterThan(1)).and(p.z.lessThan(GZ - 1));
  const phi = Fn(([p]) => {
    const { ps, pl } = parts(p);
    const h = max(float(KU).sub(abs(ps.sub(pl))), 0).div(KU);
    return select(inBox(p), min(ps, pl).sub(h.mul(h).mul(KU * 0.25)), float(1.5));
  });
  // studio analytique : un fond, et une boîte à lumière dans l'axe de chaque lampe
  const env = (d) => {
    const bg = mix(U.amb.mul(0.4), U.amb.mul(1.6), smoothstep(-0.3, 0.9, d.y));
    const k = smoothstep(0.83, 0.93, dot(d, U.keyDir)).mul(2.2);
    const r = smoothstep(0.9, 0.955, dot(d, U.rimDir)).mul(1.8);
    const h = smoothstep(0.9, 0.98, dot(d, U.heatDir)).mul(3);
    return bg.add(U.keyCol.mul(k)).add(U.rimCol.mul(r)).add(U.heatCol.mul(h));
  };
  // épaisseur de matière traversée vers une lampe (dans la densité totale, loin de la surface)
  const thick = Fn(([p, L]) => {
    const t = float(0).toVar();
    Loop(9, ({ i }) => {
      const q = p.add(L.mul(float(i).add(0.5).mul(2.4)));
      const uvw = q.div(Gv);
      const m = tA.sample(uvw).w.add(tB.sample(uvw).x);
      t.addAssign(smoothstep(1.2 * RH, 5.5 * RH, m).mul(2.4).mul(select(inBox(q), float(1), float(0))));
    });
    return t;
  });
  const ro = cameraPosition.sub(U.origin).div(CELL), rd = normalize(positionWorld.sub(cameraPosition));
  // la marche : rend (normale, distance le long du rayon en cellules) ; hors de la cire, le fragment est jeté
  const march = Fn(() => {
    const inv = vec3(1).div(rd);
    const t0 = vec3(1).sub(ro).mul(inv), t1 = Gv.sub(1).sub(ro).mul(inv);
    const tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)).max(0), tf = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
    const tw = tn.toVar(), hit = float(0).toVar();
    If(tf.greaterThan(tn), () => {
      Loop(200, () => {
        If(tw.greaterThan(tf), () => { Break(); });
        const d = phi(ro.add(rd.mul(tw)));
        If(d.lessThan(0.02), () => { hit.assign(1); Break(); });
        tw.addAssign(clamp(d.mul(0.75), 0.1, 1.4));
      });
    });
    If(hit.lessThan(0.5), () => { Discard(); });
    // (point d'impact affiné : l'ombre propre et la normale ne dépendent plus du pas de la marche)
    Loop(3, () => { tw.addAssign(phi(ro.add(rd.mul(tw))).mul(0.9)); });
    const p = ro.add(rd.mul(tw)).toConst();
    const e = 0.55;
    const n = normalize(vec3(
      phi(p.add(vec3(e, 0, 0))).sub(phi(p.sub(vec3(e, 0, 0)))),
      phi(p.add(vec3(0, e, 0))).sub(phi(p.sub(vec3(0, e, 0)))),
      phi(p.add(vec3(0, 0, e))).sub(phi(p.sub(vec3(0, 0, e)))),
    ));
    return vec4(n, tw);
  });
  const shade = Fn(([M]) => {
    const n = M.xyz, p = ro.add(rd.mul(M.w)).toConst();
    const F = parts(p.sub(n.mul(0.5)));
    const im = float(1).div(F.A.w.add(F.Bq.x).max(1e-3));
    const T = F.Bq.y.mul(im), pig = clamp(F.Bq.z.mul(im), 0, 1);
    const Fs = parts(p);
    const liq = smoothstep(-0.25, 0.25, Fs.ps.sub(Fs.pl));
    const wet = smoothstep(0.55, 0.95, T); // (la peau luit avant de couler)
    const albedo = mix(vec3(U.a), vec3(U.b), smoothstep(0.25, 0.75, pig)).mul(mix(1, 0.72, liq)).toConst();
    const sig = vec3(0.05, 0.16, 0.2);
    const v = rd.negate();
    const lit = (L, Ii) => {
      const th = thick(p.add(n.mul(1.3)), L);
      const ndl = dot(n, L);
      const wrap = clamp(ndl.add(0.35).div(1.35), 0, 1);
      const direct = albedo.mul(wrap).mul(exp(th.mul(-0.55)));
      const trans = pow(albedo, vec3(0.6)).mul(exp(sig.mul(th).negate())).mul(0.3);
      const hv = normalize(L.add(v));
      const rough = mix(0.42, 0.1, max(wet, liq));
      const sp = pow(max(dot(n, hv), 0), float(2).div(rough.mul(rough))).mul(float(0.35).div(rough.mul(rough))).mul(max(ndl, 0)).mul(exp(th.mul(-1.2))).mul(0.06);
      return direct.add(trans).add(sp).mul(Ii);
    };
    const fres = pow(float(1).sub(max(dot(n, v), 0)), 5).mul(0.96).add(0.04);
    const gloss = mix(0.25, 1, max(wet, liq));
    return lit(U.keyDir, vec3(U.keyCol)).add(lit(U.rimDir, vec3(U.rimCol))).add(lit(U.heatDir, vec3(U.heatCol)))
      .add(albedo.mul(vec3(U.amb)).mul(n.y.mul(0.5).add(0.6))).add(env(reflect(rd, n)).mul(fres).mul(gloss));
  });

  const mat = new THREE.MeshBasicNodeMaterial();
  const M = march().toVar();
  mat.colorNode = shade(M);
  const pw = U.origin.add(ro.add(rd.mul(M.w)).mul(CELL));
  mat.depthNode = viewZToPerspectiveDepth(cameraViewMatrix.mul(vec4(pw, 1)).z, cameraNear, cameraFar);
  // (un matériau « basic » rend la normale de sa géométrie — ici les faces de la boîte, d'où une
  //  couture dans l'occlusion ambiante : on lui donne celle de la surface marchée)
  const nView = normalize(cameraViewMatrix.mul(vec4(M.xyz, 0)).xyz);
  mat.normalNode = nView;
  mat.setupNormal = () => nView;
  mat.side = THREE.BackSide;
  mat.mrtNode = stableVelocity();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(GX * CELL, GY * CELL, GZ * CELL), mat);
  mesh.frustumCulled = false;

  // L'ombre portée : une seconde boîte, que seule la caméra d'ombre de la lampe voit (calque 2).
  // Ses rayons sont parallèles (lampe directionnelle) : on marche de la face d'entrée vers la
  // face dessinée, le long de la lumière, et l'on écrit la profondeur du point touché.
  const sMat = new THREE.MeshBasicNodeMaterial();
  // (la marche est écrite deux fois, une par nœud : une variable partagée entre le masque et la
  //  profondeur n'est déclarée que dans le premier des deux et manque à l'autre)
  const sMarch = () => {
    const rl = U.keyDir.negate(), pe = positionWorld.sub(U.origin).div(CELL);
    const inv = vec3(1).div(rl), t0 = vec3(1).sub(pe).mul(inv), t1 = Gv.sub(1).sub(pe).mul(inv);
    const tn = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)); // (négatif : l'entrée est en amont)
    const tw = tn.toVar(), hit = float(0).toVar();
    Loop(160, () => {
      If(tw.greaterThan(0), () => { Break(); });
      const d = phi(pe.add(rl.mul(tw)));
      If(d.lessThan(0.05), () => { hit.assign(1); Break(); });
      tw.addAssign(clamp(d.mul(0.8), 0.15, 1.6));
    });
    return { p: pe.add(rl.mul(tw)), hit };
  };
  sMat.maskShadowNode = Fn(() => sMarch().hit.greaterThan(0.5))();
  sMat.depthNode = Fn(() => viewZToOrthographicDepth(cameraViewMatrix.mul(vec4(U.origin.add(sMarch().p.mul(CELL)), 1)).z, cameraNear, cameraFar))();
  sMat.shadowSide = THREE.BackSide;
  const shadow = new THREE.Mesh(mesh.geometry, sMat);
  shadow.frustumCulled = false; shadow.castShadow = true; shadow.layers.set(2);
  mesh.add(shadow);
  return { mesh, U, setShape: (tex) => { tS.value = tex; } };
}
