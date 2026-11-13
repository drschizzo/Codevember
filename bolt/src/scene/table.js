// Les supports : sept matières de table écrites pour le plan large et pour le
// gros plan, chacune avec un relief à plusieurs échelles et ce qui la fait
// reconnaître — les fils irréguliers et les plis de repassage d'une nappe de
// lin, les veines d'un marbre (un bruit « en crête » déformé, et non des
// cellules), l'oxydation et les ronds de verre d'un zinc, les joncs et les
// liages d'une natte, les feuillets d'une ardoise, le sens du poil d'un
// velours, la peau d'une laque.
//
// Tout est calculé dans le repère du monde (la table ne bouge pas), à partir
// du volume de bruit commun ; chaque détail s'efface avant la fréquence du
// pixel (aa), sinon il se replie en moiré au loin. Unité : 1 = 10 cm.
//
// Réglages : couleur, seconde couleur et rugosité viennent de la recette
// (uniformes) ; la nature du support (kind) choisit le shader.
import * as THREE from 'three/webgpu';
import {
  uniform, lights, positionWorld, normalViewGeometry, vec2, vec3, vec4, float, mix, smoothstep, length, fract, floor, sin, cos, abs, exp, step, fwidth, hash, dot, max as tMax, min as tMin,
} from 'three/tsl';
import { noise, noise2, fbm, perturb, stableVelocity, G } from '../../../shared/scene/materials.js';

const PI = Math.PI;

export const TABLE_KINDS = ['cloth', 'velvet', 'marble', 'metal', 'lacquer', 'mat', 'slate'];

export function tableUniforms(fin) {
  return { color: uniform(new THREE.Color(fin.color)), color2: uniform(new THREE.Color(fin.color2)), rough: uniform(fin.rough) };
}
export function applyTable(U, fin) { U.color.value.set(fin.color); U.color2.value.set(fin.color2); U.rough.value = fin.rough; }

// lightsOf : les lumières que la table évalue (la lampe et l'éclair ; pas le contre-jour, qui laverait les ombres)
export function buildTableMaterial(kind, U, lightsOf = null) {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const p = positionWorld.xz, p3 = vec3(positionWorld.x, positionWorld.z, 0.37);
  const pf = length(fwidth(p)).toVar('tableFootprint');
  const aa = (freq) => smoothstep(0.6, 0.15, pf.mul(freq)); // fréquence (cycles / unité) → atténuation
  const N0 = normalViewGeometry;
  // hachage d'une cellule 2D
  const h21 = (c, s = 0) => hash(c.x.mul(127.1).add(c.y.mul(311.7)).add(s));
  // Une valeur par fil (ou par jonc, par trait de brosse), qui varie lentement
  // le long du fil. Le volume de bruit est périodique (4 cellules) : lu
  // directement à 46 fils par unité, il répéterait le même motif tous les
  // quatre fils. Chaque fil lit donc le bruit à un décalage tiré de son rang.
  const thread = (across, along, salt) => { const id = floor(across); return noise(vec3(along.add(hash(id.add(salt)).mul(37)), hash(id.add(salt + 1)).mul(4), salt * 0.31)); };
  // semis : un point par cellule, à une place tirée ; renvoie 1 au cœur du point
  const speck = (f, r, salt) => { const q = p.mul(f), c = floor(q); return smoothstep(r, r * 0.3, length(fract(q).sub(vec2(h21(c, salt), h21(c, salt + 2)).mul(0.6).add(0.2)))); };
  let color = vec3(U.color), rough = float(U.rough), metal = float(0), H = float(0);

  switch (kind) {
    case 'cloth': {
      // Lin : armure toile de 2,5 fils au millimètre, fils irréguliers (les
      // « flammes » du lin, visibles de loin en traits plus clairs ou plus
      // sombres dans les deux sens), plis de repassage, et les ondulations
      // molles d'une nappe posée.
      const F = 250;
      const u = p.x.mul(F), v = p.y.mul(F);
      const over = step(0.5, fract(floor(u).add(floor(v)).mul(0.5))); // dessus / dessous
      const warp = sin(fract(u).mul(PI)), weft = sin(fract(v).mul(PI));
      const weave = mix(warp.mul(weft.mul(0.4).add(0.6)), weft.mul(warp.mul(0.4).add(0.6)), over);
      // flammes : chaque fil a son épaisseur, qui varie lentement le long du fil
      const s1 = thread(p.y.mul(46), p.x.mul(0.9), 3), s2 = thread(p.x.mul(46), p.y.mul(0.9), 11);
      const t1 = thread(p.y.mul(17), p.x.mul(0.5), 21), t2 = thread(p.x.mul(17), p.y.mul(0.5), 27);
      const slub = s1.max(0).pow(2).add(s2.max(0).pow(2)).mul(aa(46)).add(t1.add(t2).mul(0.35).mul(aa(17)));
      const tone = fbm(p3.mul(0.6), 3); // nuances larges (le tissu n'est jamais uni)
      // plis de repassage : deux arêtes douces qui se croisent, hors du centre
      const crease = (d) => exp(d.div(0.035).pow2().negate());
      const cr = crease(p.x.sub(1.35)).add(crease(p.y.add(1.6))).mul(0.5);
      const fold = fbm(p3.mul(0.33).add(4.1), 3);
      H = weave.mul(0.0035).mul(aa(F)).add(slub.mul(0.006)).add(cr.mul(0.03)).add(fold.mul(0.07));
      color = mix(U.color, U.color2, weave.oneMinus().mul(0.55).mul(aa(F))).mul(slub.mul(0.2).add(1)).mul(tone.mul(0.09).add(1)).mul(cr.mul(0.08).add(1));
      rough = U.rough;
      m.sheenNode = vec3(1).mul(0.3); m.sheenRoughnessNode = float(0.7);
      break;
    }
    case 'velvet': {
      // Velours : le poil couché par endroits (les traces de main), qui change
      // le lustre plus que la teinte ; grain du poil au pixel.
      const nap = fbm(p3.mul(0.7), 3), stroke = noise(vec3(p.x.mul(0.5).add(p.y.mul(1.6)), p.y.mul(0.3), 2.7));
      const lay = smoothstep(-0.5, 0.6, nap.mul(0.6).add(stroke.mul(0.5)));
      const grain = noise2(p3.mul(180)).mul(aa(180));
      H = grain.mul(0.002).add(lay.mul(0.006));
      color = mix(U.color2, U.color, lay.mul(0.8).add(0.2)).mul(grain.mul(0.08).add(1));
      rough = float(0.95);
      m.sheenNode = mix(vec3(0.3), vec3(0.6), lay).mul(vec3(0.82, 0.86, 1)); m.sheenRoughnessNode = mix(float(0.55), float(0.3), lay);
      break;
    }
    case 'marble': {
      // Marbre : des nuages de fond, de grandes veines (un bruit « en crête »,
      // 1 − |n|, élevé à une puissance : des lignes fines et continues ; la
      // lecture est déformée par un fBm : elles serpentent et se rejoignent),
      // des veinules, des cristaux à peine visibles, un poli qui n'est pas
      // parfait (les veines sont un peu plus mates).
      const wq = vec3(fbm(p3.mul(0.55).add(3.3), 3), fbm(p3.mul(0.55).add(8.7), 3), 0).mul(0.9);
      const q = p3.mul(0.42).add(wq);
      const ridge = (n) => abs(n).oneMinus();
      const big = ridge(noise(q)).pow(11), mid = ridge(noise2(q.mul(2.1).add(1.7))).pow(18).mul(0.7), fine = ridge(noise(q.mul(5.3).add(4.2))).pow(30).mul(0.3).mul(aa(6));
      // (les veines s'interrompent : elles ne courent pas d'un bord à l'autre)
      const gate = smoothstep(-0.15, 0.3, fbm(p3.mul(0.3).add(11), 2));
      const vein = big.add(mid).add(fine).mul(gate).clamp(0, 1);
      const cloud = fbm(p3.mul(0.9).add(wq), 3).mul(0.5).add(0.5);
      const xtal = noise2(p3.mul(140)).mul(0.5).add(0.5).mul(aa(140));
      color = mix(U.color.mul(cloud.mul(0.22).add(0.82)), U.color2, vein.pow(0.7).mul(0.95)).mul(xtal.mul(0.05).add(0.975));
      rough = U.rough.add(vein.mul(0.12)).add(cloud.mul(0.05));
      H = vein.mul(-0.0012);
      // (pas de vernis : un second lobe spéculaire sur une surface plein écran coûtait 1 ms ; le poli est dans la rugosité)
      break;
    }
    case 'metal': {
      // Zinc de comptoir : une oxydation en plaques larges, le brossage du
      // laminage, des rayures courtes en tous sens, et les ronds laissés par
      // les verres.
      const ox = fbm(p3.mul(0.75), 3), ox2 = noise2(p3.mul(2.3).add(5));
      const brush = thread(p.y.mul(170), p.x.mul(1.5), 5).mul(aa(170));
      // rayures : dans chaque cellule, un trait court d'orientation tirée
      const scratch = (f, salt) => { const c = floor(p.mul(f)), fr = fract(p.mul(f)).sub(0.5), a = h21(c, salt).mul(PI); const d = fr.x.mul(sin(a)).sub(fr.y.mul(cos(a))), t = fr.x.mul(cos(a)).add(fr.y.mul(sin(a))); return exp(d.mul(f * 0.9).div(f * 0.012).pow2().negate()).mul(smoothstep(0.42, 0.2, abs(t))).mul(step(0.55, h21(c, salt + 3))); };
      const sc = scratch(1.7, 1).add(scratch(3.1, 7).mul(0.7)).mul(aa(60));
      // ronds de verre : un anneau par cellule de 1,9, une fois sur deux
      const rc = p.mul(1 / 1.9), ci = floor(rc), rf = fract(rc).sub(vec2(h21(ci, 11), h21(ci, 13)).mul(0.5).add(0.25));
      const rr = h21(ci, 17).mul(0.05).add(0.16);
      const ring = exp(length(rf).sub(rr).div(0.007).pow2().negate()).mul(step(0.5, h21(ci, 19))).mul(noise(p3.mul(9)).mul(0.5).add(0.6).clamp(0, 1));
      color = U.color.mul(ox.mul(0.38).add(ox2.mul(0.16)).add(0.9)).mul(ring.mul(0.4).oneMinus()).mul(sc.mul(0.25).add(1));
      rough = U.rough.add(ox.mul(0.22)).add(ox2.mul(0.1)).add(ring.mul(0.25)).sub(sc.mul(0.2)).add(brush.mul(0.05)).clamp(0.12, 1);
      metal = float(1);
      H = brush.mul(0.0006).sub(sc.mul(0.0012));
      break;
    }
    case 'lacquer': {
      // Laque : une peau tendue sous un vernis profond. Très légère « peau
      // d'orange », traces du polissage en arcs, poussières d'or rares.
      const peel = noise(p3.mul(26)).add(noise2(p3.yxz.mul(19.3))).mul(0.5).mul(aa(26)), wave = fbm(p3.mul(1.1), 2);
      const polish = sin(length(p.sub(vec2(2.2, -3))).mul(150)).mul(aa(150 / PI));
      const gold = speck(34, 0.09, 41).mul(step(0.62, noise2(p3.mul(3.1)).mul(0.5).add(0.5).add(wave.mul(0.35)))).mul(aa(34));
      color = mix(U.color.mul(wave.mul(0.1).add(1)), U.color2, gold);
      metal = gold;
      rough = mix(U.rough, float(0.3), gold).add(polish.mul(0.015)).add(wave.mul(0.04));
      H = peel.mul(0.0007).add(wave.mul(0.004)).add(gold.mul(0.001));
      break;
    }
    case 'mat': {
      // Natte de jonc (tatami) : des joncs ronds serrés, 9 au centimètre,
      // chacun de sa teinte, pincés tous les 15 mm par une chaîne ; d'un rang
      // de chaîne à l'autre le pincement alterne.
      const F = 90, W = 6.6;
      const j = p.y.mul(F), id = floor(j), along = p.x.mul(W);
      const bind = fract(along.add(fract(id.mul(0.5)))).sub(0.5); // (un jonc sur deux est pincé à mi-chemin)
      const pinch = exp(bind.div(0.11).pow2().negate());
      const round = sin(fract(j).mul(PI));
      const tint = hash(id.add(31)).sub(0.5), streak = thread(j, p.x.mul(7), 9);
      const worn = fbm(p3.mul(0.5), 3);
      H = round.mul(pinch.mul(0.55).oneMinus()).mul(0.006).mul(aa(F)).add(pinch.mul(-0.002).mul(aa(W * 2)));
      color = mix(U.color2, U.color, round.mul(0.6).add(0.4).mul(aa(F)).add(aa(F).oneMinus().mul(0.75))).mul(tint.mul(0.16).mul(aa(F)).add(1)).mul(streak.mul(0.06).add(1)).mul(pinch.mul(0.12).mul(aa(W * 2)).oneMinus()).mul(worn.mul(0.07).add(1));
      rough = U.rough.sub(round.mul(0.12).mul(aa(F)));
      m.sheenNode = vec3(0.9, 0.85, 0.6).mul(0.25); m.sheenRoughnessNode = float(0.5);
      break;
    }
    default: { // 'slate'
      // Ardoise : des feuillets (le clivage laisse des marches de quelques
      // dixièmes de millimètre aux bords déchiquetés), un grain fin, des
      // paillettes de mica, des traces plus claires.
      const lay = fbm(p3.mul(0.9), 4).mul(3.2);
      const stepv = floor(lay), fr = fract(lay), edge = smoothstep(0, 0.07, fr).mul(smoothstep(1, 0.93, fr)).oneMinus();
      const grain = noise(p3.mul(120)).mul(aa(120)), striae = thread(p.y.mul(40).add(p.x.mul(3)), p.x.mul(3), 13).mul(aa(40));
      const mica = speck(90, 0.05, 51).mul(step(0.6, h21(floor(p.mul(90)), 53))).mul(aa(90));
      const chalk = smoothstep(0.25, 0.6, fbm(p3.mul(1.7).add(7), 3));
      H = stepv.add(smoothstep(0, 0.07, fr)).mul(0.008).add(grain.mul(0.0008)).add(striae.mul(0.0012));
      color = mix(U.color, U.color2, chalk.mul(0.35).add(hash(stepv.add(5)).mul(0.25))).mul(edge.mul(0.45).oneMinus()).mul(grain.mul(0.06).add(1)).add(mica.mul(0.25));
      rough = U.rough.sub(mica.mul(0.5)).add(chalk.mul(0.08)).clamp(0.15, 1);
      break;
    }
  }
  m.colorNode = vec4(color, 1);
  m.roughnessNode = rough.clamp(0.04, 1);
  m.metalnessNode = metal;
  m.normalNode = perturb(H.mul(G.microDetail), N0);
  m.mrtNode = stableVelocity();
  if (lightsOf) m.lightsNode = lights(lightsOf);
  return m;
}
